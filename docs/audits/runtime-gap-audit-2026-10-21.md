# Gap Analysis — bevox-backend — 2026-10-21

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo
> segundo a documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais deste repo — `harness-callback-auditor`,
> `backend-route-reviewer`, `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`, `Security Engineer`
> — + 2 general-purpose para LGPD e calendar/pilot/obs), cada um **re-verificando de fonte primária** o inventário
> do 07-22 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** superestimações +
> caçar misses; **verificação independente de fonte-primária pelo orquestrador** dos achados-manchete direto no
> código; e **CI rodado de fato** (2026-10-21 ~09:06–09:12 UTC, não inferido; logs em `.claude/state/ci-2026-10-21/`,
> gitignored). Sucede `runtime-gap-audit-2026-07-22.md`.

## Resumo executivo

**9ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,5
meses.** Prova executada: `git diff dbd231e..HEAD -- src/ db/` é **vazio** — o produto é byte-idêntico desde
`dbd231e` (2026-06-03); os únicos commits desde então são docs/audit + o bootstrap `.claude/`. Canon
`bevox-knowledge` `origin/main` @ `7874971` (06-03), `bevox-harness` `origin/main` @ `2979eb0` (06-03),
`bevox-meta-api` `origin/main` @ `5516c2a` (06-22) — **todos inalterados vs 07-22**. Backend `origin/main` também @
`dbd231e`. Os 7 auditores + o orquestrador **CONFIRMARAM 100% do inventário de código do 07-22 (0 refutações de
achado de código)**, produziram **2 de-escalações de severidade/escopo** e isolaram **~12 misses NOVOS** (segurança,
LGPD, contrato, canais) que 8 passadas anteriores perderam — além de **fechar definitivamente a disputa cross-repo
do `dead_letter`**.

**Manchete-delta #1 — "CI verde" (único critério mensurável de Marco-1, §16.1) está RED, e o Security EXPLODIU.**
Ground-truth rodado 2026-10-21: **Typecheck ✓ / Format ✓ / OpenAPI ✓ / Build ✓ / Unit ✓ (469/469, 69 files)
GREEN**; **Tests RED** (`test:integration` exit 1: `1 failed | 92 passed (93)` — o mesmo flaky dependente de
hora-do-dia `calendar-booking.test.ts:259` "slot_conflict quando start_at < now() + booking_notice_minutes" [rodei
~09:08 UTC < ~13:00 UTC threshold → `booked` em vez de `slot_conflict`] + teardown **57P01** ×2); **Security RED e
DRAMATICAMENTE PIOR** (`pnpm audit --audit-level high` exit 1: **106 vulns — 7 low / 50 moderate / 49 high**, vs
**36 / 18 high** no 07-22 → **+70 total, +31 high** só por advisories novos acumulando sobre o lockfile
**congelado**; **19 módulos high distintos** vs 12). **A tendência de dívida de segurança é 12 → 15 → 18 → 49 high
nas últimas 4 passadas** — cresce sozinha, agora atingindo o próprio core do Fastify (NOVOS highs prod-runtime:
`fastify`, `@fastify/static`, `find-my-way`, além de `braces`, `nanoid`, `postcss`, `source-map-js`). O **lint-RED é
artefato local** (5 `.claude/state/gap*.js` **gitignored** — `git check-ignore` confirma os 5 → checkout de CI limpo
NÃO os vê → **CI lint GREEN**); esta sessão NÃO acrescentou nenhum (usou Agent tool, não Workflow).

**Manchete-delta #2 — a disputa cross-repo do `dead_letter` está FECHADA: é inalcançável ponta-a-ponta.** O
`worker.on('failed')` do **backend** (`queue/index.ts:267-269`) só **loga** — NÃO escreve `dead_letter`. O único
writer é `markExecutionDeadLetter` (`harness-callbacks.repository.ts:86`), alcançável **somente** via
`PATCH /status='dead_letter'`. O **harness** emite `dead_letter` do SEU próprio `worker.on('failed')` →
`updateStatus('dead_letter')` via **POST** → backend registra só `app.patch(.../status)` → Fastify **404** →
`dead_letter` **nunca é escrito**. Duas quebras independentes gateiam a mesma transição autoritativa. As rules
`.claude/rules/backend-harness-contract.md` + `backend-workers.md` **mis-atribuem** essa escrita ao worker do
**backend** — descrevem o worker do **harness**. Inerte no piloto (harness undispatched); CRÍTICO-GA.

**O piloto morre no passo 2 ("ver agenda"), triple-gated — inalterado e re-verificado de fonte-primária por 2
agentes + orquestrador.** (a) O `seed-pilot` provisiona só um `staff_account` (JWT **HS256**), mas **toda** rota de
calendar exige `requireClerkAuth()` (**RS256** + claim `organization_id`, `clerk-auth.ts:89,105-108`) e **nenhuma**
rota de calendar pareia `requireStaff` (`grep requireStaff src/modules/calendar/` = 0) → o principal semeado toma
**401 antes** dos CRÍTICOs (gate de provisionamento Clerk/ops — o seed não cria usuário Clerk nem row `users`).
*Se um JWT Clerk for provisionado à mão:* (b) `availability.ts:75 notFound("Calendar")` — **zero writers de
`calendars`** em qualquer seed; (c) grade vazia → `availability.ts:126 if(!sched) continue` → `slots:[]` →
`booking.ts:207 slot_conflict` em 100% — **zero writers de `professional_schedules`** (único INSERT = fixture
`calendar-booking.test.ts:120`). ADR-010 (calendar/WeeklySchedule) é **aceita** (canon `aceita 2026-04-22`) → os 2
CRÍTICOs são gap contra entidade canônica nomeada, não deferimento. **Fix mínimo ≈ 2-3h** (seedar Calendar + grade
Seg-Sex). `WeeklySchedule` é invisível ao delivery-tracker (nenhum work-item sob ADR-010).

**Money-path manual do piloto FUNCIONA, com 2 bugs HIGH alcançáveis.** (1) `outbound-provider-vocab-mismatch`
**(HIGH, o defeito confirmado mais danoso)**: inbound persiste `provider="wa"`/`"ig"` (`normalize.ts:35,44`) mas o
outbound null-coage qualquer provider ≠ `whatsapp`/`instagram` (`metaapi/repository.ts:197`) → `skipped_missing_
recipient` → `isDeliveryFailure` exclui skips → execução fica `done` (**falso-sucesso**); `bevox-meta-api`
`origin/main` exige enum pleno no fio → `wa`/`ig` é invenção 100%-backend auto-inconsistente → **toda resposta
staff-aprovada numa conversa inbound-semeada é descartada em silêncio**. (2) `manual-remark-inserts-orphan-paid-
payment` **(HIGH)**: re-marcar paga uma charge `expired`/`refunded` insere payment `paid` órfão + confirma
appointment + concede pacote (corrupção de estado). Fora isso o fluxo `charges/manual → mark-paid → applyChargePaid`
concilia o ledger corretamente (over-refund/dedupe/cross-tenant todos sãos).

