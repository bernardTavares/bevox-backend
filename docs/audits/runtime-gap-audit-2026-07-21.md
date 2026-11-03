# Gap Analysis — bevox-backend — 2026-07-21

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo
> segundo a documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente
> real: login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (4 agent-types locais deste repo + Security Engineer +
> 2 general-purpose), cada um **re-verificando de fonte primária** o inventário do 07-20 contra o código
> **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** o que estivesse superestimado + caçar
> misses; **verificação independente pelo orquestrador** dos 6 achados-manchete (2 CRÍTICOs, auth-gate, money-bug,
> vocab-drop, worker-telemetry) direto no código + cross-repo; e **CI rodado de fato** (2026-07-21 ~09:05–09:07
> UTC, não inferido; logs em `.claude/state/ci-2026-07-21/`). Sucede `runtime-gap-audit-2026-07-20.md`.

## Resumo executivo

**Fundação madura; piloto ainda não pronto; nada mudou no código há ~7 semanas.** Esta é a **7ª passada** sobre
um alvo **byte-congelado**: `git diff dbd231e..HEAD -- src/ db/` é **vazio** (prova executada), e `HEAD`
(`7ae1aa5`) é o próprio commit do audit 07-20 (docs-only). Canon `bevox-knowledge` `origin/main` @ `7874971`
(06-03), `bevox-harness` `origin/main` @ `2979eb0` (06-03), `bevox-meta-api` `origin/main` @ `5516c2a` (06-22)
— **todos inalterados**. Logo o valor desta passada é **re-verificação independente de fonte-primária + CI
fresco + caça a misses + refutação de superestimações**, não descoberta de regressão (não houve mudança de
código a regredir). Os 7 auditores + o orquestrador **CONFIRMARAM 100% do inventário de código do 07-20 (0
refutações de achado de código)**, **de-escalaram 1** (redaction-paths: mismatch real mas **sem leak ativo** →
latente), e isolaram **~17 achados NOVOS/afiados** — o mais forte um sink de PII cru **tenant-unscoped e
não-apagável** (`received_events`) que **as 6 passadas anteriores + o 07-20 perderam**.

**O piloto morre no passo 2 ("ver agenda"), triple-gated — inalterado.** (a) O `seed-pilot` provisiona só um
`staff_account` (JWT **HS256**), mas toda rota de calendar exige `requireClerkAuth()` (**RS256** + claim
`organization_id`) e **nenhuma** rota de calendar pareia `requireStaff` → o principal semeado toma **401 antes**
dos CRÍTICOs (`pilot-actor-cannot-authenticate-to-calendar` — na verdade um gate de **provisionamento Clerk/ops**,
não defeito de código no calendar). Se um JWT Clerk for provisionado à mão: (b) `availability.ts:75
notFound("Calendar")` — **zero writers de `calendars`** em qualquer seed (nem `seed-pilot.ts` nem `db/seed.ts`);
(c) grade vazia → `availability.ts:126 if(!sched) continue` → `slots:[]` → `booking.ts:207 slot_conflict` em
100% — **zero writers de `professional_schedules`** em produção (único INSERT = fixture de teste
`calendar-booking.test.ts:120`). Os dois CRÍTICOs (b/c) **não têm workaround de produto**; o gate (a) tem
workaround de ops. **Fix mínimo dos CRÍTICOs ≈ 2-3h** (seedar Calendar + grade Seg-Sex). `WeeklySchedule` é
**entidade canônica nomeada** (PRD §5.3 l.379) + "motor de disponibilidade: grade fixa" (l.383) → é gap contra
entidade nomeada, **não deferimento**.

**"CI verde" — o único critério mensurável de Marco-1 (§16.1) — está RED em 2 jobs (rodado 2026-07-21), e o
Security job PIOROU.** Ground-truth executado: **Typecheck ✓ / Format ✓ / OpenAPI ✓ / Build ✓ / Unit ✓
(469/469, 69 files) GREEN**; **Tests RED** (`test:integration` exit 1: `1 failed | 92 passed (93)` — mesmo flaky
`calendar-booking.test.ts:259 booking_notice` dependente de hora-do-dia [rodei 09:06 UTC < ~13:00 UTC threshold →
`booked` em vez de `slot_conflict`] + teardown **57P01** por não fechar `closeDb/closeRedis` no `afterAll`);
**Security RED e PIOR** (`pnpm audit --audit-level high` exit 1: **33 vulns — 3 low / 15 moderate / 15 high**, vs
**27 / 12 high** no 07-20 → **+6 total, +3 high** só por advisories novos acumulando sobre o lockfile congelado).
O **lint-RED é artefato local** (5 `.claude/state/gap*.js` **gitignored** → checkout de CI limpo NÃO os vê → **CI
lint GREEN**), inalterado e esta sessão não acrescentou nenhum (usou Agent tool, não Workflow).

**Money-path manual do piloto FUNCIONA, com 1 bug HIGH re-confirmado de fonte-primária pelo orquestrador.**
`applyChargePaid` chama `insertPayment(status:"paid")` **incondicionalmente** (`service.ts:891`) após
`markChargePaid` (guardado `WHERE status='pending'`, `repository.ts:397`) → qualquer charge terminal
(expired/cancelled/refunded) re-marcada paga insere um payment `paid` órfão → `SUM(payments 'paid')`
double-conta. Alcançável no money-path manual (rota `mark-paid`). Fix: gatear `insertPayment` no rows-affected.
~2h.

**Contrato harness re-confirmado (inerte no piloto manual):** o `harness POST /status` vs `backend PATCH /status`
= **404**, mas o backend é **canon-correto 3:1** (PRD §10.4 l.1076 + l.817 PATCH vs stale §10.1 l.447 POST) → fix
**cross-repo** (harness→PATCH + errata canon), não edit de backend. `idempotency em callbacks` segue **REFUTADO**
(state-machine; `/complete` retentado = **409**, não 200 idempotente — e o harness até **manda** a chave, o backend
a ignora). Único bug **de código backend-vs-canon** do contrato: `complete-failed-strategy` não mapeia p/ `error`.

**Caminho de fechamento do piloto curto e inalterado:** 2 blockers de agenda (≈ 2-3h) + gate de CI
(flaky+teardown ≈ 0,5h; audit bump ≈ 2-3h) + gate de auth-actor (ops, ou ~4-6h) ≈ **5-9h**. Severidades ancoradas
no gate do **piloto**; para GA vários ALTO/MÉDIO sobem (vocab de canal e POST/PATCH 404 viram CRÍTICO de GA).

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária (o brief tem imprecisões herdadas; carregadas do 07-20 e re-confirmadas):

1. Os **4 callbacks** que o backend expõe são **`/status`, `/traces`, `/stream`, `/complete`** (em
   `src/integration/harness-callbacks.routes.ts`) — **não** `/complete,/artifact,/tool-result,/turn` como o brief
   lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (não "channels"). Channels = **_shared/ADR-011**.
   backend/ADR-018 = refund/cancellation policy (correto no brief). backend/ADR-014 = PSP Stripe Connect;
   backend/ADR-023 = manual payment mode; backend/ADR-010 = calendar (WeeklySchedule).
3. O grep `account_id\b` do brief captura compostos **sancionados** (Stripe/Chatwoot); o léxico proibido
   **executável** é **ZERO** (invariante §4.1 mantida — não-gap).
4. Código congelado desde **06-03** (`dbd231e`), não 06-04.
5. Numeração de ADR **colide** entre `backend/` e `_shared/` (008–023) — **sempre qualificada** abaixo.
6. **RBAC de staff é canon backend/ADR-013** (roles l.108), **não ADR-022** (backend/ADR-022 = policy-json). A
   rule local `.claude/rules/backend-routes.md` mis-cita "ADR-022 staff RBAC" — ver BAIXO.

## Calibração canônica (lida do canon frozen — PRD §13 roadmap + §16 prontidão)

- **§16.1 Marco-1** ("Pronto para integração") = repo + **CI verde** + migrations pg16 + módulos
  **auth/organizations/users/professionals/services/customers** + **OpenAPI publicado** + contrato harness
  documentado+testado com stub + deploy staging. **Calendar e Payments NÃO estão em Marco-1.** ⇒ o único
  bloqueador **mensurável** de Marco-1 é **CI-verde (RED)**. (§16.1 l.1425-1432.)
- **§16.2 Marco-2** = calendar, conversations, messages, channels, ai-pipeline, autonomy; fluxos 1/2/3 e2e;
  token accounting; idempotência tools mutação; métricas Prometheus; cobertura ≥70%.
- **§16.3 Marco-3** = payments (Stripe Connect), reminders, faq, rules, audit, observabilidade; WhatsApp direto;
  circuit breaker; OTel completo; **LGPD DSR/retenção/consentimento**; **MFA TOTP**; SLO.
- **§13 roadmap** numera diferente (Marco-3 = absorção do calendar-service ADR-010) — tensão interna do PRD; o
  ponto invariante: **o piloto exercita calendar (§16.2) + payments (§16.3) independentemente do rótulo** → os 2
  CRÍTICOs são **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".
- **Fato estrutural:** o código entrega muito além de Marco-1 (calendar, payments, channels, autonomia,
  observabilidade parcial) — o README "Marco 1 bootstrap" **subdeclara** o que existe. §5.3 lista `WeeklySchedule`
  como entidade explícita; §10.1 confirma o contrato REST (não enumera `GET /appointments`; SSE por `?token=`/
  `?scope=` query — o código exige header → drift). §5.6/ADR-023: **Manual Payment Mode é o money-path do piloto**;
  split Stripe Connect é repurposado p/ assinatura SaaS → gaps de split/reconcile Stripe são deferimentos legítimos.

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-07-21) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO, re-verif fonte-primária); `no-appointments-read-endpoint` (ALTO); ADR-020 templates + ADR-021 priority-score não-materializados |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recontagem independente idêntica: **~106 rotas / 80 paths / 95 ops / operationId:0 / 0 phantom / 11 undoc** |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO** (232 matches = só Stripe/Chatwoot compostos + doc-comments + snapshots congelados) |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | `mfa.ts:35` blocklist + seed gera base32; login não rejeita = **correto** (Marco-3); `CLAUDE.md §8` stale |
| e | Testes faltando (hot paths) | ✅ | availability(rota)/reschedule/webhook Stripe/inbound-vocab — zero e2e; `constructEvent` em test = 0 |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; 1 `@deprecated`; TODOs todos Marco-2/3 |
| g | LGPD | ✅ | `ai_opt_out` armazenado-não-aplicado (vetor vivo, headline); **NOVO** `received_events` PII-cru não-apagável; DSR export existe/deleção ausente |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked**; nenhum work-item p/ calendar/ADR-010 → grade CRÍTICA **invisível** ao tracker; "delivered" ≠ pilot-ready |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky+teardown) + Security RED **PIOR (15 high / 33)**; lint-RED = artefato local |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH** (re-verif fonte-primária); reconcile cru; PCI-nil; conformances confirmadas |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH** (cross-repo re-verif: backend "wa" vs meta-api enum pleno); 2 perdas de inbound; HMAC correto |
| l | Harness dispatch | ✅ | `POST/PATCH 404` (backend canon-CORRETO 3:1); idempotency-em-callbacks **REFUTADO**; 5 misses novos BAIXO |
| m | Alçapões do piloto | ✅ (traçado) | **triple-gated** (auth-actor + calendar + grade) inalterado; money-path manual OK com 1 bug HIGH |
| n | Delta vs audit anterior | ✅ | 07-20 re-verificado; **0 refutações de código**; ~17 NOVOS/afiados; 1 de-escalação; Security-RED pior |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN — PASSA, classe de token errada.** `seed-pilot` cria org + `bevox_admin`; `POST /staff/sessions` cunha
   JWT staff **HS256** (`staff-auth.ts:70`). Sem rate-limit/lockout (`auth/routes.ts:90`).
