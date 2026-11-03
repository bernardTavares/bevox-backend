---
name: backend-routes
glob: "src/modules/**/routes.ts"
description: Fastify route pattern. Zod schema + authz + OpenAPI sync.
priority: 1
---

# Regra: rotas Fastify

Module pattern em `src/modules/<name>/`:

```
routes.ts       — Fastify route registration; thin (declarations only)
schemas.ts      — Zod schemas (request body, query, params, reply)
service.ts      — lógica de negócio
repository.ts   — persistência (Drizzle)
```

## Estrutura de rota

```ts
fastify.post('/customers', {
  schema: { body: CreateCustomerBody, response: { 201: CustomerCreated } },
  preHandler: [requireRole(['bevox_admin', 'support'])],
}, async (req, reply) => {
  const result = await customerService.create(req.body, req.organizationId);
  return reply.code(201).send(result);
});
```

## Authz

- Roles staff Bevox: `bevox_admin` | `support` | `observer` (canon: ADR-022 staff RBAC)
- Cliente-final: JWT Clerk RS256; preHandler resolve `req.organizationId` via `src/integration/resolve-organization-id.ts`
- Callbacks harness: header `X-Execution-Token` validado via plugin `verifyExecutionToken` (rule `backend-harness-contract`)

## OpenAPI sync

- Schemas Zod ↔ OpenAPI gerados via `pnpm openapi:types`
- Após editar rota: rodar `pnpm openapi:types`, revisar diff em `openapi/`, stagear antes de commitar
- Hook `PostToolUse-routes.sh` avisa quando rota é editada sem `openapi/` no stage

## Error mapping

- `@fastify/sensible` para `httpErrors.notFound()`, `badRequest()`, etc.
- 4xx clientes; 5xx infra/lógica. Não vazar stack trace em response.
- Pino loga erro structured antes de responder
