// BPM is pull-only (the user will never hand-enter it). GetSongBPM is a
// song-level database, so we look up a representative track from the
// release (the title track if there is one, else the first track) and use
// its tempo as the release's BPM. See AGENTS notes / plan for why: Spotify's
// audio-features endpoint is locked for new apps, so this is the primary
// free source, with AcousticBrainz as a documented-but-unimplemented fallback.

interface GetSongBpmResult {
  bpm: number;
  confidence: "exact" | "fuzzy";
}

interface SearchResponse {
  search?: { title: string; tempo: string }[];
}

export async function lookupBpm(
  artist: string,
  trackTitle: string,
): Promise<GetSongBpmResult | null> {
  const apiKey = process.env.GETSONGBPM_API_KEY;
  if (!apiKey) return null;

  const lookup = `song:${trackTitle} artist:${artist}`;
  const url = `https://api.getsong.co/search/?api_key=${apiKey}&type=song&lookup=${encodeURIComponent(lookup)}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as SearchResponse;

  const match = data.search?.[0];
  if (!match || !match.tempo) return null;

  const bpm = Number(match.tempo);
  if (!Number.isFinite(bpm) || bpm <= 0) return null;

  const confidence =
    match.title.trim().toLowerCase() === trackTitle.trim().toLowerCase()
      ? "exact"
      : "fuzzy";

  return { bpm, confidence };
}
