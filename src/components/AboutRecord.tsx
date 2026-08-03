"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EnrichmentRow {
  id: number;
  source: "wikipedia" | "musicbrainz" | "lastfm" | "claude" | "apple_music";
  fieldKey: string;
  fieldValue: string;
  fetchedAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  wikipedia: "Wikipedia",
  musicbrainz: "MusicBrainz",
  lastfm: "Last.fm",
  web_search: "Web Search",
};

function formatDate(iso: string) {
  const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  return new Date(normalized).toLocaleDateString();
}

export function AboutRecord({ releaseId, rows }: { releaseId: number; rows: EnrichmentRow[] }) {
  const router = useRouter();
  const [isRegenerating, setIsRegenerating] = useState(false);

  const summaryRow = rows.find((r) => r.source === "claude" && r.fieldKey === "about_summary");
  const usedWebSearch = rows.some(
    (r) => r.source === "claude" && r.fieldKey === "about_summary_used_web_search" && r.fieldValue === "true",
  );
  const rawSources: string[] = [
    ...new Set(rows.filter((r) => r.source !== "claude").map((r) => r.source)),
    ...(usedWebSearch ? ["web_search"] : []),
  ];

  async function regenerate() {
    setIsRegenerating(true);
    try {
      await fetch(`/api/releases/${releaseId}/regenerate-summary`, { method: "POST" });
      router.refresh();
    } finally {
      setIsRegenerating(false);
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          About this record
        </h2>
        <button
          type="button"
          onClick={regenerate}
          disabled={isRegenerating}
          className="text-xs text-zinc-400 underline decoration-dotted hover:text-zinc-600 disabled:opacity-50 dark:hover:text-zinc-300"
        >
          {isRegenerating ? "Regenerating…" : summaryRow ? "Regenerate" : "Generate"}
        </button>
      </div>

      {summaryRow ? (
        <>
          <p className="whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">
            {summaryRow.fieldValue}
          </p>
          {rawSources.length > 0 && (
            <p className="mt-3 text-xs text-zinc-400">
              Sources: {rawSources.map((s) => SOURCE_LABELS[s] ?? s).join(", ")} · as of{" "}
              {formatDate(summaryRow.fetchedAt)}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-zinc-500">
          No summary available yet — this record hasn&apos;t been enriched.
        </p>
      )}
    </section>
  );
}
