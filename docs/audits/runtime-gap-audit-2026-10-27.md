# Gap Analysis — bevox-backend — 2026-10-27

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo segundo a
> documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais — `harness-callback-auditor`,
> `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`, `backend-route-reviewer`, `Security Engineer` —
> + 2 `general-purpose` para LGPD e pilot/calendar/obs), cada um re-verificando **de fonte primária** o inventário do
> 10-26 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** superestimações (com a
> lista explícita de refutados/de-escalados a NÃO re-flagar) + caçar misses; **verificação independente de
> fonte-primária pelo orquestrador** dos ~18 achados-âncora + CI/canon/governança; e **CI rodado de fato** (2026-10-27
> ~09:00–09:15 UTC, não inferido). Sucede `runtime-gap-audit-2026-10-26.md`.

## Resumo executivo

**15ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,8
meses — e nesta passada nada mudou em lugar nenhum.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é
**vazio** (produto byte-idêntico a `dbd231e`, 2026-06-03; `git describe` = `v1.0.1-37-g90703fb`, o `-37` são commits de
audit docs-only — era `-36` no 10-26). Canon `bevox-knowledge origin/main` @ `7874971` (06-03), `bevox-harness
origin/main` @ `2979eb0` (06-03), `bevox-meta-api origin/main` @ `5516c2a` (06-22), hub `bevox-PRD-consolidation
origin/master` @ `fd1373b` — **todos inalterados vs 10-26**. Os 7 auditores + o orquestrador **confirmaram o inventário
do 10-26** com **ZERO refutações de código (6ª passada consecutiva: 10-22..10-27)**, **~16 misses/sharpenings NOVOS**
(todos latentes / by-design-adjacent / governança — nenhum piloto-bloqueador novo), **5 refutações adversariais de
claims-novos-plausíveis** (evidência negativa fresca), e várias correções de linha/contagem.

**Principais riscos (inalterados):** o piloto **morre no passo 2 ("ver agenda")** — não é executável como semeado.
Dois CRÍTICOs de agenda persistem há ~4 meses (grade semanal sem escritor app-wide + seed sem Calendar), atrás de um
gate de **auth-actor** (seed cunha JWT staff HS256; todo calendar/money exige Clerk RS256 → 401). O money-path manual
**funciona** (ADR-023 aceita) mas não é hands-off-seedável e carrega 1 bug HIGH **irreversível** (re-mark órfão). E o
único bloqueador **mensurável** de Marco-1 pelo canon (PRD §16.1 l.1483 "CI verde") segue **RED** em 2 dos 3 sinais.

**Manchete-delta — 3ª passada consecutiva com delta mensurável ~zero nos sinais de CI; e 1 correção de governança:**
- **Security:** `pnpm audit --audit-level high` = **RED, 115 vulns / 10 low · 55 moderate · 50 high · 0 critical** →
  **byte-idêntico ao 10-26, 10-25 e 10-24, agora ao nível de módulo**: exatamente os **mesmos 19 módulos-high**
  (`@fastify/static`, `@grpc/grpc-js`, 4×`@opentelemetry/*`, `brace-expansion`, `fast-uri`, `fastify`, `find-my-way`,
  `js-yaml`, `nanoid`, `postcss`, `protobufjs`, `source-map-js`, `tmp`, `undici`, `vite`, `zod`), com `zod@4.4.3`
  direct-prod (GHSA exaustão-memória `<4.6.6`) permanente. **4ª passada no platô. Tendência 12→15→18→49³→50⁴.**
- **Tests:** `pnpm test:integration` = **RED exit 1**, `1 failed | 92 passed (93)` — o mesmo flaky dependente de
  hora-do-dia `calendar-booking.test.ts:259` (rodei 09:04 UTC < gate ~13:00 UTC → `booked`), **com 2× teardown `57P01`**
  (idêntico ao 10-26). Fast-gate **GREEN** (Typecheck/Format/OpenAPI-parse/Build+alias-gate/Unit **469/469, 69 files**).
- **scheduled CI — correção do 10-26:** o 10-26 flagou "o slot seg-cron de 10-26 não produziu run algum até 09:04 UTC
  (possível aprofundamento p/ não-agenda)". **Isso era prematuro:** o slot de seg-10-26 **de fato rodou** — apenas
  **atrasado ~5,5h** (run `40316135563` às **11:34 UTC**, `startup_failure 0s`). Ou seja, os workflows agendados
  **continuam disparando (com atraso) e continuam `startup_failure`** — **não** foram auto-desabilitados/silenciados.
  Janela `startup_failure` ininterrupta **09-22→10-26**; último run agendado que executou de verdade = Security `failure`
  09-21 (CodeQL success 09-15). O slot ter-cron de **hoje (10-27)** ainda não apareceu às 09:15 UTC (consistente com o
  atraso observado). ~5 semanas sem scanner agendado real.

**Os achados NOVOS mais consequentes desta passada** (entendimento mais fundo sobre código congelado, não regressões):
1. **Money-bug #1 tem uma raiz estrutural ÚNICA** que também atinge o **webhook Stripe**: `markChargePaid`/
   `markChargeExpired`/`markChargeRefunded` (`repository.ts:395-413`) são `Promise<void>` **sem `RETURNING`** → nenhum
   caller **pode** gatear efeitos no rowcount; `applyChargePaid` é invocado tanto por `markChargePaidManually` quanto
   por `payment_intent.succeeded` (`webhook-platform.ts:107-120`) → re-mark pós-reversal manufatura órfão `paid` nos
   **dois** caminhos; e `expireChargeManually` **audita falso** (`charge.expired_manual` enquanto a charge já é `paid`
   no perdedor da corrida). **1 ponto de fix fecha 3 superfícies.**
