# Gap Analysis — bevox-backend — 2026-07-20

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo
> segundo a documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente
> real: login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA**.
> Método: **7 auditores de domínio em paralelo** (4 agent-types locais deste repo + Security Engineer +
> 2 general-purpose), cada um re-verificando os achados do 07-19 contra o código **atual** com evidência
> fresca `file:linha`, lendo canon + os dois vizinhos, e caçando gaps que as 6 passadas anteriores perderam +
> **verificação de fonte-primária independente pelo orquestrador** dos achados-manchete + **CI rodado de fato**
> (2026-07-20 ~09:05–09:08 UTC, não inferido). Sucede `runtime-gap-audit-2026-07-19.md`.

## Resumo executivo

**Fundação madura, a um passo curto do piloto — porém não pronta. Esta passada CONFIRMA integralmente o
inventário do 07-19 (0 refutações de achados de código) com evidência independente fresca, e adiciona ~17
achados NOVOS/afiados — o mais importante: o piloto está _triple-gated_, não duplo.** Fato estrutural que
domina a passada: **código de produto, canon e os dois vizinhos continuam TODOS congelados.** `git diff
dbd231e..HEAD -- src/ db/` é **vazio** (prova executada) — e `HEAD` (`6f6867d`) **é o próprio commit do audit
07-19**, docs-only. Canon `bevox-knowledge` `origin/main` @ `7874971` (06-03), `bevox-harness` @ `2979eb0`
(06-03), `bevox-meta-api` @ `5516c2a` (06-22) — inalterados. Logo esta é **re-verificação independente +
ground-truth de CI fresco + caça a misses**, não novos gaps de código. Mesmo assim os 7 auditores + o
orquestrador isolaram **~17 achados NOVOS/afiados** e **2 refutações/mudanças de conclusão anterior**, num
inventário agora de **~105 achados distintos** (2 CRÍTICO · ~13 ALTO · ~35 MÉDIO · ~40 BAIXO · ~13
INFO/conformidade).

**O piloto morre antes do passo 2 — e agora com um gate a MAIS que o 07-19 não viu.** A passada anterior traçou
"LOGIN — PASSA (staff)" e pulou para "VER AGENDA — `availability.ts:75`", assumindo que o principal staff
alcança o handler. **Ele não alcança** (achado NOVO `pilot-actor-cannot-authenticate-to-calendar`): o
`seed-pilot` provisiona **só** um `staff_account` (token **HS256**, `staff-auth.ts:71`), mas toda rota de
calendar exige `requireClerkAuth()` (**RS256** + claim `organization_id`, `clerk-auth.ts:90,105`) e **nenhuma
rota de calendar pareia `requireStaff`** — o token staff é categoricamente rejeitado (401). O money-path do
piloto é portanto **triple-gated**: (a) nenhum principal Clerk semeado que `requireClerkAuth` aceite → (b)
nenhum `Calendar` semeado (`availability.ts:75 notFound("Calendar")`) → (c) nenhuma grade `professional_schedules`
(`availability.ts:126 if(!sched) continue` → `slots:[]` → `booking.ts:207 slot_conflict` em 100%). Os dois
CRÍTICOs (b/c) **não têm workaround de produto**; o gate de auth (a) tem workaround de ops (configurar
usuário + JWT-template Clerk à mão). **Fix mínimo dos CRÍTICOs ≈ 2-3h** (seedar Calendar + grade Seg-Sex).

**"CI verde" — o único critério mensurável de Marco-1 (§16.1) — está RED em 2 jobs, idêntico ao 07-19**
(ground-truth rodado 2026-07-20 09:05–09:08 UTC): **Tests RED** (`ci.yml` job `Tests` roda `pnpm test` +
`pnpm test:integration` sem `continue-on-error`; `1 failed | 92 passed` — mesmo flaky
`calendar-booking.test.ts:259 booking_notice` dependente de hora-do-dia [rodei 09:05 UTC < ~13:00 UTC threshold
→ `booked` em vez de `slot_conflict`] + teardown 57P01 sem `closeDb/closeRedis`) e **Security RED** (`pnpm
audit --audit-level high`, `continue-on-error:false` → **27 vulns: 3 low / 12 moderate / 12 high**, exit 1;
composição drifta — advisory NOVO `vite server.fs.deny` hoje — mas total de highs **estável em 12**).
Typecheck / Format / Unit (469 testes) / Build / OpenAPI = **GREEN**. O `lint`-RED é **artefato local**: 5
arquivos `.claude/state/gap*.js` (sobras de auditorias 07-04..07-17), **todos gitignored** → checkout limpo de
CI não os vê → **CI lint GREEN**.

**Money-path manual do piloto FUNCIONA, com 1 bug HIGH agora _broadened_.** O achado
`manual-remark-after-refund-inserts-orphan-paid-payment` foi **alargado** por esta passada: o payment `paid`
órfão **não é específico de refund** — qualquer charge manual em status terminal (`expired`/`cancelled`/
`refunded`) que seja re-marcada paga insere um payment `paid` vivo, porque `applyChargePaid` chama
`insertPayment` **sem checar** se `markChargePaid` de fato transicionou (`service.ts:890-891`). Fix cobre os 3
casos de uma vez (gatear `insertPayment` no rows-affected de `markChargePaid`). ~2h.

**Refutação/correção de contrato (importante para o revisor):** o `harness-status POST↔PATCH 404` **CONFIRMA**
que o backend está **canon-CORRETO** (registra PATCH per amendment PRD l.1069-1157 + backend/ADR-019 Amд1); o
**harness e a linha PRD-l.447 (POST) é que estão stale** → o fix é **cross-repo** (harness→PATCH + errata de
canon), **não** um edit de backend. E a afirmação da rule `backend-harness-contract.md` de que "o backend
persiste `Idempotency-Key` em callbacks" está **REFUTADA**: é idempotência de máquina-de-estado
(`lockForCompletion`→409), não persistência de chave — um `/complete` retentado recebe **409, não 200
idempotente** (ADR-015 governa a chave dos **tools de mutação**, honrada na trilha de proposals, não nos
callbacks).

**Caminho de fechamento do piloto curto e inalterado:** os 2 blockers de agenda (≈ 2-3h) + o gate de CI
(flaky+teardown ≈ 0,5h; audit bump ≈ 2h) + o gate de auth-actor (ops, ou ~4-6h) somam **≈ 5-8h** para
destravar o runtime do piloto + o critério "CI verde". Severidades ancoradas no gate do **piloto**; para GA
vários ALTO/MÉDIO sobem (vocab de canal e POST/PATCH 404 viram CRÍTICO de GA).

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária; carregadas do 07-19 e re-confirmadas:

1. Os **4 callbacks** que o backend expõe são **`/status`, `/traces`, `/stream`, `/complete`** (em
   `src/integration/harness-callbacks.routes.ts`) — **não** `/complete,/artifact,/tool-result,/turn` como o
   brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (não "channels"); channels é **_shared/ADR-011**.
   backend/ADR-018 = refund/cancellation policy (correto no brief).
3. O grep `account_id\b` do brief captura compostos **sancionados** (Stripe/canal); o léxico proibido
   **executável** é **ZERO** (invariante §4.1 mantida — não-gap).
4. Código congelado desde **06-03** (`dbd231e`), não 06-04.
5. Numeração de ADR **colide** entre `backend/` e `_shared/` (012–023) — **sempre qualificada** abaixo.

## Calibração canônica (lida do canon frozen)

- **§16.1 Marco-1** ("Pronto para integração") = repo + **CI verde** + migrations pg16 + módulos
  **auth/organizations/users/professionals/services/customers** + **OpenAPI publicado** + contrato harness
  documentado+testado com stub + deploy staging. **Calendar e Payments NÃO estão aqui.** ⇒ o bloqueador de
  Marco-1 é **CI-verde (RED)**.
- **§16.2 Marco-2** = calendar, conversations, messages, channels, ai-pipeline, autonomia; fluxos 1/2/3 e2e;
  métricas Prometheus; cobertura ≥70%.
- **§16.3 Marco-3** = payments (Stripe Connect), reminders, faq, rules, audit, observabilidade; WhatsApp
  direto; circuit breaker; OTel completo; **LGPD DSR/retenção/consentimento**; **MFA TOTP**; SLO.
- **⇒ "Marco-1 concluído?" ≠ "piloto-pronto?".** O piloto exercita calendar (§16.2) + payments (§16.3) → o gap
  de grade é **Marco-2-por-rótulo mas pilot-blocking**.
- **§5.3 (Agenda, backend/ADR-010 aceita)** lista `WeeklySchedule` como **entidade canônica explícita** +
  "motor de disponibilidade: grade fixa" → o CRÍTICO da grade é gap contra entidade nomeada, não deferimento.
