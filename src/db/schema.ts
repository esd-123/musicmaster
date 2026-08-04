import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
  uniqueIndex,
  check,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Catalog (Discogs-sourced — "pull"). Written once, at initial import, per
// discogs_instance_id — src/lib/discogs/sync.ts deliberately leaves
// already-known instances untouched on resync (no genre/artist/track
// updates), specifically so genres_styles/release_genres_styles stay safe
// for the UI to edit afterward without a resync overwriting those edits.
// ---------------------------------------------------------------------------

export const releases = sqliteTable("releases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  discogsInstanceId: integer("discogs_instance_id").notNull().unique(),
  discogsReleaseId: integer("discogs_release_id").notNull(),
  title: text("title").notNull(),
  year: integer("year"),
  format: text("format"),
  label: text("label"),
  coverImageUrl: text("cover_image_url"),
  discogsNotes: text("discogs_notes"),
  discogsCommunityRating: real("discogs_community_rating"),
  discogsCommunityRatingCount: integer("discogs_community_rating_count"),
  dateAdded: text("date_added"),
  lastSyncedAt: text("last_synced_at"),
});

export const artists = sqliteTable("artists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  discogsArtistId: integer("discogs_artist_id").unique(),
  name: text("name").notNull(),
});

export const releaseArtists = sqliteTable(
  "release_artists",
  {
    releaseId: integer("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    role: text("role"),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.releaseId, table.artistId, table.position] }),
  ],
);

export const releaseTracks = sqliteTable("release_tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  releaseId: integer("release_id")
    .notNull()
    .references(() => releases.id, { onDelete: "cascade" }),
  // Discogs track positions are strings like "A1", "B2", not purely numeric.
  position: text("position").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  durationSeconds: integer("duration_seconds"),
  trackArtist: text("track_artist"),
});

export const genresStyles = sqliteTable(
  "genres_styles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["genre", "style"] }).notNull(),
    // Brief, user-editable blurb (e.g. what distinguishes this genre/style) —
    // surfaced in the genre editor and folded into NL-query prompts to help
    // the model reason about genre closeness/meaning.
    description: text("description"),
    // The one genre a style belongs to — mandatory for every style (never
    // null; enforced by the check constraint below), always null for genres
    // themselves ("genres are major musical classes" — top-level, no
    // parent). This is the authoritative classification, not a display hint:
    // the genre editor's Kanban board groups purely by this column now, with
    // no co-occurrence fallback. No `onDelete` (defaults to restrict) so
    // deleting a genre that still has styles pointing at it fails loudly
    // instead of silently orphaning them — callers must re-parent first.
    parentGenreId: integer("parent_genre_id").references(
      (): AnySQLiteColumn => genresStyles.id,
    ),
  },
  (table) => [
    uniqueIndex("genres_styles_name_kind_idx").on(table.name, table.kind),
    check(
      "genres_styles_parent_kind_check",
      sql`(${table.kind} = 'style' AND ${table.parentGenreId} IS NOT NULL) OR (${table.kind} = 'genre' AND ${table.parentGenreId} IS NULL)`,
    ),
  ],
);

export const releaseGenresStyles = sqliteTable(
  "release_genres_styles",
  {
    releaseId: integer("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    genreStyleId: integer("genre_style_id")
      .notNull()
      .references(() => genresStyles.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.releaseId, table.genreStyleId] })],
);

// ---------------------------------------------------------------------------
// User-entered data ("push"). Never written to by sync/enrichment code.
// ---------------------------------------------------------------------------

export const userReleaseData = sqliteTable("user_release_data", {
  releaseId: integer("release_id")
    .primaryKey()
    .references(() => releases.id, { onDelete: "cascade" }),
  rating: integer("rating"),
  notes: text("notes"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    label: text("label").notNull(),
    kind: text("kind", { enum: ["mood", "tag"] }).notNull(),
  },
  (table) => [uniqueIndex("tags_label_kind_idx").on(table.label, table.kind)],
);

export const releaseTags = sqliteTable(
  "release_tags",
  {
    releaseId: integer("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    addedAt: text("added_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [primaryKey({ columns: [table.releaseId, table.tagId] })],
);

// Every play is a new row — a permanent, timestamped history, not a
// "last played" field that gets overwritten.
export const playEvents = sqliteTable("play_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  releaseId: integer("release_id")
    .notNull()
    .references(() => releases.id, { onDelete: "cascade" }),
  playedAt: text("played_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ---------------------------------------------------------------------------
// Mood axes (synthesized, like about_summary, but numeric rather than prose).
// Seeded from a genre/tag/mood -> axis prior mapping, then freely user-edited
// via the mood editor — user edits are the source of truth going forward,
// nothing else overwrites this table once a release has a row.
// ---------------------------------------------------------------------------

export const releaseMoodAxes = sqliteTable("release_mood_axes", {
  releaseId: integer("release_id")
    .primaryKey()
    .references(() => releases.id, { onDelete: "cascade" }),
  // All three axes are floats in [-1, 1].
  approachability: real("approachability").notNull().default(0), // -1 challenging .. +1 approachable
  valence: real("valence").notNull().default(0), // -1 dark .. +1 bright
  density: real("density").notNull().default(0), // -1 sparse .. +1 propulsive
  // "seeded" = written by the enrichment pipeline or the original prior-mapping
  // backfill; "manual" = a human edited it via the mood editor. Lets the mood
  // editor UI distinguish "already reviewed" points from ones still worth a look.
  source: text("source", { enum: ["seeded", "manual"] })
    .notNull()
    .default("seeded"),
  // Frozen copy of whatever the pipeline first produced for this release,
  // written once alongside the row above and never touched again — not even
  // by a manual edit that overwrites approachability/valence/density above.
  // Exists purely so a later hand-authored pass (see the mood editor's manual
  // source) can be diffed against what the automated scoring originally said,
  // for gauging how far off — and in what direction — the automated judgment
  // runs. Null only for rows that were already "manual" before this column
  // existed, whose original auto value is unrecoverable.
  autoApproachability: real("auto_approachability"),
  autoValence: real("auto_valence"),
  autoDensity: real("auto_density"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ---------------------------------------------------------------------------
// Enrichment cache (pulled, provenance-tracked).
// ---------------------------------------------------------------------------

export const enrichmentCache = sqliteTable(
  "enrichment_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    releaseId: integer("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    source: text("source", {
      // "claude" is a synthesized summary derived from the other sources
      // (plus Discogs notes) — not a pulled fact, but cached the same way.
      enum: ["musicbrainz", "lastfm", "wikipedia", "claude", "apple_music"],
    }).notNull(),
    fieldKey: text("field_key").notNull(),
    fieldValue: text("field_value").notNull(),
    fetchedAt: text("fetched_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    expiresAt: text("expires_at"),
  },
  (table) => [
    uniqueIndex("enrichment_cache_release_source_field_idx").on(
      table.releaseId,
      table.source,
      table.fieldKey,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Operational / audit.
// ---------------------------------------------------------------------------

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type", { enum: ["discogs_sync", "enrichment"] }).notNull(),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  finishedAt: text("finished_at"),
  status: text("status", { enum: ["running", "success", "failed"] })
    .notNull()
    .default("running"),
  itemsProcessed: integer("items_processed").notNull().default(0),
  itemsFailed: integer("items_failed").notNull().default(0),
  errorSummary: text("error_summary"),
});
