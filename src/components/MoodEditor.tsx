"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

export interface MoodEditorEntry {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  genres: string[];
  styles: string[];
  moodAxes: { approachability: number; valence: number; density: number };
  moodAxesSource: "seeded" | "manual";
  moodAxesAuto: { approachability: number; valence: number; density: number } | null;
}

interface GenreGroup {
  genre: string;
  styles: string[];
}

type Axes = { approachability: number; valence: number; density: number };
type AxisKey = keyof Axes;

const MAX_VISIBLE = 60;
const PAD = 24;
const SIZE = 260;
const MAX_UNDO = 50;
const SELECT_CLASS =
  "rounded-full bg-white px-4 py-2 text-sm text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none dark:bg-zinc-900 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]";
// Non-breaking space so indentation survives whitespace collapsing in <option> rendering.
const INDENT = "    ";

function axesEqual(a: Axes, b: Axes): boolean {
  return (
    a.approachability === b.approachability && a.valence === b.valence && a.density === b.density
  );
}

interface Quadrants {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
}

interface Panel {
  xKey: AxisKey;
  yKey: AxisKey;
  title: string;
  // One short label per quadrant (combining what both axes mean at that
  // corner) instead of four independent edge labels — reads faster than
  // mentally combining two separate axis extremes yourself.
  quadrants: Quadrants;
}

const PANELS: Panel[] = [
  {
    xKey: "valence",
    yKey: "approachability",
    title: "Valence (x) vs Approachability (y)",
    quadrants: {
      topLeft: "gentle melancholy", // dark + approachable
      topRight: "feel-good & easy", // bright + approachable
      bottomLeft: "bleak & demanding", // dark + challenging
      bottomRight: "upbeat & complex", // bright + challenging
    },
  },
  {
    xKey: "density",
    yKey: "valence",
    title: "Density (x) vs Valence (y)",
    quadrants: {
      topLeft: "serene & light", // sparse + bright
      topRight: "euphoric energy", // propulsive + bright
      bottomLeft: "somber & still", // sparse + dark
      bottomRight: "intense & driving", // propulsive + dark
    },
  },
  {
    xKey: "approachability",
    yKey: "density",
    title: "Approachability (x) vs Density (y)",
    quadrants: {
      topLeft: "intense & complex", // challenging + propulsive
      topRight: "easy groove", // approachable + propulsive
      bottomLeft: "austere & difficult", // challenging + sparse
      bottomRight: "easy & gentle", // approachable + sparse
    },
  },
];

function valToPx(v: number): number {
  return PAD + ((v + 1) / 2) * (SIZE - 2 * PAD);
}

function pxToVal(px: number): number {
  return Math.max(-1, Math.min(1, ((px - PAD) / (SIZE - 2 * PAD)) * 2 - 1));
}

function fmt(v: number): string {
  return v.toFixed(2);
}

