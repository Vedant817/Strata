-- Block-scoped retrieval for Ask.
--
-- `post_fts` answers "which post". Ask needs "which sentence": the passages an
-- answer is built from must resolve to blocks in *this* post, never to a
-- neighboring post that happens to share vocabulary. A post-level index
-- cannot make that promise; a block-level one can, because the post is part
-- of the row and part of every query's filter.
--
-- Populated by the same `rebuildSearchIndex()` that fills `post_fts`, for the
-- same reason: only application code can project typed blocks into text.
CREATE VIRTUAL TABLE `block_fts` USING fts5(
	text,
	block_id UNINDEXED,
	post_id UNINDEXED,
	tokenize='porter'
);
