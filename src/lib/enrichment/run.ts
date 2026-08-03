import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { enrichmentCache, syncRuns } from "@/db/schema";
import { getReleaseForEnrichment, listAllReleaseIds } from "@/lib/releases";
import { wikipediaEnricher } from "./wikipedia";
import { musicbrainzEnricher } from "./musicbrainz";
import { lastfmEnricher } from "./lastfm";
import { appleMusicEnricher } from "./appleMusic";
import { generateAboutSummary } from "./aboutSummary";
import type { Enricher, EnrichmentSource } from "./types";

const STALE_AFTER_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
const enrichers: Enricher[] = [
  wikipediaEnricher,
  musicbrainzEnricher,
  lastfmEnricher,
  appleMusicEnricher,
];

// The full set of valid enrichment_cache.source values — wider than
// EnrichmentSource, which only covers the pluggable pull-enrichers above.
type CacheSource = typeof enrichmentCache.$inferInsert.source;

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
  source: CacheSource,
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

// Unlike the raw pull-sources above, the AI-synthesized summary is
// deliberately NOT refreshed on a schedule — it's generated once (when a
// release is first added) and only ever regenerated when the user
// explicitly asks for a redo via the manual endpoint, since "wrong until
// I say otherwise" is a judgment call only the user can make.
async function needsAboutSummary(releaseId: number): Promise<boolean> {
  const existing = await db.query.enrichmentCache.findFirst({
    where: and(
      eq(enrichmentCache.releaseId, releaseId),
      eq(enrichmentCache.source, "claude"),
      eq(enrichmentCache.fieldKey, "about_summary"),
    ),
  });
  return !existing;
}

export async function enrichAboutSummary(
  releaseId: number,
  release: Awaited<ReturnType<typeof getReleaseForEnrichment>>,
): Promise<boolean> {
  if (!release) return false;

  // The synthesized summary itself (source="claude") is deliberately excluded
  // from its own inputs.
  const rawSourceRows = await db
    .select({ fieldKey: enrichmentCache.fieldKey, fieldValue: enrichmentCache.fieldValue })
    .from(enrichmentCache)
    .where(
      and(
        eq(enrichmentCache.releaseId, releaseId),
        inArray(enrichmentCache.source, ["wikipedia", "musicbrainz", "lastfm"]),
      ),
    );
  const byKey = Object.fromEntries(rawSourceRows.map((r) => [r.fieldKey, r.fieldValue]));

  const summary = await generateAboutSummary({
    title: release.title,
    artist: release.artistNames.join(", "),
    year: release.year,
    genres: release.genres,
    styles: release.styles,
    discogsCommunityRating: release.discogsCommunityRating,
    discogsCommunityRatingCount: release.discogsCommunityRatingCount,
    wikipediaSummary: byKey["wikipedia_summary"] ?? null,
    musicbrainzTags: byKey["musicbrainz_tags"] ?? null,
    lastfmSummary: byKey["lastfm_summary"] ?? null,
    lastfmTags: byKey["lastfm_tags"] ?? null,
  });

  if (!summary) return false;
  await upsertField(releaseId, "claude", "about_summary", summary.text);
  await upsertField(
    releaseId,
    "claude",
    "about_summary_used_web_search",
    summary.usedWebSearch ? "true" : "false",
  );
  return true;
}

/**
 * Force-regenerates the About This Record summary for one release,
 * overwriting whatever's there — the manual "redo this" path for when the
 * user judges the existing write-up wrong or incomplete. Unlike the
 * automatic pipeline, this always runs regardless of whether a summary
 * already exists.
 */
export async function regenerateAboutSummary(releaseId: number): Promise<boolean> {
  const release = await getReleaseForEnrichment(releaseId);
  return enrichAboutSummary(releaseId, release);
}

export interface EnrichmentRunResult {
  releasesConsidered: number;
  fieldsWritten: number;
  summariesWritten: number;
}

/**
 * Runs enrichment for up to `limit` releases that are missing (or have
 * stale) data. Never touches user_release_data or release_tags.
 */
export async function runEnrichment(limit = 15): Promise<EnrichmentRunResult> {
  const [run] = await db
    .insert(syncRuns)
    .values({ jobType: "enrichment", status: "running" })
    .returning({ id: syncRuns.id });

  let releasesConsidered = 0;
  let fieldsWritten = 0;
  let summariesWritten = 0;

  try {
    const allIds = await listAllReleaseIds();

    for (const releaseId of allIds) {
      if (releasesConsidered >= limit) break;

      const needsAny =
        (await Promise.all(enrichers.map((e) => needsEnrichment(releaseId, e.source)))).some(
          Boolean,
        ) || (await needsAboutSummary(releaseId));

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

      // Runs after the raw sources above so it can synthesize from whatever
      // was just fetched (plus anything already cached from prior runs).
      if (await needsAboutSummary(releaseId)) {
        try {
          const wrote = await enrichAboutSummary(releaseId, release);
          if (wrote) summariesWritten++;
        } catch (err) {
          console.error(`[enrichment] about-summary generation failed for release ${releaseId}:`, err);
        }
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

  return { releasesConsidered, fieldsWritten, summariesWritten };
}
