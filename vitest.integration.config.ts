import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config dedicada de integração. Execução via `pnpm test:integration`.
 *
 * Esses testes:
 *   - Sobem Postgres + Redis via testcontainers (precisa Docker).
 *   - Aplicam migrations do projeto.
 *   - Boot um Fastify server real ou cliente HTTP contra ele.
 *
 * Em CI, rodar atrás de feature flag para evitar custo em PR comum.
 */

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/", import.meta.url)),
      "@db": fileURLToPath(new URL("./db/", import.meta.url)),
    },
  },
});