2. **VER AGENDA — QUEBRA na AUTH primeiro.** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`clerk-auth.ts:90`) → token staff HS256 → **401**. `grep requireStaff src/modules/calendar/` = **NONE**; seed
   não provisiona principal Clerk → **1º hard stop (gate de ops)**. *Se JWT Clerk à mão:* →
   `availability.ts:75 notFound("Calendar")` (**CRÍTICO b**). *Se Calendar à mão:* → `availability.ts:126` grade
   vazia → `slots:[]` (**CRÍTICO c**). Sem `GET /appointments` → ver agendamentos feitos não tem rota REST.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100%. Reschedule/transition têm 4
   defeitos de correção (não-atômico, self-overlap, idempotência fina, transição sem guard).
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** `charges/manual` + `mark-paid` →
   `applyChargePaid` concilia o ledger. **Pré-requisito escondido (NOVO):** `seed-pilot` não cria payment account →
   precisa de `POST /payment-account/connect-manual` à mão antes (mesmo gate Clerk upstream). **1 bug HIGH:** charge
   `expired`/`refunded` re-marcada paga insere payment `paid` órfão **+ confirma appointment + concede pacote** no
   no-op (corrupção de estado; root-cause compartilhado alcança o path Stripe).
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura;
   reconcile cru sem `applyChargePaid`; split em 2 endpoints vs ADR-014. Modo manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[CHANGED]`/`[REFUTED]` = status vs 07-20; **(v: …)** = verificação independente
(orquestrador fonte-primária, ou agente com evidência fresca); `[xrepo]` = dependência cruzada. Severidade
ancorada no gate do **piloto**; escalonamento p/ GA anotado.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO — orquestrador + agente, grep exaustivo
  `src/ scripts/ db/ test/`)** — Nenhum caminho de produção escreve `professional_schedules` (grade semanal-base).
  Único `INSERT` = fixture `test/integration/calendar-booking.test.ts:120`. Produção só lê (`availability.ts:116`);
  `:126 if(!sched) continue` esvazia todo dia → `slots:[]` (`:200`) → `booking.ts:207 slot_conflict`.
  `calendar/routes.ts` grava só `professional_schedule_overrides` (`repository.ts:78,96`). Sem CRUD de
  WeeklySchedule, sem Zod body (`schemas.ts`), sem repo writer, sem símbolo `weeklySchedule` em lugar nenhum.
  **NOVO corroborante:** até o dev-seed `db/seed.ts` não escreve grade (só `systemHolidays`). Escopo §5.3
  (backend/ADR-010 aceita; `WeeklySchedule` = entidade canônica) — **Marco-2 in-scope, não deferimento**. —
  Impacto: 100% dos agendamentos = `slot_conflict`. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (só
  seedar grade). **#1.** `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO — orquestrador + agente)** —
  `seed-pilot.ts` insere só org(`:109-124`)/staff(`:156-168`)/professional(`:195-202`)/service(`:217-226`). Zero
  `calendars` (o `createCalendar` de `repository.ts:20` nunca é chamado) → `availability.ts:75 notFound("Calendar")`.
  `system_holidays` omitido é **fail-open** (`availability.ts:108-111` vazio → `isSystemHoliday=false`, todo dia
  trabalhável), **não** co-bloqueador. **NOVO corroborante:** nenhum seed (`seed-pilot.ts` nem `db/seed.ts`)
  produz um calendar bookável. — Esforço: **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.**
  `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO — orquestrador + agente + grep)** —
  O seed provisiona **só** um `staff_account` (HS256, aud `bevox-backend-staff`, `staff-auth.ts:70`). Toda rota de
  calendar é guardada por `requireClerkAuth()` (`calendar/routes.ts:22,24`), que verifica **RS256 apenas**
  (`clerk-auth.ts:6,90`) e exige claim `organization_id` (`:105-108`) → token staff é categoricamente rejeitado.
  `grep requireStaff src/modules/calendar/` = **NONE**. **Afinamento do agente:** é, com precisão, um gate de
  **provisionamento Clerk/ops** (o principal Clerk correto do piloto — usuário + org + JWT-template
  `organization_id` — não é semeado), sobrepondo `clerk-user-provisioning-broken`; não é defeito de código no
  calendar. Sit **upstream** dos 2 CRÍTICOs. — Impacto: go-live hands-off via `seed-pilot` não produz login
  utilizável no calendar. — Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped, se piloto staff-driven).
  `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-07-21 ~09:05–09:07 UTC; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-teardown`** `[carry]` **(v: RODADO)** — `pnpm test:integration` =
  **RED exit 1**, `1 failed | 92 passed (93)` · `1 file | 13 passed (14)`. Falha =
  `calendar-booking.test.ts:259` "booking_notice (slot too soon)" `expected 'booked' to be 'slot_conflict'` — o
  gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei às **09:06 UTC** → `booked` → assert falha. + teardown
  **57P01** ("terminating connection due to administrator command" — suíte não fecha `closeDb/closeRedis` no
  `afterAll`, testcontainer derrubado com conexões vivas). `ci.yml` job `Tests` roda `test` + `test:integration`
  sem `continue-on-error` → o flaky **falha o CI de fato**. — Esforço: **0,5h** (ancorar slot a `now()`-relativo +
  `await closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-15-high`** `[carry, CHANGED — PIOR]` **(v: RODADO)** — `pnpm audit --audit-level
  high` = **RED exit 1, 33 vulns (3 low · 15 moderate · 15 high)** vs **27 / 12 high** no 07-20 → **+3 high, +6
  total**, só por advisories novos sobre o **lockfile congelado** (deriva composicional real mesmo sem mudança de
  código). Highs prod-runtime: `@opentelemetry/{auto-instrumentations-node,exporter-prometheus,sdk-node}`,
  `@grpc/grpc-js` (×2), `protobufjs` (×2), `undici` (×3: TLS-bypass, WS-DoS, cross-origin-routing). Dev-only: `tmp`
  (via testcontainers), `vite` (via vitest), `brace-expansion`, `js-yaml`. `security.yml continue-on-error:false`
  → hard-fail. — Esforço: **2-3h** (bump OTel sob nota ADR-012 + `pnpm override` undici/tmp/vite). **#3.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA/outbound/staff-approve ligar)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(v: CONFIRMADO — orquestrador cross-repo +
  agente)** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`metaapi/normalize.ts:16,35,44`) e **persiste
  `"wa"`** em `channel_connections.provider`. Outbound null-coage tudo que não seja pleno (`metaapi/repository.ts:
  ~197`: `r.provider === "whatsapp" || r.provider === "instagram" ? r.provider : null`) → guard → skip
  `skipped_missing_recipient` (audita `metaapi.send.skipped`, **não erro**; `seams.ts isDeliveryFailure` exclui
  skips → mantém `done` = falso-sucesso). **Alcançável NO piloto via staff-approve.** `bevox-meta-api`
  (`origin/main`) exige enum pleno no fio (`messages/schemas.ts:7 z.enum(["whatsapp","instagram"])`) → `wa`/`ig` é
  invenção 100% backend **auto-inconsistente** (inbound grava "wa", o próprio outbound só aceita "whatsapp"). —
  Impacto: 100% das respostas a conversas reais descartadas em silêncio. — Esforço: **3-4h** (unificar vocab +
  CHECK + backfill + teste e2e). **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, broadened ×2]` **(v: CONFIRMADO — orquestrador
  fonte-primária + Security Engineer)** — `applyChargePaid` chama `insertPayment` **incondicional** (`service.ts:
  891`) após `markChargePaid` (guardado `WHERE status='pending'`, retorna **void, sem rowcount**, `repository.ts:
  395-399`); `insertPayment` dedupa por `ON CONFLICT (org, provider_payment_id, status='paid') DO NOTHING`.
  **Alcance manual re-precisado (Security):** o único estado terminal manual re-alcançável é **`expired`** (via
  `expireChargeManually` — cash-pay tardio → re-mark, o mais plausível no piloto) e **`refunded`** (o
  `markPaymentReversed` libera o slot único → orphan); **`cancelled` só existe no path Stripe** (`reconcile.ts:141`;
  charge Stripe não é mark-paid-manual). `markChargePaidManually` (`service.ts:422-463`) não tem status-gate (por
  design, `:414-416`). **Broadening NOVO (pior que o 07-20):** no re-mark no-op, `applyChargePaid` **também** dispara
  `confirmAppointmentIfUnconfirmed` (`:901-903`) + grant de pacote (`:915-924`) → um charge `expired` ganha
  appointment `confirmed` + sessão de pacote concedida enquanto o charge segue `expired` → **corrupção de estado**,
  não só payment fantasma. **Root-cause compartilhado:** vive no `applyChargePaid` comum → alcançável no path
  **Stripe** também (`webhook-platform.ts:107-120` o chama incondicional). Fix: `markChargePaid` retornar rowcount
  (`RETURNING`) e gatear `insertPayment` + side-effects nele. **Nuance de blast-radius (INFO):** nenhum código SUMa
  `payments WHERE status='paid'` (o `charges_succeeded_total` nem é registrado) → hoje é **corrupção-de-tabela
  latente** revelada só por auditoria contábil externa, não auto-inconsistência interna — real, mas não observável
  in-app agora. — Esforço: **2h**. **#4.**
