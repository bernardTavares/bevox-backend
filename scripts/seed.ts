/**
 * Runner do seed de desenvolvimento. Invocado por `pnpm seed`.
 *
 * Inicializa o client (R3: schema via import dinâmico em initDb), roda
 * `db/seed.ts`, imprime os IDs criados e fecha o pool.
 */

import "dotenv/config";

import { closeDb, initDb } from "@/db/client.js";

import { seed } from "@db/seed.js";

async function main(): Promise<void> {
  const db = await initDb();
  try {
    const result = await seed(db);
    console.log("[seed] OK");
    console.log(`[seed]   organization_id = ${result.organizationId}`);
    console.log(`[seed]   staff_account_id = ${result.staffAccountId}`);
  } finally {
    await closeDb();
  }
}

main().catch((err: unknown) => {
  console.error("[seed] falha:", err instanceof Error ? err.message : err);
  process.exit(1);
});