- **§5.6 / ADR-023 (delivered):** **Manual Payment Mode é o money-path do piloto**; Stripe Connect (ADR-014) é
  **repurposado p/ assinatura SaaS org→Bevox** (split de cliente deferido) → gaps de split/reconcile Stripe são
  deferimentos legítimos, não pilot-blocking.
- **§10.1** confirma o contrato REST (subconjunto crítico) — **não enumera `GET /appointments`**, e o SSE
  canônico usa auth por **`?token=` query** (o código exige header → drift real).

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-07-20) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO); `no-appointments-read-endpoint` (ALTO); ADR-020 message-templates + ADR-021 priority-score não-materializados; reminders/faq/rules (M3) |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | **106 rotas / 80 paths / 95 ops / 0 phantom / 11 undoc / 0 operationId** (recontagem independente idêntica) |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO**; só compostos Stripe/canal sancionados + doc-comments |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | seed gera base32 + bloqueia sentinel (`mfa.ts`); login não rejeita = **correto** (Marco-3); `CLAUDE.md §8` stale |
| e | Testes faltando (hot paths) | ✅ | availability(rota)/reschedule/webhook Stripe/inbound-vocab — zero e2e; `constructEvent` em test = 0 |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep: **0** FIXME/HACK/XXX; 1 `@deprecated`; TODOs todos Marco-2/3 |
| g | LGPD | ✅ | `ai_opt_out` armazenado-não-aplicado (vetor vivo); DSR **export existe**/deleção ausente; retenção ausente; **3 sinks/gaps NOVOS** |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked**; "delivered" ≠ pilot-ready; ADRs fundacionais sem work-item |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky+teardown) + Security RED (12 high); lint-RED = artefato local |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH broadened**; reconcile cru; PCI-nil; conformances confirmadas |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH** (meta-api exige enum pleno); 2 perdas de inbound; HMAC **correto** |
| l | Harness dispatch | ✅ | `POST/PATCH 404` (backend canon-CORRETO); idempotency-em-callbacks **REFUTADO**; 4 mismatches; skills vazio |
| m | Alçapões do piloto | ✅ (traçado) | **triple-gated** (auth-actor NOVO + calendar + grade); money-path manual OK com 1 bug HIGH |
| n | Delta vs audit anterior | ✅ | 07-19 re-verificado; **0 refutações de código**; ~17 NOVOS/afiados; 2 mudanças de conclusão |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia):**

1. **LOGIN — PASSA mas com classe de token errada.** `seed-pilot` cria org + `bevox_admin`; `POST
   /staff/sessions` cunha JWT staff **HS256** (`staff-auth.ts:71`). Sem rate-limit/lockout (`auth/routes.ts:90`).
2. **VER AGENDA — QUEBRA na camada de AUTH primeiro (NOVO).** `GET .../availability` exige `requireClerkAuth()`
   **RS256** (`clerk-auth.ts:90`) → token staff HS256 → **401**. Nenhuma rota calendar pareia `requireStaff`; o
   seed não provisiona principal Clerk. → **1º hard stop.** *Se um JWT Clerk for provisionado à mão:* →
   `availability.ts:75 notFound("Calendar")` (**CRÍTICO b**). *Se um Calendar for criado à mão:* →
   `availability.ts:126` grade vazia → `slots:[]` (**CRÍTICO c**). **NOVO co-fator persiste:** não existe `GET
   /appointments` → ver agendamentos **feitos** não tem rota REST.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100%. Reschedule/transition têm 4
   defeitos de correção (não-atômico, self-overlap, idempotência fina, transição sem guard).
4. **COBRAR — money-path manual FUNCIONA.** `charges/manual` + `mark-paid` → `applyChargePaid` concilia o
   ledger. **1 bug HIGH broadened:** qualquer charge terminal re-marcada paga insere payment `paid` órfão.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura;
   reconcile cru sem `applyChargePaid`; split em 2 endpoints vs ADR-014. Modo manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[CHANGED]`/`[REFUTED]` = status vs 07-19; **(v: …)** = verificação
independente do orquestrador (fonte-primária) ou do agente; `[xrepo]` = dependência cruzada. Severidade
ancorada no gate do **piloto**; escalonamento p/ GA anotado.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO — grep exaustivo `src/ scripts/ db/ test/`
  pelo orquestrador + agente)** — Nenhum caminho de produção escreve `professional_schedules` (a grade
  semanal-base). Único `INSERT` = fixture `test/integration/calendar-booking.test.ts:120`. Produção só lê
  (`availability.ts:116`); `:126 if(!sched) continue` esvazia todo dia → `slotMap` vazio → `booking.ts:207
  slot_conflict`. `calendar/routes.ts` grava só `professional_schedule_overrides` (`repository.ts:78→97`). Sem
  CRUD de WeeklySchedule, sem Zod body (`schemas.ts` só tem override/calendar/appointment/reschedule/cancel),
  sem repo writer. Escopo §5.3 (Módulo-5 Calendar, backend/ADR-010 aceita; `WeeklySchedule` = entidade
  canônica) — **Marco-2 in-scope, não deferimento**. — Impacto: 100% dos agendamentos = `slot_conflict`. —
  Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (só seedar grade). **#1.** `[xrepo: hub runbook go-live
  invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO)** — `seed-pilot.ts` insere só
  org(`:109-124`)/staff(`:156-168`)/professional(`:195-202`)/service(`:217-226`). Zero `calendars` (o
  `createCalendar` de `repository.ts:20` nunca é chamado) → `availability.ts:75 notFound("Calendar")` quebra
  "ver agenda". `system_holidays` omitido é **fail-open** (`availability.ts:108-111` vazio → `isSystemHoliday=
  false`, todo dia trabalhável), **não** co-bloqueador (só deixa feriado BR desbloqueado). — Esforço: **2-3h**
  (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / é pré-requisito do piloto com workaround de ops; ou dispara no instante em que harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor (NOVO, afia a trilha do piloto)**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[NOVO]` **(v: CONFIRMADO pelo agente + grep)** — O seed
  provisiona **só** um `staff_account` (role `bevox_admin`), cujo login cunha token **HS256** (`staff-auth.ts:
  71`, aud `bevox-backend-staff`). Toda rota de calendar é guardada por `requireClerkAuth()` (`calendar/routes.
  ts:22,24`), que verifica **RS256 apenas** e exige claim `organization_id` (`clerk-auth.ts:90,105-108`) →
  token staff é categoricamente rejeitado. `grep requireStaff src/modules/calendar/` = **NONE**. Logo o
  principal semeado **não alcança** `availability`/`appointments` (401 antes dos CRÍTICOs). `TEST_AUTH_BYPASS`
  é rejeitado em prod (`clerk-auth.ts:52-56`). Sit **upstream** dos 2 CRÍTICOs. — Impacto: go-live hands-off
  via `seed-pilot` não produz login utilizável; requer config manual de usuário+JWT-template no Clerk. —
  Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped, se piloto staff-driven for a intenção).
  `[xrepo: Clerk; sobrepõe clerk-user-provisioning-broken]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-07-20 ~09:05–09:08 UTC; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-teardown`** `[carry]` **(v: rodado)** — `pnpm test:integration` =
  **RED exit 1**, `1 failed | 92 passed (93)` · `1 file | 13 passed (14)`. Falha =
  `calendar-booking.test.ts:259` "booking_notice (slot too soon)" `expected 'booked' to be 'slot_conflict'` —
  o gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei às **09:05 UTC** → `booked` → assert falha. +
  teardown **57P01** (suíte não fecha `closeDb/closeRedis` no `afterAll`). `ci.yml` job `Tests` roda `test` +
  `test:integration` (testcontainers `pg_uuidv7`) sem `continue-on-error` → o flaky **falha o CI de fato**. —
  Esforço: **0,5h** (ancorar slot a `now()`-relativo + `await closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-12-high`** `[carry, estável]` **(v: rodado)** — `pnpm audit --audit-level
  high` = **RED exit 1, 27 vulns (3 low · 12 moderate · 12 high)**. Total de highs **estável em 12** vs 07-19;
  composição drifta (advisory NOVO **`vite server.fs.deny` bypass** via vitest 4; persistem OTel/grpc/
  protobufjs/undici/tmp). ~7 highs prod-runtime (`@opentelemetry/auto-instrumentations-node<0.75`,
  `sdk-node<0.217`, `@grpc/grpc-js`, `protobufjs`). `security.yml continue-on-error:false` → hard-fail. —
  Esforço: **2h** (bump OTel ≥0.217 sob nota ADR-012 + `pnpm override` undici/tmp/vite). **#3.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA/outbound/staff-approve ligar)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(v: CONFIRMADO — meta-api verificado)** —
  Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`metaapi/normalize.ts:35,44`) e **persiste `"wa"` em
  `channel_connections.provider`** (`routes.ts:246-252`). Outbound null-coage tudo que não seja pleno
  (`metaapi/repository.ts:197`) → `seams.ts:360` guard → `:376 skipped_missing_recipient` (audita
  `metaapi.send.skipped`, **não erro**; `seams.ts:122 isDeliveryFailure` exclui skips → mantém `done` =
  falso-sucesso). **Alcançável NO piloto via staff-approve** (`executions/service.ts:70`). `bevox-meta-api`
  (`origin/main`) exige enum pleno no fio (`messages/schemas.ts:7 z.enum(["whatsapp","instagram"])` +
  `pgEnum(_shared.ts:24)`) → `wa`/`ig` é invenção 100% backend. — Impacto: 100% das respostas a conversas
  reais descartadas em silêncio. — Esforço: **3-4h** (unificar vocab + CHECK + backfill + teste e2e). **#5.**
  `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-after-refund-inserts-orphan-paid-payment`** `[carry, CHANGED — broadened]` **(v: CONFIRMADO
  — alcançável no money-path do piloto)** — `applyChargePaid` chama `insertPayment` **incondicionalmente**
  (`service.ts:890-891`) após `markChargePaid` (guardado `WHERE status='pending'`, `repository.ts:395-399`);
  `insertPayment` dedupa por `ON CONFLICT (org, provider_payment_id, status)` (`repository.ts:432-439`) e
  `markChargePaidManually` não tem status-gate (`service.ts:428-433`). **NOVO alargamento:** o payment `paid`
  órfão **não requer refund** — qualquer charge manual terminal (`expired` via `expireChargeManually`,
  `cancelled`, ou `refunded`) re-marcada paga faz `markChargePaid` no-op mas `insertPayment` inserir um `paid`
  vivo → `SUM(payments 'paid')` double-conta. Fix único: gatear `insertPayment` no rows-affected de
  `markChargePaid`. — Esforço: **2h**. **#4.**
- **`harness-status-callbacks-post-vs-patch-404`** `[carry]` **(v: CONFIRMADO byte-level nos 2 repos —
  reframe)** — Harness POSTa **todo** callback (`bevox-callback.ts:28 method:"POST"`; `updateStatus→post(…/
  status)` `:141`; dead_letter idem `bullmq-consumer.ts:155`); backend registra **só** `app.patch(".../status")`
  (`harness-callbacks.routes.ts:56`) → Fastify **404** → mata todos os status callbacks incl. `dead_letter`
  autoritativo. **REFRAME importante:** o backend é **canon-CORRETO** — PATCH per amendment PRD l.1069-1157 +
  backend/ADR-019 Amд1; o **harness + PRD-l.447 (POST)** é que estão stale. Fix = **cross-repo** (harness→PATCH
  + errata canon l.447 via ADR-005), **não** edit de backend. Inerte no piloto (harness undispatched). —
  Esforço: **3h**. **#7.** `[xrepo: bevox-harness + canon]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — sweep de rotas)** — Não existe `GET
  /appointments` nem `GET /appointments/:id`; `calendar/routes.ts` expõe só availability, POST-create,
  PATCH-reschedule, 4 POST-transition (`:71,:99,:131`). §10.1 (subconjunto crítico) também não o enumera, mas
  a persona mobile ("agenda do dia") + Fluxo 3 (§8.3) exigem — agendamentos ficam write-only sobre REST. —
  Impacto: "ver agenda" dos agendamentos feitos só via Google sync. — Esforço: **3-5h**. `[xrepo: PRD §5.3/§8.3]`

