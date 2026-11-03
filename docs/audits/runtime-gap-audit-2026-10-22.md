# Gap Analysis — bevox-backend — 2026-10-22

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo
> segundo a documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais deste repo — `harness-callback-auditor`,
> `backend-route-reviewer`, `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`, `Security Engineer`
> — + 2 general-purpose para LGPD e calendar/pilot/obs), cada um **re-verificando de fonte primária** o inventário
> do 10-21 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** superestimações +
> caçar misses; **verificação independente de fonte-primária pelo orquestrador** dos achados-manchete direto no
> código (incl. as 2 refutações desta passada); e **CI rodado de fato** (2026-10-22 ~09:04–09:08 UTC, não inferido;
> logs em `/tmp/ci-2026-10-22/`). Sucede `runtime-gap-audit-2026-10-21.md`.

## Resumo executivo

**10ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,5
meses.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é **vazio** — o produto é byte-idêntico desde
`dbd231e` (2026-06-03). Canon `bevox-knowledge` `origin/main` @ `7874971` (06-03), `bevox-harness` `origin/main` @
`2979eb0` (06-03), `bevox-meta-api` `origin/main` @ `5516c2a` (06-22) — **todos inalterados vs 10-21 (ontem)**. Os 7
auditores + o orquestrador **confirmaram o inventário de código do 10-21**, mas — **ao contrário do 10-21, que
reportou "0 refutações de código" — esta passada produziu 2 refutações/correções de fonte-primária** (abaixo), além
de ~15 misses/sharpenings NOVOS e uma descoberta de governança de CI.

**Manchete-delta #1 — 2 REFUTAÇÕES independentes (o valor incremental real desta passada).** Re-verificação
adversarial derrubou duas afirmações herdadas: (a) **`channel-phone-always-null-provider-join`** (um "NOVO" do 10-21)
está **REFUTADO** — `intake.ts:48,63,84` grava **ambas** as colunas `provider` (`channel_connections` e
`customer_channels`) com o **mesmo** `"wa"`/`"ig"`, logo o join `ch.provider = cc.provider` (`metaapi/repository.ts:188`)
casa; o único `null` é `ctx.provider` via a coerção `:197` — que **já é** o `vocab-mismatch` (#8), não um defeito
independente. (b) O parentético **"`createCalendar` nunca é chamado"** (dentro do CRÍTICO-2) está **corrigido** —
`createCalendar` existe (`calendar/repository.ts:20`) e está route-wired (`routes.ts:38` POST); o gap correto é "o
seed não o chama e não há bootstrap não-HTTP", não "sem caller". O CRÍTICO em si sobrevive. (Correções menores de
contagem/cite também: DSR tem **2** rotas DELETE de recurso, não 1; `agent_configs`/`organization_meta_api_tenant`
têm `organization_id` como **PK** → indexados, fora do gap FK-index; enums Zod do `/complete` vivem em
`harness-callbacks.schema.ts:16,35`.)

**Manchete-delta #2 — "CI verde" (único critério mensurável de Marco-1, §16.1 l.1483) continua RED; o Security
PLATEAUOU em 49 high.** Ground-truth rodado 2026-10-22 ~09:04 UTC: **Typecheck ✓ / Format ✓ / OpenAPI ✓ / Build ✓
(tsc+tsc-alias+dist-alias-gate) / Unit ✓ (469/469, 69 files) = GREEN**; **Tests RED** (`test:integration` exit 1:
`1 failed | 92 passed (93)` — o mesmo flaky dependente de hora-do-dia `calendar-booking.test.ts:259` [rodei ~09:05
UTC < ~13:00 threshold → `booked` em vez de `slot_conflict`] + teardown **57P01 ×1**); **Security RED** (`pnpm audit
--audit-level high` exit 1: **109 vulns — 8 low / 52 moderate / 49 high / 0 critical**, vs **106 / 49 high** no 10-21
→ **+3 total, +0 high**; **os mesmos 19 módulos high distintos**). A tendência de dívida de segurança —
**12 → 15 → 18 → 49 → 49** — **estabilizou em 49 nesta janela de 24h** (a explosão 18→49 foi *antes* do 10-21; hoje é
platô). O **lint-RED é artefato local** (5 `.claude/state/gap*.js` gitignored, mtime jul; `git check-ignore`
confirma os 5; esta sessão não adicionou nenhum → checkout de CI limpo não os vê → **CI lint GREEN**).

**Manchete-delta #3 — NOVO (governança de CI): o Security/CodeQL agendado no GitHub está DARK desde ~2026-10-05.**
As 9 passadas anteriores rodaram os jobs **localmente**; nunca olharam o estado real no GitHub. Olhei: todo run
`schedule` em `main` (Security seg-cron + CodeQL ter-cron) termina em **`startup_failure` (0s, sem jobs)** desde
~05-out — não executa mais. *Antes* de ~out, os scheduled executavam e `pnpm audit`+`OSV Scanner` davam **failure**
toda semana (CodeQL verde). `origin/main` não recebe push desde `dbd231e` (06-03); a última atividade do repo foi um
Dependabot em 2026-08-09 → o início do `startup_failure` casa com a janela de ~60 dias do **auto-disable de
workflows agendados por inatividade** do GitHub. Efeito: o gate de segurança automatizado do lado-GitHub está
**nem-rodando-nem-alertando**, compondo o `pnpm audit` já-RED.

**O piloto morre no passo 2 ("ver agenda"), triple-gated — inalterado e re-verificado por 2 agentes + orquestrador,
agora com o CRÍTICO-2 ELEVADO.** (a) `seed-pilot` provisiona só org + `staff_account` (JWT **HS256**), mas **toda**
rota de calendar exige `requireClerkAuth()` (**RS256** + claim `organization_id`) e **nenhuma** pareia `requireStaff`
(`grep requireStaff src/modules/calendar/` = 0) → o principal semeado toma **401 antes** dos CRÍTICOs (gate de
provisionamento Clerk/ops). *Se um JWT Clerk for provisionado à mão:* (b) `availability.ts:75 notFound("Calendar")`
— seed não cria `calendars`; (c) grade vazia → `availability.ts:126 if(!sched) continue` → `slots:[]` →
`booking.ts:207 slot_conflict` em 100%. **ELEVAÇÃO (v: agente calendar + orquestrador): `professional_schedules`
não tem escritor em lugar nenhum do app** (grep: só o docstring `availability.ts:5` + o READ `:116`; `weeklySchedule`
símbolo = **0**) → a grade semanal é **estruturalmente não-populável por TODAS as orgs**, não só um gap de seed; não
é corrigível por config. ADR-010 (calendar/WeeklySchedule) é **aceita** (canon `aceita_em 2026-04-22`) → os 2
CRÍTICOs são gap contra entidade canônica nomeada, não deferimento. **Fix mínimo ≈ 2-3h** (seedar Calendar + grade
Seg-Sex) **mas** o fechamento real do CRÍTICO-2 exige um **writer de WeeklySchedule** (rota/repo, ≈ 4-6h).

**Money-path manual do piloto FUNCIONA, com 2 bugs HIGH alcançáveis — um deles agora pior.** (1)
`outbound-provider-vocab-mismatch` **(HIGH, o defeito confirmado mais danoso)**: inbound persiste `"wa"`/`"ig"`
(`normalize.ts:16,35,44`), outbound null-coage provider ≠ pleno (`metaapi/repository.ts:197`) →
`skipped_missing_recipient` → `isDeliveryFailure` exclui skips → execução fica `done` (**falso-sucesso**);
`bevox-meta-api` `origin/main` exige `z.enum(["whatsapp","instagram"])` (`messages/schemas.ts:7`) → `wa`/`ig` é
invenção 100%-backend. **NOVO:** a métrica do skip loga `channel:"unknown"` (`executions/seams.ts:373`) → cega o
dashboard exatamente para esse drop. (2) `manual-remark-inserts-orphan-paid-payment` **(HIGH, agora AGRAVADO)**:
re-marcar paga uma charge `expired`/`refunded` insere payment `paid` órfão + confirma appointment + concede pacote;
**NOVO (v: Security Engineer): o órfão é IRREVERSÍVEL** — `refundChargeManually` exige `status==='paid'`
(`service.ts:499`), mas a charge ficou `expired`/`refunded` → o payment órfão nunca pode ser estornado por nenhum
caminho normal (de "linha órfã" para **corrupção de ledger irreparável**).

