import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { enrichmentCache, syncRuns } from "@/db/schema";
import { getReleaseForEnrichment, getTagsByReleaseIds, listAllReleaseIds } from "@/lib/releases";
import { wikipediaEnricher } from "./wikipedia";
import { musicbrainzEnricher } from "./musicbrainz";
import { lastfmEnricher } from "./lastfm";
import { appleMusicEnricher } from "./appleMusic";
import { generateAboutSummary } from "./aboutSummary";
import { needsTagsAndStyles, enrichTagsAndStyles } from "./tagsAndStyles";
import { needsMoodAxes, scoreMoodAxes } from "./moodAxes";
import type { Enricher, EnrichmentSource } from "./types";

const enrichers: Enricher[] = [
  wikipediaEnricher,
  musicbrainzEnricher,
  lastfmEnricher,
  appleMusicEnricher,
];

// The full set of valid enrichment_cache.source values — wider than
// EnrichmentSource, which only covers the pluggable pull-enrichers above.
type CacheSource = typeof enrichmentCache.$inferInsert.source;

// A field is only ever fetched once — same non-clobbering posture as
// about_summary/mood axes, rather than re-checking on a staleness timer.
// Once a source has answered for a release (even with "no match"), it's
// done; nothing here overwrites it automatically.
async function needsEnrichment(releaseId: number, source: EnrichmentSource): Promise<boolean> {
  const existing = await db.query.enrichmentCache.findFirst({
    where: and(eq(enrichmentCache.releaseId, releaseId), eq(enrichmentCache.source, source)),
  });
  return !existing;
}

export async function upsertField(
  releaseId: number,
  source: CacheSource,
  fieldKey: string,
  fieldValue: string,
) {
  const existing = await db.query.enrichmentCache.findFirst({
    where: and(
      eq(enrichmentCache.releaseId, releaseId),
      eq(enrichmentCache.source, source),
      eq(enrichmentCache.fieldKey, fieldKey),
    ),
  });
  if (existing) {
    await db
      .update(enrichmentCache)
      .set({ fieldValue, fetchedAt: new Date().toISOString() })
      .where(eq(enrichmentCache.id, existing.id));
  } else {
    await db.insert(enrichmentCache).values({
      releaseId,
      source,
      fieldKey,
      fieldValue,
    });
  }
}

// Unlike the raw pull-sources above, the AI-synthesized summary is
// deliberately NOT refreshed on a schedule — it's generated once (when a
// release is first added) and only ever regenerated when the user
// explicitly asks for a redo via the manual endpoint, since "wrong until
// I say otherwise" is a judgment call only the user can make.
async function needsAboutSummary(releaseId: number): Promise<boolean> {
  const existing = await db.query.enrichmentCache.findFirst({
    where: and(
      eq(enrichmentCache.releaseId, releaseId),
      eq(enrichmentCache.source, "claude"),
      eq(enrichmentCache.fieldKey, "about_summary"),
    ),
  });
  return !existing;
}

export async function enrichAboutSummary(
  releaseId: number,
  release: Awaited<ReturnType<typeof getReleaseForEnrichment>>,
): Promise<boolean> {
  if (!release) return false;

  // The synthesized summary itself (source="claude") is deliberately excluded
  // from its own inputs.
  const rawSourceRows = await db
    .select({ fieldKey: enrichmentCache.fieldKey, fieldValue: enrichmentCache.fieldValue })
    .from(enrichmentCache)
    .where(
      and(
        eq(enrichmentCache.releaseId, releaseId),
        inArray(enrichmentCache.source, ["wikipedia", "musicbrainz", "lastfm"]),
      ),
    );
  const byKey = Object.fromEntries(rawSourceRows.map((r) => [r.fieldKey, r.fieldValue]));

  const summary = await generateAboutSummary({
    title: release.title,
    artist: release.artistNames.join(", "),
    year: release.year,
    genres: release.genres,
    styles: release.styles,
    discogsCommunityRating: release.discogsCommunityRating,
    discogsCommunityRatingCount: release.discogsCommunityRatingCount,
    wikipediaSummary: byKey["wikipedia_summary"] ?? null,
    musicbrainzTags: byKey["musicbrainz_tags"] ?? null,
    lastfmSummary: byKey["lastfm_summary"] ?? null,
    lastfmTags: byKey["lastfm_tags"] ?? null,
  });

  if (!summary) return false;
  await upsertField(releaseId, "claude", "about_summary", summary.text);
  await upsertField(
    releaseId,
    "claude",
    "about_summary_used_web_search",
    summary.usedWebSearch ? "true" : "false",
  );
  return true;
}

/**
 * Force-regenerates the About This Record summary for one release,
 * overwriting whatever's there — the manual "redo this" path for when the
 * user judges the existing write-up wrong or incomplete. Unlike the
 * automatic pipeline, this always runs regardless of whether a summary
 * already exists.
 */
