-- What each account may do, and whether the server's .env defines it.
--
-- `read` reads, `write` reads and writes, `admin` also manages the accounts.
-- The accounts already there could do everything, so they keep doing it: the
-- default is `admin`, and every account added from now on names its role.
--
-- `env_managed` marks the administrator ADMIN_USERNAME and ADMIN_PASSWORD
-- define: the server writes it at every start, and nothing else removes it,
-- demotes it or changes its password.
ALTER TABLE accounts
ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('read', 'write', 'admin'));

ALTER TABLE accounts
ADD COLUMN env_managed INTEGER NOT NULL DEFAULT 0;
