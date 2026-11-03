# Gap Analysis — bevox-backend — 2026-07-22

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo
> segundo a documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente
> real: login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais deste repo — `harness-callback-auditor`,
> `backend-route-reviewer`, `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`,
> `engineering-security-engineer` — + 2 general-purpose para LGPD e calendar/pilot), cada um **re-verificando de
> fonte primária** o inventário do 07-21 contra o código **atual** com evidência fresca `file:linha`, instruídos a
> **REFUTAR** superestimações + caçar misses; **verificação independente pelo orquestrador** dos achados-manchete +
> das 2 descobertas NOVAS direto no código; e **CI rodado de fato** (2026-07-22 ~06:06–06:10 local / ~09:06–09:10
> UTC, não inferido; logs em `.claude/state/ci-2026-07-22/`). Sucede `runtime-gap-audit-2026-07-21.md`.

## Resumo executivo

**8ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~7
semanas.** Prova executada: `git diff dbd231e..HEAD -- src/ db/` é **vazio** — o produto está byte-idêntico desde
`dbd231e` (2026-06-03); os únicos commits desde então são docs/audit + o bootstrap `.claude/`. Canon
`bevox-knowledge` `origin/main` @ `7874971` (06-03), `bevox-harness` `origin/main` @ `2979eb0` (06-03),
`bevox-meta-api` `origin/main` @ `5516c2a` (06-22) — **todos inalterados vs 07-21**. Backend `origin/main` também
@ `dbd231e` (local ahead 8 = só docs). O valor desta passada é **re-verificação independente de fonte-primária +
CI fresco + caça a misses**, não descoberta de regressão. Os 7 auditores + o orquestrador **CONFIRMARAM 100% do
inventário de código do 07-21 (0 refutações de achado de código)**, isolaram **2 defeitos NOVOS de código reais**
que as 7 passadas anteriores perderam, e produziram **3 de-escalações/refutações-de-escopo** + 1 correção de
contagem.

