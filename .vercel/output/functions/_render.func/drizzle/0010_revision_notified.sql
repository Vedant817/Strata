-- Track the last revision each subscriber was told about.
--
-- The revision-subscription send must be idempotent: re-running the cron, or
-- two instances running it at once, must not double-email. The guarantee has
-- to live in the data, not in a lock someone will eventually forget to take,
-- so each subscription row remembers the version it was last notified about.
ALTER TABLE `revision_subscriptions` ADD `notified_version_id` text;
