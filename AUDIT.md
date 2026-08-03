# Music Master — Codebase Audit (Pass 2)

Read-only audit, re-run from scratch. The codebase grew substantially since the first pass — from 44 files/~3,500 lines to 55 files/~6,100 lines (mood-axes system, genre hierarchy editor, mood cube 3D view, and Apple Music enrichment were added in the interim) — so this pass re-reads every file, not just a diff.

Nothing in this document has been fixed yet except where explicitly marked. Severity is my judgment of user/dev impact, not a formal SLA.

---

## Status of the first pass's findings

Verified against the current code:

| # | Finding | Status |
|---|---|---|
| 1 | Dark mode broken for OS-dark users on first load | **Fixed** (this session) — verified again this pass, still correct |
| 2 | N+1 query pattern in `attachGenresAndArtists` | **Fixed** — and the new `listReleasesForGenreEditor()` in `releases.ts` correctly follows the same batched pattern rather than reintroducing per-release queries |
| 3 | `buildCollectionCatalog()` refetched twice per NL query | **Fixed** — still correct, and now also correctly threads `moodAxes` through both stages |
| 4 | Duplicated find-or-create-then-link logic (genres-styles vs tags routes) | **Still open, and worse** — see finding #2 below, a third near-identical implementation was added |
| 5 | Repeated fetch+refresh boilerplate across components | Still open, unchanged |
| 6 | Stale "freely overwritten on resync" comment in `schema.ts` | **Fixed** |
| 7 | Stray untracked `sqlite.db` at repo root | **Fixed** |
| 8 | `discogsFetch`'s unbounded 429 retry recursion | **Fixed** |
| 9 | `AboutRecord.tsx`'s inconsistent loading-state pattern | Still open, unchanged |
| 10 | Dead `/api/releases` GET route | **Fixed** — and see finding #5 below, a new dead route of the same shape was added since |
| 11 | Unused `stripDiscogsMarkup` | **Fixed** |
| 12 | Duplicated per-file `USER_AGENT` constants | **Fixed** — and the new `appleMusic.ts` enricher correctly uses the shared constant rather than declaring its own |
| 13 | Redundant `needsEnrichment`/`needsAboutSummary` double-checks in the enrichment loop | Still open, unchanged |
| 14 | `listAvailableDecades`/`listAvailableYears` double table scan | Still open, unchanged |
| 15 | No request validation on numeric route params | Still open, unchanged — new mood-axes/genre-editor routes follow the same loose-validation pattern (not necessarily wrong, just consistent with the rest of the app) |

---

## New findings this pass

### 1. [High, Fixed] "+ Add style" in the genre editor silently fails to move an existing style into the column you typed it into

