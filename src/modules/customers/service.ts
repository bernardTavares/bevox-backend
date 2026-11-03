/**
 * Service layer — customers module (PRD §10.1).
 */

import { errors } from "@/shared/errors.js";

import {
  createCustomer,
  createFact,
  getCustomer,
  listCustomers,
  listFacts,
  updateCustomer,
  type CustomerRow,
  type FactRow,
} from "./repository.js";
import type { CustomerCreate, CustomerPatch, FactCreate } from "./schemas.js";

export async function list(orgId: string) {
  return { items: await listCustomers(orgId) };
}

export async function getOne(orgId: string, id: string): Promise<CustomerRow> {
  const row = await getCustomer(orgId, id);
  if (!row) throw errors.notFound("Customer", id);
  return row;
}

export async function create(orgId: string, input: CustomerCreate): Promise<CustomerRow> {
  return createCustomer(orgId, input);
}

export async function patch(orgId: string, id: string, body: CustomerPatch): Promise<CustomerRow> {
  const existing = await getCustomer(orgId, id);
  if (!existing) throw errors.notFound("Customer", id);
  const updated = await updateCustomer(orgId, id, body);
  if (!updated) throw errors.notFound("Customer", id);
  return updated;
}

/** GET /api/v1/customers/:id/profile — customer + active facts. */
export async function profile(
  orgId: string,
  id: string,
): Promise<{ customer: CustomerRow; facts: FactRow[] }> {
  const customer = await getCustomer(orgId, id);
  if (!customer) throw errors.notFound("Customer", id);
  const facts = await listFacts(orgId, id);
  return { customer, facts };
}

export async function facts(orgId: string, id: string) {
  const customer = await getCustomer(orgId, id);
  if (!customer) throw errors.notFound("Customer", id);
  return { items: await listFacts(orgId, id) };
}

export async function addFact(orgId: string, id: string, input: FactCreate): Promise<FactRow> {
  const customer = await getCustomer(orgId, id);
  if (!customer) throw errors.notFound("Customer", id);
  return createFact(orgId, id, input);
}

/**
 * DSR export payload (PRD §12.9 — LGPD direito de portabilidade).
 *
 * Shape canônico do export por titular: dereferencia o `customer` + facts
 * ativos + conversas/mensagens + audit trail. Inclui metadados de geração
 * (timestamp + organização + esquema da versão) para que o titular consiga
 * validar integridade futuramente.
 *
 * POC (Marco-1, gap `no-dsr-export-endpoint`): `customer` + `facts` reais
 * (já queryáveis), `messages` e `audit_events` retornados como arrays
 * vazios com TODO. O fluxo de assinatura + content-disposition + formato
 * CSV é follow-up de Marco-3.
 */
export interface CustomerExport {
  schema_version: "1.0.0-poc";
  generated_at: string;
  organization_id: string;
  customer: CustomerRow;
  facts: FactRow[];
  /** TODO Marco-3: hidratar messages do schema do harness (conversation_messages). */
  messages: never[];
  /** TODO Marco-3: hidratar audit trail (audit_events) escoped por customer_id. */
  audit_events: never[];
}

/**
 * GET /api/v1/customers/:id/export — DSR export (LGPD §12.9).
 *
 * POC stub: retorna o customer real + facts reais + arrays vazios para
 * messages/audit_events (a serem hidratados em Marco-3 quando o schema de
 * mensagens estiver materializado no backend). NÃO assina o payload e NÃO
 * emite Content-Disposition — esses são follow-ups.
 */
export async function exportData(orgId: string, id: string): Promise<CustomerExport> {
  const customer = await getCustomer(orgId, id);
  if (!customer) throw errors.notFound("Customer", id);
  const factRows = await listFacts(orgId, id);
  return {
    schema_version: "1.0.0-poc",
    generated_at: new Date().toISOString(),
    organization_id: orgId,
    customer,
    facts: factRows,
    messages: [],
    audit_events: [],
  };
}
