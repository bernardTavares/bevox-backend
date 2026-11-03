/** Waitlist endpoints (C3, PRD §5.3) — org-scoped cliente. */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createAppointment } from "@/modules/calendar/booking.js";
import { errors } from "@/shared/errors.js";

import * as repo from "./repository.js";

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^\d{2}:\d{2}$/);

const calParam = z.object({ organization_id: uuid, calendarId: uuid });
const entryParam = z.object({ organization_id: uuid, id: uuid });
const listQuery = z.object({ status: z.string().min(1).optional() });

const createBody = z
  .object({
    service_id: uuid.optional(),
    professional_id: uuid.optional(),
    customer_id: uuid.optional(),
    customer_name: z.string().min(1).max(200).optional(),
    customer_phone: z.string().min(1).max(40).optional(),
    customer_email: z.string().email().optional(),
    preferred_date_from: ymd.optional(),
    preferred_date_to: ymd.optional(),
    preferred_time_from: hm.optional(),
    preferred_time_to: hm.optional(),
    priority_score: z.coerce.number().finite().optional(),
  })
  .strict();

const patchBody = z
  .object({
    priority_score: z.coerce.number().finite().optional(),
    priority: z.coerce.number().int().optional(),
    customer_name: z.string().min(1).max(200).optional(),
    customer_phone: z.string().min(1).max(40).optional(),
    customer_email: z.string().email().optional(),
    status: z.literal("cancelled").optional(),
  })
  .strict();

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const write = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope(), app.requireIdempotency()],
  };
  const B = "/api/v1/organizations/:organization_id";

  app.post(`${B}/calendars/:calendarId/waitlist-entries`, write, async (req, reply) => {
    const { organization_id, calendarId } = calParam.parse(req.params);
    const b = createBody.parse(req.body);
    if (!(await repo.serviceAllowsWaitlist(organization_id, b.service_id ?? null))) {
      throw errors.invalidInput("Service does not allow waitlist");
    }
    const id = await repo.insertWaitlistEntry({
      organizationId: organization_id,
      calendarId,
      serviceId: b.service_id ?? null,
      professionalId: b.professional_id ?? null,
      customerId: b.customer_id ?? null,
      customerName: b.customer_name ?? null,
      customerPhone: b.customer_phone ?? null,
      customerEmail: b.customer_email ?? null,
      preferredDateFrom: b.preferred_date_from ?? null,
      preferredDateTo: b.preferred_date_to ?? null,
      preferredTimeFrom: b.preferred_time_from ?? null,
      preferredTimeTo: b.preferred_time_to ?? null,
      priorityScore: b.priority_score ?? 0,
    });
    return reply.status(201).send({ waitlist_entry: { id } });
  });

  app.get(`${B}/calendars/:calendarId/waitlist-entries`, read, async (req, reply) => {
    const { organization_id, calendarId } = calParam.parse(req.params);
    const q = listQuery.parse(req.query);
    return reply
      .status(200)
      .send({ data: await repo.listEntries(organization_id, calendarId, q.status) });
  });

  app.get(`${B}/waitlist-entries/:id`, read, async (req, reply) => {
    const { organization_id, id } = entryParam.parse(req.params);
    const e = await repo.getEntry(organization_id, id);
    if (!e) throw errors.notFound("WaitlistEntry", id);
    return reply.status(200).send({ waitlist_entry: e });
  });

  app.patch(`${B}/waitlist-entries/:id`, write, async (req, reply) => {
    const { organization_id, id } = entryParam.parse(req.params);
    const b = patchBody.parse(req.body);
    const ok = await repo.patchEntry(organization_id, id, {
      priority_score: b.priority_score,
      priority: b.priority,
      customer_name: b.customer_name,
      customer_phone: b.customer_phone,
      customer_email: b.customer_email,
      cancel: b.status === "cancelled",
    });
    if (!ok) throw errors.notFound("WaitlistEntry", id);
    return reply.status(200).send({ ok: true });
  });

  app.post(`${B}/waitlist-entries/:id/accept`, write, async (req, reply) => {
    const { organization_id, id } = entryParam.parse(req.params);
    const e = await repo.casAcceptOffered(organization_id, id);
    if (!e) throw errors.conflict("Waitlist entry is not in 'offered' state", { id });
    if (!e.service_id) {
      throw errors.invalidInput("Waitlist entry has no service; cannot create appointment");
    }
    const full = await repo.getEntry(organization_id, id);
    const slotIso = String(
      (full as Record<string, unknown>).offered_at ?? new Date().toISOString(),
    );
    const r = await createAppointment({
      organizationId: organization_id,
      calendarId: e.calendar_id,
      serviceId: e.service_id,
      professionalId: e.professional_id ?? null,
      customerId: e.customer_id,
      customerName: e.customer_name,
      customerPhone: e.customer_phone,
      customerEmail: e.customer_email,
      date: new Date(slotIso).toISOString().slice(0, 10),
      startTime: new Date(slotIso).toISOString().slice(11, 16),
      source: "waitlist" as unknown as "ai" | "manual",
      idempotencyKey: `wl-accept:${id}`,
    });
    if (r.status === "slot_conflict") {
      throw errors.conflict("Slot no longer available", { id });
    }
    await repo.attachAppointment(id, r.appointment_id!);
    return reply.status(201).send({ appointment_id: r.appointment_id });
  });
};

export const waitlistRoutes = plugin;
