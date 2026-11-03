# Gap Analysis — bevox-backend — 2026-10-24

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo segundo a
> documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais — `harness-callback-auditor`,
> `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`, `backend-route-reviewer`, `Security Engineer` —
> + 2 `general-purpose` para LGPD e calendar/pilot/obs), cada um **re-verificando de fonte primária** o inventário do
> 10-23 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** superestimações + caçar
> misses; **verificação independente de fonte-primária pelo orquestrador** dos achados-manchete; e **CI rodado de
> fato** (2026-10-24 ~09:00–09:18 UTC, não inferido; logs em `/tmp/audit-1024/`). Sucede
> `runtime-gap-audit-2026-10-23.md`.

## Resumo executivo

**12ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,7
meses.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é **vazio** — o produto é byte-idêntico desde
`dbd231e` (2026-06-03). Canon `bevox-knowledge` `origin/main` @ `78749711` (06-03), `bevox-harness` @ `2979eb0`
(06-03), `bevox-meta-api` @ `5516c2a` (06-22), hub `bevox-PRD-consolidation` @ `fd1373b` (06-03) — **todos inalterados
vs 10-23**. Os 7 auditores + o orquestrador **confirmaram o inventário de código do 10-23** (~90 itens) com **ZERO
refutações de código** (o `mark-no-show` segue refutado desde o 10-23), **~13 misses/sharpenings NOVOS** e várias
correções de evidência/severidade.

**Manchete-delta #1 — o platô de segurança QUEBROU em 24h: 109→115 vulns, 49→50 high, e o novo high toca o núcleo de
validação de produção (`zod`).** Ground-truth rodado 2026-10-24 ~09:05 UTC: **Typecheck ✓ / Format ✓ / OpenAPI(parse)
✓ / Build ✓ / Unit ✓ (469/469, 69 files) = GREEN**; **Tests RED** (`test:integration` exit 1: `1 failed | 92 passed
(93)` — o mesmo flaky dependente de hora-do-dia `calendar-booking.test.ts:259`, rodei ~09:05 UTC < ~13:00 UTC →
`booked` em vez de `slot_conflict`; **e com 2× teardown `57P01` desta vez**, vs 0 no 10-23); **Security RED** (`pnpm
audit --audit-level high` exit 1: **115 vulns — 10 low / 55 moderate / 50 high / 0 critical**). Vs 10-23 (**109 /
8-52-49**) → **+6 total, +1 high**. A composição do conjunto de 19 módulos-high mudou: **`braces` saiu de todas as
severidades** e **`zod@4.4.3` entrou no conjunto high** (GHSA-mrhx-c7xc-m3w5, `<4.6.6`, exaustão de memória validando
coleções restritas oversized; patch `>=4.6.6`). `zod` é o validador de **toda** a entrada HTTP do backend — é a 1ª vez
em 6 passadas que a dívida do lockfile congelado produz um advisory novo **na camada de validação de produção**.
Tendência **12 → 15 → 18 → 49 → 49 → 49 → 50**: o platô de 48h (10-22↔10-23) durou exatamente uma passada.

**Manchete-delta #2 — o scanner agendado do GitHub está dark há MAIS tempo do que o 10-23 reportou: desde 2026-09-22,
não "~10-05".** Re-verifiquei via `gh run list --branch main --limit 25`: **todo** run `schedule` (Security seg-cron
+ CodeQL ter-cron) termina em **`startup_failure` (0s, sem jobs)** ininterrupto em 09-22, 09-28, 09-29, 10-05, 10-06,
10-12, 10-13, 10-19, 10-20. O **último** run agendado que de fato executou foi **Security `failure` em 09-21** (e
CodeQL `success` em 09-15). O 10-23 situou o início do dark em "~05-out" — **correção: começou 09-22**, ou seja uma
janela de **~5 semanas**, ~o dobro do que a passada anterior estimou. (A hipótese "auto-disable de 60 dias por
inatividade" do 10-23 é **inconsistente** com runs executando até 09-21: o `startup_failure` — run criado mas nenhum
job inicia — tem outra causa, não introspectável offline: billing/quota de Actions, uma action-ref removida, ou
política de org. Reporto o **fato**; a causa fica como dependência cruzada GitHub.)

**Manchete-delta #3 — ~13 misses NOVOS (todos verificados de fonte-primária), 2 verificados independentemente pelo
orquestrador.** Os mais relevantes: **`dispatch-message-id-not-uuid-poisons-every-AI-dispatch`** (GA-crítico;
verificado pelo orquestrador) — o backend monta `message_id = external_message_id` (id nativo de canal `wamid.*`/`mid.*`,
**nunca** UUID) mas seu **próprio** `DispatchMessageSchema` exige `z.string().uuid()` → `DispatchPayloadSchema.parse()`
lança **antes** do enqueue → toda 1ª dispatch de IA sobre conversa inbound-real auto-envenena (inerte no piloto
manual). **`metaapi-webhook-preauth-db-amplification`** (GA/DoS; verificado pelo orquestrador) — o webhook roda **2
queries + 1 decrypt AEAD antes** de validar o HMAC, e **não há rate-limit em rota nenhuma do app**. **`rate-limit-
plugin-dead-app-wide`** (GA-HIGH; corroborado por 2 agentes independentes) — `requireRateLimit` tem **zero callers**,
`@fastify/rate-limit` é dep declarada mas **nunca registrada**; o plugin Lua custom é registrado mas **não é anexado a
rota alguma** → login de staff, mutações de dinheiro e webhooks **sem throttle**. Mais: `extra`-override de agenda
inalcançável sem grade-base (fecha o último escape-hatch do CRÍTICO-1); **nenhum endpoint lê a agenda** — nem no plano
Clerk nem no staff-ops; ingestão de PII **antes** de qualquer aviso/consentimento (LGPD); DSR-export **não auditado**
(entidade `dsr_requests` não existe).

**O piloto morre no passo 2 ("ver agenda") — inalterado e re-verificado por 2 agentes + orquestrador.** Veredito:
**o caminho do piloto NÃO é executável como semeado.** 1ª falha dura: o `seed-pilot` cunha JWT staff **HS256**
(`staff-auth.ts:67-76`), mas **toda** rota de calendar é `requireClerkAuth()` **RS256** (`clerk-auth.ts:89-90`) + claim
`organization_id` → **401 na primeira requisição de calendar**; o seed não provisiona principal Clerk nem row `users`.
Atrás desse gate: (b) `availability.ts:75 notFound("Calendar")` (seed não cria `calendars`); (c)
`professional_schedules` **sem escritor em todo o app** (único INSERT = fixture `calendar-booking.test.ts:120`; símbolo
`weekly*` = 0) → `availability.ts:126 if(!sched) continue` → `slots:[]` → `booking.ts:207 slot_conflict` em 100%,
**app-wide, não corrigível por config nem por override** (sharpening novo: o `continue` precede a leitura do override
`extra`). backend/ADR-010 (calendar/WeeklySchedule) é **aceita** (`aceita_em 2026-04-22`). **Fix mínimo ≈ 2-3h**
(seedar Calendar + grade Seg-Sex) **mas** o fechamento real do CRÍTICO-1 exige um **writer de WeeklySchedule**
(rota/repo, ≈ 4-6h). E **não há GET de agenda** em nenhum plano (nem Clerk nem staff-ops) → mesmo com auth corrigida,
"ver agenda" não tem endpoint.

**Money-path manual do piloto FUNCIONA (integração verde: `payments-manual-mode.test.ts` 19/19), com 2 bugs HIGH
alcançáveis.** (1) `outbound-provider-vocab-mismatch` **(HIGH, alcançável NO piloto via staff-approve)**: inbound
persiste `"wa"`/`"ig"`, outbound null-coage provider ≠ pleno → `skipped_missing_recipient` → execução fica `done`
(**falso-sucesso**); meta-api `origin/main` exige `z.enum(["whatsapp","instagram"])` → `wa`/`ig` é invenção
100%-backend. (2) `manual-remark-inserts-orphan-paid-payment` **(HIGH, irreversível)**: re-marcar paga uma charge
`expired`/`refunded`/`cancelled` → `markChargePaid` rowcount-0 **mas** `insertPayment`/confirm/grant rodam mesmo assim
→ payment `paid` órfão fresco; depois **não-estornável** (`service.ts:499`).

