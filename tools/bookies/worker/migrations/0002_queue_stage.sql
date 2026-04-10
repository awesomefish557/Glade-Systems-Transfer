-- Kanban queue position persisted separately from onboarding_stage metadata.
ALTER TABLE bookies ADD COLUMN queue_stage INTEGER DEFAULT 1;
ALTER TABLE bookies ADD COLUMN stage_updated_at TEXT DEFAULT CURRENT_TIMESTAMP;

UPDATE bookies SET queue_stage = onboarding_stage;
