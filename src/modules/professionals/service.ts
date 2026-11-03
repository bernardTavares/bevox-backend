/**
 * Service layer — professionals module (PRD §10.1).
 */

import { errors } from "@/shared/errors.js";

import {
  createProfessional,
  deleteProfessional,
  getProfessional,
  listProfessionals,
  updateProfessional,
  type ProfessionalRow,
} from "./repository.js";
import type { ProfessionalCreate, ProfessionalPatch } from "./schemas.js";

export async function list(orgId: string) {
  return { items: await listProfessionals(orgId) };
}

export async function getOne(orgId: string, id: string): Promise<ProfessionalRow> {
  const row = await getProfessional(orgId, id);
  if (!row) throw errors.notFound("Professional", id);
  return row;
}

export async function create(orgId: string, input: ProfessionalCreate): Promise<ProfessionalRow> {
  return createProfessional(orgId, input);
}

export async function patch(
  orgId: string,
  id: string,
  body: ProfessionalPatch,
): Promise<ProfessionalRow> {
  const existing = await getProfessional(orgId, id);
  if (!existing) throw errors.notFound("Professional", id);
  const updated = await updateProfessional(orgId, id, body);
  if (!updated) throw errors.notFound("Professional", id);
  return updated;
}

export async function remove(orgId: string, id: string): Promise<{ ok: true }> {
  const ok = await deleteProfessional(orgId, id);
  if (!ok) throw errors.notFound("Professional", id);
  return { ok: true };
}