**Caminho de fechamento do piloto curto e inalterado:** 2 blockers de agenda (≈ 2-3h seed + ≈ 4-6h writer de grade) +
gate de CI (flaky ≈ 0,5h; audit ≈ 4-6h por 50 highs incl. `zod` + re-enable do scheduled) + gate de auth-actor (ops
Clerk, ou ~4-6h rota staff-scoped) + `GET /appointments` (≈ 3-5h) ≈ **~1-1,5 dia**. Severidades ancoradas no gate do
**piloto**; para GA vários ALTO/MÉDIO sobem (vocab de canal, token-IDOR, o `status`-callback 404 ponta-a-ponta,
`active_execution_id`-wedge, `buildDispatchMessages`-poison, o novo `message_id`-UUID-poison, `rate-limit`-dead viram
CRÍTICO de GA).

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária (carregadas do 10-23 + re-confirmadas):

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`) — **não** `/complete,/artifact,/tool-result,/turn`
   como o brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (não "channels"). **Channels = _shared/ADR-011**.
   backend/ADR-018 = refund/cancellation policy (`aceita`). backend/ADR-023 = manual payment mode (`aceita`).
   backend/ADR-010 = calendar/WeeklySchedule (`aceita`). **backend/ADR-016 (token-billing) = `proposed`** → corretamente
   NÃO implementado. O range "0011 a 0018 Marco-1" do brief é aproximado; as ADRs aceitas vinculantes vão até 0023.
3. O grep `account_id\b` do brief captura **232** ocorrências, **todas sancionadas**: composites
   `external_account_id`/`payment_account_id`/`channel_account_id`, o alias financeiro `AS account_id`, doc-comments do
   rename, e snapshots drizzle/tipo gerado. O léxico proibido **executável** é **ZERO** (invariante §4.1 mantida —
   não-gap). Ver categoria c.
4. Código congelado desde **06-03** (`dbd231e`), não 06-04. `git describe HEAD` = **`v1.0.1-34-gb9aa374`** (o `-34`
   são commits de audit docs-only; era `-33` no 10-23).
5. Numeração de ADR **colide** entre `backend/` e `_shared/` (008–023) — **sempre qualificada** abaixo.
6. **RBAC de staff é canon backend/ADR-013** (roles `bevox_admin|bevox_support|bevox_observer`), **não ADR-022**
   (backend/ADR-022 = policy-json sub-keys). A rule local `.claude/rules/backend-routes.md` mis-cita "ADR-022 staff
   RBAC" + nomes curtos + invoca o inexistente `requireRole` — ver BAIXO/governança.
7. O `status`-callback **não é** drift de OpenAPI: é **PATCH** no YAML (`yaml:1822`) **e** no handler (`routes.ts:56`) —
   eles **concordam**. A quebra POST-vs-PATCH é **cross-repo** (harness POSTa) — categoria l, não b.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 prontidão + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1483)** inclui literalmente `- [ ] Repositório bevox-backend criado; CI
  verde.` (lido verbatim hoje de `origin/main`) ⇒ o único bloqueador **mensurável** de Marco-1 é **CI-verde (RED em
  Tests + Security)**. Também: migrations em pg16; módulos auth/organizations/users/professionals/services/customers;
  OpenAPI publicado; contrato harness testado com stub; deploy staging.
- **§16.2 Marco-2** (calendar, conversations, messages, channels, ai-pipeline, autonomy; Fluxos 1/2/3 e2e; token
  accounting; idempotência tools; métricas Prometheus; cobertura ≥70%). **§16.3 Marco-3** (payments Stripe Connect,
  reminders, faq, rules, audit, observability completa; WhatsApp direto; **LGPD DSR/retenção/consentimento**; **MFA
  TOTP**; backup/restore; rate-limit distribuído; SLO). **Roadmap §15 l.1401: "Marco 3 — Absorção do calendar-service
  (ADR-010)".**
- **Status de ADR (lido de `origin/main`):** backend/ADR-009/010/013/014/015/017/018/019/020/021/022/023 = **`aceita`**;
  backend/ADR-016 (token-billing) = **`proposed`** (corretamente não implementado); backend/ADR-011 = `pending`, porém
  **superseded** pelo colapso em ADR-019 (aceita). _shared/ADR-019 (bases legais LGPD) + _shared/ADR-020 (retenção)
  aceitas.
- **Fato estrutural:** o código entrega muito além de Marco-1 — o README "Marco 1 bootstrap" **subdeclara** o que
  existe. O piloto exercita calendar + payments-manual (ADR-023 aceita) + o worker assíncrono independentemente do
  rótulo → os 2 CRÍTICOs são **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-24) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO app-wide; novo sharpening: `extra`-override inalcançável); `StatusHistory` ausente (§13.3/§8.4); `appointments.created_by_*` **colunas inexistentes** (§8.3); templates ADR-020 + priority-score ADR-021 **Opção C vinculante** não-materializadas |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recontagem independente reproduzida **exata**: `103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 / 11 undoc` (bijeção 106−11=95); 11-undoc split **4-isentos / 7-drift-real**; `mark-no-show` segue **REFUTED** |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO** (232 sancionados) |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | seed gera base32 (`seed-pilot.ts:153`) + blocklist (`mfa.ts:34`); login sem MFA = **correto** (Marco-3); `CLAUDE.md §8` stale (doc) |
| e | Testes faltando (hot paths) | ✅ | webhook Stripe (`constructEvent`=0 em test/) / reconcile-cron (só unit mockado → 42703 CI-invisível) / availability-rota / inbound-vocab — zero e2e; integração manual-money verde (19/19) |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); **~11** TODOs todos Marco-2/3 |
| g | LGPD | ✅ | consent/`ai_opt_out` **arquiteturalmente inaplicável** (dispatch é conversation-keyed); **NOVO** ingestão de PII **pré-aviso** (`intake.ts:66,82`); `received_events`/`message_records` PII-cru não-apagável (sem `created_at` de servidor); **NOVO** DSR-export não-auditado (sem `dsr_requests`); DSR deleção ausente |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main, verbatim); nenhum work-item p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → grade CRÍTICA **invisível** ao tracker |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky + **2× 57P01**) + Security RED **50 high / 115** (**platô quebrou**, `zod` novo); fast-gate GREEN; lint-RED = artefato local gitignored; scheduled CI dark **desde 09-22** (~5 sem) |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + irreversível**; `reconcile-refund-42703` **cron-only mas LIVE-wired** (webhook vivo intacto); overflow `numeric(10,2)` em **ambos** manual+Stripe; PCI-nil |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH alcançável-no-piloto** + métrica-cega; **NOVO** `pre-HMAC DB amplification` (DoS); audit-dup em retry; null-tenant-500; unknown-provider-silent-drop; HMAC correto |
| l | Harness dispatch | ✅ | `status`-callback **POST↔PATCH 404 total** (root-cause único); token-IDOR; `active_execution_id` wedge; `buildDispatchMessages` poison; **NOVO `message_id`-não-UUID poison**; `stream` ausente; todos inertes no piloto manual |
| m | Alçapões do piloto | ✅ (traçado) | **NÃO-executável como semeado**: 1ª falha = auth-actor 401; atrás, calendar-404 + grade-vazia app-wide + **sem GET de agenda**; money-path manual OK com 2 bugs HIGH; worker-telemetry buraco-negro |
| n | Delta vs audit anterior | ✅ | 10-23 re-verificado; **0 refutações de código**; Security platô QUEBROU (+6/+1high, `zod`); scheduled-dark recuado a 09-22; ~13 misses NOVOS |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN (staff) — PASSA mecanicamente, classe de token errada.** `seed-pilot` cria org (`:109`) +
   `bevox_admin` (`:156`); `POST /staff/sessions` cunha JWT staff **HS256** (`staff-auth.ts:67-76`). Só serve a rotas
   `requireStaff`. Sem rate-limit/lockout.
2. **VER AGENDA — QUEBRA na AUTH primeiro (401).** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`calendar/routes.ts:22,48`; `clerk-auth.ts:89-90`) + claim `organization_id` → token staff HS256 → **401**. Seed não
   cria principal Clerk nem row `users`. *Se JWT Clerk à mão:* → `availability.ts:75 notFound("Calendar")` (**CRÍTICO
   b**). *Se Calendar à mão:* → grade vazia app-wide (**CRÍTICO c**). **E não há `GET /appointments` em nenhum plano**
   (Clerk nem staff-ops) → "ver agenda" não tem endpoint.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100%. **Main-path exactly-once É SÃO**
   (advisory xact-lock + recount in-lock + unique index + replay 23505; POST honra `Idempotency-Key`
   `routes.ts:88`). Reschedule/transition têm 6 defeitos de correção; create/reschedule/transition não gravam
   `audit_events` (§12.8) e não persistem actor (`created_by_*` **inexistente**).
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** Serviço semeado sem `requiresPrepayment` →
   default `false` (`catalog.ts:67`; hook `booking.ts:275` nunca dispara) **e** `seed-pilot` não cria
   `payment_accounts` → precisa de `POST /payment-account/connect-manual` à mão (mesmo gate Clerk). **1 bug HIGH
   irreversível** re-mark de charge terminal; overflow 500 em `amount_total` ≥ 1e8 (manual **e** Stripe).
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile cru
   sem orquestração; reconcile de refund DOA (42703) — **cron-only, mas o cron É live-wired** (`queue/index.ts:149` +
   repeatable 2h); o webhook vivo `updateRefundStatus` omite `updated_at` → intacto; modo manual não é afetado
   (refunds escritos `succeeded` direto, nunca `pending`).

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[SHARPENED]`/`[NARROWED]`/`[REFUTED]` = status vs 10-23; **(v: …)** = verificação; `[xrepo]`
= dependência cruzada. Severidade ancorada no gate do **piloto**; escalonamento p/ GA anotado. `file:linha` = evidência
lida **nesta** sessão sobre código byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry, SHARPENED]` **(v: CONFIRMADO ×2 — calendar + schema)** — Nenhum
  caminho do app escreve `professional_schedules` (grade semanal-base). Único `INSERT` = fixture
  `test/integration/calendar-booking.test.ts:120` (SQL cru). Símbolo `weekly*` = **0 hits**. Produção só lê
  (`availability.ts:116`); `:126 if(!sched) continue` esvazia todo dia → `slots:[]` → `booking.ts:196/207
  slot_conflict`. **SHARPENING NOVO (v: calendar):** o `if(!sched) continue` (`:126`) executa **antes** da leitura do
  override `extra` (`:128`), logo o único writer que adiciona capacidade (`createScheduleOverride` type=`extra`,
  `repository.ts:78`, rota `routes.ts:41`) **nunca** resgata um profissional sem row base → **não há escape-hatch de
  bootstrap**. Escopo §5.3 (backend/ADR-010 **aceita**; `WeeklySchedule` entidade de 1ª classe, PRD l.379 + ADR-010
  l.74). — Impacto: 100% dos agendamentos = `slot_conflict`, app-wide. — Esforço: **4-6h** (rota+schema+repo+teste) ou
  **2h** (seedar grade como paliativo). **#1.** `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO ×2 — calendar + schema)** — `seed-pilot.ts`
  tem exatamente **4** `.insert(`: organizations (`:109`), staffAccounts (`:156`), professionals (`:195`), services
  (`:217`). Zero `calendars` → `availability.ts:75 notFound("Calendar")`. `createCalendar` existe
  (`calendar/repository.ts:20`) e está route-wired (`routes.ts:33`); o gap é "o seed nunca o chama e não há bootstrap
  não-HTTP". `professional_services` também não é semeado → fallback "todos os profissionais bookáveis"
  (`availability.ts:91-96`). `system_holidays` omitido é **fail-open** (`:108-111`), não co-bloqueador. — Esforço:
  **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×2 + grep)** — seed provisiona **só** org
  + `staff_account` (HS256, `staff-auth.ts:67-76`); toda rota de calendar é `requireClerkAuth()` RS256
  (`calendar/routes.ts:22,48`; `clerk-auth.ts:89-90`) + claim `organization_id` → token staff rejeitado 401. `grep
  requireStaff|requireRole src/modules/calendar/` = **0**; o seed não cria usuário Clerk nem row `users`. Sit
  **upstream** dos 2 CRÍTICOs. — Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-24; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice`** `[carry]` **(v: RODADO)** — `pnpm test:integration` = **RED exit 1**,
  `1 failed | 92 passed (93)` (`Test Files 1 failed | 13 passed (14)`). Falha = `calendar-booking.test.ts:259`
  "slot_conflict quando start_at < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be
  'slot_conflict'` — o gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei ~09:05 UTC → `booked`. **Com 2×
  teardown `57P01`** desta vez (`FATAL ... ProcessInterrupts`, ruído de teardown testcontainers/ioredis — vs 0 no
  10-23, 1 no 10-22; não mudou pass/fail). `ci.yml` roda integração sem `continue-on-error`. — Esforço: **0,5h** (slot
  `now()`-relativo + fechar `closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-50-high`** `[carry, PLATÔ QUEBROU]` **(v: RODADO)** — `pnpm audit --audit-level high` =
  **RED exit 1, 115 vulns (10 low · 55 moderate · 50 high · 0 critical)** — **+6 / +1 high vs 10-23**. 50 high em **19
  módulos**: `@fastify/static`, `@grpc/grpc-js`, `@opentelemetry/{auto-instrumentations-node,exporter-prometheus,
  propagator-jaeger,sdk-node}`, `brace-expansion`, `fast-uri`, `fastify`, `find-my-way`, `js-yaml`, `nanoid`, `postcss`,
  `protobufjs`, `source-map-js`, `tmp`, `undici`, `vite`, **`zod`**. **Delta de composição:** `braces` saiu de todas as
  severidades; **`zod@4.4.3` entrou no high** (GHSA-mrhx-c7xc-m3w5, `<4.6.6` → patch `>=4.6.6`) — `zod` valida **toda**
  a entrada HTTP de produção, 1º advisory novo tocando a camada de validação. Highs prod-runtime no core do Fastify
  (`fastify`<5.12.2 ×4 advisories / `@fastify/static` / `find-my-way` / `fast-uri` ×7). `security.yml`
  (`continue-on-error:false`) + `osv-scanner` → hard-fail. **Tendência 12→15→18→49→49→49→50.** — Esforço: **4-6h** (bump
  OTel/fastify sob nota ADR-012 + `pnpm add zod@^4.6.6` + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion).
  **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[carry, janela RECUADA p/ 09-22]` **(v: orquestrador — `gh run list`)** — todo
  run `schedule` em `main` (Security seg-cron; CodeQL ter-cron) termina em **`startup_failure` (0s)** ininterrupto de
  **09-22** até 10-20; o último run agendado que executou foi Security `failure` em **09-21** (CodeQL success 09-15). O
  10-23 situou o início em "~05-out" — **correção: 09-22** (~5 semanas). Causa não-introspectável offline (billing/quota
  Actions, action-ref removida, ou política) — **não** o auto-disable-de-60-dias (inconsistente com runs até 09-21).
  Gate de segurança agendado **nem roda nem alerta**. — Esforço: **0,2h** (re-enable) — fix real é destravar o lockfile.
  `[xrepo: GitHub Actions]`

**Auth / rate-limit — buraco app-wide (NOVO consolidado)**

- **`rate-limit-plugin-dead-app-wide`** `[NOVO/SHARPENED de `staff-login-no-ratelimit`]` **(v: CONFIRMADO ×2 — RBAC N1 +
  Security #12)** — `requireRateLimit` tem **zero callers** em todo `src/` (grep: só `global.d.ts:66` + o próprio
  plugin). `@fastify/rate-limit@^10.3.0` é dep declarada (`package.json:37`) mas **não é registrada** em `src/`; o plugin
  Lua custom é registrado (`bootstrap/server.ts:134`) mas apenas **decora** o opt-in `requireRateLimit` — nenhuma rota o
  anexa (login/refresh/impersonation, mutações de money, webhooks metaapi/Stripe, rotas Clerk). O hook global
  `onRequest` (`server.ts:150-159`) é só contexto/timing. Net: **nenhuma rota throttled**. Login staff
  (`auth/routes.ts:90`) sem preHandler → brute-force online ilimitado (bcrypt cost-12 único freio; MFA é Marco-3). —
  Impacto: brute-force de admin + superfície de DoS (ver `pre-HMAC amplification`). Piloto baixo (1 admin, senha
  requiredInProd). — Esforço: **baixo** (anexar o `requireRateLimit` já-construído a login/refresh/mutators). **#8.**
- **`staff-jwt-secret-no-min-length`** `[carry]` **(v: CONFIRMADO)** — `env.ts:60 STAFF_JWT_SECRET: optionalString`
  (sem `.min()`); refine de prod é **presence-only** (`:205-206`) → secret de 1 char passa; `staff-auth.ts:70` assina
  HS256. O mesmo secret assina o JWT de `state` do Google OAuth (`calendar/google/oauth.ts:107`), **mas** audiences
  distintas e ambas verificadas (`STAFF_AUDIENCE` vs `OAUTH_STATE_AUDIENCE`) → **sem replay cross-plane**; o risco é o
  **piso de entropia** (chave fraca forja os DOIS planos independentemente). — Esforço: **0,5-2h** (`.min(32)` + chave
  separada p/ OAuth state). **O buraco de auth mais duro.**
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — RBAC, canon-reforçado)** — `requireRole` só existe como
  3 TODOs (`clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`); zero impl/caller; `clerk-auth.ts:109 role =
  … ?? "member"` (default **fora** do enum DB `owner|admin|operator|professional_viewer`). Rotas cliente mutantes
  (money `payments/routes.ts:105,167,284,295,306,318`; DELETE/PATCH professionals|services; PATCH org/settings; PII
  customers `:49,60,76`; waitlist) têm só `requireClerkAuth+requireOrganizationScope` → qualquer JWT org-member roda
  tudo intra-org (org-scope ainda bloqueia cross-org). **Canon ADR-013 l.143** manda middleware rbac por role — não
  entregue. Blast-radius baixo no piloto (1 org/1 admin). — Esforço: **1-2d**. `[xrepo: backend/ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO)** — `auth/repository.ts:221-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id) +
  `routes.ts:169-170 orgClaim = organization_id ?? clerkUserId`; webhook só trata `user.*`, sem `organization.created`
  → 1º user de uma org inprovisionável. Mitigado no piloto (seed). — Esforço: **4-8h** (+ADR org-mapping). `[xrepo: Clerk]`
- **`clerk-jwt-no-aud-iss-validation`** `[carry, aud/iss-only]` **(v: CONFIRMADO)** — `clerk-auth.ts:89-92` verifica só
  `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim não-verificada.
  jose **já** valida `exp`/`nbf` + pin RS256 — o gap é estritamente **aud/iss** (qualquer token RS256 do mesmo JWKS,
  qualquer app/instância Clerk, qualquer audience, é aceito). **Assimetria:** tokens staff **pinam** audience; Clerk
  não. — Esforço: **0,5-1h**.
- **`impersonation-audit-trail-absent`** `[carry, SHARPENED]` **(v: CONFIRMADO — RBAC)** — `auth/service.ts:135-139`
  seta claim `impersonation_id` ao PK da row `staff_impersonations`. O hook de audit (`auth/routes.ts:70-87`) vive no
  plugin encapsulado `authRoutes` (`server.ts:198`); staff-ops é registrado separadamente (`server.ts:213-215`) → o
  hook **nunca dispara** nas ações staff-ops; estas **são** auditadas (`actions.repository.ts:174-184`) **mas** gravam
  `actor_type='user'`, `actor_id=NULL` (literais `:179`), e **nenhum `impersonation_id`** → trilha impersonation→ação da
  ADR-013 l.109 **ausente** (0 refs `impersonat` em staff-ops). `endImpersonationSession` **não revoga** o token HS256
  (stateless ≤900s). O sintoma "403 sob impersonation" é **código morto** (`organization-scope.ts:57` vestigial — nenhuma
  rota pareia `requireStaff`+`requireOrganizationScope`). — Esforço: **1-2d**. `[xrepo: ADR-013]`

**Canais / money — alcançável no piloto**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(v: CONFIRMADO — Security; "defeito confirmado mais
  danoso")** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:16,35,44`) e persiste em
  `channel_connections.provider` (`routes.ts:246-252` → coluna `notNull()` **sem CHECK**). Outbound
  `findExecutionDeliveryContext` null-coage provider ≠ pleno (`metaapi/repository.ts:197`) → `ctx.provider=null` → guard
  `executions/seams.ts:360` → `skipped_missing_recipient` (`:376`); `isDeliveryFailure` exclui skips (`seams.ts:122-124`)
  → `complete-service.ts:100` fica `done` (falso-sucesso); a métrica loga `channel:"unknown"` (`seams.ts:373`). meta-api
  `origin/main` exige `z.enum(["whatsapp","instagram"])` (`messages/schemas.ts:7`) → `wa`/`ig` é invenção 100%-backend.
  **Alcançável NO piloto:** `approve()` → `runApproval` → `deliverToChannel` (`executions/service.ts:68`). — Impacto:
  100% das respostas a conversas inbound-semeadas descartadas em silêncio como `done`. — Esforço: **3-4h** (unificar
  vocab + CHECK + backfill + teste e2e). **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, irreversível]` **(v: CONFIRMADO — Security + orquestrador)** —
  `markChargePaidManually` **não** tem status-gate (`service.ts:429-433`; docstring `:414-416` proíbe-o por design);
  `applyChargePaid` chama `insertPayment` **incondicional** (`service.ts:891`) após `markChargePaid` (guardado `WHERE
  status='pending'`, void sem rowcount, `repository.ts:395-398`). Re-mark de `expired`/`refunded`/`cancelled` →
  `markChargePaid` rowcount-0 **mas** `insertPayment`+`confirmAppointmentIfUnconfirmed`(`:902`)+grant de
  pacote(`:915-919`) rodam; numa charge `refunded` o payment anterior está `reversed`, logo UNIQUE(org,pid,**status**)
  não colide → payment `paid` órfão fresco. Depois **irreversível**: `refundChargeManually` exige `status==='paid'`
  (`:499`). Root-cause compartilhado alcança o path Stripe (`webhook-platform.ts`). Fix = `markChargePaid` RETURNING
  rowcount + gatear os 3 side-effects (NÃO um status pre-check). — Esforço: **2-3h**. **#4.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA ligar — INERTE no piloto manual)**

- **`harness-status-callback-method-mismatch-total`** `[carry, root-cause único]` **(v: CONFIRMADO byte-level nos 2
  repos — harness agent)** — Harness `post()` hardcoda `method:"POST"` (`bevox-callback.ts:28`); `updateStatus` POSTa
  `running` e `dead_letter` (`:133-150`), backend só registra **PATCH** `/status` (`harness-callbacks.routes.ts:56`) →
  **toda** chamada de status → Fastify **404**. `applyStatusTransition` + `markExecutionDeadLetter` são **código morto
  ponta-a-ponta**. O worker `on('failed')` (`queue/index.ts:267-269`) só loga jobs **backend-internos**, **não** o
  executions-dispatch → **root-cause único** (não dois). Backend é **canon-correto** (§10.4 PATCH l.1076 vs §10.1 POST
  l.447). Fix = **cross-repo** (harness→PATCH + errata canon). — Esforço: **~1,5h**. **#7.** `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry]` **(v: CONFIRMADO — harness agent; grep leituras=0)** — o
  preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:71,96`), mas **todo**
  handler age sobre o `:id` da URL (`routes.ts:73,91,113,142`) e **nunca** lê `req.executionContext` (grep: leituras
  não-atribuição = 0). Token válido p/ A escreve em qualquer execução B (IDOR cross-execution/cross-tenant). Coexiste
  com `four-callbacks-token-gated` (autenticidade ≠ autorização). **Inerte no piloto**; **CRÍTICO-GA**. — Esforço: **1h**.
  `[xrepo: bevox-harness]`
