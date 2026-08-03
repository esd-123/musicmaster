interface PlayRow {
  id: number;
  playedAt: string;
}

function formatTimestamp(iso: string) {
  // SQLite CURRENT_TIMESTAMP is UTC, space-separated; make it parseable.
  const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  return new Date(normalized).toLocaleString();
}

export function PlayHistory({ plays }: { plays: PlayRow[] }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Play history
        {plays.length > 0 ? ` · ${plays.length} play${plays.length === 1 ? "" : "s"}` : ""}
      </h2>

      {plays.length === 0 ? (
        <p className="text-sm text-zinc-500">Not logged as played yet.</p>
      ) : (
        <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
          {plays.map((p) => (
            <li key={p.id} className="py-1.5 text-zinc-600 dark:text-zinc-400">
              {formatTimestamp(p.playedAt)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
