/** Calendar endpoints (M3-C1, PRD §5.3) — org-scoped cliente. */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { errors } from "@/shared/errors.js";

import {
  availabilityQuery,
  calIdParam,
  calendarBody,
  cancelBody,
  createAppointmentBody,
  orgParam,
  profParam,
  rescheduleBody,
  scheduleOverrideBody,
} from "./schemas.js";
import * as repo from "./repository.js";
import { getAvailableSlots } from "./availability.js";
import { createAppointment, rescheduleAppointment, transitionAppointment } from "./booking.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  const read = { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] };
  const write = {
    preHandler: [app.requireClerkAuth(), app.requireOrganizationScope(), app.requireIdempotency()],
  };
  const B = "/api/v1/organizations/:organization_id";

  app.get(`${B}/calendars`, read, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    return reply.status(200).send({ data: await repo.listCalendars(organization_id) });
  });

  app.post(`${B}/calendars`, write, async (req, reply) => {
    const { organization_id } = orgParam.parse(req.params);
    const b = calendarBody.parse(req.body);
    return reply
      .status(201)
      .send({ calendar: await repo.createCalendar(organization_id, b.name, b.timezone) });
  });

  app.post(`${B}/professionals/:professionalId/schedule-overrides`, write, async (req, reply) => {
    const { organization_id, professionalId } = profParam.parse(req.params);
    const b = scheduleOverrideBody.parse(req.body);
    const out = await repo.createScheduleOverride(organization_id, professionalId, b);
    return reply.status(201).send({ schedule_override: out });
  });

  app.get(`${B}/calendars/:id/availability`, read, async (req, reply) => {
    const { organization_id, id } = calIdParam.parse(req.params);
    const q = availabilityQuery.parse(req.query);
    const out: unknown[] = [];
    for (let dt = q.date_from; dt <= q.date_to; ) {
      out.push(
        await getAvailableSlots({
          organizationId: organization_id,
          calendarId: id,
          serviceId: q.service_id,
          date: dt,
        }),
      );
      // `Z` is required: parse and toISOString must both be UTC so the
      // step is offset/DST-immune (without it, a positive-UTC-offset
      // runtime never advances `dt` → infinite loop).
      const n = new Date(`${dt}T00:00:00Z`);
      n.setDate(n.getDate() + 1);
      dt = n.toISOString().slice(0, 10);
    }
    return reply.status(200).send({ days: out });
  });

  app.post(`${B}/calendars/:id/appointments`, write, async (req, reply) => {
    const { organization_id, id } = calIdParam.parse(req.params);
    const b = createAppointmentBody.parse(req.body);
    const idk = req.headers["idempotency-key"];
    const r = await createAppointment({
      organizationId: organization_id,
      calendarId: id,
      serviceId: b.service_id,
      professionalId: b.professional_id ?? null,
      customerId: b.customer_id ?? null,
      customerName: b.customer_name ?? null,
      customerPhone: b.customer_phone ?? null,
      customerEmail: b.customer_email ?? null,
      customerPackageId: b.customer_package_id ?? null,
      date: b.date,
      startTime: b.start_time,
      source: "manual",
      idempotencyKey: Array.isArray(idk) ? idk[0] : idk,
      metadata: b.metadata ?? null,
    });
    if (r.status === "slot_conflict") {
      throw errors.conflict("slot_conflict", {
        hint: "request a new suggestion / pick another slot",
      });
    }
    return reply.status(201).send({ appointment_id: r.appointment_id });
  });

  app.patch(`${B}/appointments/:id`, write, async (req, reply) => {
    const { organization_id, id } = calIdParam.parse(req.params);
    const b = rescheduleBody.parse(req.body);
    // Carry-forward (Task 4 review, item a): rescheduleBody makes
    // start_time optional, but booking.ts's reschedule is only correct
    // when a new start_time is supplied — a date-only reschedule falls
    // back to a tz-edge 00:00 slot and degrades into a misleading
    // slot_conflict. Reject upfront with INVALID_INPUT (HTTP 400 —
    // errors.invalidInput maps to 400 in src/shared/errors.ts; this repo
    // has no 422) before touching booking.ts.
    if (b.start_time === undefined) {
      throw errors.invalidInput("a new start_time is required to reschedule", {
        appointment_id: id,
      });
    }
    // calendarTzFallback ("America/Sao_Paulo"): currently inert — booking.ts
    // re-fetches the calendar timezone and only `void`s this arg. Passed as
    // the plan specifies; documented dead surface to be resolved-or-removed
    // in a future task (do NOT change booking.ts signature here).
    const r = await rescheduleAppointment(organization_id, id, b, "America/Sao_Paulo");
    if (r.status === "slot_conflict") {
      throw errors.conflict("slot_conflict", { appointment_id: id });
    }
    return reply.status(200).send({ appointment_id: r.appointment_id });
  });

  for (const [verb, st] of [
    ["cancel", "cancelled"],
    ["confirm", "confirmed"],
    ["complete", "completed"],
    ["no-show", "no_show"],
  ] as const) {
    app.post(`${B}/appointments/:id/${verb}`, write, async (req, reply) => {
      const { organization_id, id } = calIdParam.parse(req.params);
      const reason = st === "cancelled" ? (cancelBody.parse(req.body ?? {}).reason ?? null) : null;
      return reply.status(200).send(await transitionAppointment(organization_id, id, st, reason));
    });
  }
};

export const calendarRoutes = plugin;