- **`harness-status-callbacks-post-vs-patch-404`** `[carry]` **(v: CONFIRMADO byte-level nos 2 repos + canon —
  reframe validado 3:1)** — Harness POSTa **todo** callback (`bevox-callback.ts:28 method:"POST"`; `updateStatus→
  post(…/status)` `:133-145`); backend registra **só** `app.patch(".../status")` (`harness-callbacks.routes.ts:56`)
  → Fastify **404** → mata todos os status callbacks incl. `dead_letter` autoritativo. **REFRAME:** o backend é
  **canon-CORRETO** — PRD §10.4 l.1076 + l.817 PATCH (autoritativo) vs stale §10.1 l.447 POST (canon
  internamente inconsistente); o **harness + PRD-l.447** é que estão stale. Fix = **cross-repo** (harness→PATCH +
  errata canon l.447 via ADR-005), **não** edit de backend. Inerte no piloto (harness undispatched). — Esforço:
  **3h**. **#7.** `[xrepo: bevox-harness + canon]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — sweep de rotas, agente)** — Não existe `GET
  /appointments` nem `GET /appointments/:id`; `calendar/routes.ts` expõe só `/calendars` (GET/POST),
  schedule-overrides (POST), availability (GET), appointments (POST-create), PATCH-reschedule, 4 POST-transition
  (`:28,33,41,48,71,99,131`). §10.1 também não o enumera, mas a persona mobile ("agenda do dia") + Fluxo 3 (§8.3)
  exigem — agendamentos ficam write-only sobre REST (legíveis só via Google sync). — Esforço: **3-5h**.
  `[xrepo: PRD §5.3/§8.3]`

**Auth / segurança (Marco-1; alguns mitigados no piloto 1 org/1 admin) — todos CONFIRMADOS pelo agente RBAC**

- **`staff-jwt-secret-no-min-length`** `[carry]` **(v: CONFIRMADO)** — `env.ts:60 STAFF_JWT_SECRET:
  optionalString`; refino de prod é **presence-only** (`:205-206`) → secret de 1 char passa; `staff-auth.ts:48-53,
  67-75` assina HS256 com ele. Secret fraco = forjável offline → JWT staff forjado (`aud=bevox-backend-staff,
  role=bevox_admin`) = compromisso **total** do plano staff (cross-org + impersonation). — Esforço: **0,5h**
  (`.min(32)`). **O buraco de segurança mais duro do conjunto.**
- **`staff-login-no-ratelimit-no-lockout`** `[carry]` **(v: CONFIRMADO)** — `auth/routes.ts:90 POST /staff/
  sessions` + `:97` refresh sem `preHandler`; `requireRateLimit` decorator definido (`rate-limit.ts:146`) mas
  aplicado a **zero** rotas; bcrypt cost 12 é o único freio → brute-force online destravado contra `staff@example.com`
  (semeado, adivinhável). — Esforço: **3h**.
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — enumeração completa)** — `requireRole` só existe
  como 3 TODOs (`clerk-auth.ts:25`, `auth/repository.ts:261`, `types/global.d.ts:35`); zero impl, zero callers;
  `req.auth.role` default `"member"` não-sanitizado (`clerk-auth.ts:109`). Rotas cliente mutantes **sem gate de
  papel** (só `requireClerkAuth+requireOrganizationScope`): money (`payments/routes.ts:62,95,105,167,187,274,284,
  295,306,318` — charges/manual/refund/mark-paid/expire/connect/policy), destrutivas (`DELETE/PATCH professionals/
  :id` `professionals/routes.ts:43,53`; `DELETE/PATCH services/:id` `services/routes.ts:44,50`), org config (`PATCH
  org/settings` + `onboarding/advance` `organizations/routes.ts:43,54,70`; `PATCH autonomy` `autonomy/routes.ts:23`),
  approval (`executions/:id/{approve,edit,reject}` `executions/routes.ts:30,41,53`), PII (`customers` POST/PATCH +
  facts `customers/routes.ts:49,60,76`). Qualquer JWT org-member (mesmo `professional_viewer`) roda tudo. PRD §5.1
  + ADR-013 item 6. Blast-radius baixo no piloto (1 org/1 admin). — Esforço: **8h**. `[xrepo: backend/ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO — mais forte vs canon)** — `auth/repository.ts:
  221-223 SELECT organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna
  clerk-**user**-id; fn nomeada `findOrganizationByClerkOrg`) → nunca casa quando org claim presente; webhook trata
  só `user.*` (`routes.ts:165,186`), sem `organization.created`. PRD §5.1/§8.5. Mitigado no piloto (seed) mas
  alimenta o gate auth-actor acima. — Esforço: **5h** (+ADR mapping org). `[xrepo: Clerk]`

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real) — CONFIRMADOS pelo agente LGPD**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` **(v: CONFIRMADO — vetor vivo, headline LGPD)** —
  `ai_opt_out` gravado/lido só no CRUD (`customers/repository.ts:21,26,67`; **zero** outros readers — grep prova);
  `cutoff.ts:34-126` resolve modo + `buildDispatchMessages` (`orchestration/repository.ts:391-415`, `content_text`
  cru) + `dispatchExecution` (`harness-dispatcher.ts:61-117`) **sem** carregar o customer nem checar `ai_opt_out`
  → cliente que revoga consentimento ainda tem a conversa mandada ao LLM externo (transferência intl,
  _shared/ADR-019 item 7). `consent_granted_at` = **zero writers** → não há nem captura. Dispara no instante em que
  o pipeline inbound (Meta→ingestion→buffer→cutoff worker) liga. — Esforço: **4-6h**. **#10.**
- **`waitlist-priority-score-client-settable`** `[carry]` **(v: CONFIRMADO — corroborado pelo agente de schema)** —
  backend/ADR-021 (aceita) fecharia o vetor de queue-skip tornando `priority_score` **derivado pelo sistema**
  (`MAX(0, age_hours + urgency×100 − skips×10)`, ADR-021 l.57). Mas `waitlist/routes.ts:71` ainda escreve
  `priority_score` do input do cliente e `match.ts:74-75` só ordena pelo valor armazenado (`calendar.ts:204` é
  numeric simples writable); as colunas `urgency_level`/`skip_count`/`last_score_update` + fórmula + cron **não
  existem** → o ataque de furar-fila continua **aberto**. — Esforço: **6-8h**. `[a/g; ADR-021]`

### MÉDIO (degrada qualidade)