**Manchete NOVA #1 — bug de runtime certo no reconcile de refund (Stripe-path).** `reconcile.ts:256-258` faz
`UPDATE refunds SET status=…, updated_at = now()`, mas a tabela `refunds` **não tem coluna `updated_at`**
(`db/schema/payments.ts:149-172` — só `createdAt`; o próprio comentário `:7` diz "updated_at adiado a P3/P4 na
reconciliação"). Logo **toda** transição de refund stuck lança Postgres **42703 (undefined_column)** → capturada
(`reconcile.ts:262`) → `failCount++` → o status **nunca** sai de `pending`. O cron de reconcile de refund está
**dead-on-arrival**, compondo com `reconcile-cron-skips-applyChargeRefunded` (não é só falta de orquestração — ele
não consegue nem atualizar a row). O path **manual** de refund (`updateRefundStatus`, `repository.ts:481`, sem
`updated_at`) funciona → **não é blocker do money-path manual do piloto**; é ALTO-GA (Stripe-path deferido). Fix:
1 linha (remover `updated_at`) ou migration adicionando a coluna. **Miss das 7 passadas anteriores.**

**Manchete NOVA #2 — token de callback não-vinculado ao `:id` da URL (IDOR cross-execution).** O preHandler dos 4
callbacks resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:67`,
`req.executionContext`), mas **todo** handler age sobre o `:id` **da URL** (`harness-callbacks.routes.ts:73,91,
113,142`) e **nunca** compara os dois. Um token válido para a execução A pode dirigir `/status`,`/traces`,`/stream`,
`/complete` contra **qualquer** execução B (inclusive de outra org) → escrita cross-execution/cross-tenant
autenticada-mas-não-autorizada. A conformance `four-callbacks-token-gated` (token ruim → 401) **continua
verdadeira** — as duas coexistem: o token prova autenticidade, não autorização-para-este-recurso. **Inerte no
piloto** (harness undispatched → nenhum token cunhado → sem superfície), dispara em Marco-2. — Esforço: **1h** (uma
asserção `executionContext.execution_id === id` → 403). **Miss das 7 passadas.**

**O piloto morre no passo 2 ("ver agenda"), triple-gated — inalterado e re-verificado de fonte-primária.**
(a) O `seed-pilot` provisiona só um `staff_account` (JWT **HS256**), mas **toda** rota de calendar exige
`requireClerkAuth()` (**RS256** + claim `organization_id`, `clerk-auth.ts:89,105-108`) e **nenhuma** rota de
calendar pareia `requireStaff` (`grep requireStaff src/modules/calendar/` = 0) → o principal semeado toma **401
antes** dos CRÍTICOs (gate de **provisionamento Clerk/ops**). *Se um JWT Clerk for provisionado à mão:*
(b) `availability.ts:75 notFound("Calendar")` — **zero writers de `calendars`** em qualquer seed; (c) grade vazia →
`availability.ts:126 if(!sched) continue` → `slots:[]` → `booking.ts:207 slot_conflict` em 100% — **zero writers de
`professional_schedules`** (único INSERT = fixture `calendar-booking.test.ts:120`). Os dois CRÍTICOs (b/c) **não têm
workaround de produto**. **Fix mínimo dos CRÍTICOs ≈ 2-3h** (seedar Calendar + grade Seg-Sex). `WeeklySchedule` é
entidade canônica nomeada (PRD §5.3; backend/ADR-010 aceita) → gap contra entidade nomeada, não deferimento.

**"CI verde" — o único critério mensurável de Marco-1 (§16.1) — está RED em 2 jobs, e o Security PIOROU de novo.**
Ground-truth executado 2026-07-22: **Typecheck ✓ / Format ✓ / OpenAPI ✓ / Build ✓ / Unit ✓ (469/469, 69 files)
GREEN**; **Tests RED** (`test:integration` exit 1: `1 failed | 92 passed (93)` — mesmo flaky
`calendar-booking.test.ts:14` "booking_notice" dependente de hora-do-dia [rodei ~09:06 UTC < ~13:00 UTC threshold →
`booked` em vez de `slot_conflict`, `AssertionError` `:219`] + teardown **57P01** por não fechar `closeDb/closeRedis`
no `afterAll`); **Security RED e PIOR** (`pnpm audit --audit-level high` exit 1: **36 vulns — 3 low / 15 moderate /
18 high**, vs **33 / 15 high** no 07-21 → **+3 total, +3 high** só por advisories novos acumulando sobre o lockfile
**congelado**; NOVO high prod-runtime: `fast-uri` via `@fastify/swagger`+`fastify/ajv`, GHSA-v2hh-gcrm-f6hx; +
`@opentelemetry/propagator-jaeger`). O **lint-RED é artefato local** (5 `.claude/state/gap*.js` **gitignored** →
`git check-ignore` confirma os 5 → checkout de CI limpo NÃO os vê → **CI lint GREEN**); esta sessão NÃO acrescentou
nenhum (usou Agent tool, não Workflow). **A dívida de segurança cresce mesmo sem tocar código: 12 → 15 → 18 high
nas últimas 3 passadas.**

**Money-path manual do piloto FUNCIONA, com o mesmo 1 bug HIGH re-confirmado de fonte-primária.**
`manual-remark-inserts-orphan-paid-payment`: `applyChargePaid` chama `insertPayment` **incondicionalmente**
(`service.ts:891`) após `markChargePaid` (guardado `WHERE status='pending'`, void sem rowcount, `repository.ts:
395-398`) → charge terminal (`expired`/`refunded`) re-marcada paga insere payment `paid` órfão **+ confirma
appointment + concede pacote** no no-op (`service.ts:901-903,915-924`) → corrupção de estado, não só payment
fantasma. Root-cause compartilhado alcança o path Stripe. Fix: gatear `insertPayment`+side-effects no rows-affected
de `markChargePaid`. ~2h.

**Caminho de fechamento do piloto curto e inalterado:** 2 blockers de agenda (≈ 2-3h) + gate de CI (flaky+teardown
≈ 0,5h; audit bump ≈ 2-3h) + gate de auth-actor (ops, ou ~4-6h) ≈ **5-9h**. Severidades ancoradas no gate do
**piloto**; para GA vários ALTO/MÉDIO sobem (vocab de canal e POST/PATCH 404 viram CRÍTICO de GA; o token-binding
IDOR e o refund-DOA sobem para CRÍTICO/ALTO de GA).

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária (imprecisões herdadas, re-confirmadas nesta passada):

1. Os **4 callbacks** que o backend expõe são **`/status`, `/traces`, `/stream`, `/complete`**
   (`src/integration/harness-callbacks.routes.ts`) — **não** `/complete,/artifact,/tool-result,/turn` como o brief
   lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (não "channels"). Channels = **_shared/ADR-011**.
   backend/ADR-018 = refund/cancellation policy (correto no brief). backend/ADR-014 = PSP Stripe Connect (verificado
   canon: **um** endpoint webhook `/api/v1/webhooks/stripe`, l.134); backend/ADR-023 = manual payment mode
   (**`status: aceita`**, 2026-05-22 — verificado); backend/ADR-010 = calendar (WeeklySchedule).
3. O grep `account_id\b` do brief captura compostos **sancionados** (Stripe/Chatwoot) + doc-comments do rename; o
   léxico proibido **executável** é **ZERO** (invariante §4.1 mantida — não-gap). Ver categoria c.
4. Código congelado desde **06-03** (`dbd231e`), não 06-04.
5. Numeração de ADR **colide** entre `backend/` e `_shared/` (008–023) — **sempre qualificada** abaixo.
6. **RBAC de staff é canon backend/ADR-013** (roles l.~108), **não ADR-022** (backend/ADR-022 = policy-json). A
   rule local `.claude/rules/backend-routes.md` mis-cita "ADR-022 staff RBAC" — ver BAIXO/governança.

## Calibração canônica (lida do canon frozen — PRD §13 roadmap + §16 prontidão)

- **§16.1 Marco-1** ("Pronto para integração") = repo + **CI verde** + migrations pg16 + módulos
  **auth/organizations/users/professionals/services/customers** + **OpenAPI publicado** + contrato harness
  documentado+testado com stub + deploy staging. **Calendar e Payments NÃO estão em Marco-1.** ⇒ o único
  bloqueador **mensurável** de Marco-1 é **CI-verde (RED)**.
- **§16.2 Marco-2** = calendar, conversations, messages, channels, ai-pipeline, autonomy; fluxos 1/2/3 e2e; token
  accounting; idempotência tools mutação; métricas Prometheus; cobertura ≥70%.
- **§16.3 Marco-3** = payments (Stripe Connect), reminders, faq, rules, audit, observabilidade; WhatsApp direto;
  circuit breaker; OTel completo; **LGPD DSR/retenção/consentimento**; **MFA TOTP**; SLO.
- **Fato estrutural:** o código entrega muito além de Marco-1 (calendar, payments, channels, autonomia,
  observabilidade parcial) — o README "Marco 1 bootstrap" **subdeclara** o que existe. O piloto exercita calendar
  (§16.2) + payments-manual (§16.3, ADR-023 aceita) independentemente do rótulo → os 2 CRÍTICOs são
  **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".
- **§5.6/ADR-023:** Manual Payment Mode (aceita) é o money-path do piloto; split Stripe Connect é repurposado p/
  assinatura SaaS → gaps de split/reconcile Stripe são deferimentos legítimos (mas o `refund-reconcile` **quebrado**
  vira dívida-de-código nomeada, não só deferimento).

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-07-22) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO); `no-appointments-read-endpoint` (ALTO); ADR-020 templates + ADR-021 priority-score não-materializados |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recontagem independente idêntica: **106 rotas / 80 paths / 95 ops / operationId:0 / 0 phantom / 11 undoc**; `charge_type`-drift **REFUTADO**; NEW `handlers-outside-routes.ts` + `checkout` Zod/YAML/DB divergence |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO** (3 `workspace_id` doc-comment + 6 `account_id` = 5 doc-comment do rename + 1 alias financeiro `AS account_id`) |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | `mfa.ts:34` blocklist + seed gera base32 (`seed-pilot.ts:153`); literal só em doc-comment `mfa.ts:66`; login não rejeita = **correto** (Marco-3); `CLAUDE.md §8` stale |
| e | Testes faltando (hot paths) | ✅ | availability(rota)/reschedule/webhook Stripe(`constructEvent`=0)/inbound-vocab — zero e2e |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; 1 `@deprecated`; TODOs todos Marco-2/3 |
| g | LGPD | ✅ | `ai_opt_out` armazenado-não-aplicado (vetor vivo); `received_events`/`message_records` PII-cru não-apagável; DSR export existe/deleção ausente |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main); nenhum work-item p/ calendar/ADR-010 → grade CRÍTICA **invisível** ao tracker; "delivered" ≠ pilot-ready |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky+teardown) + Security RED **PIOR (18 high / 36)**; lint-RED = artefato local gitignored |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH**; **NOVO** `reconcile-refund-updated_at-DOA`; PCI-nil; conformances confirmadas |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH** (cross-repo re-verif: backend "wa" vs meta-api enum pleno); 2 perdas de inbound; HMAC correto |
| l | Harness dispatch | ✅ | `POST/PATCH 404` (backend canon-CORRETO 3:1); **NOVO** token-binding IDOR (ALTO) + active_execution_id-wedge; idempotency-em-callbacks **REFUTADO** |
| m | Alçapões do piloto | ✅ (traçado) | **triple-gated** (auth-actor + calendar + grade) inalterado; money-path manual OK com 1 bug HIGH; 4º gate (payment account não-semeado) |
| n | Delta vs audit anterior | ✅ | 07-21 re-verificado; **0 refutações de código**; 2 NOVOS bugs reais; 3 de-escalações; Security-RED pior |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN — PASSA, classe de token errada.** `seed-pilot` cria org + `bevox_admin`; `POST /staff/sessions` cunha
   JWT staff **HS256** (`staff-auth.ts:82`). Só serve a rotas `requireStaff`. Sem rate-limit/lockout
   (`auth/routes.ts:90-94`).
2. **VER AGENDA — QUEBRA na AUTH primeiro.** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`calendar/routes.ts:22,28,48`; `clerk-auth.ts:89`) + claim `organization_id` → token staff HS256 → **401**.
   *Se JWT Clerk à mão:* → `availability.ts:75 notFound("Calendar")` (**CRÍTICO b**). *Se Calendar à mão:* → grade
   vazia → `slots:[]` (**CRÍTICO c**). Sem `GET /appointments` → ver agendamentos feitos não tem rota REST.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100%. Reschedule/transition têm 4 defeitos
   de correção (não-atômico, self-overlap, idempotência fina, transição sem guard); create/reschedule/transition
   não gravam `audit_events` (§12.8).
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** `charges/manual` + `mark-paid` →
   `applyChargePaid` concilia o ledger. **Pré-requisitos escondidos:** service semeado `requires_prepayment=false`
   (`catalog.ts:67`; hook auto-charge nunca dispara) **e** `seed-pilot` não cria `payment_accounts` → precisa de
   `POST /payment-account/connect-manual` à mão antes (mesmo gate Clerk upstream). **1 bug HIGH:** re-mark de charge
   terminal insere payment `paid` órfão + confirma appointment + concede pacote.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile
   de paid/cancelled cru sem orquestração; **reconcile de refund DOA (42703)**. Modo manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[CHANGED]`/`[REFUTED]` = status vs 07-21; **(v: …)** = verificação independente
(orquestrador fonte-primária, ou agente com evidência fresca); `[xrepo]` = dependência cruzada. Severidade
ancorada no gate do **piloto**; escalonamento p/ GA anotado. `file:linha` = evidência lida **nesta** sessão sobre
código byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO — orquestrador grep + agente calendar)** —
  Nenhum caminho de produção escreve `professional_schedules` (grade semanal-base). Único `INSERT` = fixture
  `test/integration/calendar-booking.test.ts:120`. Produção só lê (`availability.ts:116`); `:126 if(!sched)
  continue` esvazia todo dia → `slots:[]` → `booking.ts:207 slot_conflict`. Sem CRUD de WeeklySchedule, sem Zod
  body, sem repo writer, sem símbolo `weeklySchedule` (grep=0). Nem `db/seed.ts` (só `systemHolidays`) nem
  `seed-pilot` escrevem grade. Escopo §5.3 (backend/ADR-010 aceita). — Impacto: 100% dos agendamentos =
  `slot_conflict`. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (só seedar grade). **#1.**
  `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO — orquestrador + agente)** —
  `seed-pilot.ts:109,156,195,217` insere só org/staff/professional/service. Zero `calendars` (`createCalendar`
  `repository.ts:20` nunca chamado) → `availability.ts:75 notFound("Calendar")`. `system_holidays` omitido é
  **fail-open** (`availability.ts:108-111` vazio → `isSystemHoliday=false`), **não** co-bloqueador. — Esforço:
  **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO — orquestrador + agente + grep)** —
  seed provisiona **só** um `staff_account` (HS256, `staff-auth.ts:82`); toda rota de calendar é `requireClerkAuth()`
  RS256 (`calendar/routes.ts:22,24`; `clerk-auth.ts:89`) + claim `organization_id` → token staff rejeitado.
  `grep requireStaff src/modules/calendar/` = **NONE**. É gate de **provisionamento Clerk/ops** (o principal Clerk
  do piloto não é semeado), sobrepondo `clerk-user-provisioning-broken`; sit **upstream** dos 2 CRÍTICOs. —
  Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-07-22; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-teardown`** `[carry]` **(v: RODADO)** — `pnpm test:integration` =
  **RED exit 1**, `1 failed | 92 passed (93)` · `1 file | 13 passed (14)`. Falha =
  `calendar-booking.test.ts:14` "slot_conflict quando start_at < now() + booking_notice_minutes"
  `AssertionError: expected 'booked' to be 'slot_conflict'` (`:219`) — o gate só dá `slot_conflict` se
  `now() > ~13:00 UTC`; rodei ~09:06 UTC → `booked`. + teardown **57P01** (6 ocorrências — suíte não fecha
  `closeDb/closeRedis` no `afterAll`, testcontainer derrubado com conexões vivas). `ci.yml` job `Tests` roda sem
  `continue-on-error` → falha o CI de fato. — Esforço: **0,5h** (slot `now()`-relativo + `await closeDb()/
  closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-18-high`** `[carry, CHANGED — PIOR de novo]` **(v: RODADO)** — `pnpm audit
  --audit-level high` = **RED exit 1, 36 vulns (3 low · 15 moderate · 18 high)** vs **33 / 15 high** no 07-21 →
  **+3 high, +3 total**, só por advisories novos sobre o **lockfile congelado**. Módulos high distintos (12):
  `@grpc/grpc-js`, `@opentelemetry/{auto-instrumentations-node,exporter-prometheus,propagator-jaeger,sdk-node}`,
  `protobufjs`, `undici`, `fast-uri`, `js-yaml`, `brace-expansion`, `tmp`, `vite`. **NOVOS vs 07-21:** `fast-uri`
  (prod-runtime — `@fastify/swagger`→`json-schema-resolver`→`fast-uri` **e** `fastify`→`@fastify/ajv-compiler`→`ajv`
  →`fast-uri`, 10 paths; GHSA-v2hh-gcrm-f6hx host-confusion) + `@opentelemetry/propagator-jaeger`. Dev-only: `tmp`
  (testcontainers), `vite` (vitest), `brace-expansion`, `js-yaml`. `security.yml continue-on-error:false` →
  hard-fail. **Tendência: 12→15→18 high nas 3 últimas passadas — dívida cresce sem tocar código.** — Esforço:
  **2-3h** (bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri). **#3.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA/outbound/staff-approve ligar)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(v: CONFIRMADO — Security Engineer cross-repo)**
  — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:35,44`) e **persiste `"wa"`** em
  `channel_connections.provider` (`routes.ts:237,246` → `repository.ts:69`; coluna `notNull()` **sem CHECK**,
  `db/schema/channels.ts:22`). Outbound null-coage não-pleno (`metaapi/repository.ts:197`) → guard `seams.ts:360` →
  `skipped_missing_recipient` (`:376`); `isDeliveryFailure` exclui skips (`seams.ts:122-124`) → execução fica
  `done` (falso-sucesso). **Alcançável NO piloto via staff-approve.** `bevox-meta-api` `origin/main` exige enum
  pleno no fio (`messages/schemas.ts:7,30 z.enum(["whatsapp","instagram"])`) → `wa`/`ig` é invenção 100% backend
  auto-inconsistente. — Impacto: 100% das respostas a conversas reais descartadas em silêncio. — Esforço: **3-4h**
  (unificar vocab + CHECK + backfill + teste e2e). **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, broadened]` **(v: CONFIRMADO — Security Engineer +
  orquestrador fonte-primária)** — `applyChargePaid` chama `insertPayment` **incondicional** (`service.ts:891`) após
  `markChargePaid` (guardado `WHERE status='pending'`, void sem rowcount, `repository.ts:395-398`). `insertPayment`
  dedupa por `ON CONFLICT(org,provider_payment_id,status)` com id determinístico `manual:<id>` (`manual.ts:109`,
  `repository.ts:439`). `markChargePaidManually` **não** tem status-gate (por design, `service.ts:415-416`).
  Re-mark de `expired` (`expireChargeManually`, cash-pay tardio — o mais plausível) ou `refunded`
  (`markPaymentReversed` libera o slot único) → orphan `paid`; **`cancelled` só existe no path Stripe**. No no-op,
  `applyChargePaid` **também** dispara `confirmAppointmentIfUnconfirmed` (`:901-903`) + grant de pacote
  (`:915-924`, expired+sem-validity_days concede em charge não-paga) → **corrupção de estado**. Root-cause
  compartilhado alcança o path **Stripe** (`webhook-platform.ts:108`, baixa reachability lá por event.id dedupe).
  Fix: `markChargePaid` retornar rowcount (`RETURNING`) e gatear `insertPayment`+side-effects. — Esforço: **2h**.
  **#4.**
- **`reconcile-refund-writes-phantom-updated_at-column`** `[NOVO]` **(v: CONFIRMADO — Security Engineer +
  orquestrador fonte-primária)** — `reconcile.ts:256-258 UPDATE refunds SET status=…, updated_at = now()`, mas
  `refunds` **não tem** `updated_at` (`db/schema/payments.ts:149-172`; só `createdAt:164`; comentário `:7` diz
  "updated_at adiado a P3/P4 na reconciliação"; nenhuma migration adiciona a coluna) → **Postgres 42703** em toda
  transição → capturado (`:262`) → `failCount++` → status **nunca** sai de `pending`. O reconcile de refund está
  **DOA**; compõe com `reconcile-cron-skips-applyChargeRefunded` (não é só falta de orquestração — a row não
  atualiza). Path manual (`updateRefundStatus`, `repository.ts:481`, sem `updated_at`) funciona → **inerte no piloto
  manual**; Stripe-path ALTO-GA. — Esforço: **0,25h** (remover `updated_at`) ou **1h** (migration + coluna). **#6.**
  `[xrepo: Stripe]`
- **`callback-token-not-bound-to-path-execution-id`** `[NOVO]` **(v: CONFIRMADO — harness agent + orquestrador
  fonte-primária)** — o preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token**
  (`execution-token.ts:67`, `req.executionContext`), mas **todo** handler age sobre o `:id` **da URL**
  (`harness-callbacks.routes.ts:73,91,113,142`) e **nunca** compara os dois → token válido para A pode escrever em
  qualquer execução B (inclusive de outra org) via `/status`,`/traces`,`/stream`,`/complete` (IDOR
  cross-execution/cross-tenant). A conformance `four-callbacks-token-gated` (token ruim→401) **permanece**; o token
  prova autenticidade, não autorização-para-o-recurso. **Inerte no piloto** (harness undispatched → nenhum token
  cunhado); dispara em Marco-2 (então **CRÍTICO-GA**). — Esforço: **1h** (asserção `executionContext.execution_id
  === id` → 403). `[xrepo: bevox-harness]`
- **`harness-status-callbacks-post-vs-patch-404`** `[carry]` **(v: CONFIRMADO byte-level nos 2 repos + canon —
  reframe 3:1)** — Harness POSTa **todo** callback (`bevox-callback.ts:28 method:"POST"`); backend registra **só**
  `app.patch(".../status")` (`harness-callbacks.routes.ts:56`) → Fastify **404** → mata todos os status callbacks
  incl. `dead_letter` autoritativo. **REFRAME:** backend é **canon-CORRETO** — PRD §10.4 l.1076 + l.817 PATCH vs
  stale §10.1 l.447 POST; o harness + PRD-l.447 é que estão stale. Fix = **cross-repo** (harness→PATCH + errata
  canon), **não** edit de backend. Inerte no piloto (harness undispatched). — Esforço: **3h**. **#7.**
  `[xrepo: bevox-harness + canon]`
- **`completion-never-clears-active-execution-id`** `[NOVO]` **(v: harness agent — agente-rated CRÍTICO-pipeline;
  dependência de dispatch-guard não re-traçada pelo orquestrador)** — `/complete` (`harness-callbacks.routes.ts:
  138-201`) faz lock/finalize/audit mas **nunca** nula `active_execution_id` da conversa
  (`orchestration/repository.ts:196`) → conversa silenciosamente travada no turno-2+ (sem novo dispatch/audit). —
  **Inerte no piloto** (harness undispatched); ALTO-GA/Marco-2 (agente rateou CRÍTICO para o pipeline). Requer
  confirmação do guard de dispatch antes de tratar como settled. — Esforço: **3h**. `[xrepo: bevox-harness]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — sweep de rotas)** — Não existe `GET
  /appointments` nem `GET /appointments/:id`; `calendar/routes.ts:28,33,41,48,71,99,131` expõe só /calendars,
  schedule-overrides, availability, appointments(POST-create), PATCH-reschedule, 4 POST-transition. §10.1 (l.965-967)
  também não o enumera, mas a persona mobile ("agenda do dia") + Fluxo 3 (§8.3) exigem → agendamentos write-only
  sobre REST. — Esforço: **3-5h**. `[xrepo: PRD §5.3/§8.3]`

**Auth / segurança (Marco-1; alguns mitigados no piloto 1 org/1 admin) — todos CONFIRMADOS pelo agente RBAC**

- **`staff-jwt-secret-no-min-length`** `[carry]` **(v: CONFIRMADO)** — `env.ts:60 STAFF_JWT_SECRET: optionalString`;
  refine de prod é **presence-only** (`:205-206 if(!val[key])`) → secret de 1 char passa; `staff-auth.ts:48-54,69-75`
  assina HS256 com ele. Secret fraco = forjável offline → JWT staff forjado = compromisso **total** do plano staff
  (cross-org + impersonation). — Esforço: **0,5h** (`.min(32)`). **O buraco de segurança mais duro do conjunto.**
- **`staff-login-no-ratelimit-no-lockout`** `[carry]` **(v: CONFIRMADO)** — `auth/routes.ts:90-94` login + `:97-101`
  refresh sem `preHandler`; sem contador/lockout (`service.ts:64-90`); `requireRateLimit` (`rate-limit.ts:146`)
  aplicado a **zero** rotas; bcrypt cost 12 é o único freio → brute-force online contra `staff@example.com` (semeado).
  — Esforço: **3h**.
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — enumeração completa)** — `requireRole` só existe
  como 3 TODOs (`clerk-auth.ts:25`, `auth/repository.ts:261`, `types/global.d.ts:35`); zero impl/caller;
  `clerk-auth.ts:109 role = … ?? "member"` não-sanitizado (nem é valor válido do enum). Rotas cliente mutantes
  **sem gate de papel** (só `requireClerkAuth+requireOrganizationScope`): money (`payments/routes.ts:62,95,105,167,
  187,274,284,295,306,318`), destrutivas (`DELETE/PATCH professionals|services /:id`), org config (`PATCH
  org/settings`+`onboarding/advance`+`PATCH autonomy`), approval (`executions/:id/{approve,edit,reject}`), PII
  (`customers` POST/PATCH+facts), waitlist. Qualquer JWT org-member roda tudo. Blast-radius baixo no piloto
  (1 org/1 admin). — Esforço: **8h**. `[xrepo: backend/ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO — mais forte vs canon)** — `auth/repository.ts:
  221-224 SELECT organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna
  clerk-**user**-id) + `routes.ts:169-171 orgClaim = organization_id ?? clerkUserId` → org-claim nunca casa;
  no-claim resolve a própria row do user → 1º user de uma org é inprovisionável (chicken-and-egg); webhook só trata
  `user.*` (`:165-190`), sem `organization.created`. Mitigado no piloto (seed); alimenta o gate auth-actor. —
  Esforço: **5h** (+ADR mapping org). `[xrepo: Clerk]`
- **`clerk-jwt-no-aud-iss-validation`** `[carry]` **(v: CONFIRMADO)** — `clerk-auth.ts:89-92` verifica só
  `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` confiável vem em claim
  não-verificada. Alg-confusion bloqueado, JWKS pinado (mitigantes; o staff-side É melhor — checa `audience`). —
  Esforço: **1h**.
- **`impersonation-id-is-not-organization-id`** `[carry]` **(v: CONFIRMADO — bug real)** — `auth/service.ts:135-139`
  seta a claim `impersonation_id` ao **PK da row `staff_impersonations`** (`repository.ts:153-160`), mas
  `organization-scope.ts:57` retorna esse PK como org id → em rota `:organization_id` sempre 403; em rota
  param-less `req.organizationId` = PK (escopo lixo). Latente/fail-closed (nenhuma rota pareia `requireStaff`+
  `requireOrganizationScope`). — Esforço: **2-3h**.

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real) — CONFIRMADOS pelo agente LGPD**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` **(v: CONFIRMADO — vetor vivo, headline LGPD)** —
  `ai_opt_out` gravado/lido só no CRUD (`customers/repository.ts:21,26,67`; **zero** outros readers — grep prova);
  `cutoff.ts:49-76` resolve modo + `buildDispatchMessages` (`orchestration/repository.ts:397`, `content_text` cru)
  + `dispatchExecution` **sem** carregar o customer nem checar `ai_opt_out` → cliente que revoga consentimento ainda
  tem a conversa mandada ao LLM externo (transferência intl, _shared/ADR-019 item 7). `consent_granted_at` = **zero
  writers**. Dispara no instante em que o pipeline inbound liga. — Esforço: **4-6h**. **#10.** `[xrepo]`
- **`waitlist-priority-score-client-settable`** `[carry]` **(v: CONFIRMADO — agente schema)** — backend/ADR-021
  (aceita) fecharia o vetor tornando `priority_score` **derivado pelo sistema**; mas `waitlist/routes.ts` escreve
  do input do cliente e `match.ts` ordena pelo valor armazenado (`calendar.ts:204` numeric writable); colunas
  `urgency_level`/`skip_count`/`last_score_update` + fórmula + cron **não existem** → furar-fila continua aberto. —
  Esforço: **6-8h**. `[a/g; ADR-021]`

### MÉDIO (degrada qualidade)

**Observabilidade — worker é buraco-negro triplo (harness inerte no piloto, exceto observabilidade que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry]` **(v: CONFIRMADO — orquestrador grep + agente;
  ALTO-operabilidade)** — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca** `import "./instrument.js"`
  nem `initTelemetry()` (ambos só em `src/index.ts:17,30`; `queue/index.ts:62` importa só
  captureException+shutdownTelemetry) → no worker o Sentry `captureException` (`:272,313`) é drop silencioso e o
  OTel NodeSDK nunca inicia p/ **toda a metade assíncrona** do piloto (ingestion, cutoff→dispatch, timeout/expiry,
  2 crons de reconcile, google sync, waitlist, package-expiry). — **1h** (import + `await initTelemetry()`). **Alto
  valor / baixo esforço.**
- **`worker-process-has-no-metrics-scrape-endpoint`** `[carry]` **(v: CONFIRMADO — agente)** — `/metrics` é servido
  **só** pelo HTTP server (`health/routes.ts:24`, registrado `server.ts:189`); o worker **não** sobe listener HTTP →
  counters prom-client do worker (reconcile) **permanentemente não-scrapáveis**. 3º pilar morto. — **1-2h**.
- **`domain-prometheus-metrics-not-registered`** `[carry]` **(v: CONFIRMADO — agente)** — `shared/metrics.ts:22-166`
  não registra os 4 de §12.10 (`charges_succeeded_total`, `appointments_no_show_rate`,
  `executions_pending_approval_count`, `executions_timeout_total`) nem os de §13.3 (`executions_total`,
  `charges_total`, `queue_jobs_completed_total`). `charges_succeeded`/no-show relevantes ao piloto. — **4h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` — `realtime/publish.ts:8-13` união fechada a
  `execution.*`/`waitlist.offered`; `appointment.created`(§8.3)/`charge.updated`(§8.4/§10.1) **nunca** emitidos →
  tela do profissional não auto-atualiza no agendar/pagar. — **3h**.

**Agenda — correção de dados quando exercitada (Marco-2; todos CONFIRMADOS pelo agente calendar)**

- **`appointment-mutations-no-auditevent`** `[NOVO]` **(v: CONFIRMADO — agente calendar)** — canon §12.8 (l.1346)
  manda Appointment C/U/D → AuditEvent; `booking.ts:219-516` (create/reschedule/transition) grava **zero**
  `audit_events` (só charge audita `:291,326`); autonomy + onboarding idem silentes → trilha de auditoria ausente no
  fluxo-núcleo do piloto (paraleliza `customer-pii-mutations-unaudited`). — **M (3-4h)**.
- **`reschedule-non-atomic-double-book`** `[carry]` — `booking.ts:373` create+outbox Google commita na própria tx
  (`:223`); `:390-414` cancela o antigo em tx **separada** → crash entre as duas = 2 appointments ativos. — **2-3h**.
- **`reschedule-self-overlap-always-conflicts`** `[carry]` — recount conta o appointment antigo (ainda `scheduled`;
  `availability.ts:169`+`booking.ts:229` excluem só `'cancelled'`, nunca self-id) → `max_concurrent=1` → qualquer
  remarcação sobrepondo = `slot_conflict`. — **2h**.
- **`appointment-transition-no-state-guard`** `[carry]` — `booking.ts:445` UPDATE any→any (só row-existence guard);
  `cancelled→completed` aceito → decremento de pacote (`:485-499`) consome sessão de appointment cancelado. — **2h**.
- **`reschedule-thin-idempotency`** `[carry]` — `booking.ts:387 idempotencyKey:undefined` → NULL (`:242`);
  `idemHit/idemStore` no-op → única defesa é `requireIdempotency` HTTP. §5.3 l.396 exige idempotência na criação. —
  **1-2h**.
- **`availability-n1-count-plus-92day-serial-loop-unbounded`** `[carry]` **(v: CONFIRMADO — agente; GA-scaling/DoS)**
  — `availability.ts:167` COUNT(*) **por-slot** em loops por-membro(`:114`)×por-intervalo(`:160`)×por-slot(`:162`);
  `routes.ts:52` itera `date_from..date_to` **serial** até 92 dias (`schemas.ts:29`). ~1.470 queries seriais/request.
  Guardado por auth mas não rate-limited. Não pilot-blocking (1 prof). — **4-6h**.
- **`pilot-service-prepay-false-and-no-payment-account`** `[NOVO — merge de 2 carries afiado]` **(v: CONFIRMADO —
  agente calendar + Security Engineer)** — service semeado `requires_prepayment=false` (`catalog.ts:67`;
  `seed-pilot.ts:217-226`) → hook auto-charge nunca dispara (`booking.ts:277`); `seed-pilot` não cria
  `payment_accounts` (grep=0) → charge manual (`payments/routes.ts:105`) também falha `createCharge` até
  `connect-manual` à mão. 4º gate do money-path (mesmo gate Clerk upstream). — **M (ops OU 0,5h seed)**.
  `[xrepo: hub runbook]`

**Contrato backend↔harness (mismatches; persistem — todos INERTES no piloto, ALTO-GA) — CONFIRMADOS pelo agente harness**

- **`complete-failed-strategy-not-mapped-to-error`** `[carry]` **(v: CONFIRMADO — único bug de código
  backend-vs-canon do contrato)** — `strategy:"failed"`; proposals vazias → `inferSuggestionType→"reply"`
  (`complete-service.ts:30`); manual/copilot (modo do piloto) → `waiting_approval`. Nunca `error`. Canon (PRD l.1146
  + backend/ADR-019 l.163) exige `error`. — **3h**. `[xrepo]`
- **`complete-trusts-body-organization-id-over-authoritative-row`** `[carry, MÉDIO — sharpened pelo agente]** **(v:
  CONFIRMADO)** — `/complete` lê tenant do **body** (`harness-callbacks.routes.ts:150-154 bodyOrgId ?? row`) sem
  checar `=== existing.organization_id` (traces/stream usam a row — assimetria); dirige audit/proposals/delivery.
  Inalcançável na prática (harness omite org do `/complete`). — **1h**. `[xrepo]`
- **`complete-rejects-aborted-strategies-400`** `[carry]` **(v: CONFIRMADO — bug de HARNESS)** — harness emite
  `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2096`); enum backend omite (`harness-callbacks.schema.ts:
  57`) → ZodError → 400. Canon fica com o backend (l.1075). — **2h** (harness). `[xrepo]`
- **`completing-state-has-no-timeout-backstop`** `[carry]` — `lockForCompletion` seta `status='completing'`; se
  `finalizeCompletion` lança, row órfã; timeout-scan claima só `('dispatching','processing','waiting_input')`
  (`orchestration/repository.ts:428`) → retry do harness → 409 permanente, pipeline travado. — **2h**. `[xrepo]`
- **`stale-token-blind-status-transition`** `[carry]` — `findExecutionIdByTokenHash` exclui só terminais;
  `applyStatusTransition` é UPDATE cego sem guard de origem (`harness-callbacks.repository.ts:64`) → callback tardio
  `running` regride `waiting_approval→processing`. Mascarado pelo 404 acima. — **3h**. `[xrepo]`
- **`backend-never-sends-skills-allowlist`** `[carry]` — `cutoff.ts:75 skills:[]` hardcoded; `account_denied_tools`
  **nem existe** no `DispatchPayloadSchema`; harness trata `[]` como "todas as tools" (`permission-context.ts:66`) →
  PERM-05 (allowlist por org) é **no-op** e2e. — **4h**. `[xrepo: bevox-harness]`
- **`trace-content-field-dropped-on-persist`** `[carry]` — `harness-callbacks.repository.ts:203` mapeia
  `output_json ← e["output_json"]??e["output"]??null` e `step_name ← e["name"]`, mas o `TraceEntry` do harness
  carrega o payload em **`content`**(+`step`,`timestamp`) → conteúdo de reasoning descartado; `sendTrace` sem
  callers no harness → callback não-exercitado hoje. — **1h**. `[xrepo]`

**Pagamentos / reconciliação (resíduo do "webhook concilia"; Stripe-path, não exercitado pelo piloto manual)**

- **`reconcile-cron-flips-paid-without-orchestration`** `[carry]` — `reconcile.ts:140,144-149 UPDATE charges 'paid'`
  cru sem `applyChargePaid` → paid sem row em `payments`, appointment nunca confirmado, sem grant, sem audit. Manual
  pula. — **3h**.
- **`reconcile-cron-skips-applyChargeRefunded`** `[carry]` — `reconcile.ts:252-259 UPDATE refunds` cru sem
  `applyChargeRefunded` → viola ADR-018 (full refund de package ⇒ `cancelled`). **Compõe com `reconcile-refund-
  updated_at-DOA` (ALTO): a UPDATE nem executa.** — **2h**.
- **`reconcile-cron-flips-cancelled-without-orchestration`** `[carry]` **(v: Security Engineer)** — `reconcile.ts:
  141,144-149` PI canceled → `UPDATE charges 'cancelled'` cru (único writer de charge→`cancelled`, não-orquestrado)
  → appointment ligado nunca cancelado, sem audit. — **1h**.
- **`stripe-webhook-zero-route-signature-dedupe-tests`** `[carry]` — 0 `constructEvent` em `test/`; nenhum teste
  injeta `POST /webhooks/stripe[/platform]`; o teste homônimo mocka o repo. Ponto de entrada de dinheiro sem
  cobertura de assinatura/dedupe/roteamento. — **6h**. **#8.** `[xrepo: Stripe]`
- **`requires-prepayment-hook-throws-manual-mode`** `[carry]` — `booking.ts:277,299` hardcoda Stripe `createCharge`;
  conta manual (`external_account_id=NULL`) → `service.ts:193 lança "payment account not active"`; caught
  best-effort (audita `charge.hook_failed`). — **3h**. `[xrepo: ADR-023 vs ADR-014]`
- **`money-mutation-routes-no-http-idempotency-key`** `[carry]` — `mutate` (`payments/routes.ts:59`, sem
  `requireIdempotency`) em `mark-paid`(`:295`)/`expire`(`:318`)/`connect-manual`(`:274`)/`PATCH policy`(`:95`).
  Fator contribuinte do `manual-remark orphan`. — **0,5h**.
- **`pix-reconcile-split-2-endpoints-vs-adr014`** `[carry]` **(v: CONFIRMADO — canon lido)** — `/webhooks/stripe`
  (`webhook.ts:31`) trata só `account.updated`; `payment_intent.*`/`refund.*` em `/webhooks/stripe/platform`
  (`webhook-platform.ts:32`, secret `_PLATFORM`); **ADR-014 documenta UM endpoint** (`/api/v1/webhooks/stripe`,
  l.134). Ambos secrets `requiredInProd` (`env.ts:200,203`). — **1h** (errata canon + startup-assert). `[xrepo]`

**Canais — perda de inbound (CONFIRMADOS pelo Security Engineer)**

- **`inbound-dedupe-strand-onboarding-loss`** `[carry]` — `metaapi/routes.ts:174` SETNX dedupe **antes** do persist;
  `:184-191 throw notFound` (tenant unmapped) na janela de onboarding → key strandada; meta-api retenta →
  `:175-179 replayed` 200 → evento **perdido**. `DEL` (`:280-282`) só cobre `message.received`. — **2-3h**.
  `[xrepo: bevox-meta-api]`
- **`null-tenant-audit-notnull-500-inbound-loss`** `[carry]` — `tenant_id` `.nullable()` (`schemas.ts:38`);
  `routes.ts:215-227` audit INSERT passa `organization_id=NULL` numa coluna `.notNull()` (`db/schema/audit.ts:25`) →
  23502 → 500 → key strandada → retry `replayed` → perdido. — **1-2h**. `[xrepo: bevox-meta-api]`
- **`status-events-subscribed-but-ignored`** `[carry, ALTO-GA]` — assina 5 tipos (`server.ts:250-254`) mas
  `routes.ts:234` trata só `message.received`; `message.status_updated` (**FAILED** outbound) sem handler → falha de
  entrega assíncrona do Meta nunca reconciliada. — **4-8h**. `[xrepo]`

**LGPD / retenção / schema (Marco-3; piloto roda com PII real) — CONFIRMADOS pelos agentes LGPD + schema**

- **`received-events-raw-payload-unscoped-un-erasable`** `[carry]` **(v: CONFIRMADO — LGPD + schema)** —
  `metaapi/routes.ts:202-212` persiste o **envelope Meta cru** (`payload_json`: wa_id/telefone/nome/texto) em
  `received_events` (`ingestion.ts:12-30`), que tem **zero `organization_id`, zero `customer_id`, zero
  `deleted_at`** — só `source`+`source_event_key`. Nunca purgado, omitido do DSR export, un-joinável → sink de PII
  cru **erasure-impossível**. — **6-8h** (fold ADR-020). `[xrepo: _shared/ADR-020]`
- **`message-records-content-un-erasable-omitted-from-dsr`** `[carry, sharpened]` **(v: CONFIRMADO — LGPD +
  schema)** — `message_records` (`ingestion.ts:32-49`) sem `organization_id`/`customer_id`, apesar de `content_text`
  (`:42`, o corpo da conversa **egresso ao LLM externo**) + `sender_snapshot_json` (`:47`, wa_id/telefone); único FK
  `received_event_id ON DELETE set null` → não cascateia de `organizations`; §12.9 l.1300 exige pseudonimizar
  `Message.content`. Sharpening LGPD: é PII **parseada e LLM-egressa**, estritamente mais sensível que
  `received_events`. — **6-8h**. `[xrepo: _shared/ADR-020]`
- **`denormalized-customer-contact-snapshot-defeats-erasure`** `[carry]` — `appointments` (`calendar.ts:128-130`) e
  `waitlist_entries` (`:194-196`) guardam `customer_name/phone/email` denormalizados com `onDelete:"set null"` no FK
  → hard-delete de customer deixa o snapshot de PII órfão e un-joinável; cross-border-pushed ao Google
  (`sync.ts:203`). — **fold no ADR-020**. `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` **(v: CONFIRMADO — agente LGPD achou admissão no código)** —
  `queue/index.ts` 11 workers, nenhum purga/pseudonimiza PII; sem `consent_events`/`dsr_requests`/`legal_basis`
  (grep=NONE); `deleted_at`/`consent_granted_at`/`archived_at` nunca escritos. `auth/repository.ts:99` **admite** em
  comentário: "Hard-delete worker (canon ADR-020, ainda não landed em main)". — **12-16h**. `[xrepo: _shared/ADR-020]`
- **`no-dsr-deletion-endpoint`** `[carry]` — sem `app.delete` em `customers/routes.ts`; `deleted_at` filtrado
  (`repository.ts:31,41`) mas nunca escrito (grep = zero writers). **Nuance:** DSR **export** EXISTE (`GET
  /api/v1/customers/:id/export`, `routes.ts:97`) — só a **deleção** falta (§12.9 cascade). — **6-8h**.
  `[xrepo: _shared/ADR-020]`
- **`customer-pii-mutations-unaudited`** `[carry]` — `customers/service.ts:29-62` escreve **zero** `audit_events`
  (só TODOs de hidratação de export `:86,108`); os outros 12 módulos auditam. Create/patch de PII + toggle
  `ai_opt_out` sem trilha (art.37 RoPA). — **3-4h**.
- **`execution-traces-pii-retained-omitted-from-dsr`** `[carry]` — `harness-callbacks.repository.ts:196-203` grava
  `input_json`/`output_json` crus; tem `org+execution_id` mas **sem `customer_id`**, sem retenção e omitido do DSR
  export. — **4h**.
- **`google-calendar-intl-transfer-customer-name-no-basis-gate`** `[carry]` **(v: CONFIRMADO — agente LGPD)** —
  `calendar/google/sync.ts:203,237` empurra `summary="${service} — ${full_name}"` (NOME) p/ Google Calendar (US =
  transferência intl) via `createGoogleEvent:245`/`updateGoogleEvent` sem gate de consent/ai_opt_out. — **~2h**.
  `[xrepo: _shared/ADR-019]`
- **`payments-raw-payload-json-pii-residue`** `[carry]` — `payments/repository.ts:430-438` guarda o evento Stripe
  cru `raw_payload_json` (`billing_details` nome/email/phone); `payments` sem `customer_id`, sem retenção, omitido do
  DSR. — **fold ADR-020**.
- **`dsr-export-omits-subjects-own-personal-data`** `[carry]` — `CustomerExport` (`service.ts:77-108`) retorna 9
  cols; omite `preferences_json`/`risk_flags_json`/`consent_granted_at` + `messages`/`audit_events` hardcoded `[]`
  (`:107-108`). — **1h**.
- **`section-11-3-critical-indexes-partially-absent`** `[carry]` **(v: CONFIRMADO — agente schema; canon l.1270)** —
  ausentes `(org,status)` em appointments/charges/executions, `(org,start_at)`+`(org,customer_id)` em appointments,
  `(org,customer_id)` em charges/conversations. Presentes (corretamente não-reclamados): `(org,status)` +
  `(org,last_message_at)` em conversations (`conversations.ts:58-59`). Risco = scans org-wide na escala GA. — **2h**.
- **`fk-columns-without-index-systemic`** `[carry]` **(v: CONFIRMADO — agente schema)** — org_id FK sem índice em
  `customers`/`professionals`(org+user)/`services`/`calendars`/`users`/`executions`(org+conversation+buffer_window);
  `payments.charge_id`+`refunds.charge_id` (NOT NULL FK, join do ledger); `customer_channels.customer_id`; 5
  child-FKs de `charges` (`payments.ts:77-87`). Viola `backend-db.md`. Não pilot-blocking (1 org). — **2-3h** (uma
  migration). `[a/schema]`
- **`conversations-child-fks-unindexed`** `[NOVO]` **(v: CONFIRMADO — agente schema)** — `conversations.ts:28,31,34`
  `customer_id`(cascade)/`channel_connection_id`/`customer_channel_id` sem índice; lookups by-customer + cascade-
  delete full-scan uma tabela operacional §11.3. — **S (fold na migration de índices)**.
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized`** `[carry]` **(v: CONFIRMADO — schema)** —
  backend/ADR-020 (message_templates + enums + partial-uniq, aceita 2026-05-21) e backend/ADR-021 (priority-score
  fórmula + colunas + cron) **não materializadas** (grep `message_template`/`urgency_level`/`skip_count`=NONE;
  `priority_score` é raw-storage `conversations.ts:45`/`calendar.ts:204`). ADR-022 policy-json **materializada**
  (`catalog.ts:110-113`, não-gap); ADR-023 manual-payment materializada (`0016`+`payments.ts:54,113`). — ADR-020
  **4-6h**; ADR-021 **6-8h**. `[a; Marco-2/3]`

**Autonomia / rate-limit / onboarding (harness inerte no piloto) — CONFIRMADOS pelos agentes**

- **`ratelimit-infra-dead-app-wide`** `[carry, sharpened — agente RBAC + calendar]** **(v: CONFIRMADO)** — plugin
  **Lua custom** (`rate-limit.ts`), **não** `@fastify/rate-limit` (`package.json:37`, **importado em lugar nenhum —
  dep morta**). `requireRateLimit` aplicado a **zero** rotas app-wide (só type decl `global.d.ts:66`); webhooks
  públicos (stripe/metaapi/google/clerk) + login staff destravados; canon §12.6 (l.1327) manda IP/org/heavy caps. —
  **2-6h**.
- **`autonomy-patch-nontransactional-mode-audit`** `[carry]` — a desculpa do código ("no tx helper exists",
  `autonomy/repository.ts:67`) é **FALSA**: `.transaction(` usado em 7 sites; UPDATE (`:87`) + audit INSERT (`:111`)
  só guardados por `if(modeChanging)` (`:109`), não tx → mudança de modo sem AuditEvent se o INSERT falha. — **1-2h**.
- **`onboarding-advance-no-prereq-arbitrary-stage`** `[carry]` — `organizations/repository.ts:155 SET
  onboarding_stage` cru; `schemas.ts:37-49` aceita qualquer dos 11; `routes.ts:70-78` sem prereq/role/audit (§12.8);
  PRD §5.8 exige checklist. `ai_mode` não flipa. — **3-5h**.
- **`autonomy-action-granularity-and-readiness-score-dead`** `[carry]` — `resolver.ts:62` gateia só `current_mode`;
  `PolicyEvaluator`/`fetchOrgAutonomyPolicies` (`seams.ts:64`) com **zero** callers; `readiness_score` nunca
  computado (`repository.ts:38` insere só id/org/current_mode) → `GET /autonomy` sempre null. — **1h** a **16-24h**.

### BAIXO (higiene)

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static' `openapi-docs.ts:34`; recontagem: 106/80/95/0/11/0)**

- **`openapi-drift-undocumented-handlers`** `[carry]` **(v: CONFIRMADO — route-reviewer, 11/11)** — GET/PATCH
  /autonomy, GET /channel-connections, GET /customers/{id}/export (DSR), GET/PATCH /payment-account/policy, GET
  /api/v1/realtime (SSE), POST /webhooks/stripe, /stripe/platform, POST /webhooks/google, GET /webhooks/google/
  callback. — **2-3h**. **#9.**
- **`handlers-outside-routes.ts`** `[NOVO]` **(v: CONFIRMADO — route-reviewer)** — 4 handlers vivos **fora** de
  `*routes.ts`: `payments/webhook.ts:31`, `webhook-platform.ts:32`, `calendar/google/webhook.ts:48,80` → viola a
  convenção de módulo (CLAUDE.md §5) **e** é por isso que estão undoc. Um glob `modules/*/routes.ts` subconta
  99 vs 106. — **S (doc) / M (relocar)**.
- **`openapi-missing-operationid`** `[carry]` **(v: CONFIRMADO — grep=0)** — `operationId`=**0** em 95 ops →
  codegen degradado. — **1-2h**.
- **`openapi-status-callback-missing-dead-letter`** `[carry]` **(v: CONFIRMADO — `yaml:298`)** — enum
  `[running,paused,cancelled]` sem `dead_letter`; código canon-correto (ADR-019 Am.1). — **0,25h**. **#9.**
- **`openapi-enum-create-refund-missing`** `[carry]` **(v: CONFIRMADO — route-reviewer)** — `ExecutionProposal.action`
  Zod tem `create-refund` (`harness-callbacks.schema.ts:35`, executado `seams.ts:172`); `yaml:325-330` **omite** →
  harness pode mandar proposal válida-no-código que viola o contrato publicado. `waitlist-add` presente em ambos. —
  **0,25h**.
- **`payment_method-online-yaml-omits-checkout` + `checkout-vs-payment_link-Zod-DB-divergence`** `[NOVO]` **(v:
  CONFIRMADO — route-reviewer)** — `charge-intent.ts:87 ONLINE_PAYMENT_METHODS=["pix","checkout"]` aceita `checkout`
  vs `yaml:2602 [pix]` (drift real, Zod > contrato; `checkout` 501-stubbed `checkout.ts:50`); e `checkout` ∉ DB CHECK
  (`payments.ts:113`) enquanto DB permite `payment_link` que nenhum Zod aceita → uma charge `checkout` persistida
  violaria o CHECK (landmine latente se Checkout for implementado). — **S**.
- **`charge_type-req-vs-resp-drift`** `[REFUTED]` **(v: route-reviewer)** — NÃO é drift YAML↔código:
  YAML-request==Zod-request `[full,package]`; YAML-response==DB `[deposit,full,package,adjustment]`; o
  request⊂response é assimetria **intencional espelhada nos 2 lados**. (07-21 listou como sub-drift; refutado.)
- **`error-envelope-dual-schema` / `rate-limit-429-undocumented` / `metrics-endpoint-public` /
  `sse-realtime-header-auth-and-query-contract` / `payment-account-policy-triple-hygiene`** `[carry]` — resíduos de
  contrato/hygiene do YAML (ver 07-21 para detalhe; inalterados). — 0,25-4h/ea.

**Harness (resíduos BAIXO + misses novos — todos INERTES no piloto; harness undispatched)**

- **`complete-returns-409-not-410-gone`** `[NOVO]` **(v: harness agent)** — `/complete` retentado retorna 409
  (`harness-callbacks.routes.ts:160`); PRD l.821/l.832 mandam **410 Gone**. — **0,5h**. `[xrepo/canon]`
- **`complete-skips-redis-stream-del`** `[NOVO]` **(v: harness agent)** — PRD l.824 requer `DEL stream:{id}` no
  desfecho; o handler nunca deleta (`:138`) → buffer de stream fica 1h (TTL deslizante `:127`). — **0,5h**. `[xrepo]`
- **`complete-done-path-omits-execution-updated-sse`** `[NOVO]` **(v: harness agent)** — autonomous-done/request-human
  pulam o `execution.updated` SSE que PRD l.1093 implica (`complete-service.ts:100`). — **1h**. `[xrepo]`
- **`harness-ignores-dispatched-callback-base-url`** `[carry]` — backend manda `callback_base_url`
  (`harness-dispatcher.ts:94`) mas harness hardcoda `BASE_URL=config` (`bevox-callback.ts:7`) → misroteia se
  divergirem. — **1h**. `[xrepo; ALTO-GA-ops]`
- **`harness-documents-false-complete-idempotency-dedup`** `[carry]` — comentário do harness
  (`bevox-callback.ts:11`) afirma "backend de-duplica /complete" — falso (backend 409a). — **0,5h**. `[xrepo]`
- **`deadletter-overwrites-rejected-expired-underspecified`** `[carry]` — `markExecutionDeadLetter` sobrescreve
  `rejected`/`expired`/`timeout` sem anomaly-audit (`harness-callbacks.repository.ts:90`); ADR-019 Am1 silente. —
  **0,25h**. `[xrepo]`
- **`status-meta-stripped-silently`** `[carry]` — `StatusCallbackSchema` (`schema.ts:15`) sem `.passthrough()` →
  strip de `failedReason`/`attemptsMade` do dead_letter; perda forense. — **0,25h**. `[xrepo]`
- **`canon-complete-strategy-enum-stale`** `[carry]` — PRD l.1088 omite `workflow`+`aborted_*` que o harness emite;
  errata aditiva no canon (ADR-005). — **n/a (canon)**.

**Auth / schema / channels (resíduos + misses novos)**

- **`staff-session-no-logout-no-reuse-detection`** `[carry]` — sem endpoint de logout/revoke; rotação sem alarme de
  reuso (`auth/service.ts:99-101`); HS256 access (900s) não-revogável. — **2-3h**.
- **`staff-login-user-enumeration-timing-oracle`** `[carry]` — `service.ts:68-71` lança antes do bcrypt em email
  desconhecido; cache widening da latência. — **0,5h**.
- **`staff-metadata-cache-no-invalidation-stale-role-window`** `[carry, CHANGED — de-escalado]** **(v: agente RBAC)**
  — `repository.ts:20` cacheAside 300s guarda `role`; sem writer de invalidação. MAS deactivation é fail-closed
  (DB-direct `active=true`, `:83`) e refresh lê role DB-direct (`:127-133`) → janela só via role-change out-of-band.
  LOW/latente. — **0,5h**.
- **`clerk-provisioned-role-hardcoded-operator`** `[NOVO]` **(v: agente RBAC)** — `auth/repository.ts:236-240`
  `upsertUserFromClerk` insere `role='operator'` p/ todo user, `ON CONFLICT` não atualiza role → mesmo se
  provisioning funcionasse, o role do Clerk é ignorado. Trap latente p/ o follow-up de RBAC. — **S**.
- **`clerk-resolvelocaluser-fail-open-authz-trap`** `[NOVO]` **(v: agente RBAC)** — `clerk-auth.ts:130-138` erro de
  DB → `req.user=null` (fail-open). Inerte hoje (nenhuma rota lê `req.user`); se `requireRole` for wired sem remover
  o fail-open, um blip de DB → role null não pode default-allow. — **S** (guardar agora).
- **`staff-refresh-tokens-no-expiry-sweep`** `[NOVO]` **(v: agente RBAC)** — `auth/repository.ts:106-116,138-140`
  refresh tokens expirados só apagados na rotação; sem sweeper/TTL → crescimento ilimitado da tabela. — **S**.
- **`clerk-webhook-org-claim-fallback-cross-links`** `[carry, CHANGED — refutado → inerte/no-op]** **(v: agente
  RBAC)** — `auth/routes.ts:169-170` fallback p/ `clerkUserId`: `data.organization_id` é **svix-verified**
  (Clerk-sourced, não settable) + separação de namespace org_*/user_* → nenhuma ligação cross-org realista; no-claim
  resolve a **própria** org do user. Mesma root-cause de `clerk-user-provisioning-broken`, não vuln independente. —
  **fold no clerk-provisioning fix**.
- **`uuidv7-sql-default-missing-post-0000-tables`** `[carry, count-corrected]** **(v: agente schema)** — **14**
  tabelas de `0000` têm `SET DEFAULT gen_uuid_v7()` (não 13; `0000:307-320`); **30** CREATE TABLE de 0001+ não (grep
  `gen_uuid_v7` 0001-0020 = 0; 46 total − 16 em 0000 = 30). As 2 não-defaulted de 0000 (organization_settings/
  service_policies) são FK-as-PK (correto). Fail-closed (`_shared.ts:108-111` `$defaultFn`). Pura higiene/DX. —
  **2h**.
- **`appointments-customer-package-id-no-db-fk` / `customers-deleted-at-read-but-never-written` /
  `executions-original-execution-id-unindexed` (NOVO) / `newopaqueid-uuidv4-landmine` / `queue-size-gauge-never-
  updated` (NOVO) / `availability-professional-id-filter-missing` (NOVO) / `appointment-created-by-not-persisted`
  (NOVO) / `no-availability-returns-409-not-422` (NOVO)** `[carry+NOVO]` — resíduos de correção/hygiene:
  `calendar.ts:124` sem `.references()`; `deleted_at` nunca escrito; `executions.ts:47` col 0020 sem índice/FK
  (benigno); `staff-auth.ts:139 newOpaqueId()=randomUUID()` UUIDv4 dead-code (0 callers); `metrics.ts:41 queueSize`
  Gauge sem `.set/.inc`; `calendar/schemas.ts:18-23` omite `professional_id` (canon §10.1 l.966);
  `calendar.ts:140` sem `created_by_type/id` (§8.3-step3); `calendar/routes.ts:91-94` 409 para no-availability (§8.3
  quer 422). — 0,25-3h.
- **`redaction-paths-miss-actual-columns`** `[carry, de-escalado]** **(v: agente LGPD — leak ativo REFUTADO de
  novo)** — `redactors.ts:44-45` wildcards `*.phone`/`*.email` (1-nível) não casam `primary_phone`/`primary_email`/
  `notes_internal`/`fact_value`/`phone_number`/`handle`/`wa_id`/`content_text`. **MAS** grep de todos os sinks de log
  não acha statement que logue essas colunas → rede-de-segurança latente, não leak ativo. — **0,5h**. **BAIXO**.
- **`consent-and-preference-columns-entirely-dead` / `calendar-hotpath-queries-not-organization-scoped`** `[carry]`
  — `customers.ts:45,48,49` zero writers; `availability.ts:116,167` + `booking.ts:227` filtram só `professional_id`
  (mitigado — org-derivado). — fold / 0,5h.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04; re-confirmada)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: CONFIRMADO — orquestrador)** — tags só
  `v1.0.0`/`v1.0.1`; `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; `v1.0.1`=`9a88116` (06-01); **22
  commits** `v1.0.1..dbd231e` fora (incl. fixes + dispatch amendment); `release.yml:5` dispara só em `v*.*.*` →
  **nenhuma imagem (SemVer OU sha) pós-`v1.0.1`**. `git describe HEAD` = `v1.0.1-30-g5b5b835`. Versão diverge
  **4-way**: `package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1` / hub `vX.Y.Z`. — **0,5-1h** (cortar tag).
  **#7-alt.** `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: CONFIRMADO)** — `CLAUDE.md §8` diz seed grava `PILOTSEEDONLYNOTASECRET`
  (real gera base32 + blocklist `mfa.ts:34`; literal só em doc-comment `mfa.ts:66`); `resolve-organization-id.ts`
  citado em 5+ lugares (README:84, rules, agent, hook) **NÃO existe**; `README §"Identidade de tenant"` afirma que 2
  bridge files referenciam `workspace_id` — **ambos limpos/ausentes**; `backend-tests.md` cita "5 falhas FK #36"
  (suíte passa 92/93); `backend-harness-contract.md` diz `dead_letter` via `worker.on('failed')` (**errado** — é via
  `PATCH /status`) + localiza callbacks em `modules/executions/` (vivem em `src/integration/`) + afirma persistência
  de `Idempotency-Key` em callbacks (**REFUTADO**) + lista `account_denied_tools` (canon não tem); `backend-db.md`
  diz `on delete restrict` (código+canon = **cascade**, §11.2 l.1203). — 0,3-0,5h/ea.
