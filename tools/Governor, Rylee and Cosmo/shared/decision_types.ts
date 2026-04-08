// Shared types for Governor Decision Memory
export type GovernorDecisionStatus = 'active' | 'reviewed' | 'reversed';
export type GovernorDecisionType = 'approve' | 'defer' | 'decline' | 'pause';
export type GovernorDoorType = 'one_way' | 'two_way' | 'unknown';
export type GovernorRiskLevel = 'low' | 'medium' | 'high';

export interface GovernorDecisionPayload {
  id: string;
  project_id?: string | null;
  decision_type: GovernorDecisionType;
  door_type: GovernorDoorType;
  risk_level: GovernorRiskLevel;
  rationale: string;
  expected_outcome?: string | null;
  cost_committed_gbp?: number | null;
  made_at: string; // ISO timestamp
  review_after?: string | null; // ISO date
  status: GovernorDecisionStatus;
  outcome_notes?: string | null;
}
