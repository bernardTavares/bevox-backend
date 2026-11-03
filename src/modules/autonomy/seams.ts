/**
 * Autonomy policy seam — foundation only (POC).
 *
 * FINDING: `autonomy-action-granularity-not-enforced` (HIGH). Hoje os três
 * JSONB columns `allowed_actions_json`, `required_approvals_json`,
 * `confidence_thresholds_json` em `autonomy_profiles` são gravados pelo
 * PATCH (ver `repository.ts` + `schemas.ts:10-12`) mas LIDOS por ZERO
 * lógica de decisão — `resolver.ts:20-38` só consulta `current_mode`.
 * Resultado: autonomia é binária por modo, não granular por ação ou
 * confiança. Mitigante atual: em prod o harness opera em
 * `manual_assisted` (inerte), então não há regressão observável; o gap é
 * estrutural (faltam seams), não runtime.
 *
 * ESTE PR (POC): apenas o seam de LEITURA — `fetchOrgAutonomyPolicies`
 * busca os 3 JSONBs do profile e os entrega tipados como
 * `AutonomyPolicies`. Mais a interface `PolicyEvaluator` documentando o
 * shape futuro de decisão por-ação/por-confiança. NENHUMA decisão é
 * tomada aqui e NENHUM caller existente é alterado. Test: validar que
 * dados persistidos batem com o parse — i.e., a fundação está plumb.
 *
 * FOLLOW-ON (Marco 2/3, FORA deste PR):
 *   1. Implementar `PolicyEvaluator.shouldAutoApprove(action, confidence)`
 *      lendo `allowed_actions_json` + `confidence_thresholds_json`.
 *   2. Integrar evaluator no resolver de proposals (ver TODO em
 *      `resolver.ts` para o ponto exato).
 *   3. Expor métricas por ação aprovada / required_approvals_violated.
 *   4. Decidir granularidade canônica: org-level (hoje), service-level
 *      (mencionado no finding) ou ambos. Hoje o schema é só org-level.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";

import type { AiMode } from "./resolver.js";

/**
 * Shape dos três JSONBs após o parse. Cada campo é deliberadamente
 * `Record<string, unknown>` (não tipado fundo) porque o canon ainda não
 * fixou as chaves — ver finding follow-on §4. Documentação por convenção:
 *
 *   allowed_actions[action_name] = boolean | { mode_floor?: AiMode }
 *   required_approvals[action_name] = "staff" | "professional" | "none"
 *   confidence_thresholds[action_name] = number ([0,1])
 *
 * O parse aqui apenas valida que cada JSONB ou é `null` (profile recém-
 * criado) ou é objeto plain — qualquer outro shape é rejeitado em
 * `parsePolicyJson` para não mascarar payloads corrompidos.
 */
export interface AutonomyPolicies {
  organizationId: string;
  currentMode: AiMode;
  allowedActions: Record<string, unknown>;
  requiredApprovals: Record<string, unknown>;
  confidenceThresholds: Record<string, unknown>;
}

/**
 * Foundation interface — Marco 2/3 implementa. A POC NÃO instancia este
 * tipo nem ramifica nenhum caller por ele. Documentado aqui para
 * congelar o contrato de chamada futura e dar âncora aos TODOs do
 * resolver.
 */
export interface PolicyEvaluator {
  /**
   * Decide se a ação pode ser auto-executada (sem aprovação humana) dado
   * o `current_mode` da org, o opcional canal-override (ver `resolver.ts`)
   * e a `confidence` reportada pelo harness na proposal. Retorna o motivo
   * para audit.
   *
   * Implementação futura: lê `allowedActions[action]` + cruza com
   * `confidenceThresholds[action]` + `currentMode`. Default fail-closed:
   * action ausente → require approval.
   */
  shouldAutoApprove(input: { action: string; confidence: number }): {
    autoApprove: boolean;
    reason: string;
  };

  /**
   * Retorna quem precisa aprovar a ação (`"staff" | "professional" |
   * "none"`) baseado em `requiredApprovals[action]`. Default fail-closed:
   * action ausente → `"staff"`.
   */
  requiredApproverFor(action: string): "staff" | "professional" | "none";
}

function parsePolicyJson(value: unknown, column: string): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  // Defensive: rejeitar shapes corrompidos (array, primitivo). O PATCH
  // schema (schemas.ts) já restringe a `z.record(...)` na entrada, mas o
  // DB poderia ter dados legados; falhar alto é preferível a auto-aprovar
  // ações por payload mal-formado quando o evaluator entrar em uso.
  throw new Error(
    `autonomy_profiles.${column} has invalid shape (expected object or null, got ${Array.isArray(value) ? "array" : typeof value})`,
  );
}

/**
 * Lê o `autonomy_profiles` da org e devolve os três JSONBs parsed +
 * `current_mode`. NÃO cria o profile (use `getOrCreateProfile` do
 * repository quando o caller for um PATCH/write); retorna null aqui se
 * a org ainda não tem profile — read-only path de leitura por evaluator.
 *
 * Nome `fetchOrgAutonomyPolicies` (não `fetchServiceAutonomyPolicies` do
 * finding) reflete o schema canônico atual: o profile é 1:1 por org
 * (`autonomy_profiles_organization_id_uniq` em
 * `db/migrations/0003_majestic_dazzler.sql`). Se/quando o canon
 * introduzir override por-service, este seam ganha overload —
 * documentado no follow-on §4 acima.
 */
export async function fetchOrgAutonomyPolicies(
  organizationId: string,
): Promise<AutonomyPolicies | null> {
  const res = await getDb().execute(
    sql`SELECT organization_id, current_mode, allowed_actions_json,
               required_approvals_json, confidence_thresholds_json
        FROM autonomy_profiles
        WHERE organization_id = ${organizationId}
        LIMIT 1`,
  );
  const row = res.rows[0] as
    | {
        organization_id: string;
        current_mode: AiMode;
        allowed_actions_json: unknown;
        required_approvals_json: unknown;
        confidence_thresholds_json: unknown;
      }
    | undefined;
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    currentMode: row.current_mode,
    allowedActions: parsePolicyJson(row.allowed_actions_json, "allowed_actions_json"),
    requiredApprovals: parsePolicyJson(row.required_approvals_json, "required_approvals_json"),
    confidenceThresholds: parsePolicyJson(
      row.confidence_thresholds_json,
      "confidence_thresholds_json",
    ),
  };
}
