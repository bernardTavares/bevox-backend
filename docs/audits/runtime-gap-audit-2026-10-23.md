# Gap Analysis — bevox-backend — 2026-10-23

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo segundo a
> documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais deste repo — `harness-callback-auditor`,
> `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`, `backend-route-reviewer`, `Security Engineer` —
> + 2 `general-purpose` para LGPD e calendar/pilot/obs), cada um **re-verificando de fonte primária** o inventário do
> 10-22 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** superestimações + caçar
> misses; **verificação independente de fonte-primária pelo orquestrador** dos achados-manchete; e **CI rodado de
> fato** (2026-10-23 ~09:05 UTC, não inferido; logs em `/tmp/ci-1023/`). Sucede `runtime-gap-audit-2026-10-22.md`.

## Resumo executivo

**11ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,5
meses.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é **vazio** — o produto é byte-idêntico desde
`dbd231e` (2026-06-03). Canon `bevox-knowledge` `origin/main` @ `78749711` (06-03), `bevox-harness` `origin/main` @
`2979eb0` (06-03), `bevox-meta-api` `origin/main` @ `5516c2a` (06-22) — **todos inalterados vs 10-22**. Os 7 auditores
+ o orquestrador **confirmaram o inventário de código do 10-22** (~90 itens), com **1 refutação** nova, **~18
misses/sharpenings NOVOS** e várias correções de evidência/severidade.

**Manchete-delta #1 — o Security PLATEAUOU de verdade: 109 vulns / 49 high, byte-idêntico ao 10-22.** Ground-truth
rodado 2026-10-23 ~09:05 UTC: **Typecheck ✓ / Format ✓ / OpenAPI(parse) ✓ / Build ✓ (tsc+tsc-alias+dist-alias-gate) /
Unit ✓ (469/469, 69 files) = GREEN**; **Tests RED** (`test:integration` exit 1: `1 failed | 92 passed (93)` — o mesmo
flaky dependente de hora-do-dia `calendar-booking.test.ts:259`, rodei ~09:05 UTC < ~13:00 → `booked` em vez de
`slot_conflict`; **sem** o teardown 57P01 desta vez); **Security RED** (`pnpm audit --audit-level high` exit 1:
**109 vulns — 8 low / 52 moderate / 49 high / 0 critical**, 49 high em **19 módulos** idênticos). Vs 10-22
(**109 / 8-52-49**) → **delta ZERO** — a 1ª passada em que o número de segurança não se moveu. Tendência
**12 → 15 → 18 → 49 → 49 → 49**: estabilizada há 48h.

**Manchete-delta #2 — o scanner agendado do GitHub continua DARK (agora padrão multi-semana confirmado).** O 10-22
descobriu isso como NOVO; hoje re-confirmei via `gh run list --branch main`: **todo** run `schedule` (Security
seg-cron + CodeQL ter-cron) em `main` termina em **`startup_failure` (0s, sem jobs)** em 10-05, 10-06, 10-12, 10-13,
10-19, 10-20 — ininterrupto. Antes de ~05-out os scheduled executavam (Security `failure` 14s, CodeQL `success`
4m13s, 09-14→09-21). `origin/main` sem push desde `dbd231e` (06-03) → casa com o auto-disable de ~60 dias de workflows
agendados por inatividade do GitHub. O gate de segurança automatizado do lado-GitHub **nem roda nem alerta**.

**Manchete-delta #3 — 1 REFUTAÇÃO + ~18 misses NOVOS.** Refutação: **`mark-no-show` NÃO é bug de código** — a spec
formal OpenAPI (`bevox-backend-v1.yaml:2229`) serve `/appointments/{id}/no-show` casando o handler
(`calendar/routes.ts:125-131`); só a **prosa** do PRD §10.1 l.971 diz `mark-no-show` (código↔contrato consistentes).
Misses NOVOS (todos verificados de fonte-primária): o mais relevante é **`metrics-public-org-id-enumeration`** (MÉDIO)
— `/metrics` é in-app **não-autenticado** (`health/routes.ts:24`, sem preHandler) e o counter
`bevox_backend_http_requests_total` é rotulado com `organization_id` real (`metrics.ts:33` + `bootstrap/server.ts:170`)
→ quem alcança `/metrics` enumera **todos os org-UUIDs ativos + volume por-org** (vazamento de isolamento ADR-021; único
controle é a network-policy externa). Também novos: **harness `buildDispatchMessages` sem LIMIT → payload-poison**
(GA-crítico), **`message_records` sem `created_at` de servidor** (retenção/DSR sem âncora temporal), **nenhum mecanismo
de captura de consentimento existe** (LGPD), **cobrança manual com `amount_total` sem teto → overflow `numeric(10,2)`
500** (alcançável no piloto), e mais ~12 (ver severidades).

**O piloto morre no passo 2 ("ver agenda") — inalterado e re-verificado por 2 agentes + orquestrador.** Veredito do
agente calendar: **o caminho do piloto NÃO é executável como semeado.** 1ª falha: o `seed-pilot` cunha JWT staff
**HS256** (`staff-auth.ts:70`), mas **toda** rota de calendar é `requireClerkAuth()` **RS256** (`clerk-auth.ts:90`) +
claim `organization_id` → **401 na primeira requisição de calendar**; o seed não provisiona principal Clerk nem row
`users`. Atrás desse gate: (b) `availability.ts:75 notFound("Calendar")` (seed não cria `calendars`); (c)
`professional_schedules` **sem escritor em todo o app** (grep: só o fixture `calendar-booking.test.ts:120`; símbolo
`weekly*` = 0) → `availability.ts:126 if(!sched) continue` → `slots:[]` → `booking.ts:207 slot_conflict` em 100%,
**app-wide, não corrigível por config**. backend/ADR-010 (calendar/WeeklySchedule) é **aceita** (`aceita_em 2026-04-22`)
→ os 2 CRÍTICOs são gap contra entidade canônica nomeada. **Fix mínimo ≈ 2-3h** (seedar Calendar + grade Seg-Sex) **mas**
o fechamento real do CRÍTICO-2 exige um **writer de WeeklySchedule** (rota/repo, ≈ 4-6h).

**Money-path manual do piloto FUNCIONA (integração verde: `payments-manual-mode.test.ts` 19/19), com 2 bugs HIGH
alcançáveis.** (1) `outbound-provider-vocab-mismatch` **(HIGH, o defeito confirmado mais danoso, alcançável NO piloto
via staff-approve)**: inbound persiste `"wa"`/`"ig"` (`normalize.ts:16,35,44`), outbound null-coage provider ≠ pleno
(`metaapi/repository.ts:197`) → `skipped_missing_recipient` → `isDeliveryFailure` exclui skips → execução fica `done`
(**falso-sucesso**); meta-api `origin/main` exige `z.enum(["whatsapp","instagram"])` (`messages/schemas.ts:7`) →
`wa`/`ig` é invenção 100%-backend; a métrica do skip loga `channel:"unknown"` (`seams.ts:373`) → cega o dashboard.
(2) `manual-remark-inserts-orphan-paid-payment` **(HIGH, irreversível)**: re-marcar paga uma charge
`expired`/`refunded`/`cancelled` → `markChargePaid` rowcount-0 **mas** `insertPayment`/confirm/grant rodam mesmo assim;
numa charge `refunded` o payment anterior está `reversed`, logo o UNIQUE(org,pid,**status**) não colide → payment
`paid` órfão fresco; depois **não-estornável** (`service.ts:499` exige `status==='paid'`). Fix = gatear os 3
side-effects no rowcount de `markChargePaid` (NÃO um status pre-check).