export async function regenerateAboutSummary(releaseId: number): Promise<boolean> {
  const release = await getReleaseForEnrichment(releaseId);
  return enrichAboutSummary(releaseId, release);
}

async function getAboutSummaryText(releaseId: number): Promise<string | null> {
  const row = await db.query.enrichmentCache.findFirst({
    where: and(
      eq(enrichmentCache.releaseId, releaseId),
      eq(enrichmentCache.source, "claude"),
      eq(enrichmentCache.fieldKey, "about_summary"),
    ),
  });
  return row?.fieldValue ?? null;
}

export interface EnrichmentRunResult {
  releasesConsidered: number;
  fieldsWritten: number;
  summariesWritten: number;
  tagsAssigned: number;
  genresStylesAssigned: number;
  moodAxesScored: number;
}

/**
 * Runs enrichment for up to `limit` releases that are missing data. Every
 * step here is one-shot per release (no staleness re-checks) — never
 * touches user_release_data.
 */
export async function runEnrichment(limit = 15): Promise<EnrichmentRunResult> {
  const [run] = await db
    .insert(syncRuns)
    .values({ jobType: "enrichment", status: "running" })
    .returning({ id: syncRuns.id });

  let releasesConsidered = 0;
  let fieldsWritten = 0;
  let summariesWritten = 0;
  let tagsAssigned = 0;
  let genresStylesAssigned = 0;
  let moodAxesScored = 0;

  try {
    const allIds = await listAllReleaseIds();

    for (const releaseId of allIds) {
      if (releasesConsidered >= limit) break;

      const needsAny =
        (await Promise.all(enrichers.map((e) => needsEnrichment(releaseId, e.source)))).some(
          Boolean,
        ) ||
        (await needsAboutSummary(releaseId)) ||
        (await needsTagsAndStyles(releaseId)) ||
        (await needsMoodAxes(releaseId));

      if (!needsAny) continue;

      let release = await getReleaseForEnrichment(releaseId);
      if (!release) continue;

      releasesConsidered++;

      for (const enricher of enrichers) {
        if (!(await needsEnrichment(releaseId, enricher.source))) continue;
        try {
          const fields = await enricher.enrich(release);
          for (const field of fields) {
            await upsertField(releaseId, enricher.source, field.fieldKey, field.fieldValue);
            fieldsWritten++;
          }
        } catch (err) {
          console.error(`[enrichment] ${enricher.source} failed for release ${releaseId}:`, err);
        }
      }

      // Runs after the raw sources above so it can synthesize from whatever
      // was just fetched (plus anything already cached from prior runs).
      if (await needsAboutSummary(releaseId)) {
        try {
          const wrote = await enrichAboutSummary(releaseId, release);
          if (wrote) summariesWritten++;
        } catch (err) {
          console.error(`[enrichment] about-summary generation failed for release ${releaseId}:`, err);
        }
      }

      // Runs after the summary so it can ground tag/style picks in it, then
      // refreshes `release` since it may have just added genres/styles.
      if (await needsTagsAndStyles(releaseId)) {
        try {
          const aboutSummary = await getAboutSummaryText(releaseId);
          const result = await enrichTagsAndStyles(releaseId, release, aboutSummary);
          tagsAssigned += result.tagsAssigned;
          genresStylesAssigned += result.genresStylesAssigned;
          if (result.genresStylesAssigned > 0) {
            release = (await getReleaseForEnrichment(releaseId)) ?? release;
          }
        } catch (err) {
          console.error(`[enrichment] tags/styles assignment failed for release ${releaseId}:`, err);
        }
      }

      // Runs last so it can factor in everything above: the synthesized
      // summary plus the (possibly just-expanded) genres/styles/tags/moods.
      if (await needsMoodAxes(releaseId)) {
        try {
          const [aboutSummary, tagsByRelease] = await Promise.all([
            getAboutSummaryText(releaseId),
            getTagsByReleaseIds([releaseId]),
          ]);
          const { tags: releaseTagLabels = [], moods: releaseMoodLabels = [] } =
            tagsByRelease.get(releaseId) ?? {};
          const wrote = await scoreMoodAxes(releaseId, {
            title: release.title,
            artist: release.artistNames.join(", "),
            year: release.year,
            genres: release.genres,
            styles: release.styles,
            tags: releaseTagLabels,
            moods: releaseMoodLabels,
            aboutSummary,
          });
          if (wrote) moodAxesScored++;
        } catch (err) {
          console.error(`[enrichment] mood-axis scoring failed for release ${releaseId}:`, err);
        }
      }
    }

    await db
      .update(syncRuns)
      .set({
        status: "success",
        finishedAt: new Date().toISOString(),
        itemsProcessed: releasesConsidered,
      })
      .where(eq(syncRuns.id, run.id));
  } catch (err) {
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date().toISOString(),
        itemsProcessed: releasesConsidered,
        errorSummary: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }

  return {
    releasesConsidered,
    fieldsWritten,
    summariesWritten,
    tagsAssigned,
    genresStylesAssigned,
    moodAxesScored,
  };
}
