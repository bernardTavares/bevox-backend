# bevox-backend — Instruções de projeto

## 1. Identidade

`bevox-backend` é a **API de domínio Bevox** — monolito Fastify que possui
e orquestra o domínio de negócio (organizations, professionals, services,
customers, AISuggestions) e o contrato de execução com o `bevox-harness`.
Escopo desta fase: **Marco 1** do PRD bevox-backend.

Status e versão estão no [`README.md`](./README.md) — não duplicar aqui.
Este arquivo cobre **regras de comportamento** que sobrevivem entre versões.

**Não é** UI. **Não faz** raciocínio de IA (isso é do `bevox-harness`).
**Não é** gateway Meta (isso é da `bevox-meta-api`). **Não é** Company OS /
OpenClaw (infraestrutura interna da empresa, não produto).

## 2. Leitura obrigatória antes de mexer

1. PRD bevox-backend canônico — consume-by-reference (ADR-005):
   `$BEVOX_KNOWLEDGE_PATH/10_prd/bevox-backend/2026-05-15-bevox-backend-prd-v1.md`.
   Fonte canônica de escopo, modelo de dados, contratos, tenancy.
2. ADRs canônicas relevantes: ADR-021 (tenant identity), ADR-013 (auth),
   ADR-012 (stack travada), ADR-008/002 (fronteira de módulo), ADR-005
   (consume-by-reference), ADR-007 (AISuggestion), ADR-011 (execução).
3. `openapi/bevox-backend-v1.yaml` — contratos HTTP formais V1.

Quando a documentação canônica contradiz o código, **a documentação
ganha** — corrija o código. Decisão mudou de fato → ADR superseding no
canon (NÃO fork local da spec).

## 3. Stack — travada por ADR-012

Não trocar sem ADR superseding no canon.

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20+ LTS |
| Linguagem | TypeScript 5.x `strict: true` |
| HTTP | Fastify 5 |
| ORM | Drizzle ORM + drizzle-kit |
| Banco | PostgreSQL 16+ (dedicado) |
| Cache/fila | Redis 7+ (dedicado) |
| Workers | BullMQ 5 |
| Validação | Zod 4 |
| Logging | Pino 9 + AsyncLocalStorage |
| Observabilidade | OpenTelemetry + Sentry |
| Testes | Vitest 4 + testcontainers |
| Pacotes | pnpm 9 |
| Container | Docker (multi-stage) |

Lista completa em `package.json`. `@fastify/swagger` carrega o YAML em
`mode: 'static'` (sem js-yaml).

## 4. Invariantes não-negociáveis

Valem em **todo** request path. Violação exige confirmação humana + ADR.

1. **Tenant = `organizationId` / `organizations`.** TS `organizationId`,
   DB `organization_id`, tabela `organizations`, plugin
   `organization-scope`, path param `:organization_id`. Identidade
   canônica: canon `_shared` / **ADR-021** (aceita; **supersedes
   hub-ADR-003**). O harness é **`organization_id`-native** (ADR-019);
   a ponte `resolveOrganizationId` foi **colapsada** (SP-3 Phase 2). O
   léxico de tenant legado (`workspace_id` / `workspaces`) **NÃO existe
   em lugar nenhum** — nem em schema de dispatch, nem em callbacks, nem
   no DB. **Nunca** introduzir o léxico legado em nenhum arquivo (inclui
   OpenAPI, este CLAUDE.md, README).

2. **Roles de staff = `bevox_admin` | `bevox_support` | `bevox_observer`**
   (ADR-013). Exatamente esses três. Nada de outros nomes.

3. **Schema em `db/schema/` (top-level).** Migrations via
   `drizzle-kit generate`. SQL à mão só com comentário justificando.

4. **Disciplina ADR aceita-vs-proposta.** ADRs **PROPOSED** NÃO são
   settled e NÃO se implementam: ADR-016 (token-billing) ainda é
   PROPOSED — não implementar como se aceita. **ADR-017 (separação
   organizations/staff_accounts) está ACEITA** (canon `aceita_em
   2026-05-18`) e já materializada no schema (`staff_accounts`). Só
   ADR **Aceita** é vinculante; verificar status no canon antes de
   tratar como bloqueio.

5. **Fronteira de módulo (ADR-008/002).** A backend NÃO tem UI, NÃO faz
   raciocínio de IA, NÃO é gateway Meta, NÃO é Company OS / OpenClaw. A
   fronteira backend↔harness **É** o contrato de dispatch/callback
   `organization_id`-native (ADR-019): **sem tradução de tenant** — o
   mesmo UUID de organização trafega ponta-a-ponta, não há ponto de
   tradução.

