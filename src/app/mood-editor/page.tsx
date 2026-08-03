import Link from "next/link";
import {
  listMoodCubeEntries,
  listGenreHierarchy,
  listAvailableDecades,
  listAvailableYears,
  listAllArtistNames,
} from "@/lib/releases";
import { MoodEditor } from "@/components/MoodEditor";

export default async function MoodEditorPage() {
  const [entries, genreGroups, decades, years, artistNames] = await Promise.all([
    listMoodCubeEntries(),
    listGenreHierarchy(),
    listAvailableDecades(),
    listAvailableYears(),
    listAllArtistNames(),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          &larr; Back to collection
        </Link>
        <Link href="/mood-cube" className="text-sm text-zinc-500 hover:underline">
          View mood cube &rarr;
        </Link>
      </div>
      <h1 className="mb-1 text-lg font-medium text-zinc-900 dark:text-zinc-50">Mood editor</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Filter down to a manageable set, then drag points to fine-tune approachability, valence, and
        density. Changes save automatically.
      </p>
      <MoodEditor
        entries={entries}
        genreGroups={genreGroups}
        decades={decades}
        years={years}
        artistNames={artistNames}
      />
    </main>
  );
}