- **`dispatch-message-id-not-uuid-poisons-every-AI-dispatch`** `[NOVO]` **(v: harness agent N1 + orquestrador
  independente)** — `buildDispatchMessages` seta `message_id: m.external_message_id` (`orchestration/repository.ts:409`);
  `external_message_id` é `text` (`db/schema/ingestion.ts:40`), populado do id nativo de canal (WhatsApp `wamid.*` /
  Instagram `mid.*`, `channels/metaapi/inbound-dispatch.ts:78,104`) — **nunca** UUID. Mas `DispatchMessageSchema.
  message_id = z.string().uuid().optional()` (`harness-dispatch.schema.ts:15,22`). `dispatchExecution` roda
  `DispatchPayloadSchema.parse(...)` (`harness-dispatcher.ts:91`) **depois** do INSERT de execution mas **antes** do
  enqueue (`:107`) → ZodError "Invalid uuid" em tráfego real → execução órfã em `pending`, harness nunca enfileirado.
  Atinge os 2 paths (cutoff `cutoff.ts:54,57` + os 3 redispatch de staff). — **Inerte no piloto manual; CRÍTICO-GA (1ª
  dispatch de IA sobre inbound real quebra).** — Esforço: **~15min** (`message_id` → `z.string().optional()`). `[xrepo:
  bevox-harness]`
