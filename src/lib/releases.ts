import { eq, inArray } from "drizzle-orm";
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
  bpm as bpmTable,
  playEvents,
  enrichmentCache,
} from "@/db/schema";

export interface ReleaseSummary {
  id: number;
  title: string;
  year: number | null;
  coverImageUrl: string | null;
  artistNames: string[];
  genres: string[];
  styles: string[];
}

async function attachGenresAndArtists(releaseRows: (typeof releases.$inferSelect)[]) {
  const summaries: ReleaseSummary[] = [];
  for (const r of releaseRows) {
    const artistRows = await db
      .select({ name: artists.name })
      .from(releaseArtists)
      .innerJoin(artists, eq(releaseArtists.artistId, artists.id))
      .where(eq(releaseArtists.releaseId, r.id))
      .orderBy(releaseArtists.position);

    const genreStyleRows = await db
      .select({ name: genresStyles.name, kind: genresStyles.kind })
      .from(releaseGenresStyles)
      .innerJoin(genresStyles, eq(releaseGenresStyles.genreStyleId, genresStyles.id))
      .where(eq(releaseGenresStyles.releaseId, r.id));

    summaries.push({
      id: r.id,
      title: r.title,
      year: r.year,
      coverImageUrl: r.coverImageUrl,
      artistNames: artistRows.map((a) => a.name),
      genres: genreStyleRows.filter((g) => g.kind === "genre").map((g) => g.name),
      styles: genreStyleRows.filter((g) => g.kind === "style").map((g) => g.name),
    });
  }
  return summaries;
}

export async function listReleases(genreFilter?: string): Promise<ReleaseSummary[]> {
  const allReleases = await db.query.releases.findMany({
    orderBy: (r, { desc }) => [desc(r.dateAdded)],
  });
  const summaries = await attachGenresAndArtists(allReleases);
  if (!genreFilter) return summaries;
  return summaries.filter(
    (r) => r.genres.includes(genreFilter) || r.styles.includes(genreFilter),
  );
}

export async function getReleasesByIds(ids: number[]): Promise<ReleaseSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(releases).where(inArray(releases.id, ids));
  const summaries = await attachGenresAndArtists(rows);
  const byId = new Map(summaries.map((r) => [r.id, r]));
  // Preserve the caller's order (e.g. recommendation ranking) rather than DB order.
  return ids.map((id) => byId.get(id)).filter((r): r is ReleaseSummary => r !== undefined);
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
  return { id: release.id, title: release.title, artistNames: summary.artistNames, tracks };
}

export async function listAllReleaseIds(): Promise<number[]> {
  const rows = await db.select({ id: releases.id }).from(releases).orderBy(releases.id);
  return rows.map((r) => r.id);
}

export async function listAllGenresAndStyles(): Promise<string[]> {
  const rows = await db.select({ name: genresStyles.name }).from(genresStyles);
  return [...new Set(rows.map((r) => r.name))].sort();
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

  const bpmRow = await db.query.bpm.findFirst({ where: eq(bpmTable.releaseId, id) });

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
    bpm: bpmRow ?? null,
    plays: plays.reverse(), // newest first
    enrichment: enrichmentRows,
  };
}
