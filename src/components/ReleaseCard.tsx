import Link from "next/link";

export function ReleaseCard({
  id,
  title,
  artistNames,
  year,
  coverImageUrl,
  caption,
}: {
  id: number;
  title: string;
  artistNames: string[];
  year: number | null;
  coverImageUrl: string | null;
  /** Optional line shown below the artist/year (e.g. LLM reasoning). */
  caption?: string;
}) {
  return (
    <Link href={`/releases/${id}`} className="group flex min-w-0 flex-col gap-2">
      <div className="aspect-square w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
        {coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : null}
      </div>
      <div>
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-zinc-500">
          {artistNames.join(", ")}
          {year ? ` · ${year}` : ""}
        </p>
        {caption ? <p className="mt-1 text-xs text-zinc-500">{caption}</p> : null}
      </div>
    </Link>
  );
}