**Caminho de fechamento do piloto curto e inalterado:** 2 blockers de agenda (≈ 2-3h seed + ≈ 4-6h writer de grade) +
gate de CI (flaky ≈ 0,5h; audit ≈ 4-6h por 49 highs + re-enable do scheduled) + gate de auth-actor (ops Clerk, ou
~4-6h rota staff-scoped) ≈ **~1-1,5 dia**. Severidades ancoradas no gate do **piloto**; para GA vários ALTO/MÉDIO sobem
(vocab de canal, token-IDOR, o `status`-callback 404 ponta-a-ponta, `active_execution_id`-wedge, `buildDispatchMessages`
poison viram CRÍTICO de GA).

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária:

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`) — **não** `/complete,/artifact,/tool-result,/turn`
   como o brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (não "channels"). **Channels = _shared/ADR-011**.
   backend/ADR-018 = refund/cancellation policy (`aceita`). backend/ADR-023 = manual payment mode (`aceita`).
   backend/ADR-010 = calendar/WeeklySchedule (`aceita`). **backend/ADR-016 (token-billing) = `proposed`** → corretamente
   NÃO implementado. O range "0011 a 0018 Marco-1" do brief é aproximado; as ADRs aceitas vinculantes vão até 0023.
3. O grep `account_id\b` do brief captura compostos **sancionados** (`external_account_id`/`payment_account_id`/
   `channel_account_id`) + o alias financeiro `AS account_id` (`payments/repository.ts:1012,1018` — semântica Stripe,
   reservada por rule) + doc-comments do rename + snapshots drizzle + tipo gerado. O léxico proibido **executável** é
   **ZERO** (invariante §4.1 mantida — não-gap). Ver categoria c.
4. Código congelado desde **06-03** (`dbd231e`), não 06-04. `git describe HEAD` = `v1.0.1-33-g42360a4` (o `-33` são os
   commits de audit docs-only).
5. Numeração de ADR **colide** entre `backend/` e `_shared/` (008–023) — **sempre qualificada** abaixo.
6. **RBAC de staff é canon backend/ADR-013** (roles `bevox_admin|bevox_support|bevox_observer`), **não ADR-022**
   (backend/ADR-022 = policy-json sub-keys). A rule local `.claude/rules/backend-routes.md` mis-cita "ADR-022 staff
   RBAC" + nomes curtos + invoca o inexistente `requireRole` — ver BAIXO/governança.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 prontidão + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1483)** inclui literalmente `- [ ] Repositório bevox-backend criado;
  CI verde.` (lido verbatim hoje) ⇒ o único bloqueador **mensurável** de Marco-1 é **CI-verde (RED em Tests + Security)**.
- **§16.2 Marco-2** (calendar, conversations, messages, channels, ai-pipeline, autonomy; e2e; idempotência tools;
  métricas Prometheus; cobertura ≥70%). **§16.3 Marco-3** (payments Stripe Connect, reminders, faq, rules, audit,
  observabilidade completa; WhatsApp direto; **LGPD DSR/retenção/consentimento**; **MFA TOTP**; SLO; rate-limit
  distribuído).
- **Status de ADR lido de `origin/main` hoje:** backend/ADR-009/010/013/014/015/017/018/019/020/021/022/023 = **`aceita`**;
  backend/ADR-016 (token-billing) = **`proposed`** (corretamente não implementado); backend/ADR-011
  (criação-de-AISuggestion) = `pending`, porém **superseded** pelo colapso em ADR-019 (aceita). _shared/ADR-019
  (bases legais LGPD) + _shared/ADR-020 (retenção) aceitas.
- **Fato estrutural:** o código entrega muito além de Marco-1 — o README "Marco 1 bootstrap" **subdeclara** o que existe.
  O piloto exercita calendar + payments-manual (ADR-023 aceita) + o worker assíncrono independentemente do rótulo → os 2
  CRÍTICOs são **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-23) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO app-wide); **NOVO** `StatusHistory` entity ausente (§13.3/§8.4) + `appointments.created_by_*` ausente (§8.3); templates ADR-020 + priority-score ADR-021 não-materializados |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recontagem independente reproduzida: **103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 / 11 undoc**; **NOVO** `openapi:check` é parse-smoke, não validador; `mark-no-show` **REFUTED** (código↔contrato OK) |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO**; residual = composites sancionados + doc-comments + alias financeiro |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | `mfa.ts:34` blocklist + `seed-pilot.ts:153` gera base32 + `assertMfaSecretNotPlaceholder`; login sem MFA = **correto** (Marco-3, ADR-013); `CLAUDE.md §8` stale (doc) |
| e | Testes faltando (hot paths) | ✅ | webhook Stripe (`constructEvent`=0 em test/) / reconcile-cron (só unit mockado → 42703 CI-invisível) / availability-rota / inbound-vocab — zero e2e; integração manual-money verde (19/19) |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); **~11** TODOs todos Marco-2/3 |
| g | LGPD | ✅ | consent/`ai_opt_out` armazenado-não-aplicado (vetor vivo); **NOVO** nenhum mecanismo de captura de consentimento; `received_events`/`message_records` PII-cru não-apagável (+ `message_records` **sem `created_at`** → sem âncora de retenção); DSR deleção ausente, export incompleto |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main `delivery-tracker.yml`); nenhum work-item p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → grade CRÍTICA **invisível** ao tracker |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky) + Security RED **49 high / 109** (platô byte-idêntico 10-22); lint-RED = artefato local gitignored; scheduled CI dark no GitHub (confirmado multi-semana) |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + irreversível**; `reconcile-refund-42703` **estreitado a cron-only** (webhook vivo intacto); **NOVO** overflow `numeric(10,2)` em manual-charge; PCI-nil; conformances confirmadas |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH alcançável-no-piloto** + métrica-cega; **NOVO** audit duplicado em retry inbound; unknown-provider-silent-drop; null-tenant-500; HMAC correto |
| l | Harness dispatch | ✅ | `status`-callback **POST↔PATCH 404 total** (root-cause único); token-IDOR; `active_execution_id` wedge; **NOVO** `buildDispatchMessages` sem LIMIT → payload-poison; `stream` ausente do schema; todos inertes no piloto manual |
| m | Alçapões do piloto | ✅ (traçado) | **NÃO-executável como semeado**: 1ª falha = auth-actor 401; atrás, calendar-404 + grade-vazia app-wide; money-path manual OK com 2 bugs HIGH; worker-telemetry buraco-negro |
| n | Delta vs audit anterior | ✅ | 10-22 re-verificado; **1 refutação** (`mark-no-show`); Security platô byte-idêntico; scheduled-dark confirmado; ~18 misses/sharpenings NOVOS |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN (staff) — PASSA, classe de token errada.** `seed-pilot` cria org + `bevox_admin`; `POST /staff/sessions`
   cunha JWT staff **HS256** (`staff-auth.ts:70`). Só serve a rotas `requireStaff`. Sem rate-limit/lockout.
2. **VER AGENDA — QUEBRA na AUTH primeiro (401).** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`calendar/routes.ts:22`; `clerk-auth.ts:90`) + claim `organization_id` → token staff HS256 → **401**. Seed não cria
   principal Clerk nem row `users`. *Se JWT Clerk à mão:* → `availability.ts:75 notFound("Calendar")` (**CRÍTICO b**).
   *Se Calendar à mão:* → grade vazia app-wide (**CRÍTICO c**). Sem `GET /appointments` para ver a agenda sobre REST.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100%. **Main-path exactly-once É SÃO**
   (advisory xact-lock + recount in-lock + unique index + replay 23505; POST honra `Idempotency-Key`
   `routes.ts:88`). Reschedule/transition têm 6 defeitos de correção; create/reschedule/transition não gravam
   `audit_events` (§12.8) e não persistem actor (`created_by_*` ausente, **NOVO**).
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** Pré-requisitos escondidos (confirmados): serviço
   semeado sem `requiresPrepayment` → default `false` (`catalog.ts:67`; hook `booking.ts:275` nunca dispara) **e**
   `seed-pilot` não cria `payment_accounts` → precisa de `POST /payment-account/connect-manual` à mão (mesmo gate
   Clerk). **1 bug HIGH irreversível** re-mark de charge terminal; **NOVO** overflow 500 em `amount_total` ≥ 1e8.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile cru
   sem orquestração; **reconcile de refund DOA (42703) — estreitado a cron-only** (o webhook vivo `updateRefundStatus`
   omite `updated_at` → intacto). Crons **LIVE** (`queue/index.ts:143-151`). Modo manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[SHARPENED]`/`[NARROWED]`/`[REFUTED]` = status vs 10-22; **(v: …)** = verificação
