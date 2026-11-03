---
name: backend-tenancy
glob: "{src/**,db/**}"
description: Tenant identity = organizationId/organization_id. ADR-021 + UUIDv7 (ADR-016).
priority: 1
---

# Regra: tenant identity

Fonte canon: `_shared/ADR-021` (organization como tenant), `_shared/ADR-016` (UUIDv7).

## Termo canônico

- TypeScript: `organizationId` (camelCase)
- SQL/schema Drizzle: `organization_id` (snake_case)
- Tabela: `organizations`

## Termo proibido em código novo

- `workspace_id` / `workspaces` — retirado pós ADR-021
- `account_id` / `account` — retirado pós ADR-019 (harness); permanece reservado a semântica financeira (Stripe)
- `tenant` como nome de identificador — use `organizationId`

## Bridge legado legítimo (auditoria 2026-06-02)

Apenas estes 2 arquivos podem referenciar `workspace_id`:

- `src/integration/resolve-organization-id.ts` — resolução workspace→organization durante migração
- `src/integration/harness-dispatch.schema.ts` — schema BullMQ legado, removível quando harness sweep do tenancy fechar (SP-3)

Hook `PostToolUse-tenancy.sh` avisa fora desses dois paths.

## UUID

- Novos UUIDs via `src/shared/uuid.ts` (UUIDv7)
- Nunca `crypto.randomUUID()` (UUIDv4) ou `gen_random_uuid()` em código TS novo
- Em migration SQL: extension `pg_uuidv7` está disponível na imagem custom (`ghcr.io/bernardtavares/bevox-postgres`)

## ADRs

- `_shared/ADR-021` — organization como tenant canon (supersedes hub-ADR-003)
- `_shared/ADR-016` — UUIDv7
- ADR-019 (harness) — payload organization_id-native
