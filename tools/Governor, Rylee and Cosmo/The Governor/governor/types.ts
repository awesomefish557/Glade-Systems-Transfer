// Governor Decision Memory
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
// governor/types.ts
// Types for Governor annotation

export type GovernorAnnotation = {
  status: 'green' | 'amber' | 'red';
  headline: string;
  why: string[];
  risk: {
    class: 1 | 2 | 3 | 4;
    door: 'two_way' | 'one_point_five' | 'one_way';
    undo_friction: number;
    damage_profile: 'fast' | 'slow' | 'latent';
  };
  permission: {
    requires_clearance: boolean;
    next_safe_window_days: [number, number];
    earliest_safe_quarter: string;
  };
  fun: {
    week_gbp: [number, number];
    month_gbp: [number, number];
  };
  money: {
    one_off_affordable_now: boolean;
    one_off_affordable_soon_days: [number, number];
    commitment_sensitive: boolean;
  };
  staging_plan: Array<{
    stage: number;
    name: string;
    cost_gbp: [number, number];
    goal: string;
  }>;
  options: Array<{
    label: string;
    action: string;
    impact: string;
  }>;

  last_reviewed_at: string;
  confidence: 'low' | 'medium' | 'high';
  // --- MISSING FIELDS/FEATURES ---
  commitment_gate?: CommitmentGate;
  notes?: string;
};

// Commitment gating block
export type CommitmentGate = {
  requested_monthly_gbp?: number;
  allowed: boolean;
  max_monthly_gbp?: number;
  runway_impact_weeks: number;
  why?: string[];
};

// Weekly briefing report
export type WeeklyBriefing = {
  week_start: string;
  status_line: string;
  liquidity: { now: number; in_7_days: number; emergency_intact: boolean };
  runway: { months: number; delta_vs_last: number };
  projects: { count: number; active: Array<{ id: string; name: string; next_action?: string }> };
  timeline: { next_risk_window: [number, number]; becoming_affordable: Array<string> };
  fun_range: { week: [number, number]; month: [number, number] };
  progress: { completed: string[]; good_calls: string[] };
  advice: string[];
  questions: string[];
  contribution_pool?: { allocated_gbp: number };
};

// Quarterly review report
export type QuarterlyReview = {
  quarter_id: string;
  narrative: {
    summary: string;
    wealth_trajectory: string;
    risk_scorecard: string;
    capital_goals: string;
    success_definition: string;
    celebration: string;
    forward_adjustments: string[];
  };
  charts: {
    net_position_by_quarter: number[];
    risk_counts_by_quarter: number[];
    door_mix_by_quarter: number[];
    commitment_load_by_quarter: number[];
    capital_goal_progress_by_quarter: number[];
  };
  contribution_pool?: { allocated_gbp: number };
};

// Timeline/calendar view
export type TimelineBand = 'Now-2w' | '2w-2m' | '2m-6m';
export type TimelineItem = {
  project_id: string;
  label: string;
  band: TimelineBand;
  status: 'Committed' | 'Likely' | 'Possible';
  next_action?: string;
  desired_by?: string;
};

// Capital goal
export type CapitalGoal = {
  id: string;
  name: string;
  status: 'Advancing' | 'Holding' | 'Stalled';
  base_quarter: string;
  downside_quarter: string;
  progress: number;
};

// Celebration/reward
export type Celebration = {
  milestone: string;
  reward_token?: string;
};

// Charity/contribution pool
export type ContributionPool = {
  allocated_gbp: number;
  history: Array<{ quarter: string; amount: number }>;
};

// Event log
export type GovernorEvent = {
  ts: string;
  actor: string;
  type: string;
  entity_id: string;
  payload_json: unknown;
};

// Risk metrics/tracking
export type RiskMetrics = {
  bets_by_quarter: Record<string, { R1: number; R2: number; R3: number; R4: number }>;
  door_mix: Record<string, { two_way: number; one_point_five: number; one_way: number }>;
  failure_quality: Record<string, { early_exits: number; clean_reversals: number; buffer_damage: number }>;
  risk_velocity: Record<string, string>;
};
