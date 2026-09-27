-- Reports against margin notes.
--
-- Moderation here is not a queue in a trust-and-safety dashboard; the
-- publication is small and the post's author is the moderator. A report hides
-- nothing by itself — it puts the note in front of the author in Studio with
-- the reporter's reason attached, and the author hides or dismisses it. The
-- reporter key is anonymous-capable for the same reason reactions are: most
-- readers never claim anything, and abuse reporting must not require it.
CREATE TABLE `annotation_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE cascade,
	`reporter_key` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `annotation_reports_note_idx` ON `annotation_reports` (`annotation_id`);
