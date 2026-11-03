/**
 * Módulo 5 Calendar (M3-C1). FK às tabelas existentes (services/professionals/
 * customers/conversations). Schedules/overrides = TIME (padrão semanal);
 * appointments = timestamptz (instante, tz do calendar). ADR-010 aceita.
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
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { professionals, services } from "./catalog.js";
import { conversations } from "./conversations.js";
import { customers } from "./customers.js";
import { organizations } from "./tenancy.js";
import { createdAt, organizationIdFk, updatedAt, uuidFk, uuidv7PrimaryKey } from "./_shared.js";

export const calendars = pgTable("calendars", {
  id: uuidv7PrimaryKey(),
  organizationId: organizationIdFk()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const professionalSchedules = pgTable(
  "professional_schedules",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    professionalId: uuidFk("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakStart: time("break_start"),
    breakEnd: time("break_end"),
    createdAt: createdAt(),
  },
  (t) => ({
    dowCk: check("professional_schedules_dow_check", sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
    uniq: uniqueIndex("professional_schedules_prof_dow_uniq").on(t.professionalId, t.dayOfWeek),
  }),
);

export const professionalScheduleOverrides = pgTable(
  "professional_schedule_overrides",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    professionalId: uuidFk("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    type: text("type").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => ({
    typeCk: check(
      "professional_schedule_overrides_type_check",
      sql`${t.type} IN ('block','extra','holiday')`,
    ),
    idx: index("professional_schedule_overrides_prof_date_idx").on(t.professionalId, t.date),
  }),
);

export const systemHolidays = pgTable(
  "system_holidays",
  {
    id: uuidv7PrimaryKey(),
    countryCode: text("country_code").notNull().default("BR"),
    date: date("date").notNull(),
    name: text("name").notNull(),
    isRecurring: boolean("is_recurring").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    uniq: uniqueIndex("system_holidays_country_date_uniq").on(t.countryCode, t.date),
  }),
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    calendarId: uuidFk("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    serviceId: uuidFk("service_id")
      .notNull()
      .references(() => services.id),
    professionalId: uuidFk("professional_id")
      .notNull()
      .references(() => professionals.id),
    customerId: uuidFk("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    customerPackageId: uuidFk("customer_package_id"),
    conversationId: uuidFk("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    startAt: timestamp("start_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    endAt: timestamp("end_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    status: text("status").notNull().default("scheduled"),
    source: text("source").notNull().default("manual"),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata"),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
    cancellationReason: text("cancellation_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusCk: check(
      "appointments_status_check",
      sql`${t.status} IN ('scheduled','confirmed','cancelled','completed','no_show')`,
    ),
    sourceCk: check(
      "appointments_source_check",
      sql`${t.source} IN ('ai','manual','external_sync','waitlist')`,
    ),
    rangeCk: check("appointments_range_check", sql`${t.endAt} > ${t.startAt}`),
    profStartIdx: index("appointments_prof_start_idx").on(t.professionalId, t.startAt),
    calStartIdx: index("appointments_calendar_start_idx").on(t.calendarId, t.startAt),
    // Postgres trata NULL como distinto em índice único: bookings manuais com
    // idempotency_key NULL são intencionalmente NÃO deduplicados. O caminho
    // seam/automatizado DEVE sempre preencher idempotency_key (NULL ali
    // desativa o dedup silenciosamente — não há rede de segurança no DB) e
    // tratar unique-violation como sinal de replay idempotente / conflito de
    // slot (enforced na Task 4 booking.ts).
    idemUniq: uniqueIndex("appointments_org_idempotency_uniq").on(
      t.organizationId,
      t.idempotencyKey,
    ),
    customerPackageIdx: index("appointments_customer_package_idx")
      .on(t.organizationId, t.customerPackageId)
      .where(sql`customer_package_id IS NOT NULL`),
  }),
);

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    calendarId: uuidFk("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    serviceId: uuidFk("service_id").references(() => services.id),
    professionalId: uuidFk("professional_id").references(() => professionals.id),
    customerId: uuidFk("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    preferredDateFrom: date("preferred_date_from"),
    preferredDateTo: date("preferred_date_to"),
    preferredTimeFrom: time("preferred_time_from"),
    preferredTimeTo: time("preferred_time_to"),
    status: text("status").notNull().default("waiting"),
    // canon §7.6: priority_score numeric (sem bound). priority/position
    // C1 mantidos como chaves de desempate determinístico.
    priorityScore: numeric("priority_score").notNull().default("0"),
    priority: integer("priority").notNull().default(0),
    position: integer("position"),
    offeredAt: timestamp("offered_at", { withTimezone: true, mode: "date" }),
    offerExpiresAt: timestamp("offer_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    matchedAppointmentId: uuidFk("matched_appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusCk: check(
      "waitlist_entries_status_check",
      sql`${t.status} IN ('waiting','offered','accepted','expired','cancelled')`,
    ),
    calStatusIdx: index("waitlist_entries_calendar_status_idx").on(t.calendarId, t.status),
  }),
);

export const waitlistMatchOutbox = pgTable(
  "waitlist_match_outbox",
  {
    id: uuidv7PrimaryKey(),
    organizationId: organizationIdFk()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    calendarId: uuidFk("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    slotStartAt: timestamp("slot_start_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    serviceId: uuidFk("service_id"),
    professionalId: uuidFk("professional_id"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusCk: check(
      "waitlist_match_outbox_status_check",
      sql`${t.status} IN ('pending','processing','done','dead')`,
    ),
    statusCreatedIdx: index("waitlist_match_outbox_status_created_idx").on(t.status, t.createdAt),
  }),
);

export type Calendar = typeof calendars.$inferSelect;
export type NewCalendar = typeof calendars.$inferInsert;
export type ProfessionalSchedule = typeof professionalSchedules.$inferSelect;
export type NewProfessionalSchedule = typeof professionalSchedules.$inferInsert;
export type ProfessionalScheduleOverride = typeof professionalScheduleOverrides.$inferSelect;
export type NewProfessionalScheduleOverride = typeof professionalScheduleOverrides.$inferInsert;
export type SystemHoliday = typeof systemHolidays.$inferSelect;
export type NewSystemHoliday = typeof systemHolidays.$inferInsert;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;
export type NewWaitlistEntry = typeof waitlistEntries.$inferInsert;
export type WaitlistMatchOutbox = typeof waitlistMatchOutbox.$inferSelect;
export type NewWaitlistMatchOutbox = typeof waitlistMatchOutbox.$inferInsert;
