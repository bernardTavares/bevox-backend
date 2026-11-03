# Gap Analysis — bevox-backend — 2026-07-19

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo
> segundo a documentação canônica (PRD V1 + ADRs **aceitas**, lidas de `origin/main`), calibrado ao gate do
> **piloto** (1º cliente real: login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA**.
> Método: **10 auditores de domínio em paralelo** (cada um re-verificando os achados do 07-07 contra o código
> **atual** com evidência fresca `file:linha`, caçando gaps novos e lendo canon de `origin/main`) +
> **verificação adversarial** independente do orquestrador nos achados-manchete NOVOS + **CI rodado de fato**
> (não inferido, 2026-07-19 ~09:06–09:13 UTC). Sucede `runtime-gap-audit-2026-07-07.md`.

## Resumo executivo

**O backend continua maduro como fundação e a um passo curto do piloto, mas não pronto — e esta passada
_refuta três conclusões "fechadas" das auditorias anteriores._** Fato estrutural que domina a passada:
**código de produto, canon e os dois vizinhos estão TODOS congelados desde 06-03.** `git diff
dbd231e..HEAD -- src/ db/` é **vazio**; canon `bevox-knowledge` `origin/main` @ `7874971` (06-03),
`bevox-harness` `origin/main` @ `2979eb0` (06-03) e `bevox-meta-api` `origin/main` @ `5516c2a` (06-22) —
inalterados vs. baseline 07-07. Logo esta é **re-verificação independente + ground-truth de CI fresco + caça
a gaps que as 5 passadas anteriores perderam** — não novos gaps de código. Mesmo assim os 10 auditores
isolaram **~30 achados NOVOS** (incl. 1 ALTO cross-repo de alto impacto) e **3 refutações de conclusões
anteriores**, com 2 refutações adversariais próprias (timezone, HMAC) — o inventário é sólido e agora conta
**~95 achados distintos** (2 CRÍTICO · 7 ALTO · ~34 MÉDIO · ~40 BAIXO · ~12 INFO/conformidade).

**O piloto morre no passo 2/3 (`ver agenda` / `agendar`) — CRÍTICO duro, re-confirmado por 3 vias** (auditor
de domínio + verificação manual do orquestrador + grep exaustivo): **nenhum caminho de produção escreve
`professional_schedules`** (a grade semanal-base). Único `INSERT` em `src/ scripts/ db/ test/` = fixture de
teste (`calendar-booking.test.ts:120`); produção só **lê** (`availability.ts:116`) e `:126 if (!sched)
continue` esvazia todo dia → `booking.ts:207 slot_conflict` em **100%** dos agendamentos. Co-bloqueador:
`seed-pilot.ts` insere só org/staff/professional/service (`:110/:157/:195/:217`) — zero `calendars`, zero
grade → `availability.ts:75 notFound("Calendar")` quebra "ver agenda" antes mesmo da grade. **Fix mínimo ≈
2-3h** (seedar Calendar + grade Seg-Sex). *Refinamento vs 07-07:* a omissão de `system_holidays` é
**fail-open** (`availability.ts:108-111`), **não** co-bloqueadora — 07-07 a superestimou.

**"CI verde" — o único critério mensurável de Marco-1 (§16.1) — está RED em 2 jobs** (ground-truth rodado
09:06–09:13 UTC): **Tests RED** (`ci.yml` job `Tests` roda **`pnpm test` + `pnpm test:integration` sem
`continue-on-error`** — correção vs 07-07, que ecoou a rule stale "ci.yml = unit-only"; falha =
`calendar-booking.test.ts:259` flaky `booking_notice` dependente de hora-do-dia [rodou 09:12 UTC < ~13:00 UTC
threshold] + teardown 57P01 sem `closeDb/closeRedis`; `1 failed | 92 passed`) e **Security RED** (`pnpm audit
--audit-level high`, `continue-on-error:false` → **12 high / 27 total**; ~7 highs prod-runtime OTel/grpc/
protobufjs). Typecheck/Format/OpenAPI/Build/Unit = **GREEN**. O **`lint`-RED é artefato local**: 5 arquivos
`.claude/state/gap{0704,0709,0714,0715,0717}.js` (sobras de sessões de auditoria, +1 por sessão) que o ESLint
parseia, **todos gitignored** (`.gitignore:57`, `.claude/state/*`) → um checkout limpo de CI **não os vê** →
**CI lint GREEN**.

**Delta-manchete (NOVO, refuta "fechado"): `harness-status-callbacks-post-vs-patch-404`.** O harness envia
**todos** os callbacks `/status` via **POST** (`bevox-callback.ts:28 method:"POST"`, `:140`), mas o backend
registra **só** `app.patch("/api/v1/executions/:id/status")` (`harness-callbacks.routes.ts:56`) — Fastify →
**404**. Isso mata **todos** os status callbacks, inclusive o `dead_letter` autoritativo (harness
`bullmq-consumer.ts:155`), **refutando** a conclusão 07-05/07-07 de que a dependência cross-repo `dead_letter`
estava "FECHADA / exercitável ponta-a-ponta" — o harness **emite**, mas o backend **não recebe** (método
errado). Causa-raiz: **canon auto-contraditório** (PRD §Módulo-10 l.447 diz POST; walkthrough l.817 +
amendment l.1076 + backend/ADR-019 Amд1 dizem PATCH). Calibrado **ALTO** (harness inerte no piloto
staff-manual), CRÍTICO para a integração harness/GA. Verificado manualmente pelo orquestrador (não só pelo
agente).

**Refutações adicionais de deflações anteriores:** (a) o `version-drift` "deploy por digest `type=sha`
possível" (07-07) está **REFUTADO** — `release.yml:5` dispara **só** em tags `v*.*.*`, e `type=sha` é emitido
no **mesmo** trigger de tag → **nenhuma imagem de CI (SemVer OU sha) existe para qualquer commit pós-`v1.0.1`**
(que é `9a88116`, 06-01; PRs #18–#39 incl. fixes de segurança #22/#27/#31 estão todos fora de qualquer
imagem). (b) O "bug conhecido" do `CLAUDE.md §8` — "stage `migrator` não copia `src/` → `seed-pilot` falha" —
está **FIXO/stale**: `Dockerfile:69 COPY … src ./src` (PR #18); 3 docs descrevem um bug já fechado.

**Bloqueador de produto latente (CRÍTICO quando a IA/outbound ligar):** o mismatch de vocab de canal
`wa`/`ig` (inbound) vs `whatsapp`/`instagram` (outbound) **sobrevive** e agora é **alcançável NO piloto** via
staff-approve (`executions/service.ts:68`), não só autônomo → resposta computada e **descartada em silêncio**
(`seams.ts:376 skipped_missing_recipient`, audita como skip, **não erro** → invisível). `bevox-meta-api`
(`origin/main`) exige enum pleno no fio (`schemas.ts:7 z.enum(["whatsapp","instagram"])`) — confirma que
`wa`/`ig` é invenção 100% backend.

**Caminho de fechamento do piloto curto:** os 2 blockers de agenda (≈ 2-3h) + o gate de CI (flaky+teardown ≈
0,5h; audit bump ≈ 2h) somam **≈ 5-6h** para destravar o runtime do piloto + o critério "CI verde". O money-
path manual (o do piloto) **funciona**, com 1 bug novo alcançável (remark-após-refund insere payment órfão).
Severidades ancoradas no gate do **piloto**; para GA vários ALTO/MÉDIO sobem (vocab de canal e POST/PATCH 404
viram CRÍTICO).

---

## Calibração canônica (lida de `origin/main` pelo orquestrador)

Correção de precisão que reenquadra a auditoria e ajusta o 07-07:

- **§16.1 Marco-1** ("Pronto para integração") = repo + **CI verde** + migrations pg16 + módulos
  **auth/organizations/users/professionals/services/customers** + **OpenAPI publicado** + contrato harness
  documentado+testado com stub + deploy staging. **Calendar e Payments NÃO estão aqui.**
- **§16.2 Marco-2** = **calendar**, conversations, messages, channels, ai-pipeline, autonomia; fluxos 1/2/3
  e2e; métricas Prometheus; cobertura ≥70%.
- **§16.3 Marco-3** = **payments (Stripe Connect)**, reminders, faq, rules, audit, observabilidade; WhatsApp
  direto; circuit breaker; **LGPD DSR/retenção/consentimento**; **MFA TOTP**; SLO.
- **⇒ "Marco-1 concluído?" ≠ "piloto-pronto?".** Marco-1 exige só CI-verde + CRUD core + OpenAPI + contrato
  harness (o bloqueador de Marco-1 é **CI-verde**, RED). O **piloto** exige calendar (§16.2) + payments
  (§16.3) **funcionando** — por isso o gap de grade é **Marco-2-por-rótulo mas pilot-blocking** (o piloto
  exercita agendar). 07-07 chamou a grade de "Marco-1 explícito" — impreciso; é Marco-2 **in-scope**
  (tracker-delivered + pilot-exercised), não deferimento legítimo.
- §5.3 confirma rotas canônicas: `GET /calendars/:id/availability`, `POST /calendars/:id/appointments`,
  `PATCH /appointments/:id`. §5.6 confirma `POST /appointments/:id/charges` (mas a lista de superfície l.1006
  diz `POST /organizations/:oid/charges` — **PRD auto-inconsistente**; o código casa a forma l.1006) e **um
  único** webhook `/api/v1/webhooks/stripe`. §5.6 fixa o **Manual Payment Mode (ADR-023, delivered) como o
  money-path do piloto**; Stripe Connect (ADR-014) é **repurposado para assinatura SaaS org→Bevox** (split de
  cliente deferido) — logo gaps de split Stripe são deferimentos legítimos, não pilot-blocking.

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora |
|---|-----------|-----------|---------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO); `no-appointments-read-endpoint` (NOVO ALTO); onboarding-guard; reminders/templates/faq/priority-score (M2/M3) |
| b | OpenAPI vs rotas | ✅ | **106 rotas Fastify / 80 paths / 95 ops**; 11 handlers fora do YAML; **0 phantom**; **0 operationId** |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO**; só compostos Stripe/canal sancionados + doc-comments; invariante §4.1 mantida |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ | seed gera base32 + bloqueia sentinel; login não rejeita = **correto** (Marco-3); `CLAUDE.md §8` stale |
| e | Testes faltando (hot paths) | ✅ | availability(rota)/reschedule/webhook Stripe/inbound-vocab — zero e2e (o vácuo que escondeu o CRÍTICO) |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep: **0** FIXME/HACK/XXX; 1 `@deprecated`; TODOs todos Marco-2/3 |
| g | LGPD | ✅ | `ai_opt_out` armazenado-não-aplicado (vetor vivo); DSR/retenção ausentes; `message_records` sem escopo; **2 sinks de PII novos** |
| h | Marco-1 tracker × código | ✅ | 11 work-items (10 delivered/1 parked); **"delivered" ≠ pilot-ready**; ADRs fundacionais sem work-item |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky+teardown; ci.yml **roda** integração) + Security RED (12 high); lint-RED = artefato local |
| j | Charges + Connect (PCI) | ✅ | manual-mode funciona; reconcile-cron cru; webhook zero-teste; PCI-nil; Connect repurposado p/ SaaS |
| k | Channels (metaapi) | ✅ | vocab-drop; **2 caminhos de perda-de-inbound**; `status_updated` sem handler; HMAC **correto** |
| l | Harness dispatch | ✅ | **`POST/PATCH 404` (NOVO ALTO, refuta "closed")**; `/complete` failed/aborted mismatches; skills-allowlist vazio |
| m | Alçapões do piloto | ✅ (traçado) | morre no passo 2/3; money-path manual OK (1 bug novo); harness POST/PATCH degrada quando ligar |
| n | Delta vs audit anterior | ✅ | 07-07 re-verificado; ~30 NOVOS; **3 refutações de "fechado"**; 2 refutações adversariais |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia):**

