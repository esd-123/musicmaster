# Music Master — progress snapshot

Last updated: 2026-08-03. See [CLAUDE.md](CLAUDE.md) for architecture/conventions — this file is status, not reference; it will go stale faster.

## What's built

All 4 original phases plus substantial follow-on work, all live against the user's real Discogs collection (**892 records**):

- **Discogs sync** — idempotent, rate-limit aware, capped 429 retry (fixed post-audit — see "Codebase audit" below). Existing releases are untouched on resync (deliberate change from the original "freely overwritten" design — see CLAUDE.md). New instances still get full genre/artist/track import. Releases removed from the Discogs collection since the last sync are now also deleted from the local DB (cascades to all related rows), guarded against treating an anomalous empty API response as "delete everything."
- **User tagging** — rating, notes, tags, moods; add/delete for tags+moods **and** genres/styles. No provenance/source distinction anywhere — deliberately reverted after being tried.
- **Genre/style hierarchy** — a strict, DB-enforced parent/child relationship (every style belongs to exactly one genre; genres are top-level) replacing the old co-occurrence-guessed grouping. `/genre-editor` is a Kanban UI (genres as columns, styles as draggable cards) supporting re-parent-by-drag, merge/promote, and genre delete (blocked if styles still depend on it). The top-level genre list is now hand-curated (several Discogs buckets deliberately split for finer classification — Rock → Rock/Indie/Punk-Metal, etc.), not Discogs' native list. See CLAUDE.md's "Genre/style hierarchy" section.
- **Mood axes** (`approachability`/`valence`/`density`, continuous floats in `[-1, 1]`) — a positional "vibe space" alongside the categorical genre/tag/mood system. Backfilled for all 892 releases via a hand-authored genre/style/tag/mood → axis-value mapping (~625 distinct labels judged once, not per-release LLM calls); a dedicated session built this mapping empirically by averaging real per-release mood-tag ratings rather than trusting raw genre stereotype, with a confidence-weighted blend for thin-data genres/styles. Two editing/browsing surfaces: `/mood-editor` (three linked 2D panels, in-memory undo) and `/mood-cube` (rotatable 3D three.js view, click-to-navigate). Feeds into `similarity.ts` (30% of the "if you like this" score) and the NL query shortlist prompt. See CLAUDE.md's "Mood axes" section, including the `MeshBasicMaterial`/`InstancedMesh` black-rendering gotcha.
- **Play history** — permanent, timestamped, append-only.
- **Enrichment pipeline** — Wikipedia + MusicBrainz confirmed working live. Last.fm optional (has a key, works). **Apple Music album links** — new: `appleMusicEnricher` matches releases against the free iTunes Search API (no key required) and caches a resolved album URL; **720 of 892** releases matched (the rest are niche/independent releases genuinely absent from Apple's catalog, not a bug — nightly cron keeps retrying them for free). Releases with no Apple Music match instead show a **YouTube search-link fallback** (`youtube.com/results?search_query=...`, built client-side from artist+title, no API key) — see CLAUDE.md's "Album links" section. **GetSongBPM/BPM removed entirely** (was inaccurate — see "Removed features" below). Every enrichment step is now strictly one-shot per release — the old 180-day staleness re-check was removed, since none of these sources meaningfully change once written and the non-clobbering pattern already used for `about_summary`/mood axes is the correct model everywhere, not just those two. Two new automated steps now run per release after the About Record summary: **tags/moods/style assignment** (`tagsAndStyles.ts` — LLM-picked, preferring the existing vocabulary but free to add a new label, and able to link additional existing genres/styles but never invent new ones) and **mood-axis auto-scoring** (`moodAxes.ts` — one direct LLM judgment call per release, replacing the original hand-authored mapping table for anything synced after the initial backfill). See CLAUDE.md's "Tag/genre/mood vocabulary" and "Mood axes" sections. All three metered per-release LLM steps (these two plus About Record summary generation) now give up permanently after one retry failure instead of silently re-attempting (and re-paying for) the same failing call every nightly cron run forever — a real gap caught in review, since it only applies to metered calls, not the free pull-enrichers where indefinite retry is deliberate.
- **About Record summaries** — all 892 releases have one, generated via `aboutSummary.ts`. Went through multiple quality-bug rounds (leaked scratchpad text, fragmented citation prose, truncation) — all confirmed fixed.
- **NL query** (`/query` + homepage-embedded) — two-stage pipeline (see CLAUDE.md), now factors mood-axis values into the shortlist prompt in addition to genres/tags/moods/rating. Returns 8 picks in a results grid deliberately fixed at two equal rows of 4 (`grid-cols-2 sm:grid-cols-4`, not scaling to 5 columns on `lg`). Supports **Retry**, **More like this** (genre-hard-constrained), and a **search history** (localStorage-backed).
- **Recommendations** ("if you like this") — blends Jaccard similarity over genres+tags+moods (70%) with normalized Euclidean mood-axis distance (30%), same-artist boost. Free, no LLM.
- **Tag/genre/mood backfill** — all 892 releases batch-tagged directly by the agent (not via metered API): 295 distinct tags/moods (1,712 assignments), 331 genres/styles (3,812 assignments) at the time of the original pass — the genre/style set has since been substantially restructured (hierarchy work above), so these counts are historical, not current totals.
- **Dark mode** — fixed (see "Codebase audit" below): now correctly falls back to `prefers-color-scheme: dark` when no explicit `.dark`/`.light` choice has been made, instead of rendering a broken half-light/half-dark page for OS-dark users who'd never toggled.
- **Docker deployment** — Dockerfile + docker-compose.yml + `scripts/migrate.mjs`, migration-tested locally, **never build-tested end to end** (no Docker on this dev machine — see Known Issues).

## Codebase audit (2026-08-01) — findings and current status

A read-only, file-by-file audit (`AUDIT.md`, not a to-do list, ~3,500 lines across 44 files) surfaced 15 findings. Most have since been fixed:

**Fixed:**
- Dark mode broken on first load for OS-dark users (high severity) — fixed, see above.
- `attachGenresAndArtists()` in `releases.ts` ran 2 queries per release (~1,784 round-trips/page load) instead of the grouped-aggregate pattern `buildCollectionCatalog()` already used — rewritten to batch via `inArray`.
- `buildCollectionCatalog()` was being rebuilt from scratch twice per NL query (shortlist + detail passes) — deduplicated to one call per request.
- Stale schema comment claiming `genres_styles` is "freely overwritten on resync" — updated to describe the actual no-op-on-resync behavior.
- Dead `/api/releases` GET route (nothing called it, silently dropped filter params) — deleted.
- Three separate per-file `USER_AGENT` string literals — consolidated into `src/lib/userAgent.ts`.
- `discogsFetch`'s 429 handler recursed with no cap — now `MAX_429_RETRIES = 1`, enforced.
- Stray untracked 0-byte `sqlite.db` at repo root — gone.

**Still open (low-effort duplication/consistency items, not bugs — deferred, not urgent):**
- Duplicated find-or-create-then-link logic between the genres-styles and tags API routes (a shared helper was suggested, not built).
- Five client components (`ReleaseUserPanel`, `ReleaseTagChips`, `ReleaseNotes`, `AboutRecord`, `PlayButton`) each hand-roll the same fetch → `router.refresh()` pattern instead of sharing a hook.
- `AboutRecord.tsx` uses a hand-rolled `isRegenerating` boolean instead of `useTransition` like its siblings — inconsistent but functionally fine.
- A few other low-severity items from the audit (redundant `needsEnrichment` double-checks in the enrichment loop, `listAvailableDecades`/`listAvailableYears` each doing a full table scan, no numeric request validation on API route params) were not re-verified in this pass — treat `AUDIT.md` as the source of truth for exact file/line if picking these up.

## Not started / explicitly deferred

Nothing is currently mid-flight — genre hierarchy, mood axes, the Apple Music/YouTube links, and the grid-layout fix all reached a tested, working state.

## Known issues / risks

- **Docker image has never been build-tested.** Written and migration-tested only. First real deploy should watch `docker compose logs -f` closely.
- **This is a Next.js 16.2.12 canary**, not stable Next — training data about Next.js APIs is not reliable here. Confirmed concrete gotcha: `next/script`/raw `<script>` in `layout.tsx` crashes regardless of placement; theme-init script was removed as a result. Check `node_modules/next/dist/docs/` before trusting an API's behavior.
- **The cheap shortlist model (Haiku) occasionally fails structured-output parsing twice in a row** — confirmed transient, not a logic bug. Existing retry-once + user-facing "Retry" button already handle this.
- **No per-user auth** — one shared household set of ratings/tags/notes/play history. Documented v1 assumption, never revisited.
- **MusicBrainz/Wikipedia/Apple Music enrichment has no guaranteed crosswalk to Discogs releases** — fuzzy artist+title matching, occasional mismatches possible in principle, though all three enrichers (like the removed BPM lookup never did) only accept a match when the returned artist name actually corresponds, so a wrong match should mean "no link" rather than a wrong one.
- **`drizzle-kit generate` needs an interactive TTY** for rename prompts and hard-fails in a non-interactive session — for genuine column renames (especially with a data transform, like the `challenge`→`approachability` sign flip), hand-write the migration SQL + snapshot + journal entry instead. See CLAUDE.md's "Dev environment quirks".
- **`scripts/migrate.mjs`'s `PRAGMA foreign_keys` toggle must wrap the `migrate()` call itself**, not rely on a migration file's own pragma line — a no-op inside drizzle's transaction wrapper. Bit once already on the genre/style CHECK constraint migration; will bite again on any future FK/CHECK-constraint change needing SQLite's recreate-table dance.
- **The original mood-axes backfill mapping is a scratch artifact, not checked into the repo** — only the resulting DB values persist. Releases synced after the original backfill no longer sit at the column default indefinitely, though: the enrichment pipeline now auto-scores them via a per-release LLM call (`moodAxes.ts`) instead of relying on that unrecovered mapping table.
- **iTunes Search API is unauthenticated but rate-limited (~20 req/min)** — a throttle bug during the original Apple Music backfill briefly triggered a 403 block from Apple; the fix (3s min interval) is in place, but note that Next.js keeps executing a triggered route handler server-side even after the client `curl`/request disconnects, so checking `enrichment_cache`/`sync_runs` state directly (not just the HTTP response) is the reliable way to confirm a batch job's real status.

## Removed features (so you don't go looking for them)

- **BPM** (schema table, GetSongBPM integration, query/catalog fields, release-page UI) — removed in full. Reasoning: GetSongBPM matched a single representative track to stand in for a whole album's tempo via fuzzy external-DB lookup with no ground truth; a known bad case (a chill record tagged upbeat/energetic) plus redundancy with the mood axes/tag system made removal the right call. Needs a genuinely different approach (real per-track data) if wanted again, not a resurrection of `getsongbpm.ts`.
- **Tag/genre provenance tracking** (`release_tags.source` column) — added, then explicitly reverted per user instruction. Net-zero schema change. Don't re-add without being asked.
- **Co-occurrence-based genre/style grouping** — an earlier version guessed a style's parent genre from whichever genre most often co-occurred with it on a release; removed once every style got a real, stored `parent_genre_id`, because ties were common for niche styles with only 1–2 releases. Don't reintroduce.

## Before you touch the code

- Read [CLAUDE.md](CLAUDE.md) first — architecture, conventions, and *why* several non-obvious decisions were made.
- `.env` has real secrets (Discogs token, Anthropic key, Last.fm key) — never echo it in full; edit surgically if you need to change one line.
- Typecheck (`npx tsc --noEmit`) and lint (`npm run lint`) after every change — this project's lint config catches real bugs, not just style.
- For UI changes, verify in an actual browser (the dev server may already be running externally on :3000 — check before starting a second one) — don't rely on typecheck/lint alone to mean a feature works.
- The user is cost-conscious about metered API spend — see the "cost-consciousness" convention in CLAUDE.md before writing code that calls the Anthropic API in a loop over many releases; prefer doing bulk one-time work as direct agent reasoning in the session instead.
- Before starting a new backfill/batch job (enrichment, tagging, etc.), check whether a previous run might still be executing server-side — a killed client request does not necessarily mean the server-side loop stopped (confirmed with the Apple Music backfill).