- **`rule-backend-routes-staff-role-and-adr-miscite`** `[carry]` **(v: CONFIRMADO — agente RBAC)** — `.claude/rules/
  backend-routes.md` declara staff roles como `bevox_admin | support | observer (canon: ADR-022 staff RBAC)`:
  triple-errado (nomes curtos vs `bevox_support`/`bevox_observer`; staff RBAC = **backend/ADR-013**, não ADR-022;
  invoca o inexistente `requireRole`). Código correto; a rule que guia autores de rota futuros não. — **0,25h**.
- **`stray-gap-workflow-js-scratch-accumulation`** `[carry]` — 5 `.claude/state/gap*.js` (0704/0709/0714/0715/0717)
  gitignored (`git check-ignore` confirma os 5) → **zero impacto em CI**; só fazem `pnpm lint` **local** dar RED
  ("Parsing error: 'return' outside of function"). Esta sessão NÃO adicionou nenhum. — **0,1h** (`rm`).
- **`codeql-upload-never-noop` / `release-no-provenance-sbom` / `adr-number-collision-cross-namespace`** `[carry]` —
  `codeql.yml:26 upload:never`; `release.yml` sem provenance/sbom/cosign; ADR 008-023 colidem backend/_shared. —
  0,2-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária)

- **`legacy-lexicon-clean`** **(v: CONFIRMADO — orquestrador)** — grep `workspace_id|workspaces|account_id\b|accountId`
  em `src/`/`db/`: executável **ZERO**. Bare `workspace_id`/`workspaces` = 3, todos doc-comment do rename
  (`organizations/routes.ts:3`, `autonomy.ts:3`, `autonomy/routes.ts:5`). Residual `account_id` após excluir
  compostos sancionados = 6 (5 doc-comment de migração de tenant; 1 alias financeiro
  `AS account_id` type em `payments/repository.ts:1015`). Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** **(v: CONFIRMADO — agente RBAC)** — `seed-pilot.ts:153-154` `generateMfaSecret()`
  (base32) + `assertMfaSecretNotPlaceholder()`; `mfa.ts:34-42` blocklist inclui `pilotseedonlynotasecret`;
  `auth/service.ts:84-88` sem MFA check (correto — TOTP é Marco-3 §16.3/ADR-013). Literal só em doc-comment
  `mfa.ts:66`, nunca escrito ao DB. **NÃO implementar "rejeitar sentinel no login".**
