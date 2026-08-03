// Shared identifying User-Agent for outbound requests to third-party APIs
// (Discogs, Wikipedia, MusicBrainz) — each expects (or, for MusicBrainz,
// requires) a descriptive, stable identifier rather than a generic HTTP
// client string.
export const USER_AGENT = "MusicMaster/0.1 (personal vinyl collection app)";
