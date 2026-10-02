CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  challenge TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
--> statement-breakpoint
CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges(expires_at);