- **`four-callbacks-token-gated`** **(v: CONFIRMADO — harness agent)** — `/status`(inline preHandler) +
  `/traces`/`/stream`/`/complete`(`requireExecutionToken`), todos → 401 em token inválido (`execution-token.ts:64,
  69`). **Coexiste com** `callback-token-not-bound-to-path-execution-id` (ALTO): gate de autenticidade ≠ autorização.
- **`idempotency-on-callbacks-REFUTED`** **(v: CONFIRMADO — harness agent)** — o backend **não** persiste
  `Idempotency-Key` em status/complete; é máquina-de-estado (`lockForCompletion`→409, `routes.ts:158`). O harness
  **manda** `completeKey` mas o backend a ignora. `/complete` retentado = 409, não 200 idempotente.
- **`dispatch-amendment-faithful-to-canon`** **(v: CONFIRMADO — harness agent)** — `deadline_ms`/
  `original_execution_id`/`dead_letter` (`harness-dispatch.schema.ts:58`) byte-faithful ao canon (PRD l.1069-1157 +
  backend/ADR-019 Am1). Não é fork.
- **`hmac-verification-correct`** **(v: CONFIRMADO — Security Engineer)** — `metaapi/service.ts:48-55` casa o signer
  do meta-api (`${t}.${rawBody}`, SHA256 hex, `t=,v1=`, ±300s, `timingSafeEqual`). Sem gap.
