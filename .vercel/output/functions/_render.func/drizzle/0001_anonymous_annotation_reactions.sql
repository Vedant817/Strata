-- Anonymous readers must be able to react.
--
-- `annotation_reactions.user_id` referenced `users(id)`, so reacting required a
-- claimed handle. That is a direct contradiction of the one rule this product
-- has: arguing in the margin never asks for an account. Most readers never
-- claim anything, so the reaction row was unreachable for them.
--
-- The column becomes `voter_key` — an unconstrained string holding either a
-- claimed account (`u:<userId>`) or a browser id (`a:<anonId>`). SQLite cannot
-- alter a primary key in place, so the table is rebuilt.
--
-- Existing rows are re-keyed into the new format so a reader who already
-- reacted toggles *off* their existing reaction rather than adding a second
-- one. The table is empty today, but a migration should not depend on that.
CREATE TABLE `annotation_reactions_new` (
	`annotation_id` text NOT NULL,
	`voter_key` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`annotation_id`, `voter_key`, `kind`),
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `annotation_reactions_new` (`annotation_id`, `voter_key`, `kind`, `created_at`)
SELECT `annotation_id`, 'u:' || `user_id`, `kind`, `created_at` FROM `annotation_reactions`;
--> statement-breakpoint
DROP TABLE `annotation_reactions`;
--> statement-breakpoint
ALTER TABLE `annotation_reactions_new` RENAME TO `annotation_reactions`;
