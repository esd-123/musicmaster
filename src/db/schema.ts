import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Catalog (Discogs-sourced — "pull"). Freely overwritten on resync.
// ---------------------------------------------------------------------------

export const releases = sqliteTable("releases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  discogsInstanceId: integer("discogs_instance_id").notNull().unique(),
  discogsReleaseId: integer("discogs_release_id").notNull(),
  title: text("title").notNull(),
  year: integer("year"),
  format: text("format"),
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
  },
  (table) => [uniqueIndex("genres_styles_name_kind_idx").on(table.name, table.kind)],
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
      enum: ["musicbrainz", "lastfm", "wikipedia"],
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

// BPM is pull-only — the user will never hand-enter it. Kept as its own
// typed/indexed column (not folded into enrichment_cache) since it's a
// first-class sort/filter field in the UI.
export const bpm = sqliteTable("bpm", {
  releaseId: integer("release_id")
    .primaryKey()
    .references(() => releases.id, { onDelete: "cascade" }),
  bpm: real("bpm").notNull(),
  source: text("source", { enum: ["getsongbpm", "acousticbrainz"] }).notNull(),
  confidence: text("confidence"),
  fetchedAt: text("fetched_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

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
