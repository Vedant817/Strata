CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  anon_key TEXT,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  annotation_id TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
--> statement-breakpoint
CREATE INDEX notifications_inbox_idx ON notifications(anon_key, created_at DESC);
--> statement-breakpoint
CREATE INDEX notifications_unread_idx ON notifications(anon_key, read_at);
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications(annotation_id, anon_key, kind);
--> statement-breakpoint
CREATE TABLE notification_mutes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (user_id, kind)
);