/**
 * SSE endpoint (PRD §10.4). Clerk + org-scope; assina o canal Redis da
 * org via conexão dedicada (subscriber monopoliza a conexão), faz fan-out,
 * heartbeat e cleanup no disconnect. bevox-client (a criar) consome.
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { getRedis } from "@/lib/redis.js";
import { realtimeChannel } from "./publish.js";

/**
 * Conjunto module-level de cleanups de conexões SSE ativas. As conexões
 * subscriber (`getRedis().duplicate()`) + intervalos de heartbeat são
 * invisíveis ao machinery de shutdown do Redis (lib/redis.ts) e podem
 * atrasar `app.close()` no SIGTERM. O hook `onClose` abaixo as derruba.
 */
const active = new Set<() => void>();

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Rationale: no shutdown, tear-down de todos os subscribers SSE +
  // intervalos abertos para que `app.close()` não fique pendurado.
  app.addHook("onClose", async () => {
    for (const c of [...active]) c();
  });

  app.get(
    "/api/v1/realtime",
    { preHandler: [app.requireClerkAuth(), app.requireOrganizationScope()] },
    async (req, reply) => {
      const orgId = req.organizationId;
      if (!orgId) {
        // Path normal (não-hijack): Fastify ainda gerencia esta reply.
        return reply.status(403).send({ error: "organization scope required" });
      }

      // Rationale: Fastify 5 — `reply.hijack()` ANTES de escrever em
      // `reply.raw` para assumir o socket cru. Sem isso a reply é
      // contabilizada como não-enviada e os lifecycle hooks se confundem.
      reply.hijack();

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.write(`: connected\n\n`);

      let heartbeat: ReturnType<typeof setInterval> | undefined = undefined;
      let closed = false;

      const sub = getRedis().duplicate();
      // Handler ANTES do subscribe para fechar a janela de mensagem perdida.
      sub.on("message", (_channel, message) => {
        reply.raw.write(`data: ${message}\n\n`);
      });

      const cleanup = (): void => {
        // Run-once: `close` e `error` podem disparar para a mesma request;
        // a 2ª chamada operaria numa conexão já fechando.
        if (closed) return;
        closed = true;
        active.delete(cleanup);
        if (heartbeat) clearInterval(heartbeat);
        void sub.unsubscribe(realtimeChannel(orgId)).finally(() => {
          void sub.quit();
        });
      };

      try {
        await sub.subscribe(realtimeChannel(orgId));
      } catch {
        // Subscribe falhou: não vazar a conexão duplicada nem o socket.
        void sub.quit();
        if (heartbeat) clearInterval(heartbeat);
        reply.raw.end();
        return;
      }

      heartbeat = setInterval(() => {
        reply.raw.write(`: keepalive\n\n`);
      }, 25_000);

      req.raw.on("close", cleanup);
      req.raw.on("error", cleanup);
      active.add(cleanup);

      // Hijacked: NÃO retornar reply. A conexão fica aberta (SSE long-lived).
    },
  );
};

export const realtimeRoutes = plugin;
