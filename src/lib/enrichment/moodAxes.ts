import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { releaseMoodAxes } from "@/db/schema";
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
 * instead of averaging a static label->axis table. */
export async function needsMoodAxes(releaseId: number): Promise<boolean> {
  const existing = await db.query.releaseMoodAxes.findFirst({
    where: eq(releaseMoodAxes.releaseId, releaseId),
  });
  return !existing;
}

export async function scoreMoodAxes(releaseId: number, input: MoodAxesInput): Promise<boolean> {
  const result = await parseWithRetry("mood-axes", async () => {
    const message = await anthropic.messages.parse({
      model: SHORTLIST_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: PROMPT_PREFIX + buildFacts(input) }],
      output_config: { format: zodOutputFormat(AxesSchema) },
    });
    return message.parsed_output;
  });

  await db.insert(releaseMoodAxes).values({
    releaseId,
    approachability: result.approachability,
    valence: result.valence,
    density: result.density,
  });
  return true;
}