(orquestrador fonte-primária, ou agente com evidência fresca); `[xrepo]` = dependência cruzada. Severidade ancorada no
gate do **piloto**; escalonamento p/ GA anotado. `file:linha` = evidência lida **nesta** sessão sobre código
byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO ×2 — agente calendar + agente schema)** — Nenhum
  caminho do app escreve `professional_schedules` (grade semanal-base). Único `INSERT` = fixture
  `test/integration/calendar-booking.test.ts:120` (SQL cru). Símbolo `weekly*` = **0 hits** em todo o repo. Produção só
  lê (`availability.ts:116`); `:126 if(!sched) continue` esvazia todo dia → `slots:[]` → `booking.ts:196/207
  slot_conflict`. A grade é **estruturalmente não-populável por qualquer org**. Escopo §5.3 (backend/ADR-010 **aceita**
  `aceita_em 2026-04-22`). — Impacto: 100% dos agendamentos = `slot_conflict`, app-wide. — Esforço: **4-6h**
  (rota+schema+repo+teste de WeeklySchedule) ou **2h** (só seedar grade como paliativo do piloto). **#1.**
  `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO ×2 — calendar + schema)** — `seed-pilot.ts`
  tem exatamente **4** `.insert(`: organizations (`:109`), staffAccounts (`:156`), professionals (`:195`), services
  (`:217`). Zero `calendars` → `availability.ts:75 notFound("Calendar")`. `createCalendar` existe
  (`calendar/repository.ts:20`) e está route-wired (`routes.ts:33` POST); o gap é "o seed nunca o chama e não há
  bootstrap não-HTTP". `professional_services` também não é semeado → availability cai no fallback "todos os
  profissionais bookáveis" (`availability.ts:91-96`). `system_holidays` omitido é **fail-open** (`:108-111`), não
  co-bloqueador. — Esforço: **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×2 + grep)** — seed provisiona **só** org
  + `staff_account` (HS256, `staff-auth.ts:70`); toda rota de calendar é `requireClerkAuth()` RS256 (`calendar/routes.ts:
  22,24`; `clerk-auth.ts:90`) + claim `organization_id` → token staff rejeitado 401. `grep requireStaff|requireRole
  src/modules/calendar/` = **0**; o seed não cria usuário Clerk nem row `users`. Gate de provisionamento Clerk/ops; sit
  **upstream** dos 2 CRÍTICOs. — Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-23; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice`** `[carry]` **(v: RODADO)** — `pnpm test:integration` = **RED exit 1**,
  `1 failed | 92 passed (93)` (`Test Files 1 failed | 13 passed (14)`). Falha = `calendar-booking.test.ts:259`
  "slot_conflict quando start_at < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be
  'slot_conflict'` — gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei ~09:05 UTC → `booked`. **Sem teardown
  57P01 desta vez** (10-22 teve ×1 — ruído de teardown testcontainers/ioredis permanece mas não falhou a suíte).
  `ci.yml` roda integração sem `continue-on-error`. — Esforço: **0,5h** (slot `now()`-relativo). **#2.**
- **`ci-security-red-pnpm-audit-49-high`** `[carry, platô byte-idêntico]` **(v: RODADO)** — `pnpm audit --audit-level
  high` = **RED exit 1, 109 vulns (8 low · 52 moderate · 49 high · 0 critical)** — **idêntico ao 10-22** (+0). 49 high
  em **19 módulos**: `@fastify/static`, `@grpc/grpc-js`, `@opentelemetry/{auto-instrumentations-node,exporter-prometheus,
  propagator-jaeger,sdk-node}`, `brace-expansion`, `braces`, `fast-uri`, `fastify`, `find-my-way`, `js-yaml`, `nanoid`,
  `postcss`, `protobufjs`, `source-map-js`, `tmp`, `undici`, `vite`. Highs prod-runtime no core do Fastify
  (`fastify`/`@fastify/static`/`find-my-way`/`fast-uri`). `security.yml` (`continue-on-error:false`) + `osv-scanner` →
  hard-fail. **Tendência 12→15→18→49→49→49: platô.** — Esforço: **4-6h** (bump OTel/fastify sob nota ADR-012 + `pnpm
  override` undici/tmp/vite/fast-uri/nanoid/brace-expansion). **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[carry, confirmado multi-semana]` **(v: orquestrador — `gh run list`)** — todo
  run `schedule` em `main` (Security seg-cron; CodeQL ter-cron) termina em **`startup_failure` (0s)** em 10-05/06/12/13/
  19/20 ininterrupto. Antes de ~05-out executavam (`pnpm audit`+`OSV` failure semanal; CodeQL success). `origin/main`
  sem push desde 06-03 → auto-disable de ~60 dias por inatividade. Gate de segurança agendado **nem roda nem alerta**. —
  Esforço: **0,2h** (um push/re-enable) — fix real é destravar o lockfile (acima). `[xrepo: GitHub Actions]`

**Canais / money — alcançável no piloto**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(v: CONFIRMADO — Security Engineer cross-repo;
  "defeito confirmado mais danoso")** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:16,35,44`) e
  persiste `"wa"` em `channel_connections.provider` (`routes.ts:237,246` → coluna `notNull()` **sem CHECK**,
  `channels.ts:22`). Outbound `findExecutionDeliveryContext` null-coage provider ≠ pleno (`metaapi/repository.ts:197`) →
  `ctx.provider=null` → guard `executions/seams.ts:360` → `skipped_missing_recipient` (`:376`); `isDeliveryFailure`
  exclui skips (`seams.ts:122-124`) → `complete-service.ts:100` fica `done` (falso-sucesso); a métrica loga
  `channel:"unknown"` (`seams.ts:373`). meta-api `origin/main` (`messages/schemas.ts:7 z.enum(["whatsapp","instagram"])`)
  exige enum pleno → `wa`/`ig` é invenção 100%-backend. **Alcançável NO piloto:** `deliverToChannel` ← `executions/
  service.ts:68` via `approve()` → staff aprova a resposta → drop silencioso. — Impacto: 100% das respostas a conversas
  inbound-semeadas descartadas em silêncio como `done`. — Esforço: **3-4h** (unificar vocab + CHECK + backfill + teste
  e2e). **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, irreversível]` **(v: CONFIRMADO — Security Engineer +
  orquestrador)** — `markChargePaidManually` **não** tem status-gate (`service.ts:422-433`; docstring `:415-416`
  proíbe-o por design); `applyChargePaid` chama `insertPayment` **incondicional** (`service.ts:890-891`) após
  `markChargePaid` (guardado `WHERE status='pending'`, void sem rowcount, `repository.ts:395-398`). Re-mark de `expired`/
  `refunded`/`cancelled` → `markChargePaid` rowcount-0 **mas** `insertPayment`+`confirmAppointmentIfUnconfirmed`(`:902`)+
  grant de pacote(`:915-919`) rodam; numa charge `refunded` o payment anterior está `reversed`, logo UNIQUE(org,pid,
  **status**) não colide → payment `paid` órfão fresco. Depois **irreversível**: `refundChargeManually` exige
  `status==='paid'` (`:499`), mas a charge ficou terminal → nunca estornável. Root-cause compartilhado alcança o path
  Stripe (`webhook-platform.ts`). Fix: `markChargePaid` RETURNING rowcount + gatear os 3 side-effects (NÃO um status
  pre-check). — Esforço: **2-3h**. **#4.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA ligar — INERTE no piloto manual)**

- **`harness-status-callback-method-mismatch-total`** `[carry, root-cause único]` **(v: CONFIRMADO byte-level nos 2
  repos + canon — harness agent + orquestrador)** — Harness `updateStatus` sempre **POSTa** (`bevox-callback.ts:28,141`;
  POSTa `running` e `dead_letter`), backend só registra **PATCH** `/status` (`harness-callbacks.routes.ts:56`) → **toda**
  chamada de status → Fastify **404**. Consequência: execuções nunca transicionam via sinal do harness;
  `applyStatusTransition` + `markExecutionDeadLetter` + toda a maquinaria ADR-019-Am1 são **código morto ponta-a-ponta**.
  Raiz = contradição do canon **PRD §10.1 POST (l.447) vs §10.4 PATCH (l.1076) + ADR-019 Am1 l.162**; backend é
  **canon-correto** (§10.4). **SHARPENED (v: harness agent):** a "2ª quebra" do 10-22 — worker `on('failed')` só loga
  (`queue/index.ts:267-269`) — é **over-statement**: esse worker roda jobs **backend-internos** (ingestion/cutoff/
  google/payments), **não** o executions-dispatch (harness consome nativamente); o único writer pretendido é
  `markExecutionDeadLetter` (PATCH-only), inalcançável **só** porque o harness POSTa. **Root-cause único, não dois.** Fix
  = **cross-repo** (harness→PATCH + errata canon §10.1). — Esforço: **~1,5h**. **#7.** `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry]` **(v: CONFIRMADO — harness agent)** — o preHandler
  resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:71,96`), mas **todo** handler
  age sobre o `:id` **da URL** (`harness-callbacks.routes.ts:73,91,113,142`) e **nunca** compara (`req.executionContext`
  só é atribuído — READ = 0). Token válido para A escreve em qualquer execução B (IDOR cross-execution/cross-tenant).
  Conformance `four-callbacks-token-gated` (token ruim→401) **permanece** (autenticidade ≠ autorização). **Inerte no
  piloto**; **CRÍTICO-GA**. — Esforço: **1h** (asserção `executionContext.execution_id === id` → 403). `[xrepo: bevox-harness]`
- **`dispatch-messages-unbounded-poison`** `[NOVO]` **(v: harness agent — N1)** — `buildDispatchMessages`
  (`orchestration/repository.ts:391-415`) seleciona **TODAS** as linhas de texto da conversa (sem LIMIT/truncation). O
  harness impõe `messages.max(100)` (`execution-handler.ts:642`), `content.max(8000)` (`:628`), `MAX_PAYLOAD_BYTES 256KB`
  (`:608`) → payload acima do teto = `UnprocessablePayloadError` (**poison, sem retry**). Qualquer conversa > ~100
  mensagens de texto: **todo** dispatch envenena → timeout-scan 120s (`repository.ts:425`) → handoff humano; a IA para
  em silêncio para sempre. — **Inerte no piloto manual; CRÍTICO-GA (1ª conversa longa quebra a IA).** — Esforço:
  **1-2h** (LIMIT/slice últimos-N + guard de tamanho por-msg). `[xrepo: bevox-harness]`
- **`completion-never-clears-active-execution-id`** `[carry]` **(v: CONFIRMADO — harness agent)** — só
  `releasePipelineClaim` (pre-dispatch-fail, `orchestration/repository.ts:231`) e `handoffConversationOnTimeout` (`:464`)
  nulam `active_execution_id`; `/complete`/`finalizeCompletion` e approve/edit/reject em `staff-ops` **nunca** o limpam
  (`actions.repository.ts:98` só re-aponta). Guard de dispatch exige `active_execution_id IS NULL` (`:196`) → qualquer
  1ª execução bem-sucedida trava a conversa (turno-2 nunca claima). — **Inerte no piloto manual**; **CRÍTICO-GA (IA
  single-turn)**. — Esforço: **3-4h**. `[xrepo: bevox-harness]`
- **`complete-failed-strategy-not-mapped-to-error`** `[carry]` **(v: CONFIRMADO)** — `strategy:"failed"`+proposals
  vazias → `inferSuggestionType→"reply"` (`complete-service.ts:21`); autonomous → `done`; manual/copilot →
  `waiting_approval`. Nunca `error`. Canon (backend/ADR-019 Am1 l.165-166) exige `error`. — Esforço: **2-3h**. `[xrepo]`
- **`complete-rejects-aborted-strategies-400`** `[carry]` **(v: CONFIRMADO — bug de HARNESS)** — harness emite
  `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2096-2100`); enum backend omite (`harness-callbacks.schema.
  ts:57-65`) → ZodError → 400 → harness dropa a completion (`:2155`). Canon fica com o backend (l.1104). — **~1h**
  (harness) + errata canon. `[xrepo]`
- **`complete-trusts-body-organization-id-over-authoritative-row`** `[carry]` **(v: CONFIRMADO — harness agent)** —
  `/complete` lê tenant do **body** (`harness-callbacks.routes.ts:150-154 bodyOrgId ?? row`) sem checar `=== existing.
  organization_id`; traces/stream usam a row (assimetria); com o token-IDOR = primitiva de escrita cross-tenant. — **1h**.
  `[xrepo]`
- **`backend-never-sends-skills-allowlist`** `[carry]` **(v: CONFIRMADO — harness agent)** — `cutoff.ts:75 skills:[]`;
  `staff-ops/actions.repository.ts:144 skills:[]`; `account_denied_tools` **nem existe** no `DispatchPayloadSchema`
  (`harness-dispatch.schema.ts:25-63`); harness trata `[]` como "todas as tools" (`permission-context.ts:40-42,67`) →
  PERM-05 é **no-op** e2e. — **Inerte no piloto**; CRÍTICO-GA. — Esforço: **4-8h**. `[xrepo: bevox-harness]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — route-reviewer + calendar)** — Não existe `GET
  /appointments` nem `/appointments/:id`; calendar GET expõe só `/calendars` (`routes.ts:28`) + `/availability` (`:48`).
  §10.1 não o enumera, mas persona mobile ("agenda do dia", PRD arch l.173) + Fluxo 3 (§8.3) exigem → agendamentos
  write-only sobre REST. — Esforço: **3-5h**. `[xrepo: PRD §5.3/§8.3]`

**Auth / segurança (Marco-1; alguns mitigados no piloto 1 org/1 admin) — todos CONFIRMADOS pelo agente RBAC**

- **`staff-jwt-secret-no-min-length`** `[carry]` **(v: CONFIRMADO)** — `env.ts:60 STAFF_JWT_SECRET: optionalString` (sem
  `.min()`); refine de prod é **presence-only** (`:205-206`) → secret de 1 char passa; `staff-auth.ts:70,75` assina
  HS256. Secret fraco = forjável offline → compromisso **total** do plano staff. O mesmo secret assina o JWT de `state`
  do Google OAuth (`calendar/google/oauth.ts:95,107`), **mas os dois planos usam audiences distintas e ambas
  verificadas** (`STAFF_AUDIENCE` `staff-auth.ts:36,84` vs `OAUTH_STATE_AUDIENCE` `oauth.ts:33,62`) → **não há replay
  cross-plane**; o risco compartilhado é o **piso de entropia** (uma chave fraca forja os DOIS independentemente). —
  Esforço: **0,5-2h** (`.min(32)` + idealmente `GOOGLE_OAUTH_STATE_SECRET` separado). **O buraco de segurança mais duro.**
- **`staff-login-no-ratelimit-no-lockout`** `[carry]` **(v: CONFIRMADO)** — `auth/routes.ts:90-101` login/refresh sem
  `preHandler`; sem contador/lockout (`service.ts:64-90`); `requireRateLimit` (`rate-limit.ts:146`) aplicado a **zero**
  rotas (grep); bcrypt cost 12 é o único freio → brute-force online contra `staff@example.com`. — Esforço: **2-4h**.
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — canon-reforçado)** — `requireRole` só existe como 3
  TODOs (`clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`); zero impl/caller; `clerk-auth.ts:109 role =
  … ?? "member"`. Rotas cliente mutantes (money, DELETE/PATCH professionals|services, PATCH org/settings+onboarding+
  autonomy, approvals, PII customers, waitlist) têm só `requireClerkAuth+requireOrganizationScope` → qualquer JWT
  org-member roda tudo intra-org (org-scope ainda bloqueia cross-org). **Canon ADR-013 l.143** manda middleware rbac por
  role — não entregue. Blast-radius baixo no piloto (1 org/1 admin). — Esforço: **1-2d**. `[xrepo: backend/ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO)** — `auth/repository.ts:221-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id) +
  `routes.ts:169-170 orgClaim = organization_id ?? clerkUserId`; webhook só trata `user.*`, sem `organization.created` →
  1º user de uma org inprovisionável. Mitigado no piloto (seed). — Esforço: **4-8h** (+ADR org-mapping). `[xrepo: Clerk]`
