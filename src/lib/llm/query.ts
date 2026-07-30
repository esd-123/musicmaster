import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, QUERY_MODEL } from "./client";
import { buildCatalogPromptText } from "./catalog";

const PicksSchema = z.object({
  picks: z
    .array(
      z.object({
        release_id: z.number(),
        reasoning: z.string(),
      }),
    )
    .max(8),
  overall_reasoning: z.string(),
});

export type QueryResult = z.infer<typeof PicksSchema>;

const SYSTEM_PROMPT_PREFIX = `You are helping someone choose records from their own vinyl collection based on a natural-language request (mood, occasion, genre, tempo, etc).

You will be given the full collection as a JSON array. Each entry has: id, artist, title, year, genres (Discogs genres/styles), tags (freeform user tags), moods (user-assigned moods), bpm (tempo, may be null if unknown), rating (the owner's 1-5 rating, may be null), summary (a short blurb, may be null).

Pick 2-5 records that best fit the request. Prefer records with higher owner ratings when otherwise similar, but fit to the request matters more than rating. If bpm is null for a good candidate, that's fine — don't exclude it just for missing data. Always return release_id values that exist in the provided collection.

Collection:
`;

/**
 * Calls Claude once with a structured-output schema; retries once on a
 * malformed/empty response (refusal, truncation, invalid JSON) before
 * surfacing an error.
 */
export async function queryCollection(prompt: string): Promise<QueryResult> {
  const catalogJson = await buildCatalogPromptText();

  const systemPrompt = SYSTEM_PROMPT_PREFIX + catalogJson;

  const attempt = async () => {
    const message = await anthropic.messages.parse({
      model: QUERY_MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: zodOutputFormat(PicksSchema),
        effort: "medium",
      },
    });
    return message.parsed_output;
  };

  let result = await attempt();
  if (!result) {
    console.warn("[query] first attempt returned no parsed_output, retrying once");
    result = await attempt();
  }
  if (!result) {
    throw new Error("Claude did not return a parseable response after retrying");
  }
  return result;
}
