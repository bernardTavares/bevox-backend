/**
 * Service layer — organizations module (PRD §10.1). organization_id native.
 */

import { errors } from "@/shared/errors.js";

import {
  advanceOnboarding,
  getOnboarding,
  getOrganization,
  getSettings,
  listUsers,
  updateOrganization,
  upsertSettings,
  type OrganizationRow,
  type SettingsRow,
} from "./repository.js";
import type { OrganizationPatch, SettingsPatch } from "./schemas.js";

export async function fetchOrganization(id: string): Promise<OrganizationRow> {
  const org = await getOrganization(id);
  if (!org) throw errors.notFound("Organization", id);
  return org;
}

export async function patchOrganization(
  id: string,
  patch: OrganizationPatch,
): Promise<OrganizationRow> {
  const existing = await getOrganization(id);
  if (!existing) throw errors.notFound("Organization", id);
  const updated = await updateOrganization(id, patch);
  if (!updated) throw errors.notFound("Organization", id);
  return updated;
}

export async function fetchSettings(orgId: string): Promise<SettingsRow> {
  const s = await getSettings(orgId);
  if (!s) {
    // 1:1 with organizations — materialize defaults lazily.
    const created = await upsertSettings(orgId, {});
    if (!created) throw errors.notFound("OrganizationSettings", orgId);
    return created;
  }
  return s;
}

export async function patchSettings(orgId: string, patch: SettingsPatch): Promise<SettingsRow> {
  const s = await upsertSettings(orgId, patch);
  if (!s) throw errors.notFound("OrganizationSettings", orgId);
  return s;
}

export async function fetchUsers(orgId: string) {
  return { items: await listUsers(orgId) };
}

export async function fetchOnboarding(orgId: string): Promise<{ stage: string }> {
  const o = await getOnboarding(orgId);
  if (!o) throw errors.notFound("Organization", orgId);
  return o;
}

export async function advanceOnboardingStage(
  orgId: string,
  stage: string,
): Promise<{ stage: string }> {
  const o = await advanceOnboarding(orgId, stage);
  if (!o) throw errors.notFound("Organization", orgId);
  return o;
}