- **`payments-conformidades`** **(v: CONFIRMADO — Security Engineer)** — PCI-nil (grep `pan|cvc|cvv|card_number`=0);
  decimal-safe `numeric(10,2)`; webhooks dedupe-aware (`recordWebhookEvent` `repository.ts:250-262`); over-refund
  replay-safe; cross-tenant paid-flip impossível (`webhook-platform.ts:68` org-scoped + `markChargePaid` guardado);
  ambos webhook-secrets `requiredInProd`.
- **`staff-rbac-3-roles-conformant`** **(v: CONFIRMADO — agente RBAC)** — `staff-auth.ts:33 STAFF_ROLES` =
  exatamente `bevox_admin|bevox_support|bevox_observer` (backend/ADR-013 l.~108); `requireStaff({roles})` 403; JWT
  staff HS256 aud `bevox-backend-staff` distinto do Clerk RS256; observer excluído de impersonation + staff-ops
  actions, incluído em staff-ops reads.
- **`schema-conformances`** **(v: CONFIRMADO — agente schema)** — `ON DELETE cascade` p/ `organization_id` é
  **canon-correto** (§11.2 l.1203; a rule `backend-db.md` "restrict" é que está stale); timestamptz everywhere; CHECK
  (`end_at>start_at` `calendar.ts:160`, `sessions_remaining>=0` `payments.ts:216-219`, `confidence∈[0,1]`
  `customers.ts:132-135`); backend/ADR-022 (policy-json 4 jsonb) materializada.
