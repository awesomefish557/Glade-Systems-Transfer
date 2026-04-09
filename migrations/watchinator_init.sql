CREATE TABLE IF NOT EXISTS watchinator_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  target_url TEXT DEFAULT '',
  hardlock INTEGER DEFAULT 0,
  domain_lock TEXT DEFAULT '',
  wifi_ssid TEXT DEFAULT '',
  wifi_pass TEXT DEFAULT '',
  version TEXT DEFAULT 'v0.1.0-alpha',
  updated_at TEXT DEFAULT ''
);

INSERT OR IGNORE INTO watchinator_config (id) VALUES (1);
