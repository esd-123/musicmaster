import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { releaseMoodAxes, enrichmentCache } from "@/db/schema";
import { anthropic, SHORTLIST_MODEL } from "@/lib/llm/client";
import { parseWithRetry } from "@/lib/llm/parseWithRetry";

const AxesSchema = z.object({
  approachability: z.number().min(-1).max(1),
  valence: z.number().min(-1).max(1),
  density: z.number().min(-1).max(1),
});

export interface MoodAxesInput {
  title: string;
  artist: string;
  year: number | null;
  genres: string[];
  styles: string[];
  tags: string[];
  moods: string[];
  aboutSummary: string | null;
}

const PROMPT_PREFIX = `Score this record on three continuous axes, each a float from -1 to 1:

- approachability: -1 = challenging/experimental, +1 = approachable/easy-listening
- valence: -1 = dark, +1 = bright
- density: -1 = sparse/ambient, +1 = propulsive/frenetic

Base the scores on the genres, styles, tags, moods, and summary below. If information is sparse, use your best judgment from the genre/style alone rather than defaulting to 0.

`;

function buildFacts(input: MoodAxesInput): string {
  return [
    `Title: ${input.title}`,
    `Artist: ${input.artist}`,
    input.year ? `Year: ${input.year}` : null,
    input.genres.length ? `Genres: ${input.genres.join(", ")}` : null,
    input.styles.length ? `Styles: ${input.styles.join(", ")}` : null,
    input.tags.length ? `Tags: ${input.tags.join(", ")}` : null,
    input.moods.length ? `Moods: ${input.moods.join(", ")}` : null,
    input.aboutSummary ? `Summary: ${input.aboutSummary}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join("\n");
}

/** A release's mood axes are never re-backfilled once a row exists — same
 * source-of-truth-after-first-write posture as the original hand-authored
 * mapping backfill, just scored per-release via direct LLM judgment now
 * instead of averaging a static label->axis table. Also stops once a scoring
 * attempt has permanently given up (see scoreMoodAxes) — this is a metered
 * call, so an unresolved failure must not mean "retry every night forever." */
export async function needsMoodAxes(releaseId: number): Promise<boolean> {
  const [axesRow, gaveUp] = await Promise.all([
    db.query.releaseMoodAxes.findFirst({ where: eq(releaseMoodAxes.releaseId, releaseId) }),
    db.query.enrichmentCache.findFirst({
      where: and(
        eq(enrichmentCache.releaseId, releaseId),
        eq(enrichmentCache.source, "claude"),
        eq(enrichmentCache.fieldKey, "mood_axes_gave_up"),
      ),
    }),
  ]);
  return !axesRow && !gaveUp;
}

export async function scoreMoodAxes(releaseId: number, input: MoodAxesInput): Promise<boolean> {
  // parseWithRetry already retries once internally; if it still fails, give
  // up permanently (see needsMoodAxes) rather than re-paying for this call
  // every night forever.
  let result: z.infer<typeof AxesSchema>;
  try {
    result = await parseWithRetry("mood-axes", async () => {
      const message = await anthropic.messages.parse({
        model: SHORTLIST_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: PROMPT_PREFIX + buildFacts(input) }],
        output_config: { format: zodOutputFormat(AxesSchema) },
      });
      return message.parsed_output;
    });
  } catch (err) {
    console.error(`[enrichment] mood-axis scoring gave up for release ${releaseId} after retrying:`, err);
    await db.insert(enrichmentCache).values({
      releaseId,
      source: "claude",
      fieldKey: "mood_axes_gave_up",
      fieldValue: "true",
    });
    return false;
  }

  await db.insert(releaseMoodAxes).values({
    releaseId,
    approachability: result.approachability,
    valence: result.valence,
    density: result.density,
    autoApproachability: result.approachability,
    autoValence: result.valence,
    autoDensity: result.density,
  });
  return true;
}
