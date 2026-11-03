/**
 * C2 Google Calendar (Módulo 5). FK às tabelas existentes
 * (organizations/calendars/professionals/appointments). Tokens em bytea
 * (AES-256-GCM via src/lib/token-crypto.ts). Build-to-canon §3.1/§7.4.
 */
import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy.js";
import { professionals } from "./catalog.js";
import { calendars, appointments } from "./calendar.js";
import { createdAt, organizationIdFk, updatedAt, uuidFk, uuidv7PrimaryKey } from "./_shared.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const calendarProviderConnections = pgTable(
  "calendar_provider_connections",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    calendarId: uuidFk("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    professionalId: uuidFk("professional_id").references(() => professionals.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull().default("google"),
    syncMode: text("sync_mode").notNull().default("two_way"),
    status: text("status").notNull().default("connected"),
    googleAccountEmail: text("google_account_email"),
    externalCalendarId: text("external_calendar_id").notNull().default("primary"),
    googleRefreshTokenEncrypted: bytea("google_refresh_token_encrypted"),
    googleAccessTokenEncrypted: bytea("google_access_token_encrypted"),
    googleAccessTokenExpiresAt: timestamp("google_access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    googleWatchChannelId: text("google_watch_channel_id"),
    googleWatchResourceId: text("google_watch_resource_id"),
    googleWatchExpiresAt: timestamp("google_watch_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    googleSyncToken: text("google_sync_token"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "date" }),
    lastSyncStatus: text("last_sync_status"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    syncModeCk: check("cpc_sync_mode_check", sql`${t.syncMode} IN ('read_only','two_way')`),
    statusCk: check(
      "cpc_status_check",
      sql`${t.status} IN ('connected','token_expired','revoked','error')`,
    ),
    uniqProf: uniqueIndex("cpc_cal_prof_provider_uniq")
      .on(t.calendarId, t.professionalId, t.provider)
      .where(sql`professional_id IS NOT NULL`),
    uniqCal: uniqueIndex("cpc_cal_provider_uniq")
      .on(t.calendarId, t.provider)
      .where(sql`professional_id IS NULL`),
  }),
);

export const appointmentGoogleEvents = pgTable(
  "appointment_google_events",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appointmentId: uuidFk("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    googleConnectionId: uuidFk("google_connection_id")
      .notNull()
      .references(() => calendarProviderConnections.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id").notNull(),
    googleEtag: text("google_etag"),
    lastDirection: text("last_direction").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    dirCk: check("age_direction_check", sql`${t.lastDirection} IN ('push','pull')`),
    uniqEvent: uniqueIndex("age_conn_event_uniq").on(t.googleConnectionId, t.googleEventId),
    uniqAppt: uniqueIndex("age_appt_conn_uniq").on(t.appointmentId, t.googleConnectionId),
  }),
);

export const googleCalendarWebhookEvents = pgTable(
  "google_calendar_webhook_events",
  {
    id: uuidv7PrimaryKey(),
    googleConnectionId: uuidFk("google_connection_id")
      .notNull()
      .references(() => calendarProviderConnections.id, { onDelete: "cascade" }),
    channelId: text("channel_id"),
    resourceId: text("resource_id"),
    resourceState: text("resource_state"),
    messageNumber: text("message_number"),
    processingStatus: text("processing_status").notNull().default("pending"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => ({
    connRecvIdx: index("gcwe_conn_received_idx").on(t.googleConnectionId, t.receivedAt),
  }),
);

export const googleSyncOutbox = pgTable(
  "google_sync_outbox",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appointmentId: uuidFk("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    op: text("op").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    opCk: check("gso_op_check", sql`${t.op} IN ('create','update','delete')`),
    statusCk: check(
      "gso_status_check",
      sql`${t.status} IN ('pending','processing','done','error','skipped')`,
    ),
    pendingIdx: index("gso_pending_idx")
      .on(t.createdAt)
      .where(sql`status = 'pending'`),
  }),
);

export type CalendarProviderConnection = typeof calendarProviderConnections.$inferSelect;
export type NewCalendarProviderConnection = typeof calendarProviderConnections.$inferInsert;
export type AppointmentGoogleEvent = typeof appointmentGoogleEvents.$inferSelect;
export type NewAppointmentGoogleEvent = typeof appointmentGoogleEvents.$inferInsert;
export type GoogleCalendarWebhookEvent = typeof googleCalendarWebhookEvents.$inferSelect;
export type NewGoogleCalendarWebhookEvent = typeof googleCalendarWebhookEvents.$inferInsert;
export type GoogleSyncOutbox = typeof googleSyncOutbox.$inferSelect;
export type NewGoogleSyncOutbox = typeof googleSyncOutbox.$inferInsert;
