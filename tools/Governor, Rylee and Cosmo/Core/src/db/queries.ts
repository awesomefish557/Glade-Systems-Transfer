import type { CelebrationEventDB } from '../types/celebration_event_db';
// Insert a celebration/milestone/discipline event
export async function insertCelebrationEvent(env: any, event: CelebrationEventDB): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, type, category, title, description, project_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    event.id,
    event.type,
    event.category,
    event.title,
    event.description,
    event.project_id ?? null,
    event.created_at
  ).run();
}

// List recent celebration/milestone/discipline events (optionally filter by type)
export async function listCelebrationEvents(env: any, type?: string | null, limit: number = 20): Promise<CelebrationEventDB[]> {
  let query = 'SELECT * FROM events WHERE type IN (\'celebration\',\'milestone\',\'discipline\')';
  let params: any[] = [];
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const { results } = await env.DB.prepare(query).bind(...params).all();
  return results as CelebrationEventDB[];
}
import type { GovernorDecisionDB } from '../types/decision_db';
// Governor Decisions
export async function insertGovernorDecision(env: any, decision: GovernorDecisionDB): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO governor_decisions (
      id, project_id, decision_type, door_type, risk_level, rationale, expected_outcome, cost_committed_gbp, made_at, review_after, status, outcome_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    decision.id,
    decision.project_id ?? null,
    decision.decision_type,
    decision.door_type,
    decision.risk_level,
    decision.rationale,
    decision.expected_outcome ?? null,
    decision.cost_committed_gbp ?? null,
    decision.made_at,
    decision.review_after ?? null,
    decision.status,
    decision.outcome_notes ?? null
  ).run();
}

export async function listGovernorDecisions(env: any, project_id?: string | null): Promise<GovernorDecisionDB[]> {
  let query = 'SELECT * FROM governor_decisions';
  let params: any[] = [];
  if (project_id) {
    query += ' WHERE project_id = ?';
    params.push(project_id);
  }
  query += ' ORDER BY made_at DESC';
  const { results } = await env.DB.prepare(query).bind(...params).all();
  return results as GovernorDecisionDB[];
}

export async function getGovernorDecisionById(env: any, id: string): Promise<GovernorDecisionDB | null> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM governor_decisions WHERE id = ?'
  ).bind(id).all();
  return results[0] as GovernorDecisionDB || null;
}

export async function reviewGovernorDecision(env: any, id: string, outcome_notes: string, reversed: boolean): Promise<void> {
  const status = reversed ? 'reversed' : 'reviewed';
  await env.DB.prepare(
    'UPDATE governor_decisions SET status = ?, outcome_notes = ? WHERE id = ?'
  ).bind(status, outcome_notes, id).run();
}
// Governor Annotations
// Contract: See ../../shared/schema.md for all core-facing payloads and field names.
import type { ProjectGovernorDB } from '../types/governor_db';
export async function getGovernorAnnotation(env: any, project_id: string): Promise<ProjectGovernorDB | null> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM project_governor WHERE project_id = ?'
  ).bind(project_id).all();
  return results[0] as ProjectGovernorDB || null;
}
export async function upsertGovernorAnnotation(env: any, annotation: ProjectGovernorDB): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO project_governor (project_id, annotation_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET annotation_json = excluded.annotation_json, updated_at = excluded.updated_at`
  ).bind(
    annotation.project_id,
    annotation.annotation_json,
    annotation.updated_at
  ).run();
}

// Finance Snapshots
import type { FinanceSnapshotDB } from '../types/finance_db';
export async function getLatestFinanceSnapshot(env: any): Promise<FinanceSnapshotDB | null> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM finance_snapshots WHERE is_latest = 1 LIMIT 1'
  ).all();
  return results[0] as FinanceSnapshotDB || null;
}
export async function insertFinanceSnapshot(env: any, snapshot: FinanceSnapshotDB): Promise<void> {
  // Unset previous latest
  await env.DB.prepare('UPDATE finance_snapshots SET is_latest = 0 WHERE is_latest = 1').run();
  // Insert new snapshot
  await env.DB.prepare(
    `INSERT INTO finance_snapshots (id, as_of, snapshot_json, is_latest)
     VALUES (?, ?, ?, ?)`
  ).bind(
    snapshot.id,
    snapshot.as_of,
    snapshot.snapshot_json,
    snapshot.is_latest
  ).run();
}

// Weekly Reports
import type { WeeklyReportDB, QuarterlyReportDB } from '../types/report_db';
export async function getWeeklyReport(env: any, week_start: string): Promise<WeeklyReportDB | null> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM reports_weekly WHERE week_start = ?'
  ).bind(week_start).all();
  return results[0] as WeeklyReportDB || null;
}
export async function insertWeeklyReport(env: any, report: WeeklyReportDB): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO reports_weekly (id, week_start, report_json, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(
    report.id,
    report.week_start,
    report.report_json,
    report.created_at
  ).run();
}

// Quarterly Reports
export async function getQuarterlyReport(env: any, quarter_id: string): Promise<QuarterlyReportDB | null> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM reports_quarterly WHERE quarter_id = ?'
  ).bind(quarter_id).all();
  return results[0] as QuarterlyReportDB || null;
}
export async function insertQuarterlyReport(env: any, report: QuarterlyReportDB): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO reports_quarterly (id, quarter_id, report_json, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(
    report.id,
    report.quarter_id,
    report.report_json,
    report.created_at
  ).run();
}

// Events
import type { EventDB } from '../types/event_db';
export async function insertEvent(env: any, event: EventDB): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, ts, actor, type, entity_type, entity_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    event.id,
    event.ts,
    event.actor,
    event.type,
    event.entity_type,
    event.entity_id ?? null,
    event.payload_json ?? null
  ).run();
}
export async function getEventsForEntity(env: any, entity_type: string, entity_id: string): Promise<EventDB[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM events WHERE entity_type = ? AND entity_id = ? ORDER BY ts DESC'
  ).bind(entity_type, entity_id).all();
  return results as EventDB[];
}
import type { ProjectDB, ProjectStatus } from '../types/project_db';

// Get all projects
export async function getProjects(env: any): Promise<ProjectDB[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM projects ORDER BY updated_at DESC'
  ).all();
  return results as ProjectDB[];
}

// Get a single project by id
export async function getProjectById(env: any, id: string): Promise<ProjectDB | null> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM projects WHERE id = ?'
  ).bind(id).all();
  return results[0] as ProjectDB || null;
}

// Insert a new project
export async function insertProject(env: any, project: ProjectDB): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO projects (id, name, status, created_at, updated_at, data_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    project.id,
    project.name,
    project.status,
    project.created_at,
    project.updated_at,
    project.data_json
  ).run();
}

// Update an existing project
export async function updateProject(env: any, project: ProjectDB): Promise<void> {
  await env.DB.prepare(
    `UPDATE projects SET name = ?, status = ?, updated_at = ?, data_json = ? WHERE id = ?`
  ).bind(
    project.name,
    project.status,
    project.updated_at,
    project.data_json,
    project.id
  ).run();
}

// Delete a project by id
export async function deleteProject(env: any, id: string): Promise<void> {
  await env.DB.prepare(
    'DELETE FROM projects WHERE id = ?'
  ).bind(id).run();
}
