/**
 * C2 Google — endpoints PÚBLICOS (sem Clerk):
 *   GET  /api/v1/webhooks/google/callback  — redirect OAuth (browser)
 *   POST /api/v1/webhooks/google           — push notification do Google
 *
 * O callback é um endpoint de redirect de BROWSER: H3 — qualquer erro vira
 * `reply.redirect(<successUrl com ?status=error>)`, NUNCA JSON 4xx cru na
 * cara do usuário. O POST é o canal de push: autenticado por HMAC
 * (channel-token = HMAC(GOOGLE_WEBHOOK_SECRET, channelId)), timing-safe,
 * mesmo idioma de ingestion (buffer scoped, timingSafeEqual equal-length).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { env } from "@/config/env.js";
import { getGoogleIncrementalQueue } from "@/lib/queues.js";
import { logger } from "@/shared/logger.js";

import { GOOGLE_INCREMENTAL_SYNC_QUEUE } from "./constants.js";
import { armWatch, runInitialSync } from "./sync.js";
import { handleCallback } from "./oauth.js";
import * as repo from "./repository.js";

/** URL de erro p/ o browser (H3): successUrl com ?status=error. */
function errorRedirectUrl(): string {
  const u = new URL(env().CALENDAR_OAUTH_SUCCESS_URL);
  u.searchParams.set("status", "error");
  return u.toString();
}

function timingSafeStrEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Push do Google manda corpo JSON (sync ping ou resource change). Não
  // assinamos o body — a autenticação é o channel-token no header. Buffer
  // scoped ao plugin (idioma ingestion; sem mudança global).
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  // ── GET callback (browser redirect; H3: nunca JSON cru) ──────────────
  app.get("/api/v1/webhooks/google/callback", async (req, reply) => {
    try {
      const q = (req.query ?? {}) as { code?: unknown; state?: unknown };
      const code = typeof q.code === "string" ? q.code : "";
      const state = typeof q.state === "string" ? q.state : "";
      if (!code || !state) {
        return reply.redirect(errorRedirectUrl());
      }
      const { connectionId, successUrl } = await handleCallback(code, state);
      // Best-effort: armar watch + initial sync. Falha aqui NÃO quebra o
      // redirect — o cron de safety/renewal recupera.
      try {
        await armWatch(connectionId);
        await runInitialSync(connectionId);
      } catch (err) {
        logger().warn(
          { connId: connectionId, err_name: err instanceof Error ? err.name : "unknown" },
          "google callback: arm/initial-sync best-effort failed",
        );
      }
      return reply.redirect(successUrl);
    } catch (err) {
      // H3: AppError/qualquer throw → redirect de erro, nunca 4xx JSON.
      logger().warn(
        { err_name: err instanceof Error ? err.name : "unknown" },
        "google oauth callback failed",
      );
      return reply.redirect(errorRedirectUrl());
    }
  });

  // ── POST push notification (Google → backend) ────────────────────────
  app.post("/api/v1/webhooks/google", async (req, reply) => {
    const h = req.headers;
    const channelId = (h["x-goog-channel-id"] as string | undefined) ?? "";
    const channelToken = (h["x-goog-channel-token"] as string | undefined) ?? "";
    const resourceId = (h["x-goog-resource-id"] as string | undefined) ?? "";
    const resourceState = (h["x-goog-resource-state"] as string | undefined) ?? "";
    const messageNumber = (h["x-goog-message-number"] as string | undefined) ?? "";

    if (!channelId || !channelToken) {
      return reply.status(400).send({ error: "missing channel headers" });
    }

    const expected = createHmac("sha256", env().GOOGLE_WEBHOOK_SECRET ?? "")
      .update(channelId)
      .digest("hex");
    if (!timingSafeStrEq(expected, channelToken)) {
      return reply.status(401).send({ error: "invalid channel token" });
    }

    const conn = await repo.findConnectionByWatchChannel(channelId);
    if (!conn) {
      return reply.status(404).send({ error: "unknown channel" });
    }

    // Audit-only (#2): google_calendar_webhook_events não tem unique
    // constraint e o Google entrega at-least-once → duplicatas aqui são
    // aceitáveis (log de auditoria). NÃO multiplica runs de incremental
    // porque o enqueue abaixo usa jobId=conn.id (BullMQ deduplica
    // in-flight per-connection); sem migração nova.
    await repo.insertWebhookEvent({
      connectionId: conn.id,
      channelId,
      resourceId,
      resourceState,
      messageNumber,
    });

    // Handshake inicial do watch: 'sync' não é mudança de recurso.
    if (resourceState === "sync") {
      return reply.status(200).send({ ok: true });
    }

    // jobId = conn.id → BullMQ colapsa entregas duplicadas/concorrentes do
    // Google numa única execução de incremental (defesa em profundidade
    // junto com withConnectionLock no worker — #1/#2).
    await getGoogleIncrementalQueue().add(
      GOOGLE_INCREMENTAL_SYNC_QUEUE,
      { connectionId: conn.id },
      { jobId: conn.id },
    );
    return reply.status(200).send({ ok: true });
  });
};

export const googleWebhookRoutes = plugin;