**Observabilidade — worker é buraco-negro triplo (harness inerte no piloto, exceto observabilidade que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry]` **(v: CONFIRMADO — orquestrador + agente; ALTO-operabilidade)**
  — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca** `import "./instrument.js"` nem
  `initTelemetry()` (ambos só em `src/index.ts:17,30`) → no worker o Sentry `captureException` (`queue/index.ts:
  272,313`) é drop silencioso e o OTel NodeSDK nunca inicia (zero traces pg/redis) p/ **toda a metade assíncrona**
  que o piloto roda (ingestion, cutoff→dispatch, timeout/expiry-scan, 2 crons de reconcile, google sync, waitlist,
  package-expiry). — **1h** (import + `await initTelemetry()`). **Alto valor / baixo esforço.**
- **`worker-process-has-no-metrics-scrape-endpoint`** `[NOVO]` **(v: CONFIRMADO — agente)** — `/metrics` é servido
  **só** pelo HTTP server (`health/routes.ts:24`, via `src/index.ts`); o worker **não** sobe listener HTTP
  (grep listen/createServer = vazio). Mas handlers de worker incrementam counters prom-client
  (`paymentsReconcileRunsTotal` `reconcile.ts:162,272`, `metaapiOutboundMessagesTotal`, `messagesReceivedTotal`)
  num registry sem endpoint de scrape naquele processo → **permanentemente não-scrapável**. **3º pilar morto** que
  compõe com `worker-process-telemetry-uninitialized`: o worker é cego a Sentry + OTel + Prometheus. — **1-2h**.

**Agenda — correção de dados quando exercitada (Marco-2; todos CONFIRMADOS pelo agente calendar)**

- **`reschedule-non-atomic-double-book`** `[carry]` — `booking.ts:373 createAppointment` commita o novo (+ outbox
  Google `create`) na própria tx (`:223-248`); `:390-414` cancela o antigo em tx **separada** → crash entre as duas
  = 2 appointments ativos + push Google duplicado, sem compensação. — **2-3h**.
- **`reschedule-self-overlap-always-conflicts`** `[carry]` — a re-contagem conta o appointment antigo (ainda
  `scheduled`; `availability.ts:169` + `booking.ts:229` excluem só `'cancelled'`, nunca self-id) → para
  `max_concurrent=1` qualquer remarcação sobrepondo o horário atual = `slot_conflict`. — **2h**.
- **`appointment-transition-no-state-guard`** `[carry]` — `booking.ts:445-450` UPDATE any→any incondicional;
  `cancelled→completed/no_show` aceito → `txStatusChanged=true` → decremento de pacote (`:485-489`) consome sessão
  de appointment cancelado. Sem máquina de estados. — **2h**.
- **`reschedule-thin-idempotency`** `[carry]` — `booking.ts:387 idempotencyKey:undefined` → NULL (índice único
  trata NULL como distinto); `idemHit/idemStore` no-op → única defesa é o `requireIdempotency` HTTP. Create tem 2
  guardas; reschedule tem 1. §5.3 l.396 exige idempotência na criação. — **1-2h**.
- **`availability-n1-count-plus-92day-serial-loop-unbounded`** `[NOVO]` **(v: CONFIRMADO — agente; GA-scaling/DoS)**
  — `availability.ts:167-171` roda um `COUNT(*)` **por-slot** dentro de loops por-membro × por-intervalo × por-slot,
  e `routes.ts:52-67` itera `date_from..date_to` **serial** até span de 92 dias (cap `schemas.ts:28-29`). 1 prof /
  dia útil / serviço 30-min ≈ ~1.470 queries sequenciais/request. Guardado por auth mas **não** rate-limited → vetor
  de latência/DoS. Não pilot-blocking (1 prof); miss que 6 passadas perderam. — **4-6h**.

**Contrato backend↔harness (mismatches; persistem — todos INERTES no piloto, ALTO-GA) — CONFIRMADOS pelo agente harness**

- **`complete-failed-strategy-not-mapped-to-error`** `[carry]` **(v: CONFIRMADO — único bug de código
  backend-vs-canon do contrato)** — `strategy:"failed"` parseia; proposals vazias → `inferSuggestionType→"reply"`
  (`complete-service.ts:17-32`); manual/copilot (modo do piloto) → `:112 waiting_approval` com `response_text`
  (sugestão-fantasma na fila de staff); autônomo → `done`. Nunca `error`. Canon (PRD l.1146 + backend/ADR-019
  l.163) exige `error`. — **3h**. `[xrepo]`
- **`complete-rejects-aborted-strategies-400`** `[carry]` **(v: CONFIRMADO — bug de HARNESS)** — harness emite
  `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2096-2100`); enum backend omite (`harness-callbacks.
  schema.ts:57-65`) → ZodError → 400 (engolido `:2155`). Canon fica com o backend (l.1075 sem `aborted_*`); harness
  auto-admite que o desfecho canônico é `failed` mas vaza o label de telemetria no strategy. — **2h** (harness).
  `[xrepo]`
- **`completing-state-has-no-timeout-backstop`** `[carry]` — `lockForCompletion` seta `status='completing'`
  (`harness-callbacks.repository.ts:128`); se `finalizeCompletion` lança (500), row órfã em `completing`;
  timeout-scan claima só `('dispatching','processing','waiting_input')` (`orchestration/repository.ts:428`) → nada
  reconcilia `completing` → retry do harness → 409 permanente. — **2h**. `[xrepo]`
- **`stale-token-blind-status-transition`** `[carry]` — `findExecutionIdByTokenHash` exclui só `('done','error',
  'cancelled','dead_letter')` (`harness-callbacks.repository.ts:34`); `applyStatusTransition` é UPDATE cego sem
  guard de origem (`:58-68`) → callback tardio `running` regride `waiting_approval→processing` (some da fila).
  Mascarado pelo 404 acima; morde quando corrigido. — **3h**. `[xrepo]`
- **`backend-never-sends-skills-allowlist`** `[carry]` — `cutoff.ts:75 skills:[]` hardcoded;
  `account_denied_tools` **nem existe** no `DispatchPayloadSchema` (`harness-dispatch.schema.ts:25-63`); harness
  trata `[]` como "todas as tools" (`permission-context.ts:63-68`) → PERM-05 (allowlist por org) é **no-op** e2e.
  (Rule `backend-harness-contract.md` lista `account_denied_tools` como campo — canon não.) — **4h**.
  `[xrepo: bevox-harness]`

**Pagamentos / reconciliação (resíduo do "webhook concilia"; Stripe-path, não exercitado pelo piloto manual)**

- **`reconcile-cron-flips-paid-without-orchestration`** `[carry]` — `reconcile.ts:143-150 UPDATE charges 'paid'`
  cru sem `applyChargePaid` → paid sem row em `payments`, appointment nunca confirmado, sem grant, sem audit. Manual
  pula (`:119`). — **3h**. **#6.**
- **`reconcile-cron-skips-applyChargeRefunded`** `[carry]` — `reconcile.ts:252-259 UPDATE refunds` cru sem
  `applyChargeRefunded` → viola ADR-018 (full refund de package ⇒ `cancelled`); charge segue `paid`, package
  `active`. — **2h**.
- **`reconcile-cron-flips-cancelled-without-orchestration`** `[NOVO]` **(v: Security Engineer)** — `reconcile.ts:
  141,144-149`: PI `canceled` → `UPDATE charges SET status='cancelled'` cru (é o **único** writer de charge→
  `cancelled` no codebase, não-orquestrado) → o appointment ligado ao charge cancelado nunca é cancelado, sem
  audit. — **1h**.
- **`stripe-webhook-zero-route-signature-dedupe-tests`** `[carry]` — 0 `constructEvent` em `test/`; nenhum teste
  injeta `POST /webhooks/stripe[/platform]`; o teste homônimo mocka o repo e enshrine os gaps de reconcile cru.
  Ponto de entrada de dinheiro sem cobertura de assinatura/dedupe/roteamento. — **6h**. **#8.** `[xrepo: Stripe]`
- **`pix-reconcile-split-2-endpoints-vs-adr014`** `[carry]` — `/webhooks/stripe` trata só `account.updated`;
  `payment_intent.*`/`refund.*` em `/webhooks/stripe/platform` (secret `_PLATFORM`); **ADR-014 documenta UM
  endpoint** → operador canon-fiel manda PI p/ `/stripe` que records-and-ignores. Ambos secrets `requiredInProd`.
  — **1h** (errata canon + startup-assert). `[xrepo]`
- **`requires-prepayment-hook-throws-manual-mode`** `[carry]` — `booking.ts:277,299` hardcoda Stripe
  `createCharge`; `getByOrg` sem filtro de provider → p/ org manual retorna conta manual (`external_account_id=
  NULL`) → `service.ts:193 lança "payment account not active"`; caught best-effort (audita `charge.hook_failed`).
  Seed `requires_prepayment=false`. — **3h**. `[xrepo: ADR-023 vs ADR-014]`
- **`money-mutation-routes-no-http-idempotency-key`** `[carry]` — em `payments/routes.ts`, a composição `mutate`
  (`:59`, sem `requireIdempotency`) aplicada a `mark-paid`(`:295`)/`expire`(`:318`)/`connect-manual`(`:274`)/`PATCH
  policy`(`:95`) — sem `Idempotency-Key` no fio; contraste `write`(`:52`) o inclui. Fator contribuinte direto do
  `manual-remark orphan` (o lock Redis em `markChargePaidManually` só serializa concorrência, não re-marks
  sequenciais). — **0,5h**.
- **`seed-pilot-creates-no-payment-account`** `[NOVO]` **(v: Security Engineer — 4º gate do money-path do piloto)** —
  `scripts/seed-pilot.ts` **não** cria payment account (grep `payment_account|manual|stripe|charge|
  requires_prepayment` = só `aiMode`/`roleType`). O passo "cobrar" (ADR-023 manual) exige `POST /payment-account/
  connect-manual` (`routes.ts:274`) **antes** de `charges/manual` + `mark-paid` → go-live hands-off via `seed-pilot`
  não produz money-path utilizável. Não é blocker de código (a rota existe) mas é pré-requisito escondido que o
  runbook precisa cobrir; e o **mesmo gate de auth Clerk** (`routes.ts:51,59 requireClerkAuth`) sit upstream destas
  rotas org-scoped, igual ao calendar. — Esforço: ops OU **0,5h** (seedar conta manual). `[xrepo: hub runbook]`

**Canais — perda de inbound (CONFIRMADOS pelo Security Engineer)**

- **`inbound-dedupe-strand-onboarding-loss`** `[carry]` — `metaapi/routes.ts:174` SETNX dedupe **antes** do
  persist; `:190 throw notFound("tenant not mapped")` na janela de onboarding → key strandada; meta-api retenta
  (<24h TTL) → `:178 replayed` 200 → evento **perdido**. `DEL` (`:280-282`) só cobre `message.received`. — **2-3h**.
  `[xrepo: bevox-meta-api]`
- **`null-tenant-audit-notnull-500-inbound-loss`** `[carry]` — `tenant_id=null` aceito (`schemas.ts:38`); `:215`
  audit INSERT passa `organization_id=NULL` numa coluna NOT NULL → 500 → key strandada → retry `replayed` →
  perdido. — **1-2h**. `[xrepo: bevox-meta-api]`
- **`status-events-subscribed-but-ignored`** `[carry, ALTO-GA]` — backend assina 5 tipos mas `routes.ts:234` trata
  só `message.received`; `message.status_updated` (sent/delivered/read/**FAILED** outbound) sem handler → falha de
  entrega assíncrona do Meta nunca reconciliada. — **4-8h**. `[xrepo]`

**LGPD / retenção / schema (Marco-3; piloto roda com PII real) — CONFIRMADOS pelos agentes LGPD + schema**

- **`received-events-raw-payload-unscoped-un-erasable`** `[NOVO]` **(v: CONFIRMADO — agente LGPD; miss das 6
  passadas)** — `metaapi/routes.ts:203-211` persiste o **envelope Meta cru** (`payload_json`: wa_id/telefone/nome/
  texto) em `received_events` (`ingestion.ts:12-30`), que tem **zero `organization_id`, zero `customer_id`, zero
  `deleted_at`** — só `source`+`source_event_key`. Nunca purgado, omitido do DSR export, un-joinável ao titular →
  sink de PII cru **erasure-impossível**, estritamente pior que `message_records`. Escrito a cada evento inbound.
  — **6-8h** (fold ADR-020). `[xrepo: _shared/ADR-020]`
- **`message-records-not-customer-org-scoped-blocks-dsr`** `[carry]` — `message_records` (`ingestion.ts:32-49`)
  não tem **nem** `organization_id` **nem** `customer_id` — apesar de PII (`content_text:42`, `sender_snapshot_json:
  47` com wa_id/telefone, `media_json:48`); único FK `received_event_id ON DELETE set null` → não cascateia de
  `organizations`; §12.9 l.1300 exige pseudonimizar `Message.content` na deleção do customer → un-joinável, DSR
  impossível. — **6-8h**. `[xrepo: _shared/ADR-020]`
- **`denormalized-customer-contact-snapshot-defeats-erasure`** `[carry]` — `appointments` (`calendar.ts:128-130`)
  e `waitlist_entries` (`:194-196`) guardam `customer_name/phone/email` denormalizados com `onDelete:"set null"` no
  FK → hard-delete de customer nula o link mas **deixa o snapshot de PII órfão e un-joinável** → erasure derrotada
  mesmo depois de implementada. Escrito no path de booking do piloto. — **fold no ADR-020**. `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` — `queue/index.ts` 11 workers, nenhum purga/pseudonimiza PII;
  sem `consent_events`/`dsr_requests`/`legal_basis` (grep=NONE); `deleted_at`/`consent_granted_at`/`archived_at`
  nunca escritos. — **12-16h**. `[xrepo: _shared/ADR-020]`
- **`no-dsr-deletion-endpoint`** `[carry]` — sem `app.delete` em `customers/routes.ts`; `deleted_at` filtrado
  (`repository.ts:31,41`) mas nunca escrito (soft-delete decorativo). **Nuance:** o DSR **export** EXISTE (`GET
  /api/v1/customers/:id/export`, `routes.ts:97`) — só a **deleção** falta (canon §12.9 cascade). — **6-8h**.
  `[xrepo: _shared/ADR-020]`
- **`customer-pii-mutations-unaudited`** `[carry]` — `customers/service.ts` escreve **zero** `audit_events` (não
  há nem intenção — só TODOs de hidratação de export `:85-86,108`); os outros 12 módulos auditam. Create/patch de
  PII + toggle `ai_opt_out` sem trilha (art.37 RoPA). — **3-4h**.
- **`execution-traces-pii-retained-omitted-from-dsr`** `[carry]` — `harness-callbacks.repository.ts:187-208` grava
  `input_json`/`output_json` crus (texto/telefone); tem `org+execution_id` mas **sem `customer_id`**, sem retenção
  e **omitido do DSR export** (`CustomerExport` `service.ts:77-110` sem campo traces). — **4h**.
- **`dsr-export-omits-subjects-own-personal-data`** `[carry]` — `CustomerExport` retorna só `CustomerRow` de 9
  cols; omite `preferences_json`/`risk_flags_json`/`consent_granted_at` do próprio titular + `messages`/
  `audit_events` hardcoded `[]` (`service.ts:107-108`). — **1h**.
- **`section-11-3-critical-indexes-partially-absent`** `[carry]` **(v: CONFIRMADO — agente schema)** — PRD §11.3
  (l.1212-1220): ausentes `(org,status)` em appointments/charges/executions, `(org,start_at)` + `(org,customer_id)`
  em appointments, `(org,customer_id)` em charges/conversations. Hot-path availability mitigado por
  `(professional_id,start_at)`; risco = scans org-wide na escala GA. — **2h**.
- **`fk-columns-without-index-systemic`** `[carry]` **(v: CONFIRMADO + 3 misses novos)** — org_id FK sem índice em
  `customers`/`professionals`(org+user)/`services`/`calendars`/`users`/`executions`(org+conversation+buffer_window).
  **NOVOS (agente schema):** `payments.charge_id` + `refunds.charge_id` (NOT NULL FK, zero índice — join de
  reconciliação do ledger no money-path); `customer_channels.customer_id` (fan-out inbound + DSR); child-FKs de
  `charges` (`appointment_id`/`customer_id`/`payment_account_id`/`service_id`/`professional_id`). Viola
  `backend-db.md`. Não pilot-blocking (1 org). — **2-3h** (uma migration CREATE INDEX). `[a/schema]`
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized`** `[carry]` — backend/ADR-020
  (message_templates + 2 enums + partial-uniq, aceita 2026-05-21) e backend/ADR-021 (priority-score fórmula +
  colunas + cron) **não materializadas** (`grep message_template db/`=NONE; `urgency_level`/`skip_count` ausentes).
  ADR-022 policy-json **está** materializada (4 jsonb cols, não-gap). — ADR-020 **4-6h**; ADR-021 **6-8h**.
  `[a; Marco-2/3]`

