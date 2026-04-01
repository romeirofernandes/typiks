CREATE TABLE `friend_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_id` text NOT NULL,
	`receiver_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`created_at` integer NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `friend_requests_sender_id_idx` ON `friend_requests` (`sender_id`);
--> statement-breakpoint
CREATE INDEX `friend_requests_receiver_status_idx` ON `friend_requests` (`receiver_id`,`status`);
--> statement-breakpoint
CREATE INDEX `friend_requests_sender_receiver_idx` ON `friend_requests` (`sender_id`,`receiver_id`);
--> statement-breakpoint
CREATE TABLE `friendships` (
	`user_id` text NOT NULL,
	`friend_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `friend_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`friend_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`user_id` <> `friend_id`)
);
--> statement-breakpoint
CREATE INDEX `friendships_user_id_idx` ON `friendships` (`user_id`);
--> statement-breakpoint
CREATE INDEX `friendships_friend_id_idx` ON `friendships` (`friend_id`);