- **`google-oauth-tokens-encrypted-at-rest` + `secrets-redacted`** **(v: CONFIRMADO — agente LGPD)** —
  `sync.ts:100,137` encrypt/decryptToken; `redactors.ts:14-32,72` redige tokens/secrets mesmo em debug;
  callback-egress content redigido (`:59`); Google audit nunca carrega PII/token (`sync.ts:81-91`).
- **`todo-fixme-debt-sweep-marco23-only`** **(v: CONFIRMADO — orquestrador)** — sweep `src/`+`db/`: **0**
  FIXME/HACK/XXX; 1 `@deprecated` (`orchestration/repository.ts:348`); 11 "TODO" (vários são "TODOS"=all em PT;
  reais = MFA `auth/service.ts:86`, export `customers/service.ts:83,85`, autonomy `resolver.ts:47` — todos
  Marco-2/3). Zero dívida pilot-blocking.
- **`delivery-tracker-10-delivered-1-parked`** **(v: CONFIRMADO — origin/main)** — slot bevox-backend
  (`40_roadmap/_shared/delivery-tracker.yml:781`): aisuggestion, staff-rbac, m4-chatwoot-p1..p4,
  m5-p4-manual-payment, m5-p3c-multimedia, m5-p3a-refundpolicy, m5-p3b-create-refund = **10 delivered**;
  `backend-psp-br-secondary` = **parked** (Marco 6 / bevox-open-finance, ADR-023). **Nenhum work-item** p/ calendar
  (ADR-010), customer-identity (ADR-009), templates (ADR-020), priority-score (ADR-021) → o defeito da grade
  (sob ADR-010) é **invisível ao tracker** (que mede presença-de-código por grep). "delivered" ≠ pilot-ready.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros somam ≈ 5-6h** e destravam o