**Caminho de fechamento do piloto curto e inalterado:** 2 blockers de agenda (≈ 2-3h) + gate de CI (flaky+teardown
≈ 0,5h; audit bump agora **maior**, ≈ 4-6h por 49 highs) + gate de auth-actor (ops Clerk, ou ~4-6h) ≈ **~1 dia**.
Severidades ancoradas no gate do **piloto**; para GA vários ALTO/MÉDIO sobem (vocab de canal e token-IDOR e
`dead_letter`-404 viram CRÍTICO de GA).

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária (imprecisões herdadas, re-confirmadas nesta passada):

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts`) — **não** `/complete,/artifact,/tool-result,/turn` como o brief
   lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (não "channels"). Channels = **_shared/ADR-011**.
   backend/ADR-018 = refund/cancellation policy (`aceita 2026-05-19`). backend/ADR-014 = PSP Stripe Connect
   (**um** endpoint webhook `/api/v1/webhooks/stripe`, l.134; um secret, l.172). backend/ADR-023 = manual payment
   mode (**`status: aceita`**, 2026-05-22). backend/ADR-010 = calendar/WeeklySchedule (**`aceita 2026-04-22`**).
3. O grep `account_id\b` do brief captura compostos **sancionados** (`external_account_id` Stripe/Chatwoot,
   `payment_account_id`, `channel_account_id`) + doc-comments do rename + o alias financeiro `AS account_id` +
   snapshots drizzle gerados (`db/migrations/meta/*.json`) + tipo gerado (`src/types/api.ts`). O léxico proibido
   **executável** é **ZERO** (invariante §4.1 mantida — não-gap). Ver categoria c.
4. Código congelado desde **06-03** (`dbd231e`), não 06-04.
5. Numeração de ADR **colide** entre `backend/` e `_shared/` (008–023) — **sempre qualificada** abaixo.
6. **RBAC de staff é canon backend/ADR-013** (roles `bevox_admin|bevox_support|bevox_observer`, ADR-013 l.108),
   **não ADR-022** (backend/ADR-022 = policy-json sub-keys). A rule local `.claude/rules/backend-routes.md`
   mis-cita "ADR-022 staff RBAC" + nomes curtos + invoca o inexistente `requireRole` — ver BAIXO/governança.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 prontidão + ADRs aceitas)

- **§16.1 Marco-1** ("Pronto para integração", l.1481-1483) = repo + **CI verde** + migrations pg16 + módulos
  auth/organizations/users/professionals/services/customers + OpenAPI publicado + contrato harness
  documentado+testado com stub + deploy staging. ⇒ o único bloqueador **mensurável** de Marco-1 é **CI-verde
  (RED em Tests + Security)**.
- **§16.2 Marco-2** (l.1490) = calendar, conversations, messages, channels, ai-pipeline, autonomy; fluxos e2e;
  idempotência tools; métricas Prometheus; cobertura ≥70%. **§16.3 Marco-3** (l.1500) = payments (Stripe Connect),
  reminders, faq, rules, audit, observabilidade completa; WhatsApp direto; **LGPD DSR/retenção/consentimento**;
  **MFA TOTP**; SLO; rate-limit distribuído. Roadmap l.1401 coloca a absorção do calendar-service em Marco 3.
- **Fato estrutural:** o código entrega muito além de Marco-1 (calendar, payments, channels, autonomia,
  observabilidade parcial) — o README "Marco 1 bootstrap" **subdeclara** o que existe. O piloto exercita calendar +
  payments-manual (ADR-023 aceita) + o worker assíncrono independentemente do rótulo → os 2 CRÍTICOs são
  **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".
- **§5.6/ADR-023:** Manual Payment Mode (aceita) é o money-path do piloto; split Stripe Connect é repurposado p/
  assinatura SaaS → gaps de split/reconcile Stripe são deferimentos legítimos (mas `refund-reconcile` quebrado vira
  dívida-de-código nomeada, não só deferimento).
- **_shared/ADR-019 + ADR-020 (ambas aceitas ~2026-04-23):** mandam `consent_events`/`dsr_requests`/`legal_basis`,
  `bevox.retention.worker`, pseudonimização de `messages.content_text`, DELETE `/customers/:id` cascade. **grep
  global `legal_basis|consent_event|dsr_request|retention|pseudonym` em `src/ db/ scripts/` = ZERO** → o modelo
  canônico inteiro de consentimento/retenção está ausente do código (Marco-3 por roadmap; mas o piloto roda com PII
  real).

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-21) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO); `no-appointments-read-endpoint`; ADR-020 templates + ADR-021 priority-score não-materializados |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recontagem independente: **103 call-sites / 106 runtime / 80 paths / 95 ops / operationId:0 / 0 phantom / 11 undoc**; `/metrics-public` **partly REFUTED** (documentado yaml:511); NEW meta-finding (sem binding route↔Zod↔OpenAPI) |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO** (3 `workspace_id` doc-comment + residual `account_id` = composites sancionados + doc-comments) |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | `mfa.ts:34` blocklist + `seed-pilot.ts:153` gera base32 + `assertMfaSecretNotPlaceholder`; login não checa MFA = **correto** (Marco-3); `CLAUDE.md §8` stale |
| e | Testes faltando (hot paths) | ✅ | availability(rota)/reschedule/webhook Stripe(`constructEvent`=0)/inbound-vocab — zero e2e |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; 1 `@deprecated`; TODOs todos Marco-2/3 |
| g | LGPD | ✅ | consent/`ai_opt_out` armazenado-não-aplicado (vetor vivo); `received_events`/`message_records`/`execution_traces`/`payments.raw_payload_json` PII-cru não-apagável; DSR export incompleto + sem deleção |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main l.781); nenhum work-item p/ calendar/ADR-010 → grade CRÍTICA **invisível** ao tracker; 1 item auto-declara "5 LGPD prod gates pending (not ready-for-prod)" |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky+teardown) + Security RED **PIOR (49 high / 106)**; lint-RED = artefato local gitignored |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH**; `reconcile-refund-42703-DOA`; `money-mutation-idempotency` **de-escalado**; PCI-nil; conformances confirmadas |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH** (cross-repo re-verif); 3 misses NOVOS (inbound unknown-provider silent-drop; channel_phone null; received+audit não-transacionados); HMAC correto |
| l | Harness dispatch | ✅ | `dead_letter` **inalcançável ponta-a-ponta** (POST↔PATCH 404 + worker só loga); token-IDOR; `active_execution_id` nunca limpo (wedge turno-2); todos inertes no piloto |
| m | Alçapões do piloto | ✅ (traçado) | **triple-gated** (auth-actor + calendar + grade) inalterado; money-path manual OK com 2 bugs HIGH; worker-telemetry = 1 buraco de obs exercitado no piloto |
| n | Delta vs audit anterior | ✅ | 07-22 re-verificado; **0 refutações de código**; Security-RED muito pior; ~12 misses NOVOS; 2 de-escalações |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN — PASSA, classe de token errada.** `seed-pilot` cria org + `bevox_admin`; `POST /staff/sessions` cunha
   JWT staff **HS256** (`staff-auth.ts:67-92`). Só serve a rotas `requireStaff`. Sem rate-limit/lockout.
2. **VER AGENDA — QUEBRA na AUTH primeiro.** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`calendar/routes.ts:22,24`; `clerk-auth.ts:89,105-108`) + claim `organization_id` → token staff HS256 → **401**
   (`grep requireStaff src/modules/calendar/` = 0; o seed não cria usuário Clerk nem row `users`). *Se JWT Clerk à
   mão:* → `availability.ts:75 notFound("Calendar")` (**CRÍTICO b**). *Se Calendar à mão:* → grade vazia →
   `slots:[]` (**CRÍTICO c**). Sem `GET /appointments` para ver agendamentos sobre REST.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100%. (Endpoint é calendar-nested
   `POST /calendars/:id/appointments`, não org-nested como PRD §8.3-step1 — reforça o CRÍTICO c forçando um
   `calendar_id`.) Reschedule/transition têm 4 defeitos de correção; create/reschedule/transition não gravam
   `audit_events` (§12.8). **Main-path exactly-once É SÃO** (advisory xact-lock + recount in-lock + unique index +
   replay 23505; POST honra `Idempotency-Key`).
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** Pré-requisitos escondidos: serviço semeado
   `requires_prepayment=false` (`catalog.ts:67`; hook auto-charge nunca dispara) **e** `seed-pilot` não cria
   `payment_accounts` → precisa de `POST /payment-account/connect-manual` à mão (mesmo gate Clerk upstream).
   **1 bug HIGH** re-mark de charge terminal → orphan paid + confirma appointment + concede pacote.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile
   de paid/cancelled cru sem orquestração; **reconcile de refund DOA (42703)** — crons **LIVE** (`queue/index.ts:
   143,149`). Modo manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[CHANGED]`/`[REFUTED]` = status vs 07-22; **(v: …)** = verificação independente
(orquestrador fonte-primária, ou agente com evidência fresca); `[xrepo]` = dependência cruzada. Severidade ancorada
no gate do **piloto**; escalonamento p/ GA anotado. `file:linha` = evidência lida **nesta** sessão sobre código
byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO ×3 — orquestrador grep + agente calendar +
  agente schema)** — Nenhum caminho de produção escreve `professional_schedules` (grade semanal-base). Único
  `INSERT` = fixture `test/integration/calendar-booking.test.ts:120`. Produção só lê (`availability.ts:116`);
  `:126 if(!sched) continue` esvazia todo dia → `slots:[]` → `booking.ts:207 slot_conflict`. Sem CRUD de
  WeeklySchedule, sem Zod body, sem repo writer, sem símbolo `weeklySchedule` (grep=0). Nem `db/seed.ts` nem
  `seed-pilot` escrevem grade. Escopo §5.3 (backend/ADR-010 **aceita**). — Impacto: 100% dos agendamentos =
  `slot_conflict`. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (só seedar grade). **#1.**
  `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO ×2 — orquestrador + agente)** —
  `seed-pilot.ts` insere só org/staff/professional/service (exatamente **4** `.insert(`: :110,:157,:195,:217). Zero
  `calendars` (`createCalendar` nunca chamado) → `availability.ts:75 notFound("Calendar")`. `system_holidays`
  omitido é **fail-open** (`availability.ts:108-111` → `isSystemHoliday=false`), **não** co-bloqueador. — Esforço:
  **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×2 + grep)** — seed provisiona **só**
  um `staff_account` (HS256, `staff-auth.ts:67-92`); toda rota de calendar é `requireClerkAuth()` RS256
  (`calendar/routes.ts:22,24`) + claim `organization_id` → token staff rejeitado 401. `grep requireStaff
  src/modules/calendar/` = **0**; o seed não cria usuário Clerk nem row `users`. Gate de provisionamento Clerk/ops;
  sit **upstream** dos 2 CRÍTICOs. — Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-21; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-teardown`** `[carry]` **(v: RODADO)** — `pnpm test:integration` =
  **RED exit 1**, `1 failed | 92 passed (93)`. Falha = `calendar-booking.test.ts:259` "slot_conflict quando
  start_at < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be 'slot_conflict'` — o gate só
  dá `slot_conflict` se `now() > ~13:00 UTC`; rodei ~09:08 UTC → `booked`. + teardown **57P01** (2 ocorrências —
  suíte não fecha `closeDb/closeRedis` no `afterAll`). `ci.yml` job `Tests` (l.80) roda integração sem
  `continue-on-error` → falha o CI. `harness-contract.test.ts (12)` **passa** (issue #36 "5 falhas FK" é stale). —
  Esforço: **0,5h** (slot `now()`-relativo + `await closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-49-high`** `[carry, CHANGED — MUITO PIOR]` **(v: RODADO)** — `pnpm audit
  --audit-level high` = **RED exit 1, 106 vulns (7 low · 50 moderate · 49 high)** vs **36 / 18 high** no 07-22 →
  **+31 high**, só por advisories novos sobre o **lockfile congelado**. **19 módulos high distintos** (vs 12):
  `@fastify/static`, `@grpc/grpc-js`, `@opentelemetry/{auto-instrumentations-node,exporter-prometheus,propagator-
  jaeger,sdk-node}`, `brace-expansion`, `braces`, `fast-uri`, `fastify`, `find-my-way`, `js-yaml`, `nanoid`,
  `postcss`, `protobufjs`, `source-map-js`, `tmp`, `undici`, `vite`. **NOVOS highs prod-runtime vs 07-22:**
  `fastify` + `@fastify/static` + `find-my-way` (o core do servidor), `nanoid`; dev: `braces`, `postcss`,
  `source-map-js`. `security.yml` (`pnpm audit --audit-level high`, `continue-on-error: false`, l.38-39) +
  job `osv-scanner` → hard-fail. **Tendência: 12→15→18→49 high — dívida cresce sem tocar código.** — Esforço:
  **4-6h** (bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid). **#3.**

**Canais / money — alcançável no piloto**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(v: CONFIRMADO — Security Engineer cross-repo;
  "defeito confirmado mais danoso")** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:35,44`) e
  **persiste `"wa"`** em `channel_connections.provider` (`routes.ts:246` → coluna `notNull()` **sem CHECK**,
  `channels.ts:22`). Outbound `findExecutionDeliveryContext` null-coage provider ≠ pleno (`metaapi/repository.ts:
  197`) → `ctx.provider=null` → guard `seams.ts:360` → `skipped_missing_recipient` (`:376`); `isDeliveryFailure`
  exclui skips (`seams.ts:122-124`) → execução fica `done` (falso-sucesso). `bevox-meta-api` `origin/main`
  (`messages/schemas.ts:7 z.enum(["whatsapp","instagram"])`) exige enum pleno → `wa`/`ig` é invenção 100%-backend
  auto-inconsistente. **Alcançável NO piloto via staff-approve.** — Impacto: 100% das respostas a conversas reais
  descartadas em silêncio. — Esforço: **3-4h** (unificar vocab + CHECK + backfill + teste e2e). **#5.**
  `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, broadened]` **(v: CONFIRMADO — Security Engineer +
  orquestrador)** — `applyChargePaid` chama `insertPayment` **incondicional** (`service.ts:891`) após `markChargePaid`
  (guardado `WHERE status='pending'`, void sem rowcount, `repository.ts:395-398`). `markChargePaidManually`
  **não** tem status-gate (`service.ts:414-416` proíbe-o por design). Re-mark de `expired` (via
  `expireChargeManually`, cash-pay tardio) ou `refunded` (`markPaymentReversed` libera o slot único
  `repository.ts:916-920`) → payment `paid` órfão fresco + `confirmAppointmentIfUnconfirmed` (`:901-903`) + grant de
  pacote (`:915-924`) → **corrupção de estado**. `cancelled` só no path Stripe. Root-cause compartilhado alcança o
  path Stripe (`webhook-platform.ts:108`). Fix: `markChargePaid` RETURNING rowcount + gatear os 3 side-effects. —
  Esforço: **2h**. **#4.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA/outbound ligar — INERTE no piloto)**

- **`harness-dead-letter-unreachable-end-to-end`** `[carry, CHANGED — disputa FECHADA]` **(v: CONFIRMADO byte-level
  nos 2 repos + canon — harness agent + orquestrador)** — Backend `worker.on('failed')` (`queue/index.ts:267-269`)
  **só loga**. Único writer de `dead_letter` = `markExecutionDeadLetter` (`harness-callbacks.repository.ts:86`), via
  `PATCH /status='dead_letter'`. Harness POSTa todo callback (`bevox-callback.ts` `method:"POST"`), incl. seu
  próprio `dead_letter`; backend registra só `app.patch(.../status)` (`harness-callbacks.routes.ts:56`) → **404** →
  `dead_letter` **nunca escrito** ponta-a-ponta. Backend é **canon-CORRETO** (PRD §10.4 l.1076 PATCH vs stale
  §10.1 l.447 POST). Fix = **cross-repo** (harness→PATCH + errata canon), não edit de backend. Rules
  `backend-harness-contract.md`/`backend-workers.md` mis-atribuem a escrita ao worker do backend. — Esforço: **3h**
  (harness + canon). **#7.** `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry]` **(v: CONFIRMADO — harness agent + orquestrador
  linha-a-linha)** — o preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token**
  (`execution-token.ts:67-71`), mas **todo** handler age sobre o `:id` **da URL** (`harness-callbacks.routes.ts:73,
  91,113,142`) e **nunca** compara (`req.executionContext` só é atribuído, nunca lido — grep). Token válido para A
  escreve em qualquer execução B (IDOR cross-execution/cross-tenant); o branch `dead_letter` usa
  `resolveExecutionTokenAnyStatus` → alcança até execuções terminais. Conformance `four-callbacks-token-gated`
  (token ruim→401) **permanece** (autenticidade ≠ autorização). **Inerte no piloto** (harness undispatched);
  **CRÍTICO-GA**. — Esforço: **1h** (asserção `executionContext.execution_id === id` → 403). `[xrepo: bevox-harness]`
- **`completion-never-clears-active-execution-id`** `[carry, broadened]` **(v: CONFIRMADO — harness agent re-traçou
  todos os writers)** — `/complete` + `finalizeCompletion` + `resolveComplete` **nunca** nulam
  `active_execution_id` da conversa; **nenhum** caminho de lifecycle (complete-done, complete-waiting_approval,
  approve/edit/reject em `staff-ops`) o limpa — só pre-dispatch-fail (`releasePipelineClaim`) e timeout
  (`handoffConversationOnTimeout`). Guard de dispatch exige `active_execution_id IS NULL` (`orchestration/
  repository.ts:196`); timeout-scan só reclama execuções **não-terminais** → qualquer 1ª execução bem-sucedida
  trava a conversa (turno-2 `cutoff.ts:45 claimed:false`). — **Inerte no piloto**; **CRÍTICO-GA** (IA single-turn).
  — Esforço: **3h**. `[xrepo: bevox-harness]`
- **`complete-failed-strategy-not-mapped-to-error`** `[carry]` **(v: CONFIRMADO — único bug de código backend-vs-canon
  do contrato)** — `strategy:"failed"`+proposals vazias → `inferSuggestionType→"reply"` (`complete-service.ts:22,
  31`); autonomous → `done` (texto vazio=skip); manual/copilot → `waiting_approval`. Nunca `error`. Canon
  (backend/ADR-019 Am1 l.163-166) exige `error`; harness manda `strategy:"failed"` com `responseText:""` em falha
  genuína. — Esforço: **3h**. `[xrepo]`
- **`backend-never-sends-skills-allowlist`** `[carry]` **(v: CONFIRMADO — harness agent)** — `cutoff.ts:75 skills:[]`
  hardcoded; `staff-ops/actions.repository.ts:144 skills:[]`; `account_denied_tools` **nem existe** no
  `DispatchPayloadSchema`; harness trata `[]` como "todas as tools" (`permission-context.ts:72-74`) → PERM-05
  (allowlist por org) é **no-op** e2e. — **Inerte no piloto**; CRÍTICO-GA (agente over-permissionado). — Esforço:
  **4h**. `[xrepo: bevox-harness]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — route-reviewer)** — Não existe `GET /appointments`
  nem `/appointments/:id`; calendar GET expõe só /calendars + /availability. §10.1 não o enumera, mas persona mobile
  ("agenda do dia") + Fluxo 3 (§8.3) exigem → agendamentos write-only sobre REST. — Esforço: **3-5h**.
  `[xrepo: PRD §5.3/§8.3]`

**Auth / segurança (Marco-1; alguns mitigados no piloto 1 org/1 admin) — todos CONFIRMADOS pelo agente RBAC**

- **`staff-jwt-secret-no-min-length`** `[carry, broadened]` **(v: CONFIRMADO)** — `env.ts:60 STAFF_JWT_SECRET:
  optionalString`; refine de prod é **presence-only** (`:205-206 if(!val[key])`) → secret de 1 char passa;
  `staff-auth.ts:48-54,69-75` assina HS256. Secret fraco = forjável offline (de qualquer token de login) → JWT
  staff forjado = compromisso **total** do plano staff (cross-org staff-ops + impersonation). **NOVO (N1):** o
  mesmo secret assina o JWT de `state` do Google OAuth CSRF (`calendar/google/oauth.ts:95-96,129-139`) → uma chave
  HMAC sem piso de entropia guarda **dois planos de confiança** (mitigante parcial: nonce Redis single-use no
  callback). — Esforço: **0,5h** (`.min(32)` + idealmente separar chaves). **O buraco de segurança mais duro.**
- **`staff-login-no-ratelimit-no-lockout`** `[carry]` **(v: CONFIRMADO)** — `auth/routes.ts:90-94,97-101` login/
  refresh sem `preHandler`; sem contador/lockout (`service.ts:64-90`); `requireRateLimit` (`rate-limit.ts:146`)
  aplicado a **zero** rotas; bcrypt cost 12 é o único freio → brute-force online contra `staff@example.com` semeado.
  — Esforço: **2-4h**.
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — enumeração completa)** — `requireRole` só existe
  como 3 TODOs (`clerk-auth.ts:25`, `auth/repository.ts:261`, `types/global.d.ts:35`); zero impl/caller;
  `clerk-auth.ts:109 role = … ?? "member"` (nem é valor do enum). Rotas cliente mutantes (money, DELETE/PATCH
  professionals|services, PATCH org/settings+onboarding+autonomy, approvals, PII customers, waitlist) têm só
  `requireClerkAuth+requireOrganizationScope` → qualquer JWT org-member roda tudo intra-org (org-scope ainda bloqueia
  cross-org). Blast-radius baixo no piloto (1 org/1 admin). — Esforço: **8h+**. `[xrepo: backend/ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO)** — `auth/repository.ts:221-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id)
  + `routes.ts:169-171 orgClaim = organization_id ?? clerkUserId`; webhook só trata `user.*`, sem
  `organization.created` → 1º user de uma org inprovisionável (chicken-and-egg). Mitigado no piloto (seed);
  alimenta o gate auth-actor. — Esforço: **1-2d** (+ADR org-mapping). `[xrepo: Clerk]`
- **`clerk-jwt-no-aud-iss-validation`** `[carry]` **(v: CONFIRMADO)** — `clerk-auth.ts:89-92` verifica só
  `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim não-verificada
  (`:105`). Alg-confusion bloqueado, JWKS pinado (mitigantes; staff-side checa `audience`). — Esforço: **0,5-1h**.
- **`impersonation-id-is-not-organization-id`** `[carry]` **(v: CONFIRMADO — latente/fail-closed)** —
  `auth/service.ts:135-139` seta claim `impersonation_id` ao PK da row `staff_impersonations`;
  `organization-scope.ts:57` retorna esse PK como org id → rota `:organization_id` sempre 403. Nenhuma rota pareia
  `requireStaff`+`requireOrganizationScope` → nunca consumido. **NOVO (N2):** `authRoutes` é plugin encapsulado
  (`server.ts:195-198`) → o hook onResponse de audit de impersonation (`auth/routes.ts:70-87`) **nunca dispara** nas
  rotas staff-ops (plugins separados `server.ts:213-215`) — único alvo de um token de impersonation; e
  `endImpersonationSession` não revoga o token HS256. "Auditoria forte" de ADR-013 **não entregue**. — Esforço:
  **2-3h**. `[xrepo: ADR-013]`

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real) — CONFIRMADOS pelo agente LGPD**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry, sharpened]` **(v: CONFIRMADO — vetor vivo, headline LGPD)**
  — `ai_opt_out` gravado/lido só no CRUD de customers (`repository.ts:21,26,67`; **zero** outros readers — grep);
  `cutoff.ts:49-76` + `buildDispatchMessages` (`orchestration/repository.ts:391-415`, `content_text` cru) +
  `dispatchExecution` **sem** carregar o customer nem checar `ai_opt_out` → cliente que revoga consentimento ainda
  tem a conversa mandada ao LLM externo (transferência intl, _shared/ADR-019 item 7). **Sharpened:** `ai_opt_out`
  default `false` (opted-IN) **e** `consent_granted_at` = **zero writers** em qualquer lugar → o piloto processa
  conversas sem consentimento registrado E com flag de revogação não-aplicado. — Esforço: **4-6h**. **#10.** `[xrepo]`
- **`waitlist-priority-score-client-settable`** `[carry]` **(v: CONFIRMADO — agentes schema + calendar)** —
  backend/ADR-021 (aceita) fecharia o vetor tornando `priority_score` derivado; mas é raw-storage writable
  (`calendar.ts:204 numeric notNull default '0'`, sem CHECK) escrito do input (`seam-tool.ts:44`→`repository.ts:278`)
  e `match` ordena pelo valor; colunas `urgency_level`/`skip_count`/`last_score_update` + fórmula + cron **não
  existem** → furar-fila aberto. — Esforço: **6-8h**. `[a/g; ADR-021]`

### MÉDIO (degrada qualidade)

**Observabilidade — worker é buraco-negro triplo (harness inerte no piloto, exceto obs que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry]` **(v: CONFIRMADO — orquestrador grep + agente;
  ALTO-operabilidade, exercitado-no-piloto)** — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca**
  `import "./instrument.js"` nem `initTelemetry()` (ambos só em `src/index.ts:17,30`; `queue/index.ts:62` importa só
  captureException+shutdownTelemetry) → no worker o Sentry `captureException` (`:272,313`) é drop silencioso e o OTel
  NodeSDK nunca inicia p/ **toda a metade assíncrona** do piloto (ingestion, cutoff→dispatch, timeout/expiry, 2 crons
  de reconcile, google sync, waitlist, package-expiry). — **1h** (import + `await initTelemetry()`). **Alto valor /
  baixo esforço. #6.**
- **`worker-process-has-no-metrics-scrape-endpoint`** `[carry]` **(v: CONFIRMADO)** — `/metrics` é servido só pelo
  HTTP server (`health/routes.ts:24`, `server.ts:189`); o worker não sobe listener HTTP → counters prom-client do
  worker (reconcile `:88,114,162,229,272`) **permanentemente não-scrapáveis**. — **1-2h**.
- **`domain-prometheus-metrics-not-registered`** `[carry]` **(v: CONFIRMADO)** — `shared/metrics.ts` não registra os
  de §12.10 l.1365 (`charges_succeeded_total`, `appointments_no_show_rate`, `executions_pending_approval_count`,
  `executions_timeout_total`) nem os de l.590 "Módulo 16" (`executions_total`, `charges_total`,
  `queue_jobs_completed_total`). `charges_succeeded`/no-show relevantes ao piloto. — **2-3h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` **(v: CONFIRMADO)** — `realtime/publish.ts:8-13`
  união fechada a `execution.*`/`waitlist.offered`; `appointment.created`(§8.3)/`charge.updated`(§8.4/§10.1) **nunca**
  emitidos → tela do profissional não auto-atualiza no agendar/pagar. — **2h**.

**Agenda — correção de dados quando exercitada (Marco-2; todos CONFIRMADOS pelo agente calendar)**

- **`appointment-mutations-no-auditevent`** `[carry]` — §12.8 manda Appointment C/U/D → AuditEvent; `booking.ts:219-516`
  grava **zero** `audit_events` (só charge audita `:291,326`); autonomy + onboarding idem → trilha ausente no
  fluxo-núcleo. — **2-3h**.
- **`reschedule-non-atomic-double-book`** `[carry]` — `booking.ts:373` create+outbox na própria tx (`:223`);
  `:390-414` cancela o antigo em tx **separada** → crash entre as duas = 2 appointments ativos. — **1-2h**.
- **`reschedule-self-overlap-always-conflicts`** `[carry]` — recount conta o appointment antigo (ainda `scheduled`;
  `availability.ts:169`+`booking.ts:229` excluem só `'cancelled'`, nunca self-id) → `max_concurrent=1` → remarcação
  sobrepondo = `slot_conflict`. — **1h**.
- **`appointment-transition-no-state-guard`** `[carry]` — `booking.ts:445` UPDATE any→any (só row-existence);
  `cancelled→completed` → decremento de pacote (`:485-499`) consome sessão de appointment cancelado. — **1-2h**.
- **`reschedule-thin-idempotency`** `[carry]` — `booking.ts:387 idempotencyKey:undefined` → NULL; idemHit/idemStore
  no-op. (POST de create É idempotente — `routes.ts:88`.) §5.3 l.396 exige idempotência na criação. — **1h**.
- **`availability-n1-count-plus-92day-serial-loop-unbounded`** `[carry]` **(v: CONFIRMADO — GA-scaling/DoS)** —
  `availability.ts:167` COUNT(*) **por-slot** em loops por-membro(`:114`)×por-intervalo(`:160`)×por-slot(`:162`);
  `routes.ts:52` itera `date_from..date_to` serial até 92 dias (`schemas.ts:29`). Auth-guardado mas não
  rate-limited. Não pilot-blocking (1 prof). — **4-6h**.
- **`pilot-service-prepay-false-and-no-payment-account`** `[carry]` **(v: CONFIRMADO — 2 agentes)** — serviço semeado
  `requires_prepayment=false` (`catalog.ts:67`) → hook auto-charge nunca dispara (`booking.ts:275`); `seed-pilot`
  não cria `payment_accounts` → charge manual também precisa de `connect-manual` à mão (4º gate do money-path). —
  **M (ops OU 0,5h seed)**. `[xrepo: hub runbook]`

**Contrato backend↔harness (mismatches; persistem — INERTES no piloto, ALTO-GA) — CONFIRMADOS pelo agente harness**

- **`complete-trusts-body-organization-id-over-authoritative-row`** `[carry]` **(v: CONFIRMADO)** — `/complete` lê
  tenant do **body** (`harness-callbacks.routes.ts:150-154 bodyOrgId ?? row`) sem checar `=== existing.
  organization_id` (traces/stream usam a row — assimetria); com o token-IDOR = primitiva de escrita cross-tenant. —
  **1h**. `[xrepo]`
- **`complete-rejects-aborted-strategies-400`** `[carry]` **(v: CONFIRMADO — bug de HARNESS)** — harness emite
  `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2097-2101`); enum backend omite (`harness-callbacks.
  schema.ts:57-65`) → ZodError → 400. Canon fica com o backend (l.1104); abort backstopped por timeout-scan. —
  **2h** (harness). `[xrepo]`
- **`completing-state-has-no-timeout-backstop`** `[carry]` — `lockForCompletion` seta `completing`
  (`repository.ts:128`); timeout-scan claima só `('dispatching','processing','waiting_input')` (`:428`) → crash
  entre lock e finalize deixa row órfã travada. — **1h** (+ grace window). `[xrepo]`
- **`stale-token-blind-status-transition`** `[carry]` — `applyStatusTransition` é UPDATE cego sem guard de origem
  (`harness-callbacks.repository.ts:64-67`) → callback tardio regride `waiting_input↔processing`. Com token-IDOR,
  qualquer `:id`. — **3h**. `[xrepo]`
- **`trace-content-field-dropped-on-persist`** `[carry, worse]` — `harness-callbacks.repository.ts:199-204` mapeia
  `output_json←output_json??output??null`, `step_name←step_name??name??'unknown'`, mas o `TraceEntry` do harness
  carrega o payload em **`content`**(+`step`,`timestamp`) → só `type` sobrevive; `step_name='unknown'`, json
  `'null'::jsonb`; `sendTrace` sem callers no harness → /traces nunca invocado. — **1h**. `[xrepo]`

**Pagamentos / reconciliação (Stripe-path, não exercitado pelo piloto manual; crons LIVE)**

- **`reconcile-cron-flips-paid-and-cancelled-without-orchestration`** `[carry]` **(v: CONFIRMADO)** —
  `reconcile.ts:140-149 UPDATE charges SET status='paid'/'cancelled'` cru (charges TEM `updated_at` → executa) sem
  `applyChargePaid` → paid sem row em `payments`, appointment nunca confirmado, sem grant, sem audit. Manual pula. —
  **3h**.
- **`reconcile-cron-skips-applyChargeRefunded`** `[carry]` — `reconcile.ts:252-259` nunca chama
  `applyChargeRefunded` → viola ADR-018 (full refund de package ⇒ `cancelled`). **Composto com o 42703 (ALTO): a
  UPDATE nem executa.** — **2h**.
- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry]` **(v: CONFIRMADO ×3 — Security + schema +
  orquestrador)** — `reconcile.ts:254-259 UPDATE refunds SET status=…, updated_at = now()`, mas `refunds` **não tem**
  `updated_at` (`db/schema/payments.ts:149-172`; só `createdAt:164`; migrations 0011/0017/0019 não adicionam) →
  **Postgres 42703** em toda transição → `:262` catch → `failCount++` → status **nunca** sai de `pending` → reconcile
  de refund **DOA**. O irmão `reconcileStuckIntents` escreve `updated_at` em `charges` (que TEM a coluna) — o mirror
  de refund copiou o padrão cego. Path manual (`updateRefundStatus`, `repository.ts:476-485`, **omite** `updated_at`
  por design) funciona. **Fix = alinhar: remover `updated_at=now()` de `:257`** (NÃO adicionar a coluna — schema +
  repository a omitem deliberadamente). — **0,25h**. Stripe-path, inerte no piloto manual; ALTO-GA. `[xrepo: Stripe]`
- **`stripe-webhook-zero-route-signature-dedupe-tests`** `[carry]` — 0 `constructEvent` em `test/`; nenhum teste
  injeta `POST /webhooks/stripe[/platform]`; o teste homônimo mocka o repo. Ponto de entrada de dinheiro sem
  cobertura. — **6h**. **#8.** `[xrepo: Stripe]`
- **`requires-prepayment-hook-throws-manual-mode`** `[carry]` — `booking.ts:277,299` hardcoda Stripe `createCharge`;
  conta manual (`external_account_id=NULL`) → `service.ts:193 lança "payment account not active"`; caught best-effort
  (audita `charge.hook_failed`) → prepayment não coletado em orgs manuais (silencioso). — **3h**.
  `[xrepo: ADR-023 vs ADR-014]`
- **`pix-reconcile-split-2-endpoints-vs-adr014`** `[carry]` **(v: CONFIRMADO — canon lido l.134/172)** —
  `/webhooks/stripe` (`webhook.ts:31`, account.updated) + `/webhooks/stripe/platform` (`webhook-platform.ts:32`,
  payment_intent.*/refund.*, secret `_PLATFORM`); **ADR-014 documenta UM endpoint + UM secret**. Split deliberado
  (PIs destination-charge chegam platform-scoped); ambos secrets `requiredInProd` (`env.ts:200,203`) → sem gap de
  prod. — **1h** (errata canon + startup-assert). `[xrepo]`

