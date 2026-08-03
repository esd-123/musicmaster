PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_genres_styles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`description` text,
	`parent_genre_id` integer,
	FOREIGN KEY (`parent_genre_id`) REFERENCES `genres_styles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "genres_styles_parent_kind_check" CHECK(("__new_genres_styles"."kind" = 'style' AND "__new_genres_styles"."parent_genre_id" IS NOT NULL) OR ("__new_genres_styles"."kind" = 'genre' AND "__new_genres_styles"."parent_genre_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_genres_styles`("id", "name", "kind", "description", "parent_genre_id") SELECT "id", "name", "kind", "description", "parent_genre_id" FROM `genres_styles`;--> statement-breakpoint
DROP TABLE `genres_styles`;--> statement-breakpoint
ALTER TABLE `__new_genres_styles` RENAME TO `genres_styles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `genres_styles_name_kind_idx` ON `genres_styles` (`name`,`kind`);