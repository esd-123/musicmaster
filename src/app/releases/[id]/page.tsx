import { notFound } from "next/navigation";
import Link from "next/link";
import { getReleaseDetail } from "@/lib/releases";
import { ReleaseUserPanel } from "@/components/ReleaseUserPanel";
import { MoodAxesEditor } from "@/components/MoodAxesEditor";
import { ReleaseTagChips } from "@/components/ReleaseTagChips";
import { ReleaseNotes } from "@/components/ReleaseNotes";
import { PlayButton } from "@/components/PlayButton";
import { PlayHistory } from "@/components/PlayHistory";
import { AboutRecord } from "@/components/AboutRecord";
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

  const appleMusicUrl =
    release.enrichment.find(
      (r) => r.source === "apple_music" && r.fieldKey === "apple_music_url",
    )?.fieldValue ?? null;

  // No free/unauthenticated YouTube search API exists, so — unlike the
  // Apple Music link — this is a search-results URL, not a resolved video.
  const youtubeSearchUrl = appleMusicUrl
    ? null
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${release.artistNames.join(" ")} ${release.title} full album`,
      )}`;

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

        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{release.title}</h1>
              <p className="text-zinc-500">
                {release.artistNames.join(", ")}
                {release.year ? ` · ${release.year}` : ""}
              </p>
              {release.format || release.label ? (
                <p className="mt-1 text-sm text-zinc-500">
                  {[release.format, release.label].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-center gap-2">
              <PlayButton releaseId={release.id} />
              {appleMusicUrl ? (
                <a
                  href={appleMusicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-500 hover:underline"
                >
                  Apple Music ↗
                </a>
              ) : youtubeSearchUrl ? (
                <a
                  href={youtubeSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-500 hover:underline"
                >
                  YouTube ↗
                </a>
              ) : null}
            </div>
          </div>

          <hr className="mt-4 border-black/10 dark:border-white/10" />

          <div className="flex flex-1 flex-col justify-center">
            <ReleaseTagChips
              releaseId={release.id}
              genreStyles={release.genreStyleTags}
              tags={release.tags}
            />

            <ReleaseUserPanel
              releaseId={release.id}
              initialRating={release.userData?.rating ?? null}
            />
          </div>
        </div>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <ReleaseNotes releaseId={release.id} initialNotes={release.userData?.notes ?? null} />
        <MoodAxesEditor releaseId={release.id} initialAxes={release.moodAxes} />
      </div>

      <AboutRecord releaseId={release.id} rows={release.enrichment} />

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

      <PlayHistory plays={release.plays} />

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
    </main>
  );
}
