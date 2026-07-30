import cron from "node-cron";
import { syncDiscogsCollection } from "./discogs/sync";
import { runEnrichment } from "./enrichment/run";

let started = false;

// How many releases to enrich per scheduled run — a slow trickle rather than
// hammering rate-limited APIs (MusicBrainz especially) all at once.
const ENRICHMENT_BATCH_SIZE = 30;

export function startScheduler() {
  if (started) return;
  started = true;

  // Daily at 03:00 local time: sync, then enrich a batch of new/stale releases.
  cron.schedule("0 3 * * *", async () => {
    console.log("[scheduler] starting daily Discogs sync");
    try {
      const result = await syncDiscogsCollection();
      console.log("[scheduler] Discogs sync complete:", result);
    } catch (err) {
      console.error("[scheduler] Discogs sync failed:", err);
      return;
    }

    console.log("[scheduler] starting enrichment batch");
    try {
      const result = await runEnrichment(ENRICHMENT_BATCH_SIZE);
      console.log("[scheduler] enrichment batch complete:", result);
    } catch (err) {
      console.error("[scheduler] enrichment batch failed:", err);
    }
  });

  console.log("[scheduler] daily Discogs sync + enrichment scheduled for 03:00");
}
