-- Track upload lifecycle: pending until client confirms after PUT to R2.
ALTER TABLE attachments ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
