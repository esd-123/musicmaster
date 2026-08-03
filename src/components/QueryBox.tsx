"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ReleaseCard } from "@/components/ReleaseCard";

interface Pick {
  id: number;
  title: string;
  artistNames: string[];
  year: number | null;
  coverImageUrl: string | null;
  reasoning: string;
  genres: string[];
  styles: string[];
  tags: string[];
  moods: string[];
}

interface HistoryEntry {
  id: string;
  /** Friendly display text — shown in the results heading and history list. */
  label: string;
  /** The actual text sent to the LLM for this entry (may be a longer,
   * synthesized prompt for "more like this" — kept separate from `label` so
   * the heading/history list stay readable). */
  query: string;
  /** The original typed prompt this entry's "family" is anchored to — reused
   * by "more like this" so repeated clicks don't chain into a longer and
   * longer synthesized prompt. */
  basePrompt: string;
  picks: Pick[];
  overallReasoning: string;
  createdAt: number;
}

const HISTORY_KEY = "mm_query_history";
const HISTORY_LIMIT = 20;

// A minimal external store around localStorage, read via useSyncExternalStore
// — this is the React-sanctioned way to read browser-only state without a
// server/client hydration mismatch: the server (and the client's very first,
// hydration-matching render) always see `getServerSnapshot`'s "[]", and the
// real value is swapped in by React itself immediately after, with no
// user-authored effect involved (this project's lint rules forbid calling
// setState from inside a useEffect body).
type Listener = () => void;
let historyListeners: Listener[] = [];

function notifyHistoryChanged() {
  for (const listener of historyListeners) listener();
}

function subscribeToHistory(listener: Listener) {
  historyListeners = [...historyListeners, listener];
  return () => {
    historyListeners = historyListeners.filter((l) => l !== listener);
  };
}

