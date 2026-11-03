/**
 * Cliente Drizzle + pool pg do bevox-backend.
 *
 * Inicialização lazy: o pool só é criado na primeira inicialização. Permite
 * importar o módulo em testes sem efeitos colaterais.
 *
 * Acesso ao banco: SEMPRE via `getDb()` ou injeção em service. NÃO criar
 * pools paralelos. Workers e API compartilham a mesma instância.
 *
 * R3 (Task 2 / architecture-reviewer): o schema Drizzle vive em
 * `db/schema/` (top-level, fora do `rootDir:./src` do build flat). Para
 * preservar o contrato de runtime `dist/index.js` plano:
 *   - a TIPAGEM usa `import type` de `@db/schema/index.js` (apagado no emit);
 *   - o VALOR de runtime do schema é carregado por `await import()` dinâmico
 *     dentro de `initDb()` (não há `import * as schema` top-level de `@db/`,
 *     que arrastaria `db/` para fora do build e quebraria o dist plano).
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { env } from "@/config/env.js";

// R3: NÃO há referência de compile-time a `@db/schema` aqui — nem mesmo
// `import type`. Sob `tsconfig.build.json rootDir:./src`, qualquer import
// (inclusive type-only) que o tsc precise RESOLVER puxaria `db/` para fora
// do rootDir e quebraria o `dist` plano (TS6059). O schema relacional
// canônico é injetado APENAS em runtime via `await import()` dinâmico
// dentro de `initDb()`. A tipagem do client usa um schema genérico
// (relational query API tipada não é usada em `src/` no Marco-1: health
// usa `db.execute(sql)`, e `db/seed.ts` — fora do build flat — importa as
// tabelas diretamente de `@db/schema`).
type DbSchema = Record<string, never>;

export type Database = NodePgDatabase<DbSchema>;
export type { DbSchema as schema };

interface DbState {
  pool: Pool;
  db: Database;
}

let state: DbState | null = null;

function buildPoolConfig(): PoolConfig {
  const cfg = env();
  return {
    connectionString: cfg.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // statement_timeout em ms — proteção contra queries lentas em prod.
    statement_timeout: 30_000,
    application_name: cfg.OTEL_SERVICE_NAME,
  };
}

function buildPool(): Pool {
  const pool = new Pool(buildPoolConfig());
  // Erros do pool são fatais para a saúde do processo — propagar para
  // shutdown handler decidir o que fazer.
  pool.on("error", (err) => {
    process.emit("uncaughtException", err);
  });
  return pool;
}

/**
 * Inicializa pool + Drizzle COM o schema canônico. Idempotente.
 *
 * Async porque o schema é carregado via `import()` dinâmico (R3). Chamar
 * uma vez no bootstrap (`src/index.ts`) ANTES de servir tráfego, e no
 * setup de testes integrados após aplicar migrations.
 */
/**
 * Resolve o módulo de schema Drizzle em RUNTIME, cobrindo os dois layouts:
 *   - dist flat (prod, `node dist/index.js`): este arquivo é
 *     `dist/db/client.js`; o schema compilado fica em
 *     `dist/db/schema/index.js` (tsconfig.db.json) → `./schema/index.js`.
 *   - dev/tsx ou vitest: este arquivo é `src/db/client.ts`; o schema vive
 *     no `db/` top-level → `../../db/schema/index.{js,ts}`.
 *
 * Especificador construído em runtime (não literal estático) DE PROPÓSITO:
 * impede o `tsc` de resolver `@db/*` sob `rootDir:./src` (TS6059) e
 * mantém o `dist/index.js` plano (R3). O grafo de tipos usa schema
 * genérico (ver acima); o schema relacional real entra só aqui.
 */
async function loadSchema(): Promise<Record<string, unknown>> {
  const here = fileURLToPath(import.meta.url);
  const dir = here.slice(0, here.lastIndexOf("/"));
  const candidates = [
    `${dir}/schema/index.js`, // dist flat: dist/db/schema/index.js
    `${dir}/../../db/schema/index.js`, // dev compilado hipotético
    `${dir}/../../db/schema/index.ts`, // tsx/vitest: db/ top-level (.ts)
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return (await import(pathToFileURL(c).href)) as Record<string, unknown>;
    }
  }
  throw new Error(`[db] schema Drizzle não encontrado. Tentado: ${candidates.join(", ")}`);
}

export async function initDb(): Promise<Database> {
  if (state !== null) return state.db;

  const schema = await loadSchema();
  const pool = buildPool();
  // Cast: o schema relacional canônico é injetado em runtime; a tipagem
  // pública (`Database`) usa schema genérico por R3 (sem ref de
  // compile-time a `@db/*`). A relational query API tipada não é usada
  // em `src/` no Marco-1.
  const db = drizzle(pool, { schema, casing: "snake_case" }) as unknown as Database;
  state = { pool, db };
  return db;
}

/**
 * Retorna a instância Drizzle. Requer `initDb()` previamente resolvido
 * (chamado no bootstrap). Fallback síncrono: se ainda não inicializado,
 * cria pool + drizzle SEM o schema relacional (query builder cru ainda
 * funciona); o caminho normal sempre passa por `initDb()` no boot.
 */
export function getDb(): Database {
  if (state !== null) return state.db;
  const pool = buildPool();
  const db = drizzle(pool, { casing: "snake_case" }) as Database;
  state = { pool, db };
  return db;
}

/**
 * Expõe o pool para health checks e shutdown. Não usar para queries —
 * use `getDb()`.
 */
export function getPool(): Pool {
  if (state === null) getDb();
  return state!.pool;
}

/**
 * Fecha o pool. Idempotente. Chamado pelo shutdown handler.
 */
export async function closeDb(): Promise<void> {
  if (state === null) return;
  const { pool } = state;
  state = null;
  await pool.end();
}

/**
 * Para uso EXCLUSIVO em testes — reseta estado interno sem fechar pool.
 * Em testes integrados, prefira `closeDb()`.
 */
export function __resetDbStateForTests(): void {
  state = null;
}
