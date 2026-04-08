-- Bookies D1 schema (core)
-- Remote: wrangler d1 execute bookies-db --remote --file=bookies/schema.sql

CREATE TABLE IF NOT EXISTS bookies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',       -- active | restricted | gubbed | dormant | closed
  welcome_claimed INTEGER DEFAULT 0,
  welcome_profit REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  total_pl REAL DEFAULT 0,
  notes TEXT,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
  onboarding_stage INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bookie_id INTEGER NOT NULL,
  bet_type TEXT NOT NULL,             -- qualifying | free_bet | mug | reload | boost
  market TEXT NOT NULL,
  back_stake REAL NOT NULL,
  back_odds REAL NOT NULL,
  lay_stake REAL NOT NULL,
  lay_odds REAL NOT NULL,
  commission REAL DEFAULT 2.0,
  pl REAL NOT NULL,
  is_free_bet INTEGER DEFAULT 0,
  notes TEXT,
  placed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bookie_id) REFERENCES bookies(id)
);

CREATE TABLE IF NOT EXISTS commandment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  checks TEXT NOT NULL,               -- JSON: {"1":true,"2":false,...}
  activity_notes TEXT,
  mug_bet_placed INTEGER DEFAULT 0,
  logged_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bets_placed_at ON bets(placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_bookie_id ON bets(bookie_id);
CREATE INDEX IF NOT EXISTS idx_bookies_status ON bookies(status);
CREATE INDEX IF NOT EXISTS idx_commandment_logs_date ON commandment_logs(date DESC);

-- Seed bookies (idempotent)
INSERT OR IGNORE INTO bookies (id, name, status, welcome_claimed) VALUES
  (1, 'Bet365', 'active', 0),
  (2, 'William Hill', 'active', 0),
  (3, 'Betway', 'active', 0),
  (4, '888Sport', 'active', 0),
  (5, 'Coral', 'active', 0),
  (6, 'Ladbrokes', 'active', 0),
  (7, 'BetVictor', 'active', 0),
  (8, 'Sky Bet', 'active', 0),
  (9, 'Paddy Power', 'active', 0),
  (10, 'Unibet', 'active', 0),
  (11, 'Marathonbet', 'active', 0),
  (12, 'BoyleSports', 'active', 0),
  (13, 'Spreadex', 'active', 0),
  (14, 'QuinnBet', 'active', 0),
  (15, 'Virgin Bet', 'active', 0),
  (16, 'Betfair Sportsbook', 'active', 0),
  (17, 'Betfred', 'active', 0),
  (18, 'SportNation', 'active', 0),
  (19, 'Mr Play', 'active', 0),
  (20, 'Midnite', 'active', 0),
  (21, 'Coolbet', 'active', 0),
  (22, 'Rhino Bet', 'active', 0),
  (23, 'BetUK', 'active', 0),
  (24, 'Boylesports', 'active', 0),
  (25, 'Jennings Bet', 'active', 0),
  (26, 'Fitzdares', 'active', 0),
  (27, 'Sporting Index', 'active', 0),
  (28, 'Spreadex', 'active', 0),
  (29, 'Totalbet', 'active', 0),
  (30, 'Betway', 'active', 0),
  (31, 'Proform Racing', 'active', 0),
  (32, 'BetVictor', 'active', 0),
  (33, 'Grosvenor Sport', 'active', 0),
  (34, 'Bet Storm', 'active', 0),
  (35, 'Bally Bet', 'active', 0),
  (36, 'Betmgm', 'active', 0),
  (37, 'Betiton', 'active', 0),
  (38, 'Pronto Bet', 'active', 0);

-- Queue: Coral account-created (stage 2) with welcome still open
UPDATE bookies SET onboarding_stage = 2 WHERE LOWER(TRIM(name)) = 'coral' AND IFNULL(welcome_claimed, 0) = 0;
