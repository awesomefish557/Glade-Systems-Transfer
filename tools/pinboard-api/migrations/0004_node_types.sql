-- Per-map custom node types; relax nodes.type CHECK via table rebuild
CREATE TABLE IF NOT EXISTS node_types (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(map_id, name)
);

INSERT OR IGNORE INTO node_types (id, map_id, name, color, sort_order) VALUES
  ('default-precedent',  'default', 'PRECEDENT',  '#c49a3c', 0),
  ('default-concept',    'default', 'CONCEPT',    '#4a9b8e', 1),
  ('default-technique',  'default', 'TECHNIQUE',  '#7a6a9e', 2),
  ('default-person',     'default', 'PERSON',     '#5a8a5a', 3),
  ('default-place',      'default', 'PLACE',      '#8a6a5a', 4),
  ('default-resource',   'default', 'RESOURCE',   '#d4a853', 5),
  ('default-quote',      'default', 'QUOTE',      '#a89a7a', 6),
  ('default-project',    'default', 'PROJECT',    '#6ab86a', 7),
  ('default-question',   'default', 'QUESTION',   '#cc4444', 8);

INSERT OR IGNORE INTO maps (id, name, description, color)
VALUES ('food', 'Food Map', 'Cuisines, dishes, techniques, chefs', '#c47c3c');

INSERT OR IGNORE INTO node_types (id, map_id, name, color, sort_order) VALUES
  ('food-dish',        'food', 'DISH',        '#c47c3c', 0),
  ('food-cuisine',     'food', 'CUISINE',     '#4a9b8e', 1),
  ('food-technique',   'food', 'TECHNIQUE',   '#7a6a9e', 2),
  ('food-chef',        'food', 'CHEF',        '#5a8a5a', 3),
  ('food-flavour',     'food', 'FLAVOUR',     '#b06070', 4),
  ('food-ingredient',  'food', 'INGREDIENT',  '#8a9a4a', 5),
  ('food-restaurant',  'food', 'RESTAURANT',  '#8a6a5a', 6),
  ('food-recipe',      'food', 'RECIPE',      '#d4a853', 7),
  ('food-question',    'food', 'QUESTION',    '#cc4444', 8);

ALTER TABLE loading_bay ADD COLUMN map_id TEXT DEFAULT 'default';

PRAGMA foreign_keys=OFF;
CREATE TABLE nodes_rebuild (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  tags TEXT DEFAULT '[]',
  x REAL DEFAULT 0,
  y REAL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  map_id TEXT DEFAULT 'default'
);
INSERT INTO nodes_rebuild SELECT id, type, title, body, tags, x, y, metadata, created_at, updated_at, COALESCE(map_id, 'default') FROM nodes;
DROP TABLE nodes;
ALTER TABLE nodes_rebuild RENAME TO nodes;
PRAGMA foreign_keys=ON;

INSERT INTO node_types (id, map_id, name, color, sort_order)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
  m.id,
  'QUESTION',
  '#cc4444',
  999
FROM maps m
WHERE NOT EXISTS (SELECT 1 FROM node_types t WHERE t.map_id = m.id);
