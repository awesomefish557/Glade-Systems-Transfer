-- Paper / exchange-sim positions: commission rate frozen at open (for net P&L on settlement).
ALTER TABLE positions ADD COLUMN applied_commission REAL DEFAULT 0;
