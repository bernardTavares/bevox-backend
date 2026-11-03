/**
 * Actions ops (B4 — Módulo 17). UPDATE guardado idempotente (precedente
 * E+B3: RETURNING → 409 se perdeu) + ledger staff_manual_actions + audit
 * (padrão E+B3 insertApprovalAudit: actor_id NULL literal, staff id em
 * after_json) + publishRealtime. redispatchExecution reusa o seam B2
 * dispatchExecution + os builders de cutoff (orchestration/repository).
 * Reconciliação: guard/lease/version em conversation_pipeline_state.
 *
 * Nota id: staff_manual_actions.id é uuid PRIMARY KEY NOT NULL SEM default
 * de DB (migration 0006_majestic_the_phantom.sql) — raw `sql` execute NÃO
 * dispara o $defaultFn do Drizzle (precedente E+B3 insertExecutionTraces).
 * Logo geramos o id app-side com uuidv7(). audit_events.id mantém default
 * de DB (precedente insertApprovalAudit omite id).
 */
import { sql } from "drizzle-orm";

import { env } from "@/config/env.js";
import { getDb } from "@/db/client.js";
import { dispatchExecution } from "@/integration/harness-dispatcher.js";
import { resolveExecutionMode } from "@/modules/autonomy/resolver.js";
import {
  buildDispatchMessages,
  getOrCreateAgentConfig,
  getOrgContext,
} from "@/modules/orchestration/repository.js";
import { publishRealtime } from "@/modules/realtime/publish.js";
import { uuidv7 } from "@/shared/uuid.js";

export interface OpsExecutionRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  buffer_window_id: string | null;
  status: string;
  channel_connection_id: string | null;
  conversation_key: string | null;
  // Replay lineage root (dispatch-contract amendment, aceito 2026-06-03);
  // NULL for an execution that is itself a root.
  original_execution_id: string | null;
}

export async function findExecutionForAction(id: string): Promise<OpsExecutionRow | null> {
  const r = await getDb().execute(sql`
    SELECT e.id, e.organization_id, e.conversation_id, e.buffer_window_id, e.status,
           e.original_execution_id,
           c.channel_connection_id, ps.conversation_key
    FROM executions e
    LEFT JOIN conversations c ON c.id = e.conversation_id
    LEFT JOIN conversation_pipeline_state ps ON ps.conversation_id = e.conversation_id
    WHERE e.id = ${id} LIMIT 1`);
  return (r.rows[0] as OpsExecutionRow | undefined) ?? null;
}

export async function guardedSetStatus(
  id: string,
  fromStatuses: string[],
  toStatus: string,
): Promise<boolean> {
  const r = await getDb().execute(sql`
    UPDATE executions SET status = ${toStatus}, updated_at = now()
    WHERE id = ${id} AND status IN (${sql.join(
      fromStatuses.map((s) => sql`${s}`),
      sql`, `,
    )})
    RETURNING id`);
  return r.rows.length > 0;
}

export async function setConversationWaitingHuman(conversationId: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE conversations
       SET status = 'waiting_human', current_owner_type = 'user',
           current_owner_id = NULL, updated_at = now()
     WHERE id = ${conversationId}`);
}

export async function clearPipelineLease(conversationId: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE conversation_pipeline_state
       SET lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE conversation_id = ${conversationId}`);
}

/**
 * Repoint do guard p/ a NOVA execução + bump atômico de version
 * (UPDATE conversations SET active_execution_id/version). Bump single-statement (CAST(version AS bigint)+1)::text —
 * mesma forma atômica de handoffConversationOnTimeout; sem read-then-write
 * (elimina a corrida não-CAS). Se a linha pipeline não existir (não
 * deveria p/ um redispatch), o UPDATE é no-op.
 */
