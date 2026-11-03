/**
 * Repository — autonomy module. getDb() parameterized SQL (repo
 * convention; no static @db import). 1:1 profile por org; mudança de
 * current_mode grava audit_events (PRD §5.5: "Transição de modo gera
 * AuditEvent com motivo"). Infra audit_events de A.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { uuidv7 } from "@/shared/uuid.js";

export interface AutonomyProfileRow {
  id: string;
  organization_id: string;
  current_mode: string;
  allowed_actions_json: unknown;
  required_approvals_json: unknown;
  confidence_thresholds_json: unknown;
  readiness_score: string | null;
}

export async function findProfile(orgId: string): Promise<AutonomyProfileRow | null> {
  const res = await getDb().execute(
    sql`SELECT id, organization_id, current_mode, allowed_actions_json,
               required_approvals_json, confidence_thresholds_json, readiness_score
        FROM autonomy_profiles WHERE organization_id = ${orgId} LIMIT 1`,
  );
  return (res.rows[0] as AutonomyProfileRow | undefined) ?? null;
}

/** Lazily create the 1:1 profile at default mode if absent; returns it. */
export async function getOrCreateProfile(orgId: string): Promise<AutonomyProfileRow> {
  const existing = await findProfile(orgId);
  if (existing) return existing;
  const id = uuidv7();
  await getDb().execute(
    sql`INSERT INTO autonomy_profiles (id, organization_id, current_mode)
        VALUES (${id}, ${orgId}, 'manual_assisted')
        ON CONFLICT (organization_id) DO NOTHING`,
  );
  const row = await findProfile(orgId);
  if (!row) throw new Error("autonomy profile creation failed");
  return row;
}

export interface ProfilePatch {
  current_mode?: string;
  allowed_actions_json?: unknown;
  required_approvals_json?: unknown;
  confidence_thresholds_json?: unknown;
}

/**
 * Applies the patch; if current_mode changes, writes an audit_events row
 * (action 'autonomy.mode_changed', actorType 'user', reason_text from the
 * request, before/after = {mode}). actor_id stays NULL — Clerk user id is
 * not a UUID (audit_events.actor_id is uuid); the clerk_user_id is kept
 * in after_json.actor_clerk_user_id for traceability.
 *
 * The three jsonb columns: an unspecified field is left at its CURRENT
 * value (read from `current`, already selected by findProfile) — bounded
 * write, fully parameterized, no bare-column SET fragment needed.
 *
 * Non-atomic window: the profile UPDATE and the audit_events INSERT run in
 * SEPARATE getDb().execute calls with NO transaction (no tx helper exists
 * in the codebase — same pattern as C's resolveOrCreateCustomerChannel).
 * If the UPDATE commits and the audit INSERT fails, the mode changes WITHOUT
 * the corresponding audit_events row — violates PRD §5.5 ("mode transition
 * generates an AuditEvent with reason"); autonomy mode is a sensitive
 * control. Also: 2 concurrent PATCHes can lost-update the jsonb columns,
 * and the audit before/after is computed from a stale read (no row lock /
 * optimistic version). Follow-on: B2 (or once a tx helper exists) MUST
 * wrap UPDATE+audit in a transaction. C provides / non-blocking in D.
 */
export async function applyProfilePatch(input: {
  orgId: string;
  patch: ProfilePatch;
  reasonText: string | null;
  actorClerkUserId: string | null;
}): Promise<AutonomyProfileRow> {
  const db = getDb();
  const current = await getOrCreateProfile(input.orgId);
  const modeChanging =
    input.patch.current_mode !== undefined && input.patch.current_mode !== current.current_mode;

  await db.execute(
    sql`UPDATE autonomy_profiles SET
          current_mode = ${input.patch.current_mode ?? current.current_mode},
          allowed_actions_json = ${
            input.patch.allowed_actions_json === undefined
              ? sql`allowed_actions_json`
              : sql`${JSON.stringify(input.patch.allowed_actions_json)}::jsonb`
          },
          required_approvals_json = ${
            input.patch.required_approvals_json === undefined
              ? sql`required_approvals_json`
              : sql`${JSON.stringify(input.patch.required_approvals_json)}::jsonb`
          },
          confidence_thresholds_json = ${
            input.patch.confidence_thresholds_json === undefined
              ? sql`confidence_thresholds_json`
              : sql`${JSON.stringify(input.patch.confidence_thresholds_json)}::jsonb`
          },
          updated_at = now()
        WHERE organization_id = ${input.orgId}`,
  );

  if (modeChanging) {
    const auditId = uuidv7();
    await db.execute(
      sql`INSERT INTO audit_events
            (id, organization_id, entity_type, entity_id, action,
             actor_type, actor_id, reason_text, before_json, after_json)
          VALUES (${auditId}, ${input.orgId}, 'autonomy_profile',
                  ${current.id}, 'autonomy.mode_changed', 'user', NULL,
                  ${input.reasonText},
                  ${JSON.stringify({ current_mode: current.current_mode })}::jsonb,
                  ${JSON.stringify({
                    current_mode: input.patch.current_mode,
                    actor_clerk_user_id: input.actorClerkUserId,
                  })}::jsonb)`,
    );
  }

  const updated = await findProfile(input.orgId);
  if (!updated) throw new Error("autonomy profile vanished after update");
  return updated;
}
