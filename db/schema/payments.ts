/**
 * Payments §11 (canon data-model). P1 exercita só payment_accounts;
 * charges/payments/refunds/service_packages/customer_packages são
 * forward-decl (P2/P3/P4 consomem/reconciliam — padrão C1 waitlist_entries).
 * text+CHECK (sem pgEnum, padrão calendar/google). IDs de provider = text
 * (canon §2.7). organization_id (ADR-021). Forward-decls §11.3–§11.6 só
 * têm created_at (canon); updated_at adiado a P3/P4 na reconciliação.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { createdAt, organizationIdFk, updatedAt, uuidFk, uuidv7PrimaryKey } from "./_shared.js";
import { organizations } from "./tenancy.js";
import { professionals, services } from "./catalog.js";
import { customers } from "./customers.js";
import { appointments } from "./calendar.js";

export const paymentAccounts = pgTable(
  "payment_accounts",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("stripe"),
    accountHolderType: text("account_holder_type").notNull().default("organization"),
    professionalId: uuidFk("professional_id").references(() => professionals.id, {
      onDelete: "set null",
    }),
    externalAccountId: text("external_account_id"),
    onboardingStatus: text("onboarding_status").notNull().default("pending"),
    pixEnabled: boolean("pix_enabled").notNull().default(false),
    paymentLinkEnabled: boolean("payment_link_enabled").notNull().default(false),
    splitConfigJson: jsonb("split_config_json"),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    providerCk: check("payment_accounts_provider_check", sql`${t.provider} IN ('stripe','manual')`),
    holderCk: check(
      "payment_accounts_holder_check",
      sql`${t.accountHolderType} IN ('organization','professional')`,
    ),
    statusCk: check(
      "payment_accounts_onboarding_status_check",
      sql`${t.onboardingStatus} IN ('pending','verified','restricted','active')`,
    ),
    orgUniq: uniqueIndex("payment_accounts_org_uniq")
      .on(t.organizationId)
      .where(sql`${t.accountHolderType} = 'organization'`),
    externalIdx: index("payment_accounts_external_idx").on(t.externalAccountId),
  }),
);

export const charges = pgTable(
  "charges",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuidFk("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    appointmentId: uuidFk("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    serviceId: uuidFk("service_id").references(() => services.id),
    professionalId: uuidFk("professional_id").references(() => professionals.id),
    paymentAccountId: uuidFk("payment_account_id")
      .notNull()
      .references(() => paymentAccounts.id),
    chargeType: text("charge_type").notNull(),
    status: text("status").notNull().default("pending"),
    amountTotal: numeric("amount_total", { precision: 10, scale: 2 }).notNull(),
    amountPlatformFee: numeric("amount_platform_fee", { precision: 10, scale: 2 }),
    currency: text("currency").notNull(),
    providerChargeId: text("provider_charge_id"),
    paymentMethod: text("payment_method"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    typeCk: check(
      "charges_charge_type_check",
      sql`${t.chargeType} IN ('deposit','full','package','adjustment')`,
    ),
    statusCk: check(
      "charges_status_check",
      sql`${t.status} IN ('pending','paid','expired','cancelled','refunded')`,
    ),
    methodCk: check(
      "charges_payment_method_check",
      sql`${t.paymentMethod} IS NULL OR ${t.paymentMethod} IN ('pix','payment_link','cash','pix_manual','bank_transfer','boleto_manual','card_manual','other')`,
    ),
    providerIdx: index("charges_org_provider_idx").on(t.organizationId, t.providerChargeId),
    idemUniq: uniqueIndex("charges_org_idempotency_uniq").on(t.organizationId, t.idempotencyKey),
  }),
);

export const payments = pgTable(
  "payments",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    chargeId: uuidFk("charge_id")
      .notNull()
      .references(() => charges.id),
    status: text("status").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    rawPayloadJson: jsonb("raw_payload_json"),
    createdAt: createdAt(),
  },
  (t) => ({
    statusCk: check("payments_status_check", sql`${t.status} IN ('paid','failed','reversed')`),
    providerIdx: index("payments_org_provider_idx").on(t.organizationId, t.providerPaymentId),
    providerStatusUniq: uniqueIndex("payments_org_provider_status_uniq").on(
      t.organizationId,
      t.providerPaymentId,
      t.status,
    ),
  }),
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    chargeId: uuidFk("charge_id")
      .notNull()
      .references(() => charges.id),
    status: text("status").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    reasonCode: text("reason_code"),
    providerRefundId: text("provider_refund_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => ({
    statusCk: check("refunds_status_check", sql`${t.status} IN ('pending','succeeded','failed')`),
    providerRefundUniq: uniqueIndex("refunds_org_provider_refund_uniq")
      .on(t.organizationId, t.providerRefundId)
      .where(sql`provider_refund_id IS NOT NULL`),
  }),
);

export const servicePackages = pgTable("service_packages", {
  id: uuidv7PrimaryKey(),
  organizationId: organizationIdFk()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  serviceId: uuidFk("service_id").references(() => services.id),
  sessionsIncluded: integer("sessions_included").notNull(),
  priceAmount: numeric("price_amount", { precision: 10, scale: 2 }).notNull(),
  validityDays: numeric("validity_days"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customerPackages = pgTable(
  "customer_packages",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuidFk("customer_id")
      .notNull()
      .references(() => customers.id),
    servicePackageId: uuidFk("service_package_id")
      .notNull()
      .references(() => servicePackages.id),
    chargeId: uuidFk("charge_id").references(() => charges.id),
    status: text("status").notNull().default("active"),
    sessionsTotal: integer("sessions_total").notNull(),
    sessionsUsed: integer("sessions_used").notNull().default(0),
    sessionsRemaining: integer("sessions_remaining").notNull(),
    validUntil: date("valid_until"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusCk: check(
      "customer_packages_status_check",
      sql`${t.status} IN ('active','exhausted','expired','cancelled')`,
    ),
    sessionsRemainingCk: check(
      "customer_packages_sessions_remaining_nonneg",
      sql`${t.sessionsRemaining} >= 0`,
    ),
    chargeUniq: uniqueIndex("customer_packages_charge_uniq")
      .on(t.organizationId, t.chargeId)
      .where(sql`charge_id IS NOT NULL`),
    customerIdx: index("customer_packages_customer_idx").on(
      t.organizationId,
      t.customerId,
      t.status,
    ),
    expiryIdx: index("customer_packages_expiry_idx")
      .on(t.status, t.validUntil)
      .where(sql`status = 'active' AND valid_until IS NOT NULL`),
  }),
);

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: uuidv7PrimaryKey(),
  organizationId: uuidFk("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
});

export type PaymentAccount = typeof paymentAccounts.$inferSelect;
export type NewPaymentAccount = typeof paymentAccounts.$inferInsert;
export type Charge = typeof charges.$inferSelect;
export type NewCharge = typeof charges.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
export type ServicePackage = typeof servicePackages.$inferSelect;
export type NewServicePackage = typeof servicePackages.$inferInsert;
export type CustomerPackage = typeof customerPackages.$inferSelect;
export type NewCustomerPackage = typeof customerPackages.$inferInsert;
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type NewStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;