**Canais — perda de inbound (CONFIRMADOS pelo Security Engineer)**

- **`inbound-dedupe-strand-onboarding-loss`** `[carry]` — `metaapi/routes.ts:174` SETNX dedupe **antes** do persist;
  `:190 throw notFound` (tenant unmapped) na janela de onboarding → key strandada; meta-api retenta →
  `:175-179 replayed` 200 → evento **perdido**. `DEL` (`:280-282`) só cobre `message.received`. — **2-3h**.
  `[xrepo: bevox-meta-api]`
- **`null-tenant-audit-notnull-500-inbound-loss`** `[carry, calibrado]` — `tenant_id` `.nullable()`
  (`schemas.ts:38`); `routes.ts:216-227` audit INSERT passa `organization_id=NULL` numa coluna `.notNull()`
  (`db/schema/audit.ts:24-26`) → 23502 → 500 → key strandada → retry `replayed` → perdido. Alcançável por eventos
  account-level null-tenant (`waba.connection_changed`/`phone_number.quality_changed`, ambos assinados). — **1-2h**.
  `[xrepo: bevox-meta-api]`
- **`status-events-subscribed-but-ignored`** `[carry, ALTO-GA]` — assina 5 tipos (`server.ts:249-255`) mas
  `routes.ts:234` trata só `message.received`; `message.status_updated` (**FAILED** outbound) sem handler → falha de
  entrega assíncrona nunca reconciliada; compõe com o vocab-drop. — **4-8h**. `[xrepo]`
