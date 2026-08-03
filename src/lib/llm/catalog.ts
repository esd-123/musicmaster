import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  releases,
  releaseArtists,
  artists,
  releaseGenresStyles,
  genresStyles,
  releaseTags,
  tags,
  userReleaseData,
  enrichmentCache,
  releaseMoodAxes,
} from "@/db/schema";

export interface MoodAxes {
  approachability: number;
  valence: number;
  density: number;
}

export interface CatalogEntry {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  genres: string[];
  tags: string[];
  moods: string[];
  rating: number | null;
  summary: string | null;
  moodAxes: MoodAxes;
}

/** Full about_summary text can run past 3000 chars; this caps it for the
 * detail-pass prompt (only ~20-30 records at a time), not the shortlist pass. */
const SUMMARY_MAX_LENGTH = 800;

/**
 * Builds a compact representation of the whole collection for the LLM to
 * reason over. Uses grouped aggregate queries (not one query per release)
 * so this stays fast even at hundreds/low-thousands of records.
 */
export async function buildCollectionCatalog(): Promise<CatalogEntry[]> {
  const baseReleases = await db
    .select({ id: releases.id, title: releases.title, year: releases.year })
    .from(releases)
    .orderBy(releases.id);

  const artistRows = await db
    .select({
      releaseId: releaseArtists.releaseId,
      names: sql<string>`group_concat(${artists.name}, ', ')`,
    })
    .from(releaseArtists)
    .innerJoin(artists, eq(releaseArtists.artistId, artists.id))
    .groupBy(releaseArtists.releaseId);

  const genreRows = await db
    .select({
      releaseId: releaseGenresStyles.releaseId,
      names: sql<string>`group_concat(${genresStyles.name}, ', ')`,
    })
    .from(releaseGenresStyles)
    .innerJoin(genresStyles, eq(releaseGenresStyles.genreStyleId, genresStyles.id))
    .groupBy(releaseGenresStyles.releaseId);

  const tagRows = await db
    .select({
      releaseId: releaseTags.releaseId,
      kind: tags.kind,
      names: sql<string>`group_concat(${tags.label}, ', ')`,
    })
    .from(releaseTags)
    .innerJoin(tags, eq(releaseTags.tagId, tags.id))
    .groupBy(releaseTags.releaseId, tags.kind);

  const ratingRows = await db
    .select({ releaseId: userReleaseData.releaseId, rating: userReleaseData.rating })
    .from(userReleaseData);

  const moodAxesRows = await db
    .select({
      releaseId: releaseMoodAxes.releaseId,
      approachability: releaseMoodAxes.approachability,
      valence: releaseMoodAxes.valence,
      density: releaseMoodAxes.density,
    })
    .from(releaseMoodAxes);

  const summaryRows = await db
    .select({
      releaseId: enrichmentCache.releaseId,
      fieldKey: enrichmentCache.fieldKey,
      fieldValue: enrichmentCache.fieldValue,
    })
    .from(enrichmentCache)
    .where(
      inArray(enrichmentCache.fieldKey, ["about_summary", "wikipedia_summary", "lastfm_summary"]),
    );

  const artistsByRelease = new Map(artistRows.map((r) => [r.releaseId, r.names]));
  const genresByRelease = new Map(genreRows.map((r) => [r.releaseId, r.names]));
  const ratingByRelease = new Map(ratingRows.map((r) => [r.releaseId, r.rating]));
  const moodAxesByRelease = new Map(
    moodAxesRows.map((r) => [
      r.releaseId,
      { approachability: r.approachability, valence: r.valence, density: r.density },
    ]),
  );

  const tagsByRelease = new Map<number, string[]>();
  const moodsByRelease = new Map<number, string[]>();
  for (const row of tagRows) {
    const target = row.kind === "mood" ? moodsByRelease : tagsByRelease;
    target.set(row.releaseId, row.names.split(", "));
  }

  // Prefer the AI-generated "About This Record" summary (source of truth for
  // tone/content); fall back to raw Wikipedia/Last.fm text only if a release
  // has no about_summary yet.
  const SUMMARY_SOURCE_PRIORITY = ["about_summary", "wikipedia_summary", "lastfm_summary"];
  const summaryByRelease = new Map<number, string>();
  const summarySourceRank = new Map<number, number>();
  for (const row of summaryRows) {
    const rank = SUMMARY_SOURCE_PRIORITY.indexOf(row.fieldKey);
    const currentRank = summarySourceRank.get(row.releaseId);
    if (currentRank === undefined || rank < currentRank) {
      summaryByRelease.set(row.releaseId, row.fieldValue);
      summarySourceRank.set(row.releaseId, rank);
    }
  }

  return baseReleases.map((r) => {
    const genreNames = genresByRelease.get(r.id);
    const summary = summaryByRelease.get(r.id);
    return {
      id: r.id,
      artist: artistsByRelease.get(r.id) ?? "",
      title: r.title,
      year: r.year,
      genres: genreNames ? genreNames.split(", ") : [],
      tags: tagsByRelease.get(r.id) ?? [],
      moods: moodsByRelease.get(r.id) ?? [],
      rating: ratingByRelease.get(r.id) ?? null,
      moodAxes: moodAxesByRelease.get(r.id) ?? { approachability: 0, valence: 0, density: 0 },
      summary: summary
        ? summary.length > SUMMARY_MAX_LENGTH
          ? summary.slice(0, SUMMARY_MAX_LENGTH) + "…"
          : summary
        : null,
    };
  });
}

/** Compact (not pretty-printed) JSON — this goes straight into the prompt. */
export async function buildCatalogPromptText(): Promise<string> {
  const catalog = await buildCollectionCatalog();
  return JSON.stringify(catalog);
}

export type ShortlistEntry = Omit<CatalogEntry, "summary">;

/**
 * Stripped-down catalog (no prose) covering the whole collection, for the
 * cheap first-pass shortlist query. Structured data (genres/tags/moods/
 * rating) is kept in full — only the summary text, the expensive part, is
 * dropped.
 *
 * `excludeIds` are dropped from the catalog entirely (not just filtered from
 * the result) so the shortlist model structurally can't re-suggest them —
 * used for "retry" / "more like this" so a fresh set of records comes back.
 *
 * Takes an already-fetched `catalog` rather than calling
 * `buildCollectionCatalog()` itself, so a caller doing both a shortlist and
 * a detail pass in the same request (see `queryCollection`) can fetch the
 * whole collection from the DB once and reuse it for both.
 */
export function buildShortlistPromptText(
  catalog: CatalogEntry[],
  excludeIds: number[] = [],
): string {
  const excludeSet = new Set(excludeIds);
  const shortlist: ShortlistEntry[] = catalog
    .filter((entry) => !excludeSet.has(entry.id))
    .map(({ id, artist, title, year, genres, tags, moods, rating, moodAxes }) => ({
      id,
      artist,
      title,
      year,
      genres,
      tags,
      moods,
      rating,
      moodAxes,
    }));
  return JSON.stringify(shortlist);
}

/**
 * Full catalog entries (including summary text) restricted to a specific
 * set of release ids, for the second-pass detailed query over a shortlist.
 * Takes an already-fetched `catalog` — see `buildShortlistPromptText`.
 */
export function buildDetailCatalogPromptText(catalog: CatalogEntry[], ids: number[]): string {
  const idSet = new Set(ids);
  const detail = catalog.filter((entry) => idSet.has(entry.id));
  return JSON.stringify(detail);
}
