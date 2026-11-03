---
name: backend-workers
glob: "src/queue/**"
description: BullMQ workers. Idempotency, retries, observabilidade.
priority: 1
---

# Regra: BullMQ workers

## Idempotency

- Dedup key content-derived: `sha256(execution_id : step_index : tool_name : canonical(params))` (ADR-015)
- Nunca UUID aleatório como dedup key
- Worker valida via Zod no entry; payload Zod-inválido lança `UnprocessablePayloadError` (NÃO retorna silenciosamente)

## Retries

- Backoff exponencial; máx 7 tentativas para transientes (alinhado com harness)
- Não-retryable: `UnprocessablePayloadError`, ceiling de custo, cancel explícito
- Final attempt falha → handler escreve `status='dead_letter'` na tabela authoritativa do backend (NÃO fila BullMQ dedicada)

## Observabilidade

- Pino structured logs (`logger.info`, `logger.warn`, `logger.error`); nunca `console.log`
- Redact de PII (mensagens, telefones, emails) via `pino` redact patterns no logger global
- OpenTelemetry spans por job; metric counters em `src/shared/metrics.ts`
- Errors em job final-attempt → `logger.error` (level 50), não `fatal`

## Schema versionado

- Payload schema versionado em `src/integration/harness-dispatch.schema.ts`
- Mudança em campo obrigatório = breaking → bump major + ADR no canon
- Mudança em campo opcional = minor

## Referências canon

- ADR-015 — Idempotency Key content-derived
- ADR-019 (harness) — payload organization_id-native + execution_mode
- Skill `bevox-agent-harness-consumer` (plugin) — referência completa de payload/callbacks
