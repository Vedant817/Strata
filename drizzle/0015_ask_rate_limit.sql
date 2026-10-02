-- Attribute anonymous asks so they can be rate limited and audited.
--
-- Ask is a GET that spends the deployment's model key. Until now an anonymous
-- question was logged with `asked_by_id = null`, which is indistinguishable from
-- "nobody asked" in aggregate and impossible to meter. `anon_id` is the same
-- pseudonymous browser id used for read receipts and highlights - it is never a
-- person, and it is not a new identifier invented for this.
ALTER TABLE asks ADD COLUMN anon_id text;
CREATE INDEX asks_anon_idx ON asks (anon_id, created_at);