6. **Consumir o canon por referência (ADR-005).** PRDs/ADRs vivem no
   `bevox-knowledge` (SoT). Nunca forkar specs para dentro deste repo;
   referenciar via `$BEVOX_KNOWLEDGE_PATH`.

7. **UUIDv7 — fonte única `src/shared/uuid.ts`.** Nada de `serial`,
   `uuidv4`, nem o pacote npm `uuid`. IDs primários sempre UUIDv7 via o
   helper interno.

8. **Runtime flat-`dist`.** Produção roda `node dist/index.js` (sem tsx).
   `tsc-alias` reescreve todo specifier `@/...` / `@db/...` para
   relativo; o build-gate `scripts/check-dist-aliases.mjs` falha o build
   se algum alias cru vazar. Não burlar o gate.

## 5. Estrutura de módulo

Padrão por módulo em `src/modules/<nome>/`:

```
routes.ts      # registra rotas Fastify (valida Zod + chama service)
service.ts     # lógica de negócio
repository.ts  # acesso DB via Drizzle (nunca pg cru)
schemas.ts     # Zod (input + output)
```

- Named exports, sem default exports.
- Imports absolutos: `@/modules/...`, `@/plugins/...`, `@/shared/...`.
- Toda input validada com Zod antes da lógica de negócio.
- Toda query/mutação scoped por `organization_id` (plugin
  `organization-scope` — não bypassar).
- Throw `AppError` (via `@/shared/errors.ts`), nunca `throw new Error(str)`.

## 6. Quando agir vs. quando perguntar

| Situação | Ação |
|---|---|
| Endpoint descrito no PRD canônico com task correspondente | Implementar |
| Teste para código existente | Implementar |
| Refatorar dentro de um módulo, sem mudar contrato externo | Implementar |
| Bug com reprodução clara, sem mudar invariante | Corrigir |
| Decisão estrutural não coberta por ADR aceita | **Parar** — propor ADR draft |
| Mudança em invariante (§4) | **Parar** — confirmação humana |
| Implementar ADR PROPOSED (ex.: ADR-016/017) | **Parar** — não é settled |
| Introduzir léxico de tenant legado fora dos 2 arquivos-ponte | **Parar** — quase nunca legítimo |
| Bypass de plugin (auth, idempotency, organization-scope) | **Parar** |
| Adicionar dependência | **Parar** — listar alternativas + justificar |
| Mudar PRDs/ADRs/runbooks (ou forkar spec do canon) | **Parar** — vai pro canon, não pra cá |
| Burlar o alias build-gate | **Parar** — gap no gate é bug, não atalho |

## 7. Comandos rápidos

```bash
pnpm install
docker compose up -d                 # postgres:16 + redis:7
pnpm migrate:up

pnpm dev                             # Fastify watch (tsx)
pnpm start                           # produção: node dist/index.js

pnpm test                            # unit (vitest)
pnpm test:integration                # integração (testcontainers)

pnpm openapi:types                   # gera src/types/api.ts do YAML
pnpm openapi:check                   # valida o YAML

pnpm typecheck
pnpm lint
pnpm format:check
pnpm build                           # tsc + tsc-alias + alias build-gate
```

## 8. Infraestrutura (orientação)

A backend foi desenhada para rodar como **2 réplicas** num cluster na Hetzner Cloud gerenciado por um repositório de infraestrutura separado (privado). O relevante para mexer no código aqui:

- **Imagem em prod:** `ghcr.io/bernardtavares/bevox-backend:vX.Y.Z` (digest pinado no manifest do hub). Build via GHA `release.yml` em tag SemVer.
- **Dois targets no Dockerfile multistage:**
  - `runtime` — compacto, só `dist/` + prod deps. É o que roda em prod.
  - `migrator` — inclui `scripts/`, `db/`, tsx, dev deps. Usado one-shot para migrations e seed-pilot (`mcp.run_migrations`).
