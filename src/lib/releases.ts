import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  releases,
  releaseArtists,
  artists,
  releaseGenresStyles,
  genresStyles,
  releaseTracks,
  userReleaseData,
  releaseTags,
  tags,
  playEvents,
  enrichmentCache,
  releaseMoodAxes,
} from "@/db/schema";

export interface ReleaseSummary {
  id: number;
  title: string;
  year: number | null;
  label: string | null;
  coverImageUrl: string | null;
  artistNames: string[];
  genres: string[];
  styles: string[];
}

/**
 * Batches artist/genre/style lookups across all of `releaseRows` into 2
 * queries total (via `inArray`), not 2 per release — this join previously
 * ran once per release, which meant e.g. `listReleases()` loading the whole
 * collection issued ~2x the collection size in DB round-trips on every
 * homepage load.
 */
async function attachGenresAndArtists(
  releaseRows: (typeof releases.$inferSelect)[],
): Promise<ReleaseSummary[]> {
  if (releaseRows.length === 0) return [];
  const ids = releaseRows.map((r) => r.id);

  const artistRows = await db
    .select({ releaseId: releaseArtists.releaseId, name: artists.name })
    .from(releaseArtists)
    .innerJoin(artists, eq(releaseArtists.artistId, artists.id))
    .where(inArray(releaseArtists.releaseId, ids))
    .orderBy(releaseArtists.releaseId, releaseArtists.position);

  const genreStyleRows = await db
    .select({
      releaseId: releaseGenresStyles.releaseId,
      name: genresStyles.name,
      kind: genresStyles.kind,
    })
    .from(releaseGenresStyles)
    .innerJoin(genresStyles, eq(releaseGenresStyles.genreStyleId, genresStyles.id))
    .where(inArray(releaseGenresStyles.releaseId, ids));

  const artistsByRelease = new Map<number, string[]>();
  for (const row of artistRows) {
    if (!artistsByRelease.has(row.releaseId)) artistsByRelease.set(row.releaseId, []);
    artistsByRelease.get(row.releaseId)!.push(row.name);
  }

  const genresByRelease = new Map<number, string[]>();
  const stylesByRelease = new Map<number, string[]>();
  for (const row of genreStyleRows) {
    const target = row.kind === "genre" ? genresByRelease : stylesByRelease;
    if (!target.has(row.releaseId)) target.set(row.releaseId, []);
    target.get(row.releaseId)!.push(row.name);
  }

  return releaseRows.map((r) => ({
    id: r.id,
    title: r.title,
    year: r.year,
    label: r.label,
    coverImageUrl: r.coverImageUrl,
    artistNames: artistsByRelease.get(r.id) ?? [],
    genres: genresByRelease.get(r.id) ?? [],
    styles: stylesByRelease.get(r.id) ?? [],
  }));
}

export type ReleaseSortKey = "recent" | "artist" | "genre" | "label" | "year";

export interface ListReleasesOptions {
  genre?: string;
  year?: number;
  decade?: number;
  sortBy?: ReleaseSortKey;
  artistQuery?: string;
}

function primaryGenre(r: ReleaseSummary): string {
  return r.genres[0] ?? r.styles[0] ?? "";
}

function sortReleases(summaries: ReleaseSummary[], sortBy: ReleaseSortKey): ReleaseSummary[] {
  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const sorted = [...summaries];
  switch (sortBy) {
    case "artist":
      sorted.sort((a, b) => collator.compare(a.artistNames[0] ?? "", b.artistNames[0] ?? ""));
      break;
    case "genre":
      sorted.sort((a, b) => collator.compare(primaryGenre(a), primaryGenre(b)));
      break;
    case "label":
      sorted.sort((a, b) => collator.compare(a.label ?? "", b.label ?? ""));
      break;
    case "year":
      sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      break;
    case "recent":
    default:
      break; // already in dateAdded-desc order from the query
  }
  return sorted;
}