- **`inbound-unknown-provider-silent-drop`** `[NOVO]` **(v: Security Engineer — MISSED-A)** — `message.received` com
  provider `"unknown"` (`normalize.ts:47`) ou shape inextraível falha o guard de dispatch (`routes.ts:238-241`) →
  persistido + `"accepted"` 200 retornado, mas **nunca dispatchado** E **sem skip-audit** → drop de inbound
  silencioso reportado como sucesso. Gêmeo inbound do vocab-drop. — **M**. `[xrepo: bevox-meta-api]`
- **`channel-phone-always-null-provider-join`** `[NOVO]` **(v: Security Engineer — MISSED-B)** —
  `findExecutionDeliveryContext` (`metaapi/repository.ts:186-188`) acopla `customer_channels.provider = cc.provider`;
  `customer_channels.provider` sem CHECK (`db/schema/customers.ts:68`) → mismatch canônico-vs-`"wa"` → `channel_phone`
  sempre null (só `primary_phone` salva o recipient). Alimenta o vocab-drop. — **S** (fold no fix de vocab).
- **`received-events-and-audit-written-non-transactionally`** `[NOVO]` **(v: Security Engineer — MISSED-C)** —
  `metaapi/routes.ts` grava `received_events` (`:202`) e `audit_events` (`:215`) como dois `db.execute` **sem tx**
  → escrita parcial sob o null-tenant-500 (received_event persiste, audit perdido) e métrica/response divergem da
  trilha. — **S-M**.