1. **LOGIN — PASSA (staff).** `seed-pilot` cria org + `bevox_admin` (hash); login staff password-only por
   design (Marco-1). Ressalvas não-bloqueantes: RBAC de org-role não-enforçado (1 org/1 admin no piloto);
   provisionamento Clerk de cliente-final quebrado → piloto **precisa** da seed de staff. **NOVO:** login staff
   sem rate-limit/lockout + `STAFF_JWT_SECRET` sem `.min()` (forjável).
2. **VER AGENDA — BLOQUEIO DURO.** `seed-pilot` não cria Calendar nem grade → `availability.ts:75
   notFound("Calendar")`, depois grade vazia. **NOVO co-fator:** **não existe `GET /appointments`** em lugar
   nenhum (só `PATCH /appointments/:id`) → ver os agendamentos **feitos** não tem rota REST.
3. **AGENDAR — BLOQUEADO a jusante do passo 2.** `booking.ts:104` existe, mas sem grade o motor não produz
   slot → `slot_conflict` sempre. Reschedule/transition têm **4 defeitos de correção novos** (não-atômico,
   self-overlap, idempotência fina, transição sem guard) que corrompem dados quando exercitados.
4. **COBRAR — PARCIAL (money-path manual do piloto FUNCIONA).** `charges/manual` + `mark-paid` →
   `applyChargePaid` concilia o ledger. **NOVO bug alcançável:** mark-paid → refund(full) → re-mark-paid
   insere **payment `paid` órfão** numa charge `refunded` (revenue double-count). Checkout/Stripe = stub 501.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura;
   `reconcile.ts:143` faz `UPDATE charges 'paid'` cru (sem `applyChargePaid`). Split em **2 endpoints**
   contra ADR-014 (um endpoint) → operador que segue ADR-014 manda `payment_intent.*` p/ `/stripe` que
   **records-and-ignores** → concilia dinâmico-Pix silenciosamente nunca dispara. Modo manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[CHANGED]`/`[Δsev]` = status vs 07-07; **(v: …)** = verificação
adversarial/manual do orquestrador; `[xrepo: …]` = dependência cruzada. Calibração ancorada em PRD §16.

### CRÍTICO (bloqueia runtime do piloto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO — grep exaustivo + manual)** — Nenhum
  caminho de produção escreve `professional_schedules`. Único `INSERT` em `src/ scripts/ db/ test/` = fixture
  `test/integration/calendar-booking.test.ts:120`. Produção só lê (`availability.ts:116`), `:126 if (!sched)
  continue` esvazia todo dia; `calendar/routes.ts` grava só `professional_schedule_overrides`; `booking.ts:207
  slot_conflict`. Sem CRUD de WeeklySchedule, sem Zod body, sem repo writer. Escopo §5.3 (Módulo-5 Calendar,
  ADR-010 aceita) — **Marco-2 in-scope, não deferimento**. — Impacto: 100% dos agendamentos = `slot_conflict`;
  sem workaround de produto. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (só seedar grade). **#1.**
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry, CHANGED]` **(v: CONFIRMADO)** — `seed-pilot.ts` insere
  só org(`:110`)/staff(`:157`)/professional(`:195`)/service(`:217`). Zero `calendars` → `availability.ts:75
  notFound("Calendar")` quebra "ver agenda" antes da grade. **CHANGED:** a omissão de `system_holidays` é
  **fail-open** (`availability.ts:108-111` vazio → `isSystemHoliday=false`, todo dia trabalhável) — **NÃO** é
  co-bloqueadora (07-07 a marcou co-CRÍTICA; correto é: só deixa feriado BR desbloqueado). Blockers duros =
  calendar-ausente + grade-ausente. — Esforço: **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.**
  `[xrepo: hub runbook go-live invoca seed-pilot]`

### ALTO (bloqueia GA / gate de CI Marco-1; ou dispara no instante em que harness/IA/outbound ligar)