**Caminho de fechamento do piloto curto e inalterado:** 2 blockers de agenda (≈ 2-3h seed + ≈ 4-6h writer de grade)
+ gate de CI (flaky+teardown ≈ 0,5h; audit ≈ 4-6h por 49 highs) + gate de auth-actor (ops Clerk, ou ~4-6h) ≈
**~1-1,5 dia**. Severidades ancoradas no gate do **piloto**; para GA vários ALTO/MÉDIO sobem (vocab de canal,
token-IDOR, o `status`-callback 404 ponta-a-ponta e `dead_letter` viram CRÍTICO de GA).

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária (imprecisões herdadas, re-confirmadas nesta passada):

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`) — **não** `/complete,/artifact,/tool-result,/turn`
   como o brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (não "channels"). Channels = **_shared/ADR-011**.
   backend/ADR-018 = refund/cancellation policy (`aceita 2026-05-19`). backend/ADR-014 = PSP Stripe Connect
   (**um** endpoint webhook + um secret no canon l.134/172; código usa **dois**, ambos `requiredInProd` → sem gap de
   prod). backend/ADR-023 = manual payment mode (**`aceita`** 2026-05-22). backend/ADR-010 = calendar/WeeklySchedule
   (**`aceita`** 2026-04-22). **backend/ADR-016 (token-billing) = `proposed`** → corretamente NÃO implementado.
3. O grep `account_id\b` do brief captura compostos **sancionados** (`external_account_id`/`payment_account_id`/
   `channel_account_id`) + o alias financeiro `AS account_id` (`payments/repository.ts:1012,1018` — semântica Stripe,
   reservada por rule) + doc-comments do rename + snapshots drizzle + tipo gerado. O léxico proibido **executável** é
   **ZERO** (invariante §4.1 mantida — não-gap). Ver categoria c.
4. Código congelado desde **06-03** (`dbd231e`), não 06-04. `git describe HEAD` = `v1.0.1-32-g1bb6a7d` (o `-32` subiu
   de `-31` por causa do próprio commit de audit do 10-21; docs-only).
5. Numeração de ADR **colide** entre `backend/` e `_shared/` (008–023) — **sempre qualificada** abaixo.
6. **RBAC de staff é canon backend/ADR-013** (roles `bevox_admin|bevox_support|bevox_observer`, ADR-013 l.108),
   **não ADR-022** (backend/ADR-022 = policy-json sub-keys). A rule local `.claude/rules/backend-routes.md` mis-cita
   "ADR-022 staff RBAC" + nomes curtos + invoca o inexistente `requireRole` — ver BAIXO/governança.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 prontidão + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1481-1483)** inclui literalmente `[ ] Repositório bevox-backend
  criado; CI verde.` ⇒ o único bloqueador **mensurável** de Marco-1 é **CI-verde (RED em Tests + Security)**.
- **§16.2 Marco-2** (calendar, conversations, messages, channels, ai-pipeline, autonomy; e2e; idempotência tools;
  métricas Prometheus; cobertura ≥70%). **§16.3 Marco-3** (payments Stripe Connect, reminders, faq, rules, audit,
  observabilidade completa; WhatsApp direto; **LGPD DSR/retenção/consentimento**; **MFA TOTP**; SLO; rate-limit
  distribuído). Linha 1507 = checkbox **não-marcado** "LGPD: flow de DSR, retention, consentimento".
- **Fato estrutural:** o código entrega muito além de Marco-1 (calendar, payments, channels, autonomia,
  observabilidade parcial) — o README "Marco 1 bootstrap" **subdeclara** o que existe. O piloto exercita calendar +
  payments-manual (ADR-023 aceita) + o worker assíncrono independentemente do rótulo → os 2 CRÍTICOs são
  **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".
- **_shared/ADR-019 + ADR-020 (ambas aceitas ~2026-04-23):** mandam `consent_events`/`dsr_requests`/`legal_basis`,
  `bevox.retention.worker`, pseudonimização de `messages.content_text`, DELETE cascade por titular. **grep global
  `legal_basis|consent_event|dsr_request|retention|pseudonym` em `src/ db/ scripts/` = ZERO** → o modelo canônico de
  consentimento/retenção está ausente (Marco-3 por roadmap; mas o piloto roda com PII real). PRD §12.9 l.1354-1359 é
  o spec concreto (DELETE cascade+pseudonimizar, `message_archive`, export "dump JSON completo", `consent_granted_at`).

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-22) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` **ELEVADO app-wide** (CRÍTICO); `no-appointments-read-endpoint`; ADR-020 templates + ADR-021 priority-score não-materializados |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recontagem independente: **103 call-sites / 89 code-paths / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / 0 phantom / 11 undoc**; 2 NEW sub-findings inertes; `/metrics` documentado (non-gap) |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO** (3 `workspace_id` doc-comment + residual `account_id` = composites sancionados + alias financeiro + doc-comments) |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | `mfa.ts:35` blocklist + `seed-pilot.ts:153` gera base32 + `assertMfaSecretNotPlaceholder`; login sem MFA = **correto** (Marco-3); `CLAUDE.md §8` stale |
| e | Testes faltando (hot paths) | ✅ | webhook Stripe (`constructEvent`=0 em test/) / reconcile-refund (só unit mockado → 42703 CI-invisível) / availability-rota / inbound-vocab — zero e2e |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); **11** TODOs todos Marco-2/3 |
| g | LGPD | ✅ | consent/`ai_opt_out` armazenado-não-aplicado (vetor vivo); `received_events`/`message_records` PII-cru não-apagável; DSR export incompleto + sem deleção; **4 misses NOVOS** |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main `delivery-tracker.yml:781`); nenhum work-item p/ calendar/ADR-010 → grade CRÍTICA **invisível** ao tracker |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky+teardown) + Security RED **49 high / 109** (platô); lint-RED = artefato local gitignored; **NOVO: scheduled CI dark no GitHub (startup_failure)** |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + IRREVERSÍVEL**; `reconcile-refund-42703-DOA` (CI-invisível); `money-mutation-idempotency` by-design; PCI-nil; conformances confirmadas |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH** + métrica-cega; unknown-provider-silent-drop; null-tenant-500; **`channel-phone-join` REFUTED**; HMAC correto |
| l | Harness dispatch | ✅ | `status`-callback **POST↔PATCH 404 total** (broadened; dead_letter é o caso estreito); token-IDOR; `active_execution_id` wedge; todos inertes no piloto |
| m | Alçapões do piloto | ✅ (traçado) | **triple-gated** (auth-actor + calendar + grade app-wide) inalterado; money-path manual OK com 2 bugs HIGH; worker-telemetry buraco-negro |
| n | Delta vs audit anterior | ✅ | 10-21 re-verificado; **2 refutações** (vs 0 no 10-21); Security platô 49 high; ~15 misses/sharpenings NOVOS; NEW governança CI-scheduled-dark |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN — PASSA, classe de token errada.** `seed-pilot` cria org + `bevox_admin`; `POST /staff/sessions` cunha
   JWT staff **HS256** (`staff-auth.ts:67-92`). Só serve a rotas `requireStaff`. Sem rate-limit/lockout.
2. **VER AGENDA — QUEBRA na AUTH primeiro.** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`calendar/routes.ts:22`; `clerk-auth.ts:90,105-108`) + claim `organization_id` → token staff HS256 → **401**.
   *Se JWT Clerk à mão:* → `availability.ts:75 notFound("Calendar")` (**CRÍTICO b**). *Se Calendar à mão:* → grade
   vazia (**CRÍTICO c, app-wide**). Sem `GET /appointments` para ver agendamentos sobre REST.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100%. (Endpoint é calendar-nested
   `POST /calendars/:id/appointments`, consistente com §10.1 l.967 + §8 l.385; PRD §8.3-step1 l.867 em prosa diz
   org-nested — inconsistência interna do PRD, não bug de código.) **Main-path exactly-once É SÃO** (advisory
   xact-lock + recount in-lock + unique index + replay 23505; POST honra `Idempotency-Key`). Reschedule/transition
   têm 4 defeitos de correção; create/reschedule/transition não gravam `audit_events` (§12.8).
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** Pré-requisitos escondidos (confirmados):
   serviço semeado sem `requiresPrepayment` → default `false` (`catalog.ts:67`; hook `booking.ts:275` nunca dispara)
   **e** `seed-pilot` não cria `payment_accounts` → precisa de `POST /payment-account/connect-manual` à mão (mesmo
   gate Clerk). **1 bug HIGH irreversível** re-mark de charge terminal.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile
   cru sem orquestração; **reconcile de refund DOA (42703)** — crons **LIVE** (`queue/index.ts:70-76` registra os 2
   repeatable). Modo manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[CHANGED]`/`[REFUTED]` = status vs 10-21; **(v: …)** = verificação independente
(orquestrador fonte-primária, ou agente com evidência fresca); `[xrepo]` = dependência cruzada. Severidade ancorada
no gate do **piloto**; escalonamento p/ GA anotado. `file:linha` = evidência lida **nesta** sessão sobre código
byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry, ELEVADO]` **(v: CONFIRMADO ×3 — orquestrador grep + agente calendar
  + agente schema)** — Nenhum caminho do app escreve `professional_schedules` (grade semanal-base). Único `INSERT` =
  fixture `test/integration/calendar-booking.test.ts:120` (SQL cru). Símbolo `weeklySchedule`/`weekly_schedule` =
  **0 hits** em todo o repo. Produção só lê (`availability.ts:116`); `:126 if(!sched) continue` esvazia todo dia →
  `slots:[]` → `booking.ts:196/207 slot_conflict`. **ELEVAÇÃO vs 10-21:** o gap não é "o seed não semeia a grade" —
  é que **nenhum writer existe em lugar nenhum**, logo a grade é estruturalmente não-populável por **qualquer** org
  (não só o piloto). Escopo §5.3 (backend/ADR-010 **aceita**). — Impacto: 100% dos agendamentos = `slot_conflict`,
  app-wide. — Esforço: **4-6h** (rota+schema+repo+teste de WeeklySchedule) ou **2h** (só seedar grade como paliativo
  do piloto). **#1.** `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry, parentético corrigido]` **(v: CONFIRMADO ×2 — orquestrador +
  agente schema)** — `seed-pilot.ts` tem **exatamente 4** `.insert(`: organizations (:110), staffAccounts (:157),
  professionals (:195), services (:217). Zero `calendars` → `availability.ts:75 notFound("Calendar")`. **CORREÇÃO
  (v: schema + orquestrador):** o parentético "`createCalendar` nunca é chamado" do 10-21 é **impreciso** —
  `createCalendar` existe (`calendar/repository.ts:20`) e está route-wired (`routes.ts:38` POST); o gap correto é "o
  seed nunca o chama e não há bootstrap não-HTTP". `system_holidays` omitido é **fail-open** (`availability.ts:
  108-111`), **não** co-bloqueador. **NOVO (v: schema):** `professional_services` também não é semeado → availability
  cai no fallback "todos os profissionais bookáveis" (`availability.ts:91-96`), mascarando o link serviço↔profissional
  na escala do piloto. — Esforço: **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×2 + grep)** — seed provisiona **só**
  org + `staff_account` (HS256, `staff-auth.ts:70,83`); toda rota de calendar é `requireClerkAuth()` RS256
  (`calendar/routes.ts:22,24`) + claim `organization_id` → token staff rejeitado 401. `grep requireStaff|requireRole
  src/modules/calendar/` = **0**; o seed não cria usuário Clerk nem row `users`. Gate de provisionamento Clerk/ops;
  sit **upstream** dos 2 CRÍTICOs. — Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-22; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-teardown`** `[carry]` **(v: RODADO)** — `pnpm test:integration` =
  **RED exit 1**, `1 failed | 92 passed (93)`. Falha = `calendar-booking.test.ts:259` "slot_conflict quando start_at
  < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be 'slot_conflict'` — o gate só dá
  `slot_conflict` se `now() > ~13:00 UTC`; rodei ~09:05 UTC → `booked`. + teardown **57P01 ×1** (suíte não fecha
  `closeDb/closeRedis` no `afterAll`). `ci.yml` job `Tests` (l.80) roda integração sem `continue-on-error`. — Esforço:
  **0,5h** (slot `now()`-relativo + `await closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-49-high`** `[carry, platô]` **(v: RODADO)** — `pnpm audit --audit-level high` =
  **RED exit 1, 109 vulns (8 low · 52 moderate · 49 high · 0 critical)** vs **106 / 49 high** no 10-21 → **+3 total,
  +0 high**; **os mesmos 19 módulos high**: `@fastify/static`, `@grpc/grpc-js`, `@opentelemetry/{auto-instrumentations
  -node,exporter-prometheus,propagator-jaeger,sdk-node}`, `brace-expansion`, `braces`, `fast-uri`, `fastify`,
  `find-my-way`, `js-yaml`, `nanoid`, `postcss`, `protobufjs`, `source-map-js`, `tmp`, `undici`, `vite`. Highs
  prod-runtime no core do Fastify (`fastify`/`@fastify/static`/`find-my-way`). `security.yml` (`continue-on-error:
  false`, l.38-39) + `osv-scanner` → hard-fail. **Tendência 12→15→18→49→49: a explosão foi pré-10-21; nesta janela de
  24h estabilizou.** — Esforço: **4-6h** (bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/
  fast-uri/nanoid). **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[NOVO]` **(v: orquestrador — `gh run list`/`gh api`)** — todo run `schedule`
  em `main` (Security seg-cron `security.yml:8-9`; CodeQL ter-cron `codeql.yml:8-9`) termina em **`startup_failure`
  (0s, `path:BuildFailed`, sem jobs)** desde ~2026-10-05. Historicamente (check-runs de `dbd231e`) os scheduled
  executavam e `pnpm audit`+`OSV Scanner` davam **failure** semanal (CodeQL "Analyze TypeScript" verde). `origin/main`
  sem push desde 06-03; última atividade = Dependabot 2026-08-09 → início casa com o auto-disable de ~60 dias de
  workflows agendados por inatividade do GitHub. Efeito: gate de segurança agendado **nem roda nem alerta**. — Esforço:
  **0,2h** (um push/re-enable) — mas o fix real é destravar o lockfile (acima). `[xrepo: GitHub Actions]`

