/**
 * Schema de agent-config — canon PRD bevox-backend §5.5 Módulo 8 é o
 * dono (NÃO há entidade de AgentConfig no Modelo de Dados — omissão
 * deliberada; `agent_configs` 1:1 com a organização).
 * Tenant = organization_id (ADR-021). `system_prompt` NOT NULL — o
 * harness consome verbatim (PRD harness §5.11); vazio = raciocínio
 * quebrado, por isso get-or-create usa um default canônico seguro.
 * `default_model` nullable → resolução: valor > env DEFAULT_LLM_MODEL.
 * skills NÃO vivem aqui (harness owns o SkillRegistry, ADR-018 §5.6).
 */

import { pgTable, text, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./tenancy.js";
import { createdAt, updatedAt } from "./_shared.js";

export const agentConfigs = pgTable("agent_configs", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  systemPrompt: text("system_prompt").notNull(),
  defaultModel: text("default_model"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;
