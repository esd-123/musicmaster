import Link from "next/link";
import { listReleases, listAllGenresAndStyles } from "@/lib/releases";
import { GenreFilter } from "@/components/GenreFilter";
import { ReleaseCard } from "@/components/ReleaseCard";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string }>;
}) {
  const { genre } = await searchParams;
  const [releases, genreOptions] = await Promise.all([
    listReleases(genre),
    listAllGenresAndStyles(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Music Master</h1>
          <p className="text-sm text-zinc-500">
            {releases.length} record{releases.length === 1 ? "" : "s"}
            {genre ? ` tagged "${genre}"` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/query"
            className="rounded bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-black"
          >
            Ask for a record
          </Link>
          <GenreFilter options={genreOptions} />
        </div>
      </div>

      {releases.length === 0 ? (
        <p className="text-zinc-500">
          No records yet. Set <code>DISCOGS_TOKEN</code> and{" "}
          <code>DISCOGS_USERNAME</code>, then trigger a sync via{" "}
          <code>POST /api/sync</code>.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {releases.map((r) => (
            <ReleaseCard key={r.id} {...r} />
          ))}
        </div>
      )}
    </main>
  );
}
