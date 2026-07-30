import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { enrichmentCache, bpm as bpmTable, syncRuns } from "@/db/schema";
import { getReleaseForEnrichment, listAllReleaseIds } from "@/lib/releases";
import { wikipediaEnricher } from "./wikipedia";
import { musicbrainzEnricher } from "./musicbrainz";
import { lastfmEnricher } from "./lastfm";
import { lookupBpm } from "./getsongbpm";
import type { Enricher, EnrichmentSource } from "./types";

const STALE_AFTER_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
const enrichers: Enricher[] = [wikipediaEnricher, musicbrainzEnricher, lastfmEnricher];

function isStale(fetchedAt: string): boolean {
  return Date.now() - new Date(fetchedAt.replace(" ", "T") + "Z").getTime() > STALE_AFTER_MS;
}

async function needsEnrichment(releaseId: number, source: EnrichmentSource): Promise<boolean> {
  const existing = await db.query.enrichmentCache.findFirst({
    where: and(eq(enrichmentCache.releaseId, releaseId), eq(enrichmentCache.source, source)),
  });
  if (!existing) return true;
  return isStale(existing.fetchedAt);
}

async function upsertField(
  releaseId: number,
  source: EnrichmentSource,
  fieldKey: string,
  fieldValue: string,
) {
  const existing = await db.query.enrichmentCache.findFirst({
    where: and(
      eq(enrichmentCache.releaseId, releaseId),
      eq(enrichmentCache.source, source),
      eq(enrichmentCache.fieldKey, fieldKey),
    ),
  });
  if (existing) {
    await db
      .update(enrichmentCache)
      .set({ fieldValue, fetchedAt: new Date().toISOString() })
      .where(eq(enrichmentCache.id, existing.id));
  } else {
    await db.insert(enrichmentCache).values({
      releaseId,
      source,
      fieldKey,
      fieldValue,
    });
  }
}

async function enrichBpm(
  releaseId: number,
  releaseTitle: string,
  artist: string,
  tracks: { title: string }[],
) {
  const existing = await db.query.bpm.findFirst({ where: eq(bpmTable.releaseId, releaseId) });
  if (existing && !isStale(existing.fetchedAt)) return false;
  if (tracks.length === 0) return false;

  // Representative track for a release-level BPM: the title track if one
  // exists, else just the first track.
  const titleTrack = tracks.find(
    (t) => t.title.trim().toLowerCase() === releaseTitle.trim().toLowerCase(),
  );
  const track = titleTrack ?? tracks[0];

  const result = await lookupBpm(artist, track.title);
  if (!result) return false;

  if (existing) {
    await db
      .update(bpmTable)
      .set({
        bpm: result.bpm,
        source: "getsongbpm",
        confidence: result.confidence,
        fetchedAt: new Date().toISOString(),
      })
      .where(eq(bpmTable.releaseId, releaseId));
  } else {
    await db.insert(bpmTable).values({
      releaseId,
      bpm: result.bpm,
      source: "getsongbpm",
      confidence: result.confidence,
    });
  }
  return true;
}

export interface EnrichmentRunResult {
  releasesConsidered: number;
  fieldsWritten: number;
  bpmFound: number;
}

/**
 * Runs enrichment for up to `limit` releases that are missing (or have
 * stale) data. Never touches user_release_data, release_tags, or
 * bpm-as-user-entry — BPM here is always machine-sourced.
 */
export async function runEnrichment(limit = 15): Promise<EnrichmentRunResult> {
  const [run] = await db
    .insert(syncRuns)
    .values({ jobType: "enrichment", status: "running" })
    .returning({ id: syncRuns.id });

  let releasesConsidered = 0;
  let fieldsWritten = 0;
  let bpmFound = 0;

  try {
    const allIds = await listAllReleaseIds();

    for (const releaseId of allIds) {
      if (releasesConsidered >= limit) break;

      const needsAny =
        (await Promise.all(enrichers.map((e) => needsEnrichment(releaseId, e.source)))).some(
          Boolean,
        ) || (await db.query.bpm.findFirst({ where: eq(bpmTable.releaseId, releaseId) })) === undefined;

      if (!needsAny) continue;

      const release = await getReleaseForEnrichment(releaseId);
      if (!release) continue;

      releasesConsidered++;

      for (const enricher of enrichers) {
        if (!(await needsEnrichment(releaseId, enricher.source))) continue;
        try {
          const fields = await enricher.enrich(release);
          for (const field of fields) {
            await upsertField(releaseId, enricher.source, field.fieldKey, field.fieldValue);
            fieldsWritten++;
          }
        } catch (err) {
          console.error(`[enrichment] ${enricher.source} failed for release ${releaseId}:`, err);
        }
      }

      try {
        const found = await enrichBpm(
          releaseId,
          release.title,
          release.artistNames[0] ?? "",
          release.tracks,
        );
        if (found) bpmFound++;
      } catch (err) {
        console.error(`[enrichment] bpm lookup failed for release ${releaseId}:`, err);
      }
    }

    await db
      .update(syncRuns)
      .set({
        status: "success",
        finishedAt: new Date().toISOString(),
        itemsProcessed: releasesConsidered,
      })
      .where(eq(syncRuns.id, run.id));
  } catch (err) {
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date().toISOString(),
        itemsProcessed: releasesConsidered,
        errorSummary: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }

  return { releasesConsidered, fieldsWritten, bpmFound };
}
