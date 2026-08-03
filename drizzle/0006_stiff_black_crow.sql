ALTER TABLE `genres_styles` ADD `description` text;--> statement-breakpoint
ALTER TABLE `genres_styles` ADD `parent_genre_id` integer REFERENCES genres_styles(id);