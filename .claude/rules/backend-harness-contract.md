---
name: backend-harness-contract
glob: "{src/modules/executions/**,src/integration/**,src/modules/orchestration/**}"
description: 4 callbacks harness→backend + X-Execution-Token + payload BullMQ.
priority: 1
---

# Regra: contrato backend↔harness

Fonte canon: ADR-019 (harness, organization_id-native), PRD harness §callbacks, skill `bevox-agent-harness-consumer` (plugin).

## Direção do dispatch

Backend → enfileira job BullMQ → harness consome → processa → callbacks para backend.

## Payload BullMQ (backend dispatch)

Schema em `src/integration/harness-dispatch.schema.ts`. Campos obrigatórios:

- `execution_id: string` (UUIDv7)
- `execution_token: string` (token efêmero; backend valida em callbacks via `X-Execution-Token`)
- `organization_id: string` (UUID; ADR-021 canon)
- `execution_mode: "manual_assisted" | "copilot" | "autonomous_supervised"` (ADR-006)
- `messages: Array<...>` (histórico recente)
- `agent_config: { system_prompt, default_model? }`
- `skills: string[]` (allowlist plana de tool names — PERM-05)
- `account_denied_tools: string[]` (blacklist plana — opcional)

## 4 callbacks que backend EXPÕE

Endpoints em `src/modules/executions/routes.ts`:

| Endpoint | Quando | Body |
|---|---|---|
| `POST /v1/executions/:id/status` | mudança de status (running/done/error/dead_letter) | `{ status, meta? }` |
| `POST /v1/executions/:id/traces` | trace estruturado (tool call, reasoning step) | `{ trace }` |
| `POST /v1/executions/:id/stream` | streaming de tokens LLM | `{ chunk }` |
| `POST /v1/executions/:id/complete` | desfecho terminal | `{ result, proposals?, strategy }` |

Todos validam header `X-Execution-Token`. Token inválido → 401.

## Idempotency

- Backend persiste `Idempotency-Key` em status changes e completions
- harness deriva key via sha256 (ADR-015)
- Dead-letter authoritativa: `executions.status = 'dead_letter'` setada por `worker.on('failed')` na tentativa final (não confundir com `sendComplete(strategy:'failed')` que é semântica diferente)

## Breaking changes

Mudança em campo obrigatório do payload ou shape de callback = breaking → bump major + ADR no canon (`30_adr/_shared/` ou `30_adr/bevox-harness/`).
