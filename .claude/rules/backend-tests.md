---
name: backend-tests
glob: "test/**"
description: vitest + testcontainers para integration. Sem mock de DB.
priority: 1
---

# Regra: testes

## Estrutura

- `test/unit/` — mocks de colaboradores externos aceitáveis (HTTP, Redis cliente, etc.)
- `test/integration/` — **testcontainers obrigatório** (Postgres + Redis live)

## Vitest

- Config: `vitest.config.ts` (unit), `vitest.integration.config.ts` (integration)
- Run: `pnpm test`, `pnpm test:watch`, `pnpm test:integration`

## Por que sem mock de DB em integration

Histórico: mock de DB já mascarou divergência prod/migration (incidente cross-org pré-2026). Integration test DEVE bater no Postgres real via testcontainers — caso contrário não é integration, é unit com extra steps.

## FK seeding em integration

- Pattern: helper `seedFkBase()` em `test/integration/helpers/` cria `organizations` + `staff_accounts` mínimos antes de cada suite
- Debt conhecido: `test/integration/harness-contract` tem 5 falhas FK (issue #36, memória `[[harness-contract-test-fk-seeding-gap]]`)

## Coverage

- Gate opt-in (não bloqueia CI hoje)
- Aspiração: cobertura ≥ 70% em `src/modules/*/service.ts` e `src/integration/`

## CI

- Workflow `.github/workflows/ci.yml` — lint + format check + unit
- Integration test roda em ambiente com Docker disponível
- Memória `[[backend-ci-historically-red]]`: main já ficou 50+ runs red pré 2026-06-02. Verificar `gh pr checks <#>` antes de aprovar PR
