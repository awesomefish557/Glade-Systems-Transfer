import { emitCelebrationIfEligible } from './celebration';
import type { CelebrationEventType, CelebrationCategory } from '../../Core/src/types/celebration_event_db';
// --- CELEBRATION EVENT EMISSION HOOKS ---
// A) Decision review (discipline, risk)
export async function maybeEmitDecisionReviewCelebration(decision: import('../../Core/src/types/decision_db').GovernorDecisionDB, reviewTime: Date, env: any, reversed: boolean) {
  // Discipline: reviewed on time
  if (decision.review_after && decision.status === 'reviewed') {
    const reviewAfter = new Date(decision.review_after);
    if (reviewTime <= reviewAfter) {
      await emitCelebrationIfEligible({
        type: 'discipline',
        category: 'system',
        title: 'Decision reviewed on time',
        description: 'A prior decision was reviewed as planned, reinforcing disciplined follow-through.',
        project_id: decision.project_id ?? null,
      }, env, 7);
    }
  }
  // Risk: two-way door reversed safely
  if (reversed && decision.door_type === 'two_way') {
    await emitCelebrationIfEligible({
      type: 'celebration',
      category: 'risk',
      title: 'Reversible risk handled well',
      description: 'A two-way decision was reversed safely with limited downside.',
      project_id: decision.project_id ?? null,
    }, env, 7);
  }
}

// C) Project completion (milestone)
export async function maybeEmitProjectCompletionCelebration(project: import('../../Core/src/types/project_db').ProjectDB, env: any) {
  if (project.status === 'completed') {
    await emitCelebrationIfEligible({
      type: 'milestone',
      category: 'project',
      title: 'Project completed',
      description: 'The project reached completion. Effort converted into learning or outcome.',
      project_id: project.id,
    }, env, 7);
  }
}

// D) Buffer discipline (rate-limited, to be called from weekly/quarterly)
export async function maybeEmitBufferDisciplineCelebration(env: any, period: 'weekly' | 'quarterly', bufferIntact: boolean) {
  if (!bufferIntact) return;
  const dedupeDays = period === 'quarterly' ? 90 : 7;
  await emitCelebrationIfEligible({
    type: 'discipline',
    category: 'finance',
    title: 'Emergency buffer respected',
    description: 'Financial safety buffers remained intact throughout the period.',
    project_id: null,
  }, env, dedupeDays);
}

// E) Professional risk-taking (quarterly only)
export async function maybeEmitProfessionalRiskTakingCelebration(env: any, qualifying: boolean) {
  if (!qualifying) return;
  await emitCelebrationIfEligible({
    type: 'celebration',
    category: 'risk',
    title: 'Professional risk-taking',
    description: 'Multiple controlled risks were taken while maintaining system safety.',
    project_id: null,
  }, env, 90);
}
// --- Governor Decision Memory Integration ---
import type { GovernorDecisionPayload } from '../../shared/decision_types';
import type { CelebrationEventDB } from '../../Core/src/types/celebration_event_db';
import { listCelebrationEvents } from '../../Core/src/db/queries';

// Placeholder: fetch decisions from Core API
export async function fetchGovernorDecisions(env: Record<string, unknown>, projectId?: string): Promise<GovernorDecisionPayload[]> {
  const url = projectId
    ? `https://core-api.gladesystems.workers.dev/governor/decisions?project_id=${projectId}`
    : `https://core-api.gladesystems.workers.dev/governor/decisions`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return await res.json();
}

// Reference past decisions in project review
export async function summarizePastDecisionsForProject(env: Record<string, unknown>, projectId: string): Promise<string[]> {
  const decisions = await fetchGovernorDecisions(env, projectId);
  if (!decisions.length) return [];
  return decisions.map(d => {
    let ref = `Previously ${d.decision_type} as a ${d.door_type.replace('_', '-')} door`;
    if (d.status === 'reversed') ref += ' (reversed)';
    if (d.status === 'reviewed') ref += ' (reviewed)';
    if (d.rationale) ref += `: ${d.rationale}`;
    return ref;
  });
}