**LGPD / retenção / schema (Marco-3; piloto roda com PII real) — CONFIRMADOS pelos agentes LGPD + schema**

- **`received-events-raw-payload-unscoped-un-erasable`** `[carry]` **(v: CONFIRMADO — LGPD + schema)** —
  `metaapi/routes.ts:201-212` persiste o envelope Meta cru (`payload_json`: wa_id/telefone/nome/texto) em
  `received_events` (`ingestion.ts:12-30`), que tem **zero `organization_id`, zero `customer_id`, zero `deleted_at`**.
  Nunca purgado, omitido do DSR export, un-joinável → sink de PII cru erasure-impossível. — **6-8h** (fold ADR-020).
  `[xrepo: _shared/ADR-020]`
- **`message-records-content-un-erasable-omitted-from-dsr`** `[carry, sharpened]` **(v: CONFIRMADO — LGPD + schema)**
  — `message_records` (`ingestion.ts:32-49`) sem `organization_id`/`customer_id`, apesar de `content_text`(`:42`,
  corpo egresso ao LLM) + `sender_snapshot_json`(`:47`); único FK `received_event_id ON DELETE set null` → não
  cascateia de `organizations`; keyed por `conversation_key` TEXT (sem FK) → DSR/erasure **não consegue achar** as
  rows do titular. §12.9 l.1356 exige pseudonimizar `Message.content`. — **6-8h**. `[xrepo: _shared/ADR-020]`
- **`denormalized-customer-contact-snapshot-defeats-erasure`** `[carry]` — `appointments` (`calendar.ts:128-130`) e
  `waitlist_entries` (`:194-196`) guardam `customer_name/phone/email` denormalizados com `onDelete:"set null"` no FK
  → hard-delete deixa snapshot de PII órfão; cross-border ao Google (`sync.ts:203`). — **fold ADR-020**.
- **`retention-worker-adr020-absent`** `[carry]` **(v: CONFIRMADO — grep global = ZERO)** — `queue/index.ts` **11
  workers**, nenhum purga/pseudonimiza; sem `consent_events`/`dsr_requests`/`legal_basis` (grep=NONE);
  `deleted_at`/`consent_granted_at`/`archived_at` nunca escritos; `auth/repository.ts:99` **admite** em comentário:
  "Hard-delete worker (canon ADR-020, ainda não landed em main)". — **12-16h**. `[xrepo: _shared/ADR-020]`
- **`no-dsr-deletion-endpoint`** `[carry]` — único `app.delete` em todo `src/` é `services/routes.ts:50` (serviço,
  não titular); sem delete de customer; `deleted_at` filtrado (`repository.ts:31,41`) mas nunca escrito. **Nuance:**
  DSR **export** EXISTE (`GET /api/v1/customers/:id/export`, `routes.ts:97`) — só a **deleção** falta. — **6-8h**.
  `[xrepo: _shared/ADR-020]`
- **`dsr-export-incomplete-omits-subject-data`** `[carry, broadened]` **(v: CONFIRMADO — LGPD)** — `CustomerExport`
  (`service.ts:77-110`) retorna 9 cols; omite `preferences_json`/`risk_flags_json`/`consent_granted_at` +
  `messages`/`audit_events` hardcoded `[]` (`:107-108`). **NOVO:** omite inteiramente `customer_channels`
  (`phone_number`/`handle`/`display_name`, `customers.ts:70-72`) — a loja de identidades de canal do titular nunca é
  referenciada no módulo customers (grep=0). — **1-2h**.
- **`customer-pii-mutations-unaudited`** `[carry]` — `customers/service.ts:29-62` escreve **zero** `audit_events`
  (só TODOs `:85-86,108`); os outros 12 módulos auditam. Create/patch PII + toggle `ai_opt_out` sem trilha (art.37
  RoPA). — **1-2h**.
- **`execution-traces-pii-retained-omitted-from-dsr`** `[carry]` — `harness-callbacks.repository.ts:196-204` grava
  `input_json`/`output_json` crus; tem `org+execution_id` mas **sem `customer_id`**, sem retenção, omitido do DSR. —
  **4h**.
- **`google-calendar-intl-transfer-customer-name-no-basis-gate`** `[carry]` — `sync.ts:203,237` empurra
  `summary="${service} — ${full_name}"` (NOME) p/ Google US (transferência intl) via `createGoogleEvent:245` sem gate
  de consent/ai_opt_out. — **~2h**. `[xrepo: _shared/ADR-019]`
- **`payments-raw-payload-json-pii-residue`** `[carry]` — `payments/repository.ts:422-439 insertPayment` guarda o
  evento Stripe cru `raw_payload_json` (billing_details nome/email/phone, passado por `webhook-platform.ts:117,135`);
  `payments` sem `customer_id`, sem retenção, omitido do DSR. — **fold ADR-020**.

**Schema (índices/materialização; GA-scaling — CONFIRMADOS pelo agente schema)**

- **`section-11-3-critical-indexes-partially-absent`** `[carry]` **(v: CONFIRMADO — canon l.1270)** — ausentes
  `(org,status)` em appointments/charges/executions; `(org,start_at)`+`(org,customer_id)` em appointments;
  `(org,customer_id)` em charges/conversations. Presentes (corretos): `(org,status)`+`(org,last_message_at)` em
  conversations. Risco = scans org-wide na escala GA; pilot-inert (1 org). — **2h** (uma migration).
- **`fk-columns-without-index-systemic`** `[carry, wider]` **(v: CONFIRMADO + ampliado)** — org_id FK sem índice em
  customers/professionals(+user)/services/calendars/users/executions(+conversation+buffer_window);
  `payments.charge_id`+`refunds.charge_id`; `customer_channels.customer_id`; 5 child-FKs de `charges`. **NOVO
  (ampliado):** também `professional_schedules`, `professional_schedule_overrides`, `waitlist_entries`,
  `waitlist_match_outbox`, `buffer_windows`(+filhos), tabelas `google.ts`, `stripe_webhook_events.organization_id`.
  Viola `backend-db.md`. — **2-3h** (uma migration). `[a/schema]`
