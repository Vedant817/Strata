-- Draft storage for the block editor.
--
-- Revisions are immutable history; the editor needs somewhere to keep
-- work-in-progress that is explicitly *not* history yet. `draft_body` holds
-- {title, dek, blocks} JSON, written on every save, cleared on publish. A
-- post has at most one draft, and a draft is never rendered to readers —
-- there is no code path that reads it except the editor and publish.
ALTER TABLE `posts` ADD `draft_body` text;
