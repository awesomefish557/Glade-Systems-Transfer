// TypeScript types for celebration, milestone, discipline events
export type CelebrationEventType = 'celebration' | 'milestone' | 'discipline';
export type CelebrationCategory = 'risk' | 'finance' | 'project' | 'system';

export interface CelebrationEventDB {
  id: string;
  type: CelebrationEventType;
  category: CelebrationCategory;
  title: string;
  description: string;
  project_id?: string | null;
  created_at: string; // ISO timestamp
}
