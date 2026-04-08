-- Pre-resolution YES prices from Polymarket CLOB history (Gamma + clob sync via admin).
CREATE TABLE IF NOT EXISTS market_price_history (
  market_id TEXT PRIMARY KEY,
  price_30d_before REAL,
  price_7d_before REAL,
  price_1d_before REAL,
  resolution_outcome TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
