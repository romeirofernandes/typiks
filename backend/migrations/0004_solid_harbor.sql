PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`mode_seconds` integer NOT NULL,
	`difficulty` text NOT NULL,
	`seed` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `games_status_idx` ON `games` (`status`);
--> statement-breakpoint
CREATE INDEX `games_created_at_idx` ON `games` (`created_at`);
--> statement-breakpoint
CREATE TABLE `friend_requests_new` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_id` text NOT NULL,
	`receiver_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`created_at` integer NOT NULL,
	`responded_at` integer
);
--> statement-breakpoint
INSERT INTO `friend_requests_new` (`id`, `sender_id`, `receiver_id`, `status`, `created_at`, `responded_at`)
SELECT `id`, `sender_id`, `receiver_id`, `status`, `created_at`, `responded_at`
FROM `friend_requests`
WHERE rowid IN (
	SELECT MIN(rowid)
	FROM `friend_requests`
	GROUP BY `sender_id`, `receiver_id`
);
--> statement-breakpoint
DROP TABLE `friend_requests`;
--> statement-breakpoint
ALTER TABLE `friend_requests_new` RENAME TO `friend_requests`;
--> statement-breakpoint
CREATE INDEX `friend_requests_sender_id_idx` ON `friend_requests` (`sender_id`);
--> statement-breakpoint
CREATE INDEX `friend_requests_receiver_status_idx` ON `friend_requests` (`receiver_id`, `status`);
--> statement-breakpoint
CREATE INDEX `friend_requests_sender_receiver_idx` ON `friend_requests` (`sender_id`, `receiver_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_requests_sender_receiver_unique` ON `friend_requests` (`sender_id`, `receiver_id`);
--> statement-breakpoint
CREATE TABLE `friendships_new` (
	`user_a` text NOT NULL,
	`user_b` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_a`, `user_b`)
);
--> statement-breakpoint
INSERT INTO `friendships_new` (`user_a`, `user_b`, `created_at`)
SELECT
	CASE WHEN `user_id` < `friend_id` THEN `user_id` ELSE `friend_id` END AS `user_a`,
	CASE WHEN `user_id` < `friend_id` THEN `friend_id` ELSE `user_id` END AS `user_b`,
	MIN(`created_at`) AS `created_at`
FROM `friendships`
WHERE `user_id` <> `friend_id`
GROUP BY
	CASE WHEN `user_id` < `friend_id` THEN `user_id` ELSE `friend_id` END,
	CASE WHEN `user_id` < `friend_id` THEN `friend_id` ELSE `user_id` END;
--> statement-breakpoint
DROP TABLE `friendships`;
--> statement-breakpoint
ALTER TABLE `friendships_new` RENAME TO `friendships`;
--> statement-breakpoint
CREATE INDEX `friendships_user_a_idx` ON `friendships` (`user_a`);
--> statement-breakpoint
CREATE INDEX `friendships_user_b_idx` ON `friendships` (`user_b`);
--> statement-breakpoint
CREATE TABLE `user_mode_stats_new` (
	`user_id` text NOT NULL,
	`mode_seconds` integer NOT NULL,
	`games_played` integer NOT NULL DEFAULT 0,
	`games_won` integer NOT NULL DEFAULT 0,
	`games_lost` integer NOT NULL DEFAULT 0,
	`games_drawn` integer NOT NULL DEFAULT 0,
	`total_score` integer NOT NULL DEFAULT 0,
	`rating` integer NOT NULL DEFAULT 800,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `mode_seconds`)
);
--> statement-breakpoint
INSERT INTO `user_mode_stats_new` (`user_id`, `mode_seconds`, `games_played`, `games_won`, `games_lost`, `games_drawn`, `total_score`, `rating`, `updated_at`)
SELECT `user_id`, `mode_seconds`, `games_played`, `games_won`, `games_lost`, `games_drawn`, `total_score`, `rating`, `updated_at`
FROM `user_mode_stats`;
--> statement-breakpoint
DROP TABLE `user_mode_stats`;
--> statement-breakpoint
ALTER TABLE `user_mode_stats_new` RENAME TO `user_mode_stats`;
--> statement-breakpoint
CREATE INDEX `user_mode_stats_user_id_idx` ON `user_mode_stats` (`user_id`);
--> statement-breakpoint
CREATE INDEX `user_mode_stats_mode_seconds_idx` ON `user_mode_stats` (`mode_seconds`);
--> statement-breakpoint
CREATE TABLE `ranked_game_logs_new` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`opponent_id` text NOT NULL,
	`mode_seconds` integer NOT NULL,
	`score` integer NOT NULL,
	`opponent_score` integer NOT NULL,
	`won` integer NOT NULL DEFAULT 0,
	`is_draw` integer NOT NULL DEFAULT 0,
	`rating_before` integer NOT NULL,
	`rating_after` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `ranked_game_logs_new` (`id`, `game_id`, `user_id`, `opponent_id`, `mode_seconds`, `score`, `opponent_score`, `won`, `is_draw`, `rating_before`, `rating_after`, `created_at`)
SELECT `id`, `game_id`, `user_id`, `opponent_id`, `mode_seconds`, `score`, `opponent_score`, `won`, `is_draw`, `rating_before`, `rating_after`, `created_at`
FROM `ranked_game_logs`;
--> statement-breakpoint
DROP TABLE `ranked_game_logs`;
--> statement-breakpoint
ALTER TABLE `ranked_game_logs_new` RENAME TO `ranked_game_logs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `ranked_game_logs_game_user_unique` ON `ranked_game_logs` (`game_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `ranked_game_logs_user_date_idx` ON `ranked_game_logs` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `ranked_game_logs_user_mode_idx` ON `ranked_game_logs` (`user_id`, `mode_seconds`);
--> statement-breakpoint
CREATE INDEX `ranked_game_logs_mode_seconds_idx` ON `ranked_game_logs` (`mode_seconds`);
--> statement-breakpoint
PRAGMA foreign_keys = ON;
