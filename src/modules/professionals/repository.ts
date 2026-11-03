/**
 * Repository — professionals module. ALWAYS organization_id-scoped,
 * parameterized SQL via getDb() (no static @db import — flat-dist gate).
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { uuidv7 } from "@/shared/uuid.js";

import type { ProfessionalCreate, ProfessionalPatch } from "./schemas.js";

export interface ProfessionalRow {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role_type: string;
  bio: string | null;
  is_bookable: boolean;
  can_take_handoffs: boolean;
  is_active: boolean;
}

const COLS = `id, organization_id, name, email, phone, role_type, bio,
              is_bookable, can_take_handoffs, is_active`;

export async function listProfessionals(orgId: string): Promise<ProfessionalRow[]> {
  const res = await getDb().execute(
    sql`SELECT ${sql.raw(COLS)} FROM professionals
         WHERE organization_id = ${orgId}
         ORDER BY created_at ASC`,
  );
  return res.rows as unknown as ProfessionalRow[];
}

export async function getProfessional(orgId: string, id: string): Promise<ProfessionalRow | null> {
  const res = await getDb().execute(
    sql`SELECT ${sql.raw(COLS)} FROM professionals
         WHERE organization_id = ${orgId} AND id = ${id} LIMIT 1`,
  );
  return (res.rows[0] as ProfessionalRow | undefined) ?? null;
}

export async function createProfessional(
  orgId: string,
  input: ProfessionalCreate,
): Promise<ProfessionalRow> {
  const id = uuidv7();
  await getDb().execute(
    sql`INSERT INTO professionals
          (id, organization_id, name, email, phone, role_type, bio,
           is_bookable, can_take_handoffs)
        VALUES (${id}, ${orgId}, ${input.name}, ${input.email ?? null},
                ${input.phone ?? null}, ${input.role_type}, ${input.bio ?? null},
                ${input.is_bookable ?? true}, ${input.can_take_handoffs ?? false})`,
  );
  const row = await getProfessional(orgId, id);
  if (!row) throw new Error("professional insert vanished");
  return row;
}

const PATCH_COLS: Record<keyof ProfessionalPatch, string> = {
  name: "name",
  email: "email",
  phone: "phone",
  role_type: "role_type",
  bio: "bio",
  is_bookable: "is_bookable",
  can_take_handoffs: "can_take_handoffs",
  is_active: "is_active",
};

export async function updateProfessional(
  orgId: string,
  id: string,
  patch: ProfessionalPatch,
): Promise<ProfessionalRow | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    const sets = entries.map(
      ([k, v]) => sql`${sql.identifier(PATCH_COLS[k as keyof ProfessionalPatch])} = ${v}`,
    );
    await getDb().execute(
      sql`UPDATE professionals
             SET ${sql.join(sets, sql`, `)}, updated_at = now()
           WHERE organization_id = ${orgId} AND id = ${id}`,
    );
  }
  return getProfessional(orgId, id);
}

export async function deleteProfessional(orgId: string, id: string): Promise<boolean> {
  // Soft-deactivate (no physical DELETE — referential integrity).
  const res = await getDb().execute(
    sql`UPDATE professionals SET is_active = false, updated_at = now()
         WHERE organization_id = ${orgId} AND id = ${id} RETURNING id`,
  );
  return res.rows.length > 0;
}
