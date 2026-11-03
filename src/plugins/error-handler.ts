/**
 * Plugin Fastify — wrapper do error handler global.
 *
 * Espelha o split do bevox-meta-api: a lógica de mapeamento de erro vive
 * em `src/bootstrap/error-handler.ts` (PRD bevox-backend §9.4); este
 * plugin é o `fastify-plugin` que a registra (`setErrorHandler` +
 * `setNotFoundHandler`), para que possa ser composto na cadeia de plugins
 * cross-cutting de forma uniforme.
 */

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { errorHandler } from "@/bootstrap/error-handler.js";

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.setErrorHandler(errorHandler);

  app.setNotFoundHandler(async (req, reply) => {
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Route ${req.method} ${req.url} not found`,
        request_id: req.id,
      },
    });
  });
};

export default fp(plugin, {
  name: "error-handler",
  fastify: "5.x",
});
