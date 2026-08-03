// Discogs disambiguates same-named artists with a trailing " (N)" (e.g.
// "Zar (16)") — meaningful in their own database, meaningless to everyone
// else. Our artists table already dedupes on discogs_artist_id, not on
// this display name, so stripping it is purely cosmetic and safe.
export function stripDiscogsDisambiguator(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}
