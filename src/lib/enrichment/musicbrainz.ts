import type { Enricher, EnrichmentField, ReleaseForEnrichment } from "./types";
import { sleep } from "./types";

// MusicBrainz requires a descriptive User-Agent and asks for ~1 req/sec.
const USER_AGENT = "MusicMaster/0.1 (personal vinyl collection app)";
const MIN_INTERVAL_MS = 1100;

let lastRequestAt = 0;
async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

interface ReleaseGroupSearchResponse {
  "release-groups"?: {
    id: string;
    score: number;
    tags?: { name: string }[];
  }[];
}

export const musicbrainzEnricher: Enricher = {
  source: "musicbrainz",
  async enrich(release: ReleaseForEnrichment): Promise<EnrichmentField[]> {
    const artist = release.artistNames[0] ?? "";
    const query = `releasegroup:"${release.title}" AND artist:"${artist}"`;
    const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(
      query,
    )}&fmt=json&limit=1`;

    await throttle();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return [];
    const data = (await res.json()) as ReleaseGroupSearchResponse;

    const match = data["release-groups"]?.[0];
    // MusicBrainz scores matches 0-100; below ~80 the match is too unreliable
    // to trust without a human "needs review" step, so we skip rather than guess.
    if (!match || match.score < 80) return [];

    const fields: EnrichmentField[] = [
      { fieldKey: "musicbrainz_id", fieldValue: match.id },
    ];

    // Fetch tags in a second call (release-group search doesn't include them).
    await throttle();
    const detailRes = await fetch(
      `https://musicbrainz.org/ws/2/release-group/${match.id}?inc=tags&fmt=json`,
      { headers: { "User-Agent": USER_AGENT } },
    );
    if (detailRes.ok) {
      const detail = (await detailRes.json()) as { tags?: { name: string }[] };
      if (detail.tags && detail.tags.length > 0) {
        fields.push({
          fieldKey: "musicbrainz_tags",
          fieldValue: detail.tags.map((t) => t.name).join(", "),
        });
      }
    }

    return fields;
  },
};