**Gate "CI verde" (§16.1 — rodado de fato 2026-07-19 ~09:06–09:13 UTC; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-teardown`** `[carry]` **(v: rodado)** — `pnpm test:integration` =
  **RED exit 1**, `1 failed | 92 passed (93)` · `1 file | 13 passed (14)`. Falha =
  `calendar-booking.test.ts:259` "booking_notice (slot too soon)" `expected 'booked' to be 'slot_conflict'` —
  o slot é interpretado na tz do calendar; o gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei às
  **09:12 UTC** → `booked` → assert falha. + teardown **57P01** ×4 (suíte não fecha `closeDb/closeRedis` no
  `afterAll`). **Correção vs 07-07:** `ci.yml` job `Tests` (l.42-83) roda `pnpm test` **e** `pnpm
  test:integration` (l.80) **sem `continue-on-error`** e a integração usa testcontainers
  `ghcr.io/fboulnois/pg_uuidv7:1.6.0` — logo o flaky **falha o job de CI de fato**, não é só ambiente
  separado. — Esforço: **0,5h** (ancorar slot a `now()`-relativo + `await closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-12-high`** `[carry, estável]` **(v: rodado)** — `pnpm audit --audit-level
  high` = **RED exit 1, 27 vulns (3 low · 12 moderate · 12 high)**. Composição **mudou** (novas advisories
  undici TLS-bypass/WS-DoS/SOCKS5 + grpc-js ×2 + OTel-prometheus-crash) mas total estável em 12 high. Highs
  prod-runtime (~7): `@opentelemetry/auto-instrumentations-node<0.75`, `sdk-node<0.217`,
  `exporter-prometheus<0.217`, `@grpc/grpc-js 1.14.3` (×2), `protobufjs` (×2). Test-only: `tmp<0.2.6`,
  `undici 7.25` (×3) via testcontainers. `security.yml:38-39 continue-on-error:false` → hard-fail (+ job OSV
  Scanner separado). — Esforço: **2h** (bump OTel ≥0.217 sob nota ADR-012 + `pnpm override` undici/tmp).
  **#3.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA/outbound ligar)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(v: CONFIRMADO)** — Inbound persiste
  `wa`/`ig` (`metaapi/normalize.ts:35,44` → `channels/repository.ts:69`), outbound só reconhece pleno
  (`metaapi/repository.ts:197` → `null` p/ `wa`) → `executions/seams.ts:360` guard → `:376
  skipped_missing_recipient` (audita `metaapi.send.skipped`, **não erro**; `seams.ts:122 isDeliveryFailure`
  exclui skips → mantém `done` = falso-sucesso). **Alcançável NO piloto via staff-approve**
  (`executions/service.ts:68`), não só autônomo. Zero tradução `wa→whatsapp`; `channels.ts:22` provider
  `text` sem CHECK. — Impacto: 100% das respostas a conversas reais descartadas em silêncio. — Esforço:
  **3-4h** (unificar vocab + CHECK + backfill + teste e2e). **#4.** `[xrepo: bevox-meta-api usa whatsapp/
  instagram no fio — schemas.ts:7, frozen 06-22]`
- **`harness-status-callbacks-post-vs-patch-404`** `[NOVO]` **(v: CONFIRMADO manualmente — refuta "closed")** —
  Harness envia `/status` via **POST** (`bevox-callback.ts:28 method:"POST"`; `updateStatus` → `post(…/status)`
  `:140`), backend registra só `app.patch("/api/v1/executions/:id/status")` (`harness-callbacks.routes.ts:56`;
  OpenAPI `yaml:1822 patch:`) → Fastify **404**. Mata **todos** os status callbacks incl. o `dead_letter`
  autoritativo (harness `bullmq-consumer.ts:155`) → `markExecutionDeadLetter` **inalcançável** via harness →
  **refuta** o "dead_letter cross-repo FECHADO" de 07-05/07-07. Backstop: timeout-scan reclassifica a `timeout`
  (perde label `dead_letter` + audit `retry_exhausted`). Causa: canon auto-contraditório (PRD l.447 POST vs
  Amд1/l.1076 PATCH). Inerte no piloto (harness undispatched). — Esforço: **3h** (harness→PATCH + reconcile
  canon). **#6.** `[xrepo: bevox-harness + canon]`
- **`no-appointments-read-endpoint`** `[NOVO]` **(v: CONFIRMADO — sweep 22 route files)** — Não existe `GET
  /appointments` nem `GET /appointments/:id` em nenhum lugar; `calendar/routes.ts` expõe só availability,
  POST-create, PATCH-reschedule, POST-transitions; OpenAPI documenta só `patch /appointments/{id}`. ADR-010
  lista tool harness `list-appointments` sem rota backend. — Impacto: "ver agenda" dos agendamentos **feitos**
  não tem caminho REST (mitigação parcial só via Google sync). — Esforço: **3-4h**. `[xrepo: PRD §5.3/§8.3]`

**Auth / RBAC / provisionamento (Marco-1; mitigados no piloto de 1 org / 1 admin)**

- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO)** — `requireRole` só existe como 3 TODOs
  (`clerk-auth.ts:25`, `auth/repository.ts:261`, `types/global.d.ts:35`); `req.user.role` é resolvido
  (`clerk-auth.ts:109`) mas consumido por **zero** handler → `organizations/routes.ts:54 PATCH settings` sem
  gate de papel (`[requireClerkAuth, requireOrganizationScope, requireIdempotency]`). `resolveLocalUser`
  fail-open. PRD §5.1 (auth = Marco-1). Blast-radius baixo no piloto. — Esforço: **8h**. `[xrepo: backend/ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO)** — `auth/repository.ts:221-223 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna
  clerk-**user**-id); webhook trata só `user.*` (`auth/routes.ts:165,186`), sem `organization.created`. PRD
  §8.5. Mitigado no piloto (seed). — Esforço: **5h** (+ADR mapping org). `[xrepo: Clerk]`

### MÉDIO (degrada qualidade)

**Agenda — correção de dados quando exercitada (NOVOS; Marco-2)**

- **`reschedule-non-atomic-double-book`** `[NOVO]` — `booking.ts:373` `createAppointment` **commita** o novo
  appointment (+ outbox Google `create`) na própria tx; `:390` cancela o antigo em tx **separada** → crash
  entre as duas = 2 appointments ativos + push Google duplicado, sem compensação. — Esforço: **2-3h**.
- **`reschedule-self-overlap-always-conflicts`** `[NOVO]` — a re-contagem de disponibilidade conta o
  appointment **antigo** (ainda `scheduled`, cancelado só depois; `availability.ts:169 status NOT IN
  ('cancelled')`) → para `max_concurrent=1`, qualquer remarcação sobrepondo o horário atual = `slot_conflict`.
  — Esforço: **2h** (excluir self-id da re-contagem).
- **`appointment-transition-no-state-guard`** `[NOVO]` — `transitionAppointment` UPDATE any→any incondicional
  (`booking.ts:438,445-450`); `cancelled→completed/no_show` é aceito e dispara o decremento de pacote
  (`:485-489`) → consome sessão de appointment cancelado. Sem máquina de estados. — Esforço: **2h**.
- **`reschedule-thin-idempotency`** `[NOVO]` — `booking.ts:387 idempotencyKey:undefined` → NULL (índice único
  trata NULL como distinto, `calendar.ts:163-168`); só o cache Redis 24h protege. Create tem 2 guardas;
  reschedule tem 1. — Esforço: **1-2h**.

**Contrato backend↔harness (mismatches expostos pela evolução 07-04; persistem)**

- **`complete-failed-strategy-not-mapped-to-error`** `[carry]` **(v: CONFIRMADO, sharpened)** — `strategy:
  "failed"` está no enum (`harness-callbacks.schema.ts:64`) e parseia; `inferSuggestionType→"reply"`
  (`complete-service.ts:18`); autônomo → deliver vazio → `done`; **manual/copilot (modo do piloto)** →
  `:112 waiting_approval` com `response_text:""` (sugestão-fantasma na fila de staff). Nunca `error`.
  Contradiz ADR-019 Amд1. Reachable e2e (`/complete` é POST em ambos). — Esforço: **3h**. **#6.** `[xrepo]`
- **`complete-rejects-aborted-strategies-400`** `[carry]` **(v: CONFIRMADO)** — harness emite
  `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2096-2099`); enum backend omite
  (`harness-callbacks.schema.ts:57-65`) → ZodError → 400 (engolido pelo `.catch`); `/complete` terminal
  perdido; um `aborted_cost` fica vivo até o timeout-scan de 120s. — Esforço: **2h**. **#6.** `[xrepo]`
- **`completing-state-has-no-timeout-backstop`** `[NOVO]` — `lockForCompletion` seta `status='completing'`
  (`harness-callbacks.repository.ts:128`); se `finalizeCompletion` lança (500), a row orfana em `completing`
  com a conversa segurando `active_execution_id`; timeout-scan claima só `('dispatching','processing',
  'waiting_input')` (`orchestration/repository.ts:429`), expiry só `waiting_approval` → **nada reconcilia
  `completing`**; retry do harness → 409. — Esforço: **2h**. `[xrepo]`
- **`stale-token-blind-status-transition`** `[NOVO]` — `findExecutionIdByTokenHash` exclui só
  `('done','error','cancelled','dead_letter')` (`repository.ts:34`) → `timeout`/`expired`/`rejected`/
  `waiting_approval` seguem token-resolvíveis; `applyStatusTransition` é UPDATE cego sem guard de origem
  (`:64-67`) → callback tardio `running`/`paused` regride `waiting_approval→processing` (arranca sugestão da
  fila). Mascarado pelo 404 acima; morde quando ele for corrigido. — Esforço: **3h**. `[xrepo]`
- **`backend-never-sends-skills-allowlist`** `[NOVO]` — `cutoff.ts:75` hardcoda `skills:[]` e
  `account_denied_tools` **nem existe** no `DispatchPayloadSchema`; o harness trata `[]` como "sem allowlist →
  todas as tools permitidas" (`permission-context.ts:66`) → PERM-05 (allowlist por org) é **no-op**; harness
  vivo roda irrestrito. Inerte no piloto. — Esforço: **4h**. `[xrepo: bevox-harness]`

**Pagamentos / reconciliação (o resíduo real do "webhook concilia")**

- **`manual-remark-after-refund-inserts-orphan-paid-payment`** `[NOVO]` **(v: CONFIRMADO — alcançável no
  money-path do piloto)** — `applyChargePaid` roda 6 efeitos incondicionais (`service.ts:890-912`);
  `markChargePaidManually` sem status-gate (`:428-433`); `markPaymentReversed` libera o slot de dedup
  (`repository.ts:916-919`). Sequência mark-paid → refund-manual(full) → re-mark-paid re-insere **payment
  `paid` vivo numa charge `refunded`** (`markChargePaid WHERE status='pending'` vira no-op silencioso) →
  `SUM(payments 'paid')` double-conta; ledger diverge. — Esforço: **2h** (retornar rows-affected de
  `markChargePaid` e gatear `insertPayment`).
- **`reconcile-cron-flips-paid-without-orchestration`** `[carry]` **(v: CONFIRMADO)** — `reconcile.ts:143-150
  UPDATE charges SET status='paid'` cru, sem `applyChargePaid` → paid sem row em `payments`, appointment
  `scheduled` (nunca confirmado), sem grant, sem audit. Backstop de webhook-perdido, só Stripe (manual pula
  `:119`). — Esforço: **3h**. **#5.**
- **`reconcile-cron-skips-applyChargeRefunded`** `[carry]` **(v: CONFIRMADO)** — `reconcile.ts:253-259 UPDATE
  refunds` cru, sem `applyChargeRefunded` → viola ADR-018 §117 (full refund de package ⇒ `cancelled`); charge
  segue `paid`, package `active`. — Esforço: **2h**.
- **`stripe-webhook-zero-route-signature-dedupe-tests`** `[carry]` **(v: CONFIRMADO, sharpened)** — 0
  `constructEvent` em `test/`; nenhum teste injeta `POST /webhooks/stripe[/platform]`. Os 2 testes homônimos
  mockam o repo e **enshrine os gaps** de reconcile cru. Ponto de entrada de dinheiro sem cobertura de
  assinatura/dedupe/roteamento. — Esforço: **6h**. **#8.** `[xrepo: Stripe]`
- **`pix-reconcile-split-2-endpoints-vs-adr014`** `[carry]` **(v: CONFIRMADO)** — `webhook.ts:65` trata só
  `account.updated`; `payment_intent.*`/`refund.*` em `/webhooks/stripe/platform` (`webhook-platform.ts:61-88`,
  secret `_PLATFORM`); **ADR-014 documenta UM endpoint** → operador que segue ADR-014 manda PI p/ `/stripe`
  que **records-and-ignores** → concilia dinâmico-Pix nunca dispara. Ambos secrets `requiredInProd`
  (`env.ts:200,203`). — Esforço: **1h** (amendment canon + startup-assert). `[xrepo: Stripe]`
- **`requires-prepayment-hook-throws-manual-mode`** `[carry]` **(v: CONFIRMADO, mitigado)** — `booking.ts:275`
  → `createCharge` → `service.ts:193` lança "payment account not active" (conta manual ativa mas
  `external_account_id=NULL`); caught best-effort `:315-339` (não-fatal, audita `charge.hook_failed`). Seed
  `requires_prepayment=false`. — Esforço: **3h** (branch p/ `createManualCharge`). `[xrepo: ADR-023 vs ADR-014]`
- **`stripe-client-no-timeout-maxretries-breaker`** `[carry]` — `stripe-client.ts:21` sem `timeout`/
  `maxNetworkRetries`/breaker; double-PI seguro por `idempotencyKey: charge:${id}`; resíduo = outage Stripe
  trava thread até 80s SDK-default. Marco-3; Stripe **é** exercitado no piloto. — Esforço: **2h** (dep
  `opossum` dispara gate §6).

**Canais — perda de inbound (upgrades de severidade vs 07-07)**

- **`inbound-dedupe-strand-onboarding-loss`** `[carry, Δsev BAIXO→MÉDIO]` **(v: CONFIRMADO-pior)** —
  `metaapi/routes.ts:174` seta dedupe key (SETNX 24h) **antes** do persist; `:190 throw notFound("tenant not
  mapped")` na janela de onboarding (antes da row `organization_meta_api_tenant`) → key strandada; meta-api
  retenta (backoff `[0,30s,2min,10min,1h,6h]` todos <24h) → `:178 replayed` 200 → evento **perdido**, nem em
  `received_events`. O `DEL` (`:281`) só envolve o sub-bloco `message.received`. Primeiras mensagens de número
  recém-conectado se perdem. — Esforço: **2-3h** (persist-antes-de-SETNX). `[xrepo: bevox-meta-api]`
- **`null-tenant-audit-notnull-500-inbound-loss`** `[carry, Δsev BAIXO→MÉDIO]` **(v: CONFIRMADO-pior)** —
  `tenant_id=null` aceito (`schemas.ts:38`); `:216` audit INSERT passa `organization_id=NULL` numa coluna NOT
  NULL (`audit.ts:24-25`) → **500** → key strandada → retry vê `replayed` → **perdido**. Qualquer evento
  tenant-null (dos 5 tipos) crasha. — Esforço: **1-2h** (guardar org antes do audit). `[xrepo: bevox-meta-api]`
- **`status-events-subscribed-but-ignored`** `[carry, Δsev BAIXO-now/ALTO-GA]` — backend assina os 5 tipos
  (`server.ts:249-255`) mas `routes.ts:234` trata só `message.received`; `message.status_updated`
  (sent/delivered/read/**FAILED** outbound) sem handler → falha de entrega assíncrona do Meta nunca
  reconciliada; `sendMessage "sent"` (`client.ts:193`) = aceito, não entregue. — Esforço: **4-8h**. `[xrepo]`

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real)**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` **(v: CONFIRMADO — vetor vivo)** — `ai_opt_out`
  gravado/lido só no CRUD (`customers/repository.ts:26,67`; grep prova zero outros readers); `cutoff.ts:34-126`
  resolve modo + monta mensagens + `dispatchExecution` **sem** carregar o customer nem checar `ai_opt_out` →
  cliente que revoga consentimento ainda tem a conversa mandada ao LLM (transferência intl, _shared/ADR-019
  item 7). — Esforço: **4-6h**. **#10.**
- **`customer-pii-mutations-unaudited`** `[NOVO]` — `customers/` escreve **zero** `audit_events` (só TODOs
  `service.ts:85`); todo outro módulo audita. Create/patch de `full_name/phone/email/notes_internal` + toggle
  `ai_opt_out` sem trilha → LGPD art.37 RoPA + rectification gap. — Esforço: **3-4h**.
- **`message-records-not-customer-org-scoped-blocks-dsr`** `[carry]` — `message_records` (`ingestion.ts:39-48`)
  só tem `conversation_key`, sem `organization_id`/`customer_id`; PII de conversa (body + `wa_id` em
  `sender_snapshot_json` + `media_json`) un-joinável ao titular → DSR export/erasure real impossível; org
  delete não cascateia. — Esforço: **6-8h**. `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` — `queue/index.ts:86-152` 13 workers, nenhum purga PII; sem
  `consent_events`/`dsr_requests`/`legal_basis`; `deleted_at`/`consent_granted_at`/`archived_at` nunca escritos.
  — Esforço: **12-16h**. `[xrepo: _shared/ADR-020]`
- **`no-dsr-deletion-endpoint`** `[carry]` — sem `app.delete` em `customers/`; único vetor de erasure = SQL
  manual (PRD §12.9). — Esforço: **6-8h**. `[xrepo: _shared/ADR-020]`
- **`execution-traces-pii-retained-omitted-from-dsr`** `[NOVO]` — `harness-callbacks.repository.ts:187
  insertExecutionTraces` grava `input_json`/`output_json` crus do harness (texto/telefone/fatos); tem
  `org+execution_id` (DSR-alcançável) mas sem retenção e **omitido do DSR export** → 2º sink indefinido de PII.
  — Esforço: **4h**.

**Autonomia / observabilidade (harness inerte no piloto, exceto observabilidade que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[NOVO]` **(v: CONFIRMADO)** — `src/queue/index.ts` (entry
  `node dist/queue/index.js`) **nunca** `import "./instrument.js"` nem `initTelemetry()` (ambos só em
  `src/index.ts:17,30`) → no processo worker o Sentry é no-op (`captureException` `queue/index.ts:272,313`
  nunca chega) e o OTel NodeSDK nunca inicia (zero traces pg/redis); `shutdownTelemetry()` (`:302`) desmonta
  SDK nunca iniciado. **Toda a metade assíncrona** (ingestion, cutoff→dispatch, timeout-scan, crons de
  reconcile de pagamento, google sync) é um buraco-negro de Sentry+traces em prod. O piloto roda esses
  workers. — Esforço: **1h** (import instrument + `await initTelemetry()` no `main()` do worker). **Alto
  valor / baixo esforço.**
- **`sse-appointment-charge-events-never-published`** `[carry]` — `realtime/publish.ts:8-12` só
  `execution.*`/`waitlist.offered`; `appointment.created` (§8.3) e `charge.updated` (§8.4/§10.1) **nunca**
  emitidos → tela do profissional não auto-atualiza no agendar/pagar. Mitigante: consumidor `bevox-client`
  ainda "a criar" → latente. — Esforço: **3h**.
- **`domain-prometheus-metrics-not-registered`** `[carry]` — `shared/metrics.ts` não registra os 4 de PRD
  §12.10 (`charges_succeeded_total`, `appointments_no_show_rate`, `executions_pending_approval_count`,
  `executions_timeout_total`); grep=0. `charges_succeeded_total`/no-show relevantes ao piloto. — Esforço:
  **4h**.
- **`circuit-breaker-and-stripe-timeout-absent`** `[carry]` — PRD §12.7; `stripe-client.ts:21` sem
  timeout/breaker; `opossum`=0. Stripe **é** exercitado no piloto (hang até 80s). — Esforço: **3h**.
- **`rate-limit-§12.6-zero-routes-applied`** `[carry]` — plugin registrado (`server.ts:134`),
  `requireRateLimit()` decorado, **zero** rotas o aplicam; webhooks públicos (stripe/metaapi/google)
  destravados; DEFAULT 600/60 ≠ canon 500/org. — Esforço: **2h**.
- **`autonomy-patch-nontransactional-mode-audit`** `[carry, CHANGED]` — a desculpa do próprio código
  ("no tx helper exists", `autonomy/repository.ts:66`) é **FALSA**: `getDb().transaction()` é usado em 7 sites;
  UPDATE (`:87`) + audit INSERT (`:111`) não-atômicos → mudança de modo sem AuditEvent se o INSERT falha +
  lost-update dos JSONBs. — Esforço: **1h**.
- **`autonomy-action-granularity-not-enforced`** `[carry]` — `resolver.ts:41-62` gateia só `current_mode`;
  `PolicyEvaluator`/`fetchOrgAutonomyPolicies` (`seams.ts`) com zero callers; os 3 JSONBs escritos-nunca-lidos.
  Inerte no piloto. — Esforço: **8h+**. `[xrepo: PRD §5.5]`
- **`autonomy-readiness-score-never-computed`** `[carry]` — `readiness_score` lido/retornado (`repository.ts:
  20,26`), nunca computado → `GET /autonomy` sempre null; auto-promoção §8.5 nunca dispara. Inerte. — **4h**.

**Auth / segurança (NOVOS — 5 passadas anteriores perderam)**

- **`impersonation-id-is-not-organization-id`** `[NOVO]` — `organization-scope.ts:57 return
  req.staff.impersonation_id` como tenant org id, mas `auth/service.ts:116,135-138` seta essa claim ao **PK da
  row `staff_impersonations`** (`repository.ts:175`). Latente/inalcançável (nenhuma rota pareia
  `requireStaff`+`requireOrganizationScope`; `requireClerkAuth` rejeita HS256) e fail-closed, mas é
  contradição da invariante de tenancy. — Esforço: **2-3h**.
- **`staff-login-no-ratelimit-no-lockout`** `[NOVO]` — `auth/routes.ts:90 POST /staff/sessions` + `:97`
  refresh sem preHandler; `requireRateLimit` não aplicado; bcrypt cost 12 é o único freio → brute-force
  online destravado contra o admin conhecido (`staff@example.com`). — Esforço: **3h**.
- **`staff-jwt-secret-no-min-length`** `[NOVO]` — `env.ts:60 STAFF_JWT_SECRET: optionalString`, `:187` só
  presence-required em prod, sem `.min()` → secret curto forjável offline; JWT staff forjado (`aud=
  bevox-backend-staff`, `role=bevox_admin`) = compromisso total do plano staff. — Esforço: **0,5h**
  (`.min(32)`).
- **`clerk-jwt-no-aud-iss-validation`** `[NOVO, Δsev BAIXA/MÉDIA]` — `clerk-auth.ts:89-92` verifica só
  `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer` → qualquer token daquela instância Clerk
  (qualquer template) é aceito, e o `organization_id` confiável vem numa claim não-verificada. Alg-confusion
  bloqueado, JWKS pinado (mitigantes). — Esforço: **1h**.

**Schema / índices (NOVOS + carries; Marco-1 hot path mitigado)**

- **`uuidv7-sql-default-missing-post-0000-tables`** `[NOVO]` — só as 14 tabelas de
  `0000_youthful_shooting_star.sql:307+` ganham `ALTER COLUMN id SET DEFAULT gen_uuid_v7()`; **~23 tabelas**
  criadas em migrations 0001+ (appointments, conversations, charges, payments, calendars, waitlist_entries…)
  **não** têm default server-side (grep NONE em 0001+), contradizendo `_shared.ts:24-25`. Latente (app supre
  via `$defaultFn`); qualquer `INSERT` cru omitindo id (migrator/seed/DR/psql) falha NOT-NULL. — Esforço:
  **2h** (uma migration ALTER).
- **`section-11-3-critical-indexes-partially-absent`** `[carry, CHANGED — mais amplo]` — PRD §11.3 exige
  `(org,status)` em appointments/charges/executions, `(org,start_at)` em appointments, `(org,customer_id)` em
  relacionamentos. Ausentes: appointments (`calendar.ts:161-176`) todos os 3; charges (`payments.ts:115`)
  `(org,status)`+`(org,customer_id)`; executions (`executions.ts:66`) `(org,status)`; conversations
  `(org,customer_id)`. Hot-path Marco-1 (availability) mitigado por `(professional_id,start_at)`; risco real =
  scans org-wide de listagem/status. — Esforço: **2h**.
- **`onboarding-advance-no-prereq-arbitrary-stage`** `[carry, CHANGED]` — `repository.ts:157 SET
  onboarding_stage=${stage}` cru; `schemas.ts:37-49` aceita qualquer dos 11 valores; PRD §5.8 exige "não
  avança a services sem ≥1 professional ativo" + checklist (ausente). **CHANGED:** `onboarding_stage` **não**
  flipa `ai_mode` → é gap de state-integrity/UX, **não** bypass de autonomia (07-07 implicou "pula p/
  autonomia"). Onboarding = Marco-1. — Esforço: **5h**.

### BAIXO (higiene)

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; 106 rotas / 80 paths / 95 ops / 0 phantom)**

- **`openapi-no-full-route-contract-test`** `[carry, CHANGED]` — existe teste parcial
  (`openapi-approval-endpoints.test.ts`, `toContain` textual nos 4 approval); **nenhum** `printRoutes()×YAML`
  → causa-raiz do drift invisível. — Esforço: **3-4h**. **#9.**
- **`openapi-drift-undocumented-handlers`** `[carry, CHANGED 7→11]` — 11 handlers fora do YAML: os 7
  client-facing (`GET/PATCH /autonomy`, `GET /channel-connections`, `GET /customers/{id}/export` [DSR],
  `GET/PATCH /payment-account/policy`, `GET /api/v1/realtime`) + **4 webhooks** (`POST /webhooks/stripe`,
  `/stripe/platform`, `/webhooks/google`, `GET /webhooks/google/callback`). — Esforço: **2-3h**. **#9.**
- **`sse-realtime-header-auth-and-query-contract`** `[carry, expanded]` **(Δsev MÉDIO)** — `realtime/routes.ts:
  26 GET /api/v1/realtime` guardado por `requireClerkAuth` (header-only, `clerk-auth.ts:173`) → `EventSource`
  de browser não seta header → inconsumível; e não parseia `?scope`/`?conversation_id` vs canon §10.1. —
  Esforço: **2-4h**. *(listado aqui por proximidade; funcionalmente MÉDIO)*
- **`openapi-enum-drift-proposal-create-refund`** `[carry]` — `ExecutionProposal.action` (YAML l.330) inclui
  `waitlist-add` (não-canon) e omite `create-refund` (**ação de dinheiro** viva, `seams.ts:172`). — **0,25h**.
- **`openapi-status-callback-missing-dead-letter`** `[carry]` — YAML enum `[running,paused,cancelled]` sem
  `dead_letter` (código+canon+harness têm). — **0,25h**. **#9.**
- **`error-envelope-dual-schema`** `[NOVO]` — `Error` (sem `request_id`) referenciado por todos os 4xx
  compartilhados; `ErrorEnvelope` (com `request_id`) só em 7 respostas de payments; runtime sempre emite
  `request_id`. — **0,5-1h**.
- **`charge-route-path-and-charge-type-drift`** `[carry, expanded]` — path org vs §5.6 appointments (PRD
  auto-inconsistente); `charge_type` YAML `[full,package]` vs canon 4 (`deposit|full|package|adjustment`);
  `payment_method` YAML `[pix]` vs código `[pix,checkout]` vs canon `pix|payment_link` (3 fontes, 3 enums). —
  **1h**.
- **`openapi-missing-operationid`** `[carry]` — `grep -c operationId`=**0** em 95 ops → `operations =
  Record<string, never>` (codegen tipado degradado). — **1-2h**.
- **`rate-limit-429-undocumented`** / **`stripe-oauth-return-missing-security`** `[NOVO]` — 429 emitido em
  runtime, 0 no YAML; 2 ops connect-return/refresh sem bloco `security`. — 0,25-0,5h.

**Canais / schema / auth (resíduos)**

- **`message-records-pii-no-org-scope`** / **`find-channel-connection-not-org-scoped`** `[carry/NOVO]` —
  `message_records` sem org_id (viola CLAUDE.md §5); `channels/repository.ts:25-34 findChannelConnection` sem
  filtro de org (`intake.ts:63` descarta o org_id que já tem) → colisão = linkagem cross-org (improvável mas
  viola invariante). — 1-6h.
- **`inbound-media-binary-never-downloaded-ttl-loss`** / **`multi-message-wa-batch-drop`** `[carry]` — sem
  fetch `/v1/media` (CDN Meta expira); `inbound-dispatch.ts:64` lê só `messages[0]`. Deferimentos V1. — 2-8h.
- **`newopaqueid-uuidv4-landmine`** `[carry]` — `staff-auth.ts:139-141 newOpaqueId(){return randomUUID()}`
  (UUIDv4, §4.7); **dead code** (zero callers). Adjacente: `calendar/google/lock.ts:46 randomUUID()`
  fence-token (não-identidade, viola a letra da rule). — **0,25h**.
- **`appointments-customer-package-id-no-db-fk`** / **`customers-deleted-at-read-but-never-written`** `[NOVO]`
  — `calendar.ts:124 customerPackageId` sem `.references()` (import cycle; mitigado por validação fail-closed
  `booking.ts:146-177`); `customers.ts:52 deleted_at` filtrado (`repository.ts:31,41`) mas nunca escrito
  (soft-delete decorativo). — 1-3h.
- **`charge-currency-unvalidated`** / **`idempotency-key-param-mismatch-silent`** / **`provider-charge-id-
  no-unique-constraint`** `[NOVO]` — `charge-intent.ts:108` currency `z.string()` aceita "USD" mas PI é brl
  (`:59`) → ledger mismatch; `repository.ts:347` reusa key ignorando body (Stripe daria 400);
  `provider_charge_id` sem unique. Latentes (piloto BRL). — 0,5-2h.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04; 3 refutam docs)**

- **`version-drift-semver-image-missing-amendment`** `[carry, CHANGED — pior]` **(v: CONFIRMADO)** —
  `merge-base --is-ancestor dbd231e v1.0.1` = FALSE; `v1.0.1`=`9a88116` (06-01, PR #17); **PRs #18–#39** (incl.
  fixes de segurança #22/#27/#31) todos fora. `release.yml:5` dispara só em tags `v*.*.*` → `type=sha` no mesmo
  trigger → **07-07 "deploy por digest possível" REFUTADO**: nenhuma imagem (SemVer OU sha) para pós-`v1.0.1`.
  `v1.0.1..HEAD`=27. — Esforço: **0,5-1h** (cortar tag). **#7.** `[xrepo: hub manifest]`
- **`claude-md-section8-dockerfile-bug-stale`** `[NOVO — refuta CLAUDE.md]` — `CLAUDE.md:170` "migrator não
  copia `src/` → seed-pilot falha" está **FIXO**: `Dockerfile:69 COPY … src ./src` (PR #18). `backend-db.md` +
  `backend-stack.md` também descrevem o bug fechado. — **0,3h**.
- **`claude-md-section8-mfa-sentinel-doc-stale`** / **`claude-config-stale-deleted-bridge-and-closed-issue36`**
  / **`rules-dead-letter-writer-mechanism-wrong`** `[carry]` — `CLAUDE.md §8` diz seed grava
  `PILOTSEEDONLYNOTASECRET` (real gera base32 + bloqueia); `resolve-organization-id.ts` citado em 5 lugares
  (`backend-tenancy.md`, `backend-routes.md`, `README.md:84`, agent architect, `hooks/PostToolUse-tenancy.sh:11`)
  **não existe**; `backend-tests.md` cita "5 falhas FK #36" (suíte passa); rules dizem `dead_letter` via
  `worker.on('failed')` (**errado** — é via `PATCH /status`) e localizam os callbacks em `modules/executions/`
  (vivem em `src/integration/harness-callbacks.routes.ts`). — 0,3-0,5h/ea.
- **`codeql-upload-never-noop`** / **`release-no-provenance-sbom`** `[NOVO]` — `codeql.yml:26 upload:never` →
  SARIF nunca chega à aba Security (scanner efetivamente no-op num backend de pagamento); `release.yml` sem
  `provenance:`/`sbom:`/cosign. — 0,2-1h.
- **`adr-number-collision-cross-namespace`** `[carry, INFO→BAIXO]` — `backend/` e `_shared/` colidem em
  012-023 (ex.: `backend/ADR-020`=message-template vs `_shared/ADR-020`=retenção); config cita sem qualificar.
  — **1h**.
- **`stray-gap-workflow-js-scratch-accumulation`** `[carry]` — 5 `.claude/state/gap*.js` (~143KB) gitignored
  (`.gitignore:57`; `eslint.config.js` casa só `**/*.ts`) → **zero impacto em CI**; fazem só o `pnpm lint`
  **local** dar RED. *Nota:* relatórios de auditoria de 07-09/07-14/07-15/07-17 **nunca foram commitados** a
  `main` (último = 07-07 `105fb50`). — **0,1h** (`rm`).

### INFO / conformidades verificadas / não-gaps

- **`legacy-lexicon-clean`** **(v: CONFIRMADO)** — grep `workspace_id|workspaces|account_id\b` em `src/`/`db/`:
  executável **ZERO** (invariante §4.1 mantida). Só compostos sancionados (`external_account_id`/
  `payment_account_id`/`channel_account_id`), o alias `AS account_id` em `payments/repository.ts:1012`
  (`payment_accounts` PK, remapeado p/ `accountId`) e doc-comments de migration. `resolve-organization-id.ts`
  **deletado**.
- **`mfa-sentinel-correctly-inert`** **(v: CONFIRMADO)** — `seed-pilot.ts:153-154` `generateMfaSecret()` +
  `assertMfaSecretNotPlaceholder()`; `mfa.ts:34-42` blocklist; `auth/service.ts:84-89` sem MFA check (correto —
  TOTP é Marco-3). **NÃO implementar "rejeitar sentinel no login".** Resíduo dev-only: `db/seed.ts:79
  DEVSEEDONLYNOTASECRET` (não bloqueado, mas dev-seed).
- **`four-callbacks-token-gated`** — `/status`(PATCH), `/traces`/`/stream`/`/complete`(POST), todos em
  `harness-callbacks.routes.ts`, validam `X-Execution-Token` → 401. *(Mas o método de `/status` diverge do
  harness — ver ALTO POST/PATCH 404.)*
- **`dispatch-amendment-faithful-to-canon`** **(v: CONFIRMADO)** — `deadline_ms`/`original_execution_id`/
  `dead_letter` (`harness-dispatch.schema.ts:58,62`) byte-faithful ao canon (PRD l.1069-1076 + ADR-019 Amд1).
  **Não é fork** (falso-positivo 06-04 segue retirado). Caveat: harness ignora o `callback_base_url` do fio
  (usa env) → campo decorativo.
- **`hmac-verification-correct`** **(v: CONFIRMADO pelo agente)** — `channels/metaapi/service.ts:21-60` casa o
  signer do meta-api exatamente (`${t}.${rawBody}`, SHA256 hex, `t=,v1=`, ±300s, `timingSafeEqual`);
  raw-buffer parser preserva bytes. Sem gap.
- **`payments-conformidades`** **(v: CONFIRMADO)** — PCI-nil (grep `pan|cvc|cvv|card_number`=0); refund-
  deferrals aceitos (ADR-018); crons wired (`queue/index.ts:143,149`); ambos webhook-secrets `requiredInProd`;
  cross-tenant paid-flip impossível (org só de row DB, `webhook-platform.ts:56-88`); webhooks dedupe-aware
  (`recordWebhookEvent`+`alreadyProcessed`); over-refund replay-safe; `application_fee ∈ [0,amount]`; dinheiro
  decimal-safe `numeric(10,2)`.
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer`; `requireStaff({roles})` 403; JWT staff HS256 aud `bevox-backend-staff` distinto do Clerk
  RS256; observer excluído de impersonation.
- **`accepted-adrs-materialized-except-2`** — ADRs backend 008-023 **aceitas** todas materializadas exceto
  **ADR-020** (message_templates) e **ADR-021** (priority_score formula/colunas/cron). ADR-011 superseded-by-019;
  **ADR-016 é `proposed`** (token-metering — corretamente NÃO implementada). Adversarial clean: timestamptz
  everywhere; status-text com CHECK; customer_channels UNIQUE; customer_facts DDL verbatim; FK `ON DELETE
  cascade` segue canon (§11.2) — a rule `backend-db.md` "restrict" é que está stale.
- **`todo-fixme-debt-sweep-marco23-only`** **(v: CONFIRMADO)** — sweep `src/`+`db/`: **0** FIXME/HACK/XXX; 1
  `@deprecated` (`orchestration/repository.ts:348`); TODOs todos Marco-2/3. Zero dívida pilot-blocking.
- **`refuted-adversarial`** — (a) `availability-getday-timezone`: `getDay()` em local dupla se cancela; Brasil
  sem DST → **correto, não-bug**. (b) `dead-letter-clobbers-terminal`, `canon-complete-strategy-enum-stale`,
  `complete-conflict-409-vs-410` (canon §10.4 diz 410, código 409; sem impacto live) — deviations de
  contrato/canon, não bugs de runtime.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros somam ≈ 5-6h** e
destravam o runtime do piloto + os 2 jobs de CI vermelhos.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Seedar Calendar default + grade `professional_schedules` (Seg-Sex) no `seed-pilot`** | **2-3h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (ancorar slot a `now()`-relativo) **+ `closeDb()/closeRedis()` no `afterAll`** | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | `pnpm audit`: bump OTel (≥0.217) sob nota ADR-012 + `pnpm override` undici/tmp | **2h** | Destrava o job `Security` (12 highs, ~7 prod-runtime) — completa "CI verde" |
| 4 | **Inicializar telemetria no processo worker** (import instrument + `initTelemetry()` em `queue/index.ts`) | **1h** | Fecha o buraco-negro de Sentry/traces de TODA a metade assíncrona que o piloto roda |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e inbound→outbound | **3-4h** | **CRÍTICO quando a IA/staff-approve ligar**: faz a resposta chegar ao cliente |
| 6 | **`reconcile-cron` chamar `applyChargePaid`/`applyChargeRefunded`** + gatear `insertPayment` (fecha o orphan-payment manual) | **3-4h** | Fecha a rede de webhook-perdido + o bug de revenue double-count no money-path do piloto |
| 7 | **Reconciliar `harness /status` POST↔PATCH** (harness→PATCH + reconcile canon l.447) | **3h** | Restaura TODOS os status callbacks incl. `dead_letter` (hoje 404) `[xrepo]` |
| 8 | Reconciliar **versão** + cortar tag SemVer capturando #39 | **0,5-1h** | Hoje NENHUMA imagem (SemVer/sha) contém os fixes pós-`v1.0.1` |
| 9 | Testes de integração: `availability`(rota) + reschedule + webhook Stripe + inbound→outbound vocab | **8-12h** | Rede p/ o hot-path; teria pego o CRÍTICO #1 e o vocab #5 |
| 10 | Aplicar gate `ai_opt_out` em `cutoff.ts` antes do dispatch + hidratar DSR export (`preferences_json`+events) | **3-5h** | LGPD (piloto roda com PII real; hoje o flag é ignorado) |
| — | Higiene: `GET /appointments`; `.min(32)` no `STAFF_JWT_SECRET`; rate-limit no login staff; `newOpaqueId`→v7; remover `.claude/state/gap*.js`; atualizar docs stale (§8 Dockerfile/MFA, bridge deletada) | **~6h** | "Ver agenda" + endurecimento auth + governança |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status` POST vs PATCH 404** (NOVO): o
  harness POSTa `/status` a uma rota PATCH-only → 404; quebra status callbacks incl. `dead_letter` →
  **refuta** o "fechado" de 07-05/07-07. Também persistem `strategy='failed'`→não-`error` e `aborted_*`→400.
  Todos exigem decisão cross-repo + reconcile de canon (l.447). Mitigante: harness **inerte** no piloto
  staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — vocab pleno `whatsapp`/`instagram` no fio
  (`schemas.ts:7`) confirma que `wa`/`ig` do backend é a causa do drop de outbound; retries de webhook
  (`webhook-delivery.ts`) todos <24h amplificam a perda de inbound (dedupe-strand + null-tenant-500).
- **Clerk** — `clerk-user-provisioning-broken` depende de webhook `organization.created` + claim
  `organization_id`; piloto contorna via `seed-pilot`.
- **Stripe** — Pix exige Connect KYC `active`; conciliação depende de **dois** endpoints (ambos
  `requiredInProd`); refund manual não passa por webhook. Escape do piloto: manual-mode.
- **canon (ADRs aceitas não-implementadas / drifts)** — backend/ADR-009 (merge), ADR-014 (Checkout), ADR-020
  (MessageTemplate), ADR-021 (priority-score); _shared/ADR-019 (bases legais), ADR-020 (retenção). Drifts
  "canon-atrás-do-código" (webhook §10.3 unificado, `strategy='workflow'`, `payment_method='checkout'`,
  `aborted_*`, `/status` POST↔PATCH l.447, `/complete` 410-vs-409) → nota/ADR superseding **no canon**
  (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1`
  (sem #39 nem os fixes #18-#38); runbook go-live invoca `seed-pilot` (que não cria grade — CRÍTICO #1).
- **delivery-tracker (categoria h)** — slot backend = **10 delivered + 1 parked** (aisuggestion, staff-rbac,
  m4-chatwoot-p1..p4, m5-p4-manual-payment, m5-p3a/b/c; psp-br parked). **Nenhum work-item** para calendar
  (ADR-010), customer-identity (ADR-009), message-templates (ADR-020), priority-score (ADR-021), policy-json
  (ADR-022) → o defeito pilot-blocking da grade (sob ADR-010) é **invisível ao tracker**. `m5-p3c` auto-declara
  "5 gates LGPD pendentes / não-ready-for-prod". **Veredicto categoria-h: "delivered" ≠ pilot-ready** (o
  tracker mede presença-de-código por grep, condição necessária-não-suficiente). Usar esta auditoria como o
  gate de prontidão.

## Delta vs auditoria anterior (2026-07-07)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22. Quase todos os achados de
código sobrevivem verbatim — re-confirmados com evidência fresca por 10 domínios; **0 refutações de achados
de código**, mas **3 refutações de conclusões "fechadas"** anteriores.

**Refutado / corrigido (importante):**
- **`dead_letter` cross-repo "FECHADO" → REFUTADO.** `harness-status-callbacks-post-vs-patch-404` prova que o
  harness POSTa `/status` a uma rota PATCH-only → 404; o backend nunca recebe o `dead_letter` (nem os status
  intermediários). 07-05/07-07 viram só que o harness **emite**.
- **`version-drift` "deploy por digest `type=sha` possível" → REFUTADO.** `release.yml` dispara só em tags →
  nenhuma imagem existe para commits pós-`v1.0.1`.
- **`CLAUDE.md §8` "migrator não copia `src/`" → STALE/FIXO** (`Dockerfile:69 COPY src`).
- **`seed-pilot-omits-system-holidays` co-CRÍTICO → REBAIXADO**: é fail-open, não co-bloqueador.
- **`ci.yml` "unit-only" (backend-tests.md) → CORRIGIDO**: o job `Tests` roda `test:integration` sem
  `continue-on-error` → o flaky falha o CI de fato.
- **`onboarding-advance` "pula p/ autonomia" → REBAIXADO**: `onboarding_stage` não flipa `ai_mode`.

**Novo (~30 achados que 06-02/06-04/06-23/07-05/07-07 perderam):** `harness-status-callbacks-post-vs-patch-404`
(ALTO), `no-appointments-read-endpoint` (ALTO), `worker-process-telemetry-uninitialized`, os 4 de reschedule/
transition, `manual-remark-after-refund-inserts-orphan-paid-payment`, `impersonation-id-is-not-organization-id`,
`staff-login-no-ratelimit`, `staff-jwt-secret-no-min-length`, `clerk-jwt-no-aud-iss-validation`,
`staff-ops-action-audit-partial-failure-window`, `customer-pii-mutations-unaudited`,
`execution-traces-pii-retained`, `redaction-paths-miss-actual-columns`, `request-log-client-ip-unredacted`,
`uuidv7-sql-default-missing-post-0000-tables`, `appointments-customer-package-id-no-db-fk`,
`customers-deleted-at-never-written`, `completing-state-has-no-timeout-backstop`,
`stale-token-blind-status-transition`, `backend-never-sends-skills-allowlist`, `error-envelope-dual-schema`,
`rate-limit-429-undocumented`, `sse-no-connection-cap-redis-amplification`, `sentry-otel-egress-not-pii-redacted`,
`codeql-upload-never-noop`, `release-no-provenance-sbom`, `charge-currency-unvalidated`,
`idempotency-key-param-mismatch-silent`, `provider-charge-id-no-unique-constraint`,
`canon-status-method-self-contradiction`, `complete-conflict-409-vs-410`, `dockerfile-bug-stale` (refuta doc).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; `outbound-provider-vocab` (ALTO); `rbac-org-role`;
`clerk-user-provisioning`; os mismatches de `/complete`; `reconcile-cron-*`; toda a bateria LGPD; autonomia/
observabilidade inerte; buffer/priority-score/reminders/templates Marco-2/3; e a staleness `.claude`/CLAUDE.md.

**CI (ground-truth 07-19 vs 07-07):** essencialmente **inalterado** — Typecheck/Format/OpenAPI/Unit/Build =
GREEN; `test:integration` = RED (mesmo flaky `booking_notice` por hora-do-dia + teardown 57P01); `pnpm audit`
**estável em 12 high** (composição de advisories mudou: novas undici/grpc/OTel-prometheus). Novo: o `lint`-RED
local acumulou de 1→**5** arquivos `.claude/state/gap*.js` (todos gitignored → CI GREEN).

## Notas de método

**Orquestração.** **10 auditores de domínio em paralelo** (background), cada um re-verificando os achados do
07-07 do seu domínio contra o **código atual** com evidência fresca `file:linha`, caçando gaps novos e lendo
canon de `origin/main`: **calendar/pilot, payments/Stripe, harness-contract, channels/metaapi, auth/RBAC/
tenancy, openapi/routes, LGPD/retenção, schema/entidades, autonomia/observabilidade, governança/CI/tracker.**
**4 domínios usaram agent-types locais** deste repo: `harness-callback-auditor`, `backend-route-reviewer`,
`backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`; payments usou `Security Engineer`. Cada
agente entregou lista estruturada com veredicto (CONFIRMED/REFUTED/CHANGED/NEW) + severidade + esforço.

**Verificação adversarial/manual independente** (orquestrador, fora do fan-out) dos achados-manchete NOVOS:
harness `/status` POST↔PATCH (leu `bevox-callback.ts:28,140` do harness `origin/main` + `harness-callbacks.
routes.ts:56` + OpenAPI), writer de `professional_schedules` (grep exaustivo `src/ scripts/ db/ test/`),
`seed-pilot.ts` inserts (só 4), telemetria do worker (`queue/index.ts` sem `import instrument`), estrutura de
CI (`ci.yml` roda integração; `security.yml continue-on-error:false`; testcontainers `pg_uuidv7:1.6.0`),
version-drift (`merge-base --is-ancestor dbd231e v1.0.1`=FALSE, tags só v1.0.0/v1.0.1). Refutações
adversariais dos próprios agentes: timezone `getDay()` (correto), HMAC (correto), várias conformances de
payments.

**Ground-truth de CI rodado de fato** (2026-07-19 ~09:06–09:13 UTC, não inferido): Typecheck/Format/OpenAPI/
Unit/Build = **GREEN**; `test:integration` = **RED exit 1** (`1 failed | 92 passed`, flaky `booking_notice` +
teardown 57P01); `pnpm audit --audit-level high` = **RED exit 1, 12 high/27 total**; `lint` = **RED por
artefato local** (5 `.claude/state/gap*.js` gitignored, ausentes em checkout limpo).

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005), **sempre de `origin/main`**
(`git show origin/main:<path>`) — o working tree está numa branch que **deleta linhas aceitas** (origem do
falso-positivo de 06-04). `origin/main` frozen @ `7874971` (06-03). Numeração de ADR **colide** entre
namespaces backend/_shared — sempre qualificada.

**Correções ao brief da missão** (para o revisor): (1) o brief lista os 4 callbacks como
`/complete,/artifact,/tool-result,/turn` — os reais (código+canon+rule) são **`/status,/traces,/stream,/
complete`**; (2) o brief chama backend/ADR-019 de "channels" — é **execução/colapso AISuggestion** (channels é
_shared/ADR-011); (3) backend/ADR-018 é **refund policy** (correto no brief), mas ADR-019 do brief como
"channels" está trocado; (4) o grep `account_id\b` do brief captura compostos Stripe/canal **sancionados** — o
léxico proibido executável é **ZERO** (conforme); (5) a premissa "código congelado desde 06-04" é **06-03**
(último commit de código = `dbd231e`).

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem (vocab de
canal e POST/PATCH 404 viram CRÍTICO). (2) OSV Scanner / CodeQL não reproduzíveis offline (config lida:
`codeql.yml upload:never` = no-op; `security.yml` OSV roda em CI). (3) Caminho live (Stripe/Clerk/harness/Meta
reais) não exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência
comprovada de writers/endpoints + CI rodado. (4) MCP `stripe`/Google Drive requerem autenticação interativa —
**indisponíveis** nesta sessão headless (reportado; não bloqueante para auditoria de código).

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-07-19. Sem alteração de código de
produto; somente este relatório. Revisão humana pendente.*