- **`clerk-jwt-no-aud-iss-validation`** `[carry, N: aud/iss-only]` **(v: CONFIRMADO)** — `clerk-auth.ts:89-92` verifica
  só `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim não-verificada
  (`:105-108`). **Nuance (v: RBAC):** jose **já** valida `exp`/`nbf` + pin RS256 — o gap é estritamente **aud/iss**, não
  expiração. — Esforço: **0,5-1h**.
- **`impersonation-audit-trail-absent`** `[carry, SHARPENED]` **(v: CONFIRMADO — RBAC + orquestrador)** —
  `auth/service.ts:135-139` seta claim `impersonation_id` ao PK da row `staff_impersonations`. O hook de audit de
  impersonation (`auth/routes.ts:70-87`) vive no plugin encapsulado `authRoutes` (`bootstrap/server.ts:198`), e staff-ops
  é registrado separadamente (`:213-215`) → **o hook nunca dispara** nas ações staff-ops; estas **são** auditadas
  (`actions.repository.ts:174-184`) **mas** gravam `actor_type='user'`, `actor_id=NULL`, e **nenhum `impersonation_id`**
  → a trilha impersonation→ação da ADR-013 l.109 está **ausente** (0 refs `impersonat` em staff-ops). `endImpersonation
  Session` (`service.ts:143-164`) **não revoga** o token HS256 (stateless ≤900s). **Downgrade (v: RBAC):** o sintoma "403
  sob impersonation" é **código morto** — nenhuma rota pareia `requireStaff`+`requireOrganizationScope`, logo o branch
  `organization-scope.ts:57` é vestigial; o defeito vivo é a **trilha ausente + token não-revogável**. — Esforço: **1-2d**.
  `[xrepo: ADR-013]`
- **`clerk-role-sourced-from-jwt-claim-vs-adr013`** `[NOVO]` **(v: RBAC — N3)** — `clerk-auth.ts:109` pega `role` da
  claim do token (controlada pelo Clerk); canon ADR-013 diz "Role … vive no `Users` do backend, não em Clerk". A role de
  DB (`req.user.role`) é resolvida mas **não usada**; um futuro `requireRole` que lesse `req.auth.role` confiaria em dado
  do client-plane. **GA-latente (authz trap)**; pilot=inerte. — Esforço: **M** (consumir `req.user.role`).
- **`clerk-provisioning-deprovisioning-unaudited`** `[NOVO]` **(v: RBAC — N4)** — `upsertUserFromClerk`/
  `deleteUserByClerkId` (`auth/repository.ts:229-246`, hard `DELETE` `:245`) gravam **zero** `audit_event`, enquanto a
  impersonation audita. Gap de forense de ciclo-de-vida de usuário + LGPD/retenção (ADR-020). **GA/quality**; pilot=low.
  — Esforço: **baixo**.

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real) — CONFIRMADOS pelo agente LGPD (9/9, 0 refutados)**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` **(v: CONFIRMADO — vetor vivo, headline LGPD)** — `ai_opt_out`
  gravado/lido só no CRUD de customers (`customers/repository.ts:21,26,67`; **zero** outros readers); default `false`
  (opted-IN, `customers.ts:50`); `cutoff.ts:49-76` + `buildDispatchMessages` (`orchestration/repository.ts:391-415`,
  `content_text` cru) + dispatch **sem** carregar o customer nem checar `ai_opt_out` → cliente que revoga consentimento
  ainda tem a conversa mandada ao LLM externo (transferência intl, _shared/ADR-019 item 7). — Esforço: **4-6h**. **#10.**
- **`no-consent-capture-mechanism`** `[NOVO]` **(v: LGPD — N2; distinto do "não-aplicado")** — `consent_granted_at` tem
  **zero writers**; **nenhum** endpoint/webhook registra consentimento, nenhum aviso no canal inbound. ADR-019 itens 5/6
  exigem consentimento + "mecanismo de revogação fácil e documentado"; o piloto ingere conversas reais **sem captura de
  base legal**. — **MÉDIO (pilot-live)**. — Esforço: **M (modelo de consentimento, Marco-3)**. `[xrepo: _shared/ADR-019]`
- **`customer-facts-is-private-unenforced-and-sensitive`** `[NOVO]` **(v: LGPD — N1)** — `is_private` gravado
  (`customers/repository.ts:125`) mas **nunca lido como filtro**; `listFacts:100-110` retorna todos os fatos (privados
  inclusive) a profile/facts/export; `fact_value`(≤4000)/`category` livres gravados via `POST /customers/:id/facts`
  (`routes.ts:76`, harness `ai_extracted`) **sem** checagem de base — fatos de saúde exigem ADR-019 item 4 (tutela) ou 5
  (consentimento específico). — **MÉDIO**. — Esforço: **M**. `[xrepo: _shared/ADR-019]`
- **`received-events-raw-payload-unscoped-un-erasable`** `[carry]` **(v: CONFIRMADO — LGPD + schema)** — `metaapi/
  routes.ts:201-212` persiste o envelope Meta cru (`payload_json`: wa_id/telefone/nome/texto) em `received_events`
  (`ingestion.ts:12-30`), que tem **zero `organization_id`, zero `customer_id`, zero `deleted_at`, sem FK**. Fora de toda
  cascade, omitido do DSR, un-joinável → sink de PII cru erasure-impossível. — Esforço: **6-8h**. `[xrepo: _shared/ADR-020]`
- **`message-records-content-un-erasable-omitted-from-dsr`** `[carry, SHARPENED]` **(v: CONFIRMADO — LGPD + schema)** —
  `message_records` (`ingestion.ts:32-56`) sem `organization_id`/`customer_id`, apesar de `content_text`(`:42`, egresso
  ao LLM) + `sender_snapshot_json`(`:47`) + `media_json`(`:48`); único FK `received_event_id ON DELETE set null`.
  **Correção (v: LGPD):** "un-joinável" é **overstated** — é joinável ao titular via `conversation_key`→
  `conversation_pipeline_state`→`conversations.customer_id`; mas é TEXT sem FK, sem org-scope, fora da cascade →
  DSR/erasure não consegue **targetar** as rows. **Compõe com NOVO `message-records-no-created-at`** (abaixo). §12.9
  l.1356. — Esforço: **6-8h**. `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` **(v: CONFIRMADO — grep global = ZERO)** — grep `legal_basis|
  consent_event|dsr_request|retention|pseudonym|message_archive` em `src/ db/ scripts/` = **0**; os 11 workers de
  `queue/index.ts` não purgam/pseudonimizam; sem `bevox.retention.worker`; `auth/repository.ts:99` **admite** em
  comentário "Hard-delete worker (canon ADR-020, ainda não landed)". — Esforço: **24-40h**. `[xrepo: _shared/ADR-020]`
- **`dsr-deletion-absent`** `[carry]` — único `app.delete` de recurso em `src/` é `services/routes.ts:50` **e**
  `professionals/routes.ts:53` (nenhum de titular); sem delete de customer; `deleted_at`/`archived_at`/`consent_granted_at`
  = **colunas triplo-mortas** (zero writers). DSR **export** EXISTE (`customers/routes.ts:97`) — só a **deleção** falta.
  — Esforço: **8-12h**. `[xrepo: _shared/ADR-020]`
- **`dsr-export-incomplete-omits-subject-data`** `[carry]` **(v: CONFIRMADO)** — `CustomerExport` (`customers/service.ts:
  77-110`) omite `preferences_json`/`risk_flags_json`/`consent_granted_at` + `messages`/`audit_events` hardcoded `[]`
  (`:107-108`) + **`customer_channels` inteiro** (`customers.ts:70-72`). — Esforço: **6-10h**.
- **`clerk-organization-deleted-unhandled-adr020-cascade-unwired`** `[carry]` **(v: LGPD)** — `auth/routes.ts:165-190`
  trata só `user.*`; sem `organization.deleted` → o trigger "término-de-contrato → cascade" da ADR-020 está **unwired**;
  e mesmo um delete manual da row org **não** purgaria `received_events`/`message_records` (sem org FK). — **fold
  ADR-020**. `[xrepo: _shared/ADR-020]`
- **`execution-traces-pii` / `google-calendar-intl-transfer` / `payments-raw-payload-json` / `customer-pii-mutations-
  unaudited` / `denormalized-customer-contact-snapshot`** `[carry]` **(v: CONFIRMADO, 3 sharpened)** — traces crus sem
  `customer_id` (`harness-callbacks.repository.ts:196-204`); Google sync empurra nome p/ US (`sync.ts:203,237`) — gap é
  **salvaguarda art.33/opt-out**, não "sem base" (sharpened); `payments.raw_payload_json` (`repository.ts:422-439`) é
  retenção fiscal 10yr legal → gap é **minimização/pseudonimização**, não deleção (sharpened); customers CRUD sem audit
  (`service.ts:29-39`); snapshots denormalizados (`calendar.ts:128-130,194-196`) onDelete set null → PII órfã. — 2-4h/ea.

### MÉDIO (degrada qualidade)

