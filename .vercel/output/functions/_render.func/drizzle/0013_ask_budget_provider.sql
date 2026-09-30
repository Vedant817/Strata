-- Make the Ask cost boundary per (post, provider).
--
-- There is one provider's worth of rows here, all of them Anthropic, so they
-- carry across with provider_id = 'anthropic' rather than being dropped. The
-- old table keyed on post_id alone, so it cannot simply be altered: the primary
-- key has to change, which SQLite does not do in place.
CREATE TABLE `ask_model_budgets_new` (
	`post_id` text NOT NULL REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	`provider_id` text DEFAULT 'anthropic' NOT NULL,
	`window_start` integer NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`open_until` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`post_id`, `provider_id`)
);
--> statement-breakpoint
INSERT INTO `ask_model_budgets_new` (`post_id`, `provider_id`, `window_start`, `calls`, `consecutive_failures`, `open_until`, `updated_at`)
SELECT `post_id`, 'anthropic', `window_start`, `calls`, `consecutive_failures`, `open_until`, `updated_at`
FROM `ask_model_budgets`;
--> statement-breakpoint
DROP TABLE `ask_model_budgets`;
--> statement-breakpoint
ALTER TABLE `ask_model_budgets_new` RENAME TO `ask_model_budgets`;
--> statement-breakpoint
CREATE INDEX `ask_budget_window_idx` ON `ask_model_budgets` (`window_start`);
