// TypeScript types for the projects table
export type ProjectStatus = 'active' | 'shelved' | 'completed' | 'abandoned';

export interface ProjectDB {
  id: string;
  name: string;
  status: ProjectStatus;
  created_at: string; // ISO string
  updated_at: string; // ISO string
  data_json: string; // Canonical Rylee project object as JSON string
}
