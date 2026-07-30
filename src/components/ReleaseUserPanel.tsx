"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface TagRow {
  id: number;
  label: string;
  kind: "mood" | "tag";
}

export function ReleaseUserPanel({
  releaseId,
  initialRating,
  initialNotes,
  initialTags,
}: {
  releaseId: number;
  initialRating: number | null;
  initialNotes: string | null;
  initialTags: TagRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rating, setRating] = useState(initialRating ?? 0);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [tagInput, setTagInput] = useState("");
  const [tagKind, setTagKind] = useState<"tag" | "mood">("tag");

  async function saveRating(value: number) {
    setRating(value);
    await fetch(`/api/releases/${releaseId}/user-data`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: value }),
    });
    startTransition(() => router.refresh());
  }

  async function saveNotes() {
    await fetch(`/api/releases/${releaseId}/user-data`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    startTransition(() => router.refresh());
  }

  async function addTag() {
    const label = tagInput.trim();
    if (!label) return;
    setTagInput("");
    await fetch(`/api/releases/${releaseId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, kind: tagKind }),
    });
    startTransition(() => router.refresh());
  }

  async function removeTag(tagId: number) {
    await fetch(`/api/releases/${releaseId}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <section className={`mt-6 space-y-4 ${isPending ? "opacity-70" : ""}`}>
      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Your rating
        </h2>
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

      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
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
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Tags &amp; moods
        </h2>
        <div className="mb-2 flex flex-wrap gap-2">
          {initialTags.map((t) => (
            <span
              key={t.id}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                t.kind === "mood"
                  ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                  : "bg-zinc-100 dark:bg-zinc-900"
              }`}
            >
              {t.label}
              <button
                type="button"
                onClick={() => removeTag(t.id)}
                aria-label={`Remove ${t.label}`}
                className="opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            value={tagKind}
            onChange={(e) => setTagKind(e.target.value as "tag" | "mood")}
            className="rounded border border-black/10 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-black"
          >
            <option value="tag">tag</option>
            <option value="mood">mood</option>
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
    </section>
  );
}