**Autonomia / rate-limit / onboarding (harness inerte no piloto) — CONFIRMADOS pelo agente calendar**

- **`domain-prometheus-metrics-not-registered`** `[carry]` — `shared/metrics.ts` (17 métricas) não registra os 4
  de §12.10 (`charges_succeeded_total`, `appointments_no_show_rate`, `executions_pending_approval_count`,
  `executions_timeout_total`; grep=0). `charges_succeeded`/no-show relevantes ao piloto. — **4h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` — `realtime/publish.ts:8-12` união fechada a
  `execution.*`/`waitlist.offered`; `appointment.created`(§8.3)/`charge.updated`(§8.4/§10.1) **nunca** emitidos →
  tela do profissional não auto-atualiza no agendar/pagar. — **3h**.
- **`rate-limit-§12.6-zero-routes-applied`** `[carry]` — plugin **Lua custom** (`src/plugins/rate-limit.ts`),
  **não** `@fastify/rate-limit` (que está no `package.json:37` mas **importado em lugar nenhum — dep morta**).
  Registrado mas `requireRateLimit` aplicado a **zero** rotas; webhooks públicos (stripe/metaapi/google/clerk) +
  login staff destravados; DEFAULT 600/60 ≠ canon 500/org. — **2-6h**.
- **`autonomy-patch-nontransactional-mode-audit`** `[carry]` — a desculpa do código ("no tx helper exists",
  `autonomy/repository.ts:66-67`) é **FALSA**: `.transaction(` usado em 7 sites; UPDATE (`:87-107`) + audit INSERT
  (`:111-123`) só guardados por `if(modeChanging)`, não tx → mudança de modo sem AuditEvent se o INSERT falha +
  lost-update. — **1-2h**.
- **`autonomy-action-granularity-and-readiness-score-dead`** `[carry]` — `resolver.ts:62` gateia só
  `current_mode`; `PolicyEvaluator`/`fetchOrgAutonomyPolicies` (`seams.ts:64,115`) com **zero** callers;
  `readiness_score` lido/retornado (`repository.ts:20,26`) nunca computado → `GET /autonomy` sempre null;
  auto-promoção §8.5 nunca dispara. Inerte no piloto. — **1h** (parar de expor) a **16-24h** (M2/M3).
- **`onboarding-advance-no-prereq-arbitrary-stage`** `[carry]` — `repository.ts:151-165 SET onboarding_stage` cru;
  `schemas.ts:37-49` aceita qualquer dos 11; `routes.ts:70-78` sem prereq/role; PRD §5.8 exige "≥1 professional
  ativo antes de services" + checklist (ausente). `ai_mode` **não** flipa → gap de state-integrity/UX, não bypass.
  Onboarding = Marco-1. — **3-5h**.

### BAIXO (higiene)

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recontagem: ~106 rotas / 80 paths / 95 ops / 0 phantom)**

- **`openapi-drift-undocumented-handlers`** `[carry]` — **11 handlers fora do YAML**: `GET/PATCH /autonomy`, `GET
  /channel-connections`, `GET /customers/{id}/export` (DSR), `GET/PATCH /payment-account/policy`, `GET
  /api/v1/realtime` (SSE), + 4 webhooks (`POST /webhooks/stripe`, `/stripe/platform`, `POST /webhooks/google`, `GET
  /webhooks/google/callback`). — **2-3h**. **#9.**
- **`openapi-missing-operationid`** `[carry]` **(v: CONFIRMADO — grep=0)** — `operationId`=**0** em 95 ops →
  `operations = Record<string, never>` (codegen degradado; visível no `openapi:check` de hoje). — **1-2h**.
- **`openapi-status-callback-missing-dead-letter`** `[carry]` **(v: CONFIRMADO — `yaml:298`)** — enum
  `[running,paused,cancelled]` sem `dead_letter` (código+canon+harness têm). — **0,25h**. **#9.**
- **`openapi-enum-drift-proposal-create-refund`** `[carry, CHANGED — precisado pelo route-reviewer]` — o **único**
  drift YAML↔código de `ExecutionProposal.action` é a **omissão de `create-refund`** (ação de dinheiro viva,
  `seams.ts:172`) no YAML (`yaml:324-330`); `waitlist-add` está em **ambos** código e YAML (07-20 imprecisamente
  chamou de "não-canon spurious"). O eixo **canon** (`waitlist-add` presente em código+YAML mas ausente do PRD
  l.1082) é o item de contrato harness `proposal-action-enum-superset-of-canon` (errata de canon), **não** um drift
  de YAML. — **0,25h**.
- **`charge-route-path-and-charge-type-drift`** `[carry, + sub-drift]` — `charge_type` request `[full,package]`
  (`yaml:2600,2927`) vs response `[deposit,full,package,adjustment]` (`yaml:2668`, DB CHECK `payments.ts:105`);
  `payment_method` request `[pix]` (`yaml:2602`) vs DB CHECK **8 valores** (`payments.ts:113`). **NOVO sub-drift
  (route-reviewer):** o 8º valor DB `payment_link` **não aparece em nenhum enum do YAML** (nem regular nem manual).
  Path org vs §5.6. — **1h**.
- **`error-envelope-dual-schema`** `[carry]` — `Error` (sem `request_id`) nos 4xx compartilhados; `ErrorEnvelope`
  (com `request_id`) só em 7 respostas de payments; runtime sempre emite `request_id`. — **0,5-1h**.
- **`sse-realtime-header-auth-and-query-contract`** `[carry, MÉDIO-funcional]` — `realtime/routes.ts:26 GET
  /api/v1/realtime` guardado por `requireClerkAuth` (header-only) → `EventSource` de browser não seta header →
  inconsumível; e não parseia `?scope`/`?conversation_id` vs canon §5.4 l.427/§10.1 (que usa `?token=`). — **2-4h**.
- **`rate-limit-429-undocumented`** `[carry]` — 429 emitido em runtime, 0 no YAML. — **0,25h**.
- **`metrics-endpoint-public`** `[carry]` — `GET /metrics` (`health/routes.ts:24`) sem `preHandler` → exposição
  Prometheus (cardinalidade org) publicamente alcançável se a porta vazar ao edge. — **0,25h**.
- **`payment-account-policy-triple-hygiene`** `[carry]` — `PATCH /payment-account/policy` (`payments/routes.ts:95`)
  simultaneamente (a) undoc no YAML, (b) role-ungated, (c) sem `Idempotency-Key`. — **0,5h**.

**Contrato harness (resíduos BAIXO + 5 misses novos — todos INERTES no piloto; harness undispatched)**

- **`status-meta-stripped-silently`** `[carry]` — `StatusCallbackSchema` (`schema.ts:15-17`) sem `.passthrough()`
  → strip de `failedReason`/`attemptsMade`/`action` do dead_letter (`bevox-callback.ts:139-147`). Benigno; perde
  forense quando o 404 for corrigido. — **0,25h**.
- **`complete-org-read-from-untrusted-body-no-tenant-check`** `[carry]` — `/complete` lê tenant do **body**
  (`harness-callbacks.routes.ts:150-154`, via `.passthrough()`) sem checar `=== existing.organization_id`
  (traces/stream usam a row — assimetria). Inalcançável na prática (harness omite org do `/complete`). — **0,5h**.
- **`workflow-strategy-code-ahead-of-canon`** `[carry]` — enum backend + harness têm `workflow` (`schema.ts:57-65`;
  `execution-handler.ts:1042`); PRD §10.4 l.1075 não lista → errata aditiva no canon (ADR-005). — **0,25h**.
- **`sentiment-enum-not-shared`** `[carry]` — backend exige `sentiment ∈ {6 valores}` (`schema.ts:51`, exato ao PRD
  l.1074); harness tipa `string` default `"neutral"` (`bevox-callback.ts:63-96`) → sentiment livre → 400. Latente
  (path default seguro). — **0,25h**.
- **`trace-content-field-dropped-on-persist`** `[NOVO]` **(v: agente harness)** — `harness-callbacks.repository.ts:
  194-205` mapeia `output_json ← e["output_json"]??e["output"]??null` e `step_name ← e["name"]??"unknown"`, mas o
  `TraceEntry` do harness carrega o payload em **`content`** (+`step`,`timestamp`, `bevox-callback.ts:40-45`) → o
  conteúdo de reasoning é silenciosamente descartado. **Compound:** `sendTrace` tem **zero callers** no harness →
  `/traces` é callback não-exercitado hoje; a perda é latente mas real quando ligar. — **1h**. `[xrepo]`
- **`harness-ignores-dispatched-callback-base-url`** `[NOVO]` **(v: agente harness)** — backend manda
  `callback_base_url` (`harness-dispatcher.ts:94`, canon PRD l.1040) mas harness hardcoda `BASE_URL =
  config.bevox.callbackBaseUrl` (`bevox-callback.ts:7`; schema aceita o campo `:636` mas nunca lê) → backend não
  consegue rotear callbacks; drift de config backend/harness misroteia todo callback sem superfície de erro. —
  **1h**. `[xrepo; ALTO-GA-ops]`
- **`harness-documents-false-complete-idempotency-dedup`** `[NOVO]` **(v: agente harness)** — comentário do harness
  (`bevox-callback.ts:9-14`) afirma "Backend de-duplica `/complete` com mesma chave" — **falso** (backend 409a um
  `/complete` retentado; sem key reader). Mascarado pelo `replied-marker` do harness (`execution-handler.ts:
  434-449`). Mentira de contrato latente. — **0,5h**. `[xrepo]`
- **`deadletter-overwrites-rejected-expired-underspecified`** `[NOVO]` **(v: agente harness)** —
  `markExecutionDeadLetter` exclui só `('done','cancelled','dead_letter')` (`harness-callbacks.repository.ts:90`) →
  flip `rejected`/`expired`→`dead_letter`; ADR-019 Amд1 l.176-195 é **silente** sobre esses. Latente/inalcançável;
  gap spec-vs-code (clarificação de 1 linha no canon). — **0,25h**. `[xrepo]`

**Auth / schema / channels (resíduos + misses novos) — CONFIRMADOS pelos agentes**

- **`impersonation-id-is-not-organization-id`** `[carry]` — `organization-scope.ts:57` retorna
  `req.staff.impersonation_id` como tenant org id, mas `auth/service.ts:135-138` seta a claim ao **PK da row
  `staff_impersonations`** (`repository.ts:153-160`). Latente/fail-closed (nenhuma rota pareia `requireStaff`+
  `requireOrganizationScope`). — **2-3h**.
- **`impersonation-audit-hook-encapsulation-scoped-to-auth-plugin`** `[carry, sharpened — efetivamente morto]` — o
  hook `onResponse` (`auth/routes.ts:70-87`) é adicionado **dentro** do plugin `authRoutes` (`:196`; contexto
  próprio) → nunca roda p/ staff-ops (`server.ts:213-215`); e mesmo dentro de authRoutes emite nada no fluxo normal
  (start sem `impersonation_id`; end fecha antes). staff-ops grava só `actorStaffId`, não `impersonation_id`
  (`actions.service.ts:43-59`) → ações cross-org sob impersonation **sem audit impersonation-linked**. Enfraquece
  ADR-013 "auditoria forte". — **1-2h**.
- **`clerk-jwt-no-aud-iss-validation`** `[carry]` — `clerk-auth.ts:89-92` verifica só `{algorithms:["RS256"],
  clockTolerance}`, sem `audience`/`issuer`; o `organization_id` confiável vem em claim não-verificada. Alg-confusion
  bloqueado, JWKS pinado (mitigantes; o staff-side É melhor — checa `audience`). — **1h**.
- **`staff-login-user-enumeration-timing-oracle`** `[carry]` — `auth/service.ts:68-83`: email desconhecido lança
  **antes** de qualquer bcrypt; conhecido roda bcrypt cost 12 → delta de tempo vaza existência de email staff; com
  ausência de rate-limit = enumeração trivial. — **0,5h** (dummy bcrypt na branch de miss).
- **`staff-session-no-logout-no-reuse-detection-no-cap`** `[carry]` — sem endpoint de logout/revoke; `loginStaff`
  insere refresh novo a cada login sem revogar anteriores → tokens concorrentes ilimitados; rotação sem alarme de
  reuso; expirados nunca podados. — **2-3h**.
- **`staff-metadata-cache-no-invalidation-stale-role-window`** `[NOVO]` **(v: agente RBAC)** —
  `auth/repository.ts:54-66,89-101` `findActiveStaffByEmail` é `cacheAside` TTL 300s; o próprio comentário
  (`:94-95`) manda invalidar em qualquer write de `role|active|full_name`, mas **nenhum writer/endpoint existe** →
  se um role/active mudar out-of-band, o `role` stale é servido no login e cravado num JWT novo por até 300s
  (janela de demotion-lag admin→observer). Inerte hoje. — **0,5h**. `[latent]`
- **`clerk-webhook-org-claim-fallback-cross-links-user-to-self`** `[NOVO]` **(v: agente RBAC)** —
  `auth/routes.ts:170` `orgClaim = ... : clerkUserId` fallback: um `user.created` sem org claim só ligaria o user a
  uma org se algum user existente já tivesse `clerk_user_id == este id` (impossível) → user first-time sem org
  claim silenciosamente **não** ganha org row (`if(organizationId)` `:172`) — no-op silencioso. Reforça
  provisionamento Clerk não-funcional e2e. — **fold no clerk-provisioning fix**.
- **`uuidv7-sql-default-missing-post-0000-tables`** `[carry]` **(v: CONFIRMADO — agente schema; 30 tabelas)** — só
  as 13 tabelas vivas de `0000` têm `SET DEFAULT gen_uuid_v7()`; **30 CREATE TABLE** de 0001+ não (grep
  `gen_uuid_v7` 0001-0020 = 0), contradizendo `_shared.ts`. Fail-closed (app supre via `$defaultFn`; INSERT cru
  omitindo id → NOT-NULL, nunca v4 ruim). Pura higiene/DX. — **2h**.
- **`appointments-customer-package-id-no-db-fk`** / **`customers-deleted-at-read-but-never-written`** `[carry]` —
  `calendar.ts:124 customer_package_id` sem `.references()` (mitigado por validação fail-closed `booking.ts:
  146-150`); `deleted_at` filtrado mas nunca escrito. — 0,5-3h.
- **`newopaqueid-uuidv4-landmine`** `[carry]` **(v: CONFIRMADO — 0 callers)** — `staff-auth.ts:139-140
  newOpaqueId(){return randomUUID()}` (UUIDv4, §4.7); **dead code** (grep: zero callers). — **0,25h**.
- **`charge-currency-unvalidated` / `idempotency-key-param-mismatch` / `provider-charge-id-no-unique`** `[carry]` —
  currency `z.string()` aceita "USD"; `repository.ts` reusa key ignorando body; `provider_charge_id` sem unique.
  Latentes (piloto BRL). — 0,5-2h.
- **`google-calendar-intl-transfer-customer-name-no-basis-gate`** `[NOVO]` **(v: agente LGPD)** —
  `calendar/google/sync.ts:203,237` empurra `summary = "${service} — ${full_name}"` (NOME do cliente) p/ Google
  Calendar (US = transferência intl) sem gate de consent/ai_opt_out; devs até removem `summary` dos logs
  (`workers.ts safeErrSummary`), provando ciência de PII, mas a transferência não tem gate de base legal.
  Provavelmente base contratual (menos clara que a do LLM). — **~2h**. `[xrepo: _shared/ADR-019]`
- **`payments-raw-payload-json-pii-residue`** `[NOVO]` **(v: agente LGPD)** — `payments/repository.ts:432-440`
  guarda o evento Stripe cru `raw_payload_json` (pode carregar `billing_details` nome/email/phone). Tem
  organization_id mas sem customer_id, sem retenção, omitido do DSR export. — **fold ADR-020**.
- **`redaction-paths-miss-actual-columns`** `[carry, CHANGED — de-escalado]` **(v: agente LGPD — leak ativo
  REFUTADO)** — `shared/redactors.ts:35-61` wildcards `*.phone`/`*.email` não casam `primary_phone`/`primary_email`/
  `notes_internal`/`fact_value`/`phone_number`/`handle`/`wa_id`/`content_text` (wildcard pino de 1 nível). **MAS**
  grep de todos os sinks de log **não acha statement que logue essas colunas** (só `payments/service.ts:921` loga
  chargeId+err) → é **rede-de-segurança latente**, não leak ativo (07-20 superestimou "vaza cleartext em INFO"). —
  **0,5h**. **BAIXO** (era MÉDIO).
- **`consent-and-preference-columns-entirely-dead`** `[carry]` — `consent_granted_at`/`preferences_json`/
  `risk_flags_json` (`customers.ts:45,48,49`) com **zero writers** → nenhum consentimento registrado. — **fold no
  ADR-019/consent**.
- **`calendar-hotpath-queries-not-organization-scoped`** `[NOVO]` **(v: agente calendar; mitigado)** —
  `availability.ts:116,128-130,167-171` + `booking.ts:227-230` filtram por `professional_id` só, **sem**
  `organization_id` (org-scope só nas leituras de calendar `:72,78`). Mitigado (professional_id é org-derivado, UUID
  sem colisão) mas viola CLAUDE.md §5 "toda query scoped por organization_id". — **0,5h**.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04; re-confirmada)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: CONFIRMADO)** — `merge-base --is-ancestor
  dbd231e v1.0.1` = **FALSE**; `v1.0.1`=`9a88116` (06-01); **22 commits** `v1.0.1..dbd231e` fora (incl. fixes de
  segurança + dispatch amendment); `release.yml:5` dispara só em tags `v*.*.*` → **nenhuma imagem (SemVer OU sha)
  para pós-`v1.0.1`**. Além disso versão diverge **4-way**: `package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1`
  / hub placeholder `vX.Y.Z`. — **0,5-1h** (cortar tag). **#7-alt.** `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: CONFIRMADO)** — re-confirmadas: `CLAUDE.md §8` diz seed grava
  `PILOTSEEDONLYNOTASECRET` (real gera base32 + bloqueia — `mfa.ts:35`); `CLAUDE.md:170` "migrator não copia src/"
  **FIXO**; `resolve-organization-id.ts` citado em 5+ lugares (`backend-tenancy.md`, `backend-routes.md`,
  `README.md:84`, agent architect, hook) **NÃO existe** (verificado — deletado); `README §"Identidade de tenant"`
  afirma que 2 bridge files referenciam `workspace_id` — **ambos limpos/ausentes** (`harness-dispatch.schema.ts`
  sem `workspace`; `resolve-organization-id.ts` inexistente); `backend-tests.md` cita "5 falhas FK #36" (suíte
  passa 92/93); `backend-harness-contract.md` diz `dead_letter` via `worker.on('failed')` (**errado** — é via
  `PATCH /status`) + localiza callbacks em `modules/executions/` (vivem em `src/integration/`) + afirma
  persistência de `Idempotency-Key` em callbacks (**REFUTADO**) + lista `account_denied_tools` como campo do
  payload (canon não tem); `backend-db.md` diz `on delete restrict` (código+canon = **cascade**). — 0,3-0,5h/ea.
