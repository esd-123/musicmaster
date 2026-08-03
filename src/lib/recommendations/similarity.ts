import { buildCollectionCatalog, type CatalogEntry } from "@/lib/llm/catalog";

const SAME_ARTIST_BOOST = 0.25;
const MIN_SCORE = 0.001;

// Weights for combining tag-overlap and mood-axis proximity into one score.
// Tag overlap stays primary (genre/style/tag/mood matches are strong,
// specific signals); axis proximity is a secondary nudge that catches
// "similar vibe, different vocabulary" cases Jaccard misses entirely.
const TAG_WEIGHT = 0.7;
const AXIS_WEIGHT = 0.3;
// Max possible Euclidean distance across 3 axes each spanning [-1, 1].
const MAX_AXIS_DISTANCE = Math.sqrt(3 * 2 ** 2);

function tagSet(entry: CatalogEntry): Set<string> {
  return new Set([...entry.genres, ...entry.tags, ...entry.moods].map((s) => s.toLowerCase()));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 1 = identical position in mood-axis space, 0 = maximally far apart. */
function axisSimilarity(a: CatalogEntry, b: CatalogEntry): number {
  const dx = a.moodAxes.approachability - b.moodAxes.approachability;
  const dy = a.moodAxes.valence - b.moodAxes.valence;
  const dz = a.moodAxes.density - b.moodAxes.density;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return 1 - distance / MAX_AXIS_DISTANCE;
}

export interface Recommendation {
  id: number;
  score: number;
}

/**
 * Collection-internal similarity: Jaccard overlap across combined
 * genre/style + user tags/moods, blended with proximity in the 3-axis mood
 * space (approachability/valence/density), plus a same-artist boost. Deterministic,
 * free, no LLM call. The axis term catches "same vibe, different vocabulary"
 * pairs pure tag overlap misses (e.g. two releases tagged with synonyms
 * rather than the same word).
 */
export async function getRecommendations(
  releaseId: number,
  limit = 6,
): Promise<Recommendation[]> {
  const catalog = await buildCollectionCatalog();
  const target = catalog.find((c) => c.id === releaseId);
  if (!target) return [];

  const targetSet = tagSet(target);
  const targetArtist = target.artist.trim().toLowerCase();

  const scored = catalog
    .filter((c) => c.id !== releaseId)
    .map((c) => {
      let score =
        jaccard(targetSet, tagSet(c)) * TAG_WEIGHT + axisSimilarity(target, c) * AXIS_WEIGHT;
      if (targetArtist && c.artist.trim().toLowerCase() === targetArtist) {
        score += SAME_ARTIST_BOOST;
      }
      return { id: c.id, score };
    })
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}