- **Postgres em prod requer extensão `pg_uuidv7`** (M0001 faz `CREATE EXTENSION`). Imagem `postgres:16-alpine` pura **não serve** — manifest do hub aponta para `ghcr.io/bernardtavares/bevox-postgres` (pg16 + pg_uuidv7 + pgvector).
- **Seed do piloto:** `scripts/seed-pilot.ts` (idempotente por UPSERT em chave natural). Em prod (`NODE_ENV=production`), `BEVOX_PILOT_STAFF_PASSWORD` é obrigatório; `BEVOX_PILOT_ORG_ID` permite restart-safe / DR drill.
- **Seed-pilot em prod NÃO funciona nem em `runtime` nem em `migrator` image como Dockerfile está hoje.** Causa real (verificado): o stage `migrator` não copia `src/`, e `tsconfig.build.json` exclui `scripts/` do `dist/` — então `tsx scripts/seed-pilot.ts` falha resolvendo `@/db/*` porque o **diretório-alvo do alias não existe na imagem**. `tsx` resolve path-aliases corretamente quando `src/` está presente; **não é** um gap de `tsconfig-paths`. Fix definitivo: copiar `src/` no stage `migrator` OU compilar `scripts/` para `dist/scripts/` removendo da exclusão de `tsconfig.build.json`. (Auditoria 2026-06-02.)
- **MFA do staff seedado pelo `seed-pilot`:** o seed grava `mfa_secret = PILOTSEEDONLYNOTASECRET` esperando que o auth force re-enroll. **O auth atualmente NÃO rejeita esse sentinel — e está correto pelo canon**: MFA TOTP é Marco-3 (PRD §16.3, ADR-013); o login de staff em Marco-1 é password-only por design. O sentinel é inerte mas inofensivo; rotacionar senha staff no 1º login continua sendo boa prática mas não é fix de bug. **Não implementar "rejeitar sentinel antes do JWT" literalmente** — travaria todo login de staff seedado. Real fix vem com MFA TOTP em Marco-3. (Auditoria 2026-06-02.)

Manifest, smoke scripts e runbook: repositório de infraestrutura (privado). Topologia cross-repo: `$BEVOX_KNOWLEDGE_PATH/20_architecture/_shared/runtime-topology.md`.

## 9. Reciprocidade — nunca código de produto no hub

Assim como o hub de governança (`bevox-PRD-consolidation`) não recebe
código de produto, este repo **não** recebe PRD/ADR/auditoria de
governança. Spec é consumida do canon por referência (ADR-005); mudança
de decisão vira ADR no canon, não edição local.

---

**Primeira tarefa ao começar a codificar:** ler o PRD bevox-backend
canônico inteiro + ADR-021 + ADR-013 + ADR-012. Sem isso, o que você
escreve vai conflitar com decisões já tomadas.

## 10. `.claude/` — config Claude Code

Config rastreada do harness do Claude Code neste repo. Bootstrapped em
2026-06-04 (spec:
`bevox-PRD-consolidation/docs/superpowers/specs/2026-06-04-bevox-backend-claude-config-design.md`).

- **`.claude/agents/`** — 8 agents: 4 engineering-* reaproveitados do
  bevox-harness (backend-architect, database-optimizer, security-engineer,
  code-reviewer; cada um com bloco `## Backend context` ao final) + 4
  backend-specific (`backend-route-reviewer`,
  `backend-schema-migration-engineer`, `harness-callback-auditor`,
  `backend-staff-rbac-reviewer`).
- **`.claude/rules/`** — 7 rules path-bound: `backend-tenancy`,
  `backend-routes`, `backend-db`, `backend-workers`, `backend-tests`,
  `backend-harness-contract`, `backend-stack`. Cada uma cita ADRs canon
  aplicáveis.
- **`.claude/skills/`** — 2 skills locais: `bevox-knowledge-contribute`
  (clone do harness; propõe PRD/ADR em canon via worktree
  `bevox-knowledge`) e `backend-module-status` (lê
  `40_roadmap/_shared/delivery-tracker.yml` e reporta status do slot
  bevox-backend).
- **`.claude/hooks/`** — 5 hooks **warn-only** (nunca bloqueiam):
  `SessionStart` (banner: branch, prettier, migration, vizinhos, canon),
  `PreCompact` (snapshot leve em `.claude/state/last-session.md`),
  `PostToolUse-routes/schema/tenancy` (avisos contextuais).
- **`.claude/settings.json`** — permissions allow/deny tunadas
  (`pnpm`, `node`, `tsx`, `git read-only`, `gh pr view/list/checks`,
  `docker compose`); deny em `git push --force*`, `git reset --hard`,
  `Edit/Write(db/migrations/**)`.

Operador local pode copiar `.claude/settings.local.json.example` →
`.claude/settings.local.json` (gitignored) para ajustar model/env.
