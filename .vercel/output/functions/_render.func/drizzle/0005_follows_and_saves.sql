-- Follows and saves.
--
-- Both keyed by an unconstrained follower/saver key (`u:<userId>` or
-- `a:<anonId>`, the same convention as reaction voter keys) rather than a
-- foreign key into `users`: following an author and saving a post for later
-- must never ask for an account, and the reader page already proves anonymous
-- memory works. A saver key that later claims a handle keeps its saves —
-- backfilled by the same upgrade path as notes, when that path is built.
CREATE TABLE `follows` (
	`follower_key` text NOT NULL,
	`author_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`follower_key`, `author_id`)
);
--> statement-breakpoint
CREATE TABLE `saved_posts` (
	`saver_key` text NOT NULL,
	`post_id` text NOT NULL REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`saver_key`, `post_id`)
);
--> statement-breakpoint
CREATE INDEX `saved_posts_post_idx` ON `saved_posts` (`post_id`);
