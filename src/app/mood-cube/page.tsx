import Link from "next/link";
import { listMoodCubeEntries, listGenreHierarchy } from "@/lib/releases";
import { MoodCube } from "@/components/MoodCube";

export default async function MoodCubePage() {
  const [entries, genreGroups] = await Promise.all([listMoodCubeEntries(), listGenreHierarchy()]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          &larr; Back to collection
        </Link>
        <Link href="/mood-editor" className="text-sm text-zinc-500 hover:underline">
          Edit mood axes &rarr;
        </Link>
      </div>
      <h1 className="mb-1 text-lg font-medium text-zinc-900 dark:text-zinc-50">Mood cube</h1>
      <p className="mb-6 text-sm text-zinc-500">
        The whole collection, plotted by approachability / valence / density. Drag to rotate, scroll to
        zoom, hover a point for its title.
      </p>
      <MoodCube entries={entries} genreGroups={genreGroups} />
    </main>
  );
}
