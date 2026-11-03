/**
 * channel_subscriptions — Marco 4 P1.
 *
 * One row per active webhook subscription registered em bevox-meta-api.
 * V1 = single subscription (backend-wide, tenant_id=null). Multi-subscription
 * support no schema mas único bootstrap em V1.
 *
 * signing_secret é AEAD-encrypted (src/lib/aead.ts) — meta-api emits secret
 * apenas na criação (recovery = DELETE+POST).
 */

import { pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, updatedAt, uuidv7PrimaryKey } from "./_shared.js";

export const channelSubscriptions = pgTable("channel_subscriptions", {
  id: uuidv7PrimaryKey(),
  appId: text("app_id").notNull(),
  subscriptionId: text("subscription_id").notNull().unique(),
  url: text("url").notNull(),
  signingSecretCiphertext: text("signing_secret_ciphertext").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