**Observabilidade — worker é buraco-negro (harness inerte no piloto, exceto obs que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry]` **(v: CONFIRMADO ×2; ALTO-operabilidade, exercitado-no-piloto)**
  — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca** `import "./instrument.js"` nem `initTelemetry()`
  (ambos só em `src/index.ts:17,30`; grep em queue/ = 0) → no worker o Sentry `captureException` (`:272,313`) é drop
  silencioso (`telemetry.ts:106-108` no-op) e o OTel NodeSDK nunca inicia p/ **toda a metade assíncrona** do piloto. —
  **1h** (import + `await initTelemetry()`). **Alto valor / baixo esforço. #6.**
- **`metrics-public-org-id-enumeration`** `[NOVO]` **(v: route-reviewer + orquestrador)** — `GET /metrics`
  (`health/routes.ts:24`) é in-app **não-autenticado** (sem preHandler; o comentário admite que o único controle é
  network-policy/proxy externo) e o counter `bevox_backend_http_requests_total` é rotulado com `organization_id`
  (`metrics.ts:33`), incrementado por-request com o UUID real (`bootstrap/server.ts:170 req.organizationId ?? "anon"`) →
  quem alcança `/metrics` enumera **todos os org-UUIDs ativos + rota/status/volume por-org** (vazamento de isolamento de
  tenant ADR-021). Passadas anteriores marcaram `/metrics` público como by-design mas **não** o label `organization_id`
  especificamente. — Impacto: enumeração cross-tenant se a network-policy falhar (ponto único de controle). — Esforço:
  **1-2h** (guard staff/interno OU drop do label). `[g; ADR-021]`
- **`worker-process-has-no-metrics-scrape-endpoint`** `[carry]` — `/metrics` servido só pelo HTTP server
  (`health/routes.ts:24`); o worker não sobe listener → counters prom-client do worker (reconcile `:88,114,...`)
  **permanentemente não-scrapáveis**. — **1-2h**.
- **`domain-prometheus-metrics-not-registered` + `domain-metrics-declared-but-never-emitted`** `[carry]` — `shared/
  metrics.ts` não registra os de §12.10 l.1365 / §13.3 l.588 (`charges_succeeded_total`, `appointments_no_show_rate`,
  `executions_pending_approval_count`, `executions_timeout_total`, `executions_total`, …); `metrics.ts:41 queueSize`
  nunca recebe `.set()` e `:52 messagesReceivedTotal` nunca `.inc()` (e o piloto exercita ingestão). — **2-3h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` — `realtime/publish.ts:8-12` união fechada a
  `execution.*`/`waitlist.offered`; `appointment.created`(§8.3)/`charge.updated`(§8.4/§10.1) **nunca** emitidos
  (`publishRealtime` em booking/payments = 0) → tela do profissional não auto-atualiza (o transporte SSE é são). — **2h**.

**Agenda — correção de dados quando exercitada (Marco-2; CONFIRMADOS pelo agente calendar)**

- **`status-history-entity-absent`** `[NOVO]` **(v: calendar — N1)** — §13.3 l.587 + §8.4 step9 mandam `StatusHistory`
  para Appointment/Charge/Conversation; grep `status_history|StatusHistory` em `src/`+`db/schema/` = **0** (sem tabela,
  sem writer). Transições de appointment (`booking.ts:445`) não gravam histórico → proveniência de transição
  irrecuperável. — **GA**. — Esforço: **M**.
- **`appointments-no-created-by-actor`** `[NOVO]` **(v: calendar — N2)** — §8.3 step3 exige `created_by_type='user',
  created_by_id=user.id`; `calendar.ts:105-177` não tem tais colunas e `booking.ts:234-243` as omite. Composto com
  `appointment-mutations-no-auditevent` → um agendamento manual carrega **zero proveniência de ator**. — **GA/quality**.
  — Esforço: **S-M**.
- **`appointment-mutations-no-auditevent`** `[carry]` — §12.8 l.1346 manda Appointment C/U/D → AuditEvent;
  `booking.ts:233-516` grava **zero** `audit_events` (só charge audita). — **3-4h**.
- **`reschedule-non-atomic-double-book` / `reschedule-self-overlap-always-conflicts` / `appointment-transition-no-state-
  guard` / `reschedule-thin-idempotency` / `reschedule-drops-metadata` / `reschedule-double-charge-on-prepaid`**
  `[carry]` — create+cancel em tx separadas (`booking.ts:373` vs `:390-414`); recount conta o appt antigo
  (`booking.ts:229` exclui só `'cancelled'`); UPDATE any→any (`:445`) → `cancelled→completed` decrementa pacote
  (`:486-499`); `idempotencyKey:undefined` (`:387`); metadata não copiado; double-charge em prepago (inerte, seed
  `requires_prepayment=false`). — 0,5-2h/ea.
- **`no-availability-422-collapsed-to-409`** `[NOVO]` **(v: calendar — N3)** — §8.3 distingue 409 (slot ocupado) vs 422
  (sem disponibilidade); `routes.ts:91-95` mapeia todo `slot_conflict`→409; `:108` admite "este repo não tem 422". —
  **quality**. — Esforço: **S**.
- **`availability-n1-count-plus-92day-serial-loop`** `[carry]` **(v: CONFIRMADO — GA-scaling/DoS)** — `availability.ts:167`
  COUNT(*) por-slot em loops aninhados; `routes.ts:52` itera `date_from..date_to` serial até 92 dias (`schemas.ts:29`).
  Auth-guardado, não rate-limited. Não pilot-blocking (1 prof). — **4-6h**.

**Contrato backend↔harness / money (mismatches; INERTES no piloto manual, ALTO/MÉDIO-GA)**

- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry, NARROWED]` **(v: CONFIRMADO ×3 — Security + schema +
  orquestrador)** — `reconcile.ts:254-259 UPDATE refunds SET status=…, updated_at = now()`, mas `refunds` **não tem**
  `updated_at` (`db/schema/payments.ts:149-172`; só `createdAt`; migrations 0011/0017/0019 não adicionam) → **Postgres
  42703** → `:262` catch → `failCount++` → status **nunca** sai de `pending` → reconcile de refund **DOA**. **NARROWED
  (v: Security):** o path vivo de refund Stripe usa `updateRefundStatus` (`repository.ts:476-484`) que **omite**
  `updated_at` → **não afetado**; só o cron de safety-net (stuck>1h) está morto — **não** é outage pleno do ledger de
  refund. CI-invisível (só unit mockado schema-less). **Fix = remover `updated_at=now()` de `:257`.** — **0,25h**.
  Stripe-path, inerte no piloto manual. `[xrepo: Stripe]`
- **`intent-reconcile-no-payments-row-null-paid-at`** `[NOVO]` **(v: Security — N3, sharpens reconcile-cron)** —
  `reconcile.ts:144-149` seta só `status`+`updated_at` (charges TEM `updated_at`); o path normal seta `paid_at`
  (`repository.ts:397`) e insere payment. Resultado: charge `paid` invisível às queries de posição-de-débito ADR-018 §9
  (que juntam `payments`), `paid_at` NULL, pacote não-concedido, appointment não-confirmado. — **GA** (Stripe-path,
  inerte no piloto). — Esforço: **M** (rotear por `applyChargePaid`).
- **`reconcile-cron-flips-paid-and-cancelled-without-orchestration` + `reconcile-cron-skips-applyChargeRefunded`**
  `[carry]` — `reconcile.ts:143-150` flip cru sem `applyChargePaid`; `:252-259` nunca chama `applyChargeRefunded` (viola
  ADR-018 §5 l.117). Manual pula (NULL provider_charge_id). — 2-3h.
- **`requires-prepayment-hook-throws-manual-mode`** `[carry]` — `booking.ts:275,299` hardcoda Stripe `createCharge`;
  conta manual (`external_account_id=NULL`) → `service.ts:189-193 lança`; caught best-effort (`:315-317`) → prepayment
  não coletado em orgs manuais (silencioso). — **2-3h**. `[xrepo: ADR-023 vs ADR-014]`
- **`completing-state-has-no-timeout-backstop` / `stale-token-blind-status-transition` / `trace-content-field-dropped`**
  `[carry, doubly-inert]` — `lockForCompletion` seta `completing` sem backstop de timeout; `applyStatusTransition` é
  UPDATE cego; `/traces` dropa `content`/`step`/`timestamp` — **mas** `sendTrace` tem **zero callers no harness** →
  `/traces` nunca invocado (doubly-inert). — 1-2h/ea. `[xrepo]`

**Schema (índices/materialização; GA-scaling — CONFIRMADOS pelo agente schema; inertes no piloto 1-org)**

- **`section-11-3-critical-indexes-partially-absent` + `fk-columns-without-index-systemic`** `[carry, +5 novos]` **(v:
  CONFIRMADO)** — ausentes `(org,status)`/`(org,start_at)`/`(org,customer_id)` em appointments/charges/executions (vs PRD
  l.1270-1276); ~40 FKs org_id sem índice; **NOVO (v: schema):** `execution_traces.organization_id`,
  `message_records.received_event_id`, `google_sync_outbox.appointment_id`, `buffer_windows.{conversation_id,
  channel_connection_id}`. Perf/cascade-cost latente, **inerte a 1 org**. Viola `backend-db.md`. — **3-4h** (uma
  migration). `[a/schema]`
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized`** `[carry]` **(v: CONFIRMADO)** — backend/ADR-020
  (`aceita 2026-05-21`) e backend/ADR-021 (`aceita 2026-05-21`) **não materializadas** (grep `message_template`/
  `urgency_level`/`skip_count` = 0). ADR-022 policy-json materializada (`catalog.ts:106-113`); ADR-023 = migration 0016.
  Doc-stale: a prosa de ADR-020 reservou "Migration 0016", mas 0016 é ADR-023. — ADR-020 **8h**; ADR-021 **6-10h**.
- **`waitlist-priority-score-client-settable`** `[carry]` **(v: CONFIRMADO — schema + calendar)** — raw-storage writable
  (`calendar.ts:204 numeric notNull default '0'`, sem CHECK) escrito do input na rota pública (`waitlist/routes.ts:71`),
  no PATCH (`:95→repository.ts:361 COALESCE`) **e** no seam de IA (`seam-tool.ts:44,83`), e `match` ordena por ele
  (`repository.ts:331 ORDER BY priority_score DESC`); `urgency_level`/`skip_count`/`last_score_update` + fórmula + cron +
  `CHECK(>=0)` **não existem** → furar-fila aberto. backend/ADR-021 (aceita) reconhece "priority_score é client-writable"
  como o defeito (Opção C). — Esforço: **2h** (CHECK + drop de input) a **6-8h** (fórmula+cron). `[a/g; ADR-021]`
- **`message-records-no-server-created-at`** `[NOVO]` **(v: schema — N2)** — `ingestion.ts:32-56` só tem o
  `message_created_at` externo (nullable); grep em todas as migrations = nenhum `created_at` de servidor. Sendo
  PII-bearing (`content_text`/`sender_snapshot_json`/`media_json`), **não pode ser envelhecido por tempo de ingestão** →
  sweeps de retenção/LGPD/DSR **não têm âncora temporal** (o irmão `received_events` tem `received_at`). Compõe
  `retention-worker-absent` + `message-records-un-erasable`. — **MÉDIO**. — Esforço: **S**.
- **`service-packages-validity-days-numeric`** `[NOVO]` **(v: schema — N1)** — `payments.ts:183` + `0011:96`:
  `validity_days` é `numeric` (unbounded, pg devolve string), deveria ser `integer`; `0015` converteu `sessions_*`→
  integer mas **deixou** `validity_days` (mesma classe de type-debt, miss de 10 passadas); também nullable sem
  `CHECK(>=0)`. — **LOW-MÉDIO**. — Esforço: **S** (um `ALTER … USING ::integer`, espelhar 0015).
