/**
 * execution_mode resolver — Modelo §10.5 / PRD §5.5 / ADR-018.
 * Precedência: override do canal (channel_connections.routing_config_json
 * .ai_mode_override — seam entregue por C) > autonomy_profiles
 * .current_mode da org > default `manual_assisted` (autonomia
 * progressiva ADR-018 começa manual). D PROVÊ; B2 orquestra o dispatch
 * (carimba execution_mode na Execution, publica o job) — não aqui.
 *
 * GAP CONHECIDO — `autonomy-action-granularity-not-enforced` (HIGH):
 * este resolver retorna SÓ o `AiMode` agregado da org/canal. Os três
 * JSONBs granulares (`allowed_actions_json`, `required_approvals_json`,
 * `confidence_thresholds_json`) gravados em `schemas.ts:10-12` /
 * `repository.ts` NÃO entram em nenhuma decisão hoje. Foundation seam
 * para corrigir: `fetchOrgAutonomyPolicies` em `./seams.ts` lê os 3
 * JSONBs parsed; `PolicyEvaluator` (interface no mesmo arquivo, sem
 * impl) é o ponto onde Marco 2/3 conectará a decisão por-ação. Ver os
 * dois TODOs abaixo para os pontos exatos de integração.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { findChannelConnectionById } from "@/modules/channels/repository.js";
import { parseRoutingConfig } from "@/modules/channels/routing-config.schema.js";

export type AiMode = "manual_assisted" | "copilot" | "autonomous_supervised";

const DEFAULT_MODE: AiMode = "manual_assisted";

export async function resolveExecutionMode(input: {
  organizationId: string;
  channelConnectionId?: string | null;
}): Promise<AiMode> {
  if (input.channelConnectionId) {
    const conn = await findChannelConnectionById(input.channelConnectionId);
    if (conn) {
      const cfg = parseRoutingConfig(conn.routing_config_json);
      if (cfg.ai_mode_override) return cfg.ai_mode_override;
    }
  }
  const res = await getDb().execute(
    sql`SELECT current_mode FROM autonomy_profiles
        WHERE organization_id = ${input.organizationId}
        LIMIT 1`,
  );
  const row = res.rows[0] as { current_mode: AiMode } | undefined;
  // TODO(autonomy-action-granularity): Marco 2/3 — quando o resolver de
  // proposals (ver `src/modules/executions/seams.ts:executeProposals`)
  // ganhar branch por-ação, a decisão "auto-approve vs require approval"
  // deve usar `PolicyEvaluator` (interface em `./seams.ts`). Pseudo-código
  // do call site futuro:
  //
  //   const policies = await fetchOrgAutonomyPolicies(organizationId);
  //   if (!policies) return DEFAULT_MODE;       // fail-closed
  //   const evaluator = makeEvaluator(policies); // Marco 2/3
  //   const { autoApprove } = evaluator.shouldAutoApprove({ action, confidence });
  //
  // Hoje (POC) `fetchOrgAutonomyPolicies` existe e é coberto por test;
  // `makeEvaluator` ainda não — interface only. NÃO alterar a assinatura
  // de `resolveExecutionMode` ao integrar: a granularidade por-ação é um
  // gate ADICIONAL ao mode, não substituto.
  return row?.current_mode ?? DEFAULT_MODE;
}
