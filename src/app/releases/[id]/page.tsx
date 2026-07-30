import { notFound } from "next/navigation";
import Link from "next/link";
import { getReleaseDetail } from "@/lib/releases";
import { stripDiscogsMarkup } from "@/lib/discogsMarkup";
import { ReleaseUserPanel } from "@/components/ReleaseUserPanel";
import { PlayHistory } from "@/components/PlayHistory";
import { EnrichmentPanel } from "@/components/EnrichmentPanel";
import { ReleaseCard } from "@/components/ReleaseCard";
import { getRecommendations } from "@/lib/recommendations/similarity";
import { getReleasesByIds } from "@/lib/releases";

function formatDuration(seconds: number | null) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function ReleasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const release = await getReleaseDetail(Number(id));
  if (!release) notFound();

  const recs = await getRecommendations(release.id);
  const recommendations = await getReleasesByIds(recs.map((r) => r.id));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to collection
      </Link>

      <div className="mt-4 flex flex-col gap-6 sm:flex-row">
        <div className="w-full max-w-xs shrink-0">
          {release.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={release.coverImageUrl}
              alt={release.title}
              className="w-full rounded bg-zinc-100 dark:bg-zinc-900"
            />
          ) : null}
        </div>

        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{release.title}</h1>
          <p className="text-zinc-500">
            {release.artistNames.join(", ")}
            {release.year ? ` · ${release.year}` : ""}
          </p>
          {release.format ? (
            <p className="mt-1 text-sm text-zinc-500">{release.format}</p>
          ) : null}

          {(release.genres.length > 0 || release.styles.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {[...release.genres, ...release.styles].map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs dark:bg-zinc-900"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {release.bpm ? (
            <p className="mt-3 text-sm text-zinc-500">
              {Math.round(release.bpm.bpm)} BPM
              <span className="text-zinc-400"> · {release.bpm.source}</span>
            </p>
          ) : null}

          <ReleaseUserPanel
            releaseId={release.id}
            initialRating={release.userData?.rating ?? null}
            initialNotes={release.userData?.notes ?? null}
            initialTags={release.tags}
          />
        </div>
      </div>

      {release.tracks.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Tracklist
          </h2>
          <ol className="divide-y divide-black/5 dark:divide-white/10">
            {release.tracks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-8 shrink-0 text-zinc-400">{t.position}</span>
                <span className="flex-1">{t.title}</span>
                <span className="text-zinc-400">
                  {formatDuration(t.durationSeconds)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <PlayHistory releaseId={release.id} plays={release.plays} />

      <EnrichmentPanel rows={release.enrichment} />

      {recommendations.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            If you like this
          </h2>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            {recommendations.map((r) => (
              <ReleaseCard key={r.id} {...r} />
            ))}
          </div>
        </section>
      )}

      {release.discogsNotes ? (
        <section className="mt-10">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Notes
          </h2>
          <p className="whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">
            {stripDiscogsMarkup(release.discogsNotes)}
          </p>
        </section>
      ) : null}
    </main>
  );
}