- **`buffer-windows-no-updated-at` + `payment-accounts-professional-no-uniqueness`** `[NOVO]` **(v: schema — N3/N5)** —
  `buffer_windows` muta `state`/`message_count`/`latest_execution_*` sem `updated_at` (sem âncora de última-mutação);
  `payment_accounts.orgUniq` é parcial `WHERE account_holder_type='organization'` → nada impede contas `professional`-level
  duplicadas por `(org, professional_id)`. — **LOW/ea**.

**Canais — perda de inbound (CONFIRMADOS pelo Security Engineer)**

- **`inbound-audit-duplicate-rows-on-retry`** `[NOVO]` **(v: Security — N4; alcançável no piloto)** — o INSERT em
  `audit_events` (`metaapi/routes.ts:215-227`) não tem ON CONFLICT/idempotency (ao contrário de `received_events`
  `:211`); na falha de dispatch a dedupe key é DEL'd (`:280`) → o retry do Meta re-roda: `received_events` deduplica mas
  uma **segunda** linha `metaapi.event.accepted` insere por retry. — **quality** (inflação forense). **Alcançável no
  piloto.** — Esforço: **baixo** (ON CONFLICT, ou auditar dentro da tx de dispatch).
- **`inbound-dedupe-strand-onboarding-loss` / `null-tenant-audit-notnull-500` / `status-events-subscribed-but-ignored` /
  `inbound-unknown-provider-silent-drop` / `received-events-and-audit-written-non-transactionally`** `[carry]` **(v:
  Security; ref corrigida)** — SETNX antes do persist (`routes.ts:174`) + throw tenant-unmapped (`:190`) → key strandada
  → retry `replayed` → perdido; `tenant_id` nullable (`schemas.ts:38`) → audit INSERT org=NULL em coluna notNull
  (`audit.ts:24`) → 23502→500→perdido; os 5 tipos de evento vivem em **`metaapi/schemas.ts:16-22`** (correção: não
  `server.ts`) mas só `message.received` é tratado (`routes.ts:234`) → `message.status_updated` (FAILED outbound) sem
  handler; `"unknown"` provider (`normalize.ts:47`) → persistido+200 mas nunca dispatchado, sem skip-audit; dois
  `db.execute` sem tx (`routes.ts:202,215`). — 1-8h/ea. `[xrepo: bevox-meta-api]`

### BAIXO (higiene)

**Money / schema — misses novos de baixo risco**

- **`manual-charge-amount-unbounded-overflow-500`** `[NOVO]` **(v: Security — NEW-1; alcançável no piloto)** — `manual.ts:31
  z.number().finite().positive()` (sem `.max`/`.multipleOf`); `createManualCharge` (`service.ts:377`) escreve `.toFixed(2)`
  em `charges.amount_total numeric(10,2)` (teto 99.999.999,99); rota `payments/routes.ts:284-287` sem bound. Amount ≥ 1e8
  → Postgres 22003 → **500 opaco** (não 400 limpo); sub-cent silenciosamente arredondado. **Alcançável no piloto**
  (staff fat-finger). — Esforço: **trivial** (`.max(99_999_999.99).multipleOf(0.01)`).
- **`manual-charge-currency-unvalidated`** `[NOVO]` **(v: Security — NEW-2)** — `manual.ts:33 z.string().default("BRL")`
  (qualquer string, não upper-case); `charges.currency` (`payments.ts:92`) é `text` NOT NULL **sem CHECK**; a matemática
  de centavos assume 2 casas everywhere → moeda 0-/3-decimal mis-computaria refund/over-refund guard. — **GA** (BRL-only
  V1 → inerte no piloto). — Esforço: **trivial** (enum ISO-4217 + `toUpperCase`).
- **`received-events-no-org-column`** `[NOVO/overlap]` **(v: Security — NEW-5)** — `db/schema/ingestion.ts receivedEvents`
  sem coluna `organization_id` → envelopes inbound crus persistem un-tenant-scoped (sobrepõe o achado LGPD de PII-não-
  apagável; flag específico da coluna org ausente). — **GA/quality**.
- **`staff-role-stale-cache-at-login` / `bcrypt-72-byte-truncation`** `[NOVO]` **(v: RBAC — N1/N2)** —
  `findActiveStaffByEmail` é cache-aside 300s (`repository.ts:19-20,54-66`) e `loginStaff` cunha a sessão com a role
  **cacheada** (`service.ts:89`; invalidação-on-role-change é requisito FUTURO não-wired `:90-101`) → mudança de role
  visível só ≤300s depois (refresh é DB-direct, não afetado); `schemas.ts:20 password.max(512)` + bcrypt ignora bytes >72
  silenciosamente + `min(1)` sem piso de força. Ambos pilot-inertes (1 admin / senha semeada). — S/ea.

**Auth / harness / obs (resíduos — todos BAIXO/latente/inerte)**

- **`staff-session-no-logout` / `staff-login-user-enumeration-timing` / `staff-refresh-tokens-no-expiry-sweep` /
  `clerk-provisioned-role-hardcoded-operator` / `clerk-resolvelocaluser-fail-open-authz-trap` / `staff-access-token-no-
  live-revocation` / `staff-refresh-no-reuse-detection` / `clerk-webhook-unknown-type-silent-200`** `[carry]` **(v:
  CONFIRMADO — RBAC)** — sem logout/revoke (`service.ts:99-101`); enum-timing (throw antes do bcrypt `:68-71`); refresh
  expirados nunca varridos; `upsertUserFromClerk` insere `'operator'` e ON CONFLICT não atualiza role
  (`repository.ts:236-240`); `resolveLocalUser` fail-open em erro de DB (`clerk-auth.ts:126-139`); token staff stateless
  ≤900s; rotação delete-então-emite sem reuse-detection; webhook sem `else` → 200 silencioso (`routes.ts:165/186`). —
  S/ea.
- **Harness resíduos** `[carry]` — `complete-returns-409-not-410` (`routes.ts:160`); `complete-skips-redis-stream-del`
  (**subsumido pelo NOVO `stream`-field-absent** abaixo — stream nunca bufferiza); `complete-done-path-omits-execution-
  updated-sse`; `harness-ignores-callback-base-url`; `deadletter-overwrites-rejected-expired` (moot, 404); `status-meta-
  stripped` (sem `.passthrough()`, moot); `canon-strategy-enum-stale`(workflow) + `proposal-action-enum-drift`(waitlist-add)
  (canon-doc; backend+harness concordam). — 0,25-0,5h/ea. `[xrepo]`
- **`dispatch-stream-field-absent-streaming-unactivatable`** `[NOVO]` **(v: harness — N2)** — o gate do harness
  (`execution-handler.ts:1249`) exige `payload.stream === true`; o backend omite `stream` do `DispatchPayloadSchema`
  (`harness-dispatch.schema.ts:25-63`) + `dispatcher.ts:91-104` → a rota `/stream`, o buffer Redis `stream:{id}` e a SSE
  `execution.stream` são **código morto**. — quality/GA. — Esforço: **S-M**. `[xrepo]`
- **`dispatch-default-model-validation-asymmetry`** `[NOVO]` **(v: harness — N3)** — backend tipa
  `default_model: z.string().min(1)` (`harness-dispatch.schema.ts:51`) sem charset/length/provider; harness exige
  `isValidModelString` (≤64 chars, provider ∈ {openai,gemini,anthropic}) → uma agent-row com provider não-allowlisted
  (bedrock/azure/xai) ou >64 chars = poison. O default `env.ts:73 "openai/gpt-4o-mini"` é válido. — quality/latente. — **S**.

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recontagem 103/106/80/95/0/0/11)**

- **`openapi-check-is-not-a-validator`** `[NOVO]` **(v: route-reviewer)** — `pnpm openapi:check` =
  `openapi-typescript … --output -` (`package.json:32`) = **parse-smoke, não validador** (sem spectral/redocly); exit 0
  prova só que o YAML parseia → **nenhum** step de CI pega os 11 undoc/drifts de enum (composto com `mode:'static'` + sem
  binding de rota). — **governança**. — Esforço: **1h** (adicionar validador real ao CI).
- **`openapi-drift-undocumented-handlers` (11)** `[carry]` **(v: CONFIRMADO — route-reviewer 11/11)** — GET
  /customers/{id}/export; GET/PATCH /autonomy; GET /channel-connections; GET/PATCH /payment-account/policy; GET
  /api/v1/realtime; POST /webhooks/stripe; /stripe/platform; POST /webhooks/google; GET /webhooks/google/callback
  (`yaml:2510` é só prosa-comment). — **2-3h**. **#9.**
- **`no-mechanical-route-zod-openapi-binding`** `[carry]` **(v: route-reviewer — root-cause)** — ZERO rotas usam a opção
  `schema:` do Fastify; sem `ZodTypeProvider`/`serializerCompiler`; 138 `.parse()` inline; OpenAPI 100% YAML estático →
  razão estrutural de todo drift de categoria b. Fix = `fastify-type-provider-zod` OU gerar YAML das rotas em CI (requer
  ADR). — **M-ALTO**.
- **`handlers-outside-routes.ts` (4) / `openapi-missing-operationid` (0/95) / `status-callback-missing-dead_letter` /
  `enum-create-refund-missing` / `status-callback-response-shape-drift` / `complete-200-response-underspecified` /
  `sse-documentation-asymmetry` / `checkout-vs-payment_link-3-way-divergence` / `error-envelope-dual-schema` /
  `rate-limit-429-undocumented` / `sse-realtime-header-auth-contract`** `[carry + 1 NOVO]` **(v: route-reviewer)** —
  webhooks fora de `*routes.ts` (viola §5); enum status `yaml:298` sem `dead_letter` (Zod `schema.ts:16`, branch vivo
  `routes.ts:75`); `ExecutionProposal.action` `yaml:324-330` omite `create-refund` (executado `complete-service.ts:25`);
  dead_letter handler retorna `{ok,outcome}` vs YAML `{ok}` (`yaml:1843`); **NOVO** `/complete` 200 modelado
  `additionalProperties:true` (`yaml:1918-1919`) vs handler `{ok,status}` (`routes.ts:199`); SSE cliente undoc; checkout
  3-way (`charge-intent.ts:87` vs `yaml:2602` vs DB CHECK `payments.ts:113` com `payment_link`); `Error`(sem request_id
  `yaml:104`) vs `ErrorEnvelope`(`:138`) enquanto handler sempre emite request_id (`error-handler.ts:55`); 429 não
  documentado; SSE só aceita `Authorization: Bearer` → `EventSource` do browser não autentica. — 0,25-2h/ea.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: CONFIRMADO — orquestrador)** — tags só
  `v1.0.0`/`v1.0.1`; `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora (incl.
  dispatch amendment); `release.yml` dispara só em `v*.*.*` → **nenhuma imagem (SemVer OU sha) pós-`v1.0.1`**. Versão
  diverge **4-way**: `package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1` / hub `vX.Y.Z`. — **0,5-1h** (cortar tag).
  `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: CONFIRMADO — orquestrador)** — `src/integration/resolve-organization-id.ts`
  **NÃO existe** (bridge colapsada SP-3) mas é citado como vivo em `README.md:84`, `backend-tenancy.md:28`,
  `backend-routes.md:34`, `PostToolUse-tenancy.sh:11`, `engineering-backend-architect.md`; `CLAUDE.md §8` (l.171) diz
  seed grava `PILOTSEEDONLYNOTASECRET` (real gera base32 + blocklist `mfa.ts:34`); `backend-tests.md` cita "5 falhas FK
  #36" (suíte passa 92/93, harness-contract(12)✓); `backend-harness-contract.md`/`backend-workers.md` dizem `dead_letter`
  via `worker.on('failed')` do backend (**errado** — é via PATCH, e o worker só loga jobs internos); `backend-db.md` diz
  `on delete restrict` (código+canon = **cascade**, §11.2 l.1203). — 0,3-0,5h/ea.
