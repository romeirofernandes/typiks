CREATE TABLE `user_mode_stats` (
	`user_id` text NOT NULL,
	`mode_seconds` integer NOT NULL,
	`games_played` integer NOT NULL DEFAULT 0,
	`games_won` integer NOT NULL DEFAULT 0,
	`games_lost` integer NOT NULL DEFAULT 0,
	`games_drawn` integer NOT NULL DEFAULT 0,
	`total_score` integer NOT NULL DEFAULT 0,
	`average_score` real NOT NULL DEFAULT 0,
	`rating` integer NOT NULL DEFAULT 800,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `mode_seconds`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`mode_seconds` IN (15, 30, 60, 120))
);
--> statement-breakpoint
CREATE INDEX `user_mode_stats_user_id_idx` ON `user_mode_stats` (`user_id`);
--> statement-breakpoint
CREATE INDEX `user_mode_stats_mode_seconds_idx` ON `user_mode_stats` (`mode_seconds`);
--> statement-breakpoint
CREATE TABLE `ranked_game_logs` (
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opponent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`mode_seconds` IN (15, 30, 60, 120))
);
--> statement-breakpoint
CREATE INDEX `ranked_game_logs_game_user_idx` ON `ranked_game_logs` (`game_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `ranked_game_logs_user_date_idx` ON `ranked_game_logs` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `ranked_game_logs_mode_seconds_idx` ON `ranked_game_logs` (`mode_seconds`);