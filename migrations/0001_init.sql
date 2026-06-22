CREATE TABLE IF NOT EXISTS counter (
  id TEXT PRIMARY KEY DEFAULT 'global',
  value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO counter (id, value) VALUES ('global', 0);