- **`rule-backend-routes-staff-role-and-adr-miscite`** `[NOVO]` **(v: agente RBAC)** — `.claude/rules/backend-
  routes.md` declara staff roles como `bevox_admin | support | observer (canon: ADR-022 staff RBAC)` + exemplo
  `requireRole(['bevox_admin','support'])`: triple-errado — nomes curtos `support`/`observer` (canon é
  `bevox_support`/`bevox_observer`), citação errada (staff RBAC = **backend/ADR-013**, não ADR-022), e invoca o
  inexistente `requireRole`. Código correto; a rule que guia autores de rota futuros não. — **0,25h**.
- **`codeql-upload-never-noop`** / **`release-no-provenance-sbom`** `[carry]` — `codeql.yml:26 upload:never` →
  SARIF nunca chega à aba Security; `release.yml` sem `provenance:`/`sbom:`/cosign. — 0,2-1h.
- **`adr-number-collision-cross-namespace`** `[carry, INFO]` — `backend/` e `_shared/` colidem em 008-023; config
  cita sem qualificar. — **1h**.
- **`stray-gap-workflow-js-scratch-accumulation`** `[carry]` — 5 `.claude/state/gap*.js` (0704/0709/0714/0715/
  0717) gitignored (`.gitignore:57`) → **zero impacto em CI**; só fazem o `pnpm lint` **local** dar RED. Esta
  sessão NÃO adicionou nenhum (usou Agent tool, não Workflow; logs em `.claude/state/ci-2026-07-21/`). — **0,1h**
  (`rm`).

