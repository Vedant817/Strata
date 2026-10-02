-- Archive import: keep the URL a post used to live at.
--
-- Switching a blog's home is the whole cost of moving it, and inbound links are
-- most of that cost: years of other people's references point at an address that
-- will 404 here. Storing the original permalink lets the article page offer the
-- old URL instead of pretending the post has always lived at this one.
--
-- Nullable on purpose: every post written here was born on this site and has no
-- previous address.
ALTER TABLE posts ADD COLUMN original_url text;