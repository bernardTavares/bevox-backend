/**
 * Service layer — services module (PRD §10.1).
 */

import { errors } from "@/shared/errors.js";

import {
  createService,
  deleteService,
  getService,
  listServiceProfessionals,
  listServices,
  updateService,
  type ServiceRow,
} from "./repository.js";
import type { ServiceCreate, ServicePatch } from "./schemas.js";

export async function list(orgId: string) {
  return { items: await listServices(orgId) };
}

export async function getOne(orgId: string, id: string): Promise<ServiceRow> {
  const row = await getService(orgId, id);
  if (!row) throw errors.notFound("Service", id);
  return row;
}

export async function create(orgId: string, input: ServiceCreate): Promise<ServiceRow> {
  return createService(orgId, input);
}

export async function patch(orgId: string, id: string, body: ServicePatch): Promise<ServiceRow> {
  const existing = await getService(orgId, id);
  if (!existing) throw errors.notFound("Service", id);
  const updated = await updateService(orgId, id, body);
  if (!updated) throw errors.notFound("Service", id);
  return updated;
}

export async function remove(orgId: string, id: string): Promise<{ ok: true }> {
  const ok = await deleteService(orgId, id);
  if (!ok) throw errors.notFound("Service", id);
  return { ok: true };
}

export async function listProfessionals(orgId: string, serviceId: string) {
  const svc = await getService(orgId, serviceId);
  if (!svc) throw errors.notFound("Service", serviceId);
  return { items: await listServiceProfessionals(orgId, serviceId) };
}
