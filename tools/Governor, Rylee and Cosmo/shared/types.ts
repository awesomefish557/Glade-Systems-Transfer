// shared/types.ts
// Shared types and constants for all agents and core

export type AgentName = 'Governor' | 'Rylee' | 'Cosmo';

export type EventType =
  | 'governor_annotation_posted'
  | 'cosmo_run_started'
  | 'cosmo_run_completed'
  | 'counterfactual_evaluated'
  | 'external_analysis_exported'
  | 'rylee_project_synced';

export const CORE_ENDPOINTS = {
  PROJECTS: '/projects',
  GOVERNOR: '/governor',
  REPORTS_WEEKLY: '/reports/weekly',
  REPORTS_QUARTERLY: '/reports/quarterly',
};

export interface GovernorAnnotationPayload {
  project_id: string;
  annotation_json: any;
  updated_at: string; // ISO
}

export interface WeeklyReportPayload {
  id: string;
  week_start: string; // ISO
  report_json: any;
  created_at: string; // ISO
}

export interface CosmoAuditEvent {
  event_type: EventType;
  timestamp: string; // ISO
  payload: any;
}

export function isoTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}