### INFO / conformidades verificadas / não-gaps

- **`legacy-lexicon-clean`** **(v: CONFIRMADO)** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/
  `db/`: executável **ZERO** (232 matches = compostos sancionados `external_account_id`/`payment_account_id`/
  `channel_account_id`, alias `AS account_id` de `payment_accounts` remapeado p/ `accountId`, `chatwoot_account_id`
  em snapshots congelados, + doc-comments explicando o rename). `resolve-organization-id.ts` **deletado**;
  `harness-dispatch.schema.ts` sem `workspace`.
- **`mfa-sentinel-correctly-inert`** **(v: CONFIRMADO)** — `seed-pilot.ts:153-154` `generateMfaSecret()` (base32) +
  `assertMfaSecretNotPlaceholder()`; `mfa.ts:34-42` blocklist inclui `pilotseedonlynotasecret`; `auth/service.ts:
  84-89` sem MFA check (correto — TOTP é Marco-3 §16.3/ADR-013). **NÃO implementar "rejeitar sentinel no login".**
- **`four-callbacks-token-gated`** **(v: CONFIRMADO)** — `/status`(PATCH, inline preHandler), `/traces`/`/stream`/
  `/complete`(POST, `requireExecutionToken`), todos → 401 em token inválido (`execution-token.ts:65,69`).
- **`idempotency-on-callbacks-REFUTED`** **(v: CONFIRMADO)** — o backend **não** persiste `Idempotency-Key` em
  status/complete (sem `requireIdempotency` nessas rotas); é máquina-de-estado (`lockForCompletion`→409). O harness
  até **manda** `completeKey` em todo `/complete` (`bevox-callback.ts:26,155`); o backend a **ignora**. ADR-015
  governa os tools de mutação (trilha de proposals). `/complete` retentado = **409, não 200 idempotente**.
- **`dispatch-amendment-faithful-to-canon`** **(v: CONFIRMADO — bidirecional)** — `deadline_ms`/
  `original_execution_id`/`dead_letter` (`harness-dispatch.schema.ts:58,62,16`) byte-faithful ao canon (PRD l.
  1069-1157 + backend/ADR-019 Amд1); lado de leitura do harness landed (`execution-handler.ts:698,684,1348`). **Não
  é fork.** Caveat: harness ignora `callback_base_url` (usa env) → ver miss acima.
- **`hmac-verification-correct`** **(v: CONFIRMADO — Security Engineer)** — `channels/metaapi/service.ts` casa o
  signer do meta-api (`${t}.${rawBody}`, SHA256 hex, `t=,v1=`, ±300s, `timingSafeEqual`). Sem gap.
- **`payments-conformidades`** **(v: CONFIRMADO — Security Engineer)** — PCI-nil (grep `pan|cvc|cvv|card_number`=0);
  decimal-safe `numeric(10,2)`; webhooks dedupe-aware (`recordWebhookEvent`); over-refund replay-safe; cross-tenant
  paid-flip impossível (org só de row DB, `webhook-platform.ts`); refund deferrals aceitos (ADR-018); ambos
  webhook-secrets `requiredInProd`.
- **`staff-rbac-3-roles-conformant`** **(v: CONFIRMADO — agente RBAC)** — `staff-auth.ts:33 STAFF_ROLES` =
  exatamente `bevox_admin|bevox_support|bevox_observer` (ADR-013 l.108); `requireStaff({roles})` 403; JWT staff
  HS256 aud `bevox-backend-staff` distinto do Clerk RS256; observer excluído de impersonation + de staff-ops
  actions, incluído em staff-ops reads.
- **`schema-conformances`** **(v: CONFIRMADO — agente schema)** — `ON DELETE cascade` p/ `organization_id` é
  **canon-correto** (§11.2 l.1147; a rule `backend-db.md` "restrict" é que está stale); timestamptz everywhere;
  CHECK constraints presentes (`end_at>start_at`, `sessions_remaining>=0`, `confidence∈[0,1]`); uniqueness §16
  presente; backend/ADR-022 (policy-json, 4 jsonb cols) materializada.
- **`openapi-auth-and-callback-fields-mirror-code`** **(v: CONFIRMADO — route-reviewer; refuta over-read)** — o
  YAML **espelha fielmente** o código em vários eixos que NÃO são drift: `securitySchemes` definidos (`yaml:62-95`:
  clerk/staff bearer + `executionToken` apiKey `X-Execution-Token` + `IdempotencyKey`); os **4 callbacks harness
  carregam `security:[{executionToken:[]}]`** (`yaml:1826/1852/1877/1903`) casando `requireExecutionToken()`;
  `mark-paid/expire/connect/PATCH-policy` **sem** `IdempotencyKey`-ref no YAML **e** sem `requireIdempotency` no
  código (o gap de idempotência é **segurança**, não drift-b); `/complete` `strategy` enum + `sentiment` (6) são
  **byte-idênticos** YAML↔código; `ExecutionStatusCallback.meta` ausente em ambos. Dos 5 campos de callback só 2
  driftam (status enum, action enum). `pnpm openapi:check` = **GREEN** (regenera `src/types/api.ts` limpo).
- **`accepted-adrs-materialized-except-2`** — ADRs backend 008-023 aceitas todas materializadas **exceto** ADR-020
  (message_templates) e ADR-021 (priority_score). backend/ADR-016 é `proposed` (token-metering — corretamente NÃO
  implementada).
- **`todo-fixme-debt-sweep-marco23-only`** **(v: CONFIRMADO)** — sweep `src/`+`db/`: **0** FIXME/HACK/XXX; 1
  `@deprecated` (`orchestration/repository.ts:348`); TODOs todos Marco-2/3. Zero dívida pilot-blocking.
