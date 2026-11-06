---
name: bevox-backend-consumer
description: Use ao integrar um projeto da família Bevox (harness, painel staff, web, mobile) com a bevox-backend — API de domínio Bevox (organizations, professionals, services, customers, AISuggestions, callbacks de execução do harness). Cobre os 3 modelos de auth (JWT Clerk cliente-final, JWT staff Bevox, X-Execution-Token), o scoping por organization, e o contrato harness↔backend (dispatch BullMQ + 4 callbacks). NÃO use para a bevox-meta-api (WhatsApp/Instagram) — essa tem skill própria.
---

# bevox-backend — Consumer Integration Skill

Você está em um projeto da família Bevox que precisa falar com a
`bevox-backend` — o **monolito Fastify de domínio Bevox** (Marco 1). Ela é
dona de `organizations`, `professionals`, `services`, `customers`,
`AISuggestions` e do contrato de execução com o `bevox-harness`.

Fonte canônica: PRD bevox-backend (consume-by-reference, ADR-005:
`$BEVOX_KNOWLEDGE_PATH/10_prd/bevox-backend/2026-05-15-bevox-backend-prd-v1.md`)
e a spec formal `openapi/bevox-backend-v1.yaml` neste repo. **Em caso de
conflito entre esta skill e as fontes canônicas, as fontes ganham** — abra
issue.

## Quando usar esta skill

- O `bevox-harness` está despachando/concluindo execuções contra a backend.
- O painel staff (staff Bevox) precisa de sessões staff / impersonation.
- O `bevox-client` (web/mobile) faz CRUD de organization e sub-recursos.
- Você está debugando 401/403 ao falar com a backend.

## Quando NÃO usar

- Integração WhatsApp/Instagram → use a skill `bevox-meta-api-consumer`.
- Você está modificando a própria `bevox-backend` → leia o PRD canônico +
  `CLAUDE.md` deste repo + ADRs.

## Modelo mental em 30 segundos

```
bevox-client (web/mobile) ──Clerk JWT──┐
painel staff              ──staff JWT──┤──► bevox-backend ──BullMQ──► bevox-harness
bevox-harness (callbacks) ─X-Exec-Tok──┘        ▲                          │
                                                └──── 4 callbacks ─────────┘
```

- **Tenant:** tudo é scoped por `organization` (UUIDv7). Path param =
  `:organization_id`. Identidade canônica `organizationId` — canon
  `_shared` / ADR-021 (aceita; supersedes hub-ADR-003).
- **Sem domínio externo aqui:** WhatsApp/Instagram são da meta-api;
  raciocínio de IA é do harness. A backend orquestra e persiste domínio.

## Os 3 modelos de autenticação

| Consumidor | Esquema | Header | Notas |
|---|---|---|---|
| `bevox-client` (cliente-final) | `clerkBearer` | `Authorization: Bearer <JWT Clerk>` | Usuário do produto. JWKS Clerk valida. |
| painel staff (staff Bevox) | `staffBearer` | `Authorization: Bearer <JWT staff HS256>` | Roles `bevox_admin` \| `bevox_support` \| `bevox_observer` (ADR-013). Sessão via `POST /api/v1/staff/sessions`; refresh rotativo. |
| `bevox-harness` (callbacks) | `executionToken` | `X-Execution-Token: <token efêmero>` | Token por execução; só os 4 callbacks `/api/v1/executions/:id/*`. |

Rotas de mutação sensíveis (pagamentos, reembolsos, agendamentos) aceitam
`Idempotency-Key` (plugin opt-in por rota); envie-o sempre em mutações. Endpoints scoped exigem `:organization_id` no path; o
plugin `organization-scope` rejeita acesso fora do escopo do principal.

## Superfície (Marco 1)

- **Health:** `GET /healthz`, `GET /readyz`, `GET /metrics` (sem auth).
- **Staff:** `POST /api/v1/staff/sessions`, `.../sessions/refresh`,
  `.../impersonation/:organization_id/start|end`.
- **Webhook Clerk:** `POST /api/v1/webhooks/clerk` (verificação Svix).
- **CRUD scoped por organization** sob
  `/api/v1/organizations/:organization_id/*`: organization + `settings` +
  `users` + `onboarding` + `onboarding/advance`; `professionals`;
  `services` (+ `services/:id/professionals`); `customers`. Mais
  `customers/:id/profile` e `customers/:id/facts`.
- **Aprovações:** `GET /api/v1/organizations/:organization_id/executions`
  e `POST .../executions/:id/approve | /edit | /reject`. Uma execução em
  `waiting_approval` só age após decisão humana; propostas de cobrança ou
  reembolso sempre exigem aprovação.
- **Callbacks do harness:** `PATCH /api/v1/executions/:id/status`,
  `POST .../traces`, `POST .../stream`, `POST .../complete`.

Lista formal completa (request/response) em `openapi/bevox-backend-v1.yaml`.

## Contrato harness ↔ backend

**Dispatch (backend → harness):** a backend cria a row `executions` e
enfileira em BullMQ na fila `bevox.execution.dispatch` (jobId =
`execution_id`, enqueue idempotente). O payload espelha PRD §10.4
`DispatchPayload`.

**Callbacks (harness → backend):** o harness autentica via
`X-Execution-Token` e chama os 4 endpoints acima. `status` aplica a
transição de estado, `traces` persiste os traces, `stream` publica chunks em
tempo real e `complete` entrega o resultado ou o retém em
`waiting_approval`, conforme o modo de autonomia. O token é amarrado à
própria execução: `:id` diferente do da execução do token → 403.

### Nota de fronteira — contrato harness `organization_id`-native

A backend é **`organizationId`-nativa** (ADR-021) e o contrato
backend↔`bevox-harness` é **`organization_id`-native** (ADR-019): o
dispatch e os callbacks emitem/leem `organization_id` (UUID)
**diretamente, sem tradução de tenant**. A ponte `resolveOrganizationId`
foi **colapsada** (SP-3 Phase 2) e não existe mais. O léxico de tenant
legado (`workspace_id`) **não aparece em lugar nenhum**. Consumidores
falam `organization_id` com a backend.

## Regras invioláveis (5)

1. **`organization_id` é o eixo de tenancy.** Endpoint scoped sem o path
   param correto = 403. Nunca tente acessar dados cross-organization.
2. **Envie `Idempotency-Key`** em toda mutação, derivado de evento de
   domínio (não aleatório).
3. **Use o auth certo para o seu papel.** Cliente-final = Clerk JWT; staff
   = staff JWT; harness callback = `X-Execution-Token`. Nunca cruze.
4. **JWT staff tem vida curta** (access ~900s) + refresh rotativo. Não
   cache token expirado.
5. **Não fale o léxico de tenant legado com a backend.** A ponte é interna
   ao harness↔backend; o fio público é `organization_id`.

## Fonte canônica e versionamento

Esta skill é **derivada** de:

- PRD bevox-backend canônico (consume-by-reference, ADR-005).
- `openapi/bevox-backend-v1.yaml` (contratos formais V1, neste repo).
- ADRs: ADR-021 (tenant identity / rename), ADR-013 (Clerk cliente-final +
  staff JWT), ADR-007 (AISuggestion aprovação humana), ADR-011 (execução /
  callbacks), ADR-005 (consume-by-reference), ADR-008/002 (fronteira de
  módulo).

Quando a backend lança nova versão, atualizar esta skill é parte do mesmo
PR. **Em caso de conflito entre skill e fontes canônicas, as fontes
ganham** — abra issue.
