/**
 * Reads ops cross-org (B4 — Módulo 17). Tenant = organization_id
 * (bevox-backend/ADR-019 — supersedes hub ADR-025); dados ausentes lidos
 * honestamente (traces p/ reasoning; result_payload p/ intents;
 * agregado computado p/ organization-health; attempts:[]).
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client.js";

export async function dashboardOverview(orgId: string | undefined) {
  const db = getDb();
  const ow = orgId ? sql`WHERE organization_id = ${orgId}` : sql``;
  const [win, exe, dl] = await Promise.all([
    db.execute(sql`SELECT state, COUNT(*)::int AS count FROM buffer_windows ${ow} GROUP BY state`),
    db.execute(sql`SELECT status, COUNT(*)::int AS count FROM executions ${ow} GROUP BY status`),
    db.execute(
      sql`SELECT COUNT(*)::int AS count FROM executions ${orgId ? sql`WHERE organization_id = ${orgId} AND` : sql`WHERE`} status = 'dead_letter'`,
    ),
  ]);
  const windows = Object.fromEntries(
    (win.rows as Array<{ state: string | null; count: number }>).map((r) => [
      r.state ?? "unknown",
      r.count,
    ]),
  );
  const executions = Object.fromEntries(
    (exe.rows as Array<{ status: string | null; count: number }>).map((r) => [
      r.status ?? "unknown",
      r.count,
    ]),
  );
  const total = (exe.rows as Array<{ count: number }>).reduce((s, r) => s + r.count, 0);
  const errorCount = Number(executions["error"] ?? 0) + Number(executions["dead_letter"] ?? 0);
  return {
    windows,
    executions,
    dead_letters: Number((dl.rows[0] as { count: number } | undefined)?.count ?? 0),
    error_rate: total > 0 ? errorCount / total : 0,
  };
}

export async function listExecutions(
  orgId: string | undefined,
  f: { status?: string; conversation_key?: string; date_from?: string; date_to?: string },
  page: number,
  perPage: number,
) {
  const db = getDb();
  const offset = (page - 1) * perPage;
  const conds: SQL[] = [];
  if (orgId) conds.push(sql`e.organization_id = ${orgId}`);
  if (f.status) conds.push(sql`e.status = ${f.status}`);
  if (f.conversation_key) conds.push(sql`bw.conversation_key = ${f.conversation_key}`);
  if (f.date_from) conds.push(sql`COALESCE(e.dispatched_at, e.created_at) >= ${f.date_from}`);
  if (f.date_to) conds.push(sql`COALESCE(e.dispatched_at, e.created_at) <= ${f.date_to}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const totalR = await db.execute(
    sql`SELECT COUNT(*)::text AS total FROM executions e LEFT JOIN buffer_windows bw ON bw.id = e.buffer_window_id ${where}`,
  );
  const dataR = await db.execute(sql`
    SELECT e.*, bw.conversation_key
    FROM executions e LEFT JOIN buffer_windows bw ON bw.id = e.buffer_window_id
    ${where}
    ORDER BY COALESCE(e.dispatched_at, e.created_at) DESC NULLS LAST
    LIMIT ${perPage} OFFSET ${offset}`);
  return { data: dataR.rows, total: Number((totalR.rows[0] as { total: string }).total) };
}

export async function getExecution(orgId: string | undefined, id: string) {
  const db = getDb();
  const r = await db.execute(sql`
    SELECT e.*, bw.conversation_key
    FROM executions e LEFT JOIN buffer_windows bw ON bw.id = e.buffer_window_id
    WHERE e.id = ${id} ${orgId ? sql`AND e.organization_id = ${orgId}` : sql``} LIMIT 1`);
  const execution = r.rows[0] as Record<string, unknown> | undefined;
  if (!execution) return null;
  const ma = await db.execute(
    sql`SELECT * FROM staff_manual_actions WHERE execution_id = ${id} ORDER BY created_at ASC`,
  );
  return { ...execution, attempts: [], manual_actions: ma.rows };
}

export async function listWindows(
  orgId: string | undefined,
  f: { status?: string; conversation_key?: string; date_from?: string; date_to?: string },
  page: number,
  perPage: number,
) {
  const db = getDb();
  const offset = (page - 1) * perPage;
  const conds: SQL[] = [];
  if (orgId) conds.push(sql`bw.organization_id = ${orgId}`);
  if (f.status) conds.push(sql`bw.state = ${f.status}`);
  if (f.conversation_key) conds.push(sql`bw.conversation_key = ${f.conversation_key}`);
  if (f.date_from) conds.push(sql`bw.created_at >= ${f.date_from}`);
  if (f.date_to) conds.push(sql`bw.created_at <= ${f.date_to}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const totalR = await db.execute(
    sql`SELECT COUNT(*)::text AS total FROM buffer_windows bw ${where}`,
  );
  const dataR = await db.execute(sql`
    SELECT bw.*, e.status AS latest_execution_status
    FROM buffer_windows bw LEFT JOIN executions e ON e.id = bw.latest_execution_id
    ${where} ORDER BY bw.created_at DESC LIMIT ${perPage} OFFSET ${offset}`);
  return { data: dataR.rows, total: Number((totalR.rows[0] as { total: string }).total) };
}

export async function getWindow(orgId: string | undefined, id: string) {
  const db = getDb();
  const wr = await db.execute(
    sql`SELECT * FROM buffer_windows WHERE id = ${id} ${orgId ? sql`AND organization_id = ${orgId}` : sql``} LIMIT 1`,
  );
  const window = wr.rows[0] as Record<string, unknown> | undefined;
  if (!window) return null;
  const mr = await db.execute(
    sql`SELECT * FROM message_records WHERE conversation_key = ${window["conversation_key"] as string} ORDER BY message_created_at ASC`,
  );
  return { ...window, messages: mr.rows };
}

export async function listDeadLetters(
  orgId: string | undefined,
  f: { conversation_key?: string },
  page: number,
  perPage: number,
) {
  const db = getDb();
  const offset = (page - 1) * perPage;
  const conds: SQL[] = [sql`e.status = 'dead_letter'`];
  if (orgId) conds.push(sql`e.organization_id = ${orgId}`);
  if (f.conversation_key) conds.push(sql`bw.conversation_key = ${f.conversation_key}`);
  const where = sql`WHERE ${sql.join(conds, sql` AND `)}`;
  const totalR = await db.execute(
    sql`SELECT COUNT(*)::text AS total FROM executions e LEFT JOIN buffer_windows bw ON bw.id = e.buffer_window_id ${where}`,
  );
  const dataR = await db.execute(sql`
    SELECT e.*, bw.conversation_key FROM executions e LEFT JOIN buffer_windows bw ON bw.id = e.buffer_window_id
    ${where} ORDER BY e.completed_at DESC NULLS LAST LIMIT ${perPage} OFFSET ${offset}`);
  return { data: dataR.rows, total: Number((totalR.rows[0] as { total: string }).total) };
}

export async function listConversationExecutions(
  orgId: string | undefined,
  conversationId: string,
) {
  const r = await getDb().execute(sql`
    SELECT e.*, bw.conversation_key FROM executions e LEFT JOIN buffer_windows bw ON bw.id = e.buffer_window_id
    WHERE e.conversation_id = ${conversationId} ${orgId ? sql`AND e.organization_id = ${orgId}` : sql``}
    ORDER BY COALESCE(e.dispatched_at, e.created_at) DESC LIMIT 50`);
  return { data: r.rows };
}

export async function getTraces(orgId: string | undefined, executionId: string) {
  const r = await getDb().execute(sql`
    SELECT t.id, t.step_type, t.step_name, t.input_json, t.output_json, t.duration_ms, t.created_at
    FROM execution_traces t INNER JOIN executions e ON e.id = t.execution_id
    WHERE t.execution_id = ${executionId} ${orgId ? sql`AND e.organization_id = ${orgId}` : sql``}
    ORDER BY t.created_at ASC`);
  return { data: r.rows };
}

export async function getReasoning(orgId: string | undefined, executionId: string) {
  const own = await getDb().execute(
    sql`SELECT id FROM executions WHERE id = ${executionId} ${orgId ? sql`AND organization_id = ${orgId}` : sql``} LIMIT 1`,
  );
  if (!own.rows[0]) return null;
  const r = await getDb().execute(
    sql`SELECT id, step_type, step_name, input_json, output_json, created_at FROM execution_traces WHERE execution_id = ${executionId} ORDER BY created_at ASC`,
  );
  return { data: r.rows };
}

export async function getIntents(orgId: string | undefined, executionId: string) {
  const r = await getDb().execute(sql`
    SELECT e.result_payload, c.last_intent
    FROM executions e LEFT JOIN conversations c ON c.id = e.conversation_id
    WHERE e.id = ${executionId} ${orgId ? sql`AND e.organization_id = ${orgId}` : sql``} LIMIT 1`);
  const row = r.rows[0] as
    | { result_payload: Record<string, unknown> | null; last_intent: string | null }
    | undefined;
  if (!row) return null;
  const rp = row.result_payload ?? {};
  const intents = Array.isArray((rp as Record<string, unknown>)["intents"])
    ? (rp as Record<string, unknown>)["intents"]
    : [];
  return { data: intents, last_intent: row.last_intent ?? null };
}

export async function organizationHealth(orgId: string | undefined) {
  const where = orgId ? sql`WHERE organization_id = ${orgId}` : sql``;
  const r = await getDb().execute(sql`
    SELECT organization_id,
           COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
           COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter_count,
           COUNT(*) FILTER (WHERE status IN ('dispatching','processing'))::int AS in_flight_count,
           MAX(completed_at) AS last_completed_at
    FROM executions ${where} GROUP BY organization_id`);
  return { data: r.rows };
}

export async function listAuditEvents(
  q: {
    organization_id?: string;
    entity_type?: string;
    entity_id?: string;
    actor_id?: string;
    actor_type?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
  },
  page: number,
  perPage: number,
) {
  const db = getDb();
  const offset = (page - 1) * perPage;
  const conds: SQL[] = [];
  if (q.organization_id) conds.push(sql`organization_id = ${q.organization_id}`);
  if (q.entity_type) conds.push(sql`entity_type = ${q.entity_type}`);
  if (q.entity_id) conds.push(sql`entity_id = ${q.entity_id}`);
  if (q.actor_id) conds.push(sql`actor_id = ${q.actor_id}`);
  if (q.actor_type) conds.push(sql`actor_type = ${q.actor_type}`);
  if (q.action) conds.push(sql`action = ${q.action}`);
  if (q.date_from) conds.push(sql`created_at >= ${q.date_from}`);
  if (q.date_to) conds.push(sql`created_at <= ${q.date_to}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const totalR = await db.execute(sql`SELECT COUNT(*)::text AS total FROM audit_events ${where}`);
  const dataR = await db.execute(
    sql`SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`,
  );
  return { data: dataR.rows, total: Number((totalR.rows[0] as { total: string }).total) };
}
