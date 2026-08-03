# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Music Master — project guide for Claude

A household tool for browsing a vinyl collection synced from Discogs: tagging/rating records, tracking play history, asking for recommendations in plain language, and viewing a "now playing" page per record. Single Next.js app, deployed as one Docker container on a home-network machine (NAS/Pi/always-on Mac). See [PROGRESS.md](PROGRESS.md) for current build status, known issues, and what's left.

## Commands

```bash
npm run dev          # start dev server (Turbopack) at localhost:3000
npm run build        # production build
npm run start        # run the production build (after `build`)
npm run lint         # ESLint — catches real bugs here, not just style (see Conventions)
npx tsc --noEmit     # typecheck (no dedicated script; run this after every change)

npm run db:generate  # generate a new Drizzle migration after editing src/db/schema.ts
npm run db:migrate   # apply pending migrations (drizzle-kit migrate) — creates ./data/app.db on first run
npm run db:studio    # Drizzle Studio, a visual DB browser

curl -X POST http://localhost:3000/api/sync             # trigger a Discogs sync manually
curl -X POST http://localhost:3000/api/enrichment/run    # trigger an enrichment batch manually
```

`scripts/migrate.mjs` is a second, equivalent way to apply migrations — plain JS (not TS) so it can run with no build step. It's what the Docker image runs at container startup, and what direct DB-migration work in this session has used (`node scripts/migrate.mjs`), rather than `npm run db:migrate`. Both read from `./drizzle` and do the same thing.

**No test suite is configured** (no test files, no Jest/Vitest config, no `test` script) — typecheck + lint + manual browser verification is the actual verification workflow in this repo.

## Architecture