export async function listReleases(options: ListReleasesOptions = {}): Promise<ReleaseSummary[]> {
  const { genre, year, decade, sortBy = "recent", artistQuery } = options;

  const allReleases = await db.query.releases.findMany({
    orderBy: (r, { desc }) => [desc(r.dateAdded)],
  });
  let summaries = await attachGenresAndArtists(allReleases);

  if (genre) {
    summaries = summaries.filter((r) => r.genres.includes(genre) || r.styles.includes(genre));
  }
  if (year) {
    summaries = summaries.filter((r) => r.year === year);
  }
  if (decade) {
    summaries = summaries.filter((r) => r.year !== null && Math.floor(r.year / 10) * 10 === decade);
  }
  if (artistQuery) {
    const q = artistQuery.trim().toLowerCase();
    summaries = summaries.filter((r) => r.artistNames.some((a) => a.toLowerCase().includes(q)));
  }

  return sortReleases(summaries, sortBy);
}

export async function getReleasesByIds(ids: number[]): Promise<ReleaseSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(releases).where(inArray(releases.id, ids));
  const summaries = await attachGenresAndArtists(rows);
  const byId = new Map(summaries.map((r) => [r.id, r]));
  // Preserve the caller's order (e.g. recommendation ranking) rather than DB order.
  return ids.map((id) => byId.get(id)).filter((r): r is ReleaseSummary => r !== undefined);
}

/** Mood/tag labels (user-curated) for a set of releases, keyed by release id. */
export async function getTagsByReleaseIds(
  ids: number[],
): Promise<Map<number, { tags: string[]; moods: string[] }>> {
  const result = new Map<number, { tags: string[]; moods: string[] }>();
  if (ids.length === 0) return result;

  const rows = await db
    .select({ releaseId: releaseTags.releaseId, label: tags.label, kind: tags.kind })
    .from(releaseTags)
    .innerJoin(tags, eq(releaseTags.tagId, tags.id))
    .where(inArray(releaseTags.releaseId, ids));

  for (const row of rows) {
    const entry = result.get(row.releaseId) ?? { tags: [], moods: [] };
    if (row.kind === "mood") entry.moods.push(row.label);
    else entry.tags.push(row.label);
    result.set(row.releaseId, entry);
  }
  return result;
}

export async function getReleaseForEnrichment(releaseId: number) {
  const release = await db.query.releases.findFirst({ where: eq(releases.id, releaseId) });
  if (!release) return null;
  const [summary] = await attachGenresAndArtists([release]);
  const tracks = await db
    .select({ title: releaseTracks.title })
    .from(releaseTracks)
    .where(eq(releaseTracks.releaseId, releaseId))
    .orderBy(releaseTracks.sortOrder);
  return {
    id: release.id,
    title: release.title,
    year: release.year,
    artistNames: summary.artistNames,
    genres: summary.genres,
    styles: summary.styles,
    discogsNotes: release.discogsNotes,
    discogsCommunityRating: release.discogsCommunityRating,
    discogsCommunityRatingCount: release.discogsCommunityRatingCount,
    tracks,
  };
}

export async function listAllReleaseIds(): Promise<number[]> {
  const rows = await db.select({ id: releases.id }).from(releases).orderBy(releases.id);
  return rows.map((r) => r.id);
}

export interface MoodCubeEntryData {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  genres: string[];
  styles: string[];
  moodAxes: { approachability: number; valence: number; density: number };
}

/** Full-collection feed shared by the mood cube and mood editor — genres and
 * styles kept separate (kind-split, via `attachGenresAndArtists`) rather than
 * the flat mixed array `buildCollectionCatalog()` uses, since both pages
 * color/filter by genre and style independently. */
