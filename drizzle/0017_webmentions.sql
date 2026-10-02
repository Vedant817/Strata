CREATE TABLE webmentions (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_title TEXT NOT NULL DEFAULT '',
  source_author TEXT,
  source_author_url TEXT,
  target TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mention',
  verified_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX webmentions_post_idx ON webmentions(post_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX webmentions_source_idx ON webmentions(post_id, source, target);