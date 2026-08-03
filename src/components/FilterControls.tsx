"use client";

import { Fragment, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface GenreGroup {
  genre: string;
  styles: string[];
}

const SELECT_CLASS =
  "rounded-full bg-white px-4 py-2 text-sm text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none dark:bg-zinc-900 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]";

// Non-breaking space (U+00A0), not a plain space, so indentation survives
// whitespace collapsing in native <option> rendering across browsers.
const INDENT = "    ";

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "recent", label: "Recently added" },
  { value: "artist", label: "Artist" },
  { value: "genre", label: "Genre" },
  { value: "label", label: "Label" },
  { value: "year", label: "Release year" },
];

export function FilterControls({
  genreGroups,
  decades,
  years,
  artistNames,
}: {
  genreGroups: GenreGroup[];
  decades: number[];
  years: number[];
  artistNames: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  const urlQuery = searchParams.get("q") ?? "";
  const [artistQuery, setArtistQuery] = useState(urlQuery);
  const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync if the URL changes from elsewhere (e.g. back/forward
  // nav) — updating state during render (not in an effect) per React's
  // "adjusting state when a prop changes" pattern.
  if (urlQuery !== syncedUrlQuery) {
    setSyncedUrlQuery(urlQuery);
    setArtistQuery(urlQuery);
  }

  function handleArtistQueryChange(value: string) {
    setArtistQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setParam("q", value), 300);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={artistQuery}
        onChange={(e) => handleArtistQueryChange(e.target.value)}
        placeholder="Search artist…"
        list="artist-suggestions"
        className={SELECT_CLASS}
      />
      <datalist id="artist-suggestions">
        {artistNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <select
        value={searchParams.get("genre") ?? ""}
        onChange={(e) => setParam("genre", e.target.value)}
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
        value={searchParams.get("decade") ?? ""}
        onChange={(e) => setParam("decade", e.target.value)}
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
        value={searchParams.get("year") ?? ""}
        onChange={(e) => setParam("year", e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">All years</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("sort") ?? "recent"}
        onChange={(e) => setParam("sort", e.target.value)}
        className={SELECT_CLASS}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            Sort: {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
