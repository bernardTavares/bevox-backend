/**
 * Repository de aprovação (bevox-backend/ADR-019 — sobre a execução; supersedes hub ADR-025). SQL parametrizado
 * via getDb() (sem import estático @/db). Transições guarded: só disparam
 * de waiting_approval (reaplicar = no-op idempotente; precedente B2).
 *
 * actor_id (uuid FK em audit_events) é sempre o literal SQL NULL — espelha
 * o precedente provado insertExecutionAudit (harness-callbacks.repository.ts):
 * o id Clerk (string) não cabe na FK uuid e vai em after_json.actor_clerk_id.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client.js";

export interface PendingExecutionRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  status: string;
  result_payload: Record<string, unknown> | null;
}

export async function listPendingApprovals(
  orgId: string,
  status: string | undefined,
  suggestionType: string | undefined,
): Promise<PendingExecutionRow[]> {
  const st = status ?? "waiting_approval";
  // LIMIT 200: seguro contra fila descontrolada; paginação real = follow-on.
  const res = suggestionType
    ? await getDb().execute(
        sql`SELECT id, organization_id, conversation_id, status, result_payload
              FROM executions
             WHERE organization_id = ${orgId} AND status = ${st}
               AND result_payload->>'suggestion_type' = ${suggestionType}
             ORDER BY created_at DESC
             LIMIT 200`,
      )
    : await getDb().execute(
        sql`SELECT id, organization_id, conversation_id, status, result_payload
              FROM executions
             WHERE organization_id = ${orgId} AND status = ${st}
             ORDER BY created_at DESC
             LIMIT 200`,
      );
  return res.rows as unknown as PendingExecutionRow[];
}

export async function findApprovable(
  orgId: string,
  id: string,
): Promise<PendingExecutionRow | null> {
  const res = await getDb().execute(
    sql`SELECT id, organization_id, conversation_id, status, result_payload
          FROM executions
         WHERE organization_id = ${orgId} AND id = ${id} LIMIT 1`,
  );
  return (res.rows[0] as PendingExecutionRow | undefined) ?? null;
}

export async function transitionApproved(
  orgId: string,
  id: string,
  resultPayload: Record<string, unknown>,
): Promise<boolean> {
  const res = await getDb().execute(
    sql`UPDATE executions
          SET status = 'done',
              result_payload = ${JSON.stringify(resultPayload)}::jsonb,
              completed_at = now(), updated_at = now()
        WHERE organization_id = ${orgId} AND id = ${id}
          AND status = 'waiting_approval'
        RETURNING id`,
  );
  return res.rows.length > 0;
}

export async function transitionRejected(orgId: string, id: string): Promise<boolean> {
  const res = await getDb().execute(
    sql`UPDATE executions
          SET status = 'rejected', updated_at = now()
        WHERE organization_id = ${orgId} AND id = ${id}
          AND status = 'waiting_approval'
        RETURNING id`,
  );
  return res.rows.length > 0;
}

/**
 * PRD §8.1: approve/edit pode aprovar a sugestão (executeProposals OK) e
 * mesmo assim falhar a ENTREGA outbound (META rejeitou / retries exauridos).
 * Nesse caso a execução transiciona p/ 'error' — NÃO 'done', NÃO 'rejected'
 * — preservando result_payload (delivery.error_code + attempt_count p/
 * forensic/retry follow-on). Guard idêntico ao transitionApproved:
 * só dispara de waiting_approval.
 */
export async function transitionError(
  orgId: string,
  id: string,
  resultPayload: Record<string, unknown>,
): Promise<boolean> {
  const res = await getDb().execute(
    sql`UPDATE executions
          SET status = 'error',
              result_payload = ${JSON.stringify(resultPayload)}::jsonb,
              completed_at = now(), updated_at = now()
        WHERE organization_id = ${orgId} AND id = ${id}
          AND status = 'waiting_approval'
        RETURNING id`,
  );
  return res.rows.length > 0;
}

export async function expireStaleApprovals(
  ttlHours: number,
): Promise<Array<{ id: string; organization_id: string; conversation_id: string }>> {
  const res = await getDb().execute(
    sql`UPDATE executions
          SET status = 'expired', updated_at = now()
        WHERE status = 'waiting_approval'
          AND completed_at < now() - (${ttlHours} || ' hours')::interval
        RETURNING id, organization_id, conversation_id`,
  );
  return res.rows as unknown as Array<{
    id: string;
    organization_id: string;
    conversation_id: string;
  }>;
}

export async function insertApprovalAudit(input: {
  organizationId: string;
  executionId: string;
  action: string;
  actorType: "user" | "system";
  reasonText?: string | null;
  afterJson: Record<string, unknown>;
}): Promise<void> {
  await getDb().execute(
    sql`INSERT INTO audit_events
          (organization_id, entity_type, entity_id, action,
           actor_type, actor_id, reason_text, execution_id, after_json)
        VALUES (${input.organizationId}, 'execution', ${input.executionId},
                ${input.action}, ${input.actorType}, NULL,
                ${input.reasonText ?? null}, ${input.executionId},
                ${JSON.stringify(input.afterJson)}::jsonb)`,
  );
}
