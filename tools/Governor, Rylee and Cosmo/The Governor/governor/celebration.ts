import type { CelebrationEventDB, CelebrationEventType, CelebrationCategory } from '../../Core/src/types/celebration_event_db';
import { insertCelebrationEvent, listCelebrationEvents } from '../../Core/src/db/queries';

/**
 * Helper to emit a celebration/milestone/discipline event if not recently emitted (dedupe/rate-limited).
 * @param event Partial<CelebrationEventDB> (no id/created_at)
 * @param env Core env
 * @param dedupeWindowDays number of days to look back for dedupe (7 for weekly, 90 for quarterly)
 */
export async function emitCelebrationIfEligible(
  event: Omit<CelebrationEventDB, 'id' | 'created_at'>,
  env: any,
  dedupeWindowDays: number = 7
): Promise<boolean> {
  // Dedupe: check for identical title+project_id in window
  const since = new Date(Date.now() - dedupeWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const recent = await listCelebrationEvents(env, event.type, 50);
  const found = recent.find(e =>
    e.title === event.title &&
    (e.project_id ?? null) === (event.project_id ?? null) &&
    e.created_at >= since
  );
  if (found) return false;
  // Insert event
  const now = new Date().toISOString();
  const toInsert: CelebrationEventDB = {
    id: crypto.randomUUID(),
    ...event,
    created_at: now,
  };
  await insertCelebrationEvent(env, toInsert);
  return true;
}
