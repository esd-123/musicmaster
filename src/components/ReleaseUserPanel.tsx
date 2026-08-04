"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ReleaseUserPanel({
  releaseId,
  initialRating,
}: {
  releaseId: number;
  initialRating: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rating, setRating] = useState(initialRating ?? 0);
  const [tagInput, setTagInput] = useState("");
  const [tagKind, setTagKind] = useState<"tag" | "mood" | "genre">("tag");

  async function saveRating(value: number) {
    setRating(value);
    await fetch(`/api/releases/${releaseId}/user-data`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: value }),
    });
    startTransition(() => router.refresh());
  }

  async function addTag() {
    const label = tagInput.trim();
    if (!label) return;
    setTagInput("");
    if (tagKind === "genre") {
      await fetch(`/api/releases/${releaseId}/genres-styles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label, kind: "genre" }),
      });
    } else {
      await fetch(`/api/releases/${releaseId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, kind: tagKind }),
      });
    }
    startTransition(() => router.refresh());
  }

  return (
    <section className={`mt-2 space-y-4 ${isPending ? "opacity-70" : ""}`}>
      <div>
        <div className="flex gap-2">
          <select
            value={tagKind}
            onChange={(e) => setTagKind(e.target.value as "tag" | "mood" | "genre")}
            className="rounded border border-black/10 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-black"
          >
            <option value="tag">tag</option>
            <option value="mood">mood</option>
            <option value="genre">genre</option>
          </select>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag or mood..."
            className="flex-1 rounded border border-black/10 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-black"
          />
          <button
            type="button"
            onClick={addTag}
            className="rounded bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-black"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Your rating
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => saveRating(n === rating ? 0 : n)}
                className={`text-2xl leading-none ${
                  n <= rating ? "text-amber-400" : "text-zinc-300 dark:text-zinc-700"
                }`}
                aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