- **`dispatch-messages-unbounded-poison`** `[carry]` **(v: CONFIRMADO — harness agent)** — `buildDispatchMessages`
  (`orchestration/repository.ts:391-415`) seleciona **TODAS** as linhas de texto da conversa (sem LIMIT/truncation). O
  harness impõe `messages.max(100)` / `content.max(8000)` / `MAX_PAYLOAD_BYTES 256KB` (`execution-handler.ts:606-608,642`)
  → payload acima do teto = `UnprocessablePayloadError` (poison, sem retry). Conversa > ~100 msgs: todo dispatch
  envenena. — **Inerte no piloto manual; CRÍTICO-GA.** — Esforço: **1-2h** (LIMIT/slice últimos-N + guard por-msg).
  `[xrepo: bevox-harness]`
- **`completion-never-clears-active-execution-id`** `[carry]` **(v: CONFIRMADO — harness agent)** — só
  `releasePipelineClaim` (`orchestration/repository.ts:231`, só do catch de dispatch-fail) e `handoffConversationOnTimeout`
  (`:464`) nulam `active_execution_id`; `finalizeCompletion` só escreve `executions` (`harness-callbacks.repository.ts:
  136-149`); staff-ops `repointPipeline` re-aponta p/ novo id (`actions.repository.ts:98`). Guard de dispatch exige
  `active_execution_id IS NULL` (`:196`) → conversa trava após a 1ª execução. — **Inerte no piloto**; **CRÍTICO-GA
  (IA single-turn)**. — Esforço: **3-4h**. `[xrepo: bevox-harness]`
- **`backend-never-sends-skills-allowlist`** `[carry]` **(v: CONFIRMADO — harness agent)** — `cutoff.ts:75 skills:[]`;
  `actions.repository.ts:144 skills:[]`; `account_denied_tools` **nem existe** no `DispatchPayloadSchema`; harness trata
  `[]` como "todas as tools" (`execution-handler.ts:659,665`) → PERM-05 **no-op** e2e. — **Inerte no piloto**; CRÍTICO-GA.
  — Esforço: **4-8h**. `[xrepo: bevox-harness]`
- **`complete-failed-strategy-not-mapped-to-error` / `complete-rejects-aborted-strategies-400` /
  `complete-trusts-body-organization-id`** `[carry]` **(v: CONFIRMADO — harness agent)** — `strategy:"failed"`+proposals
  vazias → `"reply"` (`complete-service.ts:24`), nunca `error` (canon ADR-019 Am1 l.165-166); harness emite
  `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2096-2100`) ausentes do enum backend (`harness-callbacks.
  schema.ts:57-65`) → 400 → harness dropa; `/complete` lê tenant do body sem `=== existing.organization_id`
  (`routes.ts:150-154`) — com o token-IDOR = escrita cross-tenant. — 1-3h/ea. `[xrepo]`
- **`no-appointments-read-endpoint`** `[carry, SHARPENED]` **(v: CONFIRMADO — route-reviewer + calendar N2)** — Não
  existe `GET /appointments` nem `/appointments/:id`; calendar GET expõe só `/calendars` (`routes.ts:28`) +
  `/availability` (`:48`). **SHARPENING (v: calendar N2):** nem o **staff-ops** expõe appointments
  (`staff-ops/read.routes.ts:22-97` = executions/windows/dead-letters/audit) → a agenda é **ilegível sobre REST p/ TODO
  ator** (Clerk **e** staff), não só mobile. §10.1 não o enumera, mas persona mobile (PRD arch l.173) + §8.3 exigem. —
  Esforço: **3-5h**. `[xrepo: PRD §5.3/§8.3]`

### MÉDIO (degrada qualidade)

**Observabilidade — worker é buraco-negro (11 workers; harness inerte no piloto, exceto obs que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry]` **(v: CONFIRMADO ×2; ALTO-operabilidade, exercitado-no-piloto)**
  — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca** `import "./instrument.js"` nem `initTelemetry()`
  (ambos só em `src/index.ts:17,30`; grep em queue/ = 0). O worker importa `captureException` (`queue/index.ts:62`) mas
  `Sentry.init` vive em `src/instrument.ts:23` (só o HTTP entry importa) → `captureException` (`:272,313`) é drop
  silencioso; o OTel NodeSDK nunca inicia p/ os **11 `new Worker`** (`queue/index.ts:87,92,95,98,103,106,120,125,137,
  143,149` — cutoff/timeout/expiry/3×google/waitlist/package-expiry/2×reconcile/ingestion). — **1h** (import +
  `await initTelemetry()`). **Alto valor / baixo esforço. #6.**
- **`metrics-public-org-id-enumeration`** `[carry]` **(v: route-reviewer + orquestrador)** — `GET /metrics`
  (`health/routes.ts:24`) é in-app **não-autenticado** (sem preHandler; o comentário `:22-23` admite que o único controle
  é network-policy/proxy externo) e o counter `bevox_backend_http_requests_total` é rotulado com `organization_id`
  (`metrics.ts:33`), incrementado por-request com o UUID real (`bootstrap/server.ts:170 req.organizationId ?? "anon"`) →
  quem alcança `/metrics` enumera **todos os org-UUIDs + rota/status/volume por-org** (vazamento ADR-021). O YAML
  documenta `/metrics` `security:[]`+text/plain (`yaml:511-516`) sem pista do leak. **NOVO (v: calendar N3):** a mesma
  label é **blow-up de cardinalidade** em GA (uma série por org×rota×status). — Esforço: **1-2h** (guard staff/interno OU
  drop do label). `[g; ADR-021]`
- **`worker-process-has-no-metrics-scrape-endpoint` + `worker-has-no-healthz-readyz`** `[carry + NOVO]` — `/metrics`
  servido só pelo HTTP server; o worker não sobe listener (`queue/index.ts` sem fastify/listen) → counters do worker
  (reconcile `:88,114`) **não-scrapáveis** **e** sem liveness/readiness probe (**NOVO v: calendar N4**) → crash/stall do
  worker invisível ao orquestrador. — **1-2h**.
- **`domain-prometheus-metrics-not-registered` + `domain-metrics-declared-but-never-emitted`** `[carry]` **(v:
  calendar)** — `shared/metrics.ts` não registra os de §12.10 l.1365 / §13.3 l.590 (`charges_succeeded_total`,
  `appointments_no_show_rate`, `executions_pending_approval_count`, `executions_timeout_total`, `executions_total`,
  `charges_total`, `queue_jobs_completed_total`, `buffer_windows_opened_total` — grep=0); `metrics.ts:41 queueSize`
  nunca `.set()` e `:52 messagesReceivedTotal` nunca `.inc()` (e o piloto exercita ingestão). — **2-3h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` **(v: calendar)** — `realtime/publish.ts:8-12` união
  fechada a `execution.*`/`waitlist.offered`; `appointment.created`(§8.3 l.870)/`charge.updated`(§8.4 l.879) **nunca**
  emitidos (`publishRealtime` em booking/payments = 0) → tela do profissional não auto-atualiza (SSE é são). — **2h**.
- **`metaapi-webhook-preauth-db-amplification`** `[NOVO]` **(v: Security + orquestrador independente)** — um envelope
  bem-formado (passa Zod `:130`) dispara `SELECT … channel_subscriptions` (`metaapi/routes.ts:141`) **+**
  `findSubscriptionById` (`:150` → 2ª query + `decrypt` AEAD) **antes** da validação HMAC (`:156-169`), e **sem
  rate-limit em rota nenhuma** (ver `rate-limit-plugin-dead`). Flood não-autenticado → 2 queries + 1 decrypt/request. —
  **GA/DoS.** — Esforço: **~1h** (validar HMAC antes do decrypt, ou cachear o secret ativo). `[k]`

**Agenda — correção de dados quando exercitada (Marco-2; CONFIRMADOS pelo agente calendar)**

- **`status-history-entity-absent`** `[carry]` **(v: calendar + schema)** — §13.3 l.584/588 + §8.3 step9 l.892 +
  §8.4 l.887 mandam `StatusHistory` p/ Appointment/Charge/Conversation; grep `status_history|StatusHistory` em
  `src/`+`db/schema/` = **0**. `AuditEvent` existe (`audit.ts:20`) mas é event-log, não histórico de transição
  por-entidade. — **GA**. — Esforço: **M**.
- **`appointments-no-created-by-actor`** `[carry, SHARPENED]` **(v: calendar + schema)** — §8.3 step3 l.869 exige
  `created_by_type='user', created_by_id=user.id`; as **colunas não existem** (`calendar.ts:105-150` só tem `source`),
  e `booking.ts:234-243` não as seta. Composto com `appointment-mutations-no-auditevent`. — **GA/quality**. — **S-M**.
