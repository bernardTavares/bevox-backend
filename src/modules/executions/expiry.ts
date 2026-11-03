/**
 * Expiry scan (repeat job). waiting_approval > AI_SUGGESTION_TTL_HOURS →
 * expired + AuditEvent por linha (actor 'system'). ADR-019: sobre a
 * execução, sem entidade AISuggestion.
 *
 * expireStaleApprovals é um único bulk UPDATE atômico
 * (waiting_approval→expired, RETURNING), seguido de insertApprovalAudit
 * sequencial não-transacional por linha — o MESMO padrão aceito
 * claim-then-per-row de handleTimeoutScan. Janela de falha parcial: se um
 * insert de audit falha no meio do loop, essas linhas já estão expired
 * (UPDATE comitado) e a re-execução de 10 min NÃO as re-audita (não mais
 * waiting_approval) → algumas execuções expiradas podem ficar sem sua
 * linha de audit execution.expired. Aceitável para V1: o audit de
 * auto-expiry é evento de baixo risco com actor system; consistente com o
 * precedente documentado do timeout handler (parity com a nota de
 * handoffConversationOnTimeout / escalateConversationRequestHuman).
 */
import { env } from "@/config/env.js";
import { expireStaleApprovals, insertApprovalAudit } from "./repository.js";

export async function handleExpiryScan(): Promise<void> {
  const ttl = env().AI_SUGGESTION_TTL_HOURS;
  const expired = await expireStaleApprovals(ttl);
  for (const e of expired) {
    await insertApprovalAudit({
      organizationId: e.organization_id,
      executionId: e.id,
      action: "execution.expired",
      actorType: "system",
      afterJson: { final_status: "expired", ttl_hours: ttl },
    });
  }
}
