CREATE TABLE IF NOT EXISTS delphi_scenarios (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  context TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delphi_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  scenario_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delphi_analyses (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  scenario_id TEXT,
  move TEXT,
  mechanism TEXT,
  confidence TEXT,
  second_order TEXT,
  third_order TEXT,
  countermoves TEXT,
  distributed_version TEXT,
  historical_parallel TEXT,
  leverage_point TEXT,
  reversibility TEXT,
  weakest_assumption TEXT,
  unknowns TEXT,
  raw_response TEXT,
  created_at TEXT NOT NULL
);