- **`appointment-mutations-no-auditevent`** `[carry]` **(v: calendar)** — §12.8 l.1344 manda Appointment C/U/D →
  AuditEvent; `booking.ts:234-516` grava **zero** `audit_events` (os `actorType:"system"` em `:295,330` são audit de
  *charge*). — **3-4h**.
- **`reschedule-non-atomic-double-book` / `reschedule-self-overlap-always-conflicts` / `appointment-transition-no-state-
  guard` / `reschedule-thin-idempotency` / `reschedule-drops-metadata` / `reschedule-double-charge-on-prepaid`**
  `[carry]` **(v: calendar)** — new+cancel em tx separadas (`booking.ts:223-248` vs `:390-414`) → janela de double-book +
  id do appt muta (`routes.ts:122`) + charge órfã; recount conta o appt antigo; UPDATE any→any (`:445`) →
  `cancelled→completed` decrementa pacote (`:486-499`); `idempotencyKey:undefined` (`:387`); metadata não copiado;
  double-charge em prepago (inerte, seed `requires_prepayment=false`). — 0,5-2h/ea.
- **`no-availability-422-collapsed-to-409`** `[carry, NARROWED]` **(v: calendar)** — §8.3 l.875-876 distingue 409 (slot
  ocupado) vs 422 (sem disponibilidade); `routes.ts:91-95` mapeia todo `slot_conflict`→409; `:108` admite "sem 422".
  **NARROWED:** o `openapi/*.yaml:2094-2110` declara só 400/401/403/404/409 → **sem drift código↔OpenAPI**; é gap
  código↔**PRD** (PRD ganha, §2). — **quality**. — Esforço: **S**.
- **`availability-n1-count-plus-92day-serial-loop`** `[carry]` **(v: calendar — GA-scaling/DoS)** — COUNT(*) por-slot em
  loops aninhados (`availability.ts:167-171`); `routes.ts:52-67` itera `date_from..date_to` serial até 92 dias
  (`schemas.ts:29`). Auth-guardado, não rate-limited. Não pilot-blocking (1 prof). — **4-6h**.

**Contrato backend↔harness / money (mismatches; INERTES no piloto manual, ALTO/MÉDIO-GA)**

- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry, NARROWED, cron LIVE-wired]` **(v: CONFIRMADO ×3)** —
  `reconcile.ts:254-259 UPDATE refunds SET … updated_at = now()`, mas `refunds` **não tem** `updated_at`
  (`payments.ts:149-172`) → **42703** → status nunca sai de `pending` → reconcile de refund **DOA**. O cron **É
  live-wired** (`queue/index.ts:149` + repeatable 2h, `env.ts:107`) → a safety-net Stripe é 100% DOA em prod. **NARROWED:**
  o path vivo `updateRefundStatus` (`repository.ts:476-484`) **omite** `updated_at` → intacto; manual escreve `succeeded`
  direto (nunca `pending`) → cron nunca o seleciona → **pilot-inerte**. CI-invisível. **Fix = remover `updated_at=now()`.**
  — **0,25h**. `[xrepo: Stripe]`
- **`intent-reconcile-no-payments-row-null-paid-at` + `reconcile-cron-raw-flips-without-orchestration`** `[carry]` **(v:
  Security)** — `reconcile.ts:143-150` seta só `status`+`updated_at` (charges TEM `updated_at`) sem `applyChargePaid` →
  charge `paid` com `paid_at` NULL + sem row `payments` → invisível às queries de posição ADR-018 §9; pacote não-concedido;
  appointment não-confirmado. Branch **live** (Stripe-path, inerte no piloto). — **M** (rotear por `applyChargePaid`).
- **`requires-prepayment-hook-throws-manual-mode`** `[carry]` **(v: Security)** — `booking.ts:275,299` hardcoda Stripe
  `createCharge`; conta manual (`external_account_id=NULL`) → `service.ts:193-197 lança`; caught best-effort → prepayment
  não coletado em orgs manuais (silencioso). Alcançável no piloto se algum serviço tiver `requires_prepayment=true`. —
  **2-3h**. `[xrepo: ADR-023 vs ADR-014]`
- **`dispatch-stream-field-absent` / `dispatch-default-model-validation-asymmetry` / `completing-state-has-no-timeout-
  backstop` / `trace-content-field-dropped`** `[carry, 1 NARROWED]` — harness gate exige `payload.stream===true`
  (`execution-handler.ts:1249`); backend omite `stream` do schema → `/stream`+buffer Redis+SSE = código morto. backend
  `default_model: min(1)` vs harness `isValidModelString` (**NARROWED:** o default `openai/gpt-4o-mini` passa; só bite
  provider não-allowlisted). `lockForCompletion` seta `completing` sem backstop de timeout (`:428` não inclui
  `completing`) → crash entre lock e finalize estranha a execução. `/traces` dropa `content` — mas `sendTrace` tem **0
  callers no harness** (doubly-inert). — 0,25-2h/ea. `[xrepo]`

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real) — CONFIRMADOS pelo agente LGPD (9/9, 0 refutados; 2 NARROWED)**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry, SHARPENED]` **(v: CONFIRMADO — vetor vivo, headline LGPD)** —
  `ai_opt_out` só no CRUD de customers (`customers/repository.ts:21,26,67`; zero outros readers); default `false`
  (opted-IN); `cutoff.ts:49-76` + `buildDispatchMessages` (`orchestration/repository.ts:391-415`, `content_text` cru) +
  dispatch **sem** carregar customer nem checar `ai_opt_out`. **SHARPENING:** o dispatch é **conversation-keyed**, nunca
  customer-keyed → um opt-out por-customer é **arquiteturalmente inaplicável** sem mudança de schema/flow; e `ai_opt_out`
  é double-dead (nenhum flow inbound/revogação o SETA true). — Esforço: **4-6h**. **#10.**
- **`no-consent-capture-mechanism` + `intake-pii-ingested-pre-notice`** `[carry + NOVO]` **(v: LGPD N2+N1)** —
  `consent_granted_at` tem **zero writers**; nenhum endpoint captura consentimento. **NOVO (a metade viva):**
  `intake.ts:82 resolveOrCreateCustomerChannel` auto-materializa `customers` + `customer_channels` (telefone/nome via
  `getSenderSnapshot` `:66`) na **1ª mensagem inbound**, sem gate de consentimento e **sem "aviso automático"** que a
  _shared/ADR-019 item 6 exige como base de consentimento-implícito → PII ingerida **pré-aviso** (nem a base art.7 I é
  satisfeita). — **MÉDIO (pilot-live)**. — Esforço: **M**. `[xrepo: _shared/ADR-019]`
- **`received-events-raw-payload-unscoped-un-erasable` + `message-records-content-un-erasable`** `[carry, SHARPENED]`
  **(v: LGPD + schema)** — `received_events` (`ingestion.ts:12-30`) persiste envelope Meta cru (wa_id/telefone/nome/texto
  em `payload_json`) com **zero `organization_id`/`customer_id`/`deleted_at`, sem FK** (by-design "ingestão crua", mas
  un-scoped p/ DSR); `message_records` (`ingestion.ts:32-56`) sem `organization_id`/`customer_id` apesar de `content_text`
  (egresso ao LLM) + `sender_snapshot_json` (**3ª cópia** de PII de contato) + `media_json`; FK `received_event_id ON
  DELETE set null` → content fica **extra-grudento** (sobrevive à deleção do pai); e **sem `created_at` de servidor**
  (irmão `received_events` tem `created_at`/`received_at`) → sweep de retenção/DSR **sem âncora temporal**. Joinável ao
  titular via `conversation_key`→`conversations.customer_id` mas TEXT sem FK/org-scope → DSR não **targeta** as rows. —
  Esforço: **6-8h**. `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` **(v: CONFIRMADO — grep global = ZERO)** — grep `legal_basis|
  consent_event|dsr_request|retention|pseudonym|message_archive|content_redacted` em `src/ db/ scripts/` = **0**; os 11
  workers de `queue/index.ts` não purgam/pseudonimizam; `auth/repository.ts:99` **admite** em comentário "Hard-delete
  worker (canon ADR-020, ainda não landed)". Canon ADR-020 define `bevox.retention.worker` (cron 03:00 UTC) +
  `consent_events`/`dsr_requests`. — Esforço: **24-40h**. `[xrepo: _shared/ADR-020]`
- **`dsr-deletion-absent` + `dsr-export-incomplete` + `dsr-export-unrecorded`** `[carry + NOVO]` **(v: LGPD)** — único
  `app.delete` de recurso é `services/routes.ts:50` + `professionals/routes.ts:53` (nenhum de titular);
  `deleted_at`/`archived_at`/`consent_granted_at` = colunas triplo-mortas. DSR **export** EXISTE
  (`customers/routes.ts:97`) mas omite `preferences_json`/`risk_flags_json`/`consent_granted_at` + `messages`/`audit_events`
  hardcoded `[]` + **`customer_channels` + appointments + waitlist + payments + conversations + execution_traces** (só
  cobre customers+facts de ~8 tabelas de titular). **NOVO (N2):** o export **não grava `audit_event` nem row
  `dsr_requests`** (entidade ADR-020 inexistente) → **zero evidência art.37** de que um DSR foi servido. — Esforço:
  export **6-10h**; deleção **8-12h**; dsr_requests **S-M**. `[xrepo: _shared/ADR-020]`
- **`clerk-organization-deleted-unhandled` + `execution-traces-pii` / `google-calendar-intl-transfer` /
  `payments-raw-payload-json` / `customer-pii-mutations-unaudited` / `denormalized-customer-contact-snapshot`** `[carry,
  3 sharpened]` **(v: CONFIRMADO)** — webhook só trata `user.*` (`routes.ts:165-190`), sem `organization.deleted` →
  cascade ADR-020 unwired (e sem org FK, deletar a org não purga received_events/message_records); traces crus sem
  `customer_id` (`harness-callbacks.repository.ts:187-208`; TEM org+created_at, retenção-ancorável mas sem worker);
  Google sync empurra nome p/ US (`sync.ts:203,237`) — gap é **salvaguarda art.33/opt-out**; `payments.raw_payload_json`
  (`repository.ts:422-440`) é retenção fiscal 10yr → gap é **minimização/pseudonimização**; customers CRUD sem audit
  (`service.ts:29-39`); snapshots denormalizados onDelete set null → PII órfã. — 2-4h/ea.

### BAIXO (higiene)