- **`conversations-child-fks-unindexed`** `[carry]` — `conversations.ts:28,31,34` customer_id(cascade)/
  channel_connection_id/customer_channel_id sem índice → cascade-delete full-scan. — **S (fold na migration)**.
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized`** `[carry]` **(v: CONFIRMADO)** —
  backend/ADR-020 (message_templates + enums, aceita 2026-05-21) e backend/ADR-021 (priority-score fórmula +
  colunas + cron) **não materializadas** (grep `message_template`/`urgency_level`/`skip_count`=NONE). ADR-022
  policy-json **materializada** (`catalog.ts:110-113`); ADR-023 manual-payment materializada (0016). **NOVO:** a prosa
  de ADR-020 reservou "Migration 0016", mas 0016 é ADR-023 (doc-stale). — ADR-020 **4-6h**; ADR-021 **6-8h**.
  `[a; Marco-2/3]`

**Autonomia / rate-limit / onboarding (harness inerte no piloto) — CONFIRMADOS pelos agentes**

- **`ratelimit-infra-dead-app-wide`** `[carry]` **(v: CONFIRMADO)** — plugin **Lua custom** (`rate-limit.ts`),
  **não** `@fastify/rate-limit` (`package.json:37`, **importado em lugar nenhum — dep morta**). `requireRateLimit`
  aplicado a **zero** rotas; webhooks públicos (stripe/metaapi/google/clerk) + login staff destravados; §12.6 l.1327
  manda IP/org/heavy caps (rate-limit distribuído = Marco-3). — **~half-day** (wire). GA, não pilot.
- **`autonomy-patch-nontransactional-mode-audit`** `[carry]` — a desculpa do código ("no tx helper exists",
  `autonomy/repository.ts:67`) é **FALSA** (`.transaction(` usado em 7 sites); UPDATE (`:87`) + audit INSERT (`:111`)
  só guardados por `if(modeChanging)` (`:109`), não tx → mudança de modo sem AuditEvent se o INSERT falha. (Nota:
  o mode-change **audita** — `:109-123` grava `autonomy.mode_changed`; o gap é a não-atomicidade.) — **1h**.
- **`onboarding-advance-no-prereq-arbitrary-stage`** `[carry]` — `organizations/repository.ts:151-165 SET
  onboarding_stage` cru; `schemas.ts:35-51` aceita qualquer dos 11; `routes.ts:70-78` sem prereq/role/audit; §5.8
  exige checklist; `ai_mode` não flipa; `getOnboarding` não retorna checklist/next-action. — **3-4h**.
- **`autonomy-action-granularity-and-readiness-score-dead`** `[carry]` — `resolver.ts:62` gateia só `current_mode`;
  `PolicyEvaluator`/`fetchOrgAutonomyPolicies` (`seams.ts:64,115`) com **zero** callers de produção;
  `readiness_score` nunca computado (`repository.ts:20,26`) → `GET /autonomy` sempre `readiness_score:null`. —
  **large**.

### BAIXO (higiene)

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recontagem independente: 103 call-sites/106 runtime/80/95/0/0/11)**

- **`openapi-drift-undocumented-handlers`** `[carry]` **(v: CONFIRMADO — route-reviewer, 11/11)** — GET/PATCH
  /autonomy, GET /channel-connections, GET /customers/{id}/export (DSR), GET/PATCH /payment-account/policy, GET
  /api/v1/realtime (SSE), POST /webhooks/stripe, /stripe/platform, POST /webhooks/google, GET /webhooks/google/
  callback. 7 dos 11 estão DENTRO de `routes.ts` mas hand-omitidos (não é só "fora de routes.ts"). — **2-3h**. **#9.**
- **`no-mechanical-route-zod-openapi-binding`** `[NOVO]` **(v: route-reviewer — root-cause meta-finding)** — ZERO das
  106 rotas usa a opção `schema:` do Fastify; sem `ZodTypeProvider`/`serializerCompiler`/`validatorCompiler`;
  validação é `.parse()` inline, responses hand-built, OpenAPI 100% YAML estático; `openapi:types` só gera TS **a
  partir do** YAML (nunca rotas→YAML) → **sem binding mecânico** route↔Zod↔OpenAPI → é a razão estrutural de **todo**
  drift de categoria b (reply-schema-vs-handler incatchável em compile-time). Fix = adotar `fastify-type-provider-zod`
  OU gerar YAML das rotas em CI (requer ADR, §3/ADR-012). — **M-ALTO**.
- **`handlers-outside-routes.ts`** `[carry]` — 4 handlers vivos fora de `*routes.ts`: `payments/webhook.ts:31`,
  `webhook-platform.ts:32`, `calendar/google/webhook.ts:48,80` → viola CLAUDE.md §5. — **S/M**.
- **`openapi-missing-operationid`** `[carry]` — `operationId`=**0** em 95 ops → codegen degradado. — **1-2h**.
- **`openapi-status-callback-missing-dead-letter` + `openapi-enum-create-refund-missing`** `[carry]` — enum status
  `[running,paused,cancelled]` sem `dead_letter` (`yaml:298`); `ExecutionProposal.action` omite `create-refund`
  (`yaml:324-329` vs Zod `schema.ts:35`, executado `seams.ts:172`). — **0,25h/ea**.
- **`checkout-vs-payment_link-Zod-DB-divergence`** `[carry]` **(v: CONFIRMADO — route-reviewer + orquestrador)** —
  `charge-intent.ts:87 ONLINE_PAYMENT_METHODS=["pix","checkout"]` vs `yaml:2602 [pix]`; `checkout` ∉ DB CHECK
  (`payments.ts:113`, que lista `payment_link` que nenhum Zod aceita) → `checkout` é 501-stub (`checkout.ts`) →
  **latente/inerte** hoje (não alcança o DB); landmine 23514 se Checkout for wired sem migration. — **S**.
- **`metrics-endpoint-public`** `[carry, PARTLY REFUTED]` **(v: route-reviewer)** — `/metrics` **está documentado**
  (`yaml:511`, `security:[]`, text/plain); handler auth-free (`health/routes.ts:24`) é **intencional** (scrape
  Prometheus). "Público" é correto; "undocumented" é **falso**. — não-gap.
- **`error-envelope-dual-schema` / `rate-limit-429-undocumented` / `sse-realtime-header-auth-contract`** `[carry]` —
  YAML define `Error`(sem request_id) E `ErrorEnvelope`(com); responses `$ref`-am o `Error` enquanto o handler emite
  `request_id` (`errors.ts:7`); 429 não documentado (plugin live); SSE só aceita `Authorization: Bearer`
  (`clerk-auth.ts:173-181`) → `EventSource` do browser não autentica. — 0,25-2h/ea.

**Harness (resíduos BAIXO — todos INERTES no piloto)**

- **`complete-returns-409-not-410-gone`** `[carry]` — `/complete` retentado = 409 (`routes.ts:160`); PRD l.821 manda
  **410**. — **0,5h**. `[xrepo/canon]`
- **`complete-skips-redis-stream-del`** `[carry]` — PRD l.824 requer `DEL stream:{id}` no desfecho; handler nunca
  deleta → buffer fica 1h (TTL deslizante). — **0,5h**. `[xrepo]`
- **`complete-done-path-omits-execution-updated-sse`** `[carry]` — autonomous-done pula `execution.updated` SSE que
  PRD l.825 implica (`complete-service.ts:100-109`); só o branch waiting_approval publica (`:112`). — **1h**. `[xrepo]`
- **`harness-ignores-dispatched-callback-base-url`** `[carry]` — backend manda `callback_base_url`
  (`harness-dispatcher.ts:94`) mas harness hardcoda `BASE_URL=config` (`bevox-callback.ts:7`). — **1h**.
  `[xrepo; ALTO-GA-ops]`
- **`deadletter-overwrites-rejected-expired-underspecified`** `[carry]` — `markExecutionDeadLetter WHERE status NOT
  IN ('done','cancelled','dead_letter')` (`repository.ts:90`) sobrescreve `rejected`/`expired`; ADR-019 Am1 silente
  sobre esses 2 (latente — dead_letter não pode chegar pós-rejected). — **0,25h**. `[xrepo]`
- **`status-meta-stripped-silently`** `[carry]` — `StatusCallbackSchema` (`schema.ts:15`) sem `.passthrough()` →
  strip de `action`/`failedReason`/`attemptsMade` do dead_letter; moot até o 404 ser corrigido. — **0,25h**. `[xrepo]`
- **`canon-complete-strategy-enum-stale`** `[NOVO, canon]` **(v: harness agent — N3)** — backend+harness emitem
  `strategy:"workflow"` (`schema.ts:62`, `execution-handler.ts:1042`) mas o enum do body `/complete` no canon (PRD
  l.1104) o omite → errata aditiva no canon (ADR-005). — **n/a (canon)**.

**Auth / schema / obs (resíduos + misses novos — todos BAIXO/latente)**

- **`staff-session-no-logout` / `staff-login-user-enumeration-timing` / `staff-refresh-tokens-no-expiry-sweep` /
  `clerk-provisioned-role-hardcoded-operator` / `clerk-resolvelocaluser-fail-open-authz-trap`** `[carry]` **(v:
  CONFIRMADO — RBAC)** — sem logout/revoke (`service.ts:99-101`); enum-timing (`service.ts:68-71` lança antes do
  bcrypt); refresh expirados nunca varridos (`repository.ts:106-116`); `upsertUserFromClerk` insere
  `role='operator'` e `ON CONFLICT` não atualiza (`repository.ts:236-240`); `resolveLocalUser` fail-open em erro de
  DB (`clerk-auth.ts:130-138`, trap se `requireRole` for wired). — S/ea.
- **`staff-access-token-no-live-revocation`** `[NOVO]` **(v: RBAC — N3)** — `verifyStaffAccessToken`
  (`staff-auth.ts:79-104`) é stateless/DB-less → token de staff desativado vale até expirar (≤900s); login/refresh
  são fail-closed, mas não há revogação de token vivo. Padrão JWT; combina com o secret fraco. — S.
- **`uuidv7-sql-default-missing-post-0000-tables`** `[carry, count=14]` **(v: CONFIRMADO — schema)** — **14** tabelas
  de `0000` têm `SET DEFAULT gen_uuid_v7()` (`0000:307-320`); as 30 pós-0000 não (grep 0001-0020=0). Fail-closed
  (`_shared.ts:108-111 $defaultFn`). Pura higiene/DX. — **2h**.
- **`newopaqueid-uuidv4-dead-code` / `appointments-customer-package-id-no-db-fk` / `executions-original-execution-id-
  unindexed` / `customers-deleted-at-read-but-never-written` / `metric-cardinality-unbounded-org-label` /
  `availability-professional-id-filter-missing` / `appointment-created-by-not-persisted` / `no-availability-409-not-
  422`** `[carry+NOVO]` **(v: CONFIRMADO — múltiplos agentes)** — `staff-auth.ts:139 newOpaqueId()=randomUUID()`
  UUIDv4 **dead-code (0 callers)** — não é violação viva de UUIDv7; `calendar.ts:124` sem `.references()`;
  `executions.ts:47` sem índice (benigno); `deleted_at` nunca escrito (soft-delete morto); **NOVO** `metrics.ts:33`
  `organization_id` em labelNames de `httpRequestsTotal` → cardinalidade ilimitada no GA (benigno 1-org);
  `calendar/schemas.ts:18-22` omite `professional_id` (§10.1 l.966); appointments **não tem** colunas
  `created_by_type/id` (§8.3-step3; `calendar.ts:140` é `source`); 409 para no-availability (§8.3 quer 422). —
  0,25-3h/ea.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: CONFIRMADO — orquestrador)** — tags só
  `v1.0.0`/`v1.0.1`; `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora
  (incl. dispatch amendment); `release.yml` dispara só em `v*.*.*` → **nenhuma imagem (SemVer OU sha) pós-`v1.0.1`**.
  `git describe HEAD` = `v1.0.1-31-g7e2a33a`. Versão diverge **4-way**: `package.json 0.1.0` / `openapi 1.11.0` / tag
  `v1.0.1` / hub `vX.Y.Z`. — **0,5-1h** (cortar tag). `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: CONFIRMADO)** — `CLAUDE.md §8` diz seed grava `PILOTSEEDONLYNOTASECRET`
  (real gera base32 + blocklist `mfa.ts:34`; dev seed `db/seed.ts:79` usa `DEVSEEDONLYNOTASECRET` dev-only/inerte);
  `resolve-organization-id.ts` citado em 5+ lugares (README:84, rules, agent, hook) **NÃO existe**;
  `backend-tests.md` cita "5 falhas FK #36" (suíte passa 92/93, harness-contract(12)✓);
  `backend-harness-contract.md` diz `dead_letter` via `worker.on('failed')` do backend (**errado** — é via PATCH, e
  o worker do backend só loga) + persistência de `Idempotency-Key` em callbacks (**REFUTADO**) + enum status
  "running/done/error/dead_letter" (impreciso — é running/paused/cancelled/dead_letter); `backend-db.md` diz
  `on delete restrict` (código+canon = **cascade**, §11.2 l.1203). — 0,3-0,5h/ea.
- **`rule-backend-routes-staff-role-and-adr-miscite`** `[carry]` **(v: CONFIRMADO — RBAC)** — `.claude/rules/
  backend-routes.md` declara staff roles `bevox_admin | support | observer (canon: ADR-022 staff RBAC)`:
  triple-errado (nomes curtos; staff RBAC = **backend/ADR-013**; invoca o inexistente `requireRole`). — **0,25h**.
- **`stray-gap-workflow-js-scratch-accumulation`** `[carry]` — 5 `.claude/state/gap*.js` (0704-0717) gitignored
  (`git check-ignore` confirma) → **zero impacto em CI**; só fazem `pnpm lint` **local** dar RED. Esta sessão NÃO
  adicionou nenhum. — **0,1h** (`rm`).
- **`codeql-upload-never-noop` / `release-no-provenance-sbom` / `adr-number-collision-cross-namespace`** `[carry]` —
  `codeql.yml upload:never`; `release.yml` sem provenance/sbom/cosign; ADR 008-023 colidem backend/_shared. —
  0,2-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária)

- **`legacy-lexicon-clean`** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/`db/`: executável
  **ZERO**. Bare `workspace_id`/`workspaces` = 3 doc-comment do rename; residual `account_id` = composites
  sancionados (`external_/payment_/channel_account_id`) + doc-comments + alias financeiro `AS account_id` + snapshots
  drizzle/tipo gerado. Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153` `generateMfaSecret()` base32 + `assertMfaSecretNot
  Placeholder()`; `mfa.ts:34-42` blocklist inclui `pilotseedonlynotasecret`; `auth/service.ts:84-88` sem MFA check
  (correto — TOTP é Marco-3). Literal só em doc-comment `mfa.ts:66`. **NÃO implementar "rejeitar sentinel no login".**
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:64,68`). Coexiste com o
  token-IDOR (autenticidade ≠ autorização).
- **`idempotency-on-callbacks-REFUTED`** — backend **não** persiste `Idempotency-Key`; é máquina-de-estado
  (`lockForCompletion`→409). Harness **manda** `completeKey` mas o backend ignora.
- **`dispatch-amendment-faithful-to-canon`** — `deadline_ms`/`original_execution_id`/`dead_letter`
  (`harness-dispatch.schema.ts:58,62`) byte-faithful ao canon. Não é fork.
- **`hmac-verification-correct`** — `metaapi/service.ts:48-55` casa o signer do meta-api (`${t}.${rawBody}`, SHA256
  hex, `t=,v1=`, ±300s, `timingSafeEqual`).
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc`=0); decimal `numeric(10,2)`; webhooks
  dedupe-aware (`repository.ts:250-262`); over-refund replay-safe (REST + manual); cross-tenant paid-flip impossível
  (`webhook-platform.ts:68` org-scoped + `markChargePaid` guardado); ambos webhook-secrets `requiredInProd`.
