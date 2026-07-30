import { buildCollectionCatalog, type CatalogEntry } from "@/lib/llm/catalog";

const SAME_ARTIST_BOOST = 0.25;
const MIN_SCORE = 0.001;

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

export interface Recommendation {
  id: number;
  score: number;
}

/**
 * Collection-internal similarity: Jaccard overlap across combined
 * genre/style + user tags/moods, with a same-artist boost. Deterministic,
 * free, no LLM call — the v1 default for "if you like this, you may also
 * like".
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
      let score = jaccard(targetSet, tagSet(c));
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
