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

async function upsertGenreStyle(name: string, kind: "genre" | "style"): Promise<number | null> {
  const existing = await db.query.genresStyles.findFirst({
    where: and(eq(genresStyles.name, name), eq(genresStyles.kind, kind)),
  });
  if (existing) return existing.id;

  // Discogs' native taxonomy and this hierarchy's hand-curated one sometimes
  // classify the same musical name at a different "level" — in either
  // direction: e.g. Ambient exists here as a top-level genre but Discogs
  // tags releases with it as a style, while Latin/Reggae exist here as
  // styles (under "Latin / Afro / Caribbean") but Discogs tags releases with
  // them as genres. Prefer an existing entry of the same name under the
  // *other* kind over minting a duplicate (see "Genre/style hierarchy" in
  // CLAUDE.md on this exact collision pattern).
  const otherKind = kind === "genre" ? "style" : "genre";
  const sameNameOtherKind = await db.query.genresStyles.findFirst({
    where: and(eq(genresStyles.name, name), eq(genresStyles.kind, otherKind)),
  });
  if (sameNameOtherKind) return sameNameOtherKind.id;

  if (kind === "genre") {
    // The top-level genre list is a small, deliberately hand-curated set
    // (several genres were split from Discogs' native broader buckets, e.g.
    // "Folk, World, & Country" -> Folk + Country, "Funk / Soul" -> Funk /
    // Disco + Soul — see CLAUDE.md) — sync must never mint a new one
    // unattended. Resolve via /genre-editor, or by hand (e.g. during an
    // interactive onboarding session, reasoning per-release which existing
    // split genre(s) actually fit) if a release needs it.
    console.warn(`[sync] Skipping unrecognized genre "${name}" — no existing hierarchy entry`);
    return null;
  }

  // Otherwise this is a genuinely new style. A style row requires a
  // hand-curated parent_genre_id (see the genres_styles_parent_kind_check
  // constraint) — sync can't make that judgment call unattended, so it's
  // skipped rather than inserted parentless, mirroring tagsAndStyles.ts's
  // "link, never create" rule for styles. Add it via /genre-editor (or
  // resolve it directly, e.g. during an interactive onboarding session) if
  // it should be part of the hierarchy.
  console.warn(`[sync] Skipping unrecognized style "${name}" — no existing hierarchy entry`);
  return null;
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
    if (id !== null) {
      await db.insert(releaseGenresStyles).values({ releaseId, genreStyleId: id });
    }
  }
  for (const name of styles) {
    const id = await upsertGenreStyle(name, "style");
    if (id !== null) {
      await db.insert(releaseGenresStyles).values({ releaseId, genreStyleId: id });
    }
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
  itemsRemoved: number;
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
  let itemsRemoved = 0;

  try {
    let page = 1;
    let totalPages = 1;
    const seenInstanceIds = new Set<number>();

    do {
      const data = await discogsFetch<DiscogsCollectionResponse>(
        `/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=100&sort=added&sort_order=desc`,
        token,
      );
      totalPages = data.pagination.pages;

      for (const item of data.releases) {
        seenInstanceIds.add(item.instance_id);
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

    // Anything in our DB whose discogs_instance_id wasn't in this run's
    // collection has been removed from Discogs (sold, deleted, moved out of
    // the synced folder) — mirror that removal here. Cascades via the
    // existing onDelete: cascade FKs (artists/tags/genres/styles themselves
    // are shared vocabulary and are left in place, even if now unused).
    // Guarded on a non-empty result: an anomalous empty page response should
    // never be interpreted as "the whole collection was removed."
    if (seenInstanceIds.size > 0) {
      const currentReleases = await db
        .select({ id: releases.id, discogsInstanceId: releases.discogsInstanceId })
        .from(releases);
      for (const r of currentReleases) {
        if (!seenInstanceIds.has(r.discogsInstanceId)) {
          await db.delete(releases).where(eq(releases.id, r.id));
          itemsRemoved++;
        }
      }
    } else {
      console.warn(
        "[sync] Discogs collection response was empty; skipping stale-release cleanup as a safety guard",
      );
    }

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

  return { itemsProcessed, itemsFailed, newReleases, itemsRemoved };
}
