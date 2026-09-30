CREATE TABLE `annotation_reactions` (
	`annotation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`annotation_id`, `user_id`, `kind`),
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`version_id` text NOT NULL,
	`block_id` text NOT NULL,
	`anchor` text NOT NULL,
	`body` text NOT NULL,
	`kind` text DEFAULT 'comment' NOT NULL,
	`parent_id` text,
	`author_id` text,
	`anon_id` text,
	`guest_name` text,
	`status` text DEFAULT 'visible' NOT NULL,
	`is_accepted` integer DEFAULT false NOT NULL,
	`is_resolved` integer DEFAULT false NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`edited_at` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `post_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `annotations_post_idx` ON `annotations` (`post_id`,`status`);--> statement-breakpoint
CREATE INDEX `annotations_block_idx` ON `annotations` (`post_id`,`block_id`);--> statement-breakpoint
CREATE INDEX `annotations_version_idx` ON `annotations` (`version_id`);--> statement-breakpoint
CREATE INDEX `annotations_parent_idx` ON `annotations` (`parent_id`);--> statement-breakpoint
CREATE INDEX `annotations_anon_idx` ON `annotations` (`anon_id`);--> statement-breakpoint
CREATE TABLE `asks` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`version_id` text NOT NULL,
	`block_id` text,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`citations` text DEFAULT '[]' NOT NULL,
	`mode` text DEFAULT 'extractive' NOT NULL,
	`latency_ms` integer,
	`asked_by_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `post_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asked_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asks_post_idx` ON `asks` (`post_id`);--> statement-breakpoint
CREATE INDEX `asks_block_idx` ON `asks` (`post_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`version_id` text NOT NULL,
	`block_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`type` text NOT NULL,
	`layer` text DEFAULT 'core' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`heading_path` text DEFAULT '' NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `post_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocks_version_ordinal_idx` ON `blocks` (`version_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `blocks_block_idx` ON `blocks` (`post_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `capture_items` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`source` text DEFAULT 'scratchpad' NOT NULL,
	`state` text DEFAULT 'inbox' NOT NULL,
	`promoted_post_id` text,
	`captured_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capture_items_author_idx` ON `capture_items` (`author_id`,`state`);--> statement-breakpoint
CREATE TABLE `handle_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`email` text NOT NULL,
	`anon_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handle_claims_token_uq` ON `handle_claims` (`token`);--> statement-breakpoint
CREATE INDEX `handle_claims_anon_idx` ON `handle_claims` (`anon_id`);--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`block_id` text NOT NULL,
	`user_id` text,
	`anon_id` text,
	`text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `highlights_post_idx` ON `highlights` (`post_id`);--> statement-breakpoint
CREATE TABLE `newsletter_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `post_links` (
	`from_post_id` text NOT NULL,
	`to_post_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`from_post_id`, `to_post_id`, `type`),
	FOREIGN KEY (`from_post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_links_to_idx` ON `post_links` (`to_post_id`);--> statement-breakpoint
CREATE TABLE `post_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`body` text NOT NULL,
	`change_summary` text DEFAULT '' NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`is_major` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_versions_n_uq` ON `post_versions` (`post_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `post_versions_post_idx` ON `post_versions` (`post_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`dek` text DEFAULT '' NOT NULL,
	`author_id` text NOT NULL,
	`status` text DEFAULT 'seedling' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`current_version_id` text,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_reviewed_at` integer,
	`topic_id` text,
	`series_id` text,
	`cover_image` text,
	`seo_description` text DEFAULT '' NOT NULL,
	`forked_from_id` text,
	`annotation_count` integer DEFAULT 0 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_slug_uq` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author_id`);--> statement-breakpoint
CREATE INDEX `posts_status_published_idx` ON `posts` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `posts_topic_idx` ON `posts` (`topic_id`);--> statement-breakpoint
CREATE TABLE `read_events` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`block_id` text,
	`user_id` text,
	`anon_id` text,
	`event` text NOT NULL,
	`dwell_ms` integer,
	`position_ratio` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `read_events_post_idx` ON `read_events` (`post_id`,`event`);--> statement-breakpoint
CREATE INDEX `read_events_post_created_idx` ON `read_events` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `read_events_block_idx` ON `read_events` (`post_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `read_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`anon_id` text,
	`user_id` text,
	`version_id` text NOT NULL,
	`read_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `post_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `read_receipts_lookup_idx` ON `read_receipts` (`post_id`,`anon_id`);--> statement-breakpoint
CREATE TABLE `reader_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`depth_preference` text DEFAULT 'understand' NOT NULL,
	`explanation_level` text DEFAULT 'inline' NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reading_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`post_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `reading_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reading_list_items_idx` ON `reading_list_items` (`list_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `reading_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_public` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `revision_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_subscriptions_uq` ON `revision_subscriptions` (`post_id`,`email`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`blurb` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`blurb` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`avatar_url` text,
	`role` text DEFAULT 'reader' NOT NULL,
	`tone_vector` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_uq` ON `users` (`handle`);