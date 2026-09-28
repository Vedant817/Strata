-- Reading-list collaborators, with a role.
--
-- A share link grants one undifferentiated capability to anyone holding the
-- URL and cannot be revoked per person. A named collaborator can. The role is
-- binary on purpose: editor may add and remove, viewer may only read. A
-- three-tier permission system on a reading list is a permissions system
-- nobody asked for.
CREATE TABLE `list_collaborators` (
	`list_id` text NOT NULL REFERENCES `reading_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`role` text DEFAULT 'viewer' NOT NULL,
	`added_by_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`list_id`, `user_id`)
);
