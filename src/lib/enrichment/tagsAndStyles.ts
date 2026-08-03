import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tags, releaseTags, genresStyles, releaseGenresStyles, enrichmentCache } from "@/db/schema";
import { anthropic, SHORTLIST_MODEL } from "@/lib/llm/client";
import { parseWithRetry } from "@/lib/llm/parseWithRetry";
import type { getReleaseForEnrichment } from "@/lib/releases";

const AssignmentSchema = z.object({
  tags: z
    .array(
      z.object({
        label: z.string(),
        // "tag" = structural/format facts (live album, compilation, remix);
        // "mood" = a vibe adjective (hazy, dark, upbeat) — same distinction
        // used in the NL-query prompts (src/lib/llm/query.ts).
        kind: z.enum(["tag", "mood"]),
      }),
    )
    .max(12),
  additional_genres_styles: z
    .array(z.object({ name: z.string(), kind: z.enum(["genre", "style"]) }))
    .max(8),
});

function buildPrompt(
  release: NonNullable<Awaited<ReturnType<typeof getReleaseForEnrichment>>>,
  aboutSummary: string | null,
  existingVocab: { label: string; kind: "tag" | "mood" }[],
  existingGenresStyles: { name: string; kind: "genre" | "style" }[],
): string {
  const vocabByKind = {
    tag: existingVocab.filter((v) => v.kind === "tag").map((v) => v.label),
    mood: existingVocab.filter((v) => v.kind === "mood").map((v) => v.label),
  };

  return `You are curating tags/moods and genre/style classification for a record in a home vinyl collection.

This release already has these Discogs-sourced genres/styles: ${
    [...release.genres, ...release.styles].join(", ") || "(none)"
  }.

Your job:
1. Pick tags/moods that apply to this release. "tag" is a structural/format fact (e.g. "live album", "compilation", "concept album", "instrumental", "remix", "dj mix", "soundtrack", "reissue"); "mood" is a vibe adjective (e.g. "hazy", "dark", "upbeat", "romantic"). Strongly prefer reusing an existing label from the vocabulary below when it fits — only propose a brand new label if nothing existing captures it. Return up to 8 total.
2. Separately, name any additional genres/styles from the existing hierarchy list below (not Discogs' own tagging, which is already applied) that clearly also apply to this release. Only pick from that exact list — never invent a new genre or style name. Return up to 4, or none if nothing else clearly fits.

Existing tag vocabulary: ${vocabByKind.tag.join(", ") || "(none yet)"}
Existing mood vocabulary: ${vocabByKind.mood.join(", ") || "(none yet)"}
Existing genre/style hierarchy: ${existingGenresStyles.map((g) => `${g.name} (${g.kind})`).join(", ")}

Facts about this release:
Title: ${release.title}
Artist: ${release.artistNames.join(", ")}
${release.year ? `Year: ${release.year}\n` : ""}${aboutSummary ? `Summary: ${aboutSummary}\n` : ""}`;
}

/** One-shot marker, mirroring about_summary's non-clobbering pattern — once
 * this has run for a release, it never runs again automatically (a user who
 * removes every tag from a release shouldn't have them silently reappear).
 * Releases that already carry tags from the original one-time batch-tagging
 * pass (which predates this marker existing) are grandfathered in as
 * already-done rather than re-run. */
export async function needsTagsAndStyles(releaseId: number): Promise<boolean> {
  const marker = await db.query.enrichmentCache.findFirst({
    where: and(
      eq(enrichmentCache.releaseId, releaseId),
      eq(enrichmentCache.source, "claude"),
      eq(enrichmentCache.fieldKey, "tags_styles_assigned"),
    ),
  });
  if (marker) return false;

  const existingTag = await db.query.releaseTags.findFirst({
    where: eq(releaseTags.releaseId, releaseId),
  });
  return !existingTag;
}

export interface TagsStylesResult {
  tagsAssigned: number;
  genresStylesAssigned: number;
}

export async function enrichTagsAndStyles(
  releaseId: number,
  release: NonNullable<Awaited<ReturnType<typeof getReleaseForEnrichment>>>,
  aboutSummary: string | null,
): Promise<TagsStylesResult> {
  const [existingVocab, existingGenresStyles] = await Promise.all([
    db.selectDistinct({ label: tags.label, kind: tags.kind }).from(tags),
    db.select({ name: genresStyles.name, kind: genresStyles.kind }).from(genresStyles),
  ]);

  const prompt = buildPrompt(release, aboutSummary, existingVocab, existingGenresStyles);

  // parseWithRetry already retries once internally; if it still fails, give
  // up permanently rather than re-paying for this call every night forever —
  // unlike the free pull-enrichers above, this is a metered call, so "no
  // cache row yet" can't be allowed to mean "retry indefinitely" here.
  let result: z.infer<typeof AssignmentSchema>;
  try {
    result = await parseWithRetry("tags-styles", async () => {
      const message = await anthropic.messages.parse({
        model: SHORTLIST_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: zodOutputFormat(AssignmentSchema) },
      });
      return message.parsed_output;
    });
  } catch (err) {
    console.error(
      `[enrichment] tags/styles assignment gave up for release ${releaseId} after retrying:`,
      err,
    );
    await db.insert(enrichmentCache).values({
      releaseId,
      source: "claude",
      fieldKey: "tags_styles_assigned",
      fieldValue: "gave_up",
    });
    return { tagsAssigned: 0, genresStylesAssigned: 0 };
  }

  let tagsAssigned = 0;
  for (const t of result.tags) {
    const label = t.label.trim();
    if (!label) continue;

    let tagRow = await db.query.tags.findFirst({
      where: and(eq(tags.label, label), eq(tags.kind, t.kind)),
    });
    if (!tagRow) {
      const [inserted] = await db.insert(tags).values({ label, kind: t.kind }).returning();
      tagRow = inserted;
    }

    const existingLink = await db.query.releaseTags.findFirst({
      where: and(eq(releaseTags.releaseId, releaseId), eq(releaseTags.tagId, tagRow.id)),
    });
    if (!existingLink) {
      await db.insert(releaseTags).values({ releaseId, tagId: tagRow.id });
      tagsAssigned++;
    }
  }

  // Genres/styles are hand-curated and DB-enforced (every style needs a
  // parent genre) — only ever link to something that already exists in the
  // hierarchy, never create a new genre/style row here.
  const existingSet = new Set(existingGenresStyles.map((g) => `${g.name}::${g.kind}`));
  let genresStylesAssigned = 0;
  for (const g of result.additional_genres_styles) {
    if (!existingSet.has(`${g.name}::${g.kind}`)) continue;

    const row = await db.query.genresStyles.findFirst({
      where: and(eq(genresStyles.name, g.name), eq(genresStyles.kind, g.kind)),
    });
    if (!row) continue;

    const existingLink = await db.query.releaseGenresStyles.findFirst({
      where: and(
        eq(releaseGenresStyles.releaseId, releaseId),
        eq(releaseGenresStyles.genreStyleId, row.id),
      ),
    });
    if (!existingLink) {
      await db.insert(releaseGenresStyles).values({ releaseId, genreStyleId: row.id });
      genresStylesAssigned++;
    }
  }

  await db.insert(enrichmentCache).values({
    releaseId,
    source: "claude",
    fieldKey: "tags_styles_assigned",
    fieldValue: "true",
  });

  return { tagsAssigned, genresStylesAssigned };
}
