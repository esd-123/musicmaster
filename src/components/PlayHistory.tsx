"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

interface PlayRow {
  id: number;
  playedAt: string;
}

function formatTimestamp(iso: string) {
  // SQLite CURRENT_TIMESTAMP is UTC, space-separated; make it parseable.
  const normalized = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  return new Date(normalized).toLocaleString();
}

export function PlayHistory({
  releaseId,
  plays,
}: {
  releaseId: number;
  plays: PlayRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function logPlay() {
    await fetch(`/api/releases/${releaseId}/plays`, { method: "POST" });
    startTransition(() => router.refresh());
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Play history
          {plays.length > 0 ? ` · ${plays.length} play${plays.length === 1 ? "" : "s"}` : ""}
        </h2>
        <button
          type="button"
          onClick={logPlay}
          disabled={isPending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
        >
          ▶ Play this record
        </button>
      </div>

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