**Auth / segurança (Marco-1; alguns mitigados no piloto 1 org/1 admin)**

- **`staff-jwt-secret-no-min-length`** `[carry]` **(v: CONFIRMADO)** — `env.ts:60 STAFF_JWT_SECRET:
  optionalString`, refino de prod é **presence-only** (`:184-213`) → secret de 1 char passa; `staff-auth.ts:
  48-75` assina HS256 com ele. Secret fraco = forjável offline → JWT staff forjado (`aud=bevox-backend-staff,
  role=bevox_admin`) = compromisso **total** do plano staff (cross-org + impersonation). — Esforço: **0,5h**
  (`.min(32)`). **O buraco de segurança mais duro do conjunto.**
- **`staff-login-no-ratelimit-no-lockout`** `[carry]` **(v: CONFIRMADO)** — `auth/routes.ts:90 POST /staff/
  sessions` + `:97` refresh sem `preHandler`; `requireRateLimit` aplicado a **zero** rotas; bcrypt cost 12 é o
  único freio → brute-force online destravado contra `staff@example.com` (semeado, adivinhável). — Esforço:
  **3h**.
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO)** — `requireRole` só existe como 3 TODOs
  (`clerk-auth.ts:25`, `auth/repository.ts:261`, `types/global.d.ts:35`); `req.user.role` resolvido mas
  consumido por **zero** handler. Só `requireStaff({roles})` gateia (plano staff). Rotas cliente mutantes
  **sem gate de papel**: money (`payments/routes.ts` charges/refund/mark-paid/expire/connect/policy),
  destrutivas (`DELETE professionals/:id`, `DELETE services/:id`), org config (PATCH org/settings/autonomy,
  onboarding/advance), approval (`executions/:id/{approve,edit,reject}`). PRD §5.1 (auth = Marco-1).
  Blast-radius baixo no piloto (1 org/1 admin). — Esforço: **8h**. `[xrepo: backend/ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO)** — `auth/repository.ts:221-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna
  clerk-**user**-id) → nunca casa quando org claim presente; webhook trata só `user.*` (`routes.ts:165,186`),
  sem `organization.created`. PRD §8.5. Mitigado no piloto (seed) mas alimenta o gate auth-actor acima. —
  Esforço: **5h** (+ADR mapping org). `[xrepo: Clerk]`

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real)**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` **(v: CONFIRMADO — vetor vivo)** — `ai_opt_out`
  gravado/lido só no CRUD (`customers/repository.ts:21,26,67`; **zero** outros readers — grep prova);
  `cutoff.ts:34-126` resolve modo + monta mensagens (`buildDispatchMessages` puxa `content_text` cru de
  `message_records`, `orchestration/repository.ts:391-410`) + `dispatchExecution` **sem** carregar o customer
  nem checar `ai_opt_out` (`:57-76`) → cliente que revoga consentimento ainda tem a conversa mandada ao LLM
  externo (transferência intl, _shared/ADR-019 item 7). `consent_granted_at` tem **zero writers** → não há nem
  mecanismo de captura. — Esforço: **4-6h**. **#10.**
- **`waitlist-priority-score-client-settable`** `[NOVO]` **(v: CONFIRMADO)** — backend/ADR-021 (aceita) foi
  aceita para **fechar** o vetor de queue-skip tornando `priority_score` **derivado pelo sistema** (`MAX(0,
  age_hours + urgency×100 − skips×10)`). Mas `waitlist/routes.ts:71` ainda **escreve `priority_score` do input
  do cliente** e `match.ts:74-75` só ordena pelo valor armazenado; as colunas `urgency_level`/`skip_count`/
  `last_score_update` + a fórmula + o cron **não existem** → o ataque de furar-fila que a ADR fecharia
  **continua aberto**. — Esforço: **6-8h** (colunas+fórmula+cron+deprecate input do cliente). `[a/g; ADR-021]`

### MÉDIO (degrada qualidade)

**Agenda — correção de dados quando exercitada (Marco-2; todos CONFIRMADOS)**

- **`reschedule-non-atomic-double-book`** `[carry]` — `booking.ts:373 createAppointment` commita o novo (+
  outbox Google `create`) na própria tx (`:223-248`); `:390-414` cancela o antigo em tx **separada** → crash
  entre as duas = 2 appointments ativos + push Google duplicado, sem compensação. — **2-3h**.
- **`reschedule-self-overlap-always-conflicts`** `[carry]` — a re-contagem conta o appointment antigo (ainda
  `scheduled`; `availability.ts:169` + `booking.ts:229 status NOT IN ('cancelled')`) → para `max_concurrent=1`
  qualquer remarcação sobrepondo o horário atual = `slot_conflict`. — **2h** (excluir self-id).
- **`appointment-transition-no-state-guard`** `[carry]` — `transitionAppointment` UPDATE any→any incondicional
  (`booking.ts:445-450`); `cancelled→completed/no_show` aceito → dispara decremento de pacote (`:485-489`) →
  consome sessão de appointment cancelado. Sem máquina de estados. — **2h**.
- **`reschedule-thin-idempotency`** `[carry]` — `booking.ts:387 idempotencyKey:undefined` → NULL (índice único
  trata NULL como distinto, `calendar.ts:163-172`); `idemHit/idemStore` no-op → até o guard Redis some. Create
  tem 2 guardas; reschedule tem 1 (só o `requireIdempotency` HTTP). — **1-2h**.

**Contrato backend↔harness (mismatches; persistem — todos INERTES no piloto, ALTO-GA)**

- **`complete-failed-strategy-not-mapped-to-error`** `[carry]` **(v: CONFIRMADO — bug de BACKEND)** — `strategy:
  "failed"` parseia; `inferSuggestionType→"reply"` (`complete-service.ts:22`); manual/copilot (modo do piloto)
  → `:112 waiting_approval` com `response_text` (sugestão-fantasma na fila de staff); autônomo → `done`. Nunca
  `error`. Canon (PRD l.1146 + backend/ADR-019 l.163) exige `error`. Único gap de código backend-vs-canon do
  contrato. — **3h**. `[xrepo]`
- **`complete-rejects-aborted-strategies-400`** `[carry]` **(v: CONFIRMADO — bug de HARNESS)** — harness emite
  `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2096-2099`); enum backend omite (`harness-callbacks.
  schema.ts:57-65`) → ZodError → 400. Canon fica com o backend (l.1089 sem `aborted_*`); harness vaza label de
  telemetria no strategy do fio (deveria mandar `failed`). — **2h** (harness). `[xrepo]`
- **`completing-state-has-no-timeout-backstop`** `[carry]` — `lockForCompletion` seta `status='completing'`
  (`harness-callbacks.repository.ts:128`); se `finalizeCompletion` lança (500), row orfa em `completing`;
  timeout-scan claima só `('dispatching','processing','waiting_input')` (`orchestration/repository.ts:428`) →
  nada reconcilia `completing`; retry do harness → 409. — **2h**. `[xrepo]`
- **`stale-token-blind-status-transition`** `[carry]` — `findExecutionIdByTokenHash` exclui só `('done','error',
  'cancelled','dead_letter')` (`repository.ts:34`); `applyStatusTransition` é UPDATE cego sem guard de origem
  (`:58-68`) → callback tardio `running`/`paused` regride `waiting_approval→processing`. Mascarado pelo 404
  acima; morde quando ele for corrigido. — **3h**. `[xrepo]`
- **`backend-never-sends-skills-allowlist`** `[carry]` — `cutoff.ts:75 skills:[]` hardcoded;
  `account_denied_tools` **nem existe** no `DispatchPayloadSchema` (`harness-dispatch.schema.ts:53`); harness
  trata `[]` como "todas as tools" (`permission-context.ts:63-67`) → PERM-05 (allowlist por org) é **no-op**.
  Inerte no piloto. — **4h**. `[xrepo: bevox-harness]`

**Pagamentos / reconciliação (resíduo do "webhook concilia"; Stripe-path, não exercitado pelo piloto manual)**

- **`reconcile-cron-flips-paid-without-orchestration`** `[carry]` — `reconcile.ts:143-150 UPDATE charges
  'paid'` cru sem `applyChargePaid` → paid sem row em `payments`, appointment nunca confirmado, sem grant, sem
  audit. Manual pula (`:119`). — **3h**. **#6.**
- **`reconcile-cron-skips-applyChargeRefunded`** `[carry]` — `reconcile.ts:253-259 UPDATE refunds` cru sem
  `applyChargeRefunded` → viola ADR-018 (full refund de package ⇒ `cancelled`); charge segue `paid`, package
  `active`. — **2h**.
- **`stripe-webhook-zero-route-signature-dedupe-tests`** `[carry]` — 0 `constructEvent` em `test/`; nenhum
  teste injeta `POST /webhooks/stripe[/platform]`; o teste homônimo mocka o repo e enshrine os gaps de
  reconcile cru. Ponto de entrada de dinheiro sem cobertura de assinatura/dedupe/roteamento. — **6h**. **#8.**
  `[xrepo: Stripe]`
- **`pix-reconcile-split-2-endpoints-vs-adr014`** `[carry]` — `/webhooks/stripe` trata só `account.updated`
  (`webhook.ts:65`); `payment_intent.*`/`refund.*` em `/webhooks/stripe/platform` (secret `_PLATFORM`);
  **ADR-014 §134/§168 documenta UM endpoint** → operador canon-fiel manda PI p/ `/stripe` que
  records-and-ignores. Ambos secrets `requiredInProd`. — **1h** (errata canon + startup-assert). `[xrepo]`
- **`requires-prepayment-hook-throws-manual-mode`** `[carry]` — `booking.ts:277,299` hardcoda Stripe
  `createCharge`; `getByOrg` sem filtro de provider (`repository.ts:71-85`) → p/ org manual retorna conta
  manual (`external_account_id=NULL`) → `service.ts:193 lança "payment account not active"`; caught best-effort
  (`booking.ts:315-339`, audita `charge.hook_failed`). Seed `requires_prepayment=false`. — **3h**. `[xrepo:
  ADR-023 vs ADR-014]`
- **`money-mutation-routes-no-http-idempotency-key`** `[NOVO]` — em `payments/routes.ts`, a composição `mutate`
  (`:58-59`, sem `requireIdempotency`) é aplicada a `mark-paid`(:295)/`expire`(:318)/`connect-manual`(:274)/
  `PATCH policy`(:95) — sem `Idempotency-Key` no fio. Contraste: `write`(:52) o inclui. É fator contribuinte
  direto do `manual-remark orphan` (o guard de serviço é a única defesa). — **0,5h**.

**Canais — perda de inbound (CONFIRMADOS)**

- **`inbound-dedupe-strand-onboarding-loss`** `[carry]` — `metaapi/routes.ts:174` SETNX dedupe **antes** do
  persist; `:190 throw notFound("tenant not mapped")` na janela de onboarding → key strandada; meta-api retenta
  (backoffs <24h TTL) → `:178 replayed` 200 → evento **perdido**. `DEL` (`:280-282`) só cobre o sub-bloco
  `message.received`. — **2-3h** (persist-antes-de-SETNX). `[xrepo: bevox-meta-api]`
- **`null-tenant-audit-notnull-500-inbound-loss`** `[carry]` — `tenant_id=null` aceito (`schemas.ts:38`); `:215`
  audit INSERT passa `organization_id=NULL` numa coluna NOT NULL (`audit.ts:24-26`) → 500 → key strandada →
  retry `replayed` → perdido. — **1-2h**. `[xrepo: bevox-meta-api]`
- **`status-events-subscribed-but-ignored`** `[carry, ALTO-GA]` — backend assina 5 tipos mas `routes.ts:234`
  trata só `message.received`; `message.status_updated` (sent/delivered/read/**FAILED** outbound) sem handler →
  falha de entrega assíncrona do Meta nunca reconciliada. — **4-8h**. `[xrepo]`

**LGPD / retenção / schema (Marco-3; piloto roda com PII real)**

- **`message-records-not-customer-org-scoped-blocks-dsr`** `[carry]` — `message_records` (`ingestion.ts:32-56`)
  só tem `conversation_key` — sem `organization_id`/`customer_id` — apesar de PII (`content_text`,
  `sender_snapshot_json` com `wa_id`/telefone, `media_json`); único FK `received_event_id ON DELETE set null`
  → não cascateia de `organizations`; PII un-joinável ao titular → DSR export/erasure impossível. Viola
  CLAUDE.md §5 + `backend-db.md`. — **6-8h**. `[xrepo: _shared/ADR-020]`
- **`denormalized-customer-contact-snapshot-defeats-erasure`** `[NOVO]` — `appointments` (`calendar.ts:128-130`)
  e `waitlist_entries` (`:194-196`) guardam `customer_name/phone/email` denormalizados com `onDelete:"set
  null"` no FK → um hard-delete de customer (DSR) nula o link mas **deixa o snapshot de PII órfão e
  un-joinável** → erasure derrotada mesmo depois de implementada. Escrito no path de booking do piloto. —
  **fold no trabalho ADR-020**. `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` — `queue/index.ts:86-152` 13 workers, nenhum purga/
  pseudonimiza PII; sem `consent_events`/`dsr_requests`/`legal_basis`; `deleted_at`/`consent_granted_at`/
  `archived_at` nunca escritos. — **12-16h**. `[xrepo: _shared/ADR-020]`
