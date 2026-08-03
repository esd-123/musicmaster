import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  releases,
  artists,
  releaseArtists,
  releaseTracks,
  genresStyles,
  releaseGenresStyles,
  syncRuns,
} from "@/db/schema";
import { discogsFetch } from "./client";
import { stripDiscogsDisambiguator } from "@/lib/discogsMarkup";
import type {
  DiscogsCollectionResponse,
  DiscogsReleaseDetail,
  DiscogsBasicInformation,
} from "./types";

function parseDurationSeconds(duration?: string): number | null {
  if (!duration) return null;
  const parts = duration.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

async function upsertArtist(discogsArtistId: number, rawName: string): Promise<number> {
  const name = stripDiscogsDisambiguator(rawName);
  const existing = await db.query.artists.findFirst({
    where: eq(artists.discogsArtistId, discogsArtistId),
  });
  if (existing) {
    await db.update(artists).set({ name }).where(eq(artists.id, existing.id));
    return existing.id;
  }
  const [inserted] = await db
    .insert(artists)
    .values({ discogsArtistId, name })
    .returning({ id: artists.id });
  return inserted.id;
}

async function upsertGenreStyle(name: string, kind: "genre" | "style"): Promise<number> {
  const existing = await db.query.genresStyles.findFirst({
    where: and(eq(genresStyles.name, name), eq(genresStyles.kind, kind)),
  });
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(genresStyles)
    .values({ name, kind })
    .returning({ id: genresStyles.id });
  return inserted.id;
}

async function replaceReleaseArtists(
  releaseId: number,
  releaseArtistList: { id: number; name: string; role?: string }[],
) {
  await db.delete(releaseArtists).where(eq(releaseArtists.releaseId, releaseId));
  for (let i = 0; i < releaseArtistList.length; i++) {
    const a = releaseArtistList[i];
    const artistId = await upsertArtist(a.id, a.name);
    await db.insert(releaseArtists).values({
      releaseId,
      artistId,
      role: a.role ?? null,
      position: i,
    });
  }
}

async function replaceReleaseGenresStyles(
  releaseId: number,
  genres: string[] = [],
  styles: string[] = [],
) {
  await db.delete(releaseGenresStyles).where(eq(releaseGenresStyles.releaseId, releaseId));
  for (const name of genres) {
    const id = await upsertGenreStyle(name, "genre");
    await db.insert(releaseGenresStyles).values({ releaseId, genreStyleId: id });
  }
  for (const name of styles) {
    const id = await upsertGenreStyle(name, "style");
    await db.insert(releaseGenresStyles).values({ releaseId, genreStyleId: id });
  }
}

async function replaceReleaseTracks(releaseId: number, detail: DiscogsReleaseDetail) {
  await db.delete(releaseTracks).where(eq(releaseTracks.releaseId, releaseId));
  const tracks = detail.tracklist.filter((t) => t.type_ === "track");
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    await db.insert(releaseTracks).values({
      releaseId,
      position: track.position,
      sortOrder: i,
      title: track.title,
      durationSeconds: parseDurationSeconds(track.duration),
      trackArtist: track.artists?.map((a) => a.name).join(", ") || null,
    });
  }
}

function basicInfoFields(info: DiscogsBasicInformation, dateAdded: string) {
  return {
    discogsReleaseId: info.id,
    title: info.title,
    year: info.year || null,
    format: info.formats?.map((f) => f.name).join(", ") || null,
    label: info.labels
      ? [...new Set(info.labels.map((l) => l.name))].join(", ") || null
      : null,
    coverImageUrl: info.cover_image || info.thumb || null,
    dateAdded,
    lastSyncedAt: new Date().toISOString(),
  };
}

export interface SyncResult {
  itemsProcessed: number;
  itemsFailed: number;
  newReleases: number;
}

export async function syncDiscogsCollection(): Promise<SyncResult> {
  const token = process.env.DISCOGS_TOKEN;
  const username = process.env.DISCOGS_USERNAME;
  if (!token || !username) {
    throw new Error("DISCOGS_TOKEN and DISCOGS_USERNAME must be set");
  }

  const alreadyRunning = await db.query.syncRuns.findFirst({
    where: eq(syncRuns.status, "running"),
  });
  if (alreadyRunning) {
    throw new Error(
      `A discogs_sync is already running (sync_runs.id=${alreadyRunning.id}, started ${alreadyRunning.startedAt})`,
    );
  }

  const [run] = await db
    .insert(syncRuns)
    .values({ jobType: "discogs_sync", status: "running" })
    .returning({ id: syncRuns.id });

  let itemsProcessed = 0;
  let itemsFailed = 0;
  let newReleases = 0;

  try {
    let page = 1;
    let totalPages = 1;

    do {
      const data = await discogsFetch<DiscogsCollectionResponse>(
        `/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=100&sort=added&sort_order=desc`,
        token,
      );
      totalPages = data.pagination.pages;

      for (const item of data.releases) {
        try {
          const existing = await db.query.releases.findFirst({
            where: eq(releases.discogsInstanceId, item.instance_id),
          });

          if (!existing) {
            // New instance: fetch full detail (tracklist, notes, community rating).
            const detail = await discogsFetch<DiscogsReleaseDetail>(
              `/releases/${item.id}`,
              token,
            );

            const [inserted] = await db
              .insert(releases)
              .values({
                discogsInstanceId: item.instance_id,
                ...basicInfoFields(item.basic_information, item.date_added),
                discogsNotes: detail.notes ?? null,
                discogsCommunityRating: detail.community?.rating?.average ?? null,
                discogsCommunityRatingCount: detail.community?.rating?.count ?? null,
              })
              .returning({ id: releases.id });

            await replaceReleaseArtists(inserted.id, detail.artists);
            await replaceReleaseGenresStyles(inserted.id, detail.genres, detail.styles);
            await replaceReleaseTracks(inserted.id, detail);
            newReleases++;
          }
          // Already-known instances are intentionally left untouched: Discogs
          // has no new information for a release already in the collection
          // (its catalog data for that specific instance is static), and
          // re-syncing would blow away genres/tags added afterward by other
          // parts of the app. The sync's only job past initial import is to
          // detect and add genuinely new instances.
          itemsProcessed++;
        } catch (err) {
          itemsFailed++;
          console.error(`Failed to sync instance ${item.instance_id}:`, err);
        }
      }

      page++;
    } while (page <= totalPages);

    await db
      .update(syncRuns)
      .set({
        status: "success",
        finishedAt: new Date().toISOString(),
        itemsProcessed,
        itemsFailed,
      })
      .where(eq(syncRuns.id, run.id));
  } catch (err) {
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date().toISOString(),
        itemsProcessed,
        itemsFailed,
        errorSummary: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }

  return { itemsProcessed, itemsFailed, newReleases };
}