export async function listMoodCubeEntries(): Promise<MoodCubeEntryData[]> {
  const allReleases = await db.select().from(releases).orderBy(releases.id);
  const summaries = await attachGenresAndArtists(allReleases);

  const moodAxesRows = await db
    .select({
      releaseId: releaseMoodAxes.releaseId,
      approachability: releaseMoodAxes.approachability,
      valence: releaseMoodAxes.valence,
      density: releaseMoodAxes.density,
    })
    .from(releaseMoodAxes);
  const moodAxesByRelease = new Map(
    moodAxesRows.map((r) => [
      r.releaseId,
      { approachability: r.approachability, valence: r.valence, density: r.density },
    ]),
  );

  return summaries.map((s) => ({
    id: s.id,
    artist: s.artistNames.join(", "),
    title: s.title,
    year: s.year,
    genres: s.genres,
    styles: s.styles,
    moodAxes: moodAxesByRelease.get(s.id) ?? { approachability: 0, valence: 0, density: 0 },
  }));
}

/** Distinct artist names across the collection, for the artist-search
 * autocomplete on the collection and mood editor pages. */
export async function listAllArtistNames(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ name: artists.name })
    .from(artists)
    .orderBy(artists.name);
  return rows.map((r) => r.name);
}

export interface GenreGroup {
  genre: string;
  styles: string[];
}

/**
 * Groups every style under its one genre. `parentGenreId` is the
 * authoritative, mandatory classification (enforced by the
 * `genres_styles_parent_kind_check` DB constraint — every style has exactly
 * one genre, every genre has none), not a display guess, so this is a direct
 * grouping rather than an inference over release co-occurrence.
 */
export async function listGenreHierarchy(): Promise<GenreGroup[]> {
  const allGenresStyles = await db
    .select({
      id: genresStyles.id,
      name: genresStyles.name,
      kind: genresStyles.kind,
      parentGenreId: genresStyles.parentGenreId,
    })
    .from(genresStyles);

  const genreRows = allGenresStyles.filter((g) => g.kind === "genre");
  const stylesByGenreId = new Map<number, string[]>();
  for (const g of genreRows) stylesByGenreId.set(g.id, []);

  for (const s of allGenresStyles) {
    if (s.kind !== "style" || s.parentGenreId === null) continue;
    stylesByGenreId.get(s.parentGenreId)?.push(s.name);
  }

  return genreRows
    .map((g) => ({ genre: g.name, styles: (stylesByGenreId.get(g.id) ?? []).sort() }))
    .sort((a, b) => a.genre.localeCompare(b.genre));
}

export interface GenreStyleUsage {
  id: number;
  name: string;
  kind: "genre" | "style";
  releaseCount: number;
  description: string | null;
  parentGenreId: number | null;
}

/** All genres/styles with how many releases carry each, least-used first —
 * for the genre editor's merge/collapse tool, where niche ones are the ones
 * worth collapsing into broader genres. */
export async function listGenreStyleUsage(): Promise<GenreStyleUsage[]> {
  const rows = await db
    .select({
      id: genresStyles.id,
      name: genresStyles.name,
      kind: genresStyles.kind,
      description: genresStyles.description,
      parentGenreId: genresStyles.parentGenreId,
      releaseCount: sql<number>`count(${releaseGenresStyles.releaseId})`,
    })
    .from(genresStyles)
    .leftJoin(releaseGenresStyles, eq(releaseGenresStyles.genreStyleId, genresStyles.id))
    .groupBy(genresStyles.id)
    .orderBy(sql`count(${releaseGenresStyles.releaseId}) asc`, genresStyles.name);
  return rows;
}

export interface GenreEditorLink {
  id: number;
  name: string;
  kind: "genre" | "style";
}

export interface GenreEditorRelease {
  id: number;
  title: string;
  year: number | null;
  coverImageUrl: string | null;
  artistNames: string[];
  genreStyleLinks: GenreEditorLink[];
}

/** Whole collection with every genre/style link's own id (not just its name)
 * so the genre editor can target individual links for removal, and tell
 * apart same-named links across kinds. Batched (2 queries total), same
 * pattern as `attachGenresAndArtists`. */
