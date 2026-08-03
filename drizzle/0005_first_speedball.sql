CREATE TABLE `release_mood_axes` (
	`release_id` integer PRIMARY KEY NOT NULL,
	`challenge` real DEFAULT 0 NOT NULL,
	`valence` real DEFAULT 0 NOT NULL,
	`density` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade
);
