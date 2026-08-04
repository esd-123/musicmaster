"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ReleaseNotes({
  releaseId,
  initialNotes,
}: {
  releaseId: number;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(initialNotes ?? "");

  async function saveNotes() {
    await fetch(`/api/releases/${releaseId}/user-data`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <section className={isPending ? "opacity-70" : ""}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Your notes
      </h2>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={saveNotes}
        rows={3}
        placeholder="Notes on this record..."
        className="w-full rounded border border-black/10 bg-white p-2 text-sm dark:border-white/20 dark:bg-black"
      />
    </section>
  );
}
