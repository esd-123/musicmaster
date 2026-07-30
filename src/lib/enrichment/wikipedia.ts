import type { Enricher, EnrichmentField, ReleaseForEnrichment } from "./types";

const USER_AGENT = "MusicMaster/0.1 (personal vinyl collection app)";

interface SearchResponse {
  query?: { search: { title: string }[] };
}

interface SummaryResponse {
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  type?: string; // "disambiguation" pages should be skipped
}

async function searchTitle(query: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query,
  )}&format=json&srlimit=1`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()) as SearchResponse;
  return data.query?.search?.[0]?.title ?? null;
}

async function fetchSummary(title: string): Promise<SummaryResponse | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  return (await res.json()) as SummaryResponse;
}

export const wikipediaEnricher: Enricher = {
  source: "wikipedia",
  async enrich(release: ReleaseForEnrichment): Promise<EnrichmentField[]> {
    const artist = release.artistNames[0] ?? "";
    const title = await searchTitle(`${artist} ${release.title} album`);
    if (!title) return [];

    const summary = await fetchSummary(title);
    if (!summary || !summary.extract || summary.type === "disambiguation") return [];

    const fields: EnrichmentField[] = [
      { fieldKey: "wikipedia_summary", fieldValue: summary.extract },
    ];
    if (summary.content_urls?.desktop?.page) {
      fields.push({
        fieldKey: "wikipedia_url",
        fieldValue: summary.content_urls.desktop.page,
      });
    }
    return fields;
  },
};