- **`no-dsr-deletion-endpoint`** `[carry, CHANGED]` — sem `app.delete` em `customers/routes.ts`; `deleted_at`
  filtrado (`repository.ts:31,41`) mas nunca escrito (soft-delete decorativo). **Nuance:** o DSR **export**
  EXISTE (`GET /api/v1/customers/:id/export`, `routes.ts:97`; um dos 11 handlers undoc) — só a **deleção** falta
  (canon §12.9 `DELETE .../customers/:cid` cascade). — **6-8h**. `[xrepo: _shared/ADR-020]`
- **`customer-pii-mutations-unaudited`** `[carry]` — `customers/service.ts` escreve **zero** `audit_events` (só
  TODOs `:85-86,108`); todos os outros 12 módulos auditam. Create/patch de PII + toggle `ai_opt_out` sem
  trilha (art.37 RoPA + rectification gap). — **3-4h**.
- **`execution-traces-pii-retained-omitted-from-dsr`** `[carry]` — `harness-callbacks.repository.ts:187-208`
  grava `input_json`/`output_json` crus do harness (texto/telefone/fatos); tem `org+execution_id` mas sem
  retenção e **omitido do DSR export** (`CustomerExport` `service.ts:77-110` não tem campo traces). — **4h**.
- **`redaction-paths-miss-actual-columns`** `[carry, CHANGED — afiado]` — `shared/redactors.ts:35-61` usa
  wildcards `*.phone`/`*.email` que **não** casam os nomes reais de coluna: `primary_phone`, `primary_email`,
  `notes_internal` (`customers.ts:42-44`), `fact_value` (art.11 saúde), `phone_number`/`handle`, `wa_id` (em
  `sender_snapshot_json`) → PII de contato vaza em cleartext em log INFO+. — **0,5h**.
