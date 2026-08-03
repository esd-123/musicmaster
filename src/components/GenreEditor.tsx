"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";

export interface GenreEditorLink {
  id: number;
  name: string;
  kind: "genre" | "style";
}

export interface GenreEditorRelease {
  id: number;
  title: string;
  year: number | null;
  coverImageUrl: string | null;
  artistNames: string[];
  genreStyleLinks: GenreEditorLink[];
}

export interface GenreStyleUsage {
  id: number;
  name: string;
  kind: "genre" | "style";
  releaseCount: number;
  description: string | null;
  parentGenreId: number | null;
}

const SELECT_CLASS =
  "rounded-full bg-white px-4 py-2 text-sm text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none dark:bg-zinc-900 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]";

/** Column header for a genre — not draggable, holds the genre-level actions
 * (merge/rename the whole genre, edit its description) plus the click-to-
 * browse trigger. */
function GenreColumnHeader({
  genre,
  target,
  onTargetChange,
  onMerge,
  onDelete,
  busy,
  selected,
  onSelectFilter,
  descriptionValue,
  onDescriptionChange,
  onDescriptionBlur,
  descriptionSaving,
}: {
  genre: GenreStyleUsage;
  target: string;
  onTargetChange: (value: string) => void;
  onMerge: () => void;
  onDelete: () => void;
  busy: boolean;
  selected: boolean;
  onSelectFilter: () => void;
  descriptionValue: string;
  onDescriptionChange: (value: string) => void;
  onDescriptionBlur: () => void;
  descriptionSaving: boolean;
}) {
  return (
    <div
      className={`rounded-t-lg border-b border-zinc-200 px-2.5 py-2 dark:border-zinc-800 ${
        selected ? "bg-blue-50 dark:bg-blue-950/40" : "bg-zinc-100 dark:bg-zinc-800"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onSelectFilter}
          title={`Show every record tagged "${genre.name}" below`}
          className={`min-w-0 truncate text-left text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50 ${
            selected ? "underline" : ""
          }`}
        >
          {genre.name}
        </button>
        <span className="shrink-0 text-[11px] text-zinc-500">{genre.releaseCount}</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          title={`Delete "${genre.name}"`}
          className="shrink-0 text-xs text-zinc-400 hover:text-red-600 disabled:cursor-not-allowed dark:hover:text-red-400"
        >
          ×
        </button>
      </div>
      <textarea
        value={descriptionValue}
        onChange={(e) => onDescriptionChange(e.target.value)}
        onBlur={onDescriptionBlur}
        placeholder="Add a description…"
        rows={2}
        className="mt-1 w-full resize-none rounded bg-transparent px-0.5 text-[11px] text-zinc-500 outline-none hover:bg-white/60 focus:bg-white dark:hover:bg-black/20 dark:focus:bg-black/30"
      />
      {descriptionSaving && <span className="text-[10px] text-zinc-400">saving…</span>}
      <div className="mt-1.5 flex items-center gap-1">
        <input
          type="text"
          list="genre-style-names"
          value={target}
          onChange={(e) => onTargetChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onMerge();
          }}
          placeholder="merge into…"
          className="w-full min-w-0 rounded-full bg-white px-2 py-1 text-[11px] text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none dark:bg-zinc-950 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
        />
        <button
          type="button"
          onClick={onMerge}
          disabled={busy || !target.trim()}
          title="Move every release from this genre to the target, deleting this genre"
          className="shrink-0 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "…" : "Merge"}
        </button>
      </div>
    </div>
  );
}

/** Draggable style card. Dragging it onto another column pins it under that
 * genre (`onDragStart` carries the style id via dataTransfer); Merge/Make
 * genre stay available but tucked behind a toggle since they're rarer,
 * data-mutating actions rather than the everyday reorganizing gesture. */
function StyleCard({
  item,
  target,
  onTargetChange,
  onMerge,
  onPromote,
  onSelectFilter,
  selected,
  descriptionValue,
  onDescriptionChange,
  onDescriptionBlur,
  descriptionSaving,
  busy,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  item: GenreStyleUsage;
  target: string;
  onTargetChange: (value: string) => void;
  onMerge: () => void;
  onPromote: () => void;
  onSelectFilter: () => void;
  selected: boolean;
  descriptionValue: string;
  onDescriptionChange: (value: string) => void;
  onDescriptionBlur: () => void;
  descriptionSaving: boolean;
  busy: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`cursor-grab select-none rounded-lg bg-white p-2 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] active:cursor-grabbing dark:bg-zinc-950 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)] ${
        dragging ? "opacity-40" : ""
      } ${selected ? "ring-2 ring-blue-400" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={onSelectFilter}
          title={`Show every record tagged "${item.name}" below`}
          className={`min-w-0 truncate text-left text-xs font-medium text-zinc-900 hover:underline dark:text-zinc-50 ${
            selected ? "underline" : ""
          }`}
        >
          {item.name}
        </button>
        <span className="shrink-0 text-[10px] text-zinc-400">{item.releaseCount}</span>
      </div>
      <textarea
        value={descriptionValue}
        onChange={(e) => onDescriptionChange(e.target.value)}
        onBlur={onDescriptionBlur}
        placeholder="Add a description…"
        rows={3}
        className="mt-1 w-full resize-none rounded bg-transparent px-0.5 text-[11px] text-zinc-500 outline-none hover:bg-zinc-50 focus:bg-zinc-50 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
      />
      {descriptionSaving && <span className="text-[10px] text-zinc-400">saving…</span>}
      <button
        type="button"
        onClick={() => setShowActions((v) => !v)}
        className="mt-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        {showActions ? "Hide actions" : "Merge / promote…"}
      </button>
      {showActions && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <input
            type="text"
            list="genre-style-names"
            value={target}
            onChange={(e) => onTargetChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onMerge();
            }}
            placeholder="target name…"
            className="w-full min-w-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none dark:bg-zinc-900 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
          />
          <button
            type="button"
            onClick={onMerge}
            disabled={busy || !target.trim()}
            title="Move every release from this tag to the target, deleting this tag"
            className="shrink-0 rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Merge
          </button>
          <button
            type="button"
            onClick={onPromote}
            disabled={busy}
            title={`Make "${item.name}" its own genre`}
            className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-900 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
          >
            Make genre
          </button>
        </div>
      )}
    </div>
  );
}

