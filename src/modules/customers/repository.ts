/**
 * Repository — customers module. ALWAYS organization_id-scoped,
 * parameterized SQL via getDb() (no static @db import — flat-dist gate).
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { uuidv7 } from "@/shared/uuid.js";

import type { CustomerCreate, CustomerPatch, FactCreate } from "./schemas.js";

export interface CustomerRow {
  id: string;
  organization_id: string;
  full_name: string;
  preferred_name: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  notes_internal: string | null;
  ai_opt_out: boolean;
  status: string;
}

const COLS = `id, organization_id, full_name, preferred_name, primary_phone,
              primary_email, notes_internal, ai_opt_out, status`;

export async function listCustomers(orgId: string): Promise<CustomerRow[]> {
  const res = await getDb().execute(
    sql`SELECT ${sql.raw(COLS)} FROM customers
         WHERE organization_id = ${orgId} AND deleted_at IS NULL
         ORDER BY created_at ASC`,
  );
  return res.rows as unknown as CustomerRow[];
}

export async function getCustomer(orgId: string, id: string): Promise<CustomerRow | null> {
  const res = await getDb().execute(
    sql`SELECT ${sql.raw(COLS)} FROM customers
         WHERE organization_id = ${orgId} AND id = ${id}
           AND deleted_at IS NULL LIMIT 1`,
  );
  return (res.rows[0] as CustomerRow | undefined) ?? null;
}

export async function createCustomer(orgId: string, input: CustomerCreate): Promise<CustomerRow> {
  const id = uuidv7();
  await getDb().execute(
    sql`INSERT INTO customers
          (id, organization_id, full_name, preferred_name, primary_phone,
           primary_email, notes_internal)
        VALUES (${id}, ${orgId}, ${input.full_name},
                ${input.preferred_name ?? null}, ${input.primary_phone ?? null},
                ${input.primary_email ?? null}, ${input.notes_internal ?? null})`,
  );
  const row = await getCustomer(orgId, id);
  if (!row) throw new Error("customer insert vanished");
  return row;
}

const PATCH_COLS: Record<keyof CustomerPatch, string> = {
  full_name: "full_name",
  preferred_name: "preferred_name",
  primary_phone: "primary_phone",
  primary_email: "primary_email",
  notes_internal: "notes_internal",
  ai_opt_out: "ai_opt_out",
};

export async function updateCustomer(
  orgId: string,
  id: string,
  patch: CustomerPatch,
): Promise<CustomerRow | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    const sets = entries.map(
      ([k, v]) => sql`${sql.identifier(PATCH_COLS[k as keyof CustomerPatch])} = ${v}`,
    );
    await getDb().execute(
      sql`UPDATE customers SET ${sql.join(sets, sql`, `)}, updated_at = now()
           WHERE organization_id = ${orgId} AND id = ${id}`,
    );
  }
  return getCustomer(orgId, id);
}

export interface FactRow {
  id: string;
  organization_id: string;
  customer_id: string;
  fact_key: string;
  fact_value: string;
  category: string | null;
  confidence: string | null;
  source_type: string;
  is_private: boolean;
}

export async function listFacts(orgId: string, customerId: string): Promise<FactRow[]> {
  const res = await getDb().execute(
    sql`SELECT id, organization_id, customer_id, fact_key, fact_value,
               category, confidence, source_type, is_private
          FROM customer_facts
         WHERE organization_id = ${orgId} AND customer_id = ${customerId}
           AND superseded_by IS NULL
         ORDER BY created_at ASC`,
  );
  return res.rows as unknown as FactRow[];
}

export async function createFact(
  orgId: string,
  customerId: string,
  input: FactCreate,
): Promise<FactRow> {
  const id = uuidv7();
  await getDb().execute(
    sql`INSERT INTO customer_facts
          (id, organization_id, customer_id, fact_key, fact_value, category,
           confidence, source_type, is_private)
        VALUES (${id}, ${orgId}, ${customerId}, ${input.fact_key},
                ${input.fact_value}, ${input.category ?? null},
                ${input.confidence ?? null}, ${input.source_type},
                ${input.is_private ?? false})`,
  );
  const res = await getDb().execute(
    sql`SELECT id, organization_id, customer_id, fact_key, fact_value,
               category, confidence, source_type, is_private
          FROM customer_facts WHERE id = ${id} LIMIT 1`,
  );
  return res.rows[0] as unknown as FactRow;
}
