/**
 * Plugin Fastify — telemetria de request.
 *
 * O bootstrap de telemetria a nível de processo (OTel SDK + Sentry) vive
 * em `src/shared/telemetry.ts` e é iniciado em `src/index.ts` antes de
 * qualquer import (espelha `bevox-meta-api/src/lib/telemetry.ts`). Este
 * plugin é o `fastify-plugin` que conecta a telemetria ao ciclo de vida
 * da request:
 *   - propaga `organizationId`/`actorId` descobertos pelos plugins de auth
 *     para o AsyncLocalStorage (correlação em logs/spans fundos).
 *
 * A captura de erros não-tratados (5xx) é dona do
 * `Sentry.setupFastifyErrorHandler` (wired em `bootstrap/server.ts`); este
 * plugin NÃO chama `captureException` no onError para não duplicar eventos.
 *
 * Métricas HTTP (Prometheus) já são coletadas pelos hooks de
 * `bootstrap/server.ts`; aqui não duplicamos.
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { patchContext } from "@/shared/request-context.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Após os preHandlers de auth: se um principal foi resolvido, propaga
  // organization/actor para o contexto async (logs/spans fundos correlacionam).
  app.addHook("preHandler", async (req) => {
    if (req.organizationId) {
      patchContext({ organizationId: req.organizationId });
    } else if (req.auth?.organization_id) {
      patchContext({ organizationId: req.auth.organization_id });
    }

    if (req.auth?.clerk_user_id) {
      patchContext({ actorType: "organization_user", actorId: req.auth.clerk_user_id });
    } else if (req.staff?.staff_id) {
      patchContext({ actorType: "staff", actorId: req.staff.staff_id });
    }
  });
};

export default fp(plugin, {
  name: "telemetry",
  fastify: "5.x",
});