**Canais / money — alcançável no piloto**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(v: CONFIRMADO — Security Engineer cross-repo;
  "defeito confirmado mais danoso")** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:16,35,44`) e
  **persiste `"wa"`** em `channel_connections.provider` (`routes.ts:237,246` → coluna `notNull()` **sem CHECK**,
  `channels.ts:22`). Outbound `findExecutionDeliveryContext` null-coage provider ≠ pleno (`metaapi/repository.ts:197`)
  → `ctx.provider=null` → guard `executions/seams.ts:360` → `skipped_missing_recipient` (`:376`); `isDeliveryFailure`
  exclui skips (`seams.ts:122-124`) → `complete-service.ts:100` fica `done` (falso-sucesso). `bevox-meta-api`
  `origin/main` (`messages/schemas.ts:7 z.enum(["whatsapp","instagram"])`) exige enum pleno → `wa`/`ig` é invenção
  100%-backend. **NOVO (v: Security):** `executions/seams.ts:373` loga a métrica do skip com `channel:"unknown"` →
  cega o dashboard para o próprio drop. **Alcançável NO piloto via staff-approve.** — Impacto: 100% das respostas a
  conversas inbound-semeadas descartadas em silêncio. — Esforço: **3-4h** (unificar vocab + CHECK + backfill + teste
  e2e). **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, AGRAVADO → irreversível]` **(v: CONFIRMADO — Security
  Engineer + orquestrador)** — `applyChargePaid` chama `insertPayment` **incondicional** (`service.ts:891`) após
  `markChargePaid` (guardado `WHERE status='pending'`, void sem rowcount, `repository.ts:395-398`).
  `markChargePaidManually` **não** tem status-gate (`service.ts:428-433`; docstring `:415-416` proíbe-o por design).
  Re-mark de `expired` (via `expireChargeManually`) ou `refunded` (`markPaymentReversed` libera o slot único
  `repository.ts:916-919`) → payment `paid` órfão fresco + `confirmAppointmentIfUnconfirmed` (`:901-903`) + grant de
  pacote (`:915-924`). **NOVO AMPLIFICADOR (v: Security):** o órfão é **irreversível** — `refundChargeManually` exige
  `status==='paid'` (`service.ts:499`), mas a charge ficou `expired`/`refunded` → nunca estornável (de "linha órfã"
  para corrupção de ledger **irreparável**). Root-cause compartilhado alcança o path Stripe (`webhook-platform.ts`).
  Fix: `markChargePaid` RETURNING rowcount + gatear os 3 side-effects (NÃO um status pre-check — quebraria re-marks
  idempotentes legítimos). — Esforço: **2-3h**. **#4.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA/outbound ligar — INERTE no piloto)**

- **`harness-status-callback-method-mismatch-total`** `[carry, BROADENED]` **(v: CONFIRMADO byte-level nos 2 repos +
  canon — harness agent + orquestrador)** — o 10-21 tratou isso como "`dead_letter` inalcançável"; o defeito real é
  mais amplo: **nenhum** callback de status funciona. Harness `updateStatus` sempre **POSTa** (`bevox-callback.ts:28`;
  POSTa `running` e `dead_letter`), backend só registra **PATCH** `/status` (`harness-callbacks.routes.ts:56`; não há
  POST /status) → **toda** chamada de status → Fastify **404**. Consequência: execuções nunca transicionam
  `dispatching→processing` via sinal do harness (só via o `lockForCompletion` do `/complete` ou o timeout-scan);
  `applyStatusTransition` + `markExecutionDeadLetter` + toda a maquinaria ADR-019-Am1 são **código morto
  ponta-a-ponta**. Raiz = contradição do canon **PRD §10.1 POST (l.447) vs §10.4 PATCH (l.1076)**; backend é
  **canon-correto** (§10.4/§8 l.817). O worker `on('failed')` do backend (`queue/index.ts:267-269`) só **loga** (2ª
  quebra independente). Rules `backend-harness-contract.md`/`backend-workers.md` mis-atribuem a escrita ao worker do
  backend. Fix = **cross-repo** (harness→PATCH + errata canon §10.1). — Esforço: **~1,5h** (harness + canon). **#7.**
  `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry]` **(v: CONFIRMADO — harness agent + orquestrador)** —
  o preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:71,96`), mas
  **todo** handler age sobre o `:id` **da URL** (`harness-callbacks.routes.ts:73,91,113,142`) e **nunca** compara
  (`req.executionContext` só é atribuído — grep de READ = 0). Token válido para A escreve em qualquer execução B
  (IDOR cross-execution/cross-tenant); o branch `dead_letter` usa `resolveExecutionTokenAnyStatus` → alcança até
  execuções terminais. Conformance `four-callbacks-token-gated` (token ruim→401) **permanece** (autenticidade ≠
  autorização). **Inerte no piloto**; **CRÍTICO-GA**. — Esforço: **1h** (asserção `executionContext.execution_id ===
  id` → 403). `[xrepo: bevox-harness]`
- **`completion-never-clears-active-execution-id`** `[carry, broadened]` **(v: CONFIRMADO — harness agent re-traçou
  os writers)** — só `releasePipelineClaim` (pre-dispatch-fail, `orchestration/repository.ts:231`) e
  `handoffConversationOnTimeout` (`:464`) nulam `active_execution_id`; `/complete`/`finalizeCompletion`/`resolveComplete`
  e approve/edit/reject em `staff-ops` **nunca** o limpam (`repointPipeline` só re-aponta, `:98`). Guard de dispatch
  exige `active_execution_id IS NULL` (`:196`) → qualquer 1ª execução bem-sucedida trava a conversa (turno-2
  `cutoff.ts:45 claimed:false`). — **Inerte no piloto**; **CRÍTICO-GA** (IA single-turn). — Esforço: **3-4h**.
  `[xrepo: bevox-harness]`
- **`complete-failed-strategy-not-mapped-to-error`** `[carry]` **(v: CONFIRMADO — bug de código backend-vs-canon)** —
  `strategy:"failed"`+proposals vazias → `inferSuggestionType→"reply"` (`complete-service.ts:22`); autonomous →
  `done` (texto vazio=skip); manual/copilot → `waiting_approval`. Nunca `error`. Canon (backend/ADR-019 Am1 l.163-166)
  exige `error` (e constrói a precedência dead_letter>error sobre essa premissa — que fica moot). — Esforço: **2-3h**.
  `[xrepo]`
- **`backend-never-sends-skills-allowlist`** `[carry]` **(v: CONFIRMADO — harness agent)** — `cutoff.ts:75 skills:[]`
  hardcoded; `staff-ops/actions.repository.ts:144 skills:[]`; `account_denied_tools` **nem existe** no
  `DispatchPayloadSchema` (`harness-dispatch.schema.ts:25-63`); harness trata `[]` como "todas as tools"
  (`execution-handler.ts:654-659`) → PERM-05 (allowlist por org) é **no-op** e2e. — **Inerte no piloto**; CRÍTICO-GA.
  — Esforço: **4-8h**. `[xrepo: bevox-harness]`
- **`complete-trusts-body-organization-id-over-authoritative-row`** `[carry]` **(v: CONFIRMADO — harness agent)** —
  `/complete` lê tenant do **body** (`harness-callbacks.routes.ts:150-154 bodyOrgId ?? row`) sem checar `=== existing.
  organization_id` (traces/stream usam a row — assimetria); com o token-IDOR = primitiva de escrita cross-tenant de
  audit/realtime. — **1h**. `[xrepo]`
- **`complete-rejects-aborted-strategies-400`** `[carry]` **(v: CONFIRMADO — bug de HARNESS)** — harness emite
  `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2096-2100`); enum backend omite (`harness-callbacks.schema.
  ts:57-65`) → ZodError → 400 → harness dropa a completion. Canon fica com o backend (l.1104). — **~1h** (harness) +
  errata canon. `[xrepo]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — route-reviewer)** — Não existe `GET /appointments`
  nem `/appointments/:id`; calendar GET expõe só `/calendars` (`routes.ts:28`) + `/availability` (`:48`). §10.1 não o
  enumera, mas persona mobile ("agenda do dia") + Fluxo 3 (§8.3) exigem → agendamentos write-only sobre REST. —
  Esforço: **3-5h**. `[xrepo: PRD §5.3/§8.3]`

**Auth / segurança (Marco-1; alguns mitigados no piloto 1 org/1 admin) — todos CONFIRMADOS pelo agente RBAC**

- **`staff-jwt-secret-no-min-length`** `[carry, N1 CHANGED]` **(v: CONFIRMADO)** — `env.ts:60 STAFF_JWT_SECRET:
  optionalString` (sem `.min()`); refine de prod é **presence-only** (`:205-206 if(!val[key])`) → secret de 1 char
  passa; `staff-auth.ts:53,70` assina HS256. Secret fraco = forjável offline → compromisso **total** do plano staff.
  **N1 (v: RBAC — CHANGED):** o mesmo secret assina o JWT de `state` do Google OAuth (`calendar/google/oauth.ts:
  95,107,129-139`), **mas os dois planos usam audiences distintas** (`STAFF_AUDIENCE` vs `OAUTH_STATE_AUDIENCE`, ambas
  verificadas) → **não há replay cross-plane**; o risco compartilhado é puramente o **piso de entropia** (uma chave
  fraca forja os DOIS independentemente), não confusão de tipo de token. — Esforço: **0,5-2h** (`.min(32)` + idealmente
  `GOOGLE_OAUTH_STATE_SECRET` separado). **O buraco de segurança mais duro.**
- **`staff-login-no-ratelimit-no-lockout`** `[carry]` **(v: CONFIRMADO)** — `auth/routes.ts:90-94,97-101` login/
  refresh sem `preHandler`; sem contador/lockout (`service.ts:64-90`); `requireRateLimit` (`rate-limit.ts:146`)
  aplicado a **zero** rotas; bcrypt cost 12 é o único freio → brute-force online contra `staff@example.com`. — Esforço:
  **2-4h**.
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — canon-reforçado)** — `requireRole` só existe como 3
  TODOs (`clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`); zero impl/caller; `clerk-auth.ts:109 role =
  … ?? "member"` (nem é valor do enum `owner|admin|operator|professional_viewer`). Rotas cliente mutantes (money,
  DELETE/PATCH professionals|services, PATCH org/settings+onboarding+autonomy, approvals, PII customers, waitlist) têm
  só `requireClerkAuth+requireOrganizationScope` → qualquer JWT org-member roda tudo intra-org (org-scope ainda
  bloqueia cross-org). **Canon ADR-013 l.143** manda "middleware rbac aplica permissões por role" — não entregue.
  Blast-radius baixo no piloto (1 org/1 admin). — Esforço: **1-2d**. `[xrepo: backend/ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO)** — `auth/repository.ts:221-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id)
  + `routes.ts:169-171 orgClaim = organization_id ?? clerkUserId`; webhook só trata `user.*`, sem
  `organization.created` → 1º user de uma org inprovisionável (chicken-and-egg). Mitigado no piloto (seed). — Esforço:
  **4-8h** (+ADR org-mapping). `[xrepo: Clerk]`
