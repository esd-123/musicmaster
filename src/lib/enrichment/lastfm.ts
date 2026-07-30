import type { Enricher, EnrichmentField, ReleaseForEnrichment } from "./types";

function stripHtml(html: string): string {
  return html
    .replace(/<a[^>]*>[\s\S]*?<\/a>\.?\s*$/i, "") // trailing "Read more on Last.fm" link
    .replace(/<[^>]+>/g, "")
    .trim();
}

interface AlbumInfoResponse {
  album?: {
    wiki?: { summary?: string };
    tags?: { tag?: { name: string }[] };
    listeners?: string;
    playcount?: string;
  };
  error?: number;
}

export const lastfmEnricher: Enricher = {
  source: "lastfm",
  async enrich(release: ReleaseForEnrichment): Promise<EnrichmentField[]> {
    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) return [];

    const artist = release.artistNames[0] ?? "";
    const url =
      `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=${apiKey}` +
      `&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(release.title)}&format=json`;

    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as AlbumInfoResponse;
    if (data.error || !data.album) return [];

    const fields: EnrichmentField[] = [];
    if (data.album.wiki?.summary) {
      const summary = stripHtml(data.album.wiki.summary);
      if (summary) fields.push({ fieldKey: "lastfm_summary", fieldValue: summary });
    }
    if (data.album.tags?.tag && data.album.tags.tag.length > 0) {
      fields.push({
        fieldKey: "lastfm_tags",
        fieldValue: data.album.tags.tag.map((t) => t.name).join(", "),
      });
    }
    if (data.album.playcount) {
      fields.push({ fieldKey: "lastfm_playcount", fieldValue: data.album.playcount });
    }
    return fields;
  },
};
