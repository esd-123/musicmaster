import {
  listReleases,
  listGenreHierarchy,
  listAvailableDecades,
  listAvailableYears,
  listAllArtistNames,
  type ReleaseSortKey,
} from "@/lib/releases";
import Link from "next/link";
import { FilterControls } from "@/components/FilterControls";
import { ReleaseCard } from "@/components/ReleaseCard";
import { QueryBox } from "@/components/QueryBox";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string; decade?: string; year?: string; sort?: string; q?: string }>;
}) {
  const { genre, decade, year, sort, q } = await searchParams;

  const [releases, genreGroups, decades, years, artistNames] = await Promise.all([
    listReleases({
      genre,
      decade: decade ? Number(decade) : undefined,
      year: year ? Number(year) : undefined,
      sortBy: (sort as ReleaseSortKey) || "recent",
      artistQuery: q,
    }),
    listGenreHierarchy(),
    listAvailableDecades(),
    listAvailableYears(),
    listAllArtistNames(),
  ]);

  const activeFilters = [q ? `"${q}"` : null, genre, decade ? `${decade}s` : null, year].filter(
    Boolean,
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-4 flex justify-end gap-4 text-sm text-zinc-500">
        <Link href="/genre-editor" className="hover:underline">
          Genre editor
        </Link>
        <Link href="/mood-editor" className="hover:underline">
          Mood editor
        </Link>
        <Link href="/mood-cube" className="hover:underline">
          Mood cube
        </Link>
      </div>
      <div className="mb-12">
        <QueryBox />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Collection</h2>
          <p className="text-sm text-zinc-500">
            {releases.length} record{releases.length === 1 ? "" : "s"}
            {activeFilters.length > 0 ? ` · ${activeFilters.join(" · ")}` : ""}
          </p>
        </div>
        <FilterControls
          genreGroups={genreGroups}
          decades={decades}
          years={years}
          artistNames={artistNames}
        />
      </div>

      {releases.length === 0 ? (
        <p className="text-zinc-500">
          No records yet. Set <code>DISCOGS_TOKEN</code> and{" "}
          <code>DISCOGS_USERNAME</code>, then trigger a sync via{" "}
          <code>POST /api/sync</code>.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {releases.map((r) => (
            <ReleaseCard key={r.id} {...r} />
          ))}
        </div>
      )}
    </main>
  );
}
