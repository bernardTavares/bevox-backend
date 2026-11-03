/**
 * Drizzle schema barrel — entrypoint para drizzle-kit e tipagem do client.
 *
 * Re-exporta tabelas, enums e tipos do modelo canônico Marco-1 (PRD §11).
 * Tenant identity = `organization_id` / tabela `organizations` (ADR-021,
 * canon aceito). O lexicon de tenant legado é proibido neste schema — a
 * ponte de fronteira com o harness é tarefa posterior, fora de Marco-1.
 *
 * Ordem de export reflete dependências de FK (tenancy → identity →
 * catalog → executions → customers → audit → staff →
 * autonomy).
 */

export * from "./_shared.js";
export * from "./tenancy.js";
export * from "./identity.js";
export * from "./catalog.js";
export * from "./customers.js";
export * from "./channels.js";
export * from "./conversations.js";
export * from "./calendar.js";
export * from "./google.js";
export * from "./ingestion.js";
export * from "./buffer_windows.js";
export * from "./executions.js";
export * from "./execution_traces.js";
export * from "./audit.js";
export * from "./staff.js";
export * from "./staff_manual_actions.js";
export * from "./autonomy.js";
export * from "./agent_configs.js";
export * from "./channel-subscriptions.js";
export * from "./organization-meta-api-tenant.js";
