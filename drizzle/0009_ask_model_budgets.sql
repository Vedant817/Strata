-- Per-author Ask model budget + circuit breaker.
--
-- The cap lives in the database, not in process memory, so a restart cannot
-- reset it and two instances cannot each decide they are the first to spend.
-- `window_start` is a day bucket; `consecutive_failures` trips the breaker so
-- one bad upstream stops costing money on every single request.
CREATE TABLE `ask_model_budgets` (
	`post_id` text PRIMARY KEY NOT NULL REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	`window_start` integer NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`open_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ask_budget_window_idx` ON `ask_model_budgets` (`window_start`);
