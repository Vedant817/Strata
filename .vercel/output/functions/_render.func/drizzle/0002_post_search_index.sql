-- Full-text search over the canon.
--
-- The plan calls for Postgres FTS. The project runs SQLite, which ships FTS5
-- in the box, so this is the same capability without a second database. The
-- table is populated and refreshed by application code (`rebuildSearchIndex`),
-- never by triggers: the indexed body is plain text projected out of the
-- typed-block JSON, and SQL cannot do that projection honestly.
--
-- `slug` is stored but UNINDEXED — it is the join key back to `posts`, not a
-- term anyone searches for. `porter` stemming means "caching" also finds
-- "cache", which is what a reader means.
CREATE VIRTUAL TABLE `post_fts` USING fts5(
	title,
	dek,
	body,
	slug UNINDEXED,
	tokenize='porter'
);