export async function repointPipeline(
  conversationId: string,
  newExecutionId: string,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE conversation_pipeline_state
       SET active_execution_id = ${newExecutionId},
           version = (CAST(version AS bigint) + 1)::text,
           updated_at = now()
     WHERE conversation_id = ${conversationId}`);
}

/**
 * Replay/dead-letter-replay/override-ai: NOVA tentativa via seam B2
 * (dispatchExecution) + repoint do guard. Reusa os builders de cutoff;
 * NÃO reconstrói dispatch. A execução antiga permanece como histórico
 * (status terminal error/dead_letter/cancelled — fora do select-set de
 * todo worker status-scanner e excluída por findExecutionIdByTokenHash;
 * nenhum worker re-atua nela).
 *
 * Janela de falha parcial NÃO-transacional (sem tx helper no codebase —
 * mesmo padrão de handoffConversationOnTimeout): dispatchExecution
 * (nova execução + job harness enfileirado) e repointPipeline são 2
 * statements separados. Se repointPipeline falhar após o dispatch, a
 * nova execução está viva/enfileirada mas o guard ainda aponta p/ a
 * antiga — limitado: a nova execução segue o ciclo normal de
 * timeout/dead-letter pelo scan, e o alvo antigo do guard é terminal.
 * Follow-on: envolver em transação quando existir tx helper compartilhado
 * (paridade com a nota de handoffConversationOnTimeout). Retorna o novo
 * execution_id.
 */
export async function redispatchExecution(row: OpsExecutionRow): Promise<string> {
  const executionMode = await resolveExecutionMode({
    organizationId: row.organization_id,
    channelConnectionId: row.channel_connection_id,
  });
  const agent = await getOrCreateAgentConfig(row.organization_id);
  const messages = await buildDispatchMessages(row.conversation_key ?? "");
  const orgCtx = await getOrgContext(row.organization_id);
  const result = await dispatchExecution({
    organizationId: row.organization_id,
    executionMode,
    conversation: {
      id: row.conversation_id,
      channel_account_id: row.channel_connection_id ?? row.conversation_id,
    },
    messages,
    context: { timezone: orgCtx.timezone, locale: orgCtx.locale },
    agentConfig: {
      default_model: agent.default_model ?? env().DEFAULT_LLM_MODEL,
      system_prompt: agent.system_prompt,
    },
    skills: [],
    // Dispatch-contract amendment (PRD §10.4 / ADR-019 Amendment 1, aceito
    // 2026-06-03): carry the lineage ROOT so the harness idempotency-key dedups
    // external mutations against the original execution. Chain `?? row.id` so a
    // replay-of-a-replay still points at the root, not the immediate parent.
    originalExecutionId: row.original_execution_id ?? row.id,
  });
  await repointPipeline(row.conversation_id, result.execution_id);
  return result.execution_id;
}

export async function writeManualActionAndAudit(input: {
  organizationId: string;
  executionId: string;
  bufferWindowId: string | null;
  actionType: string;
  reason: string;
  actorStaffId: string;
  requestPayload: Record<string, unknown>;
  resultSnapshot: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    INSERT INTO staff_manual_actions
      (id, organization_id, execution_id, buffer_window_id, action_type, reason,
       actor_staff_id, request_payload_json, result_snapshot_json)
    VALUES (${uuidv7()}, ${input.organizationId}, ${input.executionId}, ${input.bufferWindowId},
            ${input.actionType}, ${input.reason}, ${input.actorStaffId},
            ${JSON.stringify(input.requestPayload)}::jsonb,
            ${JSON.stringify(input.resultSnapshot)}::jsonb)`);
  await db.execute(sql`
    INSERT INTO audit_events
      (organization_id, entity_type, entity_id, action, actor_type,
       actor_id, reason_text, execution_id, after_json)
    VALUES (${input.organizationId}, 'execution', ${input.executionId},
            ${`staff.${input.actionType}`}, 'user', NULL, ${input.reason},
            ${input.executionId},
            ${JSON.stringify({
              actor_staff_id: input.actorStaffId,
              request: input.requestPayload,
            })}::jsonb)`);
  await publishRealtime(input.organizationId, "execution.updated", {
    execution_id: input.executionId,
    action: input.actionType,
  });
}