- **Next.js 16 (App Router) + TypeScript**, single deployable serving both UI and API routes. This is a **canary/pre-release Next version with real behavioral differences from stable Next** — see `AGENTS.md` and the `next/script` gotcha under Conventions before assuming any API works the way training data suggests. When in doubt, read `node_modules/next/dist/docs/`.
- **SQLite via Drizzle ORM** (`better-sqlite3` driver), schema in `src/db/schema.ts`. Migrations in `drizzle/`, generated with `npm run db:generate`, applied with `node scripts/migrate.mjs` (used by both local dev and the Docker image's startup — `scripts/migrate.mjs` is plain JS, not TS, so it runs in the production container with no build step).
- **Tailwind v4**, dark mode applied via a `.dark`/`.light` class on `<html>` *or*, when neither is set, a `prefers-color-scheme: dark` fallback (see `@custom-variant dark` in `globals.css`) — this lets the toggle override system preference while still rendering correctly on first paint for anyone who's never toggled. See the dark-mode entry under Conventions for exactly how this loads.
- **node-cron scheduler**, booted once via `src/instrumentation.ts` → `src/lib/scheduler.ts`. Runs daily at 03:00: Discogs sync, then a batch of enrichment. Only correct with exactly one running instance — matches the single-container deployment model, would need rework for horizontal scaling.
- **Deployment**: Docker (`Dockerfile`, `docker-compose.yml`), named volume for the SQLite file. **The image has never been build-tested end to end** — this dev machine has no Docker installed. Verify a real `docker compose up -d --build` on the target machine before trusting it.

## Data model — the pull/push split, and why it changed mid-project

Two categories, originally meant to be structurally separated so sync code could never clobber user edits:

- **Catalog ("pull", Discogs-sourced)**: `releases`, `artists`/`release_artists`, `release_tracks`, `genres_styles`/`release_genres_styles`.
- **User-entered ("push")**: `user_release_data` (rating/notes), `tags`/`release_tags` (`kind`: `mood`|`tag`), `play_events` (append-only, every play is a new row — never a "last played" field).
- **Enrichment cache** (pulled, provenance-tracked): `enrichment_cache`, unique on `(release_id, source, field_key)`. `source` includes `wikipedia`/`musicbrainz`/`lastfm`/`apple_music` (raw pulled facts) and `claude` (the synthesized About Record summary — technically generated, not pulled, but cached the same way since it's still machine-produced and safe to regenerate).
- **Mood axes** (`release_mood_axes`, one row per release): three continuous floats — `approachability`/`valence`/`density` — synthesized like `about_summary` (machine-seeded, not pulled) but freely user-editable afterward like `release_tags`, and never re-backfilled once a row exists. See "Mood axes" below.

**Important departure from the original design**: `genres_styles`/`release_genres_styles` were originally "freely overwritten on every Discogs resync." That's no longer true. `src/lib/discogs/sync.ts` now does nothing at all for already-known `discogs_instance_id`s — no genre/artist/track/basic-info updates, nothing — per an explicit product decision that Discogs has no new information for a release already in the collection. Only genuinely new instances get the full detail fetch + genre/artist/track write. This is *why* genres/styles are now safely user-editable (add/delete) through the UI (`POST`/`DELETE /api/releases/[id]/genres-styles`) with **no provenance column** — there was originally a `source` column added to `release_tags` to distinguish user vs. AI-added tags, and it was explicitly reverted (see `drizzle/0002_lethal_veda.sql` + `0003_lying_paibok.sql`, net no-op) because the user didn't want that distinction anywhere in the schema. Don't reintroduce it without being asked.

`genres_styles` also carries a `description` (freeform, user-editable, folded into NL-query prompts) and a `parent_genre_id` self-reference with a *strict* invariant behind it — see "Genre/style hierarchy" below before touching either column.

`bpm` table and all GetSongBPM integration were **removed entirely** (`drizzle/0004_drop_bpm.sql`) — see PROGRESS.md for why. Don't resurrect BPM-based filtering/sorting without checking that context first.

## Tag/genre/mood vocabulary

- `genres_styles.kind`: `genre` | `style` — originally a flat Discogs-sourced controlled vocabulary; the hierarchy between the two kinds is now heavily hand-curated and DB-enforced — see "Genre/style hierarchy" below before assuming anything about how genres and styles relate.
- `tags.kind`: `tag` | `mood` — freeform, user- or agent-curated. **`tag` is structural/format facts** ("live album", "compilation", "concept album", "instrumental", "remix", "dj mix", "soundtrack", "reissue"), **`mood` is a vibe adjective** ("hazy", "dark", "upbeat", "romantic"). This distinction is deliberately spelled out in the NL-query system prompts (`src/lib/llm/query.ts`) because it measurably improved query quality — don't collapse it back into one undifferentiated "tags" bucket. Tags/moods are deliberately independent of the genre/style hierarchy — never sorted or grouped relative to it (see `ReleaseTagChips.tsx` in File map).
- All 892 releases were batch-tagged in-session (not via the metered API — see "cost-consciousness" below): 295 distinct tags/moods applied 1,712 times, 331 genres/styles applied 3,812 times, all grounded in each release's `about_summary`. These counts describe that original pass, not current totals — the genre/style set has since been substantially restructured (see below).

## Genre/style hierarchy

A strict, DB-enforced parent/child relationship between the two `genres_styles` kinds — not just a display convention:

- `kind = "genre"` — a top-level musical class. `parent_genre_id` is always `NULL`.
- `kind = "style"` — always belongs to **exactly one** genre. `parent_genre_id` is **never** `NULL`.

Enforced by the `genres_styles_parent_kind_check` CHECK constraint (`drizzle/0007_peaceful_triathlon.sql`) plus a self-referencing FK on `parent_genre_id` with no `onDelete` action — deleting a genre that still has styles pointing at it fails outright (`DELETE /api/genres-styles/[id]` returns 409, naming the dependents) rather than silently orphaning them. Every write path that touches `parent_genre_id` or creates a style (`POST`/`PATCH /api/genres-styles[/[id]]`, `POST /api/genres-styles/merge`) validates the invariant server-side first, so a bad parent/kind combination should never reach the DB layer at all.

This is completely separate from a release's own tags (`release_genres_styles`, still a plain many-to-many — one release can carry any number of genres and styles independently, per product decision). Re-parenting a style only changes where it's grouped in the genre editor; it never touches any release's tags.

`/genre-editor` (`src/components/GenreEditor.tsx`) is the UI for curating this hierarchy — genres as Kanban columns, styles as draggable cards:

- Dragging a card to another column re-parents it (`PATCH .../[id]` with `parentGenreId`) — non-destructive to release tags.
- Each column's "+ Add style" field creates a style with that column's genre baked in atomically — the API rejects creating a style without one.
- A card's "Merge / promote…" link folds it into another genre/style (deletes the source, moves its releases over) or promotes it to a genre of its own — unlike drag-to-reparent, this *does* change release data.
- A column header's "×" deletes that genre (blocked with a 409 if styles still depend on it).
- Removing the last release a style applies to auto-deletes the style (`DELETE /api/releases/[id]/genres-styles`) — a 0-record style is dead weight, not worth keeping.

`listGenreHierarchy()` (`src/lib/releases.ts`, feeds the homepage's `FilterControls` dropdown) and the genre editor's own grouping both read `parent_genre_id` directly. There's no co-occurrence inference anymore — an earlier version guessed a style's genre from whichever genre most often appeared alongside it on a release, which silently broke down for niche styles: with only 1–2 releases, ties between multiple co-occurring genres were extremely common and got resolved by whichever genre happened to be iterated first, not a real signal. Removed once every style got a real, stored parent; don't reintroduce co-occurrence-based grouping.

The top-level genre list is now hand-curated, not Discogs' native buckets — several were deliberately split for finer classification (Rock → Rock/Indie/Punk-Metal, Electronic → Electronic/Dance, Folk World & Country → Folk/Country, Funk/Soul → Funk-Disco/Soul, among others), using each style's own description plus its actual release-level co-occurrence to decide the split, with affected releases' genre tags reassigned to match. Don't assume the genre list still matches what a fresh Discogs sync would produce natively.

Watch for the same name existing as both a genre and a style (found repeatedly during this restructuring: Jazz, Blues, Reggae, Hip Hop) — a pre-existing Discogs data-quality artifact, not something the hierarchy invariant prevents (the unique index is on `(name, kind)`, so a genre and a style can legitimately share a name). Resolve by merging the style into the genre of the same name (`POST /api/genres-styles/merge` with `toKind: "genre"`), not by leaving both around.

## Mood axes (`approachability` / `valence` / `density`)

Three continuous axes in `release_mood_axes` (all floats in `[-1, 1]`), augmenting the categorical genre/tag/mood system with a continuous "vibe space" for similarity and NL-query reasoning — same goal as genres/tags (measurable input to matching), but positional rather than categorical, so two records can be "close" in mood without sharing a single tag or genre.

- **Axes and sign convention**: `approachability` (-1 challenging/experimental .. +1 approachable/easy-listening), `valence` (-1 dark .. +1 bright), `density` (-1 sparse/ambient .. +1 propulsive/frenetic). `approachability` was originally named `challenge` with the opposite sign — renamed *and* sign-flipped in one migration (`drizzle/0008_rename_challenge_to_approachability.sql`, a `RENAME COLUMN` plus an `UPDATE ... SET approachability = -approachability`). If this needs to happen again to another column, see the `drizzle-kit generate` + TTY gotcha under "Dev environment quirks" first.
- **Backfilled via a prior-mapping, not per-release LLM calls**: all 892 releases were scored by averaging a hand-authored genre/style/tag/mood → axis-value table (one judgment per distinct label, ~625 labels, not per release) — same cost-conscious reasoning as the original tag backfill (see "cost-consciousness" below). The mapping itself is a scratch file, not checked into the repo; only the resulting DB values persist. Releases synced later won't get this backfill automatically — they sit at the column default `(0, 0, 0)` until manually edited or a future backfill pass covers them.
- **User edits are the source of truth once set** — nothing re-backfills or overwrites a release's row after initial seeding, same non-clobbering posture as `release_tags`/`user_release_data`.
- **Integration**: `similarity.ts`'s "if you like this" blends Jaccard genre/tag/mood overlap (70%) with normalized Euclidean axis distance (30%) — still free, deterministic, no LLM. `query.ts`'s shortlist-pass prompt includes each release's three axis values and is told to map mood/occasion language onto them (e.g. "parents over for dinner" → high approachability) even when the request names no genre or mood word directly.
- **Two surfaces**, both fed by `listMoodCubeEntries()` (`releases.ts` — kind-split genres/styles + moodAxes; distinct from `buildCollectionCatalog()`'s flat mixed genre/style array used by the LLM pipeline):
  - `/mood-editor` (`MoodEditor.tsx`) — three linked 2D panels, each showing 2 of the 3 axes, so a drag never has more than 2 degrees of freedom (no ambiguous 3D gesture). Filtered the same way as the homepage (artist/genre/style/decade/year — not a freeform text match) before editing, since dragging stops being usable once more than ~60 points overlap on screen. Multi-step undo is in-memory only (cleared on reload, not a persisted history table), via a button and Cmd/Ctrl+Z.
  - `/mood-cube` (`MoodCube.tsx`) — rotatable/scrollable full-collection 3D view (three.js), points colored by top-level genre, filterable by the same genre/style hierarchy as the homepage. Click navigates straight to the release page, distinguished from a rotate-drag purely by a small pixel-movement threshold on pointerup (not a separate click handler).
- **three.js gotcha**: `MeshBasicMaterial({ vertexColors: true })` on an `InstancedMesh` renders solid black on the pinned three.js version here, even with a correctly-populated per-instance color buffer (confirmed non-zero instance colors; a plain solid-color material on the same mesh rendered fine). `MoodCube.tsx` works around this with one `InstancedMesh` per palette-color bucket instead of per-instance vertex colors — don't "simplify" that back to a single vertexColors mesh without re-verifying it actually renders first.

## Album links (Apple Music / YouTube fallback)

`src/lib/enrichment/appleMusic.ts` queries Apple's unauthenticated iTunes Search API (no key needed, 20 req/min cap enforced via a 3s `throttle()`) and caches a matched album URL as `enrichment_cache(source="apple_music", field_key="apple_music_url")`, same conservative match-or-nothing posture as Wikipedia/MusicBrainz (only accepts a result whose returned artist name actually contains the release's artist — never guesses). Backfilled across the full collection: 720 of 892 releases matched; the other 172 (mostly niche/independent vinyl not on Apple Music) simply have no cache row and get retried by the nightly cron at no added cost.

`src/app/releases/[id]/page.tsx` reads that cache row and, when absent, falls back to a zero-setup `youtube.com/results?search_query=<artist> <title> full album` link (no API key, lands on a search page rather than a resolved video — a deliberate simplicity-over-precision tradeoff, chosen over standing up the YouTube Data API for a fully resolved link). `ReleaseUserPanel.tsx` renders whichever one applies ("Apple Music ↗" or "YouTube ↗") next to the star rating.

**Watch out**: the iTunes endpoint returned a 403 mid-backfill once, from an early throttle bug (500ms instead of 3s) that blew through Apple's rate limit — and killing the client-side `curl` did **not** stop the server-side `runEnrichment` loop, since Next.js keeps executing the route handler after the client disconnects. If a future backfill needs restarting, check `sync_runs` / the actual `enrichment_cache` count for whether a previous run is still executing server-side before starting a new one — don't assume a killed client process means the work stopped.

## NL query architecture (two-stage, cost-driven)

`src/lib/llm/` — this was redesigned mid-project from a single call to a two-stage pipeline specifically to avoid stuffing every release's full prose summary into every query:

1. **Shortlist pass** (`SHORTLIST_MODEL`, currently Haiku) — sees the *whole* collection but only structured fields (id/artist/title/year/genres/tags/moods/rating/moodAxes, **no summary text**), returns up to ~30 candidate ids. `buildShortlistPromptText(excludeIds)` in `catalog.ts` builds this; `excludeIds` are dropped from the catalog *before* the model sees them (not filtered after), so retry/"more like this" structurally can't re-suggest what's already shown.
2. **Detail pass** (`QUERY_MODEL`, currently Sonnet) — sees only the shortlisted candidates, but *with* full `about_summary` text (capped at 800 chars via `SUMMARY_MAX_LENGTH`), picks up to 8 with reasoning.

`queryCollection(prompt, excludeIds)` in `query.ts` orchestrates both stages and both have their own retry-once-on-malformed-output logic (`parseWithRetry`). The Haiku shortlist stage occasionally fails structured-output parsing twice in a row — confirmed transient via direct testing, not a bug — the existing UI already recovers gracefully (error shown, buttons stay clickable, immediate retry works).

**"Retry" and "more like this"** (in `QueryBox.tsx`) both go through this same `excludeIds` mechanism. "More like this" additionally builds an augmented query text that includes the clicked record's genres/styles/tags/moods and instructs the model to treat genre closeness as a *hard constraint*, not just a preference — confirmed via testing that this reliably keeps results within the same genre family (e.g. clicking "more like this" on a country record won't surface hip hop or electronic picks).

## About Record summary generator (`src/lib/enrichment/aboutSummary.ts`)

- Fast path: if Wikipedia or Last.fm already has real prose, one plain generation call, no tools, cheap.
- Search path: if a release has no prose source (niche/independent releases), grants a `web_search` tool restricted to a **curated allowlist of music sites** (`ALLOWED_SEARCH_DOMAINS`), not the open web. Never fabricates — returns `null` if there's nothing groundable to say.
- Content-block handling is fiddly and deliberate: when search is used, the model's response mixes planning text (before the last tool round-trip) with citation-fragmented answer text (after it). Only blocks after the last `server_tool_use`/`web_search_tool_result` block are real content, and they're joined with `""` not `"\n"` since they're fragments of one flow, not separate paragraphs. `stripFormattingArtifacts` additionally strips leading self-talk sentences, markdown artifacts, and a leading "About this record:" lead-in. If you touch this file, don't regress this — it took several iterations to get right after real leaked-scratchpad-text bugs were found in production summaries.
- This is deliberately **not** on a recurring schedule — generated once per release (when first synced) and only regenerated on explicit user request (`POST /api/releases/[id]/regenerate-summary`), since "wrong until I say otherwise" about a summary's content is a judgment call only the user can make.

## Data access

- Release/collection queries must use the grouped aggregate pattern in `buildCollectionCatalog()` (`catalog.ts`), never per-record loops. `releases.ts` previously ran 2 queries per release (892 records → ~1,784 round-trips). Don't reintroduce per-record queries against the `releases` table.
- Build the catalog once per request and reuse it for both shortlist and detail steps. Don't call `buildCollectionCatalog()` twice in one query.
- Same discipline applies to `listMoodCubeEntries()` (`releases.ts`, the mood editor/cube's feed) — it reuses the already-batched `attachGenresAndArtists()` helper rather than adding a third per-record genre/artist join path.

## External APIs

- `discogsFetch`'s 429 handler must have a capped retry count, not open-ended recursive retry.

## Conventions

- **React state synced from an external source (URL params, localStorage) uses the "adjust state during render" pattern, not `useEffect` + `setState`.** This project's ESLint config (inherited from `eslint-config-next`'s bundled `eslint-plugin-react-hooks` — not a custom rule) enforces `react-hooks/set-state-in-effect`, which forbids calling `setState` synchronously inside a `useEffect` body. Canonical example: `FilterControls.tsx` syncing a debounced input to `searchParams`; a more involved example (including retry/dedup logic to avoid an actual infinite-render bug hit during development) is `QueryBox.tsx`'s `ask` URL param ↔ search-result restore logic.
- **Reading browser-only state (e.g. `localStorage`) without a hydration mismatch**: use `useSyncExternalStore` with a server snapshot of the empty/default value, not a `useState` lazy initializer guarded by `typeof window`. The latter causes a real (if "recoverable") hydration error whenever the client's actual value differs from the server's assumed empty one — which happens for any returning user. See `QueryBox.tsx`'s local search-history store for the pattern (a minimal listener-array-based external store).
- **`react-hooks/purity`** also flags impure calls (`Date.now()`, `crypto.randomUUID` fallback) made from *any* function defined inside a component body, even ones only ever invoked from an event handler — the linter can't always prove the reachability. Fix is to hoist such helpers to module scope (see `newId()`/`now()` at the top of `QueryBox.tsx`), not to suppress the rule.
- **Never reintroduce an inline theme-init `<script>` (raw or via `next/script`) in `layout.tsx`.** One was tried and removed for good reason: this Next canary build throws a hard client-side render error regardless of `strategy` or placement (tried inside `<head>`, as a sibling of `<body>`, and inside `<body>` after `{children}` — all failed identically). This is a confirmed crash, not a style preference — don't reintroduce one without first confirming this specific Next version actually supports it.
- **How dark mode is applied on page load** (`globals.css` + `ThemeToggle.tsx`), given the constraint above rules out the usual "inline script sets the class before paint" fix: `@custom-variant dark` in `globals.css` matches `dark:` utilities either via an explicit `.dark` class on `<html>`, or — when neither `.dark` nor `.light` is present — via `prefers-color-scheme: dark`, mirroring the plain-CSS-variable fallback already used for `--background`/`--foreground`/`--card-background`. That makes the no-explicit-choice case (the common one) render correctly from first paint with zero JS, since it's pure CSS — no flash, no broken styling. `ThemeToggle.tsx`'s mount `useEffect` only handles the *other* case: re-applying a previously stored explicit choice (`localStorage.theme`) by setting `.dark`/`.light` on `<html>`, since nothing else does this on load (this was silently broken before — the class was set on toggle-click but never read back on the next visit, so an explicit choice didn't survive a reload at all). One frame of flash-to-system-default remains for a user whose stored choice differs from their OS default, before the effect corrects it — that's the accepted, now-unavoidable tradeoff given the script restriction above; don't try to eliminate it by adding a script.
- **Cost-consciousness is a standing, explicit user preference**, not a one-off ask — see the memory file `feedback_present_tradeoffs.md`. When there's a cheap option and an expensive one (in real API dollar cost, *or* complexity/effort), lay out the upside/downside of both plus a recommendation, and let the user choose — don't default to either silently. For genuinely one-time/bulk backfill work where both "write app code hitting the metered `ANTHROPIC_API_KEY`" and "do it as direct agent reasoning in this session" are viable, prefer the latter — that's how all 892 releases got tagged (see `insert_tags.js` pattern referenced in session history, not currently in the repo — it was a scratch script). The app's *own* unattended automation (nightly sync + enrichment, which must run without a human present) legitimately needs its own API key; that's a deliberate, accepted exception, not an inconsistency.
- **One shared `USER_AGENT` constant** (`src/lib/userAgent.ts`), used by the Discogs client and the Wikipedia/MusicBrainz enrichers. Don't declare a new one per file.

## Dev environment quirks

- This Mac has no Homebrew/global Node preinstalled. A project-local Node lives at `.tools/node/bin` — export it onto `PATH` for every Bash command that needs `node`/`npm`/`npx` (it does not persist across tool calls).
- Scratch scripts that need `better-sqlite3` (e.g. one-off DB backfills) must either live inside the project tree (where they then get linted by `eslint.config.mjs`, which has no exclusion for stray `.js` files — expect `@typescript-eslint/no-require-imports` failures) or run from the scratchpad with `NODE_PATH=/Users/esd/Claude/MusicMaster/node_modules` exported so `require("better-sqlite3")` resolves. The latter is the pattern actually in use — keeps scratch work out of the linted tree entirely.
- The dev server on port 3000 may already be running as an external process (not started by the current session) — check `lsof -i :3000` before assuming you need to start one; attach a browser tab directly rather than spawning a second server.
- **`scripts/migrate.mjs` toggles `PRAGMA foreign_keys` around the `migrate()` call itself**, not just relying on a migration file's own `PRAGMA foreign_keys=OFF;` line. That pragma is a no-op inside an active transaction, and drizzle's migrator wraps the whole migration file in one — so any migration needing SQLite's recreate-table dance (adding a CHECK constraint, changing an FK's `onDelete` behavior) fails with `FOREIGN KEY constraint failed` on the `DROP TABLE` step without this. Hit for real while adding `genres_styles_parent_kind_check`.
- **`npm run db:generate` (`drizzle-kit generate`) needs an interactive TTY** to prompt "did you rename column X to Y?" whenever a schema edit could be a rename — it hard-fails (`Interactive prompts require a TTY terminal`) rather than falling back to a default in a Bash-tool session. For a genuine rename (especially one that also needs a data transform, like the `challenge`→`approachability` sign flip), don't let it silently drop+recreate the column instead: hand-write the migration SQL, add a new `drizzle/meta/NNNN_snapshot.json` (copy the previous snapshot, edit just the renamed/changed column), and append a matching entry to `drizzle/meta/_journal.json` yourself.

## File map (non-obvious parts)

- `src/lib/discogs/sync.ts` — full collection sync; existing releases are now a no-op (see above).
- `src/lib/enrichment/run.ts` — orchestrates Wikipedia/MusicBrainz/Last.fm/Apple Music pulls + About Record summary generation for releases missing/stale data; never touches `user_release_data` or `release_tags`.
- `src/lib/enrichment/appleMusic.ts` — see "Album links" above.
- `src/lib/llm/catalog.ts` / `query.ts` — two-stage NL query (see above).
- `src/lib/recommendations/similarity.ts` — "if you like this": Jaccard overlap over `genres+tags+moods` combined into one set, blended with mood-axis distance (see "Mood axes" above), same-artist boost. Free, deterministic, no LLM. Already picks up new tags/genres automatically since it reads live from `buildCollectionCatalog()`.
- `src/components/QueryBox.tsx` — the NL query UI (homepage + `/query`), including search history (localStorage), retry, and "more like this". The most stateful/subtle client component in the app — read the comments before modifying its render-time sync logic. The results grid is deliberately fixed at `grid-cols-2 sm:grid-cols-4` (not scaling up to 5 columns on `lg` like a typical responsive grid) so the up-to-8 picks always render as two equal rows of 4.
- `src/components/ReleaseTagChips.tsx` / `ReleaseUserPanel.tsx` / `ReleaseNotes.tsx` — release detail page's editable genre/tag/mood/rating/notes UI, split into three components deliberately (see PROGRESS.md for the layout history) so each piece can be positioned independently on the page. `ReleaseTagChips` renders three visually distinct, ordered groups — genres first (bold, blue), then styles (smaller, plain), then tags/moods (unchanged, independent of the genre/style hierarchy) — not one undifferentiated chip row.
- `src/components/ReleaseCard.tsx` — shared release tile (homepage grid, release detail recommendations, NL query results). `h-full` on the outer card + `flex-1` on the inner `Link` exist so an optional `footer` (e.g. the query results' "More like this" button) always sits at the same y-position across a row, regardless of how long the optional `caption` text is — don't strip either class as apparently-unused styling.
- `src/components/GenreEditor.tsx` (`/genre-editor` page) — the Kanban genre/style hierarchy editor; see "Genre/style hierarchy" above. Backed by `src/app/api/genres-styles/route.ts` (create), `[id]/route.ts` (patch description/parent, delete), and `merge/route.ts` (fold one genre/style into another, or promote a style to its own genre).
- `src/components/FilterControls.tsx`'s genre/style dropdown renders each genre and its styles as a flat run of `<option>`s inside a `Fragment`, not an `<optgroup>` — an `<optgroup>` label previously duplicated the already-clickable genre option with an unclickable, differently-styled copy directly above it. Don't reintroduce the `<optgroup>` wrapper. Its artist-search input is paired with a `<datalist>` of every distinct artist name (`listAllArtistNames()` in `releases.ts`) for native browser autocomplete — no custom dropdown JS. `MoodEditor.tsx` mirrors both of these (the flat-Fragment genre dropdown and the artist datalist) for its own filters; keep them in sync if either changes.
- `src/components/MoodEditor.tsx` (`/mood-editor`) and `src/components/MoodCube.tsx` (`/mood-cube`) — see "Mood axes" above.
