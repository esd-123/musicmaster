import type { Enricher, EnrichmentField, ReleaseForEnrichment } from "./types";
import { sleep } from "./types";
import { USER_AGENT } from "@/lib/userAgent";

// Apple's iTunes Search API documentation caps requests at 20/minute.
const MIN_INTERVAL_MS = 3000;

let lastRequestAt = 0;
async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

interface ITunesSearchResult {
  collectionViewUrl?: string;
  artistName?: string;
  collectionName?: string;
}

interface ITunesSearchResponse {
  results?: ITunesSearchResult[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const appleMusicEnricher: Enricher = {
  source: "apple_music",
  async enrich(release: ReleaseForEnrichment): Promise<EnrichmentField[]> {
    const artist = release.artistNames[0] ?? "";
    const term = `${artist} ${release.title}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      term,
    )}&entity=album&limit=5`;

    await throttle();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return [];
    const data = (await res.json()) as ITunesSearchResponse;

    const normalizedArtist = normalize(artist);
    const match = data.results?.find(
      (r) =>
        r.collectionViewUrl &&
        r.artistName &&
        normalizedArtist.length > 0 &&
        normalize(r.artistName).includes(normalizedArtist),
    );
    if (!match?.collectionViewUrl) return [];

    return [{ fieldKey: "apple_music_url", fieldValue: match.collectionViewUrl }];
  },
};
