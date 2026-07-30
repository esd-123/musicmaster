interface EnrichmentRow {
  id: number;
  source: "wikipedia" | "musicbrainz" | "lastfm";
  fieldKey: string;
  fieldValue: string;
  fetchedAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  wikipedia: "Wikipedia",
  musicbrainz: "MusicBrainz",
  lastfm: "Last.fm",
};

const FIELD_LABELS: Record<string, string> = {
  wikipedia_summary: "Summary",
  wikipedia_url: "Link",
  musicbrainz_id: "MusicBrainz ID",
  musicbrainz_tags: "Tags",
  lastfm_summary: "Summary",
  lastfm_tags: "Tags",
  lastfm_playcount: "Play count (Last.fm)",
};

function formatTimestamp(iso: string) {
  const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  return new Date(normalized).toLocaleDateString();
}

export function EnrichmentPanel({ rows }: { rows: EnrichmentRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          From around the web
        </h2>
        <p className="text-sm text-zinc-500">No enrichment data fetched yet.</p>
      </section>
    );
  }

  const bySource = new Map<string, EnrichmentRow[]>();
  for (const row of rows) {
    if (!bySource.has(row.source)) bySource.set(row.source, []);
    bySource.get(row.source)!.push(row);
  }

  return (
    <section className="mt-10 space-y-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        From around the web
      </h2>
      {[...bySource.entries()].map(([source, fields]) => (
        <div key={source}>
          <h3 className="mb-1 text-sm font-medium">
            {SOURCE_LABELS[source] ?? source}
            <span className="ml-2 text-xs text-zinc-400">
              as of {formatTimestamp(fields[0].fetchedAt)}
            </span>
          </h3>
          <dl className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {fields.map((f) => (
              <div key={f.id}>
                <dt className="inline font-medium text-zinc-500">
                  {FIELD_LABELS[f.fieldKey] ?? f.fieldKey}:{" "}
                </dt>
                <dd className="inline">
                  {f.fieldKey.endsWith("_url") ? (
                    <a href={f.fieldValue} target="_blank" rel="noopener noreferrer" className="underline">
                      {f.fieldValue}
                    </a>
                  ) : (
                    f.fieldValue
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