- **`booking-main-path-exactly-once-sound`** — advisory xact-lock + recount in-lock + unique index
  `appointments_org_idempotency_uniq` + replay 23505 (`booking.ts:222-263`); POST honra `Idempotency-Key`
  (`routes.ts:88`).
- **`money-mutation-http-idempotency-not-needed`** `[CHANGED — de-escalado]` **(v: Security Engineer)** — a ausência
  de `requireIdempotency` em mark-paid/expire/connect-manual é neutralizada pela idempotência interna
  (`provider_payment_id=manual:<chargeId>` + transições guardadas + ON CONFLICT; documentado `routes.ts:55-58`).
  Não é risco de double-charge ativo. (07-22 listou como fator contribuinte 0,5h.)
- **`authz-miss-hunt-clean`** — toda rota mutante é protegida; os 5 webhooks verificam assinatura antes de agir
  (stripe/platform `constructEvent`, clerk `svix`, google HMAC timing-safe, metaapi HMAC); nenhum handler mutante
  desprotegido.
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer` (ADR-013 l.108); `requireStaff({roles})`→403; observer split correto; `TEST_AUTH_BYPASS` double-
  guarded (`env.ts:151-158,225-231`); secrets staff DB-direct (nunca Redis).
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` é **canon-correto** (§11.2 l.1203; `backend-db.
  md` "restrict" stale); timestamptz everywhere; CHECK (`end_at>start_at`, `sessions_remaining>=0`,
  `confidence∈[0,1]`); `ai_suggestions` dropada em 0005 (sem drift); sessions numeric→integer em 0015 (sem drift).
- **`secrets-and-pii-redaction`** — Google OAuth tokens encrypted-at-rest (`sync.ts:100,137`); `redactors.ts:14-32,
  72` redige tokens/secrets mesmo em debug; Google audit nunca carrega PII/token; Sentry sem PII (sem `setUser`);
  `redaction-paths-miss` é **latente** (provado: os 51 sinks de log não referenciam as colunas de PII).
- **`todo-fixme-debt-sweep-marco23-only`** — sweep `src/`+`db/`: **0** FIXME/HACK/XXX; 1 `@deprecated`
  (`orchestration/repository.ts:348`); TODOs reais (MFA, export, autonomy) todos Marco-2/3.
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (`delivery-tracker.yml:781`, origin/main): 10
  delivered + `backend-psp-br-secondary` parked (Marco 6 / bevox-open-finance, ADR-023). **Nenhum work-item** p/
  calendar (ADR-010), customer-identity (ADR-009), templates (ADR-020), priority-score (ADR-021) → a grade CRÍTICA
  é **invisível ao tracker** (mede presença-de-código por grep); 1 item (multimedia) auto-declara "5 LGPD prod gates
  pending (not ready-for-prod)".

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do
piloto + 1 dos 2 jobs de CI vermelhos**.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Seedar Calendar default + grade `professional_schedules` (Seg-Sex) no `seed-pilot`** | **2-3h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) **+ `closeDb()/closeRedis()` no `afterAll`** | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado não autentica no calendar (gate upstream dos CRÍTICOs) |
| 4 | **`pnpm audit`: bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid** | **4-6h** | Destrava o job `Security` (**49 highs**, ~15 prod-runtime incl. core do Fastify) — completa "CI verde"; **piorou 18→49** |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e | **3-4h** | **Alcançável NO piloto via staff-approve**: faz a resposta chegar ao cliente (hoje dropada em silêncio como `done`) |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + subir `/metrics` no worker | **1-2h** | Fecha o buraco-negro triplo (Sentry/OTel/Prometheus) de TODA a metade assíncrona que o piloto roda |
| 7 | **Gatear `insertPayment`+side-effects no rows-affected de `markChargePaid`** | **2h** | Fecha o bug HIGH de dinheiro alcançável no money-path manual (re-mark órfão) |
| 8 | **`.min(32)` no `STAFF_JWT_SECRET`** (+ separar a chave do Google OAuth state) + montar `requireRateLimit` no `/staff/sessions[/refresh]` | **~3,5h** | Fecha o buraco de auth mais duro (admin forjável + reuso de chave em 2 planos) + brute-force do admin semeado |
| 9 | **Vincular token de callback ao `:id`** (`executionContext.execution_id === id` → 403) + **remover `updated_at=now()` do reconcile de refund** (`reconcile.ts:257`) | **1,25h** | Fecha o IDOR cross-execution + destrava o reconcile de refund (42703 DOA) — ambos ALTO-GA |
| 10 | **Aplicar gate `ai_opt_out`/consent em `cutoff.ts`/dispatch + Google sync** + hidratar DSR export (incl. `customer_channels`) | **6-10h** | LGPD (piloto roda com PII real; hoje o flag é ignorado + PII cru não-apagável) |
| — | Higiene batch: `GET /appointments`; versão/tag SemVer (22 commits); reconcile-cron `applyChargePaid/Refunded`; audit de appointment (§12.8); docs stale (§8/bridge/rule dead_letter/db-restrict/ADR-022); `rm .claude/state/gap*.js`; `operationId`+enums OpenAPI; índices FK (uma migration) | **~12h** | "Ver agenda" + governança + drift de contrato + perf GA + LGPD-audit |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **POST vs PATCH /status 404** (backend
  canon-correto; fix cross-repo harness→PATCH + errata canon l.447) → `dead_letter` inalcançável; `aborted_*`→400
  (bug harness), `strategy='failed'`→não-`error` (bug backend), skills-allowlist vazio, `trace content` descartado,
  `callback_base_url` ignorado, token-IDOR, `active_execution_id`-wedge. Mitigante: harness **inerte** no piloto
  staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` no fio
  (`messages/schemas.ts:7`) confirma que `wa`/`ig` do backend causa o drop de outbound; retries de webhook amplificam
  a perda de inbound (dedupe-strand + null-tenant-500 + unknown-provider-silent-drop).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de
  um principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona.
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`) vs ADR-014
  (um); refund manual não passa por webhook; o reconcile de refund Stripe está **DOA (42703)**. Escape do piloto:
  manual-mode (ADR-023 aceita). **MCP `stripe` requer auth interativa — indisponível nesta sessão headless**
  (reportado; não bloqueante para auditoria de código).
