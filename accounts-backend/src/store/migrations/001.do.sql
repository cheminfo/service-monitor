-- The accounts that sign in to the operator's pages. The first is created
-- when the server starts on a store that has none, from ADMIN_USERNAME and
-- ADMIN_PASSWORD; the others are added from the Accounts page. Times are in
-- unix seconds.
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- PBKDF2-HMAC-SHA-512, as pbkdf2$sha512$<iterations>$<salt>$<hash> with the
  -- salt and the hash in base64. A session is signed over it, so changing the
  -- password ends every session of the account.
  passwordHash TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  passwordChangedAt INTEGER NOT NULL,
  lastSignInAt INTEGER
) STRICT;