- **`fk-columns-without-index-systemic`** `[NOVO]` — além de §11.3, um conjunto amplo de FKs sem índice
  (leftmost) — **core tables pilot-exercised com org_id FK sem índice**: `customers`, `professionals` (org+user),
  `services`, `calendars`, `users`, `executions` (org+conversation+buffer_window) → `WHERE organization_id=X`
  seq-scan em tabela multi-tenant + org-cascade-delete seq-scan. Viola `backend-db.md` "toda FK tem index".
  Não pilot-blocking (1 org, poucas rows). — **2-3h** (uma migration CREATE INDEX; funde com §11.3). `[a/schema]`
- **`section-11-3-critical-indexes-partially-absent`** `[carry]` — PRD §11.3: ausentes `(org,status)` em
  appointments/charges/executions, `(org,start_at)` + `(org,customer_id)` em appointments, `(org,customer_id)`
  em charges/conversations. Hot-path Marco-1 (availability) mitigado por `(professional_id,start_at)`; risco =
  scans org-wide de listagem/status na escala GA. — **2h**.
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized`** `[carry]` — backend/ADR-020
  (message-template entity, aceita) e backend/ADR-021 (priority-score, aceita) **não materializadas**: `grep
  message_template db/` = NONE; colunas `urgency_level`/`skip_count`/`last_score_update` ausentes de
  `waitlist_entries`. (ADR-022 policy-json **está** materializada — não-gap.) — ADR-020 **4-6h**; ADR-021
  **6-8h** (ver `waitlist-priority-score-client-settable` acima). `[a; Marco-2/3]`

**Autonomia / observabilidade (harness inerte no piloto, exceto observabilidade que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry]` **(v: CONFIRMADO)** — `src/queue/index.ts` (entry
  `node dist/queue/index.js`) **nunca** `import "./instrument.js"` nem `initTelemetry()` (ambos só em
  `src/index.ts:17,30`) → no worker o Sentry `captureException` (`queue/index.ts:272,313`) é drop silencioso e
  o OTel NodeSDK nunca inicia (zero traces pg/redis) p/ **toda a metade assíncrona** (ingestion, cutoff→
  dispatch, timeout-scan, 2 crons de reconcile de pagamento, google sync, waitlist, package-expiry). O piloto
  roda esses workers. — **1h** (import + `await initTelemetry()`). **Alto valor / baixo esforço.**
