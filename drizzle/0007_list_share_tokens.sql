-- Share tokens for private reading lists.
--
-- Public lists work as before. A private list is reachable only by its owner
-- or by an unguessable `?key=` link — the same capability model as a doc
-- shared by link, and for the same reason: no account should be required to
-- read something someone chose to share. Tokens are random 128-bit values,
-- never derived from the list id, and regenerating replaces the old link.
ALTER TABLE `reading_lists` ADD `share_token` text;
