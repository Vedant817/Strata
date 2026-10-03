-- Publication-scope annotations.
--
-- `annotations` gains a meaning it did not have: a note with `post_id IS NULL`
-- is about the publication rather than an article. This reuses the marginalia
-- table rather than adding a second one so that threading, reactions, owner
-- delete, reporting and mute are inherited instead of reimplemented — and so
-- that article pages keep leaking nothing: they filter `eq(postId, x)`, which
-- excludes NULL with no extra condition.
--
-- SQLite cannot drop a NOT NULL constraint, so the table is rebuilt. The
-- ordering below is load-bearing and must not be "simplified".
--
-- WHY THIS ORDER (all four points established by running it, not by reading it):
--
--   1. `PRAGMA foreign_keys` is ON by default in libsql, so `DROP TABLE` on a
--      parent fires `ON DELETE CASCADE` against every live child. Rebuilding in
--      the textbook order — copy, drop, rename — silently deletes every
--      reaction any reader has ever left on a comment.
--
--   2. The documented escape hatch does not exist here. `PRAGMA foreign_keys =
--      off` works on a normal statement, but `migrate()` sends the whole file
--      through a single `client.migrate()` RPC and the pragma does not survive
--      it, so a migration file cannot rely on turning enforcement off.
--
--   3. So enforcement stays ON and the rebuild is ordered instead: the child
--      tables are copied into FK-less staging tables and dropped *before*
--      `annotations` is dropped. At the instant `annotations` goes away,
--      nothing in the database references it by name, so there is nothing to
--      cascade into. The staging tables are deliberately FK-less — that is the
--      whole trick.
--
--   4. The children's foreign keys are then restored by rebuilding them against
--      the new table, so `ON DELETE CASCADE` (deleting a post takes its notes
--      and their reactions) keeps working rather than quietly degrading to
--      unenforced.
--
-- `pragma integrity_check` reports `ok` *throughout* step 1. Counts and the
-- join are the only thing that catches it; scripts/check-annotation-invariants.ts
-- asserts both.

CREATE TABLE `annotations_new` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text,
	`version_id` text,
	`block_id` text,
	`anchor` text,
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
INSERT INTO `annotations_new` (
	`id`, `post_id`, `version_id`, `block_id`, `anchor`, `body`, `kind`, `parent_id`,
	`author_id`, `anon_id`, `guest_name`, `status`, `is_accepted`, `is_resolved`,
	`is_private`, `created_at`, `edited_at`
)
SELECT
	`id`, `post_id`, `version_id`, `block_id`, `anchor`, `body`, `kind`, `parent_id`,
	`author_id`, `anon_id`, `guest_name`, `status`, `is_accepted`, `is_resolved`,
	`is_private`, `created_at`, `edited_at`
FROM `annotations`;
--> statement-breakpoint
CREATE TABLE `annotation_reactions_stage` (
	`annotation_id` text NOT NULL,
	`voter_key` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`annotation_id`, `voter_key`, `kind`)
);
--> statement-breakpoint
INSERT INTO `annotation_reactions_stage`
	(`annotation_id`, `voter_key`, `kind`, `created_at`)
SELECT `annotation_id`, `voter_key`, `kind`, `created_at` FROM `annotation_reactions`;
--> statement-breakpoint
CREATE TABLE `annotation_reports_stage` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`reporter_key` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `annotation_reports_stage`
	(`id`, `annotation_id`, `reporter_key`, `reason`, `created_at`)
SELECT `id`, `annotation_id`, `reporter_key`, `reason`, `created_at` FROM `annotation_reports`;
--> statement-breakpoint
DROP TABLE `annotation_reactions`;
--> statement-breakpoint
DROP TABLE `annotation_reports`;
--> statement-breakpoint
DROP TABLE `annotations`;
--> statement-breakpoint
ALTER TABLE `annotations_new` RENAME TO `annotations`;
--> statement-breakpoint
CREATE TABLE `annotation_reactions_final` (
	`annotation_id` text NOT NULL,
	`voter_key` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`annotation_id`, `voter_key`, `kind`),
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `annotation_reactions_final`
	(`annotation_id`, `voter_key`, `kind`, `created_at`)
SELECT `annotation_id`, `voter_key`, `kind`, `created_at` FROM `annotation_reactions_stage`;
--> statement-breakpoint
DROP TABLE `annotation_reactions_stage`;
--> statement-breakpoint
ALTER TABLE `annotation_reactions_final` RENAME TO `annotation_reactions`;
--> statement-breakpoint
CREATE TABLE `annotation_reports_final` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`reporter_key` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `annotation_reports_final`
	(`id`, `annotation_id`, `reporter_key`, `reason`, `created_at`)
SELECT `id`, `annotation_id`, `reporter_key`, `reason`, `created_at` FROM `annotation_reports_stage`;
--> statement-breakpoint
DROP TABLE `annotation_reports_stage`;
--> statement-breakpoint
ALTER TABLE `annotation_reports_final` RENAME TO `annotation_reports`;
--> statement-breakpoint
CREATE INDEX `annotations_post_idx` ON `annotations` (`post_id`,`status`);
--> statement-breakpoint
CREATE INDEX `annotations_block_idx` ON `annotations` (`post_id`,`block_id`);
--> statement-breakpoint
CREATE INDEX `annotations_version_idx` ON `annotations` (`version_id`);
--> statement-breakpoint
CREATE INDEX `annotations_parent_idx` ON `annotations` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `annotations_anon_idx` ON `annotations` (`anon_id`);
--> statement-breakpoint
CREATE INDEX `annotation_reports_note_idx` ON `annotation_reports` (`annotation_id`);