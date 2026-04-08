-- Multi-map support (0002 is attachments status; this file is 0003 in sequence)
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#d4a853',
  created_at INTEGER DEFAULT (unixepoch())
);

ALTER TABLE nodes ADD COLUMN map_id TEXT DEFAULT 'default';

INSERT OR IGNORE INTO maps (id, name, description)
VALUES ('default', 'Architecture Map', 'Default knowledge map');