- **`clerk-jwt-no-aud-iss-validation`** `[carry]` **(v: CONFIRMADO)** — `clerk-auth.ts:89-92` verifica só
  `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim não-verificada
  (`:105`). Alg-confusion bloqueado, JWKS pinado; **staff-side checa `audience`** (mitigantes). — Esforço: **0,5-1h**.
- **`impersonation-id-is-not-organization-id`** `[carry, N2 sharpened]` **(v: CONFIRMADO — latente/fail-closed)** —
  `auth/service.ts:135-139` seta claim `impersonation_id` ao PK da row `staff_impersonations`;
  `organization-scope.ts:57` retorna esse PK como org id → rota `:organization_id` sempre 403. Nenhuma rota pareia
  `requireStaff`+`requireOrganizationScope` → nunca consumido. **N2 (v: RBAC — sharpened):** `authRoutes` é plugin
  encapsulado (`server.ts:198`) → o hook onResponse de audit de impersonation (`auth/routes.ts:70-87`) **nunca
  dispara** nas rotas staff-ops (plugins separados); e as ações staff-ops **são** auditadas (`writeManualActionAndAudit`,
  `actions.repository.ts:175`) **mas sem linkagem a nenhuma sessão de impersonation** → a trilha impersonation→ação da
  ADR-013 l.109 está **ausente**, não apenas mis-hooked; `endImpersonationSession` não revoga o token HS256. —
  Esforço: **1-2d**. `[xrepo: ADR-013]`

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real) — CONFIRMADOS pelo agente LGPD**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` **(v: CONFIRMADO — vetor vivo, headline LGPD)** —
  `ai_opt_out` gravado/lido só no CRUD de customers (`customers/repository.ts:21,26,67`; **zero** outros readers);
  default `false` (opted-IN, `customers.ts:50`); `cutoff.ts:34-126` + `buildDispatchMessages` (`orchestration/
  repository.ts:391-415`, `content_text` cru) + dispatch **sem** carregar o customer nem checar `ai_opt_out` → cliente
  que revoga consentimento ainda tem a conversa mandada ao LLM externo (transferência intl, _shared/ADR-019 item 7).
  `consent_granted_at` = **zero writers** → o piloto processa conversas sem consentimento registrado E com a flag de
  revogação não-aplicada. — Esforço: **4-6h**. **#10.** `[xrepo]`
- **`waitlist-priority-score-client-settable`** `[carry]` **(v: CONFIRMADO — agentes schema + calendar)** — raw-storage
  writable (`calendar.ts:204 numeric notNull default '0'`, sem CHECK) escrito do input na rota pública
  (`waitlist/routes.ts:71`) **e** no seam de IA (`waitlist/seam-tool.ts:44,83`), e `match` ordena por ele
  (`repository.ts:331 ORDER BY priority_score DESC`); `urgency_level`/`skip_count`/`last_score_update` + fórmula + cron
  **não existem** → furar-fila aberto. **backend/ADR-021 (aceita) reconhece "priority_score é client-writable" como o
  defeito** (Opção C: derivado + `CHECK>=0` + urgency_level + skip_count + cron). — Esforço: **2h** (CHECK + drop de
  input) a **6-8h** (fórmula+cron). `[a/g; ADR-021]`

### MÉDIO (degrada qualidade)

**Observabilidade — worker é buraco-negro (harness inerte no piloto, exceto obs que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry]` **(v: CONFIRMADO ×2 — orquestrador grep + agente;
  ALTO-operabilidade, exercitado-no-piloto)** — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca**
  `import "./instrument.js"` nem `initTelemetry()` (ambos só em `src/index.ts:17,30`; `queue/index.ts:62` importa só
  captureException+shutdownTelemetry) → no worker o Sentry `captureException` (`:272,313`) é drop silencioso
  (`telemetry.ts:105-108` no-op sem client) e o OTel NodeSDK nunca inicia p/ **toda a metade assíncrona** do piloto. —
  **1h** (import + `await initTelemetry()`). **Alto valor / baixo esforço. #6.**
- **`worker-process-has-no-metrics-scrape-endpoint`** `[carry]` **(v: CONFIRMADO)** — `/metrics` é servido só pelo
  HTTP server (`health/routes.ts:24`); o worker não sobe listener → counters prom-client do worker (reconcile
  `:88,114,162,229,272`) **permanentemente não-scrapáveis**. — **1-2h**.
- **`domain-prometheus-metrics-not-registered`** `[carry]` **(v: CONFIRMADO)** — `shared/metrics.ts` não registra os
  de §12.10 l.1365 (`charges_succeeded_total`, `appointments_no_show_rate`, `executions_pending_approval_count`,
  `executions_timeout_total`) nem os de l.590 (`executions_total`, `charges_total`, `queue_jobs_completed_total`). —
  **2-3h**.
- **`domain-metrics-declared-but-never-emitted`** `[NOVO]` **(v: agente calendar — N1/N2)** — `metrics.ts:41 queueSize`
  gauge nunca recebe `.set()` → profundidade de fila não-observável; `metrics.ts:52 messagesReceivedTotal` (o counter
  de ingestão nomeado em §13.3) nunca recebe `.inc()` → volume de inbound não-metrado, **e o piloto exercita
  ingestão** (`metaapiInboundEventsTotal` está vivo — cobertura parcial). — **1h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` **(v: CONFIRMADO)** — `realtime/publish.ts:8-12`
  união fechada a `execution.*`/`waitlist.offered`; `appointment.created`(§8.3)/`charge.updated`(§8.4/§10.1) **nunca**
  emitidos → tela do profissional não auto-atualiza no agendar/pagar (o transporte SSE é são). — **2h**.

**Agenda — correção de dados quando exercitada (Marco-2; todos CONFIRMADOS pelo agente calendar)**

- **`appointment-mutations-no-auditevent`** `[carry]` — §12.8 l.1346 manda Appointment C/U/D → AuditEvent;
  `booking.ts:233-516` grava **zero** `audit_events` (só charge audita `:291,326`); autonomy + onboarding idem. —
  **3-4h**.
- **`reschedule-non-atomic-double-book`** `[carry]` — `booking.ts:373` create+outbox na própria tx (`:223`);
  `:390-414` cancela o antigo em tx **separada** → crash entre as duas = 2 appointments ativos + 'create' Google
  órfão. — **2h**.
- **`reschedule-self-overlap-always-conflicts`** `[carry]` — recount conta o appointment antigo (ainda `scheduled`;
  `availability.ts:169`+`booking.ts:229` excluem só `'cancelled'`, nunca self-id) → `max_concurrent=1` → remarcação
  sobrepondo = `slot_conflict`. — **1h**.
- **`appointment-transition-no-state-guard`** `[carry]` — `booking.ts:445` UPDATE any→any (só row-existence);
  `cancelled→completed` → decremento de pacote (`:485-499`) consome sessão de appointment cancelado. — **2h**.
- **`reschedule-double-charge-on-prepaid-service`** `[NOVO]` **(v: agente calendar — N3; inerte no piloto)** —
  reschedule re-entra em `createAppointment` (`booking.ts:373`), re-disparando o hook `requires_prepayment` (`:275`)
  → 2ª charge pending para o novo appt, enquanto o antigo é cancelado via UPDATE cru (`:392`) sem refund/void da sua
  charge → double-charge no reschedule de serviço pré-pago. **Inerte hoje** (nenhuma org tem `requires_prepayment=true`;
  seed=false). — **2-3h**. `[GA/Marco-2, money-adjacent]`
- **`reschedule-thin-idempotency`** `[carry]` — `booking.ts:387 idempotencyKey:undefined` → NULL; idemHit/idemStore
  no-op. (POST de create É idempotente.) §5.3 l.396. — **1h**.
- **`reschedule-drops-metadata`** `[NOVO]` **(v: agente calendar — N4)** — `rescheduleAppointment` (`booking.ts:
  373-388`) não carrega o `metadata` jsonb do appt antigo para a row nova. — **0,5h**.
- **`availability-n1-count-plus-92day-serial-loop-unbounded`** `[carry]` **(v: CONFIRMADO — GA-scaling/DoS)** —
  `availability.ts:167` COUNT(*) **por-slot** em loops por-membro(`:114`)×por-intervalo(`:160`)×por-slot(`:162`);
  `routes.ts:52` itera `date_from..date_to` serial até 92 dias (`schemas.ts:28-29`). Auth-guardado mas não
  rate-limited. Não pilot-blocking (1 prof). — **4-6h**.

**Contrato backend↔harness (mismatches; persistem — INERTES no piloto, ALTO-GA) — CONFIRMADOS pelo agente harness**

- **`completing-state-has-no-timeout-backstop`** `[carry]` — `lockForCompletion` seta `completing`
  (`harness-callbacks.repository.ts:126-134`); timeout-scan claima só `('dispatching','processing','waiting_input')`
  (`orchestration/repository.ts:425-430`) → crash entre lock e finalize deixa row órfã travada. — **1-2h**. `[xrepo]`
- **`stale-token-blind-status-transition`** `[carry, doubly-inert]` — `applyStatusTransition` é UPDATE cego sem guard
  de origem (`harness-callbacks.repository.ts:58-69`); alcançável só via o branch PATCH não-dead_letter — que o
  harness nunca atinge (POSTa, 404). — **1h** se wired. `[xrepo]`
- **`trace-content-field-dropped-on-persist`** `[carry]` — `harness-callbacks.repository.ts:194-205` mapeia só
  `step_type←type` etc.; o `TraceEntry` do harness carrega o payload em **`content`**(+`step`,`timestamp`) → esses 3
  caem; `sendTrace` sem callers no harness → /traces nunca invocado. — **1h**. `[xrepo]`

**Pagamentos / reconciliação (Stripe-path, não exercitado pelo piloto manual; crons LIVE)**

- **`reconcile-cron-flips-paid-and-cancelled-without-orchestration`** `[carry]` **(v: CONFIRMADO)** —
  `reconcile.ts:140-150 UPDATE charges SET status='paid'/'cancelled'` cru (charges TEM `updated_at` → executa) sem
  `applyChargePaid` → paid sem row em `payments`, appointment nunca confirmado, sem grant, sem audit. Manual pula
  (NULL provider_charge_id, `:119`). — **3h**.
- **`reconcile-cron-skips-applyChargeRefunded`** `[carry]` — `reconcile.ts:252-259` nunca chama `applyChargeRefunded`
  → viola backend/ADR-018 §5 l.117 (full refund de package ⇒ `cancelled`). **Composto com o 42703: a UPDATE nem
  executa.** (partial-refund-no-action é risco V1 **aceito** ADR-018 l.118-119 — não-gap.) — **2h**.
- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry]` **(v: CONFIRMADO ×3 — Security + schema +
  orquestrador)** — `reconcile.ts:255-257 UPDATE refunds SET status=…, updated_at = now()`, mas `refunds` **não tem**
  `updated_at` (`db/schema/payments.ts:149-172`; só `createdAt`; migrations 0011/0017/0019 não adicionam) →
  **Postgres 42703** em toda transição → `:262` catch → `failCount++` → status **nunca** sai de `pending` → reconcile
  de refund **DOA**. O irmão `reconcileStuckIntents` escreve `updated_at` em `charges` (que TEM). **NOVO (v: Security):
  o DOA é CI-invisível** — a única cobertura é `test/unit/payments-reconcile.test.ts` (unit, DB mockado schema-less)
  → o 42703 nunca aflora; sem teste de integração do cron (explica os 7+ passes de miss). Path manual
  (`updateRefundStatus`, omite `updated_at` por design) funciona. **Fix = remover `updated_at=now()` de `:257`** (NÃO
  adicionar a coluna). — **0,25h**. Stripe-path, inerte no piloto manual; ALTO-GA. `[xrepo: Stripe]`
- **`stripe-webhook-zero-route-signature-dedupe-tests`** `[carry]` — 0 `constructEvent` em `test/`; o teste homônimo
  (`payments-webhook-platform.test.ts`) mocka o repo e testa `applyChargePaid/Refunded`, nunca injeta `POST /webhooks/
  stripe[/platform]` nem exercita assinatura/dedupe. Ponto de entrada de dinheiro sem cobertura e2e. — **6h**. **#8.**
  `[xrepo: Stripe]`
- **`requires-prepayment-hook-throws-manual-mode`** `[carry]` — `booking.ts:275,299` hardcoda Stripe `createCharge`;
  conta manual (`external_account_id=NULL`) → `service.ts:193 lança`; caught best-effort (audita `charge.hook_failed`
  `:329`) → prepayment não coletado em orgs manuais (silencioso). — **2-3h**. `[xrepo: ADR-023 vs ADR-014]`
- **`pix-reconcile-split-2-endpoints-vs-adr014`** `[carry, INFO]` **(v: CONFIRMADO — canon l.134/172)** —
  `/webhooks/stripe` (`webhook.ts:31`) + `/webhooks/stripe/platform` (`webhook-platform.ts:32`); **ADR-014 documenta
  UM endpoint + UM secret**. Split deliberado; ambos secrets `requiredInProd` (`env.ts:200,203`) → **sem gap de prod**.
  — **1h** (errata canon). `[xrepo]`

**Canais — perda de inbound (CONFIRMADOS pelo Security Engineer)**

- **`inbound-dedupe-strand-onboarding-loss`** `[carry]` — `metaapi/routes.ts:174` SETNX dedupe **antes** do persist;
  `:190 throw notFound` (tenant unmapped) na janela de onboarding → key strandada; meta-api retenta →
  `:178 replayed` 200 → evento **perdido**. `DEL` (`:280-282`) só cobre `message.received`. — **2-3h**.
  `[xrepo: bevox-meta-api]`
- **`null-tenant-audit-notnull-500-inbound-loss`** `[carry]` — `tenant_id` `.nullable()` (`schemas.ts:38`);
  `routes.ts:219` audit INSERT passa `organization_id=NULL` numa coluna `.notNull()` (`db/schema/audit.ts:24-25`) →
  23502 → 500 (antes do branch message.received) → key strandada → retry `replayed` → perdido. Alcançável por eventos
  account-level null-tenant (`waba.connection_changed`/`phone_number.quality_changed`, ambos assinados). — **1-2h**.
  `[xrepo: bevox-meta-api]`
- **`status-events-subscribed-but-ignored`** `[carry, ALTO-GA]` — assina 5 tipos (`server.ts:249-254`) mas
  `routes.ts:234` trata só `message.received`; `message.status_updated` (**FAILED** outbound) sem handler → falha de
  entrega assíncrona nunca reconciliada; compõe com o vocab-drop. — **4-8h**. `[xrepo]`
- **`inbound-unknown-provider-silent-drop`** `[carry]` **(v: Security)** — `message.received` com provider `"unknown"`
  (`normalize.ts:47`) ou shape inextraível falha o guard de dispatch (`routes.ts:238-242`) → persistido +
  `"accepted"` 200, mas **nunca dispatchado** E **sem skip-audit** → drop de inbound silencioso reportado como
  sucesso. Gêmeo inbound do vocab-drop. — **M**. `[xrepo: bevox-meta-api]`
- **`received-events-and-audit-written-non-transactionally`** `[carry]` **(v: Security)** — `metaapi/routes.ts:202`
  (`received_events`) e `:215` (`audit_events`) são dois `db.execute` **sem tx** → escrita parcial sob o
  null-tenant-500. — **1h**.

**LGPD / retenção / schema (Marco-3; piloto roda com PII real) — CONFIRMADOS pelos agentes LGPD + schema**

- **`received-events-raw-payload-unscoped-un-erasable`** `[carry]` **(v: CONFIRMADO — LGPD + schema)** —
  `metaapi/routes.ts:201-212` persiste o envelope Meta cru (`payload_json`: wa_id/telefone/nome/texto) em
  `received_events` (`ingestion.ts:12-30`), que tem **zero `organization_id`, zero `customer_id`, zero `deleted_at`,
  sem FK**. Nunca purgado, omitido do DSR export, un-joinável → sink de PII cru erasure-impossível. — **6-8h**.
  `[xrepo: _shared/ADR-020]`
- **`message-records-content-un-erasable-omitted-from-dsr`** `[carry]` **(v: CONFIRMADO — LGPD + schema)** —
  `message_records` (`ingestion.ts:32-56`) sem `organization_id`/`customer_id`, apesar de `content_text`(`:42`,
  egresso ao LLM) + `sender_snapshot_json`(`:47`) + `media_json`(`:48`); único FK `received_event_id ON DELETE set
  null` → não cascateia de `organizations`; keyed por `conversation_key` TEXT (sem FK) → DSR/erasure **não consegue
  achar** as rows do titular. §12.9 l.1356. — **6-8h**. `[xrepo: _shared/ADR-020]`
- **`clerk-organization-deleted-unhandled-adr020-cascade-unwired`** `[NOVO]` **(v: LGPD — N1)** — `auth/routes.ts:
  165-190` trata só `user.*`; sem `organization.deleted` → o trigger 2 da ADR-020 (término-de-contrato → cascade) está
  **não-wired**; e mesmo um delete manual da row org **não** purgaria `received_events`/`message_records` (sem org FK)
  → PII órfã sobrevive à única cascade que existe. — **fold ADR-020**. `[xrepo: _shared/ADR-020]`
- **`dsr-deletion-absent`** `[carry, contagem corrigida]` — único `app.delete` de recurso em `src/` é
  `services/routes.ts:50` **e** `professionals/routes.ts:53` (**2**, não 1 — correção; nenhum é de titular); sem
  delete de customer; `deleted_at`/`archived_at`/`consent_granted_at` são **colunas triplo-mortas** (zero writers —
  N2). **Nuance:** DSR **export** EXISTE (`customers/routes.ts:97`) — só a **deleção** falta. — **8-12h**.
  `[xrepo: _shared/ADR-020]`
- **`dsr-export-incomplete-omits-subject-data`** `[carry]` **(v: CONFIRMADO — LGPD)** — `CustomerExport`
  (`customers/service.ts:77-110`) retorna 9 cols; omite `preferences_json`/`risk_flags_json`/`consent_granted_at` +
  `messages`/`audit_events` hardcoded `[]` (`:107-108`) + **`customer_channels` inteiro** (`customers.ts:70-72`). (De-risk:
  `risk_flags_json`/`preferences_json` têm zero writers → provavelmente vazios no piloto.) — **6-10h**.
- **`retention-worker-adr020-absent`** `[carry]` **(v: CONFIRMADO — grep global = ZERO)** — `queue/index.ts` 11
  workers, nenhum purga/pseudonimiza; sem `bevox.retention.worker`; sem `message_archive` (PRD §12.9:1357 →
  estruturalmente impossível — N3); `auth/repository.ts:99` **admite** em comentário "Hard-delete worker (canon
  ADR-020, ainda não landed)". — **24-40h**. `[xrepo: _shared/ADR-020]`
- **`execution-traces-pii-retained-omitted-from-dsr`** `[carry]` — `harness-callbacks.repository.ts:196-204` grava
  `input_json`/`output_json` crus; tem `org+execution_id` mas **sem `customer_id`**, sem retenção, omitido do DSR. —
  **4h**.
- **`google-calendar-intl-transfer-customer-name-no-basis-gate`** `[carry]` — `sync.ts:203,237` empurra
  `summary="${service} — ${full_name}"` (NOME) p/ Google US via `createGoogleEvent:245` sem gate de consent/ai_opt_out.
  — **2-3h**. `[xrepo: _shared/ADR-019]`
- **`payments-raw-payload-json-pii-residue`** `[carry]` — `payments/repository.ts:422-439 insertPayment` guarda o
  evento Stripe cru `raw_payload_json` (billing_details nome/email/phone); `payments` sem `customer_id` (fracamente
  joinável via `charge_id→charges.customer_id`), omitido do DSR. (Retenção fiscal 10yr é ADR-019 item 8 — o problema é
  over-collection do blob cru vs minimização.) — **3h**.
- **`customer-pii-mutations-unaudited`** `[carry]` — `customers/service.ts:29-62` escreve **zero** `audit_events`
  (só TODOs `:85-86`); os outros 14 módulos auditam. Create/patch PII + toggle `ai_opt_out` sem trilha (art.37 RoPA).
  — **3h**.
- **`denormalized-customer-contact-snapshot-defeats-erasure`** `[carry]` — `appointments` (`calendar.ts:128-130`) e
  `waitlist_entries` (`:194-196`) guardam `customer_name/phone/email` denormalizados com `onDelete:"set null"` → hard-
  delete deixa snapshot de PII órfão; cross-border ao Google. — **fold ADR-020**.

**Schema (índices/materialização; GA-scaling — CONFIRMADOS pelo agente schema)**

- **`section-11-3-critical-indexes-partially-absent`** `[carry]` **(v: CONFIRMADO — canon l.1270-1276)** — ausentes
  `(org,status)` em appointments/charges/executions; `(org,start_at)`+`(org,customer_id)` em appointments;
  `(org,customer_id)` em charges/conversations. Presentes (corretos): `(org,status)`+`(org,last_message_at)` em
  conversations; unique customer_channels; `(org,provider_charge_id)` charges; partial customer_facts;
  customer_packages `(org,customer_id,status)`. — **2h**.
- **`fk-columns-without-index-systemic`** `[carry, EXPANDIDO]` **(v: CONFIRMADO + ampliado)** — org_id FK sem índice em
  customers/professionals(+user)/services/calendars/users/executions(+conversation+buffer_window)/professional_schedules/
  overrides/waitlist_entries/waitlist_match_outbox/buffer_windows/google.ts/stripe_webhook_events;
  `payments.charge_id`+`refunds.charge_id`; `customer_channels.customer_id`; 5 child-FKs de `charges`. **NOVO (v:
  schema, não-enumerado antes):** `audit_events.execution_id`, `staff_impersonations.{staff_id,approved_by}`,
  `staff_refresh_tokens.staff_id`, `staff_manual_actions.{org_id,buffer_window_id}`, `service_packages.{org_id,
  service_id}`, `payment_accounts.professional_id`, `customer_packages.service_package_id`, `customer_facts.
  {source_execution_id,superseded_by}`. Viola `backend-db.md`. — **3-4h** (uma migration). `[a/schema]`
- **`conversations-child-fks-unindexed`** `[carry]` — `conversations.ts:28,31,34` sem índice → cascade-delete
  full-scan. — **S (fold na migration)**.
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized`** `[carry]` **(v: CONFIRMADO)** —
  backend/ADR-020 (message_templates + enums, aceita 2026-05-21) e backend/ADR-021 (priority-score, aceita 2026-05-21)
  **não materializadas** (grep `message_template`/`urgency_level`/`skip_count`=0). backend/ADR-022 policy-json
  **materializada** (`catalog.ts:110-113`); backend/ADR-023 manual-payment materializada (0016). **Doc-stale:** a prosa
  de ADR-020 reservou "Migration 0016", mas 0016 é ADR-023. — ADR-020 **8h**; ADR-021 **6-10h**. `[a; Marco-2/3]`

