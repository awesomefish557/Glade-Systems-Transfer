-- nodes
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('PRECEDENT','CONCEPT','TECHNIQUE','PERSON','PLACE','RESOURCE','QUOTE','PROJECT','QUESTION')),
  title TEXT NOT NULL,
  body TEXT,
  tags TEXT DEFAULT '[]', -- JSON array
  x REAL DEFAULT 0,
  y REAL DEFAULT 0,
  metadata TEXT DEFAULT '{}', -- JSON: author, year, url, location etc
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  label TEXT,
  strength INTEGER DEFAULT 1 CHECK(strength BETWEEN 1 AND 3),
  created_at INTEGER DEFAULT (unixepoch())
);

-- file attachments
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

-- loading bay inbox
CREATE TABLE IF NOT EXISTS loading_bay (
  id TEXT PRIMARY KEY,
  raw_content TEXT,
  raw_url TEXT,
  raw_type TEXT DEFAULT 'text', -- text | url | file
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','proposed','approved','flagged','dismissed')),
  proposed_nodes TEXT, -- JSON array of proposed node objects
  proposed_connections TEXT, -- JSON array
  ai_reasoning TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  processed_at INTEGER
);

-- ai tutor log
CREATE TABLE IF NOT EXISTS tutor_scans (
  id TEXT PRIMARY KEY,
  triggered_at INTEGER DEFAULT (unixepoch()),
  nodes_scanned INTEGER,
  questions_added INTEGER,
  summary TEXT
);