2. **O `message_id`-poison é o PORQUÊ de o harness ser inerte no piloto:** `buildDispatchMessages` seleciona a coluna
   **errada** (`external_message_id` em vez do PK `id`) → `DispatchPayloadSchema.parse` ZodErra 100% das dispatches **antes
   do enqueue** → nenhuma execução de IA chega ao harness. É **pilot-reachable** (qualquer inbound real → falha total) e
   **causa** o orphan-`pending` (#9) + **mascara** unbounded/active_execution_id/skills. Só **1 dos 4 callbacks** está
   vivo no harness atual (`/status`=404-método, `/traces`=sem-produtor, `/stream`=desligado; só `/complete` executa).
3. **O worker é um buraco-negro de observabilidade com mecanismo concreto:** `prom-client` registry é singleton
   **por-processo**; o reconcile incrementa counters **no processo worker** mas `/metrics` é servido **só pelo processo
   HTTP** → counters do worker são **estruturalmente inscrapáveis** e aparecem flat-0 para sempre; `/readyz` checa
   PG+Redis mas **não** a liveness do worker (sem porta) → worker morto é invisível enquanto o HTTP reporta `ready`.

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária esta sessão (repetem-se vs 10-26 porque o brief é o mesmo):

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`) — **não** `/complete,/artifact,/tool-result,/turn`
   como o brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (**aceita**), **não "channels"**. **Channels =
   _shared/ADR-011.** backend/ADR-018 = refund/cancellation (**aceita**). O range "0011 a 0018 Marco-1" do brief é
   aproximado; as ADRs aceitas **vinculantes** vão até 0023 (009/010/013/014/018/019/020/021/022/023 = `aceita`;
   016 token-billing = `proposed` → corretamente NÃO implementado; 011 = `Superseded by ADR-019`). Lido de `origin/main`.
3. O grep `account_id\b` do brief captura centenas de ocorrências em `src/`/`db/`, **todas sancionadas**: composites
   `external_account_id`/`payment_account_id`/`channel_account_id`, o alias financeiro `AS account_id`, a propriedade
   Stripe `res.accountId` (semântica financeira reservada por ADR-021/019), doc-comments do rename, e snapshots
   drizzle/tipo gerado. O léxico proibido **executável** é **ZERO**; os 3 hits "crus" de `workspace_id`/`workspaces` são
   **doc-comments** explicando o rename (`autonomy/routes.ts:5`, `organizations/routes.ts:3`, `db/schema/autonomy.ts:3`).
   Invariante §4.1 mantida — **não-gap**. Ver categoria c.
4. **MFA sentinel (categoria d) — não há bug a corrigir.** `CLAUDE.md §8 l.171` afirma que o seed grava `mfa_secret =
   PILOTSEEDONLYNOTASECRET` — **factualmente stale**: o seed hoje chama `generateMfaSecret()` (base32 160-bit,
   `scripts/seed-pilot.ts:153`) + `assertMfaSecretNotPlaceholder()` (`:154`), que **rejeitaria** o sentinel literal; o
   sentinel só aparece como **comentário** (`src/shared/mfa.ts:66`) e no blocklist (`mfa.ts`). Login staff sem MFA é
   **correto** (TOTP é Marco-3, PRD §16.3/ADR-013; `auth/service.ts:84-87`). **NÃO implementar "rejeitar o sentinel antes
   do JWT"** (travaria todo login de staff semeado) — e é moot, pois o seed não grava mais o sentinel. Fix de código =
   **0h**; o único resíduo é corrigir a prosa de `CLAUDE.md §8` (vai pro doc, não é bug).
5. **A premissa da categoria i do brief está stale.** O brief diz "Tests (harness-contract FK seeding, issue #36)" e
   "Lint & Format (prettier debt)". Ambos **resolvidos**: `test/integration/harness-contract.test.ts` **passa 12/12**
   nesta sessão (issue #36 está **OPEN mas efetivamente resolvida** — o teste que ela descreve passa); `pnpm format:check`
   = **GREEN** (prettier debt limpo em `0996772`). O **Tests-RED atual é o flaky `booking_notice:259`** (hora-do-dia),
   **não** #36; e o **Security-RED** é o `pnpm audit` (50 high). Ver categoria i.
6. Código congelado desde **06-03** (`dbd231e`), não 06-04. **RBAC de staff é canon backend/ADR-013** (roles
   `bevox_admin|bevox_support|bevox_observer`), **não ADR-022** (backend/ADR-022 = `policy-json-sub-keys`). Numeração de
   ADR **colide** entre `backend/` e `_shared/` (008–023) — sempre qualificada abaixo.
7. O `status`-callback **não é** drift de OpenAPI: é **PATCH** no YAML **e** no handler (`routes.ts:56`) — concordam. A
   quebra POST-vs-PATCH é **cross-repo** (harness POSTa) — categoria l, não b.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1481-1487)** — lido verbatim de `origin/main`: `CI verde`; migrations pg16;
  módulos auth/organizations/users/professionals/services/customers; OpenAPI publicado; contrato harness testado com stub;
  deploy staging. **Tudo entregue EXCETO "CI verde"** → o único bloqueador **mensurável** de Marco-1 é **CI-verde** (RED
  em Tests + Security). Os demais itens têm evidência verde (migration.test ✓, módulos presentes, OpenAPI publicado,
  harness-contract.test 12/12 ✓).
- **§16.2 Marco-2** (calendar, conversations, messages, channels, ai-pipeline, autonomia; Fluxos 1/2/3 e2e; token
  accounting; idempotência tools; métricas Prometheus; cobertura ≥70%). **§16.3 Marco-3** (payments Stripe Connect,
  reminders, faq, rules, audit, observability; WhatsApp direto; retry/circuit-breaker; OTel completo; Grafana; **LGPD
  DSR/retenção/consentimento**; **MFA TOTP**; backup/restore; rate-limit distribuído; SLO).
- **Status de ADR (origin/main):** backend/ADR-009/010/013/014/018/019/020/021/022/023 = **`aceita`**; backend/ADR-016
  (token-billing) = **`proposed`**; backend/ADR-011 = **`Superseded by ADR-019`**. _shared/ADR-019 (bases legais LGPD) +
  _shared/ADR-020 (retenção) = **aceitas 2026-04-23**.
- **Fato estrutural:** o código entrega muito além de Marco-1 — o README "Marco 1 bootstrap" **subdeclara** o que existe.
  O piloto exercita calendar + payments-manual (ADR-023 aceita) + o worker assíncrono independentemente do rótulo → os 2
  CRÍTICOs são **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-27) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO app-wide); `StatusHistory` + `OperationalMetricSnapshot` (Módulo 16) ausentes; `appointments.created_by_*`/`confirmed_at` **colunas inexistentes** (§8.3/§8.4); templates ADR-020 + priority-score ADR-021 **Opção C vinculante** não-materializados |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recount reproduzido **EXATO**: `103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 / 11 undoc` (4 isentos + 7 drift-real); bijeção 106−11=95 verificada; `mark-no-show` segue **REFUTED**; `create-refund`-drift **SHARPENED** (live-path) |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO** (sancionados; 3 "crus" = doc-comments) |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | seed gera base32 160-bit + `assertMfaSecretNotPlaceholder`; sentinel só comentário; login sem MFA = correto (Marco-3); **`CLAUDE.md §8 l.171` stale**; fix de código = 0h |
| e | Testes faltando (hot paths) | ✅ | webhook Stripe (`constructEvent`=0 em test/) / reconcile-cron (só unit mockado → 42703 CI-invisível) / transition+reschedule (nunca chamados no test) / `GET /appointments` (inexistente); `seed-pilot.test` **false-green** (NOVO: assere só org/staff/prof/svc → passa com org não-operacional) |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); **7** TODO (todos Marco-2/3) |
| g | LGPD | ✅ | ingestão PII **ungated** (pré-aviso) vs rights-path **RS256-gated** (inalcançável no piloto); 5 cópias de PII inbound cruas; `message-content-untargetable`; retention worker ausente; DSR export **capacidade-zero** no piloto + incompleto; **NOVO** export vaza `notes_internal`/omite profiling; erasure só p/ `users` não `customers` |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main, verbatim, **sem drift**); **nenhum** work-item p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker** |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky + **2× 57P01**) + Security RED **50 high / 115** (**platô 4ª passada byte-idêntico ao nível de módulo**); fast-gate GREEN (469/469); lint-RED = artefato local gitignored (5 `gap*.js`, **0 adicionados**); scheduled dark **09-22→10-26** (slot 10-26 rodou atrasado 11:34 UTC — **correção do 10-26**) |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + irreversível**; **NOVO: raiz estrutural ÚNICA** (`repository.ts:395-413` void-returns) compartilhada com **webhook Stripe** + `expire` audita-falso; `reconcile-refund-42703` cron-only; `intent-reconcile half-applies`; overflow `numeric(10,2)`; PCI-nil (grep=0) |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH pilot-universal** + métrica-cega; `pre-HMAC DB amplification` (DoS); unknown-provider-silent-drop; HMAC correto |
| l | Harness dispatch | ✅ | `status`-callback **POST↔PATCH 404 total** (root-cause único, byte-verificado nos 2 repos); token-IDOR status-agnóstico; `message_id`-poison **pilot-reachable, CAUSA inércia do harness**; **NOVO: só 1 de 4 callbacks vivo** (`/traces` sem-produtor); `/complete` mismatches; skills vazio |
| m | Alçapões do piloto | ✅ (traçado) | **quadruple-gated**: 1ª falha = auth-actor 401 → sem GET agenda → 404 calendar → grade-vazia app-wide; money-path manual OK (Clerk-user); worker-telemetry buraco-negro (mecanismo two-process-registry NOVO); `cancelled→confirmed` over-book + `completed→cancelled` não-restaura pacote |
| n | Delta vs audit anterior | ✅ | 10-26 re-verificado; **0 refutações de código** (6ª passada); Security/Tests **delta-zero**; scheduled-dark + **correção** do slot 10-26; ~16 misses NOVOS + 5 refutações adversariais |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN (staff) — PASSA mecanicamente.** `seed-pilot` cria org + `bevox_admin`; `loginStaff` (`auth/service.ts:63-90`)
   é password-only (MFA seam presente não-enforced `:84-87`); cunha JWT staff **HS256** (`staff-auth.ts:70`). **Sem
   rate-limit/lockout** (`auth/routes.ts:90` sem preHandler; `requireRateLimit` 0 callers).
2. **VER AGENDA — QUEBRA na AUTH primeiro (401).** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`calendar/routes.ts:22,48`; `clerk-auth.ts:90` pin RS256 + claim `organization_id`) → token staff HS256 → **401**.
   Seed não cria principal Clerk nem row `users`. O piloto é **quadruple-gated**: `401 auth-actor` → `sem GET de
   appointments` → `404 no-calendar` (`availability.ts:75`, **CRÍTICO-2**) → `grade vazia app-wide` (**CRÍTICO-1**).
3. **AGENDAR — BLOQUEADO a jusante.** 100% `slot_conflict` (grade vazia). **Main-path exactly-once É SÃO** (advisory
   xact-lock + recount in-lock + unique index + replay 23505; POST honra `Idempotency-Key`). Reschedule/transition têm
   ~8 defeitos de correção (incl. `cancelled→confirmed` over-book + `completed→cancelled` não-restaura pacote); nenhum
   grava `audit_events` nem persiste actor (colunas inexistentes).
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** Serviço semeado sem `requiresPrepayment` →
   default `false` **e** `seed-pilot` não cria `payment_accounts` → precisa de `POST /payment-account/connect-manual` à
   mão (mesmo gate Clerk). **1 bug HIGH irreversível** re-mark de charge terminal (alcançável por Clerk-user); overflow
   500 em `amount_total` ≥ 1e8.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile cru
   `half-applies paid`; reconcile de refund DOA (42703) — **cron-only mas live-wired**; manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[SHARPENED]`/`[NARROWED]`/`[REFUTED]`/`[de-claim]` = status vs 10-26; **(v: …)** =
verificação; `[xrepo]` = dependência cruzada. Severidade ancorada no gate do **piloto**; escalonamento p/ GA anotado.
`file:linha` = evidência lida **nesta** sessão sobre código byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO ×3 — SCHEMA + PILOT + orquestrador)** — Nenhum caminho
  do app escreve `professional_schedules` (grade semanal-base; tabela `calendar.ts:41-62`, DB-real desde `0008`). Único
  `INSERT` app-wide = fixture `test/integration/calendar-booking.test.ts:120` (SQL cru); **zero `INSERT` em `src/` ou
  `scripts/`** (grep orquestrador: só o SELECT `availability.ts:116`; `createScheduleOverride` escreve
  `professional_schedule_overrides`, não a base). `availability.ts:126 if(!sched) continue` executa **antes** da leitura
  do override `extra` (`:128`) → o único writer de capacidade (override type=`extra`) **nunca** resgata um profissional
  sem row base → **sem escape-hatch de bootstrap**. Não existe módulo `src/modules/onboarding/` apesar do
  `onboarding_stage_enum` ter valor `schedule` (`_shared.ts:44`). Escopo backend/ADR-010 **aceita**. — Impacto: 100% dos
  agendamentos = `slot_conflict`, app-wide. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (seedar grade). **#1.**
  `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO ×2 — PILOT + orquestrador)** — `seed-pilot.ts`
  importa só organizations/staffAccounts/professionals/services (`:33-35`) e tem exatamente **4** `.insert(`: organizations
  (`:109`), staffAccounts (`:156`), professionals (`:195`), services (`:217`). Zero `calendars` →
  `availability.ts:75 notFound("Calendar")`. `createCalendar` existe (`calendar/repository.ts:20`) e está route-wired
  (`routes.ts:38`); o gap é "o seed nunca o chama e não há bootstrap não-HTTP". `professional_services` também não é
  semeado → fallback "todos bookáveis" (`availability.ts:91-96`). `system_holidays` omitido é **fail-open**
  (`:108-111`), não co-bloqueador. — Esforço: **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×3 — PILOT + AUTH + grep)** — seed
  provisiona **só** org + `staff_account` (HS256, `staff-auth.ts:70`); toda rota de calendar/money é `requireClerkAuth()`
  RS256 (`calendar/routes.ts:22,48`; `payments/routes.ts:51,53,59`; `clerk-auth.ts:90` pin RS256 + claim org) → token
  staff rejeitado 401. `grep requireStaff|requireRole src/modules/calendar/` = **0**; o seed não cria usuário Clerk nem
  row `users`. **1ª falha dura do piloto.** — Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-27; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice`** `[carry]` **(v: RODADO)** — `pnpm test:integration` = **RED exit 1**,
  `1 failed | 92 passed (93)` (`Test Files 1 failed | 13 passed (14)`). Falha = `calendar-booking.test.ts:259` "retorna
  slot_conflict quando start_at < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be
  'slot_conflict'` — o gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei 09:04 UTC → `booked`. **Com 2× teardown
  `57P01`** (idêntico ao 10-26; ruído testcontainers/ioredis, não muda pass/fail). `ci.yml` (job `Tests`) roda `pnpm
  test` + `pnpm test:integration` com pg16+redis7, **sem** `continue-on-error`. — Esforço: **0,5h** (slot `now()`-relativo
  + fechar `closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-50-high`** `[carry, PLATÔ 4ª passada byte-idêntico ao nível de módulo]` **(v: RODADO)** —
  `pnpm audit --audit-level high` = **RED exit 1, 115 vulns (10 low · 55 moderate · 50 high · 0 critical)** — **DELTA ZERO
  vs 10-26/25/24**, verificado ao **nível de módulo**: os **mesmos 19 módulos-high** exatos, incl. **`zod@4.4.3`
  direct-prod** (`<4.6.6`, exaustão de memória na camada de validação HTTP). Highs prod-runtime: `fastify`, `find-my-way`,
  `fast-uri`, `@grpc`/`@opentelemetry/*`, `protobufjs`, `zod`; os demais (undici/nanoid/vite/postcss/source-map-js/tmp) só
  via testcontainers+vitest (dev). `security.yml` → osv-scanner + `pnpm audit --audit-level high` **`continue-on-error:
  false`** → hard-fail. **Tendência 12→15→18→49³→50⁴.** — Esforço: **4-6h** (`pnpm add zod@^4.6.6` + bump OTel/fastify sob
  nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion). **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[carry, 10-26 "não-agenda" CORRIGIDO → "atraso"]` **(v: orquestrador — `gh run
  list`)** — todo run `schedule` em `main` (Security seg-cron `0 6 * * 1`; CodeQL ter-cron `0 6 * * 2`) termina em
  **`startup_failure` (0s)** ininterrupto de **09-22** até 10-26; último run agendado que executou = Security `failure`
  **09-21** (CodeQL success 09-15). **Correção do 10-26:** aquele audit temeu que o slot de seg-10-26 não tivesse rodado;
  **rodou, atrasado ~5,5h** (`40316135563` às 11:34 UTC, `startup_failure`). Os workflows **continuam disparando (com
  atraso) e falhando no startup** — **não** foram auto-desabilitados. O slot ter-cron de **hoje (10-27)** ainda não
  apareceu às 09:15 UTC (consistente com o atraso). Gate de segurança agendado **nem roda nem alerta** há ~5 semanas.
  Causa não-introspectável offline (billing/quota Actions, action-ref, ou política de org). **Nota de governança:** os
  commits de audit são **locais** (`main ahead 15`, nunca pushados) → `ci.yml` (Lint/TS/Tests/Build, push/PR-triggered)
  **não roda** nos commits de audit; o "CI verde" só é aferível localmente. — Esforço: **0,2h** (re-enable). `[xrepo: GitHub]`

**Auth / rate-limit — buraco app-wide**

- **`rate-limit-plugin-dead-app-wide`** `[carry]` **(v: CONFIRMADO ×3 — AUTH + SEC + orquestrador)** — `requireRateLimit`
  tem **zero callers** em todo `src/` (só `rate-limit.ts:4` doc, `:146` decorate-def, `global.d.ts:66` tipo).
  `@fastify/rate-limit@^10.3.0` é dep declarada (`package.json:37`) mas **nunca importada/registrada**; o plugin Lua custom
  é registrado (`bootstrap/server.ts:134`) mas apenas **decora** o opt-in — **nenhuma rota o anexa** (login/refresh,
  mutações de money, webhooks metaapi/Stripe, rotas Clerk). Login staff (`auth/routes.ts:90`) **sem preHandler** →
  brute-force online ilimitado (bcrypt cost-12 único freio; MFA é Marco-3). — Piloto baixo (1 admin). — Esforço: **~1h**.
  **#8.**
- **`staff-jwt-secret-no-min-length`** `[carry, SHARPENED → refine presence-only é SISTÊMICO]` **(v: CONFIRMADO ×2 — AUTH
  + orquestrador)** — `env.ts:60 STAFF_JWT_SECRET: optionalString` (sem `.min()`); `staff-auth.ts:70` assina HS256. O
  mesmo secret assina o JWT de `state` do Google OAuth (`oauth.ts:95-96`) **mas** audiences distintas (ambas verificadas)
  → sem replay; risco = piso de entropia compartilhado. **SHARPEN NOVO (v: orquestrador):** o refine `requiredInProd`
  (`env.ts:185-213`) é **presence-only** (`if (!val[key])`) para **~19 secrets** — incl. `AEAD_MASTER_KEY`,
  `GOOGLE_TOKEN_ENC_KEY`, `STRIPE_SECRET_KEY`, `META_API_PRIVATE_KEY_PEM`; **nenhum** secret recebe validação de
  comprimento/formato no boot. O `AEAD_MASTER_KEY` (chave AES-256-GCM que decripta os secrets de canal) é validado
  **lazy** só no 1º uso (`aead.ts:23 hex 32 bytes`) → uma chave mal-configurada **sobe limpa** e falha só no 1º decrypt de
  secret de canal (path do webhook metaapi). — Esforço: **0,5-2h** (`.min()`/length-refine por secret). **O buraco de
  auth mais duro no piloto (HS256 staff).**
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — AUTH, canon-reforçado ADR-013:143)** — `requireRole` é
  **vaporware**: só 3 comentários-prosa (`clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`); **não declarado**
  no `FastifyInstance` (`global.d.ts:52-70` lista os 6 decorators reais). `clerk-auth.ts:109 role = … ?? "member"`
  (default **fora** do enum DB). Rotas cliente mutantes têm só `requireClerkAuth+requireOrganizationScope` → qualquer JWT
  org-member roda tudo intra-org (org-scope ainda bloqueia cross-org). **Canon ADR-013 l.143** manda middleware rbac por
  role (status `aceita`, não Marco-deferido) — não entregue. Blast-radius **nulo no piloto** (plano staff). — Esforço:
  **1-2d**. `[xrepo: backend/ADR-013]`
- **`impersonation-audit-trail-absent`** `[carry, SHARPENED ×2]` **(v: CONFIRMADO — AUTH)** — `auth/service.ts:135-139`
  seta claim `impersonation_id`; o hook de audit (`auth/routes.ts:70-87`) vive no plugin encapsulado `authRoutes`
  (`server.ts:198`); staff-ops é registrado como plugins **irmãos** (`server.ts:213-215`) → encapsulamento Fastify → o
  hook **nunca dispara** nas ações staff-ops; estas **são** auditadas (`actions.repository.ts:174-184`) **mas** gravam
  `actor_type='user'`, `actor_id=NULL`, e **nenhum `impersonation_id`**. Os **reads** staff-ops (`read.routes.ts:22-40`)
  tomam `organization_id` do query string, são cross-org, e **inteiramente não-auditados**. O branch staff em
  `organization-scope.ts:55-57` é **código morto inalcançável** (nenhuma rota pareia `requireStaff`+
  `requireOrganizationScope`) → bug latente. — Esforço: **1-2d**. `[xrepo: ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO — AUTH)** — `auth/repository.ts:217-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id) +
  `routes.ts:169-170 orgClaim = organization_id ?? clerkUserId`; `upsertUserFromClerk` hardcoda `role='operator'`
  (`:238`); webhook só trata `user.*`, sem `organization.created` → paradoxo de bootstrap. É o **porquê** de não existir
  row `users` (alimenta o gate auth-actor). — Esforço: **4-8h** (+ADR org-mapping). `[xrepo: Clerk]`
- **`clerk-jwt-no-aud-iss-validation`** `[carry, aud/iss-only]` **(v: CONFIRMADO — AUTH)** — `clerk-auth.ts:89-92`
  verifica só `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim
  não-verificada (`:105`). jose **já** valida `exp`/`nbf` + pin RS256 — o gap é estritamente **aud/iss** (qualquer token
  RS256 do mesmo JWKS/instância Clerk é aceito). Assimetria: staff **pina** audience; Clerk não. — Esforço: **0,5-1h**.

**Canais / money — alcançável no piloto (reachability por Clerk-user; staff HS256 semeado esbarra 401 upstream)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry, pilot-universal]` **(v: CONFIRMADO — SEC + orquestrador;
  "defeito confirmado mais danoso")** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:35,44`) e persiste
  em `channel_connections.provider` (`metaapi/routes.ts:246-252` → coluna `notNull()` **sem CHECK**).
  `upsertChannelConnection` tem **exatamente 1 caller** (`routes.ts:246`) e é o **único INSERT** em `channel_connections`
  (`channels/repository.ts:66`); o UPSERT nunca atualiza `provider` → provider é **estruturalmente sempre `"wa"`/`"ig"`**.
  Outbound `findExecutionDeliveryContext` null-coage provider ≠ pleno (`metaapi/repository.ts:197`) → `ctx.provider=null`
  → guard `executions/seams.ts:360` → `skipped_missing_recipient` (`:376`); `isDeliveryFailure` exclui skips (`:122-124`)
  → `complete-service.ts:100` fica `done` (**falso-sucesso**); métrica loga `channel:"unknown"`. meta-api `origin/main
  5516c2a` exige `z.enum(["whatsapp","instagram"])` (`messages/schemas.ts:7`, **re-confirmado**) → `wa`/`ig` é invenção
  100%-backend. **Alcançável NO piloto (Clerk-user):** `approve()`→`runApproval`→`deliverToChannel` **e**
  `executeProposals`→`deliverToChannel`. — Impacto: **100%** das respostas de IA a conversas inbound-semeadas descartadas
  em silêncio como `done`. — Esforço: **3-4h**. **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, irreversível; SHARPENED → raiz estrutural ÚNICA + alcança
  webhook Stripe]** **(v: CONFIRMADO ×2 — SEC + orquestrador)** — `markChargePaidManually` **não** tem status-gate
  (`service.ts:422-433`); `applyChargePaid` chama `insertPayment`+`confirmAppointmentIfUnconfirmed`+grant
  **incondicional** (`service.ts:891-924`) **ignorando o rowcount** de `markChargePaid` (guardado `WHERE status='pending'`,
  `repository.ts:395-398`). Re-mark de `expired`/`refunded` → rowcount-0 **mas** os 3 side-effects rodam → payment `paid`
  órfão fresco (ON CONFLICT `(org,manual:<id>,'paid')` não colide pois o anterior virou `reversed`); depois **irreversível**
  (`refundChargeManually` exige `status==='paid'` `:499`). **Alcance DETERMINÍSTICO** (`refund-full→re-mark-paid` e
  `expire→mark-paid` são chamadas sequenciais sem gate), a corrida (expire lock-free vs mark-paid lock) é vetor
  **adicional**. **SHARPEN NOVO (v: SEC+orquestrador) — raiz estrutural ÚNICA:** os 3 UPDATEs guardados
  (`markChargePaid`/`Expired`/`Refunded`, `repository.ts:395-413`) são `Promise<void>` **sem `RETURNING`** → **nenhum
  caller pode** gatear no rowcount; e a mesma `applyChargePaid` é chamada por `payment_intent.succeeded`
  (`webhook-platform.ts:107-120`) → o **mesmo órfão é manufaturável no path Stripe**; e `expireChargeManually`
  (`service.ts:639-649`) **audita falso** (`charge.expired_manual {status:"expired"}` enquanto a charge é `paid` no
  perdedor da corrida). Rotas sob `mutate` = `requireClerkAuth()+requireOrganizationScope()` → reachable por Clerk
  org-user. **Fix = adicionar `RETURNING id`+boolean aos 3 e gatear efeitos no rowcount** (fecha manual + Stripe + expire).
  — Esforço: **~1,5h**. **#4.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA ligar — INERTE no piloto manual)**

- **`dispatch-message-id-not-uuid-poisons-every-AI-dispatch`** `[carry, pilot-reachable; CAUSA inércia do harness]` **(v:
  CONFIRMADO — L + orquestrador)** — `buildDispatchMessages` seleciona `external_message_id` (`orchestration/
  repository.ts:395`) e o mapeia a `message_id` (`:409`); `external_message_id` é `text NOT NULL` id nativo de canal
  (`wamid.*`, `ingestion.ts:40`) — **nunca** UUID; `id` interno é UUIDv7 (`:35`). `DispatchMessageSchema.message_id =
  Uuid.optional()` (`harness-dispatch.schema.ts:22`) → ZodError em `DispatchPayloadSchema.parse` (`harness-dispatcher.ts:91`)
  **após** o INSERT `pending` (`:73`) e **antes** do enqueue. Canon (`PRD l.1060`) define `message_id` = o **UUIDv7 PK
  interno** → a constraint é canon-fiel; o bug é **selecionar a coluna errada** (`m.id`). Determinístico, 100% dos
  dispatches de IA, nos 2 paths (cutoff + redispatch staff). **É O PORQUÊ de o harness ser inerte no piloto** (nenhuma
  dispatch chega) → **CAUSA** o orphan-`pending` (abaixo) e **MASCARA** unbounded/active_execution_id/skills. **Correção
  de wording vs 10-26:** "fire-first ANTES de criar execução" é **impreciso** — o parse roda **depois** do INSERT. —
  **Inerte no piloto manual semeado; CRÍTICO assim que canais/IA ligarem.** — Esforço: **~15min** (`message_id: m.id`).
  `[xrepo: bevox-harness]`
- **`harness-status-callback-method-mismatch-total`** `[carry, root-cause único]` **(v: CONFIRMADO byte-level nos 2 repos
  — L + orquestrador)** — Harness `post()` hardcoda `method:"POST"` (`bevox-harness src/integration/bevox-callback.ts:28`;
  `/status` em `:141`); `updateStatus` POSTa `running` (`execution-handler.ts:1410,1584`) / `dead_letter`
  (`bullmq-consumer.ts:155`), backend só registra **PATCH** `/status` (`harness-callbacks.routes.ts:56`) → **toda** chamada
  de status → Fastify **404**. `applyStatusTransition` + `markExecutionDeadLetter` são **código morto ponta-a-ponta**. O
  worker `on('failed')` (`queue/index.ts:267-269`) só **loga** jobs backend-internos → **root-cause único**. Backend é
  **canon-correto** (§10.4 PATCH l.1076). Fix = **cross-repo** (harness→PATCH + errata canon l.447). — Esforço: **~1,5h**.
  **#7.** `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry, status-agnóstico]` **(v: CONFIRMADO — L; grep leituras=0)**
  — o preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:71,96`; escreve
  `req.executionContext` em `routes.ts:66`), mas **todo** handler age sobre o `:id` da URL (`routes.ts:73,91,113,142`) e
  **nunca** lê `req.executionContext` (grep: única ocorrência = a escrita `:66`). Token válido p/ A escreve em qualquer
  execução B (IDOR cross-execution/cross-tenant). Coexiste com `four-callbacks-token-gated` (autenticidade ≠ autorização).
  **Inerte no piloto**; **CRÍTICO-GA**. — Esforço: **1h**. `[xrepo: bevox-harness]`
- **`complete-service strategy/tenant mismatches`** `[carry, CONFIRMADO ×3 sub-claims]` **(v: CONFIRMADO — L)** —
  `strategy:"failed"`+proposals vazias → `"reply"` (`complete-service.ts:17-32`), nunca `error` (canon espera `error`,
  PRD l.1146-1149); harness emite `aborted_cost`/`aborted_timeout` **no fio** (`execution-handler.ts:2150
  buildCompletePayload`, contradizendo o comentário `:2082 "só telemetria"`) ausentes do enum backend
  (`harness-callbacks.schema.ts:57-65`) → `parse` 400 **antes** de `lockForCompletion` → desfechos terminais rejeitados;
  `/complete` lê `bodyOrgId` sem `=== existing.organization_id` (`routes.ts:150-154`) → **vetor de ação cross-tenant em
  GA**, compondo o token-IDOR. — 1-3h/ea. `[xrepo]`
- **`dispatch-messages-unbounded-poison` / `completion-never-clears-active-execution-id` / `backend-never-sends-skills-
  allowlist`** `[carry, MASCARADOS por message_id-poison]` **(v: CONFIRMADO — L)** — `buildDispatchMessages`
  (`repository.ts:394-399`) sem LIMIT vs caps harness `100`/`8000`/`256KB`; `finalizeCompletion`
  (`harness-callbacks.repository.ts:136-149`) nunca nula `active_execution_id` → conversa trava após a 1ª execução;
  `cutoff.ts:75 skills:[]` + `actions.repository.ts:144 skills:[]` → PERM-05 no-op. Hoje inalcançáveis (message_id-poison
  rejeita antes). — **Inerte no piloto; CRÍTICO-GA.** — 1-8h/ea. `[xrepo: bevox-harness]`
- **`no-appointments-read-endpoint`** `[carry, BROADENED]` **(v: CONFIRMADO — ROUTES + PILOT + orquestrador)** — Não existe
  `GET /appointments` nem `/appointments/:id` em lugar nenhum: `grep app.get(...appointment)` = **0**; as paths YAML de
  appointment são todas POST/PATCH; calendar GET expõe só `/calendars` + `/availability`; staff-ops reads =
  dashboard/executions/windows/dead-letters/audit. **BROADEN NOVO (v: PILOT):** a "agenda do dia" (PRD §263 "canal
  principal de operação diária") **nem tem REST read, nem SSE push** (`appointment.created` §8.3 l.872 nunca emitido —
  `publish.ts:8-12` união fechada) → ilegível por TODO ator. — Esforço: **4-6h**. `[xrepo: PRD §5.3/§8.3]`
- **`worker-process-telemetry-uninitialized`** `[carry, SHARPENED — mecanismo two-process-registry]` **(v: CONFIRMADO ×2
  — PILOT + orquestrador; ALTO-operabilidade, exercitado-no-piloto)** — `src/queue/index.ts` (entry `node
  dist/queue/index.js`) **nunca** `import "./instrument.js"` nem `initTelemetry()` (ambos só em `src/index.ts:17,30`). O
  worker importa `captureException` (`:62`) mas `Sentry.init` vive em `src/instrument.ts:22` (só HTTP entry) → drop
  silencioso; o OTel NodeSDK nunca inicia p/ os **11 `new Worker`** (grep=11, docstring `:6` "4 workers" stale);
  `w.on("failed")` (`:267-269`) **nem tenta** `captureException`. **SHARPEN NOVO (v: PILOT) — mecanismo concreto:** o
  `prom-client` registry (`metrics.ts:14`) é singleton **por-processo**; o reconcile incrementa `paymentsReconcile*`
  (`reconcile.ts:88,114,162,165`) **no processo worker**, mas `/metrics` é servido **só pelo processo HTTP**
  (`health/routes.ts:24`; worker sem listener) → counters do worker **estruturalmente inscrapáveis**, HTTP mostra-os
  flat-0 para sempre. — **1-2h** (import + `initTelemetry()` + `/metrics`+`/healthz` no worker + `w.on('failed')`
  capturar). **Alto valor / baixo esforço. #6.**

### MÉDIO (degrada qualidade)

**Auth — contrato / cross-org (plano staff-ops que o piloto usa)**

- **`staff-token-expires_in-advertises-refresh-ttl-not-access-ttl`** `[carry]` **(v: CONFIRMADO ×2 — AUTH + orquestrador)**
  — `issueSession` devolve `expires_in: ttl` onde `ttl = staffRefreshTtlSeconds()` = 604800s/7d (`auth/service.ts:54,60`),
  mas o JWT access-token `exp` = `STAFF_JWT_ACCESS_TTL` = 900s/15min (`staff-auth.ts:74`). Cliente que agenda refresh por
  `expires_in` trata token de 15min como válido ~672× tempo demais → 401 silenciosos até o fallback refresh-on-401.
  **Bug de contrato no plano de auth que o piloto de fato usa** (painel staff-ops). — Esforço: **0,25h**
  (`expires_in: cfg.STAFF_JWT_ACCESS_TTL`).
- **`staff-ops-realtime-sse-firehose-unaudited`** `[carry]` **(v: CONFIRMADO ×2 — AUTH + orquestrador)** — `GET
  /api/v1/staff/realtime/events` faz `sub.psubscribe("realtime:*")` (`realtime.routes.ts:66`) — **firehose cross-org de
  TODOS os orgs** — gated só por `requireStaff([...STAFF_ROLES])` (observer incluído, `:29`), **sem filtro de org e sem
  audit**. — **MÉDIO/LGPD (GA).** — Esforço: **2-4h**.
- **`audit-log-blind-to-staff-actor`** `[NOVO]` **(v: CONFIRMADO ×2 — AUTH + LGPD)** — toda mutação staff-ops grava
  `audit_events.actor_id = NULL` com o actor real só em `after_json.actor_staff_id` (`actions.repository.ts:178-184`); o
  endpoint de leitura de audit expõe um filtro `actor_id` (`read.repository.ts:222`) que **nunca casa** um membro de staff
  → a trilha de audit cross-org queryável **não responde "o que o staff X fez"**. O enum `actor_type` =
  `user|ai|system|webhook` **sem `staff`** (`_shared.ts:84`) → ações de staff gravadas inconsistentemente. —
  **MÉDIO/accountability.** — Esforço: **S-M**.
- **`impersonation-id-is-not-organization-id`** `[NOVO, sharpen da impersonation]` **(v: CONFIRMADO — AUTH)** —
  `startImpersonation` seta `impersonation_id` = o **PK de `staff_impersonations`** (`service.ts:135-138` ←
  `repository.ts:160 RETURNING id`), mas `organization-scope.ts:57` trata `req.staff.impersonation_id` **como** o claim de
  org e o compara ao `:organization_id` da URL → mesmo que uma rota pareasse `requireStaff`+`requireOrganizationScope`, o
  claim (PK de impersonation) **jamais** igualaria um UUID de org. O modelo "staff age dentro do org X" é **não-funcional**
  além de emitir rows de audit start/end. — **GA-latente** (branch morto). — Esforço: **incluído no fix de impersonation**.

**Observabilidade — worker é buraco-negro (11 workers; harness inerte no piloto, exceto obs que o piloto exercita)**

- **`metrics-public-org-id-enumeration`** `[carry]` **(v: CONFIRMADO ×2 — SEC + PILOT)** — `GET /metrics`
  (`health/routes.ts:24`) é in-app **não-autenticado** (sem preHandler; comentário `:22-23` admite só network-policy) e o
  counter `bevox_backend_http_requests_total` é rotulado com `organization_id` (`metrics.ts:30-35`), incrementado
  por-request com o UUID real (`bootstrap/server.ts:170`) → quem alcança `/metrics` enumera **todos os org-UUIDs +
  rota/status/volume por-org** (vazamento ADR-021) + blow-up de cardinalidade em GA. — Esforço: **1-2h**. `[g; ADR-021]`
- **`worker-has-no-healthz-readyz` + `dead-worker-invisible-to-orchestration`** `[carry, SHARPENED]` **(v: CONFIRMADO —
  PILOT)** — worker não sobe listener (`grep listen|fastify|get queue/index.ts` = 0) → counters do worker não-scrapáveis
  **e** sem liveness/readiness. **SHARPEN NOVO (v: PILOT):** o HTTP `/readyz` (`health/routes.ts:17`) checa Postgres+Redis
  mas **não** a liveness do worker; o worker não expõe porta → k8s não consegue HTTP-probe → worker crashado → o HTTP
  segue reportando `ready` enquanto ingestão/reconcile/google-sync/waitlist/package-expiry **param em silêncio**. — **2-3h**.
- **`domain-prometheus-metrics-not-registered` + `domain-metrics-declared-but-never-emitted`** `[carry]` **(v: PILOT)** —
  `shared/metrics.ts` não registra os de §13.3 l.1365 / l.590 (`charges_succeeded_total`, `appointments_no_show_rate`,
  `executions_pending_approval_count/timeout_total/total`, `charges_total`, `queue_jobs_completed_total`,
  `buffer_windows_opened_total` — grep=0); `metrics.ts:41 queueSize` nunca `.set()` e `:52 messagesReceivedTotal` nunca
  `.inc()` (o piloto exercita ingestão). — **2-3h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` **(v: PILOT)** — `realtime/publish.ts:8-12` união fechada a
  `execution.*`/`waitlist.offered`; `appointment.created`(§8.3 l.872)/`charge.updated`(§8.4 l.894) **nunca** emitidos
  (`publishRealtime` em booking/payments = 0) → tela do profissional não auto-atualiza. — **2-3h**.
- **`metaapi-webhook-preauth-db-amplification`** `[carry]` **(v: CONFIRMADO — SEC)** — um envelope bem-formado (passa Zod
  `metaapi/routes.ts:130`) dispara `SELECT … channel_subscriptions` (`:140-144`) **+** `findSubscriptionById` (`:150` → 2ª
  query + `decrypt` AEAD em `repo.ts:41`) **antes** da validação HMAC (`:156-169`), e **sem rate-limit em rota nenhuma** (o
  dedupe SETNX também é pós-HMAC). Flood não-autenticado → 2 queries + 1 decrypt/request. — **GA/DoS.** — Esforço: **~1h**.
  `[k]`

**Dados/LGPD — scoping de conteúdo (GA/Marco-3, piloto roda com PII real; ingestão ungated vs rights-path RS256-gated)**

- **`message-content-table-untargetable`** `[carry]` **(v: SCHEMA; MÉDIO/LGPD)** — `message_records` (`ingestion.ts:32-56`)
  guarda PII de mensagem (`content_text` egresso ao LLM + `sender_snapshot_json` + `media_json`) mas **sem
  `organization_id`, sem `created_at` de inserção, sem `deleted_at`** — só o nullable provider `message_created_at`
  (`:43`). FK `received_event_id onDelete set null` (`:36-38`) → a âncora transitiva (`received_events.received_at`) é
  **by-design severável** (NOVO sharpen LGPD: no instante em que um retention worker purgar `received_events`,
  message_records perde a âncora). Conteúdo não é DSR-targetável por org nem envelhecível por cron. — **GA/LGPD.** —
  Esforço: migration (M). `[g/schema]`
- **`dsr-export-leaks-notes_internal-while-omitting-profiling`** `[NOVO]` **(v: LGPD)** — o export (`customers/
  service.ts:97-110`) devolve o `CustomerRow` completo, que **inclui `notes_internal`** (notas staff-internas, possível
  dado de terceiro/avaliação divulgado ao titular) **mas omite `risk_flags_json`** (dado de profiling automatizado,
  art.20) + `preferences_json`; e `listFacts` filtra `superseded_by IS NULL` (`repository.ts:106`) → facts
  históricos/superseded silenciosamente fora da portabilidade. Over-disclosure interno + under-disclosure de profiling. —
  **MÉDIO/accuracy.** — Esforço: **S-M**.
- **`appointment-transition-no-state-guard` + `package-session-not-restored-on-cancel`** `[carry]` **(v: PILOT)** —
  `booking.ts:445-450` UPDATE incondicional any→any; `cancelled→confirmed` **ressuscita** um appointment liberado sem
  re-check de capacidade (`availability` conta `status NOT IN ('cancelled')` `:169`) → **over-book silencioso**; e o
  decremento de pacote roda em `completed`/`no_show` (`:485-500`) mas o branch de cancel (`:461-472`) não re-incrementa
  (grep=0) → `completed→cancelled` **consome permanentemente** uma sessão. — **GA integridade (inerte no piloto semeado —
  sem customer_packages).** — **2-3h**.
- **`reschedule-non-atomic-double-book` + `reschedule-self-overlap` + `appointment-mutations-no-auditevent` +
  `availability-n1-count-plus-92day-serial-loop`** `[carry]` **(v: PILOT)** — createAppointment commita o NOVO em tx
  própria (`booking.ts:373-388`), DEPOIS tx **separada** cancela o ANTIGO (`:390-414`) → janela de double-count + crash =
  ambos ativos; recount conta o antigo → com `max_concurrent=1` (seed) qualquer reschedule sobreposto = falso
  slot_conflict; §12.8 l.1343 manda C/U/D→AuditEvent, `booking.ts:234-516` grava **zero**; COUNT(*) por-slot em loops
  aninhados (`availability.ts:167-171`) × serial ≤92 dias (`routes.ts:52-67`), auth-guardado não rate-limited. —
  halfday/ea.
- **`intent-reconcile-half-applies-paid`** `[carry]` **(v: SEC)** — `reconcile.ts:143-150` seta só `status='paid'`
  +`updated_at` (charges TEM `updated_at`) **bypassando os 6 efeitos de `applyChargePaid`** (sem row `payments`, `paid_at`
  NULL, sem confirm, **sem grant de pacote**, sem audit). Branch **live** (Stripe-path, inerte no piloto). — **M**.

### BAIXO (higiene)

**LGPD (Marco-3 §16.3 — piloto roda com PII real; CONFIRMADOS; 2 de-claims STANDES)**

- **`consent-and-ai-opt-out-stored-not-applied` + `no-consent-capture-mechanism` + `intake-pii-ingested-pre-notice`**
  `[carry]` **(v: LGPD — vetor vivo, headline LGPD)** — `ai_opt_out` só no CRUD de customers (`customers/
  repository.ts:21,26,67`; `default false`=opted-IN); dispatch é **conversation-keyed, nunca customer-keyed**
  (`orchestration/repository.ts:391-415` sem join de customer) → opt-out por-customer inaplicável sem mudança de
  schema/flow; `consent_granted_at` (`customers.ts:49`) tem **zero writers**; `intake.ts:66→82` INSERT cego em `customers`
  (full_name=displayName) + customer_channels com telefone **sem gate de consentimento e sem "aviso automático"** que
  `_shared/ADR-019:33 item 6` exige → PII ingerida **pré-aviso**. **Assimetria-chave:** o path de **ingestão** é ungated
  (acumula PII a cada inbound) enquanto o de **direitos** (DSR export) é RS256-Clerk-gated (inalcançável no piloto HS256).
  — Esforço: **M**. **#10.** `[xrepo: _shared/ADR-019]`
- **`received-events-and-message-records-un-erasable` + `retention-worker-adr020-absent`** `[carry]` **(v: LGPD + SCHEMA)**
  — `received_events` (`ingestion.ts:12-30`) persiste `payload_json` E `normalized_payload_json` (envelope Meta cru) com
  **zero `organization_id`/`customer_id`/`deleted_at`**; `message_records` idem → **5 cópias de PII inbound cruas
  não-apagáveis**. grep `legal_basis|consent_event|dsr_request|retention|pseudonym` em `src/ db/ scripts/` = **0**; os 11
  workers não purgam; `auth/repository.ts:99-100` **admite** "Hard-delete worker (ADR-020, ainda não landed)". Canon
  ADR-020 define `bevox.retention.worker` (cron 03:00 UTC) + `consent_events`/`dsr_requests`. **DE-CLAIM STANDE:** a âncora
  transitiva de `message_records` existe (via `received_event_id`); só o `created_at` direto é ausente. — Esforço:
  **24-40h**. `[xrepo: _shared/ADR-020]`
- **`dsr-deletion-absent` + `erasure-asymmetry-users-vs-customers`** `[carry + NOVO]` **(v: LGPD)** — nenhum endpoint de
  deleção de customer; export EXISTE mas incompleto + não grava `audit_event`/`dsr_requests` (art.37=0) + RS256-only →
  capacidade DSR do piloto = **zero**. **NOVO (v: LGPD):** `deleteUserByClerkId` (`auth/repository.ts:244-246`) faz um
  **hard `DELETE FROM users`** real no webhook Clerk → uma capacidade de erasure **existe**, mas só para operadores
  org-side (`users`), **não** para `customers` (os titulares LGPD de fato). Erasure wired p/ a população errada. —
  **DE-CLAIM STANDE:** `consent_granted_at` entre as PII omitidas do export é imaterial (sempre NULL); perdas reais =
  `preferences_json`/`risk_flags_json`. — Esforço: export **6-10h**; deleção **8-12h**. `[xrepo: _shared/ADR-020]`
- **`staff-manual-actions-pii-sink` + `audit_events-not-customer-scoped` + residue LGPD** `[carry]` **(v: LGPD)** —
  `staff_manual_actions.ts:30-31` jsonb de ação de operador = PII sem customer_id, fora da ADR-020/DSR; `audit.ts` sem
  coluna `customer_id` → o TODO do DSR export (`routes.ts:93`) é estruturalmente irrealizável; `execution-traces-pii`
  (anchorável, sem worker); `google-calendar-intl-transfer` (`sync.ts:203,237` nome p/ US — art.33);
  `payments-raw-payload-json` (10yr fiscal → minimização); `customer-pii-mutations-unaudited` (customers nunca escreve
  audit); `denormalized-contact-snapshot` (appointments+waitlist); `staff-pii-retention-gap`;
  `clerk-organization-deleted-unhandled`. — 2-4h/ea.

**Money / schema — misses de baixo risco**

- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry, cron LIVE-wired]` **(v: CONFIRMADO ×2 — SEC +
  orquestrador)** — `reconcile.ts:255-257 UPDATE refunds SET … updated_at = now()`, mas `refunds` **não tem**
  `updated_at` (`payments.ts:149-172`; comentário `:7` admite o adiamento) → **42703** → status nunca sai de `pending` →
  reconcile de refund **DOA**. O cron **É live-wired** (`queue/index.ts:149` + repeatable `:258-263`). O path vivo
  `updateRefundStatus` (`repository.ts:476-485`) **omite** `updated_at` → intacto; manual escreve `succeeded` direto →
  cron nunca o seleciona → **pilot-inerte**. CI-invisível (só unit mockado). **Fix = remover `updated_at=now()`.** —
  **0,25h**. `[xrepo: Stripe]`
- **`manual-charge-amount-unbounded-overflow-500` + `reconcile-fifo-window-starvation` + currency/validity/uniqueness
  residues** `[carry]` **(v: SEC)** — `manual.ts:31 z.number().finite().positive()` (sem `.max`/`.multipleOf`) → `.toFixed(2)`
  em `numeric(10,2)` → ≥1e8 → 22003 → 500 opaco (idêntico Stripe-path `charge-intent.ts`); `reconcileStuckIntents` seleciona
  50 `pending` mais antigos e `continue`-skipa os manuais (`reconcile.ts:119`) → ≥50 manuais estagnados monopolizam a janela;
  `currency z.string().default("BRL")` sem CHECK (**propaga junk ao ledger** `payments`), `validity_days numeric`,
  `payment_accounts` sem uniqueness em `professional_id`. — trivial/S ea.
- **`fk-columns-without-index` + `section-11-3-critical-indexes-partially-absent`** `[carry, ≈55; SHARPENED partial-index
  trap]` **(v: SCHEMA — recount)** — **91 `.references()`**; **18 tabelas** org-FK com `organization_id` completamente sem
  índice (calendars, professional_schedules(+overrides), waitlist(+outbox), customers, professionals, services, executions,
  conversation_pipeline_state, buffer_windows, execution_traces, staff_manual_actions, service_packages, calendar/google,
  users) → agregado **≈55**. Ausentes `(org,status)` em appointments/charges/executions, `(org,start_at)` appointments
  (PRD §11.3 l.1263-1274); `conversations` **satisfeita**. A tabela `customers` (PII primária) tem **ZERO índices**.
  **SHARPEN NOVO (v: SCHEMA):** das "13 tabelas org-indexed", **3 são índices PARCIAIS** (`payment_accounts` WHERE
  holder='organization'; `customer_facts` WHERE superseded_by IS NULL; `refunds` WHERE provider_refund_id IS NOT NULL) →
  só **10 têm índice org-leading pleno**; rows fora do predicado ficam sem índice org nenhum. Padrão sistêmico, inerte a 1
  org. — **3-4h** (uma migration). `[a/schema]`
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized` + `waitlist-priority-score-client-settable`**
  `[carry]` **(v: SCHEMA — canon-reforçado)** — backend/ADR-020 + ADR-021 (ambas `aceita 2026-05-21`) **não
  materializadas** (grep `message_template`/`urgency_level`/`skip_count` = 0). ADR-021 "Opção C" manda `priority_score`
  server-computed + "server ignores client input em V1" — **vinculante**. Mas `calendar.ts:204 priority_score numeric
  notNull default '0'` **sem CHECK**, escrito do input na rota (`waitlist/routes.ts:30,36,71`), PATCH (`repository.ts:361`),
  INSERT (`:278`) e seam de IA (`seam-tool.ts:44,83`), e `match` ordena por ele (`repository.ts:331`; `match.ts:74-75`) →
  **inverso direto** de ADR-021 (vetor de queue-jump intra-org). **NÃO re-inflar `conversations.priority_score`** (zero
  writers → dormante). — ADR-020 **8h**; ADR-021 CHECK+drop-input **2h** / fórmula **6-10h**.
- **`status-history-entity-absent` + `appointments-no-created-by-actor` + `appointments.confirmed_at-absent` +
  `OperationalMetricSnapshot-absent`** `[carry + NOVO ×2]` **(v: SCHEMA)** — Módulo 16 (l.584/588) + §8.3/§8.4 mandam
  `StatusHistory` + `OperationalMetricSnapshot` + `appointments.created_by_type/id` + `confirmed_at`; grep de cada em
  `src/`+`db/schema/` = **0**. Provenance/histórico de transição de um booking (fluxo Marco-2 implementado) é
  irrecuperável; `confirmed_at` (§8.4 l.893 "UPDATE após pagamento") não existe para carimbar. — **GA/latente.** — S-M/ea.

**Auth / harness / schema (resíduos — BAIXO/latente/inerte)**

- **`newOpaqueId-uuidv4-dormant-landmine` + `verifyStaffRefreshToken-dead-misleading` + `staff-ops-org-filter-optional`**
  `[carry + NOVO]` **(v: AUTH)** — `staff-auth.ts:139 newOpaqueId(): randomUUID()` (UUIDv4, viola invariante #7), **zero
  callers**; `staff-auth.ts:119-121 verifyStaffRefreshToken` **zero callers** (refresh vivo usa lookup-by-hash DB), usa
  `===`. **NOVO (v: AUTH):** `organization_id` em staff-ops reads é `z.string().optional()` **não `.uuid()`**
  (`schemas.ts:44,55`) → undefined=all-org (by-design staff), mas id malformado é aceito e casa-nada (sem injeção,
  parametrizado). Deletar os 2 mortos; apertar o parse. — trivial.
- **`staff-residues`** `[carry]` **(v: AUTH)** — `login-user-enumeration-timing` (throw antes do bcrypt, sem dummy-hash);
  `bcrypt-72-byte`; `staff-session-no-logout` (access HS256 stateless ≤900s); `staff-refresh-no-reuse-detection`
  (delete-então-emite, sem family-revoke); `staff-role-stale-cache-at-login` (300s); `clerk-resolvelocaluser-fail-open`;
  `clerk-webhook-unknown-type-silent-200` (svix-verified primeiro). — S/ea.
- **`dispatch resíduos`** `[carry + NOVO]` **(v: L)** — `poisoned-dispatch-orphans-pending-execution-row` (ZodError deixa
  row `pending` que `claimTimedOutExecutions` `:428` nunca varre — **pilot-reachable, um órfão por inbound**);
  `callback-base-url-dead-on-harness-side` (harness ignora o per-dispatch); `/traces-has-zero-harness-producers` (**NOVO**:
  `sendTrace` 0 callers → com `/stream` desligado e `/status` 404, **só `/complete` dos 4 callbacks está vivo**);
  `/complete-terminal-guard-409-vs-canon-410` (**NOVO**: `errors.conflict=409` `routes.ts:159` vs PRD l.832 "410");
  `stream/completing/trace-content/char-vs-byte` (stream default-off; `completing` não varrido por timeout;
  `/traces` dropa content/step/timestamp; chunk conta chars dos 2 lados — **char-vs-byte DE-ESCALADO: harness e backend
  concordam em 4096 chars; o drift é vs-canon bytes**). — 0,25-2h/ea. `[xrepo: bevox-harness]`

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recount reproduzido EXATO)**

- **`openapi-drift-undocumented-handlers` (11 → 7 drift-real + 4 isentos) + `no-mechanical-route-zod-openapi-binding`**
  `[carry]` **(v: ROUTES)** — **4 documentados-isentos** (google/stripe webhooks). **7 drift-real sem isenção**: `GET
  /customers/{id}/export`, `GET`+`PATCH /autonomy`, `GET /channel-connections`, `GET`+`PATCH /payment-account/policy`,
  `GET /api/v1/realtime`. ZERO rotas usam `schema:` do Fastify; sem `ZodTypeProvider`; **148** `.parse()`/`.safeParse()`
  inline (exato); OpenAPI 100% YAML estático → razão estrutural do drift. `pnpm openapi:check` é `openapi-typescript
  --output -` (**gerador de tipos**, não validador) → exit 0 só prova parse. — **2-3h** + 1h validador CI. **#9.**
- **`enum-create-refund-missing`** `[carry, SHARPENED → live-path]` **(v: ROUTES)** — YAML `ExecutionProposal.action` = 6
  vals **sem `create-refund`** (l.324-330); Zod tem 7 incl `create-refund` (`schema.ts:30-38`). **SHARPEN NOVO (v:
  ROUTES):** `create-refund` **É executado** (`seams.ts:172` + `complete-service.ts:25`), e `ExecutionProposal` é refdo
  por `ExecutionCompleteCallback.proposals` → um `/complete` real com `action:"create-refund"` **passa Zod mas falharia
  validação OpenAPI** → drift de **live-path**, não cosmético (severidade BAIXO: refund-proposals raras no piloto). —
  0,25h.
- **`error-envelope-dual-schema` / `idempotency-key-param-self-inconsistency` / `status-callback-missing-dead_letter` /
  `freeform-200-underspec` / `sse-bearer-only` / `checkout-3-way-divergence` / `checkout-501-undocumented` /
  `rate-limit-429-undocumented` / `operationId:0`** `[carry]` **(v: ROUTES)** — handler **sempre** emite `request_id`
  (`error-handler.ts:55`) mas só `ErrorEnvelope` (7 refs) o documenta; param `IdempotencyKey` diz "obrigatória em toda
  mutação" mas em **32** de 52 ops; enum `status` yaml sem `dead_letter` (Zod tem); 200 free-form; SSE só Bearer
  (EventSource não autentica); `checkout` 3-way (`[pix,checkout]` vs yaml `[pix]` vs PRD `payment_link`) + o `501` do stub
  checkout não documentado (grep `"501"`=0, análogo ao 429); 429 não documentado; operationId:0 (quebra codegen). —
  0,25-2h/ea.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: orquestrador)** — tags só `v1.0.0`/`v1.0.1`;
  `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora (incl. dispatch amendment);
  `release.yml` dispara só em `push tags: ["v*.*.*"]` (sem workflow_dispatch, sem provenance/sbom) → **nenhuma imagem
  (SemVer OU sha) pós-`v1.0.1`**. `describe` = `v1.0.1-37`. Versão diverge **4-way** (`package.json 0.1.0` / `openapi
  1.11.0` / tag `v1.0.1` / hub `vX.Y.Z`). — **0,5-1h** (cortar tag). `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: orquestrador)** — `src/integration/resolve-organization-id.ts` **NÃO existe**
  (bridge colapsada SP-3) mas é citado como vivo em **~5 lugares** (`README.md:84`, rules `backend-tenancy.md`/
  `backend-routes.md`, `PostToolUse-tenancy.sh`, agent `engineering-backend-architect.md`); `CLAUDE.md §8 l.171` diz seed
  grava `PILOTSEEDONLYNOTASECRET` (stale); `backend-harness-contract.md:35` lista o status-callback como **POST**
  (contradiz o handler PATCH) e `:46`/`backend-workers.md:20` dizem `dead_letter` via `worker.on('failed')` (**errado** — é
  via PATCH que o harness nunca manda; `worker.on('failed')` só loga); `backend-db.md:31` diz `on delete restrict`
  (código+canon = **cascade**, §11.2 l.1203); `backend-routes.md:24,33` invoca `requireRole` inexistente + mis-cita
  "ADR-022 staff RBAC" (é backend/ADR-013). — 0,3-0,5h/ea. (`CLAUDE.md §1` já diz corretamente que a bridge foi colapsada.)
- **`stray-gap-workflow-js-scratch` / `codeql-upload-never` / `release-no-provenance-sbom` / `adr-number-collision`**
  `[carry]` **(v: orquestrador)** — **5** `.claude/state/gap*.js` (gap0704/0709/0714/0715/0717, gitignored — `git
  check-ignore` confirma os 5) → **zero impacto em CI** (checkout limpo não os tem); só `pnpm lint` **local** dá RED. **Esta
  sessão NÃO adicionou nenhum** (usou Agent tool, não Workflow). `codeql.yml:26 upload:never`; `release.yml` sem
  provenance/sbom; ADR 008-023 colidem backend/_shared. — 0,1-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária esta sessão)

- **`legacy-lexicon-clean`** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/`db/`: executável **ZERO**
  (composites + alias `AS account_id` + `res.accountId` Stripe + doc-comments + snapshots). Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153 generateMfaSecret()` + `:154 assertMfaSecretNotPlaceholder`;
  login sem MFA = correto (Marco-3). **NÃO implementar "rejeitar sentinel"**. CLAUDE.md §8 stale (doc).
- **`mark-no-show-is-not-a-code-bug`** `[REFUTED, carry]` — OpenAPI serve `/appointments/{id}/no-show` casando
  `routes.ts:125-131`. **Não re-flagar.**
- **`booking-main-path-exactly-once-sound`** — advisory xact-lock + recount in-lock + unique index + replay 23505
  (`booking.ts:223-263`); POST honra `Idempotency-Key`. **Não flagar.**
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc|pan`=**0**); decimal `numeric(10,2)`; webhooks
  dedupe-aware + org-scoped (cross-tenant paid-flip impossível `webhook-platform.ts:67-73`); over-refund replay-safe
  (`service.ts:515`); ambos webhook-secrets `requiredInProd`; `money-mutation-http-idempotency` by-design; `charge_type-
  drift` espelhado; clerk-webhook svix-verified.
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:65,69,93-95`). Coexiste com o
  token-IDOR (autenticidade ≠ autorização). `idempotency-on-callbacks` **REFUTED** (state-machine, `/complete`→409).
- **`env-hardening-conformances`** — `LOG_LEVEL=debug/trace` **proibido em prod** (`env.ts:215-221`, PII-risk);
  `TEST_AUTH_BYPASS_ENABLED` double-guarded (`env.ts:151-158` + `:225-231`); CORS `origin:false` (`server.ts:121`,
  cross-origin bloqueado); helmet registrado (`:109`); `sql.raw(COLS)` usa const estática (sem injeção).
- **`hmac-verification-correct`** — metaapi (`timingSafeEqual`+±300s), Stripe `constructEvent`, Clerk svix, Google
  timing-safe — todos verificam assinatura (o gap metaapi é **ordem**: decrypt antes do HMAC, ver MÉDIO).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer`; `requireStaff({roles})`→403; observer excluído de actions, incluído em reads/SSE.
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` é **canon-correto** (§11.2 l.1203); timestamptz
  everywhere; CHECK (`end_at>start_at`, `sessions_remaining>=0`, `confidence∈[0,1]`); `ai_suggestions` dropada em 0005;
  sessions numeric→integer em 0015; ADR-022 policy-json materializada; ADR-023 = 0016; `original_execution_id`
  (dispatch-amendment, canon-aceito). **Migrations journal íntegro (21 entradas = 21 `.sql`; 0 `gen_random_uuid`/
  `uuid_generate_v4`).** `uuidv7-sql-default` = **15 no `0000` raw / 14 live** (`ai_suggestions` dropada em 0005); demais
  tabelas usam `$defaultFn(uuidv7)` (fail-CLOSED).
- **`route-recount-conformant`** — 103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / **operationId:0 /
  phantom:0 / 11 undoc**; bijeção 106−11=95 verificada ao nível de operação. **4 refutações adversariais** desta passada:
  `/complete`-callback-drift, `create-code 201/200`, `booking 409`, `staff-executions query-param` — todos **sincronizados**
  (evidência negativa fresca).
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (origin/main, verbatim, **sem drift**): 10 delivered +
  `backend-psp-br-secondary` **parked**. **Nenhum work-item** p/ calendar/ADR-010, customer-identity/ADR-009,
  templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker**. Usar esta auditoria como o gate.
- **`dispatch-amendment-faithful-to-canon`** — `deadline_ms`/`original_execution_id`/`dead_letter` byte-faithful ao canon
  PRD §10.4 Am1. **Não re-flagar.**

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do piloto +
1 dos 2 jobs de CI vermelhos**.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia (nem override `extra` resgata, nem módulo onboarding existe) → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) + fechar teardown `closeDb()/closeRedis()` (os 57P01) | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado (HS256) não autentica no calendar/money (RS256) → gate upstream dos 2 CRÍTICOs |
| 4 | **`pnpm audit`: `zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**50 highs**, incl. o core de validação `zod`) e re-acende o scanner agendado (dark desde 09-22) — completa "CI verde" |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** na fronteira de entrega + CHECK + backfill + teste e2e | **3-4h** | **Pilot-universal via staff-approve**: hoje **100%** das respostas de IA são dropadas em silêncio como `done` |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + `/metrics`+`/healthz` no worker + `w.on('failed')` capturar | **1-2h** | Fecha o buraco-negro (Sentry/OTel/Prometheus two-process-registry) dos **11 workers** que o piloto roda |
| 7 | **Adicionar `RETURNING id`+boolean aos 3 UPDATEs guardados de charge** (`markChargePaid/Expired/Refunded`) + gatear `applyChargePaid`/`expire` no rowcount + lock único por charge | **~1,5h** | **1 fix fecha 3 superfícies**: o bug HIGH irreversível de dinheiro no manual **E** no webhook Stripe **E** o audit-falso do expire |
| 8 | **Anexar `requireRateLimit` (já construído) a `/staff/sessions[/refresh]` + mutators de money + webhooks** + `.min()`/length-refine nos secrets (STAFF_JWT_SECRET/AEAD/…) + corrigir `expires_in` do token staff | **~3,5h** | Fecha o buraco app-wide de rate-limit (brute-force + DoS pré-HMAC) + o piso de entropia sistêmico + o bug de contrato `expires_in` do painel staff |
| 9 | **`GET /appointments` (REST, Clerk + staff-ops)** + emitir SSE `appointment.created`/`charge.updated` + documentar os 7 handlers drift no OpenAPI + validador OpenAPI no CI | **4-6h** | "Ver agenda" não tem endpoint **nem** push em plano nenhum; fecha o drift silencioso categoria b |
| 10 | **Aplicar gate `ai_opt_out`/consent + aviso-automático no intake + `dsr_requests`** + hidratar/corrigir DSR export (incluir profiling, excluir notes_internal, torná-lo alcançável) + deleção de **customer** | **8-12h** | LGPD (piloto roda com PII real; ingestão ungated, 5 cópias não-apagáveis, DSR inacessível/incompleto, erasure só p/ users) |
| — | Higiene batch: `message_id → m.id` (~15min, destrava toda dispatch de IA) + `buildDispatchMessages` LIMIT; vincular token de callback ao `:id` (IDOR); HMAC-antes-do-decrypt; harness `status` POST→PATCH + errata canon l.447 (cross-repo); StatusHistory + `created_by`/`confirmed_at` + audit de appointment + matriz de transição (`cancelled→confirmed`/`completed→cancelled`); índices FK (~55 + `customers`, incl. partial-index trap); versão/tag SemVer (22 commits); docs stale (CLAUDE.md §8 + rules harness/db/routes); `rm .claude/state/gap*.js`; `amount_total.max`+currency CHECK; deletar `newOpaqueId`/`verifyStaffRefreshToken`; filtro de org no staff SSE | **~24h** | Contrato harness + agenda-correção + perf GA + LGPD-audit + money-hardening + governança |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status`-callback POST vs PATCH 404 total** (root-cause
  único; backend canon-correto §10.4+ADR-019 Am1; fix harness→PATCH + errata canon l.447); `message_id` não-UUID → ZodError
  **pré-enqueue** em toda dispatch de IA (CAUSA inércia do harness + orphan-pending + MASCARA unbounded/active_execution_id/
  skills); `aborted_*`→400 (bug harness, com backstop), `strategy='failed'`→não-`error` (bug backend), skills vazio,
  `stream`-off, `/traces`-sem-produtor, token-IDOR, `completing`-sem-backstop, callback-base-url ignorado, `/complete`
  tenant não-verificado, `/complete` 409-vs-canon-410. Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` (`messages/schemas.ts:7`)
  **re-confirmado** → `wa`/`ig` do backend causa o drop de outbound (pilot-universal); retries de webhook amplificam a
  perda de inbound (unknown-provider-silent-drop + pre-HMAC amplification).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um
  principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona. A DSR export também é Clerk-only
  → inacessível ao ator semeado.
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`); refund manual
  não passa por webhook; o reconcile de refund Stripe está **DOA (42703), cron-only mas LIVE-wired**; `intent-reconcile`
  half-applies; `reconcile-fifo-starvation`; o money-bug #1 alcança o **webhook Stripe** via `applyChargePaid`
  compartilhado. Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer auth interativa — indisponível
  nesta sessão headless** (reportado; não bloqueante p/ auditoria de código).
- **canon (`bevox-knowledge origin/main` @ `7874971`)** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score
  **Opção C vinculante**), backend/ADR-009 (identidade canônica) não-implementadas; _shared/ADR-019 (bases legais → gate
  consent + aviso + captura), _shared/ADR-020 (retenção → scoping de message_records/received_events, `created_at` de
  servidor, retention worker, DSR deletion + `dsr_requests`). Drifts "canon-atrás-do-código" (`/status` POST↔PATCH l.447,
  `create-refund`, `dead_letter` no enum, `/complete` 410) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra, `origin/master` @ `fd1373b`)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest
  fixa `v1.0.1` (sem os 22 commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem
  principal Clerk); a network-policy do `/metrics` é o único controle do vazamento de org-UUID.
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` desde **09-22** (~5 sem), ainda disparando (com
  atraso: slot 10-26 rodou às 11:34 UTC) → gate agendado dark; causa não-introspectável offline. Os commits de audit são
  **locais** (nunca pushados) → `ci.yml` não roda neles.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs são
  invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-26)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/ db/`
**vazio**; `HEAD` = o commit do próprio audit 10-26; `describe` `v1.0.1-37` (era `-36`).

**Ground-truth (mensurável) — 3ª passada consecutiva com delta-zero nos sinais de CI:**
- **`ci-security` PLATÔ 4ª passada byte-idêntico (agora ao nível de módulo):** **115 vulns / 10 low / 55 moderate / 50
  high** hoje vs 10-26/25/24 — **delta ZERO**, mesmos **19 módulos-high exatos**, `zod@4.4.3` permanece. Tendência
  **12→15→18→49³→50⁴**.
- **`ci-tests`:** RED idêntico (mesmo flaky `booking_notice:259` ~09:04 UTC), com **2× teardown 57P01** (idêntico ao 10-26).
- **`ci-scheduled-runs-dark`:** janela **inalterada** (dark 09-22→10-26). **CORREÇÃO do 10-26:** aquele audit temeu que o
  slot seg-10-26 não tivesse rodado ("não-agenda"); ele **rodou, atrasado ~5,5h** (`40316135563` 11:34 UTC
  `startup_failure`) → os workflows **continuam disparando (atrasados) e falhando no startup**, não foram desabilitados. O
  slot ter-10-27 não apareceu às 09:15 UTC (consistente com o atraso).
- fast-gate GREEN idêntico (Typecheck/Format/OpenAPI-parse/Build+alias-gate/Unit **469/469, 69 files**).

**0 REFUTAÇÕES DE CÓDIGO (6ª passada consecutiva, 10-22..10-27):** nenhum dos 7 agentes refutou um achado de código esta
passada (tentativas adversariais explícitas em AUTH, LGPD, money, harness, schema, routes — todas falharam na evidência).
Ao contrário, a categoria b produziu **4 refutações de claims-novos-plausíveis** (`/complete` drift, 201/200, 409,
query-param — todos sincronizados). As 2 de-claims LGPD do 10-25/26 (âncora transitiva de `message_records`;
`consent_granted_at` imaterial) **STANDES**. `mark-no-show` segue REFUTED; `conversations.priority_score` dormante.

**~16 misses/sharpenings NOVOS (todos latentes / by-design-adjacent / governança — nenhum piloto-bloqueador novo):**
1. **PAYMENTS — raiz estrutural ÚNICA do money-bug #1** (`repository.ts:395-413` void-returns) + **broadening ao webhook
   Stripe** (`webhook-platform.ts:107-120`) + **`expireChargeManually` audita-falso** → 1 fix fecha 3 superfícies. (O mais
   consequente.)
2. **HARNESS — só 1 de 4 callbacks vivo** no harness atual (`/traces` sem-produtor; `/stream` off; `/status` 404); +
   `/complete` 409-vs-canon-410; + correção de wording do `message_id`-poison (parse **após** o INSERT, não "fire-first
   antes de criar execução").
3. **PILOT — mecanismo concreto do worker-black-hole**: `prom-client` registry singleton per-process → counters do worker
   inscrapáveis via o `/metrics` HTTP; + `/readyz` não checa liveness do worker (worker morto invisível); +
   `seed-pilot.test` **false-green** (passa com org não-operacional).
4. **AUTH — `impersonation-id-is-not-organization-id`** (o claim é o PK de impersonation, nunca um UUID de org → modelo
   non-functional); **`audit-log-blind-to-staff-actor`** (actor_id=NULL → read por actor_id nunca casa staff);
   **`staff-ops-org-filter-optional`** (z.string não .uuid).
5. **LGPD — `dsr-export-leaks-notes_internal-while-omitting-profiling`** (over/under-disclosure) + **`erasure-asymmetry`**
   (hard-delete só p/ `users`, não `customers`) + sharpen da âncora transitiva frangível.
6. **SCHEMA — `appointments.confirmed_at` + `OperationalMetricSnapshot` ausentes** (Módulo 16/§8.4); **partial-index
   trap** (13 org-indexed = 10 pleno + 3 parcial); **`staff_impersonations`/`staff_refresh_tokens` FKs sem índice**.
7. **ROUTES — `create-refund`-drift é live-path** (não cosmético).
8. **ORQUESTRADOR — refine `requiredInProd` presence-only é SISTÊMICO** (~19 secrets incl AEAD/Google/Stripe/Meta;
   `AEAD_MASTER_KEY` validado lazy só no 1º uso) → generaliza o `staff-jwt-secret-no-min-length`.

**Correções de linha/contagem:** `describe -37` (era -36); 57P01 = **2×** (idêntico ao 10-26); uuidv7 SQL-default = **15
raw / 14 live** (ai_suggestions dropada em 0005); 45 tabelas, **91 refs**, **18 org-FK fully unindexed** (+3 partial-only →
10 pleno); idempotency `$ref` = **32** (33 occ incl def); inline `.parse` = **148 exato**; issue #36 **OPEN mas
efetivamente resolvida** (harness-contract.test 12/12 passa); prettier debt **resolvido** (Format GREEN); 4-way version
drift; `resolve-organization-id.ts` citado vivo em **~5** docs/config (fora os audits históricos).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH pilot-universal +
métrica-cega); `manual-remark orphan` (HIGH irreversível, reachability Clerk-user); `reconcile-refund-42703` (cron-only);
`callback-token-IDOR`; `rbac-org-role`; `clerk-provisioning`; os mismatches de `/complete` + o `status`-method 404 +
`active_execution_id` + `message_id`-poison; toda a bateria LGPD; autonomia/observabilidade; priority-score/reminders/
templates Marco-2/3; a staleness `.claude`/CLAUDE.md/README; version-drift (22 commits, nenhuma imagem pós-`v1.0.1`);
scheduled-CI-dark.

**Arco desde a passada mais antiga (06-02):** os **3 CRÍTICOs originais** — (1) telefone/`wa_id` nunca persistido no intake
(hoje recaracterizado como o `outbound-provider-vocab`), (2) `seed-pilot` inexecutável nas imagens de prod (**fechado** —
Dockerfile-bug corrigido ~07-19), (3) zero testes de `calendar/booking.ts` (**fechado** — `calendar-booking.test.ts` tem
8 testes) — foram **fechados/recaracterizados**; os 2 CRÍTICOs atuais (grade + calendar no seed) emergiram ~06-23 e
**persistem há ~4 meses**; o gate auth-actor foi isolado no 07-20 e re-confirmado 10×. A frente de CRÍTICOs está **estável e
sem correção há ~4,8 meses**; nesta passada a dívida de segurança do lockfile re-platôou byte-idêntica (50 high, mesmos 19
módulos) pela **4ª vez** e o scanner agendado do GitHub segue dark há ~5 semanas (com o slot 10-26 rodando atrasado, não
ausente — corrigindo a preocupação do 10-26).

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a
**re-verificar de fonte-primária** o inventário do 10-26 do seu domínio contra o **código atual** com evidência fresca
`file:linha`, a **REFUTAR** superestimações (com a lista explícita de refutados/de-escalados a NÃO re-flagar), e a caçar
misses. **5 usaram agent-types locais** deste repo (`.claude/agents/`): `harness-callback-auditor` (l),
`backend-staff-rbac-reviewer` (auth), `backend-schema-migration-engineer` (schema/índices/tracker h), `backend-route-reviewer`
(b), `Security Engineer` (payments j + channels k); **2 general-purpose** (LGPD g; pilot/calendar/obs a+m+e). **Resultado
agregado: inventário do 10-26 re-confirmado pelos agentes, 0 refutações de código (6ª passada consecutiva), ~16
misses/sharpenings NOVOS, 5 refutações adversariais de claims-novos.** Tallies por agente: AUTH confirmed=9/new=3; LGPD
confirmed=14/new=2+1sharpen; PAYMENTS+CHANNELS confirmed=all/new=3; ROUTES confirmed=11/new=0+1sharpen+4refut; HARNESS
confirmed=10/new=4+3refut; SCHEMA confirmed=8/new=5+corrections; PILOT confirmed=all/new=4.

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD -- src/
db/` = vazio; last-commit-touching src/ **e** db/ = `dbd231e`; describe `v1.0.1-37`); origin/main dos 4 repos (backend
dbd231e / canon 7874971 / harness 2979eb0 / meta-api 5516c2a / hub fd1373b, inalterados); os 2 CRÍTICOs (prof_schedules
writer = só test:120 + `createScheduleOverride` escreve overrides; seed-pilot 4 inserts sem calendar); 4 ALTO-âncoras
(requireRateLimit 0 callers; `message_id`=`external_message_id` repo:409; status PATCH routes:56; vocab wa/ig normalize:35/44);
léxico legado (grep triado = zero executável; 3 crus = doc-comments); MFA (seed `generateMfaSecret` + assert; CLAUDE.md §8
stale); debt (0 FIXME/HACK/XXX, 1 @deprecated, 7 TODO Marco-2/3); PCI-nil (grep=0); migrations journal (21=21, 0 raw-uuid);
canon (tracker 10+1, PRD §16.1 "CI verde" verbatim, ADR-statuses 009/010/013/014/018/019/020/021/022/023 aceita, 016
proposed, 011 superseded); env-hardening (refine presence-only sistêmico; LOG_LEVEL debug-prohibido; TEST_AUTH_BYPASS
double-guarded; CORS origin:false; sql.raw(COLS) estático); version-drift (`merge-base --is-ancestor dbd231e v1.0.1` =
FALSE, 22 commits, 4-way); docs-stale (`resolve-organization-id.ts` ABSENT; backend-harness-contract.md/db.md/routes.md
stale); harness cross-repo byte-level (bevox-callback.ts:28 method:POST, :141 /status); CI gates (ci.yml 4 jobs sem
continue-on-error + pg16/redis7; security.yml osv + `pnpm audit --audit-level high` continue-on-error:false + seg-cron;
codeql.yml ter-cron + upload:never; release.yml tags-only); issue #36 OPEN mas harness-contract.test 12/12 passa.

**Ground-truth de CI rodado de fato** (2026-10-27 ~09:00–09:15 UTC): Typecheck ✓ / Format ✓ / Build ✓ (incl. alias
build-gate) / OpenAPI-parse ✓ / Unit ✓ (**469/469, 69 files**) = **GREEN**; `test:integration` = **RED exit 1** (`1 failed |
92 passed (93)`, flaky `booking_notice:259` ~09:04 UTC < 13:00 + **2× teardown 57P01**); `pnpm audit --audit-level high` =
**RED exit 1, 115 vulns / 50 high** (10 low · 55 moderate · 50 high · 0 critical; **19 módulos byte-idênticos ao 10-26**);
`lint` = RED por artefato local (5 `.claude/state/gap*.js` gitignored → CI GREEN; 0 adicionados). **Estado GitHub:** `gh run
list --branch main` → scheduled runs em `startup_failure` (0s) 09-22→10-26 (slot 10-26 às 11:34 UTC, atrasado); slot 10-27
ausente até 09:15 UTC; último run agendado real 09-21.

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree numa feature branch
(`fix/a14-bevox-meta-api-ig-callback-spec`) mas **`origin/main` @ `7874971` (06-03)** — leu-se `origin/main` para
PRD/ADRs/delivery-tracker. Numeração de ADR **colide** entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner / CodeQL
não reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta reais) não
exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de writers/endpoints +
CI rodado (incl. 14 suítes de integração live Postgres+Redis via testcontainers). (4) MCP `stripe` + `claude.ai Google Drive`
requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5) Esta passada é
re-verificação sobre código byte-idêntico ao do 10-26; o valor incremental é **CI fresco (Security byte-idêntico 4ª vez ao
nível de módulo + fast-gate GREEN + Tests RED idêntico; scheduled-dark com a correção do slot 10-26) + 0 refutações de código
(6ª passada) + ~16 misses/sharpenings NOVOS (2 de valor real: raiz-única do money-bug + mecanismo do worker-black-hole) + 5
refutações adversariais + as 2 de-claims LGPD STANDES + correções de linha/contagem**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-27. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