**Money / schema — misses de baixo risco**

- **`manual-charge-amount-unbounded-overflow-500`** `[carry, SHARPENED]` **(v: Security; alcançável no piloto)** —
  `manual.ts:31 z.number().finite().positive()` (sem `.max`/`.multipleOf`); escreve `.toFixed(2)` em `amount_total
  numeric(10,2)` (`service.ts:377`); amount ≥ 1e8 → 22003 → **500 opaco**. **SHARPENED:** defeito idêntico no path
  Stripe (`charge-intent.ts:106` + `service.ts:203`). — **trivial** (`.max(99_999_999.99).multipleOf(0.01)`).
- **`manual-charge-currency-unvalidated` / `manual-paid-refund-disjoint-lock-keys` / `service-packages-validity-days-
  numeric` / `buffer-windows-no-updated-at` / `payment-accounts-professional-no-uniqueness` / `received-events-no-org-
  column`** `[carry + 1 NOVO]` **(v: Security + schema)** — `currency: z.string().default("BRL")` sem CHECK (BRL-only
  V1 → inerte); **NOVO** `markChargePaidManually` (`service.ts:442 payments:manual-paid:<id>`) vs `refundChargeManually`
  (`:510 payments:manual-refund:<id>`) usam **lock-keys distintas** → não se excluem (sublinha que o fix de #4 é
  rowcount-gate, não lock); `validity_days numeric` (`payments.ts:183`; `0015` converteu `sessions_*` mas deixou este);
  `buffer_windows` muta sem `updated_at`; `payment_accounts.orgUniq` parcial `WHERE ='organization'` → duplicatas
  `professional`-level; `received_events` sem `organization_id`. — S/ea.
- **`section-11-3-critical-indexes-partially-absent` + `fk-columns-without-index`** `[carry, NARROWED]` **(v: schema)** —
  ausentes `(org,status)`/`(org,start_at)`/`(org,customer_id)` em appointments/charges/executions (vs PRD l.1270-1276);
  FKs sem índice (`execution_traces.organization_id`, `message_records.received_event_id`, `google_sync_outbox.
  appointment_id`, `buffer_windows.{conversation_id,channel_connection_id}`). **NARROWED:** o "~40 FKs" do 10-23 **não
  foi re-contado**; verificados **≥16 tabelas** com `organization_id` sem índice coberto + 4 FKs não-org nomeadas →
  padrão sistêmico real, número preciso **não-verificado** (tratar como "numerosos"). Perf/cascade latente, inerte a 1
  org. — **3-4h** (uma migration). `[a/schema]`
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized`** `[carry, SHARPENED]` **(v: schema)** —
  backend/ADR-020 (`aceita`) + ADR-021 (`aceita`) **não materializadas** (grep `message_template`/`urgency_level`/
  `skip_count` = 0). **SHARPENING (correção do 10-23):** ADR-021 **não** "reconhece client-writable como OK" — a Opção C
  (aceita) **MANDA** coluna derivada: `urgency_level INTEGER CHECK 1..5`, `skip_count INTEGER CHECK >=0`, `priority_score
  CHECK (>=0)`, fórmula canônica + recompute — **nada** implementado → é **ADR aceita-mas-não-materializada vinculante**,
  não estado-aceito-como-aceitável. ADR-020 reservou "Migration 0016" mas 0016 é ADR-023 (doc-stale). — ADR-020 **8h**;
  ADR-021 **6-10h**.
- **`waitlist-priority-score-client-settable`** `[carry]` **(v: schema + calendar)** — raw-storage writable
  (`calendar.ts:204 numeric notNull default '0'`, sem CHECK) escrito do input na rota pública (`waitlist/routes.ts:71`),
  no PATCH (`repository.ts:361`) **e** no seam de IA (`seam-tool.ts:83`), e `match` ordena por ele (`repository.ts:331`)
  → furar-fila aberto. **NÃO re-inflar `conversations.priority_score`** (`conversations.ts:45`): tem **zero writers** →
  dormante/reservado (ADR-021 futuro), não é 2º vetor ativo. — **2h** (CHECK + drop de input) a **6-10h** (fórmula+cron).
  `[a/g; ADR-021]`

**Auth / harness / obs (resíduos — todos BAIXO/latente/inerte)**

- **`newOpaqueId-uuidv4-dormant-landmine`** `[carry, re-confirmado]` **(v: RBAC + Security)** — `staff-auth.ts:139
  newOpaqueId(): return randomUUID()` (UUIDv4) viola CLAUDE.md invariante #7; **zero callers** (grep) → inerte, mas é
  helper exportado cujo doc-comment aponta p/ o refresh-path. Deletar. — trivial.
- **`staff-login-no-ratelimit` (subsumido por `rate-limit-plugin-dead`) / `staff-role-stale-cache-at-login` /
  `bcrypt-72-byte-truncation` / `staff-session-no-logout` / `staff-login-user-enumeration-timing` / `staff-refresh-no-
  reuse-detection` / `clerk-provisioned-role-hardcoded-operator` / `clerk-resolvelocaluser-fail-open` / `clerk-webhook-
  unknown-type-silent-200`** `[carry]` **(v: RBAC)** — cache-aside 300s cunha role cacheada no login (`service.ts:89`;
  refresh é DB-direct); `password.max(512)` + bcrypt ignora >72B; sem logout/revoke; throw antes do bcrypt
  (`service.ts:69-70`) = enum-timing; rotação delete-então-emite sem reuse-detection; `ON CONFLICT` não atualiza role
  (`repository.ts:236-240`); `resolveLocalUser` fail-open em erro de DB; webhook sem `else` → 200. — S/ea.

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recontagem 103/106/80/95/0/0/11 exata)**

- **`openapi-drift-undocumented-handlers` (11 → 7 drift-real + 4 isentos)** `[carry, SHARPENED]` **(v: route-reviewer
  11/11)** — **4 documentados-isentos** por comentário (`yaml:2505-2510`): `POST /webhooks/stripe`, `/stripe/platform`,
  `POST /webhooks/google`, `GET /webhooks/google/callback`. **7 drift-real sem isenção** (client/operator-facing):
  `GET`+`PATCH /autonomy`, `GET /channel-connections`, `GET /customers/{id}/export` (o export LGPD), `GET`+`PATCH
  /payment-account/policy`, `GET /api/v1/realtime`. — **2-3h**. **#9.**
- **`no-mechanical-route-zod-openapi-binding` + `openapi-check-is-not-a-validator`** `[carry]` **(v: route-reviewer)** —
  ZERO rotas usam a opção `schema:` do Fastify; sem `ZodTypeProvider`/`serializerCompiler`; **145** `.parse()` inline;
  OpenAPI 100% YAML estático (`@fastify/swagger mode:'static'`, `openapi-docs.ts:34`) → razão estrutural de todo drift.
  `pnpm openapi:check` (`package.json:32`) é **gerador de tipos** (`openapi-typescript --output -`), não validador
  (sem spectral/redocly) → exit 0 só prova que o YAML parseia. — **M-ALTO** (binding) + **1h** (validador no CI).
- **`freeform-200-underspec-systemic` / `error-envelope-dual-schema` / `idempotency-key-param-self-inconsistency` /
  `status-callback-missing-dead_letter` / `enum-create-refund-missing` / `sse-realtime-header-auth-contract` /
  `checkout-vs-payment_link-3-way-divergence` / `rate-limit-429-undocumented` / `operationId:0` / `metaapi-webhook-
  exemption-claim-inconsistent`** `[carry + 3 NOVO]` **(v: route-reviewer)** — **NOVO** o 200 free-form
  `additionalProperties:true` cobre **toda a superfície de leitura staff-ops (12 ops)** + 4 transições de appointment +
  `/complete` (`yaml:1919` etc.) → operador do painel sem contrato de campo; `Error`(sem request_id) domina vs
  `ErrorEnvelope`(com, só em 7 refs de payments) enquanto o handler **sempre** emite request_id (`error-handler.ts:55`);
  **NOVO** o param `IdempotencyKey` diz "obrigatória em **toda** mutação" (`yaml:98`) mas está em **32/52** ops mutantes;
  enum `status` `yaml:298` sem `dead_letter` (Zod `schema.ts:16`, branch vivo `routes.ts:75`); `ExecutionProposal.action`
  `yaml:322-328` omite `create-refund` (executado `complete-service.ts:25`); **ambos** SSE só aceitam `Authorization:
  Bearer` → `EventSource` do browser não autentica; `checkout` 3-way (`charge-intent.ts:87` vs `yaml:2602` vs CHECK
  `payment_link` `payments.ts:111`); 429 não documentado; **NOVO** o "precedente de isenção de webhook" é inconsistente
  (metaapi ON-surface `yaml:1126`, stripe/google off). — 0,25-2h/ea.

**Schema — misses novos (LOW; GA/latente)**

- **`denormalized-appointment-pii-not-erasable` / `google-webhook-events-no-org` / `appointments-customer-package-id-
  unenforced-fk` / `staff-impersonations-unindexed`** `[NOVO]` **(v: schema N1-N4)** — `appointments.customer_name/phone/
  email` + `waitlist_entries.*` (`calendar.ts:128-130,194-196`) são snapshots de PII; erasure só `set null`a
  `customer_id`, nunca o snapshot (+ customers é soft-delete → DELETE nunca dispara; `src/modules/customers/` tem 0 refs
  a appointments) → PII sobrevive erasure indefinidamente; `google_calendar_webhook_events` (`google.ts:109-129`) sem
  `organization_id`; `appointments.customer_package_id` (`calendar.ts:124`) **sem `.references()`** (deliberado — ciclo
  de import) → orphan refs; `staff_impersonations` (`staff.ts:29-40`) sem índice em org/staff_id → DSR "quem acessou
  tenant X" = seq scan. — baixo/ea. `[g/schema]`
- **`appointments-metadata-jsonb-pii-sink`** `[NOVO]` **(v: LGPD N3)** — `appointments.metadata` jsonb (`calendar.ts:142`)
  é sink livre de PII sem redação, fora do DSR, sem retenção. — GA/latente.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: CONFIRMADO — orquestrador)** — tags só
  `v1.0.0`/`v1.0.1`; `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora (incl.
  dispatch amendment); `release.yml` dispara só em `v*.*.*` → **nenhuma imagem (SemVer OU sha) pós-`v1.0.1`**. `describe`
  = `v1.0.1-34`. Versão diverge 4-way (`package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1` / hub `vX.Y.Z`). — **0,5-1h**
  (cortar tag). `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: CONFIRMADO — orquestrador)** — `src/integration/resolve-organization-id.ts`
  **NÃO existe** (bridge colapsada SP-3; comentários em `global.d.ts:8`/`clerk-auth.ts:11`/`organization-scope.ts:6`
  confirmam) mas é citado como vivo em **6 lugares**: `README.md:84`, `backend-tenancy.md:28`, `backend-routes.md:34`,
  `PostToolUse-tenancy.sh:11,20`, `engineering-backend-architect.md:243`; `CLAUDE.md §8 l.171` diz seed grava
  `PILOTSEEDONLYNOTASECRET` (real gera base32 + blocklist `mfa.ts:34`); `backend-harness-contract.md`/`backend-workers.md`
  dizem `dead_letter` via `worker.on('failed')` (**errado** — é via PATCH); `backend-db.md:31` diz `on delete restrict`
  (código+canon = **cascade**, §11.2 l.1203); `backend-tests.md` cita "5 falhas FK #36" (suíte passa 92/93). — 0,3-0,5h/ea.
- **`rule-backend-routes-staff-role-and-adr-miscite`** `[carry]` **(v: CONFIRMADO — RBAC, canon-corroborado)** —
  `.claude/rules/backend-routes.md:24,33` declara staff roles `bevox_admin|support|observer (canon: ADR-022 staff RBAC)`
  + invoca `requireRole` inexistente: triple-errado (nomes curtos; staff RBAC = **backend/ADR-013**; ADR-022 = policy-json
  sub-keys). — **0,25h**.
- **`stray-gap-workflow-js-scratch-accumulation` / `codeql-upload-never-noop` / `release-no-provenance-sbom` /
  `adr-number-collision-cross-namespace`** `[carry]` **(v: CONFIRMADO)** — **5** `.claude/state/gap*.js`
  (gap0704/0709/0714/0715/0717, gitignored — `git check-ignore` confirma) → **zero impacto em CI**; só `pnpm lint`
  **local** dá RED. **Esta sessão NÃO adicionou nenhum** (usou Agent tool, não Workflow). `codeql.yml:26 upload:never`;
  `release.yml` sem provenance/sbom; ADR 008-023 colidem backend/_shared. — 0,1-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária)

- **`legacy-lexicon-clean`** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/`db/`: **232** hits,
  executável **ZERO** (composites sancionados + alias financeiro `AS account_id` + doc-comments do rename + snapshots
  drizzle/tipo gerado). Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153 generateMfaSecret()` base32 + `assertMfaSecretNotPlaceholder`
  (`:154`); `mfa.ts:34` blocklist; `auth/service.ts:84-88` sem MFA check (correto — TOTP é Marco-3). **NÃO implementar
  "rejeitar sentinel no login".** CLAUDE.md §8 stale (doc).
