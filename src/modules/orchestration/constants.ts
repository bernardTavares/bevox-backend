/**
 * Orchestration constants. DEFAULT_SYSTEM_PROMPT is the safe canonical
 * fallback persona used when an org has no agent_configs row yet — the
 * harness consumes system_prompt verbatim (PRD harness §5.11), so it
 * must never be empty. Per-org customization replaces it via the
 * agent_configs row (canon §5.5 Módulo 8).
 */

export const DEFAULT_SYSTEM_PROMPT =
  "Você é o assistente virtual de atendimento desta empresa. " +
  "Responda de forma cordial, objetiva e em português do Brasil. " +
  "Use apenas informações confirmadas; quando não souber, ofereça " +
  "encaminhar a um atendente humano. Nunca invente dados de agenda, " +
  "preços ou políticas.";

export const CUTOFF_JOB_NAME = "buffer.cutoff";
export const TIMEOUT_SCAN_JOB_NAME = "timeout.scan";
export const TIMEOUT_SCAN_REPEAT_CRON = "*/2 * * * *";
/** Lease TTL for the cutoff claim (ms). */
export const CUTOFF_CLAIM_LEASE_MS = 60_000;
export const EXPIRY_SCAN_JOB_NAME = "approval.expiry.scan";
/** A cada 10 min — TTL é horas (env), varredura barata. */
export const EXPIRY_SCAN_REPEAT_CRON = "*/10 * * * *";
