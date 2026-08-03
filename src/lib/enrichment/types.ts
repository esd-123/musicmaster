export interface ReleaseForEnrichment {
  id: number;
  title: string;
  artistNames: string[];
}

export interface EnrichmentField {
  fieldKey: string;
  fieldValue: string;
}

export type EnrichmentSource = "wikipedia" | "musicbrainz" | "lastfm" | "apple_music";

export interface Enricher {
  source: EnrichmentSource;
  /** Returns [] if no confident match was found — never guesses. */
  enrich(release: ReleaseForEnrichment): Promise<EnrichmentField[]>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep };
