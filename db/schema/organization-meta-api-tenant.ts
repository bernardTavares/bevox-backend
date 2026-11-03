/**
 * organization_meta_api_tenant — Marco 4 P1.
 *
 * Maps Bevox organization_id → bevox-meta-api tenant_id UUIDv7 (per consumer
 * integration guide §3). Backend POSTa /v1/tenants once per org + persists
 * the returned tenant_id; usado em X-Tenant-Id header outbound (P2) +
 * inbound tenant resolution (P1).
 *
 * 1:1 mapping (organization_id PK + FK).
 */

import { pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, uuidFk } from "./_shared.js";
import { organizations } from "./tenancy.js";

export const organizationMetaApiTenant = pgTable("organization_meta_api_tenant", {
  organizationId: uuidFk("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  metaApiTenantId: text("meta_api_tenant_id").notNull().unique(),
  createdAt: createdAt(),
});