interface GenreGroup {
  genre: GenreStyleUsage;
  styles: GenreStyleUsage[];
}

function sortByCountThenName(items: GenreStyleUsage[]): GenreStyleUsage[] {
  return [...items].sort((a, b) => a.releaseCount - b.releaseCount || a.name.localeCompare(b.name));
}

export function GenreEditor({
  releases: initialReleases,
  usage: initialUsage,
}: {
  releases: GenreEditorRelease[];
  usage: GenreStyleUsage[];
}) {
  const [releases, setReleases] = useState(initialReleases);
  const [usage, setUsage] = useState(initialUsage);
  const [error, setError] = useState<string | null>(null);

  const [usageQuery, setUsageQuery] = useState("");
  const [mergeTargets, setMergeTargets] = useState<Record<number, string>>({});
  const [mergingIds, setMergingIds] = useState<Set<number>>(new Set());
  const [newGenreName, setNewGenreName] = useState("");
  const [addingGenre, setAddingGenre] = useState(false);
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<number, string>>({});
  const [savingDescriptionIds, setSavingDescriptionIds] = useState<Set<number>>(new Set());
  const [newStyleDrafts, setNewStyleDrafts] = useState<Record<string, string>>({});
  const [addingStyleKey, setAddingStyleKey] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const [filterName, setFilterName] = useState("");
  const [removingKeys, setRemovingKeys] = useState<Set<string>>(new Set());
  const browseSectionRef = useRef<HTMLElement>(null);

  function selectFilter(name: string) {
    setFilterName(name);
    browseSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const allNames = useMemo(
    () => [...new Set(usage.map((u) => u.name))].sort((a, b) => a.localeCompare(b)),
    [usage],
  );

  /** Groups every style under its one genre — `parentGenreId` is the
   * authoritative classification (every style has exactly one, enforced by
   * the DB check constraint), not a guess, so this is a direct grouping. */
  const groups = useMemo<GenreGroup[]>(() => {
    const genreUsages = usage.filter((u) => u.kind === "genre");
    const stylesByGenreId = new Map<number, GenreStyleUsage[]>();
    for (const g of genreUsages) stylesByGenreId.set(g.id, []);

    for (const s of usage) {
      if (s.kind !== "style" || s.parentGenreId === null) continue;
      stylesByGenreId.get(s.parentGenreId)?.push(s);
    }

    return genreUsages
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((genre) => ({ genre, styles: sortByCountThenName(stylesByGenreId.get(genre.id) ?? []) }));
  }, [usage]);

  const filteredGroups = useMemo<GenreGroup[]>(() => {
    const q = usageQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => {
        const genreMatches = group.genre.name.toLowerCase().includes(q);
        const styles = genreMatches
          ? group.styles
          : group.styles.filter((s) => s.name.toLowerCase().includes(q));
        if (!genreMatches && styles.length === 0) return null;
        return { genre: group.genre, styles };
      })
      .filter((g): g is GenreGroup => g !== null);
  }, [groups, usageQuery]);

  const filteredReleases = useMemo(() => {
    if (!filterName) return [];
    return releases
      .filter((r) => r.genreStyleLinks.some((l) => l.name === filterName))
      .sort((a, b) => a.artistNames[0]?.localeCompare(b.artistNames[0] ?? "") ?? 0);
  }, [releases, filterName]);

  async function removeLink(releaseId: number, linkId: number) {
    const key = `${releaseId}:${linkId}`;
    setRemovingKeys((prev) => new Set(prev).add(key));
    setError(null);
    const previousReleases = releases;
    setReleases((prev) =>
      prev.map((r) =>
        r.id === releaseId
          ? { ...r, genreStyleLinks: r.genreStyleLinks.filter((l) => l.id !== linkId) }
          : r,
      ),
    );
    try {
      const res = await fetch(`/api/releases/${releaseId}/genres-styles`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genreStyleId: linkId }),
      });
      if (!res.ok) throw new Error("Request failed");
      const { deletedStyle } = (await res.json()) as { deletedStyle: { id: number } | null };
      // A style that just dropped to 0 releases is deleted server-side —
      // drop its card here too instead of leaving a stale 0-record entry.
      setUsage((prev) =>
        deletedStyle
          ? prev.filter((u) => u.id !== deletedStyle.id)
          : prev.map((u) =>
              u.id === linkId ? { ...u, releaseCount: Math.max(0, u.releaseCount - 1) } : u,
            ),
      );
    } catch {
      setReleases(previousReleases);
      setError("Couldn't remove that tag — try again.");
    } finally {
      setRemovingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  /** Shared by "merge into another genre/style" and "promote this style to
   * its own genre" — the latter is just a merge into a same-named genre
   * (created on the fly if it doesn't exist yet), which also correctly folds
   * into an existing genre of that name instead of erroring, since the two
   * rows differ by kind and can never collide on id. */
  async function performMerge(
    source: GenreStyleUsage,
    toName: string,
    toKind: "genre" | "style",
  ): Promise<boolean> {
    setMergingIds((prev) => new Set(prev).add(source.id));
    setError(null);
    try {
      const res = await fetch("/api/genres-styles/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId: source.id, toName, toKind }),
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw new Error(problem.error ?? "Merge failed");
      }
      const { to, toReleaseCount, movedReleaseIds } = (await res.json()) as {
        to: {
          id: number;
          name: string;
          kind: "genre" | "style";
          description: string | null;
          parentGenreId: number | null;
        };
        toReleaseCount: number;
        movedReleaseIds: number[];
      };

      const movedSet = new Set(movedReleaseIds);
      setReleases((prev) =>
        prev.map((r) => {
          if (!movedSet.has(r.id)) return r;
          const withoutSource = r.genreStyleLinks.filter((l) => l.id !== source.id);
          const hasTarget = withoutSource.some((l) => l.id === to.id);
          const nextLinks = hasTarget ? withoutSource : [...withoutSource, to];
          nextLinks.sort((a, b) => a.name.localeCompare(b.name));
          return { ...r, genreStyleLinks: nextLinks };
        }),
      );
      setUsage((prev) => {
        const withoutSourceAndOldTarget = prev.filter((u) => u.id !== source.id && u.id !== to.id);
        return [
          ...withoutSourceAndOldTarget,
          {
            id: to.id,
            name: to.name,
            kind: to.kind,
            description: to.description,
            parentGenreId: to.parentGenreId,
            releaseCount: toReleaseCount,
          },
        ];
      });
      if (filterName === source.name) setFilterName(to.name);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed");
      return false;
    } finally {
      setMergingIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  }

  async function mergeInto(source: GenreStyleUsage) {
    const toName = (mergeTargets[source.id] ?? "").trim();
    if (!toName) return;
    if (toName.toLowerCase() === source.name.toLowerCase()) {
      setError("Target is the same as the source.");
      return;
    }
    const ok = await performMerge(source, toName, source.kind);
    if (ok) {
      setMergeTargets((prev) => {
        const next = { ...prev };
        delete next[source.id];
        return next;
      });
    }
  }

  async function promoteToGenre(style: GenreStyleUsage) {
    await performMerge(style, style.name, "genre");
  }

  /** Pins a style under `genreId` in this editor's grouping only — unlike
   * Merge, it never touches release_genres_styles. Used by drag-and-drop. */
  async function setParentGenre(style: GenreStyleUsage, genreId: number) {
    setMergingIds((prev) => new Set(prev).add(style.id));
    setError(null);
    try {
      const res = await fetch(`/api/genres-styles/${style.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentGenreId: genreId }),
      });
      if (!res.ok) throw new Error("Failed to move");
      setUsage((prev) => prev.map((u) => (u.id === style.id ? { ...u, parentGenreId: genreId } : u)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move");
    } finally {
      setMergingIds((prev) => {
        const next = new Set(prev);
        next.delete(style.id);
        return next;
      });
    }
  }

  async function saveDescription(item: GenreStyleUsage) {
    const draft = descriptionDrafts[item.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    setDescriptionDrafts((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    if (trimmed === (item.description ?? "")) return;
    setSavingDescriptionIds((prev) => new Set(prev).add(item.id));
    setError(null);
    try {
      const res = await fetch(`/api/genres-styles/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: trimmed || null }),
      });
      if (!res.ok) throw new Error("Failed to save description");
      setUsage((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, description: trimmed || null } : u)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save description");
    } finally {
      setSavingDescriptionIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function deleteGenre(genre: GenreStyleUsage) {
    const message =
      genre.releaseCount > 0
        ? `Delete "${genre.name}"? It's on ${genre.releaseCount} record${genre.releaseCount === 1 ? "" : "s"} — they'll lose this genre tag entirely.`
        : `Delete "${genre.name}"?`;
    if (!window.confirm(message)) return;
    setMergingIds((prev) => new Set(prev).add(genre.id));
    setError(null);
    try {
      const res = await fetch(`/api/genres-styles/${genre.id}`, { method: "DELETE" });
      if (!res.ok) {
        // A genre with styles still pinned to it can't be deleted (a style
        // must always belong to a genre) — the server names them so the
        // error is actionable: move them elsewhere first, then retry.
        const problem = await res.json().catch(() => ({}));
        throw new Error(problem.error ?? "Failed to delete genre");
      }
      setUsage((prev) => prev.filter((u) => u.id !== genre.id));
      setReleases((prev) =>
        prev.map((r) => ({
          ...r,
          genreStyleLinks: r.genreStyleLinks.filter((l) => l.id !== genre.id),
        })),
      );
      if (filterName === genre.name) setFilterName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete genre");
    } finally {
      setMergingIds((prev) => {
        const next = new Set(prev);
        next.delete(genre.id);
        return next;
      });
    }
  }

  async function addGenre() {
    const name = newGenreName.trim();
    if (!name) return;
    setAddingGenre(true);
    setError(null);
    try {
      const res = await fetch("/api/genres-styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: "genre" }),
      });
      if (!res.ok) throw new Error("Failed to add genre");
      const created = (await res.json()) as {
        id: number;
        name: string;
        kind: "genre" | "style";
        description: string | null;
        parentGenreId: number | null;
      };
      setUsage((prev) =>
        prev.some((u) => u.id === created.id) ? prev : [...prev, { ...created, releaseCount: 0 }],
      );
      setNewGenreName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add genre");
    } finally {
      setAddingGenre(false);
    }
  }

  /** Creates a brand-new style card directly in `genre`'s column — a style
   * always belongs to exactly one genre, so `parentGenreId` is set at
   * creation time, not as a follow-up patch. */
  async function addStyle(genre: GenreStyleUsage, columnKey: string) {
    const name = (newStyleDrafts[columnKey] ?? "").trim();
    if (!name) return;
    setAddingStyleKey(columnKey);
    setError(null);
    try {
      const res = await fetch("/api/genres-styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: "style", parentGenreId: genre.id }),
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw new Error(problem.error ?? "Failed to add style");
      }
      const created = (await res.json()) as {
        id: number;
        name: string;
        kind: "genre" | "style";
        description: string | null;
        parentGenreId: number | null;
      };
      setUsage((prev) =>
        prev.some((u) => u.id === created.id)
          ? prev.map((u) => (u.id === created.id ? { ...u, parentGenreId: created.parentGenreId } : u))
          : [...prev, { ...created, releaseCount: 0 }],
      );
      setNewStyleDrafts((prev) => ({ ...prev, [columnKey]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add style");
    } finally {
      setAddingStyleKey(null);
    }
  }

  function handleCardDragStart(e: React.DragEvent<HTMLDivElement>, style: GenreStyleUsage) {
    e.dataTransfer.setData("text/plain", String(style.id));
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(style.id);
  }

  function handleCardDragEnd() {
    setDraggingId(null);
    setDragOverKey(null);
  }

  function handleColumnDragOver(e: React.DragEvent<HTMLDivElement>, key: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverKey !== key) setDragOverKey(key);
  }

  function handleColumnDrop(e: React.DragEvent<HTMLDivElement>, genre: GenreStyleUsage) {
    e.preventDefault();
    setDragOverKey(null);
    setDraggingId(null);
    const styleId = Number(e.dataTransfer.getData("text/plain"));
    const style = usage.find((u) => u.id === styleId && u.kind === "style");
    if (!style || style.parentGenreId === genre.id) return;
    void setParentGenre(style, genre.id);
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <section className="mb-10">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Merge &amp; collapse
        </h2>
        <p className="mb-3 text-sm text-zinc-500">
          Genres are columns, styles are cards — every style belongs to exactly one genre. Drag a
          card into another column to regroup it there (doesn&apos;t touch any release&apos;s
          tags). Use each column&apos;s &ldquo;+ Add style&rdquo; field to create a new style
          directly in it, or the field below to add a new genre column. A card&apos;s &ldquo;Merge
          / promote…&rdquo; link folds it into another tag or promotes it to its own genre — those
          do change release data. Descriptions are editable, saved automatically on blur.
        </p>
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={usageQuery}
            onChange={(e) => setUsageQuery(e.target.value)}
            placeholder="Filter genres &amp; styles…"
            className={`w-full ${SELECT_CLASS}`}
          />
        </div>
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={newGenreName}
            onChange={(e) => setNewGenreName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addGenre();
            }}
            placeholder="New genre column name…"
            className={`w-full ${SELECT_CLASS}`}
          />
          <button
            type="button"
            onClick={() => void addGenre()}
            disabled={addingGenre || !newGenreName.trim()}
            className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {addingGenre ? "Adding…" : "Add genre"}
          </button>
        </div>
        <datalist id="genre-style-names">
          {allNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {filteredGroups.length === 0 ? (
          <p className="rounded-lg bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:bg-zinc-900">
            No matches.
          </p>
        ) : (
          <div className="relative -mx-[calc(50vw-50%)] w-screen px-6">
            <div className="flex gap-3 overflow-x-auto pb-2">
              {filteredGroups.map((group) => {
              const key = `genre-${group.genre.id}`;
              const isDragOver = dragOverKey === key;
              return (
                <div
                  key={key}
                  className={`flex w-64 shrink-0 flex-col rounded-lg ${
                    isDragOver ? "ring-2 ring-blue-400" : ""
                  }`}
                >
                  <GenreColumnHeader
                    genre={group.genre}
                    target={mergeTargets[group.genre.id] ?? ""}
                    onTargetChange={(value) =>
                      setMergeTargets((prev) => ({ ...prev, [group.genre.id]: value }))
                    }
                    onMerge={() => void mergeInto(group.genre)}
                    onDelete={() => void deleteGenre(group.genre)}
                    busy={mergingIds.has(group.genre.id)}
                    selected={filterName === group.genre.name}
                    onSelectFilter={() => selectFilter(group.genre.name)}
                    descriptionValue={
                      descriptionDrafts[group.genre.id] ?? group.genre.description ?? ""
                    }
                    onDescriptionChange={(value) =>
                      setDescriptionDrafts((prev) => ({ ...prev, [group.genre.id]: value }))
                    }
                    onDescriptionBlur={() => void saveDescription(group.genre)}
                    descriptionSaving={savingDescriptionIds.has(group.genre.id)}
                  />
                  <div
                    onDragOver={(e) => handleColumnDragOver(e, key)}
                    onDragLeave={() => setDragOverKey((prev) => (prev === key ? null : prev))}
                    onDrop={(e) => handleColumnDrop(e, group.genre)}
                    className="flex max-h-[80rem] flex-1 flex-col gap-2 overflow-y-auto rounded-b-lg bg-zinc-50 p-2 dark:bg-zinc-900"
                  >
                    {group.styles.map((s) => (
                      <StyleCard
                        key={s.id}
                        item={s}
                        target={mergeTargets[s.id] ?? ""}
                        onTargetChange={(value) =>
                          setMergeTargets((prev) => ({ ...prev, [s.id]: value }))
                        }
                        onMerge={() => void mergeInto(s)}
                        onPromote={() => void promoteToGenre(s)}
                        onSelectFilter={() => selectFilter(s.name)}
                        selected={filterName === s.name}
                        descriptionValue={descriptionDrafts[s.id] ?? s.description ?? ""}
                        onDescriptionChange={(value) =>
                          setDescriptionDrafts((prev) => ({ ...prev, [s.id]: value }))
                        }
                        onDescriptionBlur={() => void saveDescription(s)}
                        descriptionSaving={savingDescriptionIds.has(s.id)}
                        busy={mergingIds.has(s.id)}
                        dragging={draggingId === s.id}
                        onDragStart={(e) => handleCardDragStart(e, s)}
                        onDragEnd={handleCardDragEnd}
                      />
                    ))}
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={newStyleDrafts[key] ?? ""}
                        onChange={(e) =>
                          setNewStyleDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void addStyle(group.genre, key);
                        }}
                        placeholder="+ Add style…"
                        className="w-full min-w-0 rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none dark:bg-zinc-950 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                      />
                      <button
                        type="button"
                        onClick={() => void addStyle(group.genre, key)}
                        disabled={addingStyleKey === key || !(newStyleDrafts[key] ?? "").trim()}
                        className="shrink-0 rounded-full bg-zinc-900 px-2.5 text-[11px] text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        {addingStyleKey === key ? "…" : "+"}
                      </button>
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        )}
      </section>

      <section ref={browseSectionRef}>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Browse &amp; clean up
        </h2>
        <p className="mb-3 text-sm text-zinc-500">
          Click a genre or style name above to see every record tagged with it here, then strip
          out the ones that don&apos;t belong.
        </p>

        {filterName ? (
          <p className="mb-3 text-xs text-zinc-500">
            {filteredReleases.length} record{filteredReleases.length === 1 ? "" : "s"} tagged
            &ldquo;{filterName}&rdquo;
            <button
              type="button"
              onClick={() => setFilterName("")}
              className="ml-2 underline decoration-dotted hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              clear
            </button>
          </p>
        ) : (
          <p className="mb-3 text-xs text-zinc-500">
            Nothing selected yet — click a name in the board above.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {filteredReleases.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-200 dark:bg-zinc-800">
                {r.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.coverImageUrl} alt={r.title} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <Link
                href={`/releases/${r.id}`}
                className="min-w-0 shrink-0 basis-48 hover:underline"
              >
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {r.title}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {r.artistNames.join(", ")}
                  {r.year ? ` · ${r.year}` : ""}
                </p>
              </Link>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {r.genreStyleLinks.map((l) => {
                  const key = `${r.id}:${l.id}`;
                  const isRemoving = removingKeys.has(key);
                  return (
                    <span
                      key={l.id}
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                        l.name === filterName
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      } ${isRemoving ? "opacity-50" : ""}`}
                    >
                      {l.name}
                      <button
                        type="button"
                        onClick={() => void removeLink(r.id, l.id)}
                        disabled={isRemoving}
                        aria-label={`Remove ${l.name} from ${r.title}`}
                        className="opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
