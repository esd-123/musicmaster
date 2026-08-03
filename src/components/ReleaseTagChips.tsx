"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

interface GenreStyleItem {
  id: number;
  name: string;
  kind: "genre" | "style";
}

interface TagItem {
  id: number;
  label: string;
  kind: "mood" | "tag";
}

export function ReleaseTagChips({
  releaseId,
  genreStyles,
  tags,
}: {
  releaseId: number;
  genreStyles: GenreStyleItem[];
  tags: TagItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function removeGenreStyle(genreStyleId: number) {
    await fetch(`/api/releases/${releaseId}/genres-styles`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genreStyleId }),
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

  const genres = genreStyles.filter((g) => g.kind === "genre");
  const styles = genreStyles.filter((g) => g.kind === "style");

  return (
    <div className="mt-3">
      {(genres.length > 0 || styles.length > 0) && (
        <div className="mb-3">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Genres &amp; styles
          </h2>
          {/* Genres first, visually heavier (larger, bolder, blue-tinted —
              matching the genre badge color used in the genre editor) than
              styles, since a genre is a broader classification a style
              belongs under, not an equal peer. */}
          <div className={`flex flex-wrap items-center gap-2 ${isPending ? "opacity-70" : ""}`}>
            {genres.map((g) => (
              <span
                key={`gs-${g.id}`}
                className="flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300"
              >
                {g.name}
                <button
                  type="button"
                  onClick={() => removeGenreStyle(g.id)}
                  aria-label={`Remove ${g.name}`}
                  className="opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            ))}
            {styles.map((g) => (
              <span
                key={`gs-${g.id}`}
                className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                {g.name}
                <button
                  type="button"
                  onClick={() => removeGenreStyle(g.id)}
                  aria-label={`Remove ${g.name}`}
                  className="opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tags/moods are freeform and independent of the genre/style
          hierarchy above — a separate section, not sorted alongside it. */}
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Tags &amp; moods
      </h2>
      <div className={`flex flex-wrap gap-2 ${isPending ? "opacity-70" : ""}`}>
        {tags.map((t) => (
          <span
            key={`tag-${t.id}`}
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
    </div>
  );
}
