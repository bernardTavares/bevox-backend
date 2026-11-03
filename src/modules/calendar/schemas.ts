/**
 * Zod schemas — calendar module (PRD §10.1). organization_id-scoped.
 */

import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const hm = z.string().regex(/^\d{2}:\d{2}$/, "time must be HH:MM");
const uuid = z.string().uuid();

export const orgParam = z.object({ organization_id: uuid });
export const idParam = z.object({ id: uuid });
export const calIdParam = z.object({
  organization_id: uuid,
  id: uuid,
});

export const availabilityQuery = z
  .object({
    service_id: uuid,
    date_from: ymd,
    date_to: ymd,
  })
  .superRefine((q, ctx) => {
    // UTC parsing: offset/DST-immune span computation.
    const from = Date.parse(`${q.date_from}T00:00:00Z`);
    const to = Date.parse(`${q.date_to}T00:00:00Z`);
    const spanDays = (to - from) / 86_400_000 + 1; // inclusive
    if (from > to || spanDays > 92) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date range invalid: date_from must be <= date_to and span <= 92 days",
      });
    }
  });

export const createAppointmentBody = z
  .object({
    service_id: uuid,
    professional_id: uuid.optional(),
    customer_id: uuid.optional(),
    customer_name: z.string().min(1).optional(),
    customer_phone: z.string().optional(),
    customer_email: z.string().email().optional(),
    customer_package_id: uuid.optional(),
    date: ymd,
    start_time: hm,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const rescheduleBody = z
  .object({
    date: ymd.optional(),
    start_time: hm.optional(),
    professional_id: uuid.optional(),
  })
  .strict();

export const cancelBody = z.object({ reason: z.string().optional() }).strict();
export const calendarBody = z
  .object({
    name: z.string().min(1),
    timezone: z.string().min(1).default("America/Sao_Paulo"),
  })
  .strict();

export const profParam = z.object({
  organization_id: uuid,
  professionalId: uuid,
});

export const scheduleOverrideBody = z
  .object({
    date: ymd,
    type: z.enum(["block", "extra", "holiday"]),
    start_time: hm.optional(),
    end_time: hm.optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((b) => (b.type === "extra" ? !!b.start_time && !!b.end_time : true), {
    message: "type=extra requires start_time and end_time",
  });

export type CreateAppointmentBody = z.infer<typeof createAppointmentBody>;
export type RescheduleBody = z.infer<typeof rescheduleBody>;
