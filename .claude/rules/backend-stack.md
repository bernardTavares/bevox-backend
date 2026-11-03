---
name: backend-stack
glob: "{package.json,pnpm-lock.yaml,Dockerfile,tsconfig*.json,vitest.config.ts,drizzle.config.ts,eslint.config.js,.prettierrc*}"
description: Stack travada. Sem nova dep sem ADR.
priority: 1
---

# Regra: stack

Fonte canon: ADR-008 (stack lock), ADR-012 (consumption boundary), CLAUDE.md §3-4.

## Stack travada

- **Runtime:** Node ≥ 20, pnpm ≥ 9
- **Module system:** ESM (`"type": "module"`)
- **HTTP:** Fastify 5 (+ helmet, rate-limit, cors, sensible, swagger)
- **ORM:** Drizzle 0.45.x (+ drizzle-kit 0.31.x)
- **DB:** PostgreSQL 16 com extension `pg_uuidv7`
- **Queue:** BullMQ 5 + ioredis (Redis 7)
- **Validation:** Zod 4
- **Logging:** Pino 9 + OpenTelemetry
- **Auth:** jose (JWT), bcrypt (legacy só), Clerk SDK
- **Test:** Vitest 4 + testcontainers 11
- **Lint/format:** eslint + prettier (config no repo)

## Build

- TypeScript 5 strict
- `pnpm build`: `tsc` + `tsc-alias` + `build-gate` (check de path-alias leakage em `dist/`)
- Output: **flat dist** (sem aliases `@/*`, `@db/*` em runtime)

## Adicionar dep nova

- Sem ADR canon = bug
- Path:
  1. Spec em `docs/superpowers/specs/` justificando
  2. ADR proposta no canon (`30_adr/bevox-backend/` ou `30_adr/_shared/` se cross-repo)
  3. Aprovação founder
  4. `pnpm add`
- Skill `bevox-knowledge-contribute` ajuda a propor a ADR

## Imagens Docker

- Runtime: `ghcr.io/bernardtavares/bevox-backend:<version>` (multi-stage, sem `src/` no final)
- Migrator: `ghcr.io/bernardtavares/bevox-backend:migrator-<version>` (com `dist/` + scripts compilados; bug atual: não copia `src/`)
- Postgres custom: `ghcr.io/bernardtavares/bevox-postgres` (com `pg_uuidv7` + `pgvector`)