- **`rule-backend-routes-staff-role-and-adr-miscite`** `[carry]` **(v: CONFIRMADO — RBAC)** — `.claude/rules/
  backend-routes.md` declara staff roles `bevox_admin | support | observer (canon: ADR-022 staff RBAC)`: triple-errado
  (nomes curtos; staff RBAC = **backend/ADR-013**; invoca o inexistente `requireRole`). — **0,25h**.
- **`stray-gap-workflow-js-scratch-accumulation`** `[carry]` **(v: CONFIRMADO)** — 5 `.claude/state/gap*.js`
  (gap0704/0709/0714/0715/0717, jul, gitignored — `git check-ignore` confirma) → **zero impacto em CI**; só fazem `pnpm
  lint` **local** dar RED (5 erros). Esta sessão NÃO adicionou nenhum. — **0,1h** (`rm`).
- **`codeql-upload-never-noop` / `release-no-provenance-sbom` / `adr-number-collision-cross-namespace`** `[carry]` —
  `codeql.yml:26 upload:never`; `release.yml` sem provenance/sbom/cosign; ADR 008-023 colidem backend/_shared. — 0,2-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária)

- **`legacy-lexicon-clean`** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/`db/`: executável
  **ZERO**. Bare `workspace_id`/`workspaces` = doc-comments do rename; residual `account_id` = composites sancionados
  (`external_/payment_/channel_account_id`) + alias financeiro `AS account_id` + snapshots drizzle/tipo gerado.
  Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153` `generateMfaSecret()` base32 + `assertMfaSecretNotPlaceholder`;
  `mfa.ts:34` blocklist inclui `pilotseedonlynotasecret`; `auth/service.ts:84-88` sem MFA check (correto — TOTP é
  Marco-3 ADR-013). **NÃO implementar "rejeitar sentinel no login".** CLAUDE.md §8 stale (doc).
- **`mark-no-show-is-not-a-code-bug`** `[REFUTED, NOVO]` — a spec formal OpenAPI serve `/appointments/{id}/no-show`
  (`yaml:2229`) casando `routes.ts:125-131`; só a prosa PRD §10.1 l.971 diz `mark-no-show`. Código↔contrato consistentes.
  Não re-flagar.
- **`booking-main-path-exactly-once-sound`** — advisory xact-lock + recount in-lock + unique index + replay 23505
  (`booking.ts:225-263`); POST honra `Idempotency-Key` (`routes.ts:88`). Integração `payments-manual-mode` 19/19 verde.
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc`=0); decimal `numeric(10,2)`; webhooks dedupe-aware
  (`webhook-platform.ts:90-97`+unique `payments.ts:239`); over-refund replay-safe; cross-tenant paid-flip impossível
  (`webhook-platform.ts:67-73` org-scoped); ambos webhook-secrets `requiredInProd` (`env.ts:200,203`);
  `money-mutation-http-idempotency` by-design (`manual.ts:109`+`provider_payment_id=manual:<id>`+ON CONFLICT).
  `reconcile-refund-42703` **narrowed a cron-only** (webhook vivo intacto). `pix-split` 2 endpoints vs ADR-014 um (ambos
  `requiredInProd`, sem gap de prod).
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:65,69,94`). Coexiste com o
  token-IDOR (autenticidade ≠ autorização). `idempotency-on-callbacks` **REFUTED** (é state-machine, `/complete`→409).
- **`dispatch-amendment-faithful-to-canon`** — `deadline_ms`/`original_execution_id`/`dead_letter` (`harness-dispatch.
  schema.ts:58,62`) byte-faithful ao canon PRD §10.4 Am1. Runtime dead_letter quebrado só pelo 404 (harness-side).
- **`hmac-verification-correct`** — `metaapi/service.ts:44-55` (`timingSafeEqual`+length+±300s); Stripe `constructEvent`
  (`webhook-platform.ts:40-47`); Clerk svix; Google HMAC timing-safe todos corretos. Os 5 webhooks verificam assinatura
  antes de agir.
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer`; `requireStaff({roles})`→403 (confirmado no log de integração: observer→403, admin→200);
  `TEST_AUTH_BYPASS` double-guarded; secrets staff DB-direct.
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` é **canon-correto** (§11.2 l.1203; `backend-db.md`
  "restrict" stale); timestamptz everywhere; CHECK (`end_at>start_at`, `sessions_remaining>=0`, `confidence∈[0,1]`);
  `ai_suggestions` dropada em 0005; sessions numeric→integer em 0015; `agent_configs`/`organization_meta_api_tenant` têm
  `organization_id` como **PK** (indexados). `uuidv7-sql-default` pós-0000 ausente é **fail-CLOSED** (pura hygiene;
  `$defaultFn` sempre supre v7 — distinto do `newOpaqueId()` UUIDv4 dead-code `staff-auth.ts:138`).
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (origin/main): 10 delivered (aisuggestion,
  staff-rbac, m4-chatwoot-p1..4, m5-p4-manual-payment, m5-p3c-multimedia-consume [auto-declara "5 LGPD prod gates
  pending"], m5-p3a-refundpolicy, m5-p3b-create-refund) + `backend-psp-br-secondary` parked (Marco 6). **Nenhum
  work-item** p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021. **Code
  DRIFTS:** calendar + customer_facts materializados-mas-não-trackados; templates + priority-score nem coded nem
  trackados → a grade CRÍTICA é **invisível ao tracker**.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do piloto
+ 1 dos 2 jobs de CI vermelhos**.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) + fechar teardown `closeDb()/closeRedis()` | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado não autentica no calendar (gate upstream dos CRÍTICOs) |
| 4 | **`pnpm audit`: bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**49 highs**, core do Fastify) e re-acende o scanner agendado (dark desde ~out) — completa "CI verde" |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e | **3-4h** | **Alcançável NO piloto via staff-approve**: faz a resposta chegar ao cliente (hoje dropada em silêncio como `done`) |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + subir `/metrics` no worker | **1-2h** | Fecha o buraco-negro (Sentry/OTel/Prometheus) de TODA a metade assíncrona que o piloto roda |
| 7 | **Gatear `insertPayment`+side-effects no rows-affected de `markChargePaid`** | **2-3h** | Fecha o bug HIGH de dinheiro **irreversível** alcançável no money-path manual (re-mark órfão) |
| 8 | **`.min(32)` no `STAFF_JWT_SECRET`** (+ chave separada p/ Google OAuth state) + `requireRateLimit` no `/staff/sessions[/refresh]` | **~3,5h** | Fecha o buraco de auth mais duro (admin forjável, piso de entropia em 2 planos) + brute-force do admin semeado |
| 9 | **Vincular token de callback ao `:id`** (`executionContext.execution_id === id` → 403) + **remover `updated_at=now()` do reconcile de refund** (`reconcile.ts:257`) + **guard/label-drop no `/metrics`** | **1,5h** | Fecha o IDOR cross-execution + destrava o reconcile-cron (42703 DOA) + fecha a enumeração de org via `/metrics` |
| 10 | **Aplicar gate `ai_opt_out`/consent em `cutoff.ts`/dispatch + Google sync + capturar `consent_granted_at`** + hidratar DSR export (incl. `customer_channels`) | **6-10h** | LGPD (piloto roda com PII real; hoje o flag é ignorado, não há captura de consentimento, PII cru não-apagável) |
| — | Higiene batch: `GET /appointments`; versão/tag SemVer (22 commits); `buildDispatchMessages` LIMIT (poison-guard); reconcile-cron `applyChargePaid/Refunded`; audit+`created_by` de appointment (§12.8/§8.3); StatusHistory; harness `status`-method POST→PATCH (cross-repo); docs stale; `rm .claude/state/gap*.js`; `operationId`+enums+validator OpenAPI; índices FK (uma migration); `amount_total.max`+currency enum | **~20h** | "Ver agenda" + governança + contrato harness + perf GA + LGPD-audit + money-hardening |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status`-callback POST vs PATCH 404 total** (root-cause
  único; backend canon-correto §10.4+ADR-019 Am1; fix harness→PATCH + errata canon l.447); **NOVO** `buildDispatchMessages`
  sem LIMIT → poison (harness caps 100/8000/256KB); `aborted_*`→400 (bug harness), `strategy='failed'`→não-`error` (bug
  backend), skills-allowlist vazio, `stream`-field ausente, `default_model` sem validação, `trace content` descartado
  (doubly-inert), `callback_base_url` ignorado, token-IDOR, `active_execution_id`-wedge. Mitigante: harness **inerte** no
  piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` no fio
  (`messages/schemas.ts:7`) confirma que `wa`/`ig` do backend causa o drop de outbound; retries de webhook amplificam a
  perda de inbound (dedupe-strand + null-tenant-500 + unknown-provider-silent-drop + audit-duplicado-por-retry).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um
  principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona.
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`); refund manual
  não passa por webhook; o reconcile de refund Stripe está **DOA (42703), mas narrowed a cron-only** (webhook vivo
  intacto). Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer auth interativa — indisponível nesta
  sessão headless** (reportado; não bloqueante para auditoria de código).
