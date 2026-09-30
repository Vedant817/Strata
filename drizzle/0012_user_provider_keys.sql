-- A user's own provider keys, sealed.
--
-- Ciphertext, IV, and auth tag only — never a key. The `hint` (last four
-- characters) and `fingerprint` exist so the settings page can show
-- "ends 4f2a" and recognise a re-added key without decrypting for display.
CREATE TABLE `user_provider_keys` (
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	`provider_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`tag` text NOT NULL,
	`hint` text DEFAULT '' NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`model` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `provider_id`)
);
