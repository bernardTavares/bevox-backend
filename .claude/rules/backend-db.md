---
name: backend-db
glob: "{db/**,src/db/**,drizzle.config.ts}"
description: Drizzle schema em db/schema/. Migration via drizzle-kit generate. UUIDv7.
priority: 1
---

# Regra: DB schema e migrations

## Schema

- Declarado em `db/schema/*.ts` (Drizzle)
- Um arquivo por agregado/módulo (`customers.ts`, `organizations.ts`, `executions.ts`, ...)
- Nunca espalhar schema em `src/`

## Migrations

- Geradas via `pnpm migrate:generate <descricao>` (drizzle-kit generate)
- **Nunca editar SQL gerado manualmente** — settings.json tem deny em `Edit(db/migrations/**)` e `Write(db/migrations/**)`
- Convenção de nome: `NNNN_<slug>.sql` sequencial (drizzle-kit cuida do número)
- Migration metadata-only (rename, drop legacy): aceitável (ex.: `0014_renamed_chatwoot_to_channel.sql`)

## Postgres extensions

- `pg_uuidv7` — UUIDv7. Imagem custom obrigatória (`ghcr.io/bernardtavares/bevox-postgres@sha256:...`)
- **Não usar** `postgres:16-alpine` puro — falta a extension

## FK + indexes

- Toda FK tem index (perf)
- Tenant scope: tabelas com dados de cliente têm `organization_id uuid not null references organizations(id) on delete restrict` + index composto `(organization_id, ...)`
- Soft-delete via `deleted_at timestamptz` quando audit trail é requerido (ADR-020 retention)

## Apply em prod

- Migrator image separada: `ghcr.io/bernardtavares/bevox-backend:migrator-<version>`
- Runtime image NÃO contém `scripts/` — para `seed-pilot.ts` em prod usar migrator image
- Bug conhecido (CLAUDE.md §8): migrator stage não copia `src/` → `tsx scripts/seed-pilot.ts` falha resolvendo `@/db/*`. Workaround atual: `.mjs` ad-hoc importando de `dist/`
