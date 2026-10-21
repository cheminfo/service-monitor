-- What every process of the service logged. `id` grows with every line,
-- whichever process wrote it, so it orders the lines and pages through them.
CREATE TABLE logs (
  id INTEGER PRIMARY KEY,
  -- When it was written, in unix milliseconds.
  at INTEGER NOT NULL,
  -- pino's number for the level: 10 trace, 20 debug … 60 fatal.
  level INTEGER NOT NULL,
  -- The logger's name: what part of the service wrote it.
  topic TEXT NOT NULL,
  -- What the process is (`server`, `import`), and which one it was.
  role TEXT NOT NULL,
  pid INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  message TEXT NOT NULL,
  -- The other fields of the line, as JSON; NULL when it carried none.
  meta TEXT
) STRICT;

-- A topic read the newest first, and the routine lines retention deletes.
CREATE INDEX logs_topic ON logs (topic, id);
CREATE INDEX logs_level ON logs (level, id);

-- The warnings and the errors, the newest first: a handful among millions of
-- request lines, read without walking past those.
CREATE INDEX logs_problems ON logs (id) WHERE level >= 40;
CREATE INDEX logs_errors ON logs (id) WHERE level >= 50;

-- Every topic and role that has logged, so the filters list them without
-- reading the lines.
CREATE TABLE log_topics (
  name TEXT PRIMARY KEY,
  lastAt INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE log_roles (
  name TEXT PRIMARY KEY,
  lastAt INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- What each running process last wrote about itself. A process removes its
-- row when it stops; one that died is told apart by the age of its row.
CREATE TABLE processes (
  hostname TEXT NOT NULL,
  pid INTEGER NOT NULL,
  role TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  intervalMs INTEGER NOT NULL,
  rss INTEGER NOT NULL,
  heapUsed INTEGER NOT NULL,
  heapTotal INTEGER NOT NULL,
  cpuPercent REAL NOT NULL,
  eventLoopDelayMs REAL NOT NULL,
  -- What it says it is doing, as a JSON object.
  activity TEXT NOT NULL,
  PRIMARY KEY (hostname, pid)
) STRICT, WITHOUT ROWID;
