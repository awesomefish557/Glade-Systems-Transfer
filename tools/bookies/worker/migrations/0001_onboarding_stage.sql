-- Existing databases: add kanban stage. New installs may already have this column from schema.sql — skip if duplicate.
ALTER TABLE bookies ADD COLUMN onboarding_stage INTEGER NOT NULL DEFAULT 1;

UPDATE bookies
SET onboarding_stage = 2
WHERE LOWER(TRIM(name)) = 'coral' AND IFNULL(welcome_claimed, 0) = 0;