**Autonomia / rate-limit / onboarding (harness inerte no piloto) — CONFIRMADOS pelos agentes**

- **`ratelimit-infra-dead-app-wide`** `[carry]` **(v: CONFIRMADO)** — plugin **Lua custom** (`rate-limit.ts`),
  **não** `@fastify/rate-limit` (`package.json:37`, **importado em lugar nenhum — dep morta**); `requireRateLimit`
  aplicado a **zero** rotas; webhooks públicos + login staff destravados; §12.6 l.1327. — **2-3h** (wire). GA, não
  pilot.
- **`autonomy-patch-nontransactional-mode-audit`** `[carry]` — a desculpa do código ("no tx helper exists",
  `autonomy/repository.ts:66-67`) é **FALSA** (`.transaction(` em 7 sites); UPDATE (`:87`) + audit INSERT (`:111`) só
  guardados por `if(modeChanging)`, não tx → mudança de modo sem AuditEvent se o INSERT falha. — **1h**.
- **`onboarding-advance-no-prereq-arbitrary-stage`** `[carry]` — `organizations/repository.ts:151-165 SET
  onboarding_stage` cru; `schemas.ts:37-49` aceita qualquer dos 11; `routes.ts:70-78` sem prereq/role/audit; §8.5
  l.905-911 exige validação+readiness+AuditEvent; `ai_mode` não flipa; `getOnboarding` não retorna checklist. — **4h**.
- **`autonomy-action-granularity-and-readiness-score-dead`** `[carry]` — `resolver.ts:62` gateia só `current_mode`;
  `PolicyEvaluator`/`fetchOrgAutonomyPolicies` (`seams.ts:64,115`) com **zero** callers de produção; `readiness_score`
  nunca computado (`autonomy.ts:33` NULL) → `GET /autonomy` sempre `readiness_score:null`. — **6h+**.

### BAIXO (higiene)

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recontagem: 103/89/106/80/95/0/0/11)**

- **`openapi-drift-undocumented-handlers`** `[carry]` **(v: CONFIRMADO — route-reviewer, 11/11)** — GET /customers/
  {id}/export; GET/PATCH /autonomy; GET /channel-connections; GET/PATCH /payment-account/policy; GET /api/v1/realtime;
  POST /webhooks/stripe; /stripe/platform; POST /webhooks/google; GET /webhooks/google/callback. 7 dos 11 estão DENTRO
  de `routes.ts` mas hand-omitidos. — **2-3h**. **#9.**
- **`no-mechanical-route-zod-openapi-binding`** `[carry]` **(v: route-reviewer — root-cause)** — ZERO rotas usam a
  opção `schema:` do Fastify; sem `ZodTypeProvider`/`serializerCompiler`; validação é `.parse()` inline, responses
  hand-built, OpenAPI 100% YAML estático; `openapi:types` só gera TS **a partir do** YAML → **sem binding mecânico**
  route↔Zod↔OpenAPI → razão estrutural de todo drift de categoria b. Fix = `fastify-type-provider-zod` OU gerar YAML
  das rotas em CI (requer ADR). — **M-ALTO**.
- **`handlers-outside-routes.ts`** `[carry]` — 4 handlers vivos fora de `*routes.ts`: `payments/webhook.ts:31`,
  `webhook-platform.ts:32`, `calendar/google/webhook.ts:48,80` → viola CLAUDE.md §5 (coincidem com 4 dos 11 undoc). —
  **S/M**.
- **`openapi-missing-operationid`** `[carry]` — `operationId`=**0** em 95 ops → codegen degradado. — **1-2h**.
- **`openapi-status-callback-missing-dead-letter` + `openapi-enum-create-refund-missing`** `[carry]` — enum status
  `[running,paused,cancelled]` sem `dead_letter` (`yaml:298` vs Zod `harness-callbacks.schema.ts:16`, branch vivo
  `routes.ts:75`); `ExecutionProposal.action` omite `create-refund` (`yaml:318-328` vs Zod `schema.ts:35`, executado
  `complete-service.ts:25`+`executions/seams.ts:172`). — **0,25h/ea**.
- **`status-callback-response-shape-drift` + `sse-documentation-asymmetry`** `[NOVO, inertes]` **(v: route-reviewer)** —
  no `dead_letter` o handler retorna `{ok,outcome}` (`routes.ts:78`) mas o YAML 200 modela só `{ok}` (`yaml:1843`); e
  a SSE de staff É documentada (`yaml:924`) mas a de cliente (`/api/v1/realtime`) é uma das 11 undoc — e ambas são
  header-only-Bearer (EventSource-hostis). — 0,25h/ea.
- **`checkout-vs-payment_link-Zod-DB-divergence`** `[carry, INERTE]` **(v: route-reviewer)** —
  `charge-intent.ts:87 ["pix","checkout"]` vs `yaml:2602 [pix]` vs DB CHECK (lista `payment_link` que nenhum Zod
  aceita); `checkout` → 501-stub (`checkout.ts:50`) → **latente/inerte** (não alcança DB); landmine 23514 se Checkout
  for wired sem migration. — **S**.
- **`error-envelope-dual-schema` / `rate-limit-429-undocumented` / `sse-realtime-header-auth-contract`** `[carry]` —
  YAML define `Error`(sem request_id, `yaml:104`) E `ErrorEnvelope`(com, `:120`); os 5 4xx `$ref`-am o `Error` enquanto
  o handler emite `request_id` (`error-handler.ts:55`); 429 não documentado (plugin live); SSE só aceita
  `Authorization: Bearer` → `EventSource` do browser não autentica. — 0,25-2h/ea.

**Harness (resíduos BAIXO — todos INERTES no piloto)**

- **`complete-returns-409-not-410-gone`** `[carry]` — `/complete` retentado = 409 (`routes.ts:160`); PRD l.821 manda
  **410**. — **0,5h**. `[xrepo/canon]`
- **`complete-skips-redis-stream-del`** `[carry]` — PRD l.826 requer `DEL stream:{id}`; handler nunca deleta (buffer
  fica 1h TTL). — **0,5h**. `[xrepo]`
- **`complete-done-path-omits-execution-updated-sse`** `[carry]` — autonomous-done pula `execution.updated` SSE
  (`complete-service.ts:100-109`); só waiting_approval publica (`:112`). — **0,5h**. `[xrepo]`
- **`harness-ignores-dispatched-callback-base-url`** `[carry]` — backend manda `callback_base_url`
  (`harness-dispatcher.ts:94`) mas harness hardcoda `BASE_URL=config` (`bevox-callback.ts:7`). — **0,5h**. `[xrepo]`
- **`deadletter-overwrites-rejected-expired-underspecified`** `[carry]` — `markExecutionDeadLetter WHERE status NOT
  IN ('done','cancelled','dead_letter')` (`repository.ts:90`) sobrescreve `rejected`/`expired`; latente (dead_letter
  404 ponta-a-ponta). — **0,25h**. `[xrepo]`
- **`status-meta-stripped-silently`** `[carry]` — `StatusCallbackSchema` (`schema.ts:15`) sem `.passthrough()` →
  strip de `action`/`failedReason`/`attemptsMade`; moot até o 404 ser corrigido. — **0,25h**. `[xrepo]`
- **`canon-complete-strategy-enum-stale` + `proposal-action-enum-drift`** `[carry+NOVO, canon]` **(v: harness agent)** —
  backend+harness emitem `strategy:"workflow"` (`execution-handler.ts:1042`) mas o enum do canon (PRD l.1089) o omite;
  **NOVO:** backend aceita `action:"waitlist-add"` (`schema.ts:30-38`) que o canon l.1101 omite (aditivo/permissivo,
  baixo risco). — **n/a (canon)**.

**Auth / schema / obs (resíduos + misses novos — todos BAIXO/latente)**

- **`staff-session-no-logout` / `staff-login-user-enumeration-timing` / `staff-refresh-tokens-no-expiry-sweep` /
  `clerk-provisioned-role-hardcoded-operator` / `clerk-resolvelocaluser-fail-open-authz-trap` /
  `staff-access-token-no-live-revocation`** `[carry]` **(v: CONFIRMADO — RBAC)** — sem logout/revoke
  (`service.ts:99-101`); enum-timing (`service.ts:68-71` lança antes do bcrypt); refresh expirados nunca varridos
  (`repository.ts:106-116`); `upsertUserFromClerk` insere `role='operator'` e `ON CONFLICT` não atualiza
  (`repository.ts:236-240`); `resolveLocalUser` fail-open em erro de DB (`clerk-auth.ts:126-139`, trap se `requireRole`
  for wired); token de staff stateless → lag de desativação ≤900s (refresh É revogado). — S/ea.
- **`staff-refresh-no-reuse-detection`** `[NOVO]` **(v: RBAC — N3)** — rotação deleta-então-emite (`service.ts:99-101`);
  token pré-rotação roubado só 401a, sem revogação de família/alerta. By-design Marco-1. — S.
- **`clerk-webhook-unknown-type-silent-200`** `[NOVO]` **(v: RBAC)** — `routes.ts:165/186` if/else-if sem `else` →
  qualquer evento Clerk não-tratado (org lifecycle, session.*) retorna `{ok:true}` 200 silencioso. — S.
- **`uuidv7-sql-default-missing-post-0000-tables`** `[carry, count=14→13 vivos]` **(v: CONFIRMADO — schema)** —
  **14** tabelas de `0000` têm `SET DEFAULT gen_uuid_v7()` (`:307-320`; `ai_suggestions` depois DROPPED em 0005 → **13
  vivos**); as pós-0000 não (grep 0001-0020=0). Fail-closed (`_shared.ts:108-111 $defaultFn`). Pura higiene/DX. — **1h**.
