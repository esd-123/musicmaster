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
  bpm as bpmTable,
  userReleaseData,
  enrichmentCache,
} from "@/db/schema";

export interface CatalogEntry {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  genres: string[];
  tags: string[];
  moods: string[];
  bpm: number | null;
  rating: number | null;
  summary: string | null;
}

const SUMMARY_MAX_LENGTH = 220;

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

  const bpmRows = await db.select({ releaseId: bpmTable.releaseId, bpm: bpmTable.bpm }).from(bpmTable);

  const ratingRows = await db
    .select({ releaseId: userReleaseData.releaseId, rating: userReleaseData.rating })
    .from(userReleaseData);

  const summaryRows = await db
    .select({
      releaseId: enrichmentCache.releaseId,
      fieldKey: enrichmentCache.fieldKey,
      fieldValue: enrichmentCache.fieldValue,
    })
    .from(enrichmentCache)
    .where(inArray(enrichmentCache.fieldKey, ["wikipedia_summary", "lastfm_summary"]));

  const artistsByRelease = new Map(artistRows.map((r) => [r.releaseId, r.names]));
  const genresByRelease = new Map(genreRows.map((r) => [r.releaseId, r.names]));
  const bpmByRelease = new Map(bpmRows.map((r) => [r.releaseId, r.bpm]));
  const ratingByRelease = new Map(ratingRows.map((r) => [r.releaseId, r.rating]));

  const tagsByRelease = new Map<number, string[]>();
  const moodsByRelease = new Map<number, string[]>();
  for (const row of tagRows) {
    const target = row.kind === "mood" ? moodsByRelease : tagsByRelease;
    target.set(row.releaseId, row.names.split(", "));
  }

  const summaryByRelease = new Map<number, string>();
  for (const row of summaryRows) {
    // Prefer Wikipedia; only fall back to Last.fm if no Wikipedia summary exists.
    if (row.fieldKey === "wikipedia_summary" || !summaryByRelease.has(row.releaseId)) {
      summaryByRelease.set(row.releaseId, row.fieldValue);
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
      bpm: bpmByRelease.get(r.id) ?? null,
      rating: ratingByRelease.get(r.id) ?? null,
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
