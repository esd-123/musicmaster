CREATE TABLE `artists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discogs_artist_id` integer,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artists_discogs_artist_id_unique` ON `artists` (`discogs_artist_id`);--> statement-breakpoint
CREATE TABLE `bpm` (
	`release_id` integer PRIMARY KEY NOT NULL,
	`bpm` real NOT NULL,
	`source` text NOT NULL,
	`confidence` text,
	`fetched_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `enrichment_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` integer NOT NULL,
	`source` text NOT NULL,
	`field_key` text NOT NULL,
	`field_value` text NOT NULL,
	`fetched_at` text DEFAULT (current_timestamp) NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrichment_cache_release_source_field_idx` ON `enrichment_cache` (`release_id`,`source`,`field_key`);--> statement-breakpoint
CREATE TABLE `genres_styles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genres_styles_name_kind_idx` ON `genres_styles` (`name`,`kind`);--> statement-breakpoint
CREATE TABLE `play_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` integer NOT NULL,
	`played_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `release_artists` (
	`release_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	`role` text,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`release_id`, `artist_id`, `position`),
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `release_genres_styles` (
	`release_id` integer NOT NULL,
	`genre_style_id` integer NOT NULL,
	PRIMARY KEY(`release_id`, `genre_style_id`),
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_style_id`) REFERENCES `genres_styles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `release_tags` (
	`release_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`added_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`release_id`, `tag_id`),
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `release_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` integer NOT NULL,
	`position` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`duration_seconds` integer,
	`track_artist` text,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discogs_instance_id` integer NOT NULL,
	`discogs_release_id` integer NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`format` text,
	`cover_image_url` text,
	`discogs_notes` text,
	`discogs_community_rating` real,
	`discogs_community_rating_count` integer,
	`date_added` text,
	`last_synced_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_discogs_instance_id_unique` ON `releases` (`discogs_instance_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`started_at` text DEFAULT (current_timestamp) NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`items_failed` integer DEFAULT 0 NOT NULL,
	`error_summary` text
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_label_kind_idx` ON `tags` (`label`,`kind`);--> statement-breakpoint
CREATE TABLE `user_release_data` (
	`release_id` integer PRIMARY KEY NOT NULL,
	`rating` integer,
	`notes` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade
);