- **`domain-prometheus-metrics-not-registered`** `[carry]` — `shared/metrics.ts` (17 métricas) não registra os
  4 de §12.10 (`charges_succeeded_total`, `appointments_no_show_rate`, `executions_pending_approval_count`,
  `executions_timeout_total`); grep=0. `charges_succeeded_total`/no-show relevantes ao piloto. — **4h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` — `realtime/publish.ts:8-12` união fechada a
  `execution.*`/`waitlist.offered`; `appointment.created`(§8.3)/`charge.updated`(§8.4/§10.1) **nunca** emitidos
  → tela do profissional não auto-atualiza no agendar/pagar. — **3h**.
- **`rate-limit-§12.6-zero-routes-applied`** `[carry, CHANGED — attribution]` — é um plugin **Lua custom**
  (`src/plugins/rate-limit.ts`), **não** `@fastify/rate-limit` (que está no `package.json` mas importado em
  lugar nenhum — **dep morta**). Registrado (`server.ts:134`) mas `requireRateLimit` aplicado a **zero** rotas;
  webhooks públicos (stripe/metaapi/google/clerk) + login staff destravados; DEFAULT 600/60 ≠ canon 500/org. —
  **2-6h**.
- **`autonomy-patch-nontransactional-mode-audit`** `[carry]` — a desculpa do código ("no tx helper exists",
  `autonomy/repository.ts:65-67`) é **FALSA**: `.transaction(` usado em 7 sites; UPDATE (`:87-107`) + audit
  INSERT (`:111-123`) só guardados por `if(modeChanging)`, não tx → mudança de modo sem AuditEvent se o INSERT
  falha + lost-update. — **1-2h**.
- **`autonomy-action-granularity-not-enforced`** / **`autonomy-readiness-score-never-computed`** `[carry]` —
  `resolver.ts:30-63` gateia só `current_mode`; `PolicyEvaluator`/`fetchOrgAutonomyPolicies` (`seams.ts:64,115`)
  com **zero** callers; `readiness_score` lido/retornado (`repository.ts:20,26`) nunca computado → `GET
  /autonomy` sempre null; auto-promoção §8.5 nunca dispara. Inerte no piloto. — **1h** (parar de expor) a
  **16-24h** (M2/M3).
- **`onboarding-advance-no-prereq-arbitrary-stage`** `[carry]` — `repository.ts:151-165 SET onboarding_stage`
  cru; `schemas.ts:35-51` aceita qualquer dos 11; PRD §5.8 exige "≥1 professional ativo antes de services" +
  checklist (ausente). **CHANGED persiste:** `onboarding_stage` **não** flipa `ai_mode` → é gap de
  state-integrity/UX, não bypass de autonomia. Onboarding = Marco-1. — **3-5h**.

### BAIXO (higiene)

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; 106 rotas / 80 paths / 95 ops / 0 phantom)**

- **`openapi-drift-undocumented-handlers`** `[carry]` — **11 handlers fora do YAML**: `GET/PATCH /autonomy`,
  `GET /channel-connections`, `GET /customers/{id}/export` (DSR), `GET/PATCH /payment-account/policy`, `GET
  /api/v1/realtime` (SSE), + 4 webhooks (`POST /webhooks/stripe`, `/stripe/platform`, `POST /webhooks/google`,
  `GET /webhooks/google/callback`). — **2-3h**. **#9.**
- **`openapi-missing-operationid`** `[carry]` — `grep -c operationId`=**0** em 95 ops → `operations =
  Record<string, never>` (codegen degradado). — **1-2h**.
- **`openapi-status-callback-missing-dead-letter`** `[carry]` — YAML enum `[running,paused,cancelled]`
  (`yaml:298`) sem `dead_letter` (código+canon+harness têm). — **0,25h**. **#9.**
- **`openapi-enum-drift-proposal-create-refund`** `[carry]` — `ExecutionProposal.action` inclui `waitlist-add`
  (não-canon) e omite `create-refund` (ação de dinheiro viva, `seams.ts:172`). — **0,25h**.
- **`charge-route-path-and-charge-type-drift`** `[carry, CHANGED — YAML auto-inconsistente]` — `charge_type`
  request `[full,package]` (`yaml:2600,2927`) vs response `[deposit,full,package,adjustment]` (`yaml:2668`, DB
  CHECK `payments.ts:105`); `payment_method` request `[pix]` (`yaml:2602`) vs DB CHECK **8 valores**
  (`payments.ts:113`); path org vs §5.6 appointments. — **1h**.
- **`error-envelope-dual-schema`** `[carry]` — `Error` (sem `request_id`) nos 4xx compartilhados;
  `ErrorEnvelope` (com `request_id`) só em 7 respostas de payments; runtime sempre emite `request_id`. —
  **0,5-1h**.
- **`sse-realtime-header-auth-and-query-contract`** `[carry, MÉDIO-funcional]` — `realtime/routes.ts:26 GET
  /api/v1/realtime` guardado por `requireClerkAuth` (header-only) → `EventSource` de browser não seta header →
  inconsumível; e não parseia `?scope`/`?conversation_id` vs canon §10.1 (que usa `?token=`). — **2-4h**.
- **`rate-limit-429-undocumented`** `[carry]` — 429 emitido em runtime, 0 no YAML. — **0,25h**.
- **`metrics-endpoint-public`** `[NOVO]` — `GET /metrics` (`health/routes.ts:24`) sem `preHandler` → exposição
  Prometheus (cardinalidade org/subscription) publicamente alcançável se a porta vazar ao edge. Padrão p/
  scrape in-cluster; info-leak leve se edge-exposto. — **0,25h**.
- **`payment-account-policy-triple-hygiene`** `[NOVO]` — `PATCH /payment-account/policy` (`payments/routes.ts:
  95`) é simultaneamente (a) undoc no YAML, (b) role-ungated, (c) sem `Idempotency-Key` — mutando política de
  pagamento. Interseção de 3 achados. — **0,5h**.

**Contrato harness (resíduos BAIXO)**

- **`complete-org-read-from-untrusted-body-no-tenant-check`** `[NOVO]` — `/complete` lê tenant do **body**
  (`harness-callbacks.routes.ts:150-154`, via `.passthrough()`) sem checar `=== existing.organization_id`
  (traces/stream usam a row). Inalcançável na prática (harness omite org do `/complete`) mas contradiz o
  defense-in-depth de tenancy. — **0,5h**.
- **`status-meta-stripped-silently`** `[NOVO]` — `StatusCallbackSchema` (`schema.ts:15-17`) sem `.passthrough()`
  → strip silencioso de `failedReason`/`attemptsMade` que o harness manda no dead_letter (`bevox-callback.ts:
  143-147`). Benigno (backend audita `retry_exhausted`), mas perde forense quando o 404 for corrigido. —
  **0,25h**.
- **`workflow-strategy-code-ahead-of-canon`** `[NOVO]` — enum backend + harness têm `workflow`
  (`schema.ts:61`; `execution-handler.ts:1042`); PRD §10.4 l.1089 **não lista** → errata aditiva no canon
  (ADR-005). Sem impacto runtime. — **0,25h**.
- **`sentiment-enum-not-shared`** `[NOVO]` — backend exige `sentiment ∈ {6 valores}` (`schema.ts:51`); harness
  tipa `string` (default `"neutral"`) → sentiment livre → 400. Latente (path default seguro). — **0,25h**.

**Auth / schema / channels (resíduos)**

- **`impersonation-id-is-not-organization-id`** `[carry]` — `organization-scope.ts:57` retorna
  `req.staff.impersonation_id` como tenant org id, mas `auth/service.ts:135-138` seta a claim ao **PK da row
  `staff_impersonations`** (`repository.ts:153-160`). Latente/fail-closed (nenhuma rota pareia
  `requireStaff`+`requireOrganizationScope`) mas contradiz a invariante de tenancy. — **2-3h**.
- **`impersonation-audit-hook-encapsulation-scoped-to-auth-plugin`** `[NOVO]` — o hook `onResponse`
  (`auth/routes.ts:70-87`, doc "cobre QUALQUER ação de staff sob impersonation") é adicionado **dentro** do
  plugin `authRoutes` (exportado un-wrapped, `:196`; contexto de encapsulação próprio, `server.ts:198`); rotas
  staff-ops vivem em contextos separados (`server.ts:213-215`) → o hook **nunca roda** p/ elas. staff-ops
  auto-audita mas grava só `actorStaffId`, **não** `impersonation_id` (`actions.service.ts:43-59`). Enfraquece
  ADR-013 "auditoria forte" (mitigado: token HS256 impersonation só usável em `requireStaff`). — **1-2h**.
- **`clerk-jwt-no-aud-iss-validation`** `[carry]` — `clerk-auth.ts:89-92` verifica só `{algorithms:["RS256"],
  clockTolerance}`, sem `audience`/`issuer` → qualquer token daquela instância Clerk (qualquer template) é
  aceito, e o `organization_id` confiável vem numa claim não-verificada. Alg-confusion bloqueado, JWKS pinado
  (mitigantes). — **1h**.
- **`staff-login-user-enumeration-timing-oracle`** `[NOVO]` — `auth/service.ts:68-83`: email desconhecido lança
  **antes** de qualquer bcrypt; conhecido roda bcrypt cost 12 → delta de tempo vaza existência de email staff;
  com 2a (sem rate-limit) = enumeração trivial. — **0,5h** (dummy bcrypt na branch de miss).
- **`staff-session-no-logout-no-reuse-detection-no-cap`** `[NOVO]` — sem endpoint de logout/revoke (grep
  `logout|revoke|password.reset|app.delete` em `auth/` = NONE); `loginStaff` insere refresh novo a cada login
  sem revogar anteriores → tokens de refresh concorrentes ilimitados; rotação sem alarme de reuso; expirados
  nunca podados. — **2-3h**.
- **`consent-and-preference-columns-entirely-dead`** `[NOVO]` — `consent_granted_at`/`preferences_json`/
  `risk_flags_json` (`customers.ts:45,48,49`) com **zero writers** → nenhum consentimento é registrado; reforça
  o `consent-not-applied`. — **fold no ADR-019/consent**.
- **`dsr-export-omits-subjects-own-personal-data`** `[NOVO]` — `CustomerExport` (`service.ts:77-110`) retorna
  só o `CustomerRow` de 9 colunas; omite `preferences_json`/`risk_flags_json`/`consent_granted_at` do próprio
  titular (+ `messages`/`audit_events` vazios). — **1h**.
- **`uuidv7-sql-default-missing-post-0000-tables`** `[carry, CHANGED — 30 tabelas]` — só as 14 tabelas de
  `0000:307-320` ganham `SET DEFAULT gen_uuid_v7()`; **30 tabelas** de 0001+ (não ~23) não têm default
  server-side (grep `gen_uuid_v7` em 0001+ = 0), contradizendo `_shared.ts:23-25`. Latente (app supre via
  `$defaultFn`); INSERT cru omitindo id falha NOT-NULL (fail-closed). — **2h**.
- **`appointments-customer-package-id-no-db-fk`** / **`customers-deleted-at-read-but-never-written`** `[carry]`
  — `calendar.ts:124 customerPackageId` sem `.references()` (mitigado por validação fail-closed `booking.ts:
  146-150`); `deleted_at` filtrado mas nunca escrito. — 1-3h.
- **`newopaqueid-uuidv4-landmine`** `[carry]` — `staff-auth.ts:139-141 newOpaqueId(){return randomUUID()}`
  (UUIDv4, §4.7); **dead code** (zero callers). — **0,25h**.
- **`charge-currency-unvalidated`** / **`idempotency-key-param-mismatch-silent`** / **`provider-charge-id-no-
  unique-constraint`** `[carry]` — `charge-intent.ts:108` currency `z.string()` aceita "USD" mas PI é brl;
  `repository.ts:347` reusa key ignorando body; `provider_charge_id` sem unique. Latentes (piloto BRL). —
  0,5-2h.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04; docs stale re-confirmadas)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: CONFIRMADO)** — `merge-base
  --is-ancestor dbd231e v1.0.1` = FALSE; `v1.0.1`=`9a88116` (06-01); **PRs #18–#39** (incl. fixes de segurança)
  fora; `release.yml:5` dispara só em tags `v*.*.*` (mesmo trigger do `type=sha`) → **nenhuma imagem (SemVer OU
  sha) para pós-`v1.0.1`**. `v1.0.1..HEAD`=27 commits. — **0,5-1h** (cortar tag). **#7-alt.** `[xrepo: hub
  manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` — re-confirmadas: `CLAUDE.md §8` diz seed grava `PILOTSEEDONLYNOTASECRET`
  (real gera base32 + bloqueia — `mfa.ts`); `CLAUDE.md:170` "migrator não copia src/" está **FIXO**
  (`Dockerfile:69 COPY src`); `resolve-organization-id.ts` citado em 5 lugares (`backend-tenancy.md`,
  `backend-routes.md`, `README.md:84`, agent architect, `hooks/PostToolUse-tenancy.sh:11`) **não existe**;
  `backend-tests.md` cita "5 falhas FK #36" (suíte passa 92/93); `backend-harness-contract.md` diz `dead_letter`
  via `worker.on('failed')` (**errado** — é via `PATCH /status`) + localiza callbacks em `modules/executions/`
  (vivem em `src/integration/`) + afirma persistência de `Idempotency-Key` em callbacks (**REFUTADO** — é
  state-machine); `backend-db.md` diz `on delete restrict` (código+canon = **cascade**). — 0,3-0,5h/ea.
- **`codeql-upload-never-noop`** / **`release-no-provenance-sbom`** `[carry]` — `codeql.yml:26 upload:never` →
  SARIF nunca chega à aba Security; `release.yml` sem `provenance:`/`sbom:`/cosign. — 0,2-1h.
- **`adr-number-collision-cross-namespace`** `[carry, INFO]` — `backend/` e `_shared/` colidem em 012-023;
  config cita sem qualificar. — **1h**.
- **`stray-gap-workflow-js-scratch-accumulation`** `[carry]` — 5 `.claude/state/gap*.js` (0704/0709/0714/0715/
  0717) gitignored (`.gitignore:57`) → **zero impacto em CI**; só fazem o `pnpm lint` **local** dar RED. Esta
  sessão NÃO adicionou nenhum (usou Agent tool, não Workflow; só `.log` em `.claude/state/ci-2026-07-20/`). —
  **0,1h** (`rm`).

### INFO / conformidades verificadas / não-gaps

- **`legacy-lexicon-clean`** **(v: CONFIRMADO)** — grep `workspace_id|workspaces|account_id\b` em `src/`/`db/`:
  executável **ZERO** (invariante §4.1). Só compostos sancionados (`external_account_id`/`payment_account_id`/
  `channel_account_id`), o alias `AS account_id` (`payments/repository.ts:1012`, PK de `payment_accounts`
  remapeado p/ `accountId`) e doc-comments. `resolve-organization-id.ts` **deletado**.
- **`mfa-sentinel-correctly-inert`** **(v: CONFIRMADO)** — `seed-pilot.ts:153-154` `generateMfaSecret()` +
  `assertMfaSecretNotPlaceholder()`; `mfa.ts:34-42` blocklist inclui `pilotseedonlynotasecret`; `auth/service.
  ts:84-89` sem MFA check (correto — TOTP é Marco-3). **NÃO implementar "rejeitar sentinel no login".**
- **`four-callbacks-token-gated`** **(v: CONFIRMADO)** — `/status`(PATCH, inline preHandler), `/traces`/
  `/stream`/`/complete`(POST, `requireExecutionToken`), todos → 401 em token inválido. *(Mas o método de
  `/status` diverge do harness — POST/PATCH 404.)*
- **`idempotency-on-callbacks-REFUTED`** **(v: CONFIRMADO — refuta rule)** — o backend **não** persiste
  `Idempotency-Key` em status/complete (grep limpo; sem `requireIdempotency` nessas rotas); é idempotência de
  máquina-de-estado (`lockForCompletion`→409). ADR-015 governa a chave dos **tools de mutação** (trilha de
  proposals, `seams.ts`), honrada lá. Um `/complete` retentado recebe **409, não 200 idempotente**.
- **`dispatch-amendment-faithful-to-canon`** **(v: CONFIRMADO)** — `deadline_ms`/`original_execution_id`/
  `dead_letter` (`harness-dispatch.schema.ts:58,62`) byte-faithful ao canon (PRD l.1069-1157 + backend/ADR-019
  Amд1). **Não é fork.** Caveat: harness ignora `callback_base_url` (usa env) → campo decorativo.
- **`hmac-verification-correct`** **(v: CONFIRMADO)** — `channels/metaapi/service.ts:21-60` casa o signer do
  meta-api (`${t}.${rawBody}`, SHA256 hex, `t=,v1=`, ±300s, `timingSafeEqual`). Sem gap.
- **`payments-conformidades`** **(v: CONFIRMADO)** — PCI-nil (grep `pan|cvc|cvv|card_number`=0); decimal-safe
  `numeric(10,2)`; webhooks dedupe-aware (`recordWebhookEvent`); over-refund replay-safe (guard in-lock +
  `ON CONFLICT`); cross-tenant paid-flip impossível (org só de row DB, `webhook-platform.ts:67-72`); refund
  deferrals aceitos (ADR-018); ambos webhook-secrets `requiredInProd`.
- **`staff-rbac-3-roles-conformant`** **(v: CONFIRMADO)** — `staff-auth.ts:33 STAFF_ROLES` = exatamente
  `bevox_admin|bevox_support|bevox_observer`; `requireStaff({roles})` 403; JWT staff HS256 aud
  `bevox-backend-staff` distinto do Clerk RS256; observer excluído de impersonation.
- **`schema-conformances`** **(v: CONFIRMADO)** — `ON DELETE cascade` p/ `organization_id` é **canon-correto**
  (§11.2 l.1147; a rule `backend-db.md` "restrict" é que está stale); timestamptz everywhere; CHECK constraints
  presentes (`end_at>start_at`, `sessions_remaining>=0`, `confidence∈[0,1]`); uniqueness §16 presente;
  backend/ADR-022 (policy-json) materializada.
- **`accepted-adrs-materialized-except-2`** — ADRs backend 008-023 aceitas todas materializadas **exceto**
  ADR-020 (message_templates) e ADR-021 (priority_score). backend/ADR-016 é `proposed` (token-metering —
  corretamente NÃO implementada).
- **`todo-fixme-debt-sweep-marco23-only`** **(v: CONFIRMADO)** — sweep `src/`+`db/`: **0** FIXME/HACK/XXX; 1
  `@deprecated` (`orchestration/repository.ts:348`); TODOs todos Marco-2/3. Zero dívida pilot-blocking.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros somam ≈ 5-6h** e
destravam o runtime do piloto + os 2 jobs de CI vermelhos.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Seedar Calendar default + grade `professional_schedules` (Seg-Sex) no `seed-pilot`** | **2-3h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) **+ `closeDb()/closeRedis()` no `afterAll`** | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | `pnpm audit`: bump OTel (≥0.217) sob nota ADR-012 + `pnpm override` undici/tmp/vite | **2h** | Destrava o job `Security` (12 highs, ~7 prod-runtime) — completa "CI verde" |
| 4 | **Provisionar principal Clerk do piloto** (usuário + JWT-template com `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado não autentica no calendar (gate NOVO, upstream dos CRÍTICOs) |
| 5 | **Inicializar telemetria no processo worker** (import instrument + `initTelemetry()` em `queue/index.ts`) | **1h** | Fecha o buraco-negro de Sentry/traces de TODA a metade assíncrona que o piloto roda |
| 6 | **Gatear `insertPayment` no rows-affected de `markChargePaid`** (fecha o orphan-paid manual, todos os 3 casos) | **2h** | Fecha o único bug HIGH de dinheiro alcançável no money-path manual do piloto |
| 7 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e | **3-4h** | **CRÍTICO quando a IA/staff-approve ligar**: faz a resposta chegar ao cliente |
| 8 | **`.min(32)` no `STAFF_JWT_SECRET`** + montar `requireRateLimit` no `/staff/sessions[/refresh]` | **~3,5h** | Fecha o buraco de auth mais duro (admin forjável) + brute-force do admin semeado |
| 9 | **Reconciliar versão** (cortar tag SemVer capturando #18-#39) + **`reconcile-cron` chamar `applyChargePaid/Refunded`** | **3-4h** | Hoje nenhuma imagem contém os fixes pós-`v1.0.1`; fecha a rede de webhook-perdido |
| 10 | **Aplicar gate `ai_opt_out` em `cutoff.ts`** antes do dispatch + hidratar DSR export | **3-5h** | LGPD (piloto roda com PII real; hoje o flag é ignorado) |
| — | Higiene batch: `GET /appointments`; docs stale (§8/bridge/rule dead_letter/db-restrict); `newOpaqueId`→v7; `rm .claude/state/gap*.js`; `operationId`+enums OpenAPI via `pnpm openapi:types` | **~6h** | "Ver agenda" + governança + drift de contrato |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status` POST vs PATCH 404**: o harness POSTa
  `/status` a uma rota PATCH-only → 404; o **backend é canon-correto** (PATCH), o **harness+PRD-l.447 é que
  estão stale** → fix cross-repo (harness→PATCH) + errata canon. Também: `aborted_*`→400 (bug harness),
  `strategy='failed'`→não-`error` (bug backend), skills-allowlist vazio. Mitigante: harness **inerte** no piloto
  staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` no fio
  (`messages/schemas.ts:7` + `pgEnum`) confirma que `wa`/`ig` do backend é a causa do drop de outbound; retries
  de webhook (todos <24h) amplificam a perda de inbound (dedupe-strand + null-tenant-500).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa
  de um principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona; o webhook só
  fill `req.user` (fail-open), não a claim que o scope-guard lê.
- **Stripe** — Pix exige Connect KYC `active`; conciliação depende de **dois** endpoints (ambos `requiredInProd`)
  vs ADR-014 (um); refund manual não passa por webhook. Escape do piloto: manual-mode.
- **canon (ADRs aceitas não-implementadas / drifts)** — backend/ADR-020 (MessageTemplate), backend/ADR-021
  (priority-score); _shared/ADR-019 (bases legais → gate consent é código local), _shared/ADR-020 (retenção →
  message_records scoping, retention worker, DSR deletion, denorm-snapshot erasure). Drifts "canon-atrás-do-
  código" (webhook §10.3 unificado, `strategy='workflow'`, `payment_method` 8-valores, `aborted_*`, `/status`
  POST↔PATCH l.447, `/complete` 410-vs-409) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1` (sem
  #18-#39); runbook go-live invoca `seed-pilot` (que não cria grade nem principal Clerk — CRÍTICOs + gate auth).
- **delivery-tracker (categoria h)** — slot backend = **10 delivered + 1 parked** (aisuggestion, staff-rbac,
  m4-chatwoot-p1..p4, m5-p4-manual-payment, m5-p3c-multimedia-consume, m5-p3a/b; `backend-psp-br-secondary`
  **parked** → Marco 6/bevox-open-finance). **Nenhum work-item** para calendar (ADR-010), customer-identity
  (ADR-009), message-templates (ADR-020), priority-score (ADR-021) → o defeito da grade (sob ADR-010) é
  **invisível ao tracker**. `m5-p3c` auto-declara "5 gates LGPD pendentes / não-ready-for-prod". **Veredicto:
  "delivered" ≠ pilot-ready** (o tracker mede presença-de-código por grep). Usar esta auditoria como o gate.

## Delta vs auditoria anterior (2026-07-19)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD --
src/ db/` **vazio** e `HEAD` = o commit do próprio audit 07-19. **0 refutações de achados de código** — todos
re-confirmados com evidência fresca por 7 domínios independentes.

**Novo / afiado este ciclo (~17):**
- **`pilot-actor-cannot-authenticate-to-calendar` (ALTO, NOVO headline)** — as 6 passadas anteriores conflataram
  o actor staff (HS256) com o cliente-Clerk (RS256) na trilha do piloto; o principal semeado **não** alcança o
  calendar. Piloto é **triple-gated**, não duplo.
- **`manual-remark-orphan-payment` BROADENED** — não é específico de refund; qualquer charge terminal
  (expired/cancelled) re-marcada paga gera o payment órfão.
- **`waitlist-priority-score-client-settable` (NOVO)** — o vetor de queue-skip que backend/ADR-021 fecharia
  continua aberto (score do input do cliente).
- **`fk-columns-without-index-systemic` (NOVO)** — org_id FK sem índice em 6 core tables.
- **`money-mutation-routes-no-http-idempotency-key` (NOVO)** — fator contribuinte do orphan-paid.
- LGPD NOVOS: `denormalized-customer-contact-snapshot-defeats-erasure`, `consent-and-preference-columns-dead`,
  `dsr-export-omits-subjects-own-data`; auth NOVOS: `impersonation-audit-hook-encapsulation`,
  `staff-login-timing-oracle`, `staff-session-no-logout/reuse/cap`; harness NOVOS:
  `complete-org-read-from-untrusted-body`, `status-meta-stripped`, `workflow-strategy-ahead-of-canon`,
  `sentiment-enum-not-shared`; contrato NOVOS: `metrics-endpoint-public`, `payment-account-policy-triple-hygiene`.

**Mudança de conclusão (2):**
- **`idempotency-key-persisted-on-callbacks` → REFUTADO**: o backend **não** persiste a chave em callbacks (é
  máquina-de-estado; `/complete` retry = 409 não 200 idempotente). A rule `backend-harness-contract.md`
  overstates; ADR-015 é dos tools de mutação.
- **`sentry-otel-egress-not-pii-redacted` → CHANGED (de-escalado)**: `instrument.ts:25 sendDefaultPii:false` →
  Sentry não auto-anexa PII; risco residual **LOW/bounded**.
- **Reframe** (não muda severidade): o `harness POST/PATCH 404` é agora atribuído com precisão — **backend
  canon-correto**, harness+l.447 stale → fix cross-repo, não backend.

**Correções de contagem/atribuição:** `uuidv7-default` = **30** tabelas (07-19 dizia ~23); `rate-limit` é
plugin **Lua custom** (07-19 não distinguia; `@fastify/rate-limit` é dep morta); `no-dsr-endpoint` → DSR
**export existe**, só deleção falta.

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; `outbound-provider-vocab` (ALTO); `rbac-org-role`;
`clerk-provisioning`; os mismatches de `/complete`; `reconcile-cron-*`; toda a bateria LGPD; autonomia/
observabilidade inerte; priority-score/reminders/templates Marco-2/3; e a staleness `.claude`/CLAUDE.md.

**CI (ground-truth 07-20 vs 07-19):** essencialmente **inalterado** — Typecheck/Format/OpenAPI/Unit(469)/Build
= GREEN; `test:integration` = RED (mesmo flaky `booking_notice` por hora-do-dia [09:05 UTC < 13:00] + teardown
57P01, `1 failed | 92 passed`); `pnpm audit` **estável em 12 high / 27 total** (advisory NOVO `vite
server.fs.deny`, mas total constante). `lint`-RED local inalterado em **5** arquivos gap*.js (esta sessão não
acrescentou — usou Agent tool, não Workflow).

**Arco desde a passada mais antiga (06-02):** os 3 CRÍTICOs originais (resposta-nunca-chega, seed-pilot-
inexecutável-em-prod, zero-testes-de-booking) foram largamente **fechados/recaracterizados** (Dockerfile
`COPY src` fixo; existe `calendar-booking.test.ts`; o drop de outbound virou o `vocab-mismatch` ALTO). Os 2
CRÍTICOs atuais (grade + calendar no seed) emergiram ~06-23 e **persistem** há ~4 semanas de congelamento.

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background), cada um re-verificando os achados do
07-19 do seu domínio contra o **código atual** com evidência fresca `file:linha`, lendo canon + vizinhos, e
caçando misses. **4 usaram agent-types locais** deste repo: `harness-callback-auditor` (contrato l),
`backend-route-reviewer` (b + a-rotas), `backend-staff-rbac-reviewer` (auth), `backend-schema-migration-
engineer` (schema/índices); **Security Engineer** (payments j + channels k); **2 general-purpose** (LGPD g;
calendar/pilot a+m+autonomia/obs). Cada agente entregou lista estruturada com veredicto
(CONFIRMED/REFUTED/CHANGED/NEW) + severidade (calibrada ao piloto) + esforço + `file:linha`.

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff
dbd231e..HEAD -- src/ db/` = vazio); writer de `professional_schedules` (grep exaustivo `src/ scripts/ db/
test/`); `seed-pilot.ts` inserts (só 4, sem calendar/grade); harness `/status` POST (leu `bevox-callback.ts:
28,141` + `bullmq-consumer.ts:155` de harness `origin/main`) vs backend PATCH (`harness-callbacks.routes.ts:
56`); MFA sentinel (`mfa.ts` blocklist + `seed-pilot.ts:153`); léxico legado (grep = zero executável); OpenAPI
counts (`operationId`=0, 80 paths/95 ops); DSR export (`customers/routes.ts:97`); tracker (10 delivered + 1
parked); milestones §16 + surface §10.1 + §5.3/§12.9/§12.10 do PRD frozen.

**Ground-truth de CI rodado de fato** (2026-07-20 ~09:05–09:08 UTC, não inferido, logs em
`.claude/state/ci-2026-07-20/`): Typecheck/Format/OpenAPI/Unit(469)/Build = **GREEN**; `test:integration` =
**RED exit 1** (`1 failed | 92 passed`, flaky `booking_notice` + teardown 57P01); `pnpm audit --audit-level
high` = **RED exit 1, 12 high / 27 total** (`Severity: 3 low | 12 moderate | 12 high`); `lint` = **RED por
artefato local** (5 `.claude/state/gap*.js` gitignored, ausentes em checkout limpo → CI GREEN).

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005), frozen @ `7874971` (06-03).
Numeração de ADR **colide** entre namespaces backend/_shared — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem (vocab de
canal e POST/PATCH 404 viram CRÍTICO). (2) OSV Scanner / CodeQL não reproduzíveis offline (config lida:
`codeql.yml upload:never` = no-op; `security.yml` OSV roda em CI). (3) Caminho live (Stripe/Clerk/harness/Meta
reais) não exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência
comprovada de writers/endpoints + CI rodado. (4) MCP `stripe` requer auth interativa — **indisponível** nesta
sessão headless (reportado; não bloqueante para auditoria de código). (5) Esta passada é re-verificação sobre
código byte-idêntico ao do 07-19; o valor incremental é **confirmação independente + CI fresco + ~17 misses/
afinamentos + 2 mudanças de conclusão**, não descoberta de regressão (não houve mudança de código a regredir).

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-07-20. Sem alteração de código de
produto; somente este relatório. Revisão humana pendente.*
