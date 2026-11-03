/**
 * Repository — services module. ALWAYS organization_id-scoped,
 * parameterized SQL via getDb() (no static @db import — flat-dist gate).
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { uuidv7 } from "@/shared/uuid.js";

import type { ServiceCreate, ServicePatch } from "./schemas.js";

export interface ServiceRow {
  id: string;
  organization_id: string;
  name: string;
  category: string | null;
  description: string | null;
  duration_minutes: number;
  price_amount: string | null;
  currency: string;
  max_concurrent: number;
  requires_prepayment: boolean;
  requires_human_approval: boolean;
  is_active: boolean;
}

const COLS = `id, organization_id, name, category, description,
              duration_minutes, price_amount, currency, max_concurrent,
              requires_prepayment, requires_human_approval, is_active`;

export async function listServices(orgId: string): Promise<ServiceRow[]> {
  const res = await getDb().execute(
    sql`SELECT ${sql.raw(COLS)} FROM services
         WHERE organization_id = ${orgId} ORDER BY created_at ASC`,
  );
  return res.rows as unknown as ServiceRow[];
}

export async function getService(orgId: string, id: string): Promise<ServiceRow | null> {
  const res = await getDb().execute(
    sql`SELECT ${sql.raw(COLS)} FROM services
         WHERE organization_id = ${orgId} AND id = ${id} LIMIT 1`,
  );
  return (res.rows[0] as ServiceRow | undefined) ?? null;
}

export async function createService(orgId: string, input: ServiceCreate): Promise<ServiceRow> {
  const id = uuidv7();
  await getDb().execute(
    sql`INSERT INTO services
          (id, organization_id, name, category, description, duration_minutes,
           price_amount, currency, max_concurrent, requires_prepayment,
           requires_human_approval)
        VALUES (${id}, ${orgId}, ${input.name}, ${input.category ?? null},
                ${input.description ?? null}, ${input.duration_minutes},
                ${input.price_amount ?? null}, ${input.currency},
                ${input.max_concurrent ?? 1}, ${input.requires_prepayment ?? false},
                ${input.requires_human_approval ?? false})`,
  );
  const row = await getService(orgId, id);
  if (!row) throw new Error("service insert vanished");
  return row;
}

const PATCH_COLS: Record<keyof ServicePatch, string> = {
  name: "name",
  category: "category",
  description: "description",
  duration_minutes: "duration_minutes",
  price_amount: "price_amount",
  currency: "currency",
  max_concurrent: "max_concurrent",
  requires_prepayment: "requires_prepayment",
  requires_human_approval: "requires_human_approval",
  is_active: "is_active",
};

export async function updateService(
  orgId: string,
  id: string,
  patch: ServicePatch,
): Promise<ServiceRow | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    const sets = entries.map(
      ([k, v]) => sql`${sql.identifier(PATCH_COLS[k as keyof ServicePatch])} = ${v}`,
    );
    await getDb().execute(
      sql`UPDATE services SET ${sql.join(sets, sql`, `)}, updated_at = now()
           WHERE organization_id = ${orgId} AND id = ${id}`,
    );
  }
  return getService(orgId, id);
}

export async function deleteService(orgId: string, id: string): Promise<boolean> {
  const res = await getDb().execute(
    sql`UPDATE services SET is_active = false, updated_at = now()
         WHERE organization_id = ${orgId} AND id = ${id} RETURNING id`,
  );
  return res.rows.length > 0;
}

export interface ServiceProfessionalRow {
  professional_id: string;
  name: string;
  is_primary: boolean;
}

export async function listServiceProfessionals(
  orgId: string,
  serviceId: string,
): Promise<ServiceProfessionalRow[]> {
  const res = await getDb().execute(
    sql`SELECT ps.professional_id, p.name, ps.is_primary
          FROM professional_services ps
          JOIN professionals p ON p.id = ps.professional_id
         WHERE ps.organization_id = ${orgId} AND ps.service_id = ${serviceId}
         ORDER BY ps.created_at ASC`,
  );
  return res.rows as unknown as ServiceProfessionalRow[];
}
