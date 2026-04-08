-- Live exchange positions: platform ids, odds, and settlement sync
ALTER TABLE positions ADD COLUMN platform TEXT;
ALTER TABLE positions ADD COLUMN platform_bet_id TEXT;
ALTER TABLE positions ADD COLUMN platform_odds REAL;

CREATE INDEX IF NOT EXISTS idx_positions_platform_open
  ON positions(platform, status)
  WHERE platform IS NOT NULL AND status = 'OPEN';
