/**
 * Repository — organizations module. organization_id-scoped, parameterized
 * SQL via getDb() (no static @db import — flat-dist alias gate, R3).
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client.js";
import { cacheAside, cacheInvalidate } from "@/lib/cache.js";

import type { OrganizationPatch, SettingsPatch } from "./schemas.js";

const ORG_CACHE_NAMESPACE = "org";
const ORG_CACHE_TTL_SECONDS = 60;

export interface OrganizationRow {
  id: string;
  name: string;
  business_name: string;
  legal_name: string | null;
  niche: string;
  timezone: string;
  currency: string;
  locale: string;
  onboarding_stage: string;
  ai_mode: string;
  status: string;
}

export async function getOrganization(id: string): Promise<OrganizationRow | null> {
  return (await cacheAside(id, {
    namespace: ORG_CACHE_NAMESPACE,
    ttlSeconds: ORG_CACHE_TTL_SECONDS,
    fetch: async () => {
      const res = await getDb().execute(
        sql`SELECT id, name, business_name, legal_name, niche, timezone,
                   currency, locale, onboarding_stage, ai_mode, status
              FROM organizations WHERE id = ${id} LIMIT 1`,
      );
      return (res.rows[0] as OrganizationRow | undefined) ?? null;
    },
  })) as OrganizationRow | null;
}

const ORG_COLUMNS: Record<keyof OrganizationPatch, string> = {
  name: "name",
  business_name: "business_name",
  legal_name: "legal_name",
  niche: "niche",
  timezone: "timezone",
  currency: "currency",
  locale: "locale",
};

export async function updateOrganization(
  id: string,
  patch: OrganizationPatch,
): Promise<OrganizationRow | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return getOrganization(id);

  const sets = entries.map(
    ([k, v]) => sql`${sql.identifier(ORG_COLUMNS[k as keyof OrganizationPatch])} = ${v}`,
  );
  await getDb().execute(
    sql`UPDATE organizations
           SET ${sql.join(sets, sql`, `)}, updated_at = now()
         WHERE id = ${id}`,
  );
  await cacheInvalidate(ORG_CACHE_NAMESPACE, id);
  return getOrganization(id);
}

export interface SettingsRow {
  organization_id: string;
  default_reply_tone: string | null;
  default_language: string | null;
  allow_same_day_booking: boolean;
  default_booking_notice_minutes: number | null;
  default_cancel_notice_minutes: number | null;
  default_reschedule_notice_minutes: number | null;
}

export async function getSettings(orgId: string): Promise<SettingsRow | null> {
  const res = await getDb().execute(
    sql`SELECT organization_id, default_reply_tone, default_language,
               allow_same_day_booking, default_booking_notice_minutes,
               default_cancel_notice_minutes, default_reschedule_notice_minutes
          FROM organization_settings WHERE organization_id = ${orgId} LIMIT 1`,
  );
  return (res.rows[0] as SettingsRow | undefined) ?? null;
}

const SETTINGS_COLUMNS: Record<keyof SettingsPatch, string> = {
  default_reply_tone: "default_reply_tone",
  default_language: "default_language",
  allow_same_day_booking: "allow_same_day_booking",
  default_booking_notice_minutes: "default_booking_notice_minutes",
  default_cancel_notice_minutes: "default_cancel_notice_minutes",
  default_reschedule_notice_minutes: "default_reschedule_notice_minutes",
};

export async function upsertSettings(
  orgId: string,
  patch: SettingsPatch,
): Promise<SettingsRow | null> {
  // Ensure a row exists (1:1 with organizations).
  await getDb().execute(
    sql`INSERT INTO organization_settings (organization_id)
        VALUES (${orgId})
        ON CONFLICT (organization_id) DO NOTHING`,
  );
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    const sets = entries.map(
      ([k, v]) => sql`${sql.identifier(SETTINGS_COLUMNS[k as keyof SettingsPatch])} = ${v}`,
    );
    await getDb().execute(
      sql`UPDATE organization_settings
             SET ${sql.join(sets, sql`, `)}, updated_at = now()
           WHERE organization_id = ${orgId}`,
    );
  }
  return getSettings(orgId);
}

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  status: string;
}

export async function listUsers(orgId: string): Promise<UserRow[]> {
  const res = await getDb().execute(
    sql`SELECT id, name, email, role, status
          FROM users WHERE organization_id = ${orgId}
         ORDER BY created_at ASC`,
  );
  return res.rows as unknown as UserRow[];
}

export async function getOnboarding(orgId: string): Promise<{ stage: string } | null> {
  const res = await getDb().execute(
    sql`SELECT onboarding_stage AS stage FROM organizations WHERE id = ${orgId} LIMIT 1`,
  );
  return (res.rows[0] as { stage: string } | undefined) ?? null;
}

export async function advanceOnboarding(
  orgId: string,
  stage: string,
): Promise<{ stage: string } | null> {
  const res = await getDb().execute(
    sql`UPDATE organizations
           SET onboarding_stage = ${stage}, updated_at = now()
         WHERE id = ${orgId}
       RETURNING onboarding_stage AS stage`,
  );
  // onboarding_stage está no SELECT shape cacheado por getOrganization →
  // invalidate paired com mutate para evitar staleness.
  await cacheInvalidate(ORG_CACHE_NAMESPACE, orgId);
  return (res.rows[0] as { stage: string } | undefined) ?? null;
}