export function MoodEditor({
  entries,
  genreGroups,
  decades,
  years,
  artistNames,
}: {
  entries: MoodEditorEntry[];
  genreGroups: GenreGroup[];
  decades: number[];
  years: number[];
  artistNames: string[];
}) {
  const [axesById, setAxesById] = useState<Map<number, Axes>>(
    () => new Map(entries.map((e) => [e.id, { ...e.moodAxes }])),
  );
  const [sourceById, setSourceById] = useState<Map<number, "seeded" | "manual">>(
    () => new Map(entries.map((e) => [e.id, e.moodAxesSource])),
  );
  const [artistQuery, setArtistQuery] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [decadeFilter, setDecadeFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: number; xKey: AxisKey; yKey: AxisKey } | null>(null);
  // Snapshot of a point's axes taken right before a drag/slider gesture starts,
  // so pointer-up can tell whether anything actually changed and, if so, what
  // to restore on undo.
  const preDragAxesRef = useRef<{ id: number; axes: Axes } | null>(null);
  const undoStackRef = useRef<{ id: number; previous: Axes }[]>([]);
  // Mirrors undoStackRef's length/top for rendering — refs can't be read
  // during render, so the button's label/target is tracked as state instead.
  const [undoTop, setUndoTop] = useState<{ id: number; count: number } | null>(null);

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const matchedEntries = useMemo(() => {
    const q = artistQuery.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !e.artist.toLowerCase().includes(q)) return false;
      if (genreFilter && !e.genres.includes(genreFilter) && !e.styles.includes(genreFilter)) {
        return false;
      }
      if (decadeFilter) {
        const decade = e.year !== null ? Math.floor(e.year / 10) * 10 : null;
        if (decade !== Number(decadeFilter)) return false;
      }
      if (yearFilter && e.year !== Number(yearFilter)) return false;
      if (needsReviewOnly && sourceById.get(e.id) !== "seeded") return false;
      return true;
    });
  }, [entries, artistQuery, genreFilter, decadeFilter, yearFilter, needsReviewOnly, sourceById]);

  const filtered = useMemo(() => matchedEntries.slice(0, MAX_VISIBLE), [matchedEntries]);
  const totalMatches = matchedEntries.length;

  const persist = useCallback(async (id: number, axes: Axes) => {
    setSaving((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/releases/${id}/mood-axes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(axes),
      });
      // The route always marks a PATCH'd row "manual" — mirror that
      // optimistically rather than waiting on the response body.
      setSourceById((prev) => new Map(prev).set(id, "manual"));
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const updatePoint = useCallback((id: number, patch: Partial<Axes>) => {
    setAxesById((prev) => {
      const next = new Map(prev);
      const current = next.get(id) ?? { approachability: 0, valence: 0, density: 0 };
      next.set(id, { ...current, ...patch });
      return next;
    });
  }, []);

  const pushUndo = useCallback((id: number, previous: Axes) => {
    const stack = undoStackRef.current;
    stack.push({ id, previous });
    if (stack.length > MAX_UNDO) stack.shift();
    setUndoTop({ id, count: stack.length });
  }, []);

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    const last = stack.pop();
    if (!last) return;
    const top = stack[stack.length - 1];
    setUndoTop(top ? { id: top.id, count: stack.length } : null);
    updatePoint(last.id, last.previous);
    setSelectedId(last.id);
    void persist(last.id, last.previous);
  }, [updatePoint, persist]);

  function beginGesture(id: number) {
    preDragAxesRef.current = {
      id,
      axes: axesById.get(id) ?? { approachability: 0, valence: 0, density: 0 },
    };
  }

  /** Compares current axes to the pre-gesture snapshot; pushes an undo entry
   * and persists only if the gesture actually moved something (a plain click
   * to select shouldn't create a no-op undo step or an API call). */
  function endGesture(id: number) {
    const before = preDragAxesRef.current;
    preDragAxesRef.current = null;
    const current = axesById.get(id);
    if (!before || !current || before.id !== id || axesEqual(before.axes, current)) return;
    pushUndo(id, before.axes);
    void persist(id, current);
  }

  function handlePointerDown(id: number, xKey: AxisKey, yKey: AxisKey) {
    setSelectedId(id);
    dragRef.current = { id, xKey, yKey };
    beginGesture(id);
  }

  function handlePanelPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    updatePoint(drag.id, {
      [drag.xKey]: pxToVal(px),
      [drag.yKey]: pxToVal(SIZE - py),
    } as Partial<Axes>);
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    endGesture(drag.id);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isUndoShortcut = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z";
      if (!isUndoShortcut) return;
      // Don't hijack the browser's native text-field undo (e.g. the filter box).
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === "text") return;
      e.preventDefault();
      handleUndo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo]);

  const selected = selectedId !== null ? byId.get(selectedId) : undefined;
  const selectedAxes = selectedId !== null ? axesById.get(selectedId) : undefined;
  const undoCount = undoTop?.count ?? 0;
  const undoTarget = undoTop ? byId.get(undoTop.id) : undefined;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={artistQuery}
          onChange={(e) => setArtistQuery(e.target.value)}
          placeholder="Search artist…"
          list="mood-editor-artist-suggestions"
          className={SELECT_CLASS}
        />
        <datalist id="mood-editor-artist-suggestions">
          {artistNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <select
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All genres &amp; styles</option>
          {genreGroups.map((group) => (
            <Fragment key={group.genre}>
              <option value={group.genre}>{group.genre}</option>
              {group.styles.map((style) => (
                <option key={style} value={style}>
                  {INDENT}
                  {style}
                </option>
              ))}
            </Fragment>
          ))}
        </select>

        <select
          value={decadeFilter}
          onChange={(e) => setDecadeFilter(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All decades</option>
          {decades.map((d) => (
            <option key={d} value={d}>
              {d}s
            </option>
          ))}
        </select>

        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] dark:bg-zinc-900 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
          <input
            type="checkbox"
            checked={needsReviewOnly}
            onChange={(e) => setNeedsReviewOnly(e.target.checked)}
            className="accent-emerald-600"
          />
          Needs review only
        </label>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <p className="text-xs text-zinc-500">
            {totalMatches === 0
              ? "No matches."
              : totalMatches > MAX_VISIBLE
                ? `Showing ${MAX_VISIBLE} of ${totalMatches} matches — narrow your filters to see the rest.`
                : `${totalMatches} record${totalMatches === 1 ? "" : "s"}`}
          </p>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" />
              Auto-generated
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-500" />
              Manually set
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleUndo}
          disabled={undoCount === 0}
          title={undoTarget ? `Undo: ${undoTarget.title} — ${undoTarget.artist}` : "Nothing to undo"}
          className="shrink-0 rounded-full bg-white px-4 py-2 text-sm text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-900 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
        >
          Undo{undoCount > 0 ? ` (${undoCount})` : ""}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {PANELS.map((panel) => (
          <div key={panel.title}>
            <h3 className="mb-2 text-center text-base font-medium text-zinc-900 dark:text-zinc-50">
              {panel.title}
            </h3>
            <div className="relative">
              <svg
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                onPointerMove={handlePanelPointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className="w-full touch-none rounded-lg bg-zinc-50 dark:bg-zinc-900"
              >
              <line
                x1={PAD}
                y1={SIZE / 2}
                x2={SIZE - PAD}
                y2={SIZE / 2}
                stroke="currentColor"
                strokeWidth={1}
                className="text-zinc-300 dark:text-zinc-700"
              />
              <line
                x1={SIZE / 2}
                y1={PAD}
                x2={SIZE / 2}
                y2={SIZE - PAD}
                stroke="currentColor"
                strokeWidth={1}
                className="text-zinc-300 dark:text-zinc-700"
              />
              <rect
                x={PAD}
                y={PAD}
                width={SIZE - 2 * PAD}
                height={SIZE - 2 * PAD}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                className="text-zinc-300 dark:text-zinc-700"
              />
              {filtered.map((entry) => {
                const axes = axesById.get(entry.id) ?? entry.moodAxes;
                const cx = valToPx(axes[panel.xKey]);
                const cy = SIZE - valToPx(axes[panel.yKey]);
                const isSelected = entry.id === selectedId;
                const isManual = sourceById.get(entry.id) === "manual";
                const fillClass = isSelected
                  ? "fill-orange-500"
                  : isManual
                    ? "fill-sky-500"
                    : "fill-emerald-600";
                return (
                  <circle
                    key={entry.id}
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 7 : 5}
                    className={`cursor-grab stroke-white dark:stroke-zinc-900 ${fillClass}`}
                    strokeWidth={1.5}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      handlePointerDown(entry.id, panel.xKey, panel.yKey);
                    }}
                    onPointerEnter={(e) =>
                      setHover({ text: `${entry.title} — ${entry.artist}`, x: e.clientX, y: e.clientY })
                    }
                    onPointerMove={(e) =>
                      setHover({ text: `${entry.title} — ${entry.artist}`, x: e.clientX, y: e.clientY })
                    }
                    onPointerLeave={() => setHover(null)}
                  />
                );
              })}
            </svg>
              <span className="pointer-events-none absolute left-1.5 top-1.5 max-w-[45%] rounded bg-zinc-50/90 px-1 text-[10px] leading-tight text-zinc-500 dark:bg-zinc-900/90 dark:text-zinc-400">
                {panel.quadrants.topLeft}
              </span>
              <span className="pointer-events-none absolute right-1.5 top-1.5 max-w-[45%] rounded bg-zinc-50/90 px-1 text-right text-[10px] leading-tight text-zinc-500 dark:bg-zinc-900/90 dark:text-zinc-400">
                {panel.quadrants.topRight}
              </span>
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 max-w-[45%] rounded bg-zinc-50/90 px-1 text-[10px] leading-tight text-zinc-500 dark:bg-zinc-900/90 dark:text-zinc-400">
                {panel.quadrants.bottomLeft}
              </span>
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 max-w-[45%] rounded bg-zinc-50/90 px-1 text-right text-[10px] leading-tight text-zinc-500 dark:bg-zinc-900/90 dark:text-zinc-400">
                {panel.quadrants.bottomRight}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg bg-zinc-50 px-4 py-3 text-sm dark:bg-zinc-900">
        {!selected || !selectedAxes ? (
          <p className="text-zinc-500">Click or drag a point to select it.</p>
        ) : (
          <div>
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              {selected.title} — {selected.artist}{" "}
              <Link
                href={`/releases/${selected.id}`}
                className="text-xs font-normal text-zinc-500 hover:underline"
              >
                View release &rarr;
              </Link>
              {saving.has(selected.id) && (
                <span className="ml-2 text-xs font-normal text-zinc-400">saving…</span>
              )}
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(["approachability", "valence", "density"] as AxisKey[]).map((key) => (
                <label key={key} className="flex flex-col gap-1 text-xs text-zinc-500">
                  <span className="capitalize">
                    {key}: {fmt(selectedAxes[key])}
                    {selected.moodAxesAuto && (
                      <span className="ml-1 font-normal text-emerald-600 dark:text-emerald-500">
                        (auto: {fmt(selected.moodAxesAuto[key])})
                      </span>
                    )}
                  </span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={selectedAxes[key]}
                    onPointerDown={() => beginGesture(selected.id)}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      updatePoint(selected.id, { [key]: value } as Partial<Axes>);
                    }}
                    onPointerUp={() => endGesture(selected.id)}
                  />
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {hover && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-white px-2 py-1 text-xs text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] dark:bg-zinc-800 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}