// Find decisions nearing review_after (within 7 days)
export async function decisionsNearingReview(env: Record<string, unknown>, now: Date = new Date()): Promise<GovernorDecisionPayload[]> {
  const all = await fetchGovernorDecisions(env);
  return all.filter(d => {
    if (!d.review_after || d.status !== 'active') return false;
    const reviewDate = new Date(d.review_after);
    const diff = (reviewDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  });
}

// Summarize decisions for quarterly briefing
export async function summarizeQuarterlyDecisions(env: Record<string, unknown>, quarter: string): Promise<{
  total: number;
  reversals: number;
  risk: Record<string, number>;
}> {
  const all = await fetchGovernorDecisions(env);
  const inQuarter = all.filter(d => d.made_at.startsWith(quarter.replace('Q', '-Q')));
  return {
    total: inQuarter.length,
    reversals: inQuarter.filter(d => d.status === 'reversed').length,
    risk: inQuarter.reduce((acc, d) => {
      acc[d.risk_level] = (acc[d.risk_level] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}
// Minimal in-memory rate limiting: max 5 posts per 10s window
export const governorPostTimestamps: number[] = [];
export function canPostToCoreGovernor(): boolean {
  const now = Date.now();
  // Remove timestamps older than 10s
  while (governorPostTimestamps.length && now - governorPostTimestamps[0] > 10000) governorPostTimestamps.shift();
  return governorPostTimestamps.length < 5;
}
// End fetchGovernorAnnotation
// --- MISSING FEATURE STUBS (chronological order) ---

// 1. Commitment gating
export function evaluateCommitment(requested_monthly_gbp: number, finance: { liquid_now?: number; emergency_locked_gbp?: number; monthly_burn?: number }): import('./types').CommitmentGate {
  // Compute runway impact if new commitment is added
  const liquid = typeof finance.liquid_now === 'number' ? finance.liquid_now : 0;
  const emergency = typeof finance.emergency_locked_gbp === 'number' ? finance.emergency_locked_gbp : 0;
  const base_burn = typeof finance.monthly_burn === 'number' ? finance.monthly_burn : 1;
  const floor_months = 3;
  const available = liquid - emergency;
  const new_burn = base_burn + requested_monthly_gbp;
  const base_runway = available / base_burn;
  const new_runway = available / new_burn;
  const runway_impact_weeks = Math.round((base_runway - new_runway) * 4.345);
  let allowed = false;
  let why: string[] = [];
  let max_monthly_gbp = 0;
  // Find max monthly commitment that keeps runway >= floor
  if (available > 0) {
    max_monthly_gbp = Math.floor((available / floor_months) - base_burn);
    if (max_monthly_gbp < 0) max_monthly_gbp = 0;
  }
  if (new_runway >= floor_months) {
    allowed = true;
    why.push('Runway remains above safety floor.');
  } else {
    allowed = false;
    why.push('Runway would fall below 3 months.');
  }
  if (requested_monthly_gbp > max_monthly_gbp) {
    why.push(`Max safe monthly commitment: £${max_monthly_gbp}`);
  }
  // Latent damage risk if base_burn is low and commitment is high
  if (requested_monthly_gbp > 0.5 * base_burn) {
    why.push('Large new commitment may create latent risk.');
  }
  return {
    requested_monthly_gbp,
    allowed,
    max_monthly_gbp,
    runway_impact_weeks,
    why,
  };
}

// 2. Weekly briefing
export async function weeklyBriefingWithDecisions(env: Record<string, unknown>): Promise<import('./types').WeeklyBriefing & { decisions_nearing_review: GovernorDecisionPayload[], recent_celebrations: CelebrationEventDB[] }> {
  const now = new Date();
  const week_start = new Date(now);
  week_start.setDate(now.getDate() - now.getDay()); // Sunday
  const decisions_nearing_review = await decisionsNearingReview(env, now);
  // Get recent celebrations (last 7 days, up to 5)
  const recent_celebrations = await listCelebrationEvents(env, 'celebration', 5);
  return {
    week_start: week_start.toISOString().slice(0, 10),
    status_line: 'All systems nominal. No emergencies.',
    liquidity: { now: 12000, in_7_days: 12500, emergency_intact: true },
    runway: { months: 6, delta_vs_last: 0.5 },
    projects: {
      count: 4,
      active: [
        { id: 'p1', name: 'Website Redesign', next_action: 'Review wireframes' },
        { id: 'p2', name: 'Data Migration', next_action: 'Test import script' },
        { id: 'p3', name: 'Capital Goal: Studio', next_action: 'Finalize quote' },
      ],
    },
    timeline: {
      next_risk_window: [2, 5],
      becoming_affordable: ['Studio Upgrade', 'Team Retreat'],
    },
    fun_range: { week: [50, 120], month: [200, 480] },
    progress: {
      completed: ['Finished Q1 migration', 'Closed old accounts'],
      good_calls: ['Deferred risky spend', 'Clean exit from vendor contract'],
    },
    advice: ['Consider staging the new project.', 'Review buffer allocation.'],
    questions: [
      'What is the next milestone for Data Migration?',
      'Any upcoming liquidity events?',
      'Are all capital goals on track?',
    ],
    contribution_pool: { allocated_gbp: 300 },
    decisions_nearing_review,
    recent_celebrations,
  };
}

// 3. Quarterly review
export async function quarterlyReviewWithDecisions(env: Record<string, unknown>, quarter_id: string): Promise<import('./types').QuarterlyReview & { decision_summary: any, celebration_summary: Record<string, number>, recent_celebrations: CelebrationEventDB[] }> {
  // Example implementation with all narrative and chart sections
  const decision_summary = await summarizeQuarterlyDecisions(env, quarter_id);
  // Get all celebrations in last 90 days, summarize by category
  const all_celebrations = await listCelebrationEvents(env, 'celebration', 100);
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const filtered = all_celebrations.filter(e => e.created_at >= since);
  const celebration_summary = filtered.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  // Show up to 5 most recent
  const recent_celebrations = filtered.slice(0, 5);
  return {
    quarter_id,
    narrative: {
      summary: 'Quarter in one line: Stable growth, no emergencies.',
      wealth_trajectory: 'Net position increased by 8%.',
      risk_scorecard: '2 R3 bets, 1 clean exit, no buffer damage.',
      capital_goals: 'Studio project advanced, vehicle on hold.',
      success_definition: 'Learning: 2 new skills, Building: 1 launch, Harvesting: 1 milestone.',
      celebration: 'Celebrated clean exit from legacy vendor.',
      forward_adjustments: ['Increase fun allocation', 'Review capital goal timeline'],
    },
    charts: {
      net_position_by_quarter: [10000, 11000, 12000],
      risk_counts_by_quarter: [2, 3, 2],
      door_mix_by_quarter: [1, 2, 1],
      commitment_load_by_quarter: [500, 700, 600],
      capital_goal_progress_by_quarter: [0.2, 0.5, 0.7],
    },
    contribution_pool: { allocated_gbp: 350 },
    decision_summary,
    celebration_summary,
    recent_celebrations,
  };
}

// 4. Timeline/calendar view
export function computeTimelineView(): import('./types').TimelineItem[] {
  // Example: slot 3 projects into bands, one per project
  return [
    {
      project_id: 'p1',
      label: 'Website Redesign',
      band: 'Now-2w',
      status: 'Committed',
      next_action: 'Review wireframes',
      desired_by: '2026-02-01',
    },
    {
      project_id: 'p2',
      label: 'Data Migration',
      band: '2w-2m',
      status: 'Likely',
      next_action: 'Test import script',
      desired_by: '2026-03-01',
    },
    {
      project_id: 'p3',
      label: 'Studio Capital Goal',
      band: '2m-6m',
      status: 'Possible',
      next_action: 'Finalize quote',
      desired_by: '2026-06-01',
    },
  ];
}

// 5. Capital goals
export function getCapitalGoals(): import('./types').CapitalGoal[] {
  // Example: return 2 capital goals with all required fields
  return [
    {
      id: 'cg1',
      name: 'Studio Upgrade',
      status: 'Advancing',
      base_quarter: '2026-Q2',
      downside_quarter: '2026-Q3',
      progress: 0.5,
    },
    {
      id: 'cg2',
      name: 'Electric Vehicle',
      status: 'Holding',
      base_quarter: '2026-Q4',
      downside_quarter: '2027-Q1',
      progress: 0.2,
    },
  ];
}

// 6. Celebration/rewards
export function getCelebrations(): import('./types').Celebration[] {
  // Example: return celebrations for milestones and good calls
  return [
    { milestone: 'Completed Data Migration' },
    { milestone: 'Deferred one-way door', reward_token: 'fun_uplift' },
    { milestone: 'Clean exit from vendor' },
  ];
}

// 7. Charity/contribution pool
export function getContributionPool(): import('./types').ContributionPool {
  // Example: return pool with allocation and history
  return {
    allocated_gbp: 500,
    history: [
      { quarter: '2025-Q4', amount: 400 },
      { quarter: '2026-Q1', amount: 500 },
    ],
  };
}

// 8. Event log
// In-memory event log for demonstration/testing
const _eventLog: import('./types').GovernorEvent[] = [];
export function logGovernorEvent(event: import('./types').GovernorEvent): void {
  _eventLog.push(event);
}

// 9. Risk metrics/tracking
export function getRiskMetrics(): import('./types').RiskMetrics {
  // Example: stable output with unknown bins if empty
  return {
    bets_by_quarter: {
      unknown: { R1: 0, R2: 0, R3: 0, R4: 0 },
      '2026-Q1': { R1: 2, R2: 1, R3: 1, R4: 0 },
    },
    door_mix: {
      unknown: { two_way: 0, one_point_five: 0, one_way: 0 },
      '2026-Q1': { two_way: 2, one_point_five: 1, one_way: 1 },
    },
    failure_quality: {
      unknown: { early_exits: 0, clean_reversals: 0, buffer_damage: 0 },
      '2026-Q1': { early_exits: 1, clean_reversals: 1, buffer_damage: 0 },
    },
    risk_velocity: {
      unknown: 'stable',
      '2026-Q1': 'high velocity, low damage',
    },
  };
}
// governor/logic.ts
// Core Governor logic for project review

import { GovernorAnnotation } from './types';

export async function handleGovernorReview(projectId: string, env: Record<string, unknown>): Promise<{ annotation: GovernorAnnotation; card: string }> {
  // 1. Load project from Core API
  const project = await fetchProject(projectId, env);
  // 2. Load latest finance snapshot
  const finance = await fetchLatestFinance(env);
  // 3. Load existing annotation (optional)
  const existing = await fetchGovernorAnnotation(projectId, env);
  // 4. Compute annotation
  const annotation = computeGovernorAnnotation(project, finance, existing);
  // 5. Write annotation
  await putGovernorAnnotation(projectId, annotation, env);
  // 6. Render card text (simple summary)
  const card = renderGovernorCard(annotation);
  return { annotation, card };
}

async function fetchProject(_projectId: string, _env: Record<string, unknown>) {
  // TODO: Implement API call to fetch project
  return {};
}
async function fetchLatestFinance(_env: Record<string, unknown>) {
  // TODO: Implement API call to fetch latest finance snapshot
  return {};
}
  // Fetch Governor annotation from real core API
export async function fetchGovernorAnnotation(projectId: string, _env: Record<string, unknown>) {
  const url = `https://core-api.gladesystems.workers.dev/governor/${projectId}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  // Expect annotation_json as string or object
  if (data && data.annotation_json) {
    try {
      return typeof data.annotation_json === 'string'
        ? JSON.parse(data.annotation_json)
        : data.annotation_json;
    } catch {
      return null;
    }
  }
  return null;
}
// Contract: See ../../shared/schema.md for all core-facing payloads and field names.

import type { GovernorAnnotationPayload } from '../../shared/types';
// Minimal idempotency: add processed marker to annotation if not present
function addIdempotencyMarker(annotation: Record<string, unknown>): Record<string, unknown> {
  if (!annotation._core_processed) {
    annotation._core_processed = true;
  }
  return annotation;
}

function validateGovernorAnnotationPayload(payload: GovernorAnnotationPayload): boolean {
  return (
    typeof payload.project_id === 'string' &&
    typeof payload.annotation_json === 'string' &&
    typeof payload.updated_at === 'string' &&
    (payload.updated_at.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/) !== null) // ISO check
  );
}
export async function putGovernorAnnotation(projectId: string, annotation: GovernorAnnotation, _env: Record<string, unknown>) {
  if (!canPostToCoreGovernor()) {
    console.warn('[core/governor] Rate limit: too many posts to core in 10s window');
    throw new Error('Rate limit: too many posts to core');
  }
  governorPostTimestamps.push(Date.now());
  // Use shared contract for payload
  const url = `https://core-api.gladesystems.workers.dev/governor/${projectId}`;
  const deduped = addIdempotencyMarker(annotation);
  const payload: GovernorAnnotationPayload = {
    project_id: projectId,
    annotation_json: JSON.stringify(deduped),
    updated_at: new Date().toISOString(),
  };
  if (!validateGovernorAnnotationPayload(payload)) {
    console.error('[core/governor]', 'Invalid payload for core:', payload);
    throw new Error('Invalid GovernorAnnotationPayload');
  }
  let lastError = null;
  let delay = 500;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        console.log('[core/governor]', 'POSTED annotation', { project_id: projectId });
        return true;
      }
    } catch (e) {
      if (e instanceof Error) {
        lastError = e.message;
      } else {
        lastError = String(e);
      }
      console.error('[core/governor]', 'POST error:', lastError);
    }
    await new Promise(r => setTimeout(r, delay));
    delay *= 2;
  }
  throw new Error('Core rejected GovernorAnnotationPayload: ' + lastError);
}


export function computeGovernorAnnotation(
  project: { estimated_cost_range?: { min?: number; max?: number }; reversibility?: string; cooldown_until?: string } & Record<string, any>,
  finance: { surplus_min?: number; surplus_max?: number; volatility?: string; emergency_locked_gbp?: number; liquid_now?: number; monthly_burn?: number; liquid_in_days?: Array<{ day: number; available_liquid: number }> },
  _existing: unknown
): GovernorAnnotation {
  // --- 1. Risk classification (default-safe) ---
  let riskClass = 1;
  let undoFriction = 1;
  let door: 'two_way' | 'one_point_five' | 'one_way' = 'two_way';
  let damageProfile: 'fast' | 'slow' | 'latent' = 'slow';
  const cost = project.estimated_cost_range ?? {};
  const reversibility = project.reversibility;
  if (reversibility === 'one_way') {
    riskClass = 4;
    undoFriction = 4;
    door = 'one_way';
  } else if (cost && typeof cost.max === 'number' && cost.max >= 500) {
    riskClass = 3;
  } else if (cost && typeof cost.max === 'number' && cost.max < 500) {
    riskClass = 2;
  } else {
    riskClass = 1;
  }
  if (!reversibility) {
    door = 'two_way';
  } else if (reversibility === 'one_point_five') {
    door = 'one_point_five';
    undoFriction = 2;
  }

  // --- 2. Hard safety rules (non-negotiable) ---
  let status: 'green' | 'amber' | 'red' = 'green';
  let why: string[] = [];
  const emergencyLocked = typeof finance.emergency_locked_gbp === 'number' ? finance.emergency_locked_gbp : 0;
  const liquidNow = typeof finance.liquid_now === 'number' ? finance.liquid_now : 0;
  const monthlyBurn = typeof finance.monthly_burn === 'number' ? finance.monthly_burn : 1;
  const projectedSpend = typeof cost.max === 'number' ? cost.max : 0;
  if (liquidNow - projectedSpend < emergencyLocked) {
    status = 'red';
    why.push('Would breach emergency buffer');
  }
  const runwayMonths = monthlyBurn > 0 ? liquidNow / monthlyBurn : 99;
  if (runwayMonths < 3 && riskClass >= 3) {
    status = 'red';
    why.push('Runway under 3 months for high risk');
  }
  if (project.cooldown_until) {
    const cooldownUntil = new Date(project.cooldown_until);
    if (cooldownUntil > new Date() && riskClass >= 3) {
      status = 'red';
      why.push('Cooldown active for high risk');
    }
  }

  // --- 3. Opportunity window (timing) ---
  let nextSafeWindow: [number, number] = [0, 0];
  let oneOffAffordableNow = false;
  let oneOffAffordableSoonDays: [number, number] = [0, 0];
  if (finance.liquid_in_days && Array.isArray(finance.liquid_in_days) && cost?.max) {
    let earliestIdx: number | null = null;
    for (let i = 0; i < finance.liquid_in_days.length; i++) {
      const day = finance.liquid_in_days[i].day;
      const liquid = day === 0 ? finance.liquid_now : finance.liquid_in_days[i].available_liquid;
      const residual = (typeof liquid === 'number' ? liquid : 0) - emergencyLocked - (typeof cost.max === 'number' ? cost.max : 0);
      const runway = monthlyBurn > 0 ? residual / monthlyBurn : 99;
      // Window eligibility: emergency lock respected + residual >= 0
      if (residual >= 0) {
        if (day === 0) {
          if (runway >= 3) {
            earliestIdx = i;
            break;
          }
        } else {
          earliestIdx = i;
          break;
        }
      }
    }
    if (liquidNow - emergencyLocked - cost.max >= 0 && runwayMonths >= 3) {
      nextSafeWindow = [0, 0];
      oneOffAffordableNow = true;
      oneOffAffordableSoonDays = [0, 0];
    } else if (earliestIdx !== null) {
      const earliestDay = finance.liquid_in_days[earliestIdx].day;
      const nextLiquidityPointDay = finance.liquid_in_days[earliestIdx + 1]?.day ?? finance.liquid_in_days[earliestIdx].day;
      nextSafeWindow = [earliestDay, nextLiquidityPointDay];
      oneOffAffordableSoonDays = [earliestDay, nextLiquidityPointDay];
    }
  }

  // --- 4. Fun range (always included) ---
  const surplusMin = typeof finance.surplus_min === 'number' ? finance.surplus_min : 0;
  const surplusMax = typeof finance.surplus_max === 'number' ? finance.surplus_max : 0;
  let monthlyMin = Math.max(20, 0.05 * surplusMin);
  let monthlyMax = Math.max(monthlyMin, 0.12 * surplusMax);
  if (finance.volatility === 'volatile') {
    monthlyMin = Math.round(monthlyMin * 0.7);
    monthlyMax = Math.round(monthlyMax * 0.7);
  }
  const weekMin = Math.round(monthlyMin / 4);
  const weekMax = Math.round(monthlyMax / 4);

  // --- 5. Staging plan (if not Green or confidence low) ---
  let stagingPlan = [];
  let confidence: 'low' | 'medium' | 'high' = 'high';
  if (status !== 'green' || (cost && typeof cost.max === 'number' && cost.max - (cost.min ?? 0) > 200) || !reversibility) {
    confidence = 'low';
    stagingPlan = [
      { stage: 0, name: 'Scope / quote', cost_gbp: [0, 50], goal: 'Reduce uncertainty' },
      { stage: 1, name: 'Prototype', cost_gbp: [50, Math.min(500, cost?.min ?? 500)], goal: 'Test approach' },
      { stage: 2, name: 'Commit / ship', cost_gbp: [Math.min(500, cost?.min ?? 500), cost?.max ?? 1000], goal: 'Deliver outcome' },
    ];
  } else {
    confidence = 'high';
    stagingPlan = [
      { stage: 0, name: 'Scope / quote', cost_gbp: [0, 50], goal: 'Reduce uncertainty' },
    ];
  }

  // --- 6. Output structure ---
  const annotation: GovernorAnnotation = {
    status,
    headline:
      status === 'green'
        ? 'All clear. Proceed if ready.'
        : status === 'red'
        ? 'Not safe to proceed.'
        : 'Proceed with caution.',
    why: why.slice(0, 3),
    risk: {
      class: riskClass as 1 | 2 | 3 | 4,
      door,
      undo_friction: undoFriction,
      damage_profile: damageProfile,
    },
    permission: {
      requires_clearance: status !== 'green',
      next_safe_window_days: nextSafeWindow,
      earliest_safe_quarter: getEarliestSafeQuarter(),
    },
    fun: {
      week_gbp: [weekMin, weekMax],
      month_gbp: [monthlyMin, monthlyMax],
    },
    money: {
      one_off_affordable_now: oneOffAffordableNow,
      one_off_affordable_soon_days: oneOffAffordableSoonDays,
      commitment_sensitive: riskClass >= 3,
    },
    staging_plan: stagingPlan.map((s) => ({
      ...s,
      cost_gbp: [s.cost_gbp[0] ?? 0, s.cost_gbp[1] ?? 0] as [number, number],
    })),
    options: [
      { label: 'A (safe)', action: 'Stage it', impact: 'No buffer impact' },
    ],
    last_reviewed_at: new Date().toISOString(),
    confidence,
    commitment_gate: evaluateCommitment(
      typeof project.requested_monthly_gbp === 'number' ? project.requested_monthly_gbp : 0,
      finance
    ),
  };
  return annotation;

  function getEarliestSafeQuarter(): string {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const q = Math.floor(month / 3) + 1;
    return `${year}-Q${q}`;
  }
}

export function renderGovernorCard(annotation: import('./types').GovernorAnnotation): string {
  // TODO: Render a human-readable summary card
  return annotation.headline;
}