- **`newopaqueid-uuidv4-dead-code` / `appointments-customer-package-id-no-db-fk` / `executions-original-execution-id-
  unindexed` / `customers-deleted-at-read-but-never-written` / `metric-cardinality-unbounded-org-label` /
  `availability-professional-id-filter-missing` / `appointment-created-by-not-persisted` / `no-availability-409-not-
  422`** `[carry]` **(v: CONFIRMADO — múltiplos)** — `staff-auth.ts:138-141 newOpaqueId()=randomUUID()` UUIDv4
  **dead-code (0 callers)**; `calendar.ts:124` sem `.references()`; `executions.ts:47` sem índice; `deleted_at` nunca
  escrito; `metrics.ts:33 organization_id` em labels (cardinalidade GA); `calendar/schemas.ts:18-23` omite
  `professional_id` (§10.1 l.967); appointments sem `created_by_type/id` (`:140` é `source`); 409 p/ no-availability
  (§8.3 l.876 quer 422). — 0,25-3h/ea.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: CONFIRMADO — orquestrador)** — tags só
  `v1.0.0`/`v1.0.1`; `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora
  (incl. dispatch amendment); `release.yml` dispara só em `v*.*.*` → **nenhuma imagem (SemVer OU sha) pós-`v1.0.1`**.
  Versão diverge **4-way**: `package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1` / hub `vX.Y.Z`. — **0,5-1h**
  (cortar tag). `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: CONFIRMADO — orquestrador)** — `src/integration/resolve-organization-id.ts`
  **NÃO existe** (bridge colapsada SP-3, confirmado em comentários `global.d.ts:8`/`clerk-auth.ts:11`/
  `organization-scope.ts:6`) mas é citado como vivo em README:84, `backend-tenancy.md:28`, `backend-routes.md:34`,
  `PostToolUse-tenancy.sh:11`, `engineering-backend-architect.md:243`; `CLAUDE.md §8` (l.171) diz seed grava
  `PILOTSEEDONLYNOTASECRET` (real gera base32 + blocklist `mfa.ts:35`); `backend-tests.md` cita "5 falhas FK #36"
  (suíte passa 92/93, harness-contract(12)✓); `backend-harness-contract.md`/`backend-workers.md` dizem `dead_letter`
  via `worker.on('failed')` do backend (**errado** — é via PATCH, e o worker só loga); `backend-db.md` diz `on delete
  restrict` (código+canon = **cascade**, §11.2 l.1203). — 0,3-0,5h/ea.
- **`rule-backend-routes-staff-role-and-adr-miscite`** `[carry]` **(v: CONFIRMADO — RBAC)** — `.claude/rules/
  backend-routes.md` declara staff roles `bevox_admin | support | observer (canon: ADR-022 staff RBAC)`: triple-errado
  (nomes curtos; staff RBAC = **backend/ADR-013**; invoca o inexistente `requireRole`). — **0,25h**.
- **`stray-gap-workflow-js-scratch-accumulation`** `[carry]` **(v: CONFIRMADO)** — 5 `.claude/state/gap*.js` (jul,
  gitignored — `git check-ignore` confirma) → **zero impacto em CI**; só fazem `pnpm lint` **local** dar RED (5
  erros). Esta sessão NÃO adicionou nenhum (newest mtime = jul 17). — **0,1h** (`rm`).
- **`codeql-upload-never-noop` / `release-no-provenance-sbom` / `adr-number-collision-cross-namespace`** `[carry]` —
  `codeql.yml:26 upload:never` (resultados nunca sobem p/ a aba Security); `release.yml` sem provenance/sbom/cosign;
  ADR 008-023 colidem backend/_shared. — 0,2-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária)

- **`legacy-lexicon-clean`** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/`db/`: executável
  **ZERO**. Bare `workspace_id`/`workspaces` = 3 doc-comment do rename; residual `account_id` = composites sancionados
  (`external_/payment_/channel_account_id`) + doc-comments + alias financeiro `AS account_id` (`payments/repository.ts:
  1012,1018`) + snapshots drizzle/tipo gerado. Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153` `generateMfaSecret()` base32 + `assertMfaSecretNot
  Placeholder()`; `mfa.ts:34-42` blocklist inclui `pilotseedonlynotasecret`; `auth/service.ts:84-88` sem MFA check
  (correto — TOTP é Marco-3 ADR-013 l.106). **NÃO implementar "rejeitar sentinel no login".** CLAUDE.md §8 stale (doc).
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:93-94`). Coexiste com o
  token-IDOR (autenticidade ≠ autorização).
- **`idempotency-on-callbacks-REFUTED`** — backend **não** persiste `Idempotency-Key`; é máquina-de-estado
  (`lockForCompletion`→409). Harness **manda** mas o backend ignora.
- **`dispatch-amendment-faithful-to-canon`** — `deadline_ms`/`original_execution_id`/`dead_letter`
  (`harness-dispatch.schema.ts:58,62`) byte-faithful ao canon PRD §10.4 Am1. Não é fork.
- **`hmac-verification-correct`** — `metaapi/service.ts:48-55` casa o signer do meta-api; Stripe `constructEvent`,
  Clerk svix, Google HMAC timing-safe todos corretos.
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc`=0); decimal `numeric(10,2)`; webhooks
  dedupe-aware (`repository.ts:250-262`); over-refund replay-safe (REST + manual); cross-tenant paid-flip impossível
  (`webhook-platform.ts:67-72` org-scoped + `markChargePaid` guardado); ambos webhook-secrets `requiredInProd`.
- **`money-mutation-http-idempotency-not-needed`** — a ausência de `requireIdempotency` em mark-paid/expire/connect-
  manual é neutralizada pela idempotência interna (`provider_payment_id=manual:<chargeId>` + ON CONFLICT + transições
  guardadas; documentado `routes.ts:55-58`). By-design.
- **`channel-phone-always-null-provider-join` — REFUTED** **(v: Security + orquestrador)** — `intake.ts:48,63,84`
  grava `channel_connections.provider` E `customer_channels.provider` com o **mesmo** `"wa"`/`"ig"` → o join
  `ch.provider=cc.provider` (`metaapi/repository.ts:188`) casa; o único null é `ctx.provider` via a coerção `:197` =
  **já é o vocab-mismatch (#8)**, não defeito independente. **Era um "NOVO" do 10-21 → colapsa em #8.**
- **`booking-main-path-exactly-once-sound`** — advisory xact-lock + recount in-lock + unique index + replay 23505
  (`booking.ts:225-263`); POST honra `Idempotency-Key` (`routes.ts:88`).
- **`authz-miss-hunt-clean`** — toda rota mutante é protegida; os 5 webhooks verificam assinatura antes de agir;
  staff-ops read sem org-scope é by-design (staff lê qualquer org).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer` (ADR-013 l.108); `requireStaff({roles})`→403; observer split correto; `TEST_AUTH_BYPASS`
  double-guarded; secrets staff DB-direct (nunca Redis).
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` é **canon-correto** (§11.2 l.1203; `backend-db.
  md` "restrict" stale); timestamptz everywhere; CHECK (`end_at>start_at`, `sessions_remaining>=0`, `confidence∈[0,1]`);
  `ai_suggestions` dropada em 0005; sessions numeric→integer em 0015. `agent_configs`/`organization_meta_api_tenant`
  têm `organization_id` como **PK** → indexados (fora do gap FK-index).
- **`secrets-and-pii-redaction`** — Google OAuth tokens encrypted-at-rest; `redactors.ts` redige tokens/secrets;
  Sentry sem PII (`instrument.ts:13 sendDefaultPii=false`); `redaction-paths-miss` é **latente** (os 51 sinks de log
  não referenciam colunas de PII).
- **`todo-fixme-debt-sweep-marco23-only`** — sweep `src/`+`db/`: **0** FIXME/HACK/XXX; **1** `@deprecated`
  (`orchestration/repository.ts:348`); **11** TODOs reais todos Marco-2/3.
- **`org-scoped-cascade-works`** — customers/customer_facts/customer_channels/conversations/execution_traces/charges/
  payments todos `ON DELETE cascade` de organizations → erasure org-level funciona estruturalmente; o gap é (a) sem
  targeting por-titular e (b) `received_events`/`message_records` fora de toda cascade.
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (`delivery-tracker.yml:781`, origin/main): 10
  delivered (aisuggestion, staff-rbac, m4-chatwoot-p1..4, m5-p4-manual-payment, m5-p3c-multimedia-consume,
  m5-p3a-refundpolicy, m5-p3b-create-refund) + `backend-psp-br-secondary` parked (Marco 6). **Nenhum work-item** p/
  calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é
  **invisível ao tracker**; 1 item (multimedia) auto-declara "5 LGPD prod gates pending (not ready-for-prod)".

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do
piloto + 1 dos 2 jobs de CI vermelhos**.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) **+ `closeDb()/closeRedis()` no `afterAll`** | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado não autentica no calendar (gate upstream dos CRÍTICOs) |
| 4 | **`pnpm audit`: bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**49 highs**, core do Fastify) e re-acende o scanner agendado (dark desde ~out) — completa "CI verde" |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e | **3-4h** | **Alcançável NO piloto via staff-approve**: faz a resposta chegar ao cliente (hoje dropada em silêncio como `done`) |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + subir `/metrics` no worker | **1-2h** | Fecha o buraco-negro (Sentry/OTel/Prometheus) de TODA a metade assíncrona que o piloto roda |
| 7 | **Gatear `insertPayment`+side-effects no rows-affected de `markChargePaid`** | **2-3h** | Fecha o bug HIGH de dinheiro **agora irreversível** alcançável no money-path manual (re-mark órfão) |
| 8 | **`.min(32)` no `STAFF_JWT_SECRET`** (+ chave separada p/ Google OAuth state) + `requireRateLimit` no `/staff/sessions[/refresh]` | **~3,5h** | Fecha o buraco de auth mais duro (admin forjável, piso de entropia em 2 planos) + brute-force do admin semeado |
| 9 | **Vincular token de callback ao `:id`** (`executionContext.execution_id === id` → 403) + **remover `updated_at=now()` do reconcile de refund** (`reconcile.ts:257`) | **1,25h** | Fecha o IDOR cross-execution + destrava o reconcile de refund (42703 DOA) — ambos ALTO-GA |
| 10 | **Aplicar gate `ai_opt_out`/consent em `cutoff.ts`/dispatch + Google sync** + hidratar DSR export (incl. `customer_channels`) | **6-10h** | LGPD (piloto roda com PII real; hoje o flag é ignorado + PII cru não-apagável) |
| — | Higiene batch: `GET /appointments`; versão/tag SemVer (22 commits); reconcile-cron `applyChargePaid/Refunded`; audit de appointment (§12.8); harness `status`-method POST→PATCH (cross-repo); docs stale (§8/bridge/rule dead_letter/db-restrict/ADR-022); `rm .claude/state/gap*.js`; `operationId`+enums OpenAPI; índices FK (uma migration ampliada) | **~14h** | "Ver agenda" + governança + drift de contrato + perf GA + LGPD-audit |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status`-callback POST vs PATCH 404 total** (não só
  dead_letter; backend canon-correto; fix harness→PATCH + errata canon l.447) → nenhum status transita via harness;
  `aborted_*`→400 (bug harness), `strategy='failed'`→não-`error` (bug backend), skills-allowlist vazio, `trace content`
  descartado, `callback_base_url` ignorado, token-IDOR, `active_execution_id`-wedge. Mitigante: harness **inerte** no
  piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` no fio
  (`messages/schemas.ts:7`) confirma que `wa`/`ig` do backend causa o drop de outbound; retries de webhook amplificam
  a perda de inbound (dedupe-strand + null-tenant-500 + unknown-provider-silent-drop).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um
  principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona.
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`) vs ADR-014
  (um); refund manual não passa por webhook; o reconcile de refund Stripe está **DOA (42703)** e **CI-invisível**.
  Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer auth interativa — indisponível nesta sessão
  headless** (reportado; não bloqueante para auditoria de código).