- **`appointments-source-check-drift`** **(v: REFUTED-on-inspection — agente calendar)** — candidato a miss
  investigado e **descartado**: `calendar.ts:158` permite 4 valores; migrations `0009:83`+`0010:27` DROP+re-ADD o
  CHECK ao conjunto pleno → `source:"waitlist"` válido. **Não é finding** (reportado p/ não super-ler o inventário).

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros somam ≈ 5-6h** e destravam o
runtime do piloto + os 2 jobs de CI vermelhos.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Seedar Calendar default + grade `professional_schedules` (Seg-Sex) no `seed-pilot`** | **2-3h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) **+ `closeDb()/closeRedis()` no `afterAll`** | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | `pnpm audit`: bump OTel sob nota ADR-012 + `pnpm override` undici/tmp/vite | **2-3h** | Destrava o job `Security` (**15 highs**, ~9 prod-runtime) — completa "CI verde"; **piorou vs 07-20** |
| 4 | **Provisionar principal Clerk do piloto** (usuário + JWT-template com `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado não autentica no calendar (gate upstream dos CRÍTICOs) |
| 5 | **Gatear `insertPayment` no rows-affected de `markChargePaid`** (fecha o orphan-paid manual, todos os 3 casos) | **2h** | Fecha o único bug HIGH de dinheiro alcançável no money-path manual do piloto |
| 6 | **Inicializar telemetria no worker** (`import instrument` + `initTelemetry()` em `queue/index.ts`) + subir `/metrics` no worker | **1-2h** | Fecha o buraco-negro **triplo** (Sentry/OTel/Prometheus) de TODA a metade assíncrona que o piloto roda |
| 7 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e | **3-4h** | **CRÍTICO quando a IA/staff-approve ligar**: faz a resposta chegar ao cliente |
| 8 | **`.min(32)` no `STAFF_JWT_SECRET`** + montar `requireRateLimit` no `/staff/sessions[/refresh]` | **~3,5h** | Fecha o buraco de auth mais duro (admin forjável) + brute-force do admin semeado |
| 9 | **Reconciliar versão** (cortar tag SemVer capturando os 22 commits) + **`reconcile-cron` chamar `applyChargePaid/Refunded`** | **3-4h** | Hoje nenhuma imagem contém os fixes pós-`v1.0.1`; fecha a rede de webhook-perdido |
| 10 | **Aplicar gate `ai_opt_out` em `cutoff.ts`/dispatch** + escopar `received_events`/`message_records` p/ DSR + hidratar export | **6-10h** | LGPD (piloto roda com PII real; hoje o flag é ignorado + PII cru não-apagável) |
| — | Higiene batch: `GET /appointments`; docs stale (§8/bridge/rule dead_letter/db-restrict/rule-ADR-022); `newOpaqueId`→v7; `rm .claude/state/gap*.js`; `operationId`+enums OpenAPI via `pnpm openapi:types`; índices FK (uma migration) | **~8h** | "Ver agenda" + governança + drift de contrato + perf GA |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status` POST vs PATCH 404**: o harness POSTa
  `/status` a uma rota PATCH-only → 404; o **backend é canon-correto** (PATCH), o **harness+PRD-l.447** é que estão
  stale → fix cross-repo (harness→PATCH) + errata canon. Também: `aborted_*`→400 (bug harness),
  `strategy='failed'`→não-`error` (bug backend), skills-allowlist vazio, `trace content` descartado no persist,
  `callback_base_url` ignorado. Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` no fio
  (`messages/schemas.ts:7`) confirma que `wa`/`ig` do backend é a causa do drop de outbound (e o próprio outbound do
  backend é auto-inconsistente); retries de webhook (<24h) amplificam a perda de inbound (dedupe-strand +
  null-tenant-500).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de
  um principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona; o webhook só fill
  `req.user` (fail-open), não a claim que o scope-guard lê.
- **Stripe** — Pix exige Connect KYC `active`; conciliação depende de **dois** endpoints (ambos `requiredInProd`)
  vs ADR-014 (um); refund manual não passa por webhook. Escape do piloto: manual-mode. **MCP `stripe` requer auth
  interativa — indisponível nesta sessão headless** (reportado; não bloqueante para auditoria de código).
- **canon (ADRs aceitas não-implementadas / drifts)** — backend/ADR-020 (MessageTemplate), backend/ADR-021
  (priority-score); _shared/ADR-019 (bases legais → gate consent é código local), _shared/ADR-020 (retenção →
  message_records/received_events scoping, retention worker, DSR deletion, denorm-snapshot erasure). Drifts
  "canon-atrás-do-código" (webhook §10.3 unificado, `strategy='workflow'`, `payment_method` 8-valores, `aborted_*`,
  `/status` POST↔PATCH l.447, `proposal.action waitlist-add`) → errata/ADR superseding **no canon** (ADR-005), não
  fork local.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1` (sem os
  22 commits); runbook go-live invoca `seed-pilot` (que não cria grade nem principal Clerk — CRÍTICOs + gate auth).
- **delivery-tracker (categoria h)** — slot backend = **10 delivered + 1 parked** (aisuggestion, staff-rbac,
  m4-chatwoot-p1..p4, m5-p4-manual-payment, m5-p3c-multimedia-consume, m5-p3a/b; `backend-psp-br-secondary`
  **parked** → Marco 6). **Nenhum work-item** para calendar (ADR-010), customer-identity (ADR-009),
  message-templates (ADR-020), priority-score (ADR-021) → o defeito da grade (sob ADR-010) é **invisível ao
  tracker**. `m5-p3c` auto-declara "5 gates LGPD pendentes / não-ready-for-prod". **Veredicto: "delivered" ≠
  pilot-ready** (o tracker mede presença-de-código por grep). Usar esta auditoria como o gate.

## Delta vs auditoria anterior (2026-07-20)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD --
src/ db/` **vazio** e `HEAD` = o commit do próprio audit 07-20. **0 refutações de achados de código** — todos
re-confirmados com evidência fresca por 7 domínios independentes + verificação de fonte-primária do orquestrador.

**Mudança de conclusão / de-escalação (1):**
- **`redaction-paths-miss-actual-columns` → CHANGED (de-escalado MÉDIO→BAIXO)**: o mismatch de path é real, mas o
  agente LGPD **refutou** o framing de "vaza cleartext em log INFO" — grep de todos os sinks de log não acha
  statement que logue essas colunas → é **rede-de-segurança latente**, não leak ativo. (07-20 tinha "afiado" p/
  MÉDIO.)

**Mudança de ground-truth (1, mensurável):**
- **`ci-security` PIOROU**: `pnpm audit --audit-level high` = **33 vulns / 15 high** hoje vs **27 / 12 high** no
  07-20 (**+6 total, +3 high**) — deriva composicional real sobre o lockfile congelado (advisories novos
  publicados; ex.: undici/js-yaml). Prova de que a dívida de segurança **cresce mesmo sem mudar código**.

**Novo / afiado este ciclo (~19, BAIXO/MÉDIO — inventário agora ~122 achados distintos):**
- **Pagamentos:** `manual-remark orphan` **broadened ×2** (dispara `confirmAppointmentIfUnconfirmed`+grant de pacote
  no no-op = corrupção de estado, não só payment fantasma; root-cause compartilhado alcança o path Stripe também);
  `reconcile-cron-flips-cancelled-without-orchestration` (MÉDIO, novo); `seed-pilot-creates-no-payment-account`
  (MÉDIO — 4º gate do money-path do piloto). Nuance INFO: o double-count é latente (nenhum SUM interno de `paid`).
- **LGPD:** `received-events-raw-payload-unscoped-un-erasable` (MÉDIO — **o mais forte; miss das 6 passadas + do
  07-20**: sink de PII cru tenant-unscoped e não-apagável); `google-calendar-intl-transfer-name-no-basis-gate`
  (BAIXO); `payments-raw-payload-json-pii-residue` (BAIXO).
- **Observabilidade:** `worker-process-has-no-metrics-scrape-endpoint` (MÉDIO — 3º pilar morto: worker cego a
  Sentry+OTel+Prometheus).
- **Agenda:** `availability-n1-count-plus-92day-serial-loop-unbounded` (MÉDIO — DoS/latência GA);
  `calendar-hotpath-queries-not-organization-scoped` (BAIXO).
- **Harness:** `trace-content-field-dropped-on-persist`, `harness-ignores-dispatched-callback-base-url`,
  `harness-documents-false-complete-idempotency-dedup`, `proposal-action-enum-superset-of-canon`,
  `deadletter-overwrites-rejected-expired-underspecified` (5× BAIXO/latente).
- **Auth:** `staff-metadata-cache-no-invalidation-stale-role-window`, `clerk-webhook-org-claim-fallback` (2×
  BAIXO/latente).
- **Schema/índice:** `payments/refunds-charge-id-unindexed`, `customer-channels-customer-id-unindexed`,
  `charges-child-fks-unindexed` (3× índices no money/fan-out path, além das 6 core tables).
- **Governança:** `rule-backend-routes-staff-role-and-adr-miscite` (BAIXO — a rule cita ADR-022 p/ staff RBAC;
  correto é ADR-013).
- **OpenAPI (route-reviewer):** counts 07-20 **integralmente reproduzidos** (106/80/95/0/11/0, `openapi:check`
  GREEN); sharpenings: `create-refund` é o único drift YAML↔código de proposal (não `waitlist-add`); DB
  `payment_link` (8º payment_method) undoc; **3 refutações-de-escopo** (auth de callback, idempotência de dinheiro
  e strategy/sentiment de `/complete` são **consistentes** YAML↔código — não são drift-b) → ver conformance
  `openapi-auth-and-callback-fields-mirror-code`.
- **Refutado-on-inspection (não-finding):** `appointments-source-check-drift` (migrations 0009/0010 convergem o
  CHECK).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (ALTO);
`manual-remark orphan` (ALTO); `rbac-org-role`; `clerk-provisioning`; os mismatches de `/complete`;
`reconcile-cron-*`; toda a bateria LGPD; autonomia/observabilidade; priority-score/reminders/templates
Marco-2/3; e a staleness `.claude`/CLAUDE.md/README.

**Arco desde a passada mais antiga (06-02):** os 3 CRÍTICOs originais (resposta-nunca-chega-ao-WhatsApp via
telefone-não-persistido; seed-pilot-inexecutável-em-prod; zero-testes-de-booking) foram **fechados/
recaracterizados** (Dockerfile `COPY src` fixo; existe `calendar-booking.test.ts` [8 testes]; o drop de outbound
migrou para o `vocab-mismatch` ALTO). Os 2 CRÍTICOs atuais (grade + calendar no seed) emergiram ~06-23 e
**persistem** há ~4 semanas de congelamento; o gate auth-actor foi isolado no 07-20 e re-confirmado. **A frente de
CRÍTICOs rotacionou por completo; o conjunto atual está estável e sem correção há um mês.**

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background), cada um instruído a **re-verificar de
fonte-primária** o inventário do 07-20 do seu domínio contra o **código atual** com evidência fresca `file:linha`,
a **REFUTAR** o que estivesse superestimado, e a caçar misses. **4 usaram agent-types locais** deste repo:
`harness-callback-auditor` (contrato l), `backend-route-reviewer` (b), `backend-staff-rbac-reviewer` (auth),
`backend-schema-migration-engineer` (schema/índices g-schema); **Security Engineer** (payments j + channels k); **2
general-purpose** (LGPD g; calendar/pilot a+m + autonomia/obs). Cada agente entregou lista estruturada com veredicto
(CONFIRMED/REFUTED/CHANGED/NEW) + severidade (calibrada ao piloto) + esforço + `file:linha`.

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD
-- src/ db/` = vazio); writer de `professional_schedules` (grep exaustivo — só fixture de teste); `seed-pilot.ts`
inserts (só 4, sem calendar/grade; `db/seed.ts` idem); auth-gate (calendar `requireClerkAuth` RS256 vs staff HS256,
`grep requireStaff calendar/` = NONE); money-bug (`applyChargePaid`→`insertPayment` incondicional vs `markChargePaid`
guardado, lido linha-a-linha); vocab cross-repo (backend `normalize.ts` "wa"/"ig" + outbound null-coerce vs meta-api
`origin/main` enum pleno); worker-telemetry (`grep instrument queue/index.ts` = NONE, só `src/index.ts:17,30`);
léxico legado (grep = zero executável); MFA sentinel (`mfa.ts:35` blocklist); OpenAPI counts (`operationId`=0, 80
paths/95 ops, ~106 rotas); tracker (10 delivered + 1 parked); milestones §16 + surface §10.1 + §5.3
(WeeklySchedule) do PRD frozen; version-drift (`merge-base --is-ancestor dbd231e v1.0.1` = FALSE, 22 commits).

**Ground-truth de CI rodado de fato** (2026-07-21 ~09:05–09:07 UTC, não inferido; logs em
`.claude/state/ci-2026-07-21/`): Typecheck/Format/OpenAPI/Build/Unit(**469/469, 69 files**) = **GREEN**;
`test:integration` = **RED exit 1** (`1 failed | 92 passed (93)`, flaky `booking_notice` `:259` [09:06 UTC < 13:00]
+ teardown 57P01); `pnpm audit --audit-level high` = **RED exit 1, 15 high / 33 total** (`3 low | 15 moderate | 15
high`); `lint` = **RED por artefato local** (5 `.claude/state/gap*.js` gitignored, ausentes em checkout limpo → CI
GREEN — `git check-ignore` confirmou os 5).

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree @ 06-02 mas **`origin/main`
@ `7874971` (06-03)** — a passada leu `origin/main` para o PRD/ADR-019 (a #62 dispatch-amendment só existe lá).
Numeração de ADR **colide** entre namespaces backend/_shared — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem (vocab de canal e
POST/PATCH 404 viram CRÍTICO). (2) OSV Scanner / CodeQL não reproduzíveis offline (config lida: `codeql.yml
upload:never` = no-op; `security.yml` OSV roda em CI). (3) Caminho live (Stripe/Clerk/harness/Meta reais) não
exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de
writers/endpoints + CI rodado. (4) MCP `stripe` + `claude.ai Google Drive` requerem auth interativa —
**indisponíveis** nesta sessão headless (reportado; não bloqueante para auditoria de código). (5) Esta passada é
re-verificação sobre código byte-idêntico ao do 07-20; o valor incremental é **confirmação independente de
fonte-primária + CI fresco (Security-RED pior) + ~15 misses/afinamentos + 1 de-escalação**, não descoberta de
regressão (não houve mudança de código a regredir).

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-07-21. Sem alteração de código de
produto; somente este relatório. Revisão humana pendente.*