- **`mark-no-show-is-not-a-code-bug`** `[REFUTED, carry]` — OpenAPI serve `/appointments/{id}/no-show` (`yaml:2229`)
  casando `routes.ts:125-131`; só a prosa PRD §10.1 l.971 diz `mark-no-show`. Código↔contrato consistentes. **Não
  re-flagar.**
- **`booking-main-path-exactly-once-sound`** — advisory xact-lock + recount in-lock + unique index + replay 23505
  (`booking.ts:225-263`); POST honra `Idempotency-Key` (`routes.ts:88`). Integração `payments-manual-mode` 19/19 verde.
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc`=0); decimal `numeric(10,2)`; webhooks dedupe-aware +
  org-scoped (cross-tenant paid-flip impossível `webhook-platform.ts:67-73`); over-refund replay-safe; ambos
  webhook-secrets `requiredInProd` (`env.ts:200,203`); `money-mutation-http-idempotency` by-design (`manual.ts:109` +
  `provider_payment_id=manual:<id>` + ON CONFLICT); `charge_type-drift` espelhado; clerk-webhook svix-verified.
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:65,69,94`). Coexiste com o
  token-IDOR (autenticidade ≠ autorização). `idempotency-on-callbacks` **REFUTED** (é state-machine, `/complete`→409).
- **`dispatch-amendment-faithful-to-canon`** — `deadline_ms`/`original_execution_id`/`dead_letter` (`harness-dispatch.
  schema.ts:58,62`) byte-faithful ao canon PRD §10.4 Am1.
- **`hmac-verification-correct`** — metaapi (`timingSafeEqual`+±300s), Stripe `constructEvent`, Clerk svix, Google
  timing-safe — todos verificam assinatura (o gap metaapi é **ordem**: decrypt antes do HMAC, ver MÉDIO).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer`; `requireStaff({roles})`→403 (observer→403, admin→200); staff-ops: actions exclui observer
  (`actions.routes.ts:11`), reads/realtime os 3; `TEST_AUTH_BYPASS` double-guarded; secrets staff DB-direct.
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` é **canon-correto** (§11.2 l.1203; `backend-db.md`
  "restrict" stale); timestamptz everywhere; CHECK (`end_at>start_at`, `sessions_remaining>=0`, `confidence∈[0,1]`);
  `ai_suggestions` dropada em 0005; sessions numeric→integer em 0015; ADR-022 policy-json materializada
  (`catalog.ts:110-113`); ADR-023 = 0016. `uuidv7-sql-default` pós-0000 ausente é **fail-CLOSED** (`$defaultFn` supre v7).
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (origin/main, verbatim): 10 delivered (aisuggestion,
  staff-rbac, m4-chatwoot-p1..p4, m5-p4-manual-payment, m5-p3c-multimedia-consume ["5 LGPD prod gates pending"],
  m5-p3a-refundpolicy, m5-p3b-create-refund-seam) + `backend-psp-br-secondary` **parked** (Marco 6). **Nenhum work-item**
  p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é
  **invisível ao tracker** (nenhum delivery-item jamais superfície o gap).

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do piloto +
1 dos 2 jobs de CI vermelhos**.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia (nem override `extra` resgata) → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) + fechar teardown `closeDb()/closeRedis()` (os 2× 57P01) | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado não autentica no calendar (gate upstream dos CRÍTICOs) |
| 4 | **`pnpm audit`: `zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**50 highs**, agora incl. o core de validação `zod`) e re-acende o scanner agendado (dark desde 09-22) — completa "CI verde" |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e | **3-4h** | **Alcançável NO piloto via staff-approve**: faz a resposta chegar ao cliente (hoje dropada em silêncio como `done`) |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + subir `/metrics`+`/healthz` no worker | **1-2h** | Fecha o buraco-negro (Sentry/OTel/Prometheus) dos **11 workers** que o piloto roda |
| 7 | **Gatear `insertPayment`+side-effects no rows-affected de `markChargePaid`** | **2-3h** | Fecha o bug HIGH de dinheiro **irreversível** alcançável no money-path manual (re-mark órfão) |
| 8 | **Anexar `requireRateLimit` (já construído) a `/staff/sessions[/refresh]` + mutators de money + webhooks** + `.min(32)` no `STAFF_JWT_SECRET` (+ chave separada OAuth state) | **~3,5h** | Fecha o buraco app-wide de rate-limit (brute-force de admin + DoS do webhook pré-HMAC) + o piso de entropia do plano staff |
| 9 | **`GET /appointments` (REST, Clerk + staff-ops)** + documentar os 7 handlers drift no OpenAPI + validador OpenAPI no CI | **4-6h** | "Ver agenda" não tem endpoint em plano nenhum; fecha o drift silencioso categoria b |
| 10 | **Aplicar gate `ai_opt_out`/consent em `cutoff.ts`/dispatch + aviso-automático no intake + capturar `consent_granted_at`/`dsr_requests`** + hidratar DSR export (incl. `customer_channels`) | **8-12h** | LGPD (piloto roda com PII real; hoje o flag é arquiteturalmente ignorado, PII ingerida pré-aviso, DSR não-apagável/não-auditado) |
| — | Higiene batch: vincular token de callback ao `:id` (IDOR); `message_id`→`z.string().optional()` (UUID-poison); `buildDispatchMessages` LIMIT (poison); HMAC-antes-do-decrypt (amplification); harness `status` POST→PATCH (cross-repo); StatusHistory + `created_by` + audit de appointment; índices FK (uma migration); versão/tag SemVer (22 commits); docs stale; `rm .claude/state/gap*.js`; `amount_total.max`+currency enum | **~20h** | Contrato harness + agenda-correção + perf GA + LGPD-audit + money-hardening + governança |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status`-callback POST vs PATCH 404 total** (root-cause
  único; backend canon-correto §10.4+ADR-019 Am1; fix harness→PATCH + errata canon l.447); `buildDispatchMessages` sem
  LIMIT → poison; **NOVO** `message_id` não-UUID → ZodError pré-enqueue em toda dispatch de IA; `aborted_*`→400 (bug
  harness), `strategy='failed'`→não-`error` (bug backend), skills-allowlist vazio, `stream`-field ausente, `default_model`
  sem validação (narrowed), `trace content` descartado (doubly-inert), `callback_base_url` ignorado, token-IDOR,
  `active_execution_id`-wedge. Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` no fio
  (`messages/schemas.ts:7`) confirma que `wa`/`ig` do backend causa o drop de outbound; retries de webhook amplificam a
  perda de inbound (dedupe-strand + null-tenant-500 + unknown-provider-silent-drop + audit-duplicado + pre-HMAC
  amplification).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um
  principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona.
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`); refund manual
  não passa por webhook; o reconcile de refund Stripe está **DOA (42703), cron-only mas LIVE-wired** (webhook vivo
  intacto). Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer auth interativa — indisponível nesta
  sessão headless** (reportado; não bloqueante para auditoria de código).
- **canon** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score **Opção C vinculante**)
  não-implementadas; _shared/ADR-019 (bases legais → gate consent + aviso-automático no intake + captura = código local),
  _shared/ADR-020 (retenção → scoping de message_records/received_events, `created_at` de servidor, retention worker,
  DSR deletion + `dsr_requests`, `message_archive`). Drifts "canon-atrás-do-código" (webhook §10.3, `strategy='workflow'`,
  `/status` POST↔PATCH l.447, `create-refund`, `dead_letter` no enum, `waitlist-add`) → errata/ADR superseding **no
  canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra, `origin/main` @ `fd1373b`)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest
  fixa `v1.0.1` (sem os 22 commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account
  nem principal Clerk); **a network-policy do `/metrics` é o único controle do vazamento de org-UUID** (vive no hub infra).
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` desde **09-22** (~5 sem) → gate agendado dark;
  causa não-introspectável offline.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs são
  invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-23)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/
db/` **vazio**; `HEAD` = o commit do próprio audit 10-23 (ontem).

