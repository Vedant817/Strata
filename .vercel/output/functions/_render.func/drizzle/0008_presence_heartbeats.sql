-- Presence heartbeats.
--
-- §5 wants "3 people are reading this right now" without Supabase Realtime,
-- which this stack traded away. The replacement is deliberately dumber: a
-- heartbeat row per anonymous reader per post, refreshed while the page is
-- open and pruned past 90 seconds. No profiles, no followers, no DMs — the
-- count is the whole feature, and a count can never identify anyone.
CREATE TABLE `presence_heartbeats` (
	`anon_key` text NOT NULL,
	`post_id` text NOT NULL REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	`last_seen` integer NOT NULL,
	PRIMARY KEY(`anon_key`, `post_id`)
);
--> statement-breakpoint
CREATE INDEX `presence_post_idx` ON `presence_heartbeats` (`post_id`, `last_seen`);
