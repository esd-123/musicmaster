import Link from "next/link";

export function ReleaseCard({
  id,
  title,
  artistNames,
  year,
  coverImageUrl,
  caption,
  footer,
}: {
  id: number;
  title: string;
  artistNames: string[];
  year: number | null;
  coverImageUrl: string | null;
  /** Optional line shown below the artist/year (e.g. LLM reasoning). */
  caption?: string;
  /** Optional extra content (e.g. an action button) rendered below the card,
   * outside the navigation link so it doesn't also trigger navigation. */
  footer?: React.ReactNode;
}) {
  return (
    <div className="group flex h-full min-w-0 flex-col gap-2 rounded-2xl bg-white p-3 transition-shadow hover:shadow-md dark:bg-zinc-900">
      <Link href={`/releases/${id}`} className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="aspect-square w-full overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
          {coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverImageUrl}
              alt={title}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : null}
        </div>
        <div className="px-0.5 pb-0.5">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{title}</p>
          <p className="truncate text-xs text-zinc-500">
            {artistNames.join(", ")}
            {year ? ` · ${year}` : ""}
          </p>
          {caption ? <p className="mt-1 text-xs text-zinc-500">{caption}</p> : null}
        </div>
      </Link>
      {footer}
    </div>
  );
}
