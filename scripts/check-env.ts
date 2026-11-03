/**
 * Valida a configuração de ambiente (`@/config/env.js`) e sai 0/1.
 *
 * Uso (CI, pre-deploy, dev sanity):
 *   tsx scripts/check-env.ts
 *
 * Não imprime valores sensíveis — apenas o resultado da validação Zod.
 */

import "dotenv/config";

import { EnvValidationError, loadEnv } from "@/config/env.js";

function main(): void {
  try {
    loadEnv();
    console.log("[check-env] OK — configuração de ambiente válida.");
  } catch (err: unknown) {
    if (err instanceof EnvValidationError) {
      console.error("[check-env] configuração inválida:");
      for (const issue of err.issues) {
        console.error(`  - ${issue.path}: ${issue.message}`);
      }
    } else {
      console.error("[check-env] falha:", err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

main();