export async function listReleasesForGenreEditor(): Promise<GenreEditorRelease[]> {
  const allReleases = await db
    .select({
      id: releases.id,
      title: releases.title,
      year: releases.year,
      coverImageUrl: releases.coverImageUrl,
    })
    .from(releases)
    .orderBy(releases.id);
  if (allReleases.length === 0) return [];
  const ids = allReleases.map((r) => r.id);

  const artistRows = await db
    .select({ releaseId: releaseArtists.releaseId, name: artists.name })
    .from(releaseArtists)
    .innerJoin(artists, eq(releaseArtists.artistId, artists.id))
    .where(inArray(releaseArtists.releaseId, ids))
    .orderBy(releaseArtists.releaseId, releaseArtists.position);

  const linkRows = await db
    .select({
      releaseId: releaseGenresStyles.releaseId,
      id: genresStyles.id,
      name: genresStyles.name,
      kind: genresStyles.kind,
    })
    .from(releaseGenresStyles)
    .innerJoin(genresStyles, eq(releaseGenresStyles.genreStyleId, genresStyles.id))
    .where(inArray(releaseGenresStyles.releaseId, ids));

  const artistsByRelease = new Map<number, string[]>();
  for (const row of artistRows) {
    if (!artistsByRelease.has(row.releaseId)) artistsByRelease.set(row.releaseId, []);
    artistsByRelease.get(row.releaseId)!.push(row.name);
  }

  const linksByRelease = new Map<number, GenreEditorLink[]>();
  for (const row of linkRows) {
    if (!linksByRelease.has(row.releaseId)) linksByRelease.set(row.releaseId, []);
    linksByRelease.get(row.releaseId)!.push({ id: row.id, name: row.name, kind: row.kind });
  }

  return allReleases.map((r) => ({
    id: r.id,
    title: r.title,
    year: r.year,
    coverImageUrl: r.coverImageUrl,
    artistNames: artistsByRelease.get(r.id) ?? [],
    genreStyleLinks: (linksByRelease.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export async function listAvailableDecades(): Promise<number[]> {
  const rows = await db.select({ year: releases.year }).from(releases);
  const decades = new Set(
    rows.filter((r) => r.year !== null).map((r) => Math.floor(r.year! / 10) * 10),
  );
  return [...decades].sort((a, b) => b - a);
}

export async function listAvailableYears(): Promise<number[]> {
  const rows = await db.select({ year: releases.year }).from(releases);
  const years = new Set(rows.filter((r) => r.year !== null).map((r) => r.year!));
  return [...years].sort((a, b) => b - a);
}

export async function getReleaseDetail(id: number) {
  const release = await db.query.releases.findFirst({ where: eq(releases.id, id) });
  if (!release) return null;

  const [summary] = await attachGenresAndArtists([release]);

  const tracks = await db
    .select()
    .from(releaseTracks)
    .where(eq(releaseTracks.releaseId, id))
    .orderBy(releaseTracks.sortOrder);

  const userData = await db.query.userReleaseData.findFirst({
    where: eq(userReleaseData.releaseId, id),
  });

  const tagRows = await db
    .select({ id: tags.id, label: tags.label, kind: tags.kind })
    .from(releaseTags)
    .innerJoin(tags, eq(releaseTags.tagId, tags.id))
    .where(eq(releaseTags.releaseId, id));

  const genreStyleRows = await db
    .select({ id: genresStyles.id, name: genresStyles.name, kind: genresStyles.kind })
    .from(releaseGenresStyles)
    .innerJoin(genresStyles, eq(releaseGenresStyles.genreStyleId, genresStyles.id))
    .where(eq(releaseGenresStyles.releaseId, id));

  const plays = await db
    .select()
    .from(playEvents)
    .where(eq(playEvents.releaseId, id))
    .orderBy(playEvents.playedAt);

  const enrichmentRows = await db
    .select()
    .from(enrichmentCache)
    .where(eq(enrichmentCache.releaseId, id));

  return {
    ...release,
    ...summary,
    tracks,
    userData: userData ?? null,
    tags: tagRows,
    genreStyleTags: genreStyleRows,
    plays: plays.reverse(), // newest first
    enrichment: enrichmentRows,
  };
}
