-- Weekly briefing rows use type = 'briefing'; chat uses 'chat' (default).
-- Apply: wrangler d1 execute governor_core --remote --file=migrations/0001_governor_conversations_type.sql
ALTER TABLE governor_conversations ADD COLUMN type TEXT DEFAULT 'chat';
