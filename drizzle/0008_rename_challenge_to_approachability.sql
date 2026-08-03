ALTER TABLE `release_mood_axes` RENAME COLUMN `challenge` TO `approachability`;--> statement-breakpoint
UPDATE `release_mood_axes` SET `approachability` = -`approachability`;