- **canon** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score) não-implementadas; _shared/ADR-019
  (bases legais → gate consent + captura de consentimento = código local), _shared/ADR-020 (retenção → scoping de
  message_records/received_events, `created_at` de servidor, retention worker, DSR deletion, `message_archive`). Drifts
  "canon-atrás-do-código" (webhook §10.3, `strategy='workflow'`, `/status` POST↔PATCH l.447, `create-refund`,
  `dead_letter` no enum, `waitlist-add`) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1` (sem os 22
  commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem principal Clerk);
  **a network-policy do `/metrics` é o único controle do vazamento de org-UUID** (vive no hub infra).
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` (inatividade ≥60d) → gate agendado dark.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs são
  invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-22)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/
db/` **vazio**; `HEAD` = o commit do próprio audit 10-22 (ontem).

**Ground-truth (mensurável):**
- **`ci-security` PLATEAUOU byte-a-byte**: **109 vulns / 8 low / 52 moderate / 49 high** hoje — **idêntico ao 10-22**
  (**+0 em tudo**; mesmos 19 módulos). 1ª passada em que o número de segurança **não se moveu** (10-21→10-22 foi +3
  total). Tendência **12→15→18→49→49→49**.
- **`ci-tests`**: RED idêntico (mesmo flaky `booking_notice:259` rodado ~09:05 UTC); **sem** o teardown 57P01 desta vez
  (×0 vs ×1 no 10-22).
- **`ci-scheduled-runs-dark`**: NOVO no 10-22, agora **confirmado padrão multi-semana** (startup_failure ininterrupto
  10-05→10-20).
- fast-gate GREEN idêntico (Typecheck/Format/OpenAPI-parse/Build/Unit 469/469).

**1 REFUTAÇÃO (vs 2 no 10-22):**
- **`mark-no-show` → REFUTED como bug de código**: a spec formal OpenAPI serve `/appointments/{id}/no-show` casando o
  handler; só a prosa PRD diz `mark-no-show`. (O route-reviewer também auto-refutou um candidato "edit/reject strict-vs-
  open" — YAML tem `additionalProperties:false` casando Zod `.strict()`; nunca esteve no inventário.)

**~18 misses/sharpenings NOVOS (todos verificados de fonte-primária):**
1. `metrics-public-org-id-enumeration` (MÉDIO) — `/metrics` não-autenticado + label `organization_id` → enumeração
   cross-tenant (ADR-021).
2. `dispatch-messages-unbounded-poison` (GA-crítico) — `buildDispatchMessages` sem LIMIT → `UnprocessablePayloadError`
   (poison) na 1ª conversa longa → IA para em silêncio.
3. `no-consent-capture-mechanism` (MÉDIO/LGPD) — `consent_granted_at` zero writers; nenhum endpoint captura consentimento.
4. `customer-facts-is-private-unenforced-and-sensitive` (MÉDIO/LGPD) — `is_private` nunca lido; fatos de saúde sem gate.
5. `message-records-no-server-created-at` (MÉDIO/schema) — PII sem âncora temporal → retenção/DSR estruturalmente
   impossível de envelhecer.
6. `status-history-entity-absent` (GA) — §13.3/§8.4 StatusHistory nem existe.
7. `appointments-no-created-by-actor` (GA) — §8.3 step3; agendamento manual sem proveniência de ator (compõe no-audit).
8. `manual-charge-amount-unbounded-overflow-500` (quality, pilot-reachable) — `numeric(10,2)` 22003 → 500 opaco.
9. `inbound-audit-duplicate-rows-on-retry` (quality, pilot-reachable) — audit sem ON CONFLICT → dup por retry do Meta.
10. `intent-reconcile-no-payments-row-null-paid-at` (GA) — flip `paid` sem row em `payments`/`paid_at`.
11. `clerk-role-sourced-from-jwt-claim-vs-adr013` (GA-latente) — role da claim do token vs "role vive no Users".
12. `clerk-provisioning-deprovisioning-unaudited` (GA/LGPD) — hard DELETE sem audit_event.
13. `dispatch-stream-field-absent` (quality/GA) — `stream` ausente do schema → streaming código-morto.
14. `dispatch-default-model-validation-asymmetry` (quality) — backend min(1) vs harness allowlist de provider.
15. `service-packages-validity-days-numeric` (LOW-MED) — 0015 esqueceu de converter; type-debt de 10 passadas.
16. `buffer-windows-no-updated-at` + `payment-accounts-professional-no-uniqueness` + 5 FKs sem índice (schema LOW).
17. `staff-role-stale-cache-at-login` + `bcrypt-72-byte-truncation` + `currency-unvalidated` + `received-events-no-org-
    column` + `complete-200-response-underspecified` + `openapi-check-is-not-a-validator` (BAIXO).
18. LGPD latentes: `redaction-allowlist-omits-content-pii`, `sentry-no-beforesend-scrubber`, `no-children-data-art14`.

**Sharpenings / de-escalações importantes (além da refutação):**
- **`reconcile-refund-42703` NARROWED a cron-only** — o path vivo de refund Stripe (`updateRefundStatus`) **omite**
  `updated_at` → progride normalmente; só o cron de safety-net está DOA. Não é outage pleno do ledger (vs framing do 10-22).
- **`harness-status-404` = root-cause ÚNICO** — a "2ª quebra" (worker `on('failed')` só loga) é over-statement: esse
  worker roda jobs backend-internos, não o executions-dispatch. Downgrade de "2 quebras" para 1.
- **`message_records` é joinável** ao titular via `conversation_key` (o "un-joinável" do 10-22 é overstated); o risco
  real (sem FK/org-scope/cascade, DSR-untargetable + **sem `created_at`**) permanece.
- **`impersonation` 403-symptom = código morto**; o defeito vivo é a trilha de audit ausente + token não-revogável.
- **`clerk-jwt` gap é aud/iss-only** (jose valida exp/nbf).
- Correções de evidência: "**89 code-paths**" não é reproduzível (load-bearing = 103 call-sites / 106 runtime-ops); o
  worker count é **11** (não 13); a enumeração de 5 event-types vive em `metaapi/schemas.ts:16-22` (não `server.ts`); o
  arquivo de assembly é `src/bootstrap/server.ts`.

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH alcançável-no-
piloto + métrica-cega); `manual-remark orphan` (HIGH irreversível); `reconcile-refund-42703` (narrowed); `callback-token-
IDOR`; `rbac-org-role`; `clerk-provisioning`; os mismatches de `/complete` + o `status`-method 404 + `active_execution_id`;
toda a bateria LGPD; autonomia/observabilidade; priority-score/reminders/templates Marco-2/3; a staleness `.claude`/
CLAUDE.md/README; version-drift (22 commits, nenhuma imagem pós-`v1.0.1`); scheduled-CI-dark.

**Arco desde a passada mais antiga (06-02):** os **3 CRÍTICOs originais** (persistir telefone/`wa_id` no intake;
`seed-pilot` executável em prod/migrator; testes de integração de booking) foram **fechados/recaracterizados**; os 2
CRÍTICOs atuais (grade + calendar no seed) emergiram ~06-23 e **persistem há ~4 meses**; o gate auth-actor foi isolado no
07-20 e re-confirmado 6×. **A frente de CRÍTICOs está estável e sem correção há ~4,5 meses; a dívida de segurança do
lockfile atingiu platô (49 high) e o scanner agendado do GitHub está dark.**

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a
**re-verificar de fonte-primária** o inventário do 10-22 do seu domínio contra o **código atual** com evidência fresca
`file:linha`, a **REFUTAR** superestimações, e a caçar misses. **5 usaram agent-types locais** deste repo
(`.claude/agents/`): `harness-callback-auditor` (l), `backend-staff-rbac-reviewer` (auth), `backend-schema-migration-
engineer` (schema/índices/tracker h), `backend-route-reviewer` (b), `Security Engineer` (payments j + channels k); **2
general-purpose** (LGPD g; calendar/pilot/obs a+m + autonomia). **Resultado agregado: ~90 itens re-confirmados, 1
refutação de código, ~18 misses/sharpenings NOVOS.**

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD --
src/ db/` = vazio); origin/main dos 4 repos (backend dbd231e / canon 78749711 / harness 2979eb0 / meta-api 5516c2a,
inalterados); léxico legado (grep triado = zero executável); categoria f (0 FIXME/HACK/XXX, 1 @deprecated, 11 TODO);
version-drift (`merge-base --is-ancestor dbd231e v1.0.1` = FALSE, 22 commits, describe `v1.0.1-33`); docs-stale
(`resolve-organization-id.ts` ABSENT + 5 citações vivas); canon status de 14 ADRs backend/ (`aceita`/`proposed`) + §16.1
l.1483 CI-verde; o achado-manchete NOVO `/metrics` org-id (`health/routes.ts:24` sem preHandler + `metrics.ts:33` label +
`bootstrap/server.ts:170`); worker count (11 `new Worker`); reconciliação `server.ts`→`src/bootstrap/server.ts` + 5
event-types em `metaapi/schemas.ts:16-22`; arco 06-02 (3 CRÍTICOs originais, lidos dos headers).

**Ground-truth de CI rodado de fato** (2026-10-23 ~09:05 UTC; logs em `/tmp/ci-1023/`): Typecheck ✓ / Format ✓ /
OpenAPI-parse ✓ / Build ✓ / Unit ✓ (**469/469, 69 files**) = **GREEN**; `test:integration` = **RED exit 1** (`1 failed |
92 passed (93)`, flaky `booking_notice:259` ~09:05 UTC < 13:00, sem teardown 57P01); `pnpm audit --audit-level high` =
**RED exit 1, 109 vulns / 49 high** (parse de `audit.json`: 8 low · 52 moderate · 49 high · 0 critical; 19 módulos);
`lint` = **RED por artefato local** (5 `.claude/state/gap*.js` gitignored → CI GREEN); `pnpm openapi:check` = **exit 0**
(mas é parse-smoke, não validador). **Estado GitHub:** `gh run list --branch main` → scheduled runs em `startup_failure`
(0s) 10-05→10-20.

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree numa feature branch
(`fix/a14-bevox-meta-api-ig-callback-spec`) mas **`origin/main` @ `78749711` (06-03)** — leu-se `origin/main` para
PRD/ADRs/delivery-tracker. Numeração de ADR **colide** entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner /
CodeQL não reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta
reais) não exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de
writers/endpoints + CI rodado (incl. 14 suítes de integração live Postgres+Redis). (4) MCP `stripe` + `claude.ai Google
Drive` requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5) Esta passada é
re-verificação sobre código byte-idêntico ao do 10-22; o valor incremental é **1 refutação + CI fresco (Security em platô
byte-idêntico, scheduled-dark confirmado multi-semana) + ~18 misses NOVOS + várias correções de evidência/severidade**,
não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-23. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
