/**
 * Plugin Fastify — serve OpenAPI spec + Swagger UI em /docs.
 *
 * Espelha a estrutura de `bevox-meta-api` (src/bootstrap/openapi-docs.ts):
 * `@fastify/swagger` em `mode: 'static'` carregando o YAML canônico do
 * disco (sem js-yaml; o plugin parseia). `@fastify/swagger-ui` em /docs.
 *
 * Apenas dev/staging — skip em production (NODE_ENV check). Em prod /docs
 * fica atrás de network policy / proxy interno.
 *
 * Spec canônica: openapi/bevox-backend-v1.yaml (organizationId-only,
 * ADR-021). Mesma fonte que `pnpm openapi:types` consome.
 */

import { fileURLToPath } from "node:url";

import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

import { env } from "@/config/env.js";
import { logger } from "@/shared/logger.js";

export async function registerOpenApiDocs(app: FastifyInstance): Promise<void> {
  const cfg = env();
  if (cfg.NODE_ENV === "production") {
    return; // não expõe /docs em prod
  }

  const specPath = fileURLToPath(new URL("../../openapi/bevox-backend-v1.yaml", import.meta.url));

  try {
    await app.register(swagger, {
      mode: "static",
      specification: { path: specPath, baseDir: "" },
    });
    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", deepLinking: true },
      staticCSP: true,
    });
  } catch (err) {
    logger().warn({ err, specPath }, "OpenAPI docs setup falhou; /docs desabilitado");
  }
}