- **canon** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score) não-implementadas; _shared/ADR-019
  (bases legais → gate consent é código local), _shared/ADR-020 (retenção → scoping de message_records/received_events,
  retention worker, DSR deletion, `message_archive`). Drifts "canon-atrás-do-código" (webhook §10.3, `strategy=
  'workflow'`, `/status` POST↔PATCH l.447, `create-refund`, `dead_letter` no enum, `waitlist-add`) → errata/ADR
  superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1` (sem os 22
  commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem principal Clerk).
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` (inatividade ≥60d) → gate agendado dark.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs
  são invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-21)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/
db/` **vazio**; `HEAD` = o commit do próprio audit 10-21 (ontem).

**A mudança metodológica desta passada (o valor incremental): 2 REFUTAÇÕES/correções, vs "0 refutações de código" no
10-21.** Re-verificação adversarial de fonte-primária, confirmada pelo orquestrador, derrubou:
- **`channel-phone-always-null-provider-join` → REFUTED** (era um "NOVO" do 10-21): `intake.ts:48,63,84` grava ambas as
  colunas `provider` com o mesmo `wa`/`ig` → o join casa; colapsa em `vocab-mismatch` (#8).
- **"`createCalendar` nunca é chamado" (parentético do CRÍTICO-2) → corrigido**: existe + route-wired; o gap é "seed
  não chama", não "sem caller".
- Correções menores: DSR = **2** rotas DELETE (não 1); `agent_configs`/`organization_meta_api_tenant` são **PK-indexed**
  (fora do FK-index gap); enums Zod do `/complete` em `harness-callbacks.schema.ts` (não `executions/schemas.ts`).

**Ground-truth (mensurável):**
- **`ci-security` PLATEAUOU**: **109 vulns / 49 high** hoje vs **106 / 49 high** no 10-21 (**+3 total, +0 high**; os
  **mesmos 19 módulos**). A explosão 18→49 foi pré-10-21; nesta janela de 24h a dívida ficou **estável**. Tendência
  **12→15→18→49→49**.
- **`ci-tests`**: RED idêntico (mesmo flaky `booking_notice:259` rodado ~09:05 UTC + teardown 57P01, agora **×1** vs
  ×2 no 10-21).
- **NOVO `ci-scheduled-runs-dark-on-github`**: os runs agendados (Security/CodeQL) em `main` estão em `startup_failure`
  (0s) desde ~05-out — não executam (provável auto-disable ≥60d de inatividade). As 9 passadas anteriores só rodaram CI
  localmente; nenhuma viu isso.

**~15 misses/sharpenings NOVOS (todos verificados de fonte-primária):**
1. `manual-remark orphan` é **irreversível** (`service.ts:499` bloqueia refund de não-`paid`) — escalação.
2. reconcile-refund 42703 DOA é **CI-invisível** (só unit mockado) — explica o miss de 7+ passes.
3. vocab-drop **cega a métrica** (`channel:"unknown"`, `executions/seams.ts:373`).
4. harness `status`-callback **POST↔PATCH 404 total** (não só dead_letter) → nenhum status transita via harness.
5. CRÍTICO-2 **ELEVADO**: `professional_schedules` sem writer em **todo o app** (não só seed).
6. FK-index gap **ampliado** (audit_events, staff_*, service_packages, payment_accounts, customer_packages,
   customer_facts).
7. `professional_services` **unseeded** → availability cai no fallback "todos bookáveis".
8. LGPD N1: Clerk `organization.deleted` **não-tratado** → cascade de término-de-contrato (ADR-020) unwired.
9. LGPD N2: `deleted_at`/`archived_at`/`consent_granted_at` = **colunas triplo-mortas** (zero writers).
10. LGPD N3: `message_archive` (§12.9:1357) **não existe** → agregação de msgs impossível.
11. LGPD N4: `sender_snapshot_json` + `media_json` = sinks de PII-cru adicionais em `message_records`.
12. RBAC: a trilha impersonation→ação está **ausente** (não só mis-hooked); + N3 `staff-refresh-no-reuse-detection` +
    `clerk-webhook-unknown-type-silent-200`.
13. métricas de domínio **declaradas-mas-nunca-emitidas** (`queueSize`, `messagesReceivedTotal`).
14. reschedule: **double-charge** em serviço pré-pago (inerte no piloto) + **metadata-drop**.
15. route: `status-callback-response-shape-drift` + `sse-documentation-asymmetry` (customer SSE undoc).

**De-escalações / nuances (além das 2 refutações):**
- **`staff-jwt-secret` N1 CHANGED**: os 2 planos (staff JWT + Google OAuth state) usam audiences distintas → **não há
  replay cross-plane**; o risco é puramente o **piso de entropia** (chave fraca forja ambos independentemente).
- (Carryovers mantidos: `money-mutation-http-idempotency` by-design; `/metrics` documentado non-gap; `charge_type-
  drift` REFUTED; `redaction-paths` latente; `pix-split` sem gap de prod; partial-refund-no-action risco V1 aceito.)

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda (CRÍTICO-2 elevado); o gate auth-actor; `outbound-provider-vocab`
(HIGH + métrica-cega); `manual-remark orphan` (HIGH irreversível); `reconcile-refund-42703`; `callback-token-IDOR`;
`rbac-org-role`; `clerk-provisioning`; os mismatches de `/complete` + o `status`-method 404; `reconcile-cron-*`; toda a
bateria LGPD; autonomia/observabilidade; priority-score/reminders/templates Marco-2/3; a staleness `.claude`/CLAUDE.md/
README; version-drift (22 commits, nenhuma imagem pós-`v1.0.1`).

**Arco desde a passada mais antiga (06-02):** os 3 CRÍTICOs originais foram fechados/recaracterizados; os 2 CRÍTICOs
atuais (grade + calendar no seed) emergiram ~06-23 e **persistem** há ~4 meses; o gate auth-actor foi isolado no 07-20
e re-confirmado 5×. **A frente de CRÍTICOs está estável e sem correção há ~4,5 meses; a única variável que piorou foi a
dívida de segurança do lockfile (agora em platô 49) e, novo nesta passada, o scanner agendado do GitHub ficou dark.**

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a
**re-verificar de fonte-primária** o inventário do 10-21 do seu domínio contra o **código atual** com evidência fresca
`file:linha`, a **REFUTAR** superestimações, e a caçar misses. **5 usaram agent-types locais** deste repo
(`.claude/agents/`): `harness-callback-auditor` (l), `backend-route-reviewer` (b), `backend-staff-rbac-reviewer` (auth),
`backend-schema-migration-engineer` (schema/índices/LGPD-shape/tracker), `Security Engineer` (payments j + channels k);
**2 general-purpose** (LGPD g; calendar/pilot/obs a+m + autonomia). Cada agente entregou lista estruturada
VERDICTS/NEW-OR-MISSED/CONFORMANCES. **Resultado agregado: ~90 itens re-confirmados, 2 refutações de código +
correções, ~15 misses NOVOS.**

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD --
src/ db/` = vazio); origin/main dos 4 repos (backend dbd231e / canon 7874971 / harness 2979eb0 / meta-api 5516c2a,
inalterados); léxico legado (grep triado = zero executável); os 2 CRÍTICOs (writer de `professional_schedules` = só
fixture `:120`, símbolo `weeklySchedule`=0; `seed-pilot.ts` = 4 inserts; `availability.ts:75/126` lido); as 2
refutações (intake.ts:48/63/84 + repository.ts:188/197 lido; `createCalendar` em repository.ts:20 + routes.ts:38); as 2
HIGH money (refunds sem `updated_at` → `payments.ts:149-172` + `reconcile.ts:255-257`; manual-remark `service.ts:
891/414-416/499`); worker telemetry (grep `instrument` em `queue/index.ts` = NONE); dead-dep `@fastify/rate-limit`
(0 imports); `newOpaqueId` callers (0); categoria f (0 FIXME/HACK, 1 @deprecated, 11 TODO); delivery-tracker slot
backend (origin/main `:781`, 10+1, lido); version-drift (`merge-base --is-ancestor dbd231e v1.0.1` = FALSE, 22 commits,
describe `v1.0.1-32`); canon spot-checks (ADR-010/013/014/018/019/020/021/023 `aceita`, ADR-016 `proposed`; §16.1 CI-verde
l.1483; §11.3 índices l.1270).

**Ground-truth de CI rodado de fato** (2026-10-22 ~09:04-09:08 UTC; logs em `/tmp/ci-2026-10-22/`): Typecheck ✓ /
Format ✓ / OpenAPI ✓ / Build ✓ / Unit ✓ (**469/469, 69 files**) = **GREEN**; `test:integration` = **RED exit 1**
(`1 failed | 92 passed (93)`, flaky `booking_notice:259` [~09:05 UTC < 13:00] + teardown 57P01 ×1); `pnpm audit
--audit-level high` = **RED exit 1, 49 high / 109 total** (19 módulos high, parse de `audit.json`); `lint` = **RED por
artefato local** (5 `.claude/state/gap*.js` gitignored → CI GREEN). **Estado GitHub (novo):** `gh run list --branch main`
→ scheduled runs em `startup_failure` (0s) desde ~05-out; check-runs históricos de `dbd231e` mostram `pnpm audit`+`OSV`
= failure semanal, CodeQL = success.

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree numa feature branch mas
**`origin/main` @ `7874971` (06-03)** — leu-se `origin/main` para PRD/ADRs/delivery-tracker. Numeração de ADR **colide**
entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner /
CodeQL não reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta
reais) não exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de
writers/endpoints + CI rodado. (4) MCP `stripe` + `claude.ai Google Drive` requerem auth interativa — **indisponíveis**
nesta sessão headless (reportado; não bloqueante). (5) Esta passada é re-verificação sobre código byte-idêntico ao do
10-21; o valor incremental é **2 refutações independentes (vs 0 no 10-21) + CI fresco (Security em platô 49) + a
descoberta do scanner agendado dark no GitHub + ~15 misses NOVOS**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-22. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
