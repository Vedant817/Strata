CREATE TABLE passkeys (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT 'Passkey',
  transports TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_used_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX passkeys_cred_idx ON passkeys(credential_id);
--> statement-breakpoint
CREATE INDEX passkeys_user_idx ON passkeys(user_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE sessions_meta (
  token TEXT PRIMARY KEY NOT NULL,
  user_agent TEXT,
  created_at INTEGER,
  last_seen_at INTEGER
);