runtime do piloto + os 2 jobs de CI vermelhos.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Seedar Calendar default + grade `professional_schedules` (Seg-Sex) no `seed-pilot`** | **2-3h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) **+ `closeDb()/closeRedis()` no `afterAll`** | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | `pnpm audit`: bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri | **2-3h** | Destrava o job `Security` (**18 highs**, ~9 prod-runtime) — completa "CI verde"; **piorou de novo vs 07-21** |
| 4 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado não autentica no calendar (gate upstream dos CRÍTICOs) |
| 5 | **Gatear `insertPayment`+side-effects no rows-affected de `markChargePaid`** | **2h** | Fecha o único bug HIGH de dinheiro alcançável no money-path manual do piloto |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + subir `/metrics` no worker | **1-2h** | Fecha o buraco-negro **triplo** (Sentry/OTel/Prometheus) de TODA a metade assíncrona que o piloto roda |
| 7 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e | **3-4h** | **CRÍTICO quando a IA/staff-approve ligar**: faz a resposta chegar ao cliente |
| 8 | **`.min(32)` no `STAFF_JWT_SECRET`** + montar `requireRateLimit` no `/staff/sessions[/refresh]` | **~3,5h** | Fecha o buraco de auth mais duro (admin forjável) + brute-force do admin semeado |
| 9 | **Vincular token de callback ao `:id`** (`executionContext.execution_id === id` → 403) + **remover `updated_at` do reconcile de refund** | **1,25h** | Fecha o IDOR cross-execution (2 NOVOS bugs) + destrava o reconcile de refund (42703 DOA) — ambos ALTO-GA |
| 10 | **Aplicar gate `ai_opt_out` em `cutoff.ts`/dispatch** + escopar `received_events`/`message_records` p/ DSR + hidratar export | **6-10h** | LGPD (piloto roda com PII real; hoje o flag é ignorado + PII cru não-apagável) |
| — | Higiene batch: `GET /appointments`; versão/tag SemVer (22 commits); reconcile-cron `applyChargePaid/Refunded`; audit de appointment (§12.8); docs stale (§8/bridge/rule dead_letter/db-restrict/rule-ADR-022); `newOpaqueId`→v7; `rm .claude/state/gap*.js`; `operationId`+enums OpenAPI; índices FK (uma migration) | **~12h** | "Ver agenda" + governança + drift de contrato + perf GA + LGPD-audit |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status` POST vs PATCH 404** (backend
  canon-correto; fix cross-repo harness→PATCH + errata canon l.447); `aborted_*`→400 (bug harness),
  `strategy='failed'`→não-`error` (bug backend), skills-allowlist vazio, `trace content` descartado no persist,
  `callback_base_url` ignorado, e os 2 NOVOS deste ciclo (`callback-token-not-bound-to-:id` IDOR + `active_execution_
  id`-wedge). Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` no fio
  (`messages/schemas.ts:7,30`) confirma que `wa`/`ig` do backend é a causa do drop de outbound; retries de webhook
  (<24h) amplificam a perda de inbound (dedupe-strand + null-tenant-500).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de
  um principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona; o webhook só fill
  `req.user` (fail-open), não a claim que o scope-guard lê.
- **Stripe** — Pix exige Connect KYC `active`; conciliação depende de **dois** endpoints (ambos `requiredInProd`)
  vs ADR-014 (um, l.134); refund manual não passa por webhook; o reconcile de refund Stripe está **DOA (42703)**.
  Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer auth interativa — indisponível nesta sessão
  headless** (reportado; não bloqueante para auditoria de código).
- **canon (ADRs aceitas não-implementadas / drifts)** — backend/ADR-020 (MessageTemplate), backend/ADR-021
  (priority-score); _shared/ADR-019 (bases legais → gate consent é código local), _shared/ADR-020 (retenção →
  message_records/received_events scoping, retention worker, DSR deletion). Drifts "canon-atrás-do-código" (webhook
  §10.3 unificado, `strategy='workflow'`, `payment_method` valores, `aborted_*`, `/status` POST↔PATCH l.447,
  `create-refund`, `dead_letter` no status enum) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1` (sem os
  22 commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem principal
  Clerk — os 2 CRÍTICOs + 2 gates de piloto).
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs
  são invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker (que mede presença-de-código).

## Delta vs auditoria anterior (2026-07-21)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD --
src/ db/` **vazio**; `HEAD` = o commit do próprio audit 07-21. **0 refutações de achados de código** — todos
re-confirmados com evidência fresca por 7 domínios independentes + verificação de fonte-primária do orquestrador.

**Descobertas NOVAS de código (2 — misses das 7 passadas anteriores, ambas verificadas pelo orquestrador):**
1. **`reconcile-refund-writes-phantom-updated_at-column` (ALTO)** — `reconcile.ts:256-258` escreve `updated_at`
   numa tabela `refunds` que não tem a coluna → **42703** → reconcile de refund Stripe **DOA**. Não é design-gap,
   é bug-de-runtime certo. Stripe-path (inerte no piloto manual). **Fix 1-linha.**
2. **`callback-token-not-bound-to-path-execution-id` (ALTO/segurança)** — token válido de A escreve callbacks em
   qualquer execução B (IDOR cross-execution/cross-tenant); token gate = autenticidade, não autorização. Inerte no
   piloto (harness undispatched); CRÍTICO-GA. **Fix 1h.**
   + `completion-never-clears-active-execution-id` (harness agent, rated CRÍTICO-pipeline; inerte no piloto,
   dependência de dispatch-guard não re-traçada) e ~14 misses BAIXO/MÉDIO afiados (appointment-audit §12.8,
   conversations-fk-index, checkout Zod/YAML/DB, handlers-outside-routes.ts, 3 auth-LOW, 4 calendar-LOW, 3
   harness-BAIXO).

**Mudança de ground-truth (mensurável):**
- **`ci-security` PIOROU DE NOVO**: **36 vulns / 18 high** hoje vs **33 / 15 high** no 07-21 (**+3 total, +3
  high**) — deriva composicional sobre o lockfile congelado; NOVOS highs `fast-uri` (prod, fastify/swagger) +
  `@opentelemetry/propagator-jaeger`. Tendência **12→15→18 high** nas 3 últimas passadas. Prova: dívida de
  segurança cresce mesmo sem mudar código.
- **`ci-tests`**: RED idêntico (mesmo flaky `booking_notice` `:14` — rodei ~09:06 UTC — + teardown 57P01).

**De-escalações / refutações-de-escopo (3):**
- **`charge_type-req-vs-resp-drift` → REFUTED**: não é drift YAML↔código (mirrored/intencional nos 2 lados).
- **`clerk-webhook-org-claim-fallback-cross-links` → CHANGED (inerte/no-op)**: claim svix-verified + namespace
  separation → sem cross-link realista.
- **`staff-metadata-cache-no-invalidation` → de-escalado (LOW/latente)**: fail-closed via DB-direct active check;
  refresh lê role DB-direct.
- (`redaction-paths` permanece de-escalado — latente, sem sink ativo, re-confirmado.)

**Correção de contagem (1):** `uuidv7-sql-default` presente em **14** tabelas de 0000 (não 13); 30 pós-0000 sem.

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (ALTO);
`manual-remark orphan` (ALTO); `rbac-org-role`; `clerk-provisioning`; os mismatches de `/complete`;
`reconcile-cron-*`; toda a bateria LGPD; autonomia/observabilidade; priority-score/reminders/templates Marco-2/3; a
staleness `.claude`/CLAUDE.md/README; version-drift (22 commits, nenhuma imagem pós-`v1.0.1`).

**Arco desde a passada mais antiga (06-02):** os 3 CRÍTICOs originais (resposta-nunca-chega-ao-WhatsApp via
telefone-não-persistido; seed-pilot-inexecutável-em-prod; zero-testes-de-booking) foram **fechados/
recaracterizados** (Dockerfile `COPY src` fixo; existe `calendar-booking.test.ts` [8 testes]; o drop de outbound
migrou para o `vocab-mismatch` ALTO). Os 2 CRÍTICOs atuais (grade + calendar no seed) emergiram ~06-23 e
**persistem** há ~4-5 semanas de congelamento; o gate auth-actor foi isolado no 07-20 e re-confirmado 3×. **A
frente de CRÍTICOs rotacionou por completo; o conjunto atual está estável e sem correção há um mês.**

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído
a **re-verificar de fonte-primária** o inventário do 07-21 do seu domínio contra o **código atual** com evidência
fresca `file:linha`, a **REFUTAR** superestimações, e a caçar misses. **5 usaram agent-types locais** deste repo
(`.claude/agents/`, 8 no total): `harness-callback-auditor` (contrato l), `backend-route-reviewer` (OpenAPI b),
`backend-staff-rbac-reviewer` (auth), `backend-schema-migration-engineer` (schema/índices g-schema),
`engineering-security-engineer` (payments j + channels k); **2 general-purpose** (LGPD g; calendar/pilot a+m +
autonomia/obs). Cada agente entregou lista estruturada VERDICTS/NEW-OR-MISSED/CONFORMANCES com evidência fresca.

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD
-- src/ db/` = vazio; trees `src`=`ffb067a`, `db`=`e438e04`); origin/main dos 3 repos (7874971/2979eb0/5516c2a,
inalterados); writer de `professional_schedules` (grep — só fixture); `seed-pilot.ts` inserts (só 4); worker-telemetry
(grep instrument queue/index.ts = NONE); léxico legado (grep = zero executável, triado); categoria f (0 FIXME/HACK,
1 @deprecated); delivery-tracker slot backend (origin/main, 10+1); version-drift (`merge-base --is-ancestor dbd231e
v1.0.1` = FALSE, 22 commits, describe `v1.0.1-30`); as **2 descobertas NOVAS** direto no código (refunds sem
`updated_at` → 42703; token não-vinculado ao `:id` da URL, lendo `execution-token.ts` + `harness-callbacks.routes.ts`
linha-a-linha); canon spot-checks (ADR-023 `status: aceita`; ADR-014 um endpoint l.134; ADR-018 refund/cancel).

**Ground-truth de CI rodado de fato** (2026-07-22 ~06:06–06:10 local; logs em `.claude/state/ci-2026-07-22/`):
Typecheck/Format/OpenAPI/Build/Unit(**469/469, 69 files**) = **GREEN**; `test:integration` = **RED exit 1** (`1
failed | 92 passed (93)`, flaky `booking_notice` `:14` [~09:06 UTC < 13:00] + teardown 57P01); `pnpm audit
--audit-level high` = **RED exit 1, 18 high / 36 total** (parse de `audit.json`: 12 módulos high distintos); `lint`
= **RED por artefato local** (5 `.claude/state/gap*.js` gitignored, `git check-ignore` confirmou os 5 → CI GREEN).

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree numa feature branch
(`fix/a14-…`) mas **`origin/main` @ `7874971` (06-03)** — a passada leu `origin/main` para PRD/ADRs (a #62
dispatch-amendment só existe lá). Numeração de ADR **colide** entre namespaces backend/_shared — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV
Scanner / CodeQL não reproduzíveis offline (config lida: `codeql.yml upload:never` = no-op). (3) Caminho live
(Stripe/Clerk/harness/Meta reais) não exercitado — verdicts derivam de leitura de código + schema + canon
`origin/main` + ausência comprovada de writers/endpoints + CI rodado. (4) MCP `stripe` + `claude.ai Google Drive`
requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5)
`completion-never-clears-active-execution-id`: a dependência do guard de dispatch não foi re-traçada pelo
orquestrador (agente-reportado; inerte no piloto). (6) Esta passada é re-verificação sobre código byte-idêntico ao
do 07-21; o valor incremental é **confirmação independente de fonte-primária + CI fresco (Security-RED pior) + 2
descobertas NOVAS de código reais + ~14 misses/afinamentos + 3 de-escalações**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-07-22. Sem alteração de código de
produto; somente este relatório. Revisão humana pendente.*
