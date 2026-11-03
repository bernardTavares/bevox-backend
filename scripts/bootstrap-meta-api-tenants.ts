/**
 * Ops script — provision bevox-meta-api tenant per Bevox organization.
 *
 * Idempotent: lists orgs without organization_meta_api_tenant row; POSTs
 * /v1/tenants em meta-api ({external_id: orgId, display_name: orgName});
 * persists tenant_id retornado. Founder runs one-time per ambiente:
 *   pnpm bootstrap:meta-api-tenants
 *
 * Marco 4 P1.
 */

import "dotenv/config";

import { sql } from "drizzle-orm";

import { closeDb, getDb } from "@/db/client.js";
import { metaApiFetch } from "@/modules/channels/metaapi/client.js";
import {
  insertTenantMapping,
  listOrgsMissingMetaApiTenant,
} from "@/modules/channels/metaapi/repository.js";

async function main(): Promise<void> {
  const orgIds = await listOrgsMissingMetaApiTenant();
  console.log(`[bootstrap] ${orgIds.length} organizations missing meta-api tenant mapping`);

  if (orgIds.length === 0) {
    console.log("[bootstrap] all orgs already mapped — exiting");
    await closeDb();
    return;
  }

  const db = getDb();
  for (const orgId of orgIds) {
    const res = await db.execute(
      sql`SELECT id, name FROM organizations WHERE id = ${orgId} LIMIT 1`,
    );
    const orgRows = res.rows as unknown as Array<{ id: string; name: string }>;
    if (orgRows.length === 0) {
      console.warn(`[bootstrap] org ${orgId} not found — skip`);
      continue;
    }
    const org = orgRows[0]!;

    const apiRes = await metaApiFetch("/v1/tenants", {
      method: "POST",
      scopes: ["tenants:write"],
      headers: { "Idempotency-Key": `tenant-bootstrap-${orgId}` },
      body: JSON.stringify({
        external_id: orgId,
        display_name: org.name,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error(`[bootstrap] org ${orgId}: meta-api error ${apiRes.status} ${errText}`);
      continue;
    }

    const tenant = (await apiRes.json()) as { id: string };
    await insertTenantMapping({
      organizationId: orgId,
      metaApiTenantId: tenant.id,
    });
    console.log(`[bootstrap] org ${orgId.slice(0, 8)}... → tenant ${tenant.id.slice(0, 8)}...`);
  }

  await closeDb();
  console.log("[bootstrap] done");
}

main().catch((err) => {
  console.error("[bootstrap] fatal:", err);
  process.exit(1);
});