**Ground-truth (mensurável):**
- **`ci-security` PLATÔ QUEBROU:** **115 vulns / 10 low / 55 moderate / 50 high** hoje vs 10-23 (**109 / 8-52-49**) →
  **+6 total, +1 high**. Composição: `braces` saiu de todas as severidades; **`zod@4.4.3` entrou no high**
  (GHSA-mrhx-c7xc-m3w5, core de validação de produção). 1ª movimentação após 48h de platô. Tendência
  **12→15→18→49→49→49→50**.
- **`ci-tests`:** RED idêntico (mesmo flaky `booking_notice:259` ~09:05 UTC), mas **com 2× teardown 57P01** (vs 0 no
  10-23, 1 no 10-22) — ruído de teardown testcontainers voltou.
- **`ci-scheduled-runs-dark`:** janela **recuada** — dark desde **09-22** (último run real Security 09-21), não "~10-05"
  como o 10-23 estimou. ~5 semanas, ~o dobro. A hipótese "auto-disable 60d" do 10-23 é **refutada** (runs executavam até
  09-21).
- fast-gate GREEN idêntico (Typecheck/Format/OpenAPI-parse/Build/Unit **469/469, 69 files**).

**0 REFUTAÇÕES DE CÓDIGO (vs 1 no 10-23):** nenhum dos 7 agentes conseguiu refutar um achado de código esta passada
(tentativas adversariais em LGPD #1/#4/#5/#9, money, harness — todas falharam na evidência de schema). O `mark-no-show`
segue REFUTED desde 10-23 (re-confirmado pelo route-reviewer: YAML `:2229` ↔ handler). O `conversations.priority_score`
foi explicitamente **não-inflado** (zero writers → dormante, não 2º vetor ativo).

**~13 misses/sharpenings NOVOS (todos verificados de fonte-primária; 2 pelo orquestrador):**
1. `dispatch-message-id-not-uuid-poisons-every-AI-dispatch` (CRÍTICO-GA; v: orquestrador) — `message_id=external_message_id`
   (não-UUID) vs `z.string().uuid()` → parse lança pré-enqueue → toda dispatch de IA auto-envenena.
2. `metaapi-webhook-preauth-db-amplification` (MÉDIO/GA-DoS; v: orquestrador) — 2 queries + decrypt **antes** do HMAC + sem
   rate-limit.
3. `rate-limit-plugin-dead-app-wide` (ALTO-GA; v: 2 agentes) — `requireRateLimit` zero callers; `@fastify/rate-limit`
   declarada mas não registrada; nenhuma rota throttled (login/money/webhooks).
4. `extra-override-unreachable-without-base-schedule` (sharpening do CRÍTICO-1) — `if(!sched) continue` precede a leitura
   do override → sem escape-hatch de bootstrap.
5. `no-appointments-read` **broadened** — nem staff-ops lê appointments → agenda ilegível p/ TODO ator, não só mobile.
6. `intake-pii-ingested-pre-notice` (MÉDIO/LGPD pilot-live) — customer+channel auto-criados na 1ª inbound sem aviso
   (ADR-019 item 6).
7. `dsr-export-unrecorded-no-dsr_requests-table` (GA/LGPD) — export sem audit_event nem `dsr_requests` (art.37).
8. `denormalized-appointment-pii-not-erasable` (GA/LGPD) — snapshots de PII sobrevivem erasure (set null só em customer_id).
9. `worker-has-no-healthz-readyz` (obs) + `httpRequestsTotal` cardinalidade-org (obs GA).
10. `manual-paid-refund-disjoint-lock-keys` (pilot-low) — lock-keys distintas não se excluem.
11. `google-webhook-events-no-org` + `appointments-customer-package-id-unenforced-fk` + `staff-impersonations-unindexed`
    (schema LOW/GA).
12. OpenAPI governança: `freeform-200-systemic` (12 ops staff-ops), `idempotency-key-param-self-inconsistency` (32/52),
    `metaapi-webhook-exemption-claim-inconsistent`, `appointments-metadata-jsonb-pii-sink` (LOW).
13. `newOpaqueId-uuidv4` re-confirmado (carry de 07-07, inerte).

**Sharpenings / de-escalações importantes:**
- `adr-021-priority-score` **SHARPENED (correção)**: a Opção C é **ADR aceita vinculante** que MANDA urgency_level/
  skip_count/fórmula/CHECK — não "reconhece client-writable como OK". É unmaterialized-binding, não aceito-como-está.
- `reconcile-refund-42703` re-afirmado **cron LIVE-wired** (a safety-net Stripe é DOA em prod) mas **pilot-inerte** (manual
  nunca `pending`).
- `manual-charge-overflow` **SHARPENED**: atinge **ambos** manual + Stripe.
- `is_private-unenforced` **NARROWED p/ LOW** (facts não egressam ao LLM em Marco-1); separado do gap GA real (sem
  base-legal em facts sensíveis).
- `section-11-3-indexes` "~40 FKs" **NARROWED** p/ "≥16 verificados, numerosos" (número preciso não re-contado).
- Sentry `beforeSend` ausente **NARROWED** (`sendDefaultPii:false` mitiga parcial → LOW).
- `default_model` asymmetry **NARROWED** (o default passa o harness).
- worker count **re-confirmado = 11** (`new Worker(` ×11; o "13" de um agente foi miscount).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH alcançável-no-
piloto + métrica-cega); `manual-remark orphan` (HIGH irreversível); `reconcile-refund-42703` (cron-only); `callback-token-
IDOR`; `rbac-org-role`; `clerk-provisioning`; os mismatches de `/complete` + o `status`-method 404 + `active_execution_id`
+ `buildDispatchMessages`-poison; toda a bateria LGPD; autonomia/observabilidade; priority-score/reminders/templates
Marco-2/3; a staleness `.claude`/CLAUDE.md/README; version-drift (22 commits, nenhuma imagem pós-`v1.0.1`); scheduled-CI-dark.

**Arco desde a passada mais antiga (06-02):** os **3 CRÍTICOs originais** (persistir telefone/`wa_id`; `seed-pilot`
executável em prod; testes de integração de booking) foram **fechados/recaracterizados**; os 2 CRÍTICOs atuais (grade +
calendar no seed) emergiram ~06-23 e **persistem há ~4 meses**; o gate auth-actor foi isolado no 07-20 e re-confirmado 7×.
**A frente de CRÍTICOs está estável e sem correção há ~4,7 meses; a dívida de segurança do lockfile saiu do platô
(49→50 high, `zod` novo) e o scanner agendado do GitHub está dark há ~5 semanas.**

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a
**re-verificar de fonte-primária** o inventário do 10-23 do seu domínio contra o **código atual** com evidência fresca
`file:linha`, a **REFUTAR** superestimações (com a lista explícita de refutados/de-escalados a NÃO re-flagar), e a caçar
misses. **5 usaram agent-types locais** deste repo (`.claude/agents/`): `harness-callback-auditor` (l),
`backend-staff-rbac-reviewer` (auth), `backend-schema-migration-engineer` (schema/índices/tracker h),
`backend-route-reviewer` (b), `Security Engineer` (payments j + channels k + auth-security); **2 general-purpose** (LGPD
g; calendar/pilot/obs a+m). **Resultado agregado: ~90 itens re-confirmados, 0 refutações de código, ~13 misses/sharpenings
NOVOS.**

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD --
src/ db/` = vazio; last-commit-touching src/ **e** db/ = `dbd231e` 06-03; 0 commits src/db desde 06-04); origin/main dos
4 repos (backend dbd231e / canon 78749711 / harness 2979eb0 / meta-api 5516c2a / hub fd1373b, inalterados); léxico legado
(grep triado = 232 sancionados, zero executável); categoria f (0 FIXME/HACK/XXX, 1 @deprecated, ~11 TODO Marco-2/3);
version-drift (`merge-base --is-ancestor dbd231e v1.0.1` = FALSE, 22 commits, describe `v1.0.1-34`); docs-stale
(`resolve-organization-id.ts` ABSENT + 6 citações vivas; CLAUDE.md §8 vs `generateMfaSecret`; backend-db.md "restrict");
delivery-tracker (10 delivered + 1 parked, lido verbatim de origin/main l.781-827); PRD §16.1 l.1483 CI-verde (lido de
origin/main — o working tree da canon está numa feature branch com PRD −58 linhas); worker count (**11** `new Worker`); os
2 achados-manchete NOVOS (`message_id` UUID-poison: `harness-dispatch.schema.ts:15,22` + `repository.ts:409` +
`ingestion.ts:40` + `harness-dispatcher.ts:91`; pre-HMAC amplification: `metaapi/routes.ts:141,150,156-169`).

**Ground-truth de CI rodado de fato** (2026-10-24 ~09:00–09:18 UTC; logs em `/tmp/audit-1024/`): Typecheck ✓ / Format ✓ /
OpenAPI-parse ✓ / Build ✓ / Unit ✓ (**469/469, 69 files**) = **GREEN**; `test:integration` = **RED exit 1** (`1 failed |
92 passed (93)`, flaky `booking_notice:259` ~09:05 UTC < 13:00 + **2× teardown 57P01**); `pnpm audit --audit-level high` =
**RED exit 1, 115 vulns / 50 high** (10 low · 55 moderate · 50 high · 0 critical; 19 módulos; `zod` novo, `braces` saiu);
`lint` = RED por artefato local (5 `.claude/state/gap*.js` gitignored → CI GREEN); `pnpm openapi:check` = exit 0 (mas é
parse-smoke, não validador). **Estado GitHub:** `gh run list --branch main` → scheduled runs em `startup_failure` (0s)
09-22→10-20 (último run real 09-21).

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree numa feature branch
(`fix/a14-bevox-meta-api-ig-callback-spec`) mas **`origin/main` @ `78749711` (06-03)** — leu-se `origin/main` para
PRD/ADRs/delivery-tracker (o PRD do working tree difere de origin/main em −58/+2 linhas → **sempre** origin/main).
Numeração de ADR **colide** entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner /
CodeQL não reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta
reais) não exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de
writers/endpoints + CI rodado (incl. 14 suítes de integração live Postgres+Redis). (4) MCP `stripe` + `claude.ai Google
Drive` requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5) Esta passada é
re-verificação sobre código byte-idêntico ao do 10-23; o valor incremental é **CI fresco (Security saiu do platô:
109→115, 49→50 high, `zod` novo na camada de validação; scheduled-dark recuado a 09-22) + 0 refutações de código + ~13
misses NOVOS (2 verificados pelo orquestrador) + várias correções de evidência/severidade**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-24. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