**Files:** [src/app/api/genres-styles/route.ts:39-45](src/app/api/genres-styles/route.ts#L39-L45), [src/components/GenreEditor.tsx:609-613](src/components/GenreEditor.tsx#L609-L613)

Verified directly against the running app: the collection already has a style "Electric Blues" (id 68) parented under genre "Blues" (id 67). Calling the genre-editor's create endpoint asking to attach it under a *different* genre —

```
POST /api/genres-styles {"name":"Electric Blues","kind":"style","parentGenreId":24}
→ {"id":68,"name":"Electric Blues", ...,"parentGenreId":67}
```

— returns the existing row completely unchanged, silently ignoring the requested `parentGenreId`. The route's find-or-create logic (`genres-styles/route.ts:39-45`) only sets `parentGenreId` on *insert*; when an existing row is found by (name, kind), it's returned as-is with no reparenting and no error.

On the client side, `GenreEditor.tsx`'s `addStyle()` blindly writes back whatever the server returns (`{...u, parentGenreId: created.parentGenreId}` at line 611), so when a user types an existing style's name into a *different* column's "+ Add style" field — a completely plausible action, since the field's own placeholder and the editor's own help text ("Use each column's '+ Add style' field to create a new style directly in it") imply this should work — nothing happens. No error message, no card movement, no explanation. The only way to actually move an existing style between genres is drag-and-drop or the "Merge/promote…" link; "+ Add style" only works for names that don't exist anywhere yet, and gives no indication of that constraint.

**Fixed:** the route now reparents an existing style to the requested `parentGenreId` when it differs from its current one, mirroring what drag-and-drop already does via `PATCH /api/genres-styles/[id]`. Verified by re-running the exact same request that previously no-op'd — it now correctly returns `parentGenreId: 24`, confirmed via a direct round-trip against the running app (then restored "Electric Blues" back to its original genre afterward).

### 2. [Medium] A third near-duplicate find-or-create-then-link implementation

**File:** [src/app/api/genres-styles/route.ts:13-48](src/app/api/genres-styles/route.ts#L13-L48)

The first pass flagged two copies of "look up a vocab row by (name, kind), insert if missing" (`genres-styles`/`tags` per-release routes). This pass adds a third, in the genre editor's own top-level `POST /api/genres-styles` — with its own extra parentGenreId validation layered on, and (per finding #1) its own distinct bug that the other two don't have. Three independent implementations of the same shape now exist; a shared helper would have caught finding #1 in one place instead of needing to be fixed three times (or missed twice more).

### 3. [Medium, Fixed] `MoodCube.tsx`'s genre dropdown reintroduces the `<optgroup>` bug `CLAUDE.md` documents as already fixed

**File:** [src/components/MoodCube.tsx:262-273](src/components/MoodCube.tsx#L262-L273)

`CLAUDE.md` is explicit: *"FilterControls.tsx's genre/style dropdown renders each genre and its styles as a flat run of `<option>`s inside a `Fragment`, not an `<optgroup>` — an `<optgroup>` label previously duplicated the already-clickable genre option with an unclickable, differently-styled copy directly above it. Don't reintroduce the `<optgroup>` wrapper. ... `MoodEditor.tsx` mirrors both of these ... keep them in sync if either changes."`

`FilterControls.tsx` and `MoodEditor.tsx` both correctly use the `Fragment`-based flat rendering. `MoodCube.tsx` does not — it uses `<optgroup key={group.genre} label={group.genre}>` wrapping a clickable `<option value={group.genre}>{group.genre}</option>`. Verified in the running app: opening the Mood Cube's genre filter dropdown shows "Blues" (and "Country", "Jazz") listed twice back-to-back — once as the non-interactive bold group heading, once as the actual selectable option directly below it — exactly the redundant, confusing rendering the other two components deliberately avoid.

**Fixed:** switched to the same `Fragment`-wrapped flat-option pattern already used in `FilterControls.tsx`/`MoodEditor.tsx`. Verified via direct DOM inspection (`optgroupCount: 0`, all children are flat `<option>` tags) — note the accessibility-tree text dump still shows "Blues" appearing twice under the Blues genre group, but that's legitimate: "Blues" exists as both a genre and a style with the same name (a pre-existing Discogs data-quality artifact `CLAUDE.md` already documents), not a rendering artifact.

### 4. [Low] Dead `GET /api/mood-axes` route

**File:** [src/app/api/mood-axes/route.ts](src/app/api/mood-axes/route.ts)

Same shape as the first pass's now-fixed dead `/api/releases` route: nothing calls it. Both `/mood-cube` and `/mood-editor` fetch their data via `listMoodCubeEntries()` directly as server components (see `src/app/mood-cube/page.tsx`, `src/app/mood-editor/page.tsx`), not through this route. It also duplicates `listMoodCubeEntries()`'s job through a different code path (`buildCollectionCatalog()` instead of `attachGenresAndArtists`), so even if something did call it, it'd be a second, redundant way to fetch the same shape of data.

### 5. [Low] `MoodCube.tsx`'s three.js effect doesn't dispose axis-line/edge resources on cleanup

**File:** [src/components/MoodCube.tsx:85-99](src/components/MoodCube.tsx#L85-L99), [238-251](src/components/MoodCube.tsx#L238-L251)

The cleanup function disposes `sphereGeo`, each palette mesh's material, `cubeGeo`, `edges`, and the renderer — but the wireframe cube's `LineBasicMaterial` and the three axis lines' `BufferGeometry`/`LineBasicMaterial` (7 objects total) are created fresh every time the effect re-runs (i.e., every time the genre filter changes) and never disposed. Each leak is small and the effect only re-runs on user-driven filter changes within one page visit, so this isn't a crash risk, but it's a real gap in an otherwise carefully-cleaned-up effect.

### 6. `buildCatalogPromptText` is still unused

**File:** [src/lib/llm/catalog.ts:157-160](src/lib/llm/catalog.ts#L157-L160)

Carried over from the first pass — still no callers anywhere in the codebase. Not re-flagged as new, just confirmed still true after the rewrite of its neighboring functions.

---

## Things checked and found clean this pass

- **Mood axes system** (`release_mood_axes` table, `/api/releases/[id]/mood-axes`, `MoodEditor.tsx`): clamping to `[-1, 1]` happens server-side (`clamp()` in the PATCH route), the undo stack correctly distinguishes a no-op click from an actual drag (`endGesture` compares before/after axes and skips the API call and undo-push when nothing moved), and the three linked 2D panels all read/write the same single `axesById` map so a drag on any one panel is immediately reflected on the other two. No issues found.
- **Genre/style hierarchy invariant** (`parentGenreId` CHECK constraint, migrations 0006–0007): the constraint, the merge route's re-parenting-before-delete logic, and the delete route's dependent-styles guard were all cross-checked against `schema.ts` and match exactly what `CLAUDE.md` describes. Solid.
- **Three.js `InstancedMesh` black-render workaround** (`MoodCube.tsx`): confirmed the code actually uses one `InstancedMesh` per palette-color bucket rather than per-instance vertex colors, matching the documented gotcha. Rendered correctly in a live check (colored point cloud, correct axis lines).
- **Click-vs-rotate-drag distinction** in `MoodCube.tsx`: the 4px movement threshold is implemented and matches the documented approach.
- **Apple Music enrichment** (`appleMusic.ts`): throttling (3s/request, matching the documented 20 req/min cap), match-or-nothing artist-name check, and shared `USER_AGENT` all correct.
- **`ReleaseUserPanel`/`AboutRecord`** Apple Music / YouTube fallback rendering: `appleMusicUrl` takes priority, YouTube search link only computed when there's no Apple Music match, matches `CLAUDE.md`.
- Ran `npx tsc --noEmit` and `npm run lint` against the full current tree — both clean, no errors or warnings.