function getHistorySnapshot(): string {
  if (typeof window === "undefined") return "[]";
  try {
    return window.localStorage.getItem(HISTORY_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function getServerHistorySnapshot(): string {
  return "[]";
}

function writeHistory(history: HistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch {
    // Storage full or unavailable — history is a convenience, not critical.
  }
  notifyHistoryChanged();
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now(): number {
  return Date.now();
}

function findEntry(id: string, history: HistoryEntry[]): HistoryEntry | undefined {
  return id ? history.find((h) => h.id === id) : undefined;
}

function moreLikeThisQuery(basePrompt: string, pick: Pick): string {
  const genreList = [...pick.genres, ...pick.styles].join(", ") || "unknown";
  const descriptorList = [...pick.moods, ...pick.tags].join(", ");

  return (
    `${basePrompt} — strongly prioritize records similar to "${pick.title}" by ${pick.artistNames.join(", ")}. ` +
    `Its genres/styles are: ${genreList}.` +
    (descriptorList ? ` Its tags/moods are: ${descriptorList}.` : "") +
    ` That record fit because: ${pick.reasoning} ` +
    `Weight genre/style and tags/moods heavily when picking — genre closeness is a hard constraint, not just a preference: only include records that share one of this record's genres/styles (${genreList}) or an immediately adjacent one, even if a more genre-distant record would otherwise fit the mood or occasion of the original request better. Never include a record from an unrelated genre.`
  );
}

function moreLikeThisLabel(basePrompt: string, pick: Pick): string {
  return `${basePrompt} · more like "${pick.title}"`;
}

export function QueryBox({
  heading = "What do you want to listen to?",
}: {
  heading?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const askId = searchParams.get("ask") ?? "";

  // `history` is derived from localStorage via useSyncExternalStore: the
  // server render and the client's first (hydration-matching) render both
  // see "[]", and React swaps in the real value right after — so if the URL
  // already names a past search (e.g. returning via browser back), the
  // restore block below picks it up as soon as history actually arrives.
  const historyRaw = useSyncExternalStore(
    subscribeToHistory,
    getHistorySnapshot,
    getServerHistorySnapshot,
  );
  const history: HistoryEntry[] = useMemo(() => {
    try {
      return JSON.parse(historyRaw) as HistoryEntry[];
    } catch {
      return [];
    }
  }, [historyRaw]);
  const initialEntry = findEntry(askId, history);

  const [prompt, setPrompt] = useState(initialEntry?.basePrompt ?? "");
  const [basePrompt, setBasePrompt] = useState(initialEntry?.basePrompt ?? "");
  const [currentQuery, setCurrentQuery] = useState(initialEntry?.query ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Pick[] | null>(initialEntry?.picks ?? null);
  const [overallReasoning, setOverallReasoning] = useState<string | null>(
    initialEntry?.overallReasoning ?? null,
  );
  const [resultLabel, setResultLabel] = useState<string | null>(initialEntry?.label ?? null);
  const [showHistory, setShowHistory] = useState(false);

  // Tracks the `ask` id already reflected in the state above, so we can
  // detect when it changes out from under us (browser back/forward on an
  // already-mounted instance) versus when our own handlers just set it.
  // Adjusting state during render rather than in an effect, matching the
  // pattern already used in FilterControls (and required by this project's
  // react-hooks/set-state-in-effect lint rule).
  const [appliedAskId, setAppliedAskId] = useState(askId);

  // Also keep retrying (harmlessly — no-op once resolved) while `askId` is
  // set but hasn't been resolved yet: on a hard page load, the very first
  // render always sees an empty `history` (see useSyncExternalStore above),
  // so a `?ask=` link can't be resolved until React swaps in the real
  // history a moment later, at which point askId itself hasn't changed.
  const needsRestore = askId !== appliedAskId || (askId !== "" && picks === null);

  if (needsRestore) {
    if (askId !== appliedAskId) setAppliedAskId(askId);
    if (askId) {
      const entry = findEntry(askId, history);
      if (entry) {
        setPrompt(entry.basePrompt);
        setBasePrompt(entry.basePrompt);
        setCurrentQuery(entry.query);
        setResultLabel(entry.label);
        setPicks(entry.picks);
        setOverallReasoning(entry.overallReasoning);
        setError(null);
      }
    } else {
      setPicks(null);
      setOverallReasoning(null);
      setResultLabel(null);
    }
  }

  function pushAsk(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("ask", id);
    else params.delete("ask");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  async function runQuery(
    queryText: string,
    label: string,
    base: string,
    excludeIds: number[],
  ) {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: queryText, excludeIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      const entry: HistoryEntry = {
        id: newId(),
        label,
        query: queryText,
        basePrompt: base,
        picks: data.picks,
        overallReasoning: data.overallReasoning,
        createdAt: now(),
      };
      const nextHistory = [entry, ...history.filter((h) => h.label !== label)].slice(
        0,
        HISTORY_LIMIT,
      );
      writeHistory(nextHistory);

      setAppliedAskId(entry.id);
      setBasePrompt(base);
      setCurrentQuery(queryText);
      setResultLabel(label);
      setPicks(entry.picks);
      setOverallReasoning(entry.overallReasoning);
      pushAsk(entry.id);
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const text = prompt.trim();
    if (!text || loading) return;
    setPrompt(text);
    await runQuery(text, text, text, []);
  }

  async function retry() {
    if (!currentQuery || loading) return;
    const excludeIds = picks?.map((p) => p.id) ?? [];
    await runQuery(currentQuery, resultLabel ?? currentQuery, basePrompt, excludeIds);
  }

  async function moreLikeThis(pick: Pick) {
    if (!basePrompt || loading) return;
    const excludeIds = picks?.map((p) => p.id) ?? [];
    await runQuery(
      moreLikeThisQuery(basePrompt, pick),
      moreLikeThisLabel(basePrompt, pick),
      basePrompt,
      excludeIds,
    );
  }

  function clearResults() {
    setAppliedAskId("");
    setPrompt("");
    setPicks(null);
    setOverallReasoning(null);
    setResultLabel(null);
    pushAsk(null);
  }

  function openHistoryEntry(entry: HistoryEntry) {
    setShowHistory(false);
    setAppliedAskId(entry.id);
    setPrompt(entry.basePrompt);
    setBasePrompt(entry.basePrompt);
    setCurrentQuery(entry.query);
    setResultLabel(entry.label);
    setPicks(entry.picks);
    setOverallReasoning(entry.overallReasoning);
    setError(null);
    pushAsk(entry.id);
  }

  return (
    <div>
      {heading ? (
        <h1 className="mb-4 text-center text-2xl font-medium text-zinc-900 sm:text-3xl dark:text-zinc-50">
          {heading}
        </h1>
      ) : null}

      <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-black/10 bg-white p-2 shadow-sm dark:border-white/15 dark:bg-zinc-900">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. friends over, making dinner, want something fun but not too uptempo"
          className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400"
        />
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {history.length > 0 ? (
        <div className="mx-auto mt-2 max-w-2xl">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="text-xs text-zinc-400 underline decoration-dotted hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {showHistory ? "Hide" : "Show"} recent searches ({history.length})
          </button>
          {showHistory ? (
            <ul className="mt-2 max-h-64 divide-y divide-black/5 overflow-y-auto rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/15">
              {history.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => openHistoryEntry(h)}
                    className={`block w-full truncate px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      h.id === askId ? "bg-zinc-50 font-medium dark:bg-zinc-900" : ""
                    }`}
                  >
                    {h.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mx-auto mt-4 max-w-2xl text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {picks ? (
        <section className="mx-auto mt-8 max-w-6xl rounded-2xl border border-black/10 bg-zinc-50 p-6 dark:border-white/10 dark:bg-zinc-950">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
              Search results{resultLabel ? ` for "${resultLabel}"` : ""}
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={retry}
                disabled={loading}
                className="text-xs text-zinc-400 underline decoration-dotted hover:text-zinc-600 disabled:opacity-50 dark:hover:text-zinc-300"
              >
                {loading ? "Thinking…" : "Retry"}
              </button>
              <button
                type="button"
                onClick={clearResults}
                className="text-xs text-zinc-400 underline decoration-dotted hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                Clear
              </button>
            </div>
          </div>

          {overallReasoning ? (
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{overallReasoning}</p>
          ) : null}

          {picks.length > 0 ? (
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {picks.map((p) => (
                <ReleaseCard
                  key={p.id}
                  id={p.id}
                  title={p.title}
                  artistNames={p.artistNames}
                  year={p.year}
                  coverImageUrl={p.coverImageUrl}
                  caption={p.reasoning}
                  footer={
                    <button
                      type="button"
                      onClick={() => moreLikeThis(p)}
                      disabled={loading}
                      className="rounded-lg border border-black/10 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      More like this
                    </button>
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-zinc-500">
              No good matches found — try rephrasing.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
