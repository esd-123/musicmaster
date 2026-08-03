import Link from "next/link";
import { listReleasesForGenreEditor, listGenreStyleUsage } from "@/lib/releases";
import { GenreEditor } from "@/components/GenreEditor";

export default async function GenreEditorPage() {
  const [releases, usage] = await Promise.all([
    listReleasesForGenreEditor(),
    listGenreStyleUsage(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          &larr; Back to collection
        </Link>
      </div>
      <h1 className="mb-1 text-lg font-medium text-zinc-900 dark:text-zinc-50">Genre editor</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Merge niche genres/styles into broader ones, or filter to one and strip it from records
        that don&apos;t belong. Changes save automatically.
      </p>
      <GenreEditor releases={releases} usage={usage} />
    </main>
  );
}