- **canon** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score) não-implementadas; _shared/ADR-019
  (bases legais → gate consent é código local), _shared/ADR-020 (retenção → scoping de message_records/received_
  events, retention worker, DSR deletion). Drifts "canon-atrás-do-código" (webhook §10.3 unificado,
  `strategy='workflow'`, `/status` POST↔PATCH l.447, `create-refund`, `dead_letter` no status enum) → errata/ADR
  superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1` (sem os 22
  commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem principal Clerk).
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs
  são invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-07-22)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD --
src/ db/` **vazio**; `HEAD` = o commit do próprio audit 07-22. **0 refutações de achados de código** — todos
re-confirmados com evidência fresca por 7 domínios independentes + verificação de fonte-primária do orquestrador.

**Mudança de ground-truth (mensurável — a única coisa que mudou):**
- **`ci-security` EXPLODIU**: **106 vulns / 49 high** hoje vs **36 / 18 high** no 07-22 (**+70 total, +31 high**) —
  deriva composicional sobre o lockfile congelado; **19 módulos high distintos** (vs 12); NOVOS highs prod-runtime
  atingem o **core do Fastify** (`fastify`/`@fastify/static`/`find-my-way`) + `nanoid`; dev `braces`/`postcss`/
  `source-map-js`. Tendência **12→15→18→49 high** nas 4 últimas passadas. **Prova: a dívida de segurança cresce sem
  tocar código, e acelerou.**
- **`ci-tests`**: RED idêntico (mesmo flaky `booking_notice` `:259` — rodei ~09:08 UTC — + teardown 57P01, agora 2
  ocorrências vs 6). `harness-contract.test.ts(12)` re-confirmado PASSANDO (issue #36 "5 FK" stale).

**Descoberta-chave desta passada — a disputa cross-repo do `dead_letter` FECHADA:** o harness agent traçou
byte-level nos 2 repos + canon: `dead_letter` é **inalcançável ponta-a-ponta** (harness POST→404 **e** worker do
backend só loga). Resolve a linha do 07-19/07-20 que oscilava entre "fechado" e "aberto".

**~12 misses NOVOS (de 8 passadas anteriores), todos verificados de fonte-primária:**
1. **STAFF_JWT_SECRET reusado p/ Google OAuth state** (RBAC N1) — uma chave HMAC sem piso guarda 2 planos.
2. **Impersonation audit hook vestigial** (RBAC N2) — plugin encapsulado → hook nunca dispara nas rotas staff-ops.
3. **Sem revogação de token de staff vivo** (RBAC N3) — deactivation lag ≤900s.
4. **Sem binding mecânico route↔Zod↔OpenAPI** (route-reviewer) — root-cause de todo drift de categoria b.
5. **`active_execution_id` nunca limpo — ampliado a approve/edit/reject** (harness N2) — wedge de conversa turno-2+.
6. **`customer_channels` omitido do DSR export** (LGPD) — loja de identidades de canal do titular.
7. **Modelo de consent/retenção inteiro ausente** (LGPD, grep global=0).
8. **inbound unknown-provider silent-drop** (channels MISSED-A) — gêmeo inbound do vocab-drop.
9. **`channel_phone` sempre null** (channels MISSED-B) — join provider canônico-vs-"wa".
10. **received_events + audit não-transacionados** (channels MISSED-C) — escrita parcial.
11. **FK-index gap mais amplo** (schema) + **ADR-020 reservou migration 0016 que é ADR-023** (doc-stale).
12. **Métrica `httpRequestsTotal` com `organization_id` em labels** (calendar) — cardinalidade ilimitada no GA.

**De-escalações / refutações-de-escopo (2 novas; carryovers mantidos):**
- **`money-mutation-no-http-idempotency` → de-escalado (low/by-design)**: idempotência interna
  (`manual:<chargeId>` + ON CONFLICT) neutraliza; documentado.
- **`metrics-endpoint-public` → partly REFUTED**: `/metrics` **está** documentado (`yaml:511`) + público é
  intencional (scrape).
- (Carryovers mantidos: `charge_type-drift` REFUTED; `clerk-webhook-org-fallback` inert/no-op; `staff-metadata-cache`
  LOW; `redaction-paths` latente.)

**Correções de contagem/cite:** rotas re-derivadas **103 call-sites → 106 runtime** (verb-loop `calendar/routes.ts:
131`); `created_by` cite corrigido (colunas **não existem**; `calendar.ts:140` é `source`); lista de métricas de
domínio está em PRD l.590 ("Módulo 16"), não §13.3; **14** tabelas com uuidv7-default em 0000 (não 13).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH);
`manual-remark orphan` (HIGH); `reconcile-refund-42703`; `callback-token-IDOR`; `rbac-org-role`; `clerk-provisioning`;
os mismatches de `/complete`; `reconcile-cron-*`; toda a bateria LGPD; autonomia/observabilidade; priority-score/
reminders/templates Marco-2/3; a staleness `.claude`/CLAUDE.md/README; version-drift (22 commits, nenhuma imagem
pós-`v1.0.1`).

**Arco desde a passada mais antiga (06-02):** os 3 CRÍTICOs originais (resposta-nunca-chega-ao-WhatsApp via
telefone-não-persistido; seed-pilot-inexecutável-em-prod; zero-testes-de-booking) foram **fechados/recaracterizados**
(Dockerfile `COPY src` fixo; `calendar-booking.test.ts` existe; o drop de outbound migrou para o `vocab-mismatch`
HIGH). Os 2 CRÍTICOs atuais (grade + calendar no seed) emergiram ~06-23 e **persistem** há ~4 meses de congelamento;
o gate auth-actor foi isolado no 07-20 e re-confirmado 4×. **A frente de CRÍTICOs rotacionou por completo; o conjunto
atual está estável e sem correção há ~4,5 meses; a única variável que piora sozinha é a dívida de segurança do
lockfile.**

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído
a **re-verificar de fonte-primária** o inventário do 07-22 do seu domínio contra o **código atual** com evidência
fresca `file:linha`, a **REFUTAR** superestimações, e a caçar misses. **5 usaram agent-types locais** deste repo
(`.claude/agents/`): `harness-callback-auditor` (contrato l), `backend-route-reviewer` (OpenAPI b),
`backend-staff-rbac-reviewer` (auth), `backend-schema-migration-engineer` (schema/índices/LGPD-shape),
`Security Engineer` (payments j + channels k); **2 general-purpose** (LGPD g; calendar/pilot/obs a+m + autonomia).
Cada agente entregou lista estruturada VERDICTS/NEW-OR-MISSED/CONFORMANCES com evidência fresca; **0 refutações de
achado de código** nos 7 domínios.

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD
-- src/ db/` = vazio); origin/main dos 4 repos (backend dbd231e / canon 7874971 / harness 2979eb0 / meta-api
5516c2a, inalterados); léxico legado (grep triado = zero executável); os 2 CRÍTICOs (grep writer de
`professional_schedules` = só fixture; `seed-pilot.ts` = 4 inserts; `availability.ts:75/126` lido); os 2 bugs NOVOS
do 07-22 (refunds sem `updated_at` → 42703, lendo `payments.ts:149-172` + `reconcile.ts:254-259` + migration 0019;
token não-vinculado ao `:id`, lendo `execution-token.ts` + `harness-callbacks.routes.ts` linha-a-linha); worker
telemetry (grep `instrument` em `queue/index.ts` = NONE); dead-dep `@fastify/rate-limit` (grep import = 0);
`requireRateLimit` callers (0); `newOpaqueId` callers (0 = dead-code); categoria f (0 FIXME/HACK, 1 @deprecated);
delivery-tracker slot backend (origin/main, 10+1); version-drift (`merge-base --is-ancestor dbd231e v1.0.1` = FALSE,
22 commits, describe `v1.0.1-31`); CI config (`ci.yml` + `security.yml`, ambos hard-fail); canon spot-checks
(ADR-023 `aceita`; ADR-014 um endpoint l.134; ADR-018 `aceita`; §16.1 CI-verde l.1483; ADR-010 `aceita`).

**Ground-truth de CI rodado de fato** (2026-10-21 ~09:06–09:12 UTC; logs em `.claude/state/ci-2026-10-21/`,
gitignored): Typecheck ✓ / Format ✓ / OpenAPI ✓ / Build ✓ (tsc+tsc-alias+dist-alias-gate) / Unit ✓ (**469/469, 69
files**) = **GREEN**; `test:integration` = **RED exit 1** (`1 failed | 92 passed (93)`, flaky `booking_notice` `:259`
[~09:08 UTC < 13:00] + teardown 57P01 ×2); `pnpm audit --audit-level high` = **RED exit 1, 49 high / 106 total** (19
módulos high distintos, parse de `audit.json`); `lint` = **RED por artefato local** (5 `.claude/state/gap*.js`
gitignored, `git check-ignore` confirmou os 5 → CI GREEN).

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree numa feature branch
(`fix/a14-…`) mas **`origin/main` @ `7874971` (06-03)** — leu-se `origin/main` para PRD/ADRs/delivery-tracker.
Numeração de ADR **colide** entre namespaces backend/_shared — sempre qualificada. (O skill `backend-module-status`
lê o tracker do working-tree; preferiu-se `origin/main` direto para estado settled.)

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV
Scanner / CodeQL não reproduzíveis offline (config lida: `codeql.yml upload:never`; `security.yml` roda OSV +
pnpm-audit). (3) Caminho live (Stripe/Clerk/harness/Meta reais) não exercitado — verdicts derivam de leitura de
código + schema + canon `origin/main` + ausência comprovada de writers/endpoints + CI rodado. (4) MCP `stripe` +
`claude.ai Google Drive` requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não
bloqueante). (5) Esta passada é re-verificação sobre código byte-idêntico ao do 07-22; o valor incremental é
**confirmação independente de fonte-primária (0 refutações) + CI fresco (Security-RED explodiu 18→49) + a disputa
`dead_letter` fechada + ~12 misses NOVOS + 2 de-escalações**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-21. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
