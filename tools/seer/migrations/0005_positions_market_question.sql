-- Denormalised label for positions with no joined `markets` row (e.g. exchange paper / LIVE feed ids).
ALTER TABLE positions ADD COLUMN market_question TEXT;
