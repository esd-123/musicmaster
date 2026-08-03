import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, QUERY_MODEL, SHORTLIST_MODEL } from "./client";
import { parseWithRetry } from "./parseWithRetry";
import {
  buildCollectionCatalog,
  buildShortlistPromptText,
  buildDetailCatalogPromptText,
  type CatalogEntry,
} from "./catalog";

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

const SHORTLIST_TARGET_SIZE = 30;
// Schema cap is a safety margin above the prompted target, since models
// don't always obey a soft "up to N" instruction exactly — validation
// failure here would otherwise hard-fail the request instead of just
// getting truncated.
const ShortlistSchema = z.object({
  candidate_ids: z.array(z.number()).max(60),
});

const SHORTLIST_SYSTEM_PROMPT_PREFIX = `You are narrowing down a vinyl record collection to a shortlist of candidates for a natural-language request (mood, occasion, genre, etc). This is a fast filtering pass, not the final pick — a second pass will do the detailed reasoning.

You will be given the full collection as a JSON array. Each entry has: id, artist, title, year, genres (Discogs genres/styles), tags (freeform, mostly format/structure facts like "live album", "compilation", "concept album", "instrumental", "remix"), moods (freeform vibe/mood adjectives like "hazy", "dark", "upbeat", "romantic"), rating (the owner's 1-5 rating, may be null), moodAxes (three numeric scores in [-1, 1], curated by the owner: approachability — challenging/experimental at -1 to approachable/easy-listening at +1; valence — dark/negative at -1 to bright/positive at +1; density — sparse/ambient at -1 to propulsive/frenetic at +1). There is no description text at this stage — judge fit from genres/tags/moods/moodAxes/artist/title/rating alone.

Use moodAxes when the request implies a point in this space even if it doesn't name a genre or mood word directly — e.g. "parents are over for dinner" implies roughly (approachability high, valence neutral-to-positive, density near the middle); "need something to run to" implies high density; "want to be challenged" implies low (negative) approachability. Treat genres/tags/moods and moodAxes as complementary signals, not either/or.

Return up to 30 release_id values (fewer is fine if the collection doesn't have that many plausible fits) that are plausible candidates for the request — err on the side of including a record if it might fit, since a second pass with fuller detail will do the final narrowing. Always return release_id values that exist in the provided collection.

Collection:
`;

const DETAIL_SYSTEM_PROMPT_PREFIX = `You are helping someone choose records from their own vinyl collection based on a natural-language request (mood, occasion, genre, etc).

You will be given a shortlist of candidate records as a JSON array, already narrowed down from the full collection. Each entry has: id, artist, title, year, genres (Discogs genres/styles), tags (freeform, mostly format/structure facts like "live album", "compilation", "concept album", "instrumental", "remix"), moods (freeform vibe/mood adjectives like "hazy", "dark", "upbeat", "romantic"), rating (the owner's 1-5 rating, may be null), summary (a description of the record, may be null).

Pick 8 records from this shortlist that best fit the request (fewer only if the shortlist genuinely doesn't have 8 reasonable fits — don't pad with weak matches just to hit the number). Prefer records with higher owner ratings when otherwise similar, but fit to the request matters more than rating. Always return release_id values that exist in the provided shortlist.

Shortlist:
`;

async function shortlistCandidates(
  catalog: CatalogEntry[],
  prompt: string,
  excludeIds: number[],
): Promise<number[]> {
  const catalogJson = buildShortlistPromptText(catalog, excludeIds);
  const systemPrompt = SHORTLIST_SYSTEM_PROMPT_PREFIX + catalogJson;

  const result = await parseWithRetry("shortlist", async () => {
    const message = await anthropic.messages.parse({
      model: SHORTLIST_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: zodOutputFormat(ShortlistSchema),
      },
    });
    return message.parsed_output;
  });

  return result.candidate_ids.slice(0, SHORTLIST_TARGET_SIZE);
}

/**
 * Two-stage query: a cheap first pass (no prose, whole collection) narrows
 * to a shortlist, then a detailed pass (full about_summary text, shortlist
 * only) does the actual picking and reasoning. Keeps the expensive part of
 * the prompt — description text — small regardless of collection size.
 *
 * The collection catalog is fetched from the DB exactly once (both stages
 * read from the same in-memory `catalog`) rather than each stage querying
 * it separately — the two stages only need different *views* of the same
 * data, not different data.
 *
 * `excludeIds` are dropped before the shortlist pass so they structurally
 * can't come back — used for "retry" (same prompt, excluding what's already
 * shown) and "more like this" (an augmented prompt, same exclusion).
 */
export async function queryCollection(
  prompt: string,
  excludeIds: number[] = [],
): Promise<QueryResult> {
  const catalog = await buildCollectionCatalog();

  const candidateIds = await shortlistCandidates(catalog, prompt, excludeIds);
  if (candidateIds.length === 0) {
    return { picks: [], overall_reasoning: "No further records in the collection matched this request." };
  }

  const detailCatalogJson = buildDetailCatalogPromptText(catalog, candidateIds);
  const systemPrompt = DETAIL_SYSTEM_PROMPT_PREFIX + detailCatalogJson;

  const result = await parseWithRetry("detail", async () => {
    const message = await anthropic.messages.parse({
      model: QUERY_MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: systemPrompt }],
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: zodOutputFormat(PicksSchema),
        effort: "medium",
      },
    });
    return message.parsed_output;
  });

  // Defense in depth — the shortlist pass already excludes these, but make
  // sure a re-suggested id never slips through to the response.
  const excludeSet = new Set(excludeIds);
  return { ...result, picks: result.picks.filter((p) => !excludeSet.has(p.release_id)) };
}
