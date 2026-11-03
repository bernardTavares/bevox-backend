# Gap Analysis — bevox-backend — 2026-10-26

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo segundo a
> documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais — `harness-callback-auditor`,
> `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`, `backend-route-reviewer`, `Security Engineer` —
> + 2 `general-purpose` para LGPD e pilot/calendar/obs), cada um re-verificando **de fonte primária** o inventário do
> 10-25 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** superestimações (com a
> lista explícita de refutados/de-escalados a NÃO re-flagar) + caçar misses; **verificação independente de
> fonte-primária pelo orquestrador** dos ~15 achados-âncora; e **CI rodado de fato** (2026-10-26 ~09:00–09:20 UTC, não
> inferido; logs em `/tmp/*.log` desta sessão). Sucede `runtime-gap-audit-2026-10-25.md`.

## Resumo executivo

**14ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,8
meses — e nesta passada nada mudou em lugar nenhum.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é
**vazio** (produto byte-idêntico a `dbd231e`, 2026-06-03; `git describe` = `v1.0.1-36-ge24449b`, o `-36` são commits de
audit docs-only — era `-35` no 10-25). Canon `bevox-knowledge origin/main` @ `7874971` (06-03), `bevox-harness
origin/main` @ `2979eb0` (06-03), `bevox-meta-api origin/main` @ `5516c2a` (06-22), hub `bevox-PRD-consolidation
origin/master` @ `fd1373b` — **todos inalterados vs 10-25**. (Dois working-trees vizinhos moveram para **branches
locais** — meta-api `721edb8`, harness `1dfb27b` branch de teste — mas o **contrato publicado `origin/main` não
mudou** e o enum `whatsapp`/`instagram` do meta-api segue intacto; ruído de branch, não mudança de contrato.) Os 7
auditores + o orquestrador **confirmaram o inventário do 10-25** (~74 itens re-verificados) com **ZERO refutações de
código** (5ª passada consecutiva: 10-22..10-26), **~14 misses/sharpenings NOVOS** (todos latentes / by-design-adjacent /
governança — nenhum piloto-bloqueador novo), e várias correções de linha/severidade.

**Principais riscos (inalterados):** o piloto **morre no passo 2 ("ver agenda")** — não é executável como semeado.
Dois CRÍTICOs de agenda persistem há ~4 meses (grade semanal sem escritor app-wide + seed sem Calendar), atrás de um
gate de **auth-actor** (seed cunha JWT staff HS256; todo calendar exige Clerk RS256 → 401). O money-path manual
**funciona** (ADR-023 aceita) mas não é hands-off-seedável e carrega 1 bug HIGH **irreversível** (re-mark órfão). E o
único bloqueador **mensurável** de Marco-1 pelo canon (PRD §16.1 l.1483 "CI verde") segue **RED** em 2 dos 3 jobs.

**Manchete-delta — 2ª passada consecutiva com delta mensurável ~zero nos três sinais de CI**, agora com 1 micro-regressão
de governança:
- **Security:** `pnpm audit --audit-level high` = **RED, 115 vulns / 10 low · 55 moderate · 50 high · 0 critical** →
  **byte-idêntico ao 10-25 e ao 10-24** (3ª passada no platô). Mesmo conjunto de **19 módulos-high**, `zod@4.4.3`
  permanece (direct-prod, GHSA memória-exaustão `<4.6.6`). Tendência **12→15→18→49³→50→50→50**.
- **Tests:** `pnpm test:integration` = **RED exit 1**, `1 failed | 92 passed (93)` — o mesmo flaky dependente de
  hora-do-dia `calendar-booking.test.ts:259` (rodei 06:04 BRT < gate ~13:00 UTC → `booked`), **com 2× teardown `57P01`**
  (vs 4× no 10-25 — ruído de teardown recuou). Fast-gate **GREEN** (Typecheck/Format/Build+alias-gate/OpenAPI-parse/Unit
  **469/469, 69 files**).
- **scheduled CI:** **dark inalterado** (startup_failure ininterrupto 09-22→10-20) **E possível aprofundamento**: o slot
  seg-cron `0 6 * * 1` de **hoje (10-26) às 06:00 UTC não produziu run algum** até 09:04 UTC (nem startup_failure). ~5
  semanas sem scanner agendado real (último Security que executou: 09-21; CodeQL: 09-15).

**O achado NOVO mais consequente desta passada** é um bug de contrato real no plano de auth que o piloto **de fato usa**
(painel staff-ops): `issueSession` devolve `expires_in` = o TTL de **refresh** (604800s/7d) enquanto o access token
expira em **900s/15min** (`auth/service.ts:60` vs `staff-auth.ts:74`) → um cliente que agenda refresh por `expires_in`
trata um token de 15min como válido ~672× tempo demais → 401 silenciosos. MÉDIO.

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária esta sessão:

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`) — **não** `/complete,/artifact,/tool-result,/turn`
   como o brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (`30_adr/bevox-backend/ADR-019-execucao-e-a-sugestao-
   colapso-aisuggestion.md`, **aceita**), **não "channels"** como o brief diz. **Channels = _shared/ADR-011.**
   backend/ADR-018 = refund/cancellation (**aceita**). O range "0011 a 0018 Marco-1" do brief é aproximado; as ADRs
   aceitas **vinculantes** vão até 0023 (010/013/014/018/019/020/021/022/023 = `aceita`; 016 token-billing = `proposed`
   → corretamente NÃO implementado; 011 = `Superseded by ADR-019`). Lido de `origin/main`.
3. O grep `account_id\b` do brief captura centenas de ocorrências em `src/`/`db/`, **todas sancionadas**: composites
   `external_account_id`/`payment_account_id`/`channel_account_id`, o alias financeiro `AS account_id`, a propriedade
   Stripe `res.accountId` (semântica financeira reservada por ADR-021/019), doc-comments do rename, e snapshots
   drizzle/tipo gerado. O léxico proibido **executável** é **ZERO**; os 3 hits "crus" de `workspace_id`/`workspaces` são
   **doc-comments** explicando o rename (`autonomy/routes.ts:5`, `organizations/routes.ts:3`, `autonomy.ts:3`).
   Invariante §4.1 mantida — **não-gap**. Ver categoria c.
4. **MFA sentinel (categoria d) — não há bug a corrigir.** `CLAUDE.md §8 l.171` afirma que o seed grava `mfa_secret =
   PILOTSEEDONLYNOTASECRET` — **factualmente stale**: o seed hoje chama `generateMfaSecret()` (base32 160-bit,
   `scripts/seed-pilot.ts:153`) + `assertMfaSecretNotPlaceholder()` (`:154`), que **rejeitaria** o sentinel literal; o
   sentinel só aparece como **comentário** (`src/shared/mfa.ts:66`) e o literal lowercase está no blocklist (`mfa.ts:35`).
   Login staff sem MFA é **correto** (TOTP é Marco-3, PRD §16.3/ADR-013; `auth/service.ts:84-87`). **NÃO implementar
   "rejeitar o sentinel antes do JWT"** (travaria todo login de staff semeado) — e é moot, pois o seed não grava mais o
   sentinel. Fix = **0h** de código; o único resíduo é corrigir a prosa de `CLAUDE.md §8` (vai pro doc, não é bug).
5. Código congelado desde **06-03** (`dbd231e`), não 06-04. Numeração de ADR **colide** entre `backend/` e `_shared/`
   (008–023) — sempre qualificada abaixo.
6. **RBAC de staff é canon backend/ADR-013** (roles `bevox_admin|bevox_support|bevox_observer`), **não ADR-022**
   (backend/ADR-022 = `policy-json-sub-keys`, confirmado no canon). A rule local `.claude/rules/backend-routes.md:24,33`
   mis-cita "ADR-022 staff RBAC" + invoca o inexistente `requireRole` — ver BAIXO/governança.
7. O `status`-callback **não é** drift de OpenAPI: é **PATCH** no YAML **e** no handler (`routes.ts:56`) — concordam. A
   quebra POST-vs-PATCH é **cross-repo** (harness POSTa) — categoria l, não b.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1481-1483)** inclui literalmente `- [ ] Repositório bevox-backend criado;
  CI verde.` (lido verbatim de `origin/main`) ⇒ o único bloqueador **mensurável** de Marco-1 é **CI-verde** (RED em
  Tests + Security). Também: migrations pg16; módulos auth/organizations/users/professionals/services/customers; OpenAPI
  publicado; contrato harness testado com stub; deploy staging.
- **§16.2 Marco-2** (calendar, conversations, messages, channels, ai-pipeline, autonomia; Fluxos 1/2/3 e2e; token
  accounting; idempotência tools; métricas Prometheus; cobertura ≥70%). **§16.3 Marco-3** (payments Stripe Connect,
  reminders, faq, rules, audit, observability completa; WhatsApp direto; **LGPD DSR/retenção/consentimento**; **MFA
  TOTP**; backup/restore; rate-limit distribuído; SLO).
- **Status de ADR (origin/main):** backend/ADR-009/010/013/014/015/017/018/019/020/021/022/023 = **`aceita`**; backend/
  ADR-016 (token-billing) = **`proposed`**; backend/ADR-011 = **`Superseded by ADR-019`**. _shared/ADR-019 (bases legais
  LGPD) + _shared/ADR-020 (retenção) = **aceitas 2026-04-23**.
- **Fato estrutural:** o código entrega muito além de Marco-1 — o README "Marco 1 bootstrap" **subdeclara** o que existe.
  O piloto exercita calendar + payments-manual (ADR-023 aceita) + o worker assíncrono independentemente do rótulo → os 2
  CRÍTICOs são **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-26) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO app-wide; sem módulo onboarding apesar do enum `schedule`); `StatusHistory` ausente (Módulo 16); `appointments.created_by_*` **colunas inexistentes** (§8.3); templates ADR-020 + priority-score ADR-021 **Opção C vinculante** não-materializadas |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recount reproduzido **EXATO** pelo route-reviewer: `103 call-sites [=99 routes + 4 webhook-files] / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 / 11 undoc`; bijeção 106−11=95 verificada **ao nível de operação**; 11-undoc = **4-isentos / 7-drift-real**; `mark-no-show` segue **REFUTED**; **NOVO** `checkout-501-undocumented` |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO** (sancionados; 3 "crus" = doc-comments) |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | seed gera base32 160-bit + `assertMfaSecretNotPlaceholder` + blocklist; sentinel só comentário; login sem MFA = correto (Marco-3); **`CLAUDE.md §8 l.171` stale**; fix de código = 0h |
| e | Testes faltando (hot paths) | ✅ | webhook Stripe (`constructEvent`=0 em test/) / reconcile-cron (só unit mockado → 42703 CI-invisível) / availability-rota / inbound-vocab / `GET /appointments` — zero e2e; integração manual-money verde (histórico 19/19) |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); **7** TODO (todos Marco-2/3) |
| g | LGPD | ✅ | consent/`ai_opt_out` arquiteturalmente inaplicável (dispatch conversation-keyed); ingestão PII pré-aviso; **5 cópias** de PII inbound cruas; `message-content-untargetable`; DSR-export inacessível no piloto (RS256) + não-auditado; retention worker ausente; **NOVO** `staff_manual_actions` PII-sink + `audit_events` sem `customer_id` |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main, verbatim); **nenhum** work-item p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker** |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky + **2× 57P01**) + Security RED **50 high / 115** (**platô 3ª passada byte-idêntico**); fast-gate GREEN (469/469); lint-RED = artefato local gitignored (5 `gap*.js`, **0 adicionados**); scheduled dark **09-22→10-20** + slot 10-26 ausente |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + irreversível** (+ **NOVO sharpen**: `expireChargeManually` lock-free → orphan desde `pending`); `reconcile-refund-42703` cron-only Stripe-latente; `intent-reconcile half-applies`; overflow `numeric(10,2)`; PCI-nil (grep=0) |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH pilot-universal** + métrica-cega; `pre-HMAC DB amplification` (DoS); audit-dup em retry; null-tenant one-time-500 + dedupe-poison → perda permanente; unknown-provider-silent-drop; HMAC correto |
| l | Harness dispatch | ✅ | `status`-callback **POST↔PATCH 404 total** (root-cause único; byte-verificado nos 2 repos); token-IDOR status-agnóstico; `message_id`-poison **fire-first** (MASCARA unbounded + `active_execution_id`-wedge); skills-allowlist vazio; `/complete` tenant não-verificado; **NOVO** orphan-pending-rows + callback-base-url-dead |
| m | Alçapões do piloto | ✅ (traçado) | **NÃO-executável como semeado**: 1ª falha = auth-actor 401; atrás, calendar-404 + grade-vazia app-wide + **sem GET de agenda**; money-path manual OK (reachability Clerk-user); worker-telemetry buraco-negro; `cancelled→confirmed` over-book + **NOVO** `completed→cancelled` não-restaura pacote |
| n | Delta vs audit anterior | ✅ | 10-25 re-verificado; **0 refutações de código** (5ª passada); Security/Tests **delta-zero**; scheduled dark + slot ausente; ~14 misses NOVOS (todos latentes) |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN (staff) — PASSA mecanicamente, classe de token errada.** `seed-pilot` cria org + `bevox_admin`; `loginStaff`
   (`auth/service.ts:63-90`) é password-only (MFA seam presente não-enforced `:84-87`); cunha JWT staff **HS256**
   (`staff-auth.ts:70`). Só serve a rotas `requireStaff`. **Sem rate-limit/lockout** (`auth/routes.ts:90` sem preHandler;
   `requireRateLimit` tem 0 callers).
2. **VER AGENDA — QUEBRA na AUTH primeiro (401).** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`calendar/routes.ts:22,48`; `clerk-auth.ts:89-108`) + claim `organization_id` → token staff HS256 → **401**. Seed não
   cria principal Clerk nem row `users`. *Se JWT Clerk à mão:* → `availability.ts:75 notFound("Calendar")` (**CRÍTICO 2**).
   *Se Calendar à mão:* → grade vazia app-wide (**CRÍTICO 1**). **E não há `GET /appointments` em plano nenhum** (Clerk,
   staff-ops **nem** OpenAPI; `grep app.get(...appointment)` = 0) → "ver agenda" não tem endpoint.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100% (grade vazia). **Main-path exactly-once É
   SÃO** (advisory xact-lock + recount in-lock + unique index + replay 23505; POST honra `Idempotency-Key`). Reschedule/
   transition têm 8 defeitos de correção (incl. `cancelled→confirmed` resurrection over-book + NOVO `completed→cancelled`
   não-restaura pacote); create/reschedule/transition não gravam `audit_events` e não persistem actor.
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** Serviço semeado sem `requiresPrepayment` →
   default `false` (`catalog.ts:67`) **e** `seed-pilot` não cria `payment_accounts` → precisa de `POST /payment-account/
   connect-manual` à mão (mesmo gate Clerk). **1 bug HIGH irreversível** re-mark de charge terminal; overflow 500 em
   `amount_total` ≥ 1e8.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile cru
   `half-applies paid`; reconcile de refund DOA (42703) — **cron-only mas live-wired**; manual não é afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[SHARPENED]`/`[NARROWED]`/`[REFUTED]`/`[de-claim]` = status vs 10-25; **(v: …)** =
verificação; `[xrepo]` = dependência cruzada. Severidade ancorada no gate do **piloto**; escalonamento p/ GA anotado.
`file:linha` = evidência lida **nesta** sessão sobre código byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO ×3 — SCHEMA + PILOT + orquestrador)** — Nenhum caminho
  do app escreve `professional_schedules` (grade semanal-base; tabela `calendar.ts:41-62`, DB-real desde `0008`). Único
  `INSERT` = fixture `test/integration/calendar-booking.test.ts:120` (SQL cru). Símbolos `weekly*`/`createSchedule`/
  `upsertSchedule`/`WeeklySchedule` = **0 app-wide** (grep orquestrador: só o SELECT `availability.ts:116` + comentário
  `:5`). `:126 if(!sched) continue` esvazia todo dia e executa **antes** da leitura do override `extra` (`:154`) → o único
  writer de capacidade (`createScheduleOverride` type=`extra`) **nunca** resgata um profissional sem row base → **sem
  escape-hatch de bootstrap**. Não existe módulo `src/modules/onboarding/` apesar do `onboarding_stage_enum` ter valor
  `schedule` (`_shared.ts:44`). Escopo backend/ADR-010 **aceita** (`WeeklySchedule` 1ª classe). — Impacto: 100% dos
  agendamentos = `slot_conflict`, app-wide. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (seedar grade). **#1.**
  `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO ×3 — SCHEMA + PILOT + orquestrador)** —
  `seed-pilot.ts` importa só organizations/staffAccounts/professionals/services (`:33-35`) e tem exatamente **4**
  `.insert(`: organizations (`:110`), staffAccounts (`:157`), professionals (`:195`), services (`:217`). Zero `calendars`
  → `availability.ts:75 notFound("Calendar")`. `createCalendar` existe (`calendar/repository.ts:20`) e está route-wired
  (`routes.ts:38`); o gap é "o seed nunca o chama e não há bootstrap não-HTTP". `professional_services` também não é
  semeado → fallback "todos bookáveis" (`availability.ts:91-96`). `system_holidays` omitido é **fail-open** (`:108-111`),
  não co-bloqueador. — Esforço: **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×3 — PILOT + AUTH + grep)** — seed
  provisiona **só** org + `staff_account` (HS256, `staff-auth.ts:70`); toda rota de calendar é `requireClerkAuth()` RS256
  (`calendar/routes.ts:22,48`; `clerk-auth.ts:90` pin RS256 + claim org) → token staff rejeitado 401. `grep requireStaff|
  requireRole src/modules/calendar/` = **0**; o seed não cria usuário Clerk nem row `users`. Sit **upstream** dos 2
  CRÍTICOs. — Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-26; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice`** `[carry]` **(v: RODADO)** — `pnpm test:integration` = **RED exit 1**,
  `1 failed | 92 passed (93)` (`Test Files 1 failed | 13 passed (14)`). Falha = `calendar-booking.test.ts:259` "retorna
  slot_conflict quando start_at < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be
  'slot_conflict'` — o gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei 06:04 BRT (09:04 UTC) → `booked`. **Com
  2× teardown `57P01`** (ruído de teardown testcontainers/ioredis — vs 4× no 10-25, 2× no 10-24; não muda pass/fail).
  `ci.yml` (job `Tests`) roda `pnpm test` + `pnpm test:integration` com services pg16+redis7, **sem** `continue-on-error`.
  — Esforço: **0,5h** (slot `now()`-relativo + fechar `closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-50-high`** `[carry, PLATÔ 3ª passada byte-idêntico]` **(v: RODADO)** — `pnpm audit
  --audit-level high` = **RED exit 1, 115 vulns (10 low · 55 moderate · 50 high · 0 critical)** — **DELTA ZERO vs 10-25 e
  10-24**. 50 high em **19 módulos** (mesmo conjunto: `@fastify/static`, `@grpc/grpc-js`, `@opentelemetry/{auto-
  instrumentations-node,exporter-prometheus,propagator-jaeger,sdk-node}`, `brace-expansion`, `fast-uri`, `fastify`,
  `find-my-way`, `js-yaml`, `nanoid`, `postcss`, `protobufjs`, `source-map-js`, `tmp`, `undici`, `vite`, `zod`), incl.
  **`zod@4.4.3` direct-prod** (`<4.6.6`, exaustão de memória na camada de validação HTTP). Highs prod-runtime: `fastify`,
  `find-my-way`, `fast-uri` (path ajv), `@grpc`/`@opentelemetry/*`, `protobufjs`; os demais (undici/nanoid/vite/postcss/
  source-map-js/tmp) só via testcontainers+vitest (dev). `security.yml` → osv-scanner + `pnpm audit --audit-level high`
  com **`continue-on-error: false`** → hard-fail. **Tendência 12→15→18→49³→50→50→50.** — Esforço: **4-6h** (`pnpm add
  zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion).
  **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[carry, possível aprofundamento]` **(v: orquestrador — `gh run list`)** — todo
  run `schedule` em `main` (Security seg-cron `0 6 * * 1`; CodeQL ter-cron `0 6 * * 2`) termina em **`startup_failure`
  (0s)** ininterrupto de **09-22** até 10-20; último run agendado que executou = Security `failure` em **09-21** (CodeQL
  success 09-15). **NOVO sinal:** o slot de **hoje (10-26) às 06:00 UTC** não produziu run algum (nem startup_failure) até
  09:04 UTC — possível aprofundamento de "falha ao agendar" para "não-agenda". Gate de segurança agendado **nem roda nem
  alerta** há ~5 semanas. Causa não-introspectável offline (billing/quota Actions, action-ref, ou política de org). —
  Esforço: **0,2h** (re-enable) — fix real é destravar o lockfile. `[xrepo: GitHub Actions]`

**Auth / rate-limit — buraco app-wide**

- **`rate-limit-plugin-dead-app-wide`** `[carry]` **(v: CONFIRMADO ×3 — AUTH + SEC + orquestrador)** — `requireRateLimit`
  tem **zero callers** em todo `src/` (só `rate-limit.ts:4` doc, `:146` decorate-def, `global.d.ts:66` tipo).
  `@fastify/rate-limit@^10.3.0` é dep declarada (`package.json:37`) mas **nunca importada/registrada** em `src/`; o plugin
  Lua custom é registrado (`bootstrap/server.ts:134`) mas apenas **decora** o opt-in `requireRateLimit` — **nenhuma rota o
  anexa** (login/refresh, mutações de money, webhooks metaapi/Stripe, rotas Clerk). Login staff (`auth/routes.ts:90`) **sem
  preHandler** → brute-force online ilimitado (bcrypt cost-12 único freio; MFA é Marco-3). — Impacto: brute-force de admin
  + superfície de DoS (ver `pre-HMAC amplification`). Piloto baixo (1 admin, senha requiredInProd). — Esforço: **~1h**.
  **#8.**
- **`staff-jwt-secret-no-min-length`** `[carry]` **(v: CONFIRMADO — AUTH)** — `env.ts:60 STAFF_JWT_SECRET: optionalString`
  (sem `.min()`); refine de prod é **presence-only** (`:206`) → secret de 1 char passa; `staff-auth.ts:70` assina HS256. O
  mesmo secret assina o JWT de `state` do Google OAuth (`oauth.ts:95-96`), **mas** audiences distintas (`bevox-backend-
  staff` vs `bevox-google-oauth-state`) e ambas verificadas → **sem replay cross-plane**; o risco é o **piso de entropia**
  compartilhado entre dois domínios de segurança. — Esforço: **0,5-2h** (`.min(32)` + refine prod). **O buraco de auth mais
  duro no piloto (HS256 staff).**
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — AUTH, canon-reforçado)** — `requireRole` é **vaporware**:
  só 3 comentários-prosa (`clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`); **não declarado** no
  `FastifyInstance` (`global.d.ts:52-70` lista os 6 decorators reais). `clerk-auth.ts:109 role = … ?? "member"` (default
  **fora** do enum DB `owner|admin|operator|professional_viewer`). Rotas cliente mutantes (money; DELETE/PATCH
  professionals|services; PATCH org/settings; PII customers; waitlist) têm só `requireClerkAuth+requireOrganizationScope`
  → qualquer JWT org-member roda tudo intra-org (org-scope ainda bloqueia cross-org). **Canon ADR-013 l.143** manda
  middleware rbac por role — não entregue. Blast-radius **nulo no piloto** (piloto usa plano staff). — Esforço: **1-2d**.
  `[xrepo: backend/ADR-013]`
- **`impersonation-audit-trail-absent`** `[carry, SHARPENED]` **(v: CONFIRMADO — AUTH)** — `auth/service.ts:135-139` seta
  claim `impersonation_id`. O hook de audit (`auth/routes.ts:70-87`) vive no plugin encapsulado `authRoutes`
  (`server.ts:198`); staff-ops é registrado como plugins **irmãos** (`server.ts:213-215`) → encapsulamento Fastify → o
  hook **nunca dispara** nas ações staff-ops; estas **são** auditadas (`actions.repository.ts:174-184`) **mas** gravam
  `actor_type='user'`, `actor_id=NULL`, e **nenhum `impersonation_id`**. Os **reads** staff-ops (`read.routes.ts:22-40`)
  tomam `organization_id` do **query string**, são cross-org, e **inteiramente não-auditados**. `organization-scope.ts:57`
  retorna o `impersonation_id` **como** claim de org → semanticamente errado; mas **nenhuma rota pareia `requireStaff`+
  `requireOrganizationScope`** (grep orquestrador: todos os ~20 usos de `requireOrganizationScope` pareiam com
  `requireClerkAuth`) → o branch staff em `organization-scope.ts:55-57` é **código morto inalcançável**, por isso o bug é
  **latente** (impersonation não dá acesso incremental; só efeito vivo = audit do `end`). — Esforço: **1-2d**. `[xrepo:
  ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO — AUTH)** — `auth/repository.ts:217-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id) +
  `routes.ts:169-170 orgClaim = organization_id ?? clerkUserId`; `upsertUserFromClerk` hardcoda `role='operator'`
  (`:238`); webhook só trata `user.*`, sem `organization.created` → paradoxo de bootstrap. Mitigado no piloto (seed). — É
  o **porquê** de não existir row `users` (alimenta o gate auth-actor). — Esforço: **4-8h** (+ADR org-mapping). `[xrepo:
  Clerk]`
- **`clerk-jwt-no-aud-iss-validation`** `[carry, aud/iss-only]` **(v: CONFIRMADO — AUTH)** — `clerk-auth.ts:89-92`
  verifica só `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim
  não-verificada (`:105`). jose **já** valida `exp`/`nbf` + pin RS256 — o gap é estritamente **aud/iss** (qualquer token
  RS256 do mesmo JWKS/instância Clerk é aceito). **Assimetria:** tokens staff **pinam** audience; Clerk não. — Esforço:
  **0,5-1h**.

**Canais / money — alcançável no piloto (reachability por Clerk-user; staff HS256 semeado esbarra 401 upstream)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry, pilot-universal]` **(v: CONFIRMADO — SEC + orquestrador;
  "defeito confirmado mais danoso")** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:16,35,44`) e
  persiste em `channel_connections.provider` (`metaapi/routes.ts:246-252` → coluna `notNull()` **sem CHECK**).
  `upsertChannelConnection` tem **exatamente 1 caller** (`routes.ts:246`, verificado pelo orquestrador) e é o **único
  INSERT** em `channel_connections` (`channels/repository.ts:66`); o seed não cria channel_connection → o provider é
  **estruturalmente sempre `"wa"`/`"ig"`**. Outbound `findExecutionDeliveryContext` null-coage provider ≠ pleno
  (`metaapi/repository.ts:197`) → `ctx.provider=null` → guard `executions/seams.ts:360` → `skipped_missing_recipient`
  (`:376`); `isDeliveryFailure` exclui skips (`seams.ts:122-124`) → `complete-service.ts:100` fica `done` (**falso-
  sucesso**); métrica loga `channel:"unknown"`. meta-api `origin/main 5516c2a` exige `z.enum(["whatsapp","instagram"])`
  (`messages/schemas.ts:7`, **re-confirmado esta sessão**) → `wa`/`ig` é invenção 100%-backend. **Alcançável NO piloto
  (Clerk-user):** `approve()`→`runApproval`→`deliverToChannel` **e** `executeProposals`→`deliverToChannel`. — Impacto:
  **100%** das respostas de IA a conversas inbound-semeadas descartadas em silêncio como `done`. — Esforço: **3-4h**. **#5.**
  `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, irreversível; SHARPENED → alcançável desde `pending`]** **(v:
  CONFIRMADO — SEC + orquestrador)** — `markChargePaidManually` **não** tem status-gate (`service.ts:422-433`; docstring
  `:415-416` proíbe-o por design); `applyChargePaid` chama `insertPayment`+`confirmAppointmentIfUnconfirmed`+grant
  **incondicional** (`service.ts:891,902,915-919`) **ignorando o rowcount** de `markChargePaid` (guardado `WHERE
  status='pending'`, `repository.ts:395-398`). Re-mark de `expired`/`refunded` → rowcount-0 **mas** os 3 side-effects rodam
  → payment `paid` órfão fresco (ON CONFLICT `(org,manual:<id>,'paid')` não colide pois o anterior virou `reversed`); depois
  **irreversível** (`refundChargeManually` exige `status==='paid'` `:499`). **SHARPEN NOVO (v: SEC):** `expireChargeManually`
  (`service.ts:623-650`) é **lock-free** (só um check point-in-time `status!=='pending'`), enquanto mark-paid usa
  `withRedisLock("payments:manual-paid:<id>")` — **lock-keys disjuntas** → um expire concorrente pode correr com mark-paid
  e manufaturar o órfão **a partir de uma charge legitimamente `pending`**, não só re-marcando uma terminal. Rotas sob
  `mutate` = `requireClerkAuth()+requireOrganizationScope()` → reachable por **Clerk org-user** (staff HS256 esbarra no 401
  upstream). Root-cause compartilhado alcança o path Stripe. Fix = gatear os 3 side-effects no rowcount **+** lock único
  por charge. — Esforço: **~1h**. **#4.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA ligar — INERTE no piloto manual)**

- **`harness-status-callback-method-mismatch-total`** `[carry, root-cause único]` **(v: CONFIRMADO byte-level nos 2
  repos — L)** — Harness `post()` hardcoda `method:"POST"` (`bevox-harness src/integration/bevox-callback.ts:28`);
  `updateStatus` POSTa `running` (`execution-handler.ts:1410,1584`) / `dead_letter` (`bullmq-consumer.ts:155`), backend só
  registra **PATCH** `/status` (`harness-callbacks.routes.ts:56`) → **toda** chamada de status → Fastify **404**.
  `applyStatusTransition` + `markExecutionDeadLetter` são **código morto ponta-a-ponta**. O worker `on('failed')` só loga
  jobs backend-internos → **root-cause único**. Backend é **canon-correto** (§10.4 PATCH l.1076). Fix = **cross-repo**
  (harness→PATCH + errata canon l.447 — ver `canon-status-method-self-contradiction` no governança). — Esforço: **~1,5h**.
  **#7.** `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry, status-agnóstico]` **(v: CONFIRMADO — L; grep leituras=0)**
  — o preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:71,96`; escreve
  `req.executionContext` em `routes.ts:66`), mas **todo** handler age sobre o `:id` da URL (`routes.ts:73,91,113,142`) e
  **nunca** lê `req.executionContext` (grep: única ocorrência = a escrita `:66`). Token válido p/ A escreve em qualquer
  execução B (IDOR cross-execution/cross-tenant). O branch dead_letter usa `resolveExecutionTokenAnyStatus` (`routes.ts:68`)
  → qualquer token (mesmo de execução terminal) pode dead-letter qualquer outra. Coexiste com `four-callbacks-token-gated`
  (autenticidade ≠ autorização). **Inerte no piloto**; **CRÍTICO-GA**. — Esforço: **1h**. `[xrepo: bevox-harness]`
- **`dispatch-message-id-not-uuid-poisons-every-AI-dispatch`** `[carry, fire-first; SHARPENED root-cause]` **(v:
  CONFIRMADO — L + orquestrador)** — `buildDispatchMessages` seleciona `external_message_id` (`orchestration/
  repository.ts:395`) e o mapeia a `message_id` (`:409`); `external_message_id` é `text NOT NULL` (`ingestion.ts:40`),
  id nativo de canal (`wamid.*`) — **nunca** UUID. `DispatchMessageSchema.message_id = Uuid.optional()` (`harness-dispatch.
  schema.ts:22`) → ZodError "Invalid uuid" em `DispatchPayloadSchema.parse` (`harness-dispatcher.ts:91`) **antes** do
  enqueue. **SHARPEN NOVO (v: L):** canon (`PRD l.1060`) define `message_id` = o **UUIDv7 PK interno** (`message_records.id`),
  não o id de canal → a constraint UUID é **canon-fiel**; o bug é **selecionar a coluna errada** (`external_message_id` em
  vez de `id`). Determinístico, 100% dos dispatches de IA, nos 2 paths (cutoff + redispatch staff). **Fire-first:** dispara
  **antes** de criar execução, MASCARANDO os 2 achados abaixo. — **Inerte no piloto manual; CRÍTICO-GA.** — Esforço:
  **~15min** (`message_id: m.id`). `[xrepo: bevox-harness]`
- **`dispatch-messages-unbounded-poison`** `[carry, MASCARADO por message_id-poison]` **(v: CONFIRMADO — L)** —
  `buildDispatchMessages` (`orchestration/repository.ts:394-399`) seleciona **TODAS** as linhas de texto da conversa (sem
  LIMIT); backend não cappa count nem length; harness impõe `max(100)`/`max(8000)`/`256KB` (`execution-handler.ts:606-608`)
  → payload acima = `UnprocessablePayloadError`. Hoje inalcançável (message_id-poison rejeita antes no egress); manifesta
  quando aquele for corrigido. — **Inerte no piloto; CRÍTICO-GA.** — Esforço: **1-2h**. `[xrepo: bevox-harness]`
- **`completion-never-clears-active-execution-id`** `[carry, MASCARADO]` **(v: CONFIRMADO — L)** — só `releasePipelineClaim`
  (`orchestration/repository.ts:231`) e `handoffConversationOnTimeout` (`:464`) nulam `active_execution_id`;
  `finalizeCompletion` (`harness-callbacks.repository.ts:136-149`) só escreve `executions` (grep: 0 refs); guard de dispatch
  exige `active_execution_id IS NULL` (`:196`) → conversa trava após a 1ª execução. Mascarado hoje (nenhum dispatch
  sucede; o branch de falha libera o claim). — **Inerte no piloto**; **CRÍTICO-GA (IA single-turn)**. — Esforço: **3-4h**.
  `[xrepo: bevox-harness]`
- **`backend-never-sends-skills-allowlist`** `[carry]` **(v: CONFIRMADO — L)** — `cutoff.ts:75 skills:[]`;
  `actions.repository.ts:144 skills:[]`; `account_denied_tools` **nem existe** no `DispatchPayloadSchema`; harness trata
  `[]` como "todas as tools" (`execution-handler.ts:657`) → PERM-05 **no-op** e2e. — **Inerte no piloto**; CRÍTICO-GA. —
  Esforço: **4-8h**. `[xrepo: bevox-harness]`
- **`complete-service strategy/tenant mismatches`** `[carry, SHARPENED]` **(v: CONFIRMADO ×3 sub-claims — L)** —
  `strategy:"failed"`+proposals vazias → `"reply"` (`complete-service.ts:17-32`), nunca `error` (canon espera `error`,
  PRD l.1147); harness emite `aborted_cost`/`aborted_timeout` (`execution-handler.ts:2096-2100`) ausentes do enum backend
  (`harness-callbacks.schema.ts:57-65`) → `CompleteCallbackSchema.parse` 400 **antes** de `lockForCompletion` → 2 de 3
  desfechos terminais do harness rejeitados; `/complete` lê `bodyOrgId` sem `=== existing.organization_id`
  (`routes.ts:150-154`) e esse org não-verificado é o escopo passado a `executeProposals`/`deliverToChannel` → **vetor de
  ação cross-tenant em GA**, compondo o token-IDOR. — 1-3h/ea. `[xrepo]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — ROUTES + PILOT + orquestrador)** — Não existe `GET
  /appointments` nem `/appointments/:id` em lugar nenhum: `grep app.get(...appointment)` = **0** (orquestrador); as 6 paths
  YAML de appointment são todas POST/PATCH; calendar GET expõe só `/calendars` + `/availability`; staff-ops reads =
  dashboard/executions/windows/dead-letters/audit. **A agenda é ilegível sobre REST p/ TODO ator (Clerk E staff) — e não
  tem entrada no OpenAPI.** §10.1 não o enumera, mas persona mobile (PRD arch l.173) + §8.3 exigem. — Esforço: **4-6h**
  (rota+service+repo+yaml). `[xrepo: PRD §5.3/§8.3]`

### MÉDIO (degrada qualidade)

**Auth — NOVO contrato / cross-org (plano staff-ops que o piloto usa)**

- **`staff-token-expires_in-advertises-refresh-ttl-not-access-ttl`** `[NOVO]` **(v: CONFIRMADO — AUTH + orquestrador)** —
  `issueSession` devolve `expires_in: ttl` onde `ttl = staffRefreshTtlSeconds()` = 604800s/7d (`auth/service.ts:54,60`),
  mas o JWT access-token `exp` = `STAFF_JWT_ACCESS_TTL` = 900s/15min (`staff-auth.ts:74`; `env.ts:61`). OpenAPI
  `StaffTokens.expires_in` é um integer não-descrito (`yaml:185`). Um cliente que agenda refresh por `expires_in` trata um
  token de 15min como válido ~672× tempo demais → 401 silenciosos até cair no fallback refresh-on-401. **Bug de contrato
  no plano de auth que o piloto de fato usa** (painel staff-ops). Nenhuma passada anterior o pegou. — Esforço: **0,25h**
  (`expires_in: cfg.STAFF_JWT_ACCESS_TTL`).
- **`staff-ops-realtime-sse-firehose-unaudited`** `[NOVO]` **(v: CONFIRMADO — AUTH + orquestrador)** — `GET /api/v1/staff/
  realtime/events` faz `sub.psubscribe("realtime:*")` (`realtime.routes.ts:66`) — **firehose cross-org de TODOS os orgs** —
  gated só por `requireStaff([...STAFF_ROLES])` (observer incluído, `:29`), **sem filtro de org e sem emissão de audit**. O
  finding de impersonation citava só `read.routes.ts`; esta superfície SSE é um canal cross-tenant distinto e
  não-auditado. — **MÉDIO/LGPD (GA).** — Esforço: **2-4h** (filtro de org no psubscribe + audit).

**Observabilidade — worker é buraco-negro (11 workers; harness inerte no piloto, exceto obs que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry, SHARPENED]` **(v: CONFIRMADO ×2 — PILOT + orquestrador; ALTO-
  operabilidade, exercitado-no-piloto)** — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca** `import
  "./instrument.js"` nem `initTelemetry()` (ambos só em `src/index.ts:17,30`; grep em queue/ = 0). O worker importa
  `captureException` (`queue/index.ts:62`) mas `Sentry.init` vive em `src/instrument.ts:22` (só o HTTP entry importa) →
  `captureException` (`:272,313`) é drop silencioso; o OTel NodeSDK nunca inicia p/ os **11 `new Worker`** (grep orquestrador
  = 11, confirmando que o docstring `:6` "4 workers + 2 repeat jobs" é **stale**). O handler `w.on("failed")` (`:267-269`)
  **nem tenta** `captureException` — só `log.error`. — **1h** (import + `initTelemetry()`). **Alto valor / baixo esforço.
  #6.**
- **`metrics-public-org-id-enumeration`** `[carry]` **(v: CONFIRMADO ×2 — SEC + PILOT)** — `GET /metrics`
  (`health/routes.ts:24`) é in-app **não-autenticado** (sem preHandler; comentário `:22-23` admite só network-policy) e o
  counter `bevox_backend_http_requests_total` é rotulado com `organization_id` (`metrics.ts:30-35`), incrementado por-request
  com o UUID real (`bootstrap/server.ts:170`) → quem alcança `/metrics` enumera **todos os org-UUIDs + rota/status/volume
  por-org** (vazamento ADR-021) + blow-up de cardinalidade em GA. Severidade limitada pela intenção documentada de restringir
  via network-policy. — Esforço: **1-2h** (guard staff/interno OU drop do label). `[g; ADR-021]`
- **`worker-has-no-healthz-readyz` + `worker-process-has-no-metrics-scrape-endpoint`** `[carry]` **(v: CONFIRMADO — PILOT)**
  — worker não sobe listener (`grep listen|fastify|renderMetrics queue/index.ts` = 0) → counters do worker (reconcile
  `:88,114,162,165`) **não-scrapáveis** **e** sem liveness/readiness → crash/stall do worker invisível. O piloto exercita o
  reconcile. — **2-3h**.
- **`domain-prometheus-metrics-not-registered` + `domain-metrics-declared-but-never-emitted`** `[carry]` **(v: PILOT)** —
  `shared/metrics.ts` não registra os de §12.10 l.1365 / §13.3 l.590 (`charges_succeeded_total`, `appointments_no_show_rate`,
  `executions_pending_approval_count/timeout_total/total`, `charges_total`, `queue_jobs_completed_total`,
  `buffer_windows_opened_total` — grep=0); `metrics.ts:41 queueSize` nunca `.set()` e `:52 messagesReceivedTotal` nunca
  `.inc()` (o piloto exercita ingestão). — **2-3h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` **(v: PILOT)** — `realtime/publish.ts:8-12` união fechada a
  `execution.*`/`waitlist.offered`; `appointment.created`(§8.3 l.870)/`charge.updated`(§8.4 l.879) **nunca** emitidos
  (`publishRealtime` em booking/payments = 0) → tela do profissional não auto-atualiza. — **2-3h**.
- **`metaapi-webhook-preauth-db-amplification`** `[carry]` **(v: CONFIRMADO — SEC)** — um envelope bem-formado (passa Zod
  `metaapi/routes.ts:130`) dispara `SELECT … channel_subscriptions` (`:140-144`) **+** `findSubscriptionById` (`:150` → 2ª
  query + `decrypt` AEAD em `repo.ts:41`) **antes** da validação HMAC (`:156-169`), e **sem rate-limit em rota nenhuma** (o
  dedupe SETNX também é pós-HMAC). Flood não-autenticado → 2 queries + 1 decrypt/request. — **GA/DoS.** — Esforço: **~1h**
  (validar HMAC antes do decrypt, ou cachear o secret ativo). `[k]`

**Dados/LGPD — scoping de conteúdo (GA/Marco-3, piloto roda com PII real)**

- **`message-content-table-untargetable`** `[carry, SHARPENED]` **(v: SCHEMA; MÉDIO/LGPD)** — `message_records`
  (`ingestion.ts:32-56`) guarda PII de mensagem (`content_text` egresso ao LLM + `sender_snapshot_json` + `media_json`) mas
  **sem `organization_id`, sem `created_at` de inserção, sem `deleted_at`** — o único timestamp é o nullable provider
  `message_created_at` (`:43`). FK `received_event_id onDelete set null` (`:36-38`) → a única âncora transitiva
  (`received_events.received_at`) é **by-design severável**, não só "frágil". Conteúdo não é DSR-targetável por org nem
  envelhecível por cron. — **GA/LGPD.** — Esforço: migration (M). `[g/schema]`

**Agenda — correção de dados quando exercitada (Marco-2; CONFIRMADOS por PILOT/SCHEMA)**

- **`appointment-transition-no-state-guard`** `[carry, SHARPENED]` **(v: PILOT)** — `booking.ts:445-450` UPDATE incondicional
  any→any (comentário `:435-438` admite; `prevStatus` gateia só o decremento). `cancelled→confirmed` **ressuscita** um
  appointment liberado no seu `start_at` original **sem re-check de capacidade** — e como `availability`/conflict contam
  `status NOT IN ('cancelled')` (`availability.ts:169`), re-entra na contagem de overlap → **over-book silencioso** se o slot
  foi re-bookado/waitlist-ofertado após o cancel. — **GA integridade.** — **2-3h** (matriz de transições legais).
- **`package-session-not-restored-on-cancel-after-complete`** `[NOVO]` **(v: CONFIRMADO — PILOT + orquestrador)** —
  `transitionAppointment` decrementa o pacote em `completed`/`no_show` (`booking.ts:496-499`) mas o branch de cancel
  (`:461-472`) faz só outbox+waitlist, e **não existe lógica de re-incremento/restore em lugar nenhum** (grep=0). Combinado
  com o UPDATE any→any (acima), `completed→cancelled` **consome permanentemente** uma sessão de pacote sem restaurá-la. —
  **GA integridade (inerte no piloto semeado — sem customer_packages).** — **1-2h**.
- **`reschedule-non-atomic-double-book`** `[carry]` **(v: PILOT)** — `createAppointment` commita o NOVO em tx própria
  (`booking.ts:373-388`), DEPOIS uma tx **separada** (`:390-414`) cancela o ANTIGO → janela de double-count + crash entre
  commits deixa **ambos ativos permanentemente**. — **halfday** (dobrar numa tx só).
- **`appointment-mutations-no-auditevent` + `appointments-no-created-by-actor`** `[carry]` **(v: PILOT + SCHEMA)** — §12.8
  l.1344 manda Appointment C/U/D → AuditEvent; `booking.ts:234-516` grava **zero** `audit_events`; e as colunas
  `created_by_type/created_by_id` (§8.3 l.869) **não existem** (grep `created_by src/ db/migrations/` = 0). Quem criou/mudou
  um booking é irrecuperável. — **halfday**.
- **`status-history-entity-absent`** `[carry]` **(v: SCHEMA)** — Módulo 16 l.584/588 + §8.3 + §8.4 mandam `StatusHistory` p/
  Appointment/Charge/Conversation; grep `status_history|StatusHistory` em `src/`+`db/schema/` = **0**. `AuditEvent` existe
  mas é event-log, não histórico de transição por-entidade. — **GA**. — **M**.
- **`reschedule-thin-idempotency`** `[carry, NARROWED]` **(v: PILOT)** — `booking.ts:387 idempotencyKey:undefined`. O PATCH
  usa `write` = `requireIdempotency()` (`routes.ts:24`), replay-cache HTTP completo → retries de mesma-chave **são**
  deduplicados. Resíduo: janela de falha-parcial + o booking interno deixa `idempotency_key=NULL`. — **1h**.
- **`reschedule-drops-metadata` / `reschedule-self-overlap` / `reschedule-double-charge-on-prepaid` / `no-availability-422-
  collapsed-to-409` / `availability-n1-count-plus-92day-serial-loop`** `[carry]` — metadata não copiado; recount conta o
  appt antigo; double-charge prepago (inerte); 409-vs-422 é gap código↔**PRD** (não yaml-drift, §8.3 l.875-876); COUNT(*)
  por-slot em loops aninhados (`availability.ts:167-171`) × serial ≤92 dias (`routes.ts:52-67`), auth-guardado não
  rate-limited. — 0,5h–halfday/ea.

**Contrato backend↔harness / money (mismatches; INERTES no piloto manual, ALTO/MÉDIO-GA)**

- **`intent-reconcile-half-applies-paid`** `[carry, SHARPENED]` **(v: SEC)** — `reconcile.ts:143-150` seta só `status='paid'`
  +`updated_at` (charges TEM `updated_at`, sem 42703) **bypassando os 6 efeitos de `applyChargePaid`** (sem row `payments`,
  `paid_at` NULL, sem confirm, **sem grant de pacote**, sem audit). Branch **live** (Stripe-path, inerte no piloto). — **M**.
- **`requires-prepayment-hook-throws-manual-mode`** `[carry, de-claim parcial]` **(v: SEC)** — `booking.ts:275,299` hardcoda
  Stripe `createCharge`; conta manual (`external_account_id=NULL`) → `service.ts:193-197 lança`; caught (`:315-339`) **e
  auditado como `charge.hook_failed` (`:329`)** → observável, não totalmente silencioso, mas booking retorna `booked` sem
  charge. Alcançável no piloto se algum serviço tiver `requires_prepayment=true`. — **LOW (observável).**
- **`dispatch-stream-field-absent` / `dispatch-default-model-asymmetry` / `completing-state-no-timeout-backstop` /
  `trace-content-dropped` / `stream-chunk-char-vs-byte`** `[carry]` — harness default `stream:false` → `/stream`+buffer
  Redis+SSE código morto; `default_model` coalesced mas deve bater no `MODEL_PROVIDER_ALLOWLIST` do harness (latente);
  `claimTimedOutExecutions` (`orchestration/repository.ts:428`) varre `dispatching/processing/waiting_input` **não**
  `completing` → row em `completing` (lock won, finalize crashou) nunca varrida; `/traces` mapeia só `type→step_type` e
  **dropa** `content`/`step`/`timestamp` (`step_name="unknown"`, `input/output=null`, `duration_ms=0`); `chunk.max(4096)` é
  cap de caracteres vs bytes canon. — 0,25-2h/ea. `[xrepo]`

### BAIXO (higiene)

**LGPD (Marco-3 §16.3 — piloto roda com PII real; CONFIRMADOS pelo agente LGPD; 2 de-claims STANDES)**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry, SHARPENED]` **(v: CONFIRMADO — vetor vivo, headline LGPD)** —
  `ai_opt_out` só no CRUD de customers (`customers/repository.ts:21,26,67`; `default false`=opted-IN); dispatch
  `cutoff.ts:54`→`buildDispatchMessages(conversationKey)`→`orchestration/repository.ts:391-415` seleciona `content_text` cru
  por `conversation_key` **sem join de customer**. **Arquitetural:** dispatch é **conversation-keyed, nunca customer-keyed**
  → opt-out por-customer inaplicável sem mudança de schema/flow; `ai_opt_out` é double-dead (1 writer staff-PATCH, 0
  dispatch-readers). Canon `_shared/ADR-019:57` manda opt-out geral V1. — Esforço: **M** (link
  conversations.customer_id→customers + gate). **#10.**
- **`no-consent-capture-mechanism` + `intake-pii-ingested-pre-notice`** `[carry]` **(v: LGPD)** — `consent_granted_at`
  (`customers.ts:49`) tem **zero writers**; `intake.ts:66`→`:82 resolveOrCreateCustomerChannel`→`channels/repository.ts:
  113-117` INSERT cego em `customers` (full_name=displayName) + customer_channels com telefone, **sem gate de consentimento
  e sem "aviso automático"** que `_shared/ADR-019:33 item 6` exige → PII ingerida **pré-aviso**. — **MÉDIO (pilot-live).**
  — Esforço: **L**. `[xrepo: _shared/ADR-019]`
- **`received-events-and-message-records-un-erasable`** `[carry]` **(v: LGPD + SCHEMA)** — `received_events`
  (`ingestion.ts:12-30`) persiste **`payload_json` E `normalized_payload_json`** (envelope Meta cru) com **zero
  `organization_id`/`customer_id`/`deleted_at`**; `message_records` sem `organization_id`/`customer_id` apesar de
  `content_text`+`sender_snapshot_json`+`media_json` → **5 cópias de PII inbound cruas não-apagáveis**. **DE-CLAIM honesto
  STANDE:** "sem âncora temporal" é overstatement — existe âncora **transitiva** via `received_event_id →
  received_events.received_at` (`:21`); só o `created_at` **direto** de `message_records` é genuinamente ausente. — Esforço:
  **L**. `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` **(v: CONFIRMADO — grep global = ZERO)** — grep `legal_basis|consent_event|
  dsr_request|retention|pseudonym|message_archive|content_redacted` em `src/ db/ scripts/` = **0**; os 11 workers não
  purgam/pseudonimizam; `auth/repository.ts:99-100` **admite** "Hard-delete worker (canon ADR-020, ainda não landed)". Canon
  ADR-020 define `bevox.retention.worker` (cron 03:00 UTC) + `consent_events`/`dsr_requests`. — Esforço: **24-40h**.
  `[xrepo: _shared/ADR-020]`
- **`dsr-deletion-absent` + `dsr-export-incomplete-unrecorded-unreachable`** `[carry]` **(v: LGPD)** — nenhum endpoint de
  deleção; DSR export EXISTE (`customers/routes.ts:97` scope `read`, `service.ts:97-110`) mas omite
  `preferences_json`/`risk_flags_json` + `messages`/`audit_events` hardcoded `[]` (TODO Marco-3 `service.ts:84,85`) +
  customer_channels + appointments + waitlist + payments + conversations + execution_traces; **não grava `audit_event` nem
  `dsr_requests`** → zero evidência art.37. O export é `requireClerkAuth` RS256 → o piloto (staff HS256) **não alcança** →
  capacidade DSR efetiva do piloto = **zero**. **DE-CLAIM STANDE:** `consent_granted_at` entre "PII omitida" é imaterial
  (sempre NULL); perdas reais = `preferences_json`/`risk_flags_json`. — Esforço: export **6-10h**; deleção **8-12h**;
  `dsr_requests` **S-M**. `[xrepo: _shared/ADR-020]`
- **`staff-manual-actions-pii-sink`** `[NOVO]` **(v: LGPD)** — `staff_manual_actions.ts:30-31` `request_payload_json` +
  `result_snapshot_json` (jsonb) capturam conteúdo de ação de operador (texto outbound, dados de booking) = PII de cliente;
  tem org (`:18-20`) + created_at (`:32`) → ancorável, mas **sem `customer_id`**, ausente da tabela ADR-020, e omitido do
  DSR export. — **GA/Marco-3 latente.** — Esforço: S.
- **`audit_events-not-customer-scoped` + `audit_events-has-no-staff-actor-type`** `[NOVO ×2]` **(v: LGPD + AUTH)** —
  `audit.ts:20-44` keya por `entity_type`/`entity_id`/`actor_id`, **sem coluna `customer_id`** → o TODO do DSR export
  "audit_events filtrado por customer_id" (`routes.ts:93`) é **estruturalmente irrealizável** sem convenção
  `entity_type='customer'`. E o enum `actor_type` = `user|ai|system|webhook` **sem `staff`** (`repository.ts:199`) → ações de
  staff gravadas inconsistentemente (impersonation = `system`+staffId; staff-ops action = `user`+NULL) → auditor não atribui
  uma linha a "um staff agiu". — **Marco-3 estrutural.** — Esforço: S-M/ea.
- **Residue LGPD** `[carry]` **(v: CONFIRMADO)** — `clerk-organization-deleted-unhandled`; `execution-traces-pii` (raw sem
  customer_id, `harness-callbacks.repository.ts:187-208`; TEM org+created_at → ancorável, sem worker);
  `google-calendar-intl-transfer` (`sync.ts:203,237` nome p/ US — art.33); `payments-raw-payload-json` (10yr fiscal → gap
  minimização); `customer-pii-mutations-unaudited` (`customers/service.ts:29-39` — o módulo customers nunca escreve
  `audit_events`); `denormalized-contact-snapshot` em appointments (`calendar.ts:128-130`) **+** waitlist_entries
  (`:194-196`; booking escreve `:240-241`, sobrevive set-null de customer_id); `staff-pii-retention-gap`
  (`upsertUserFromClerk` persiste nome/email em `users`; nem `users` nem `staff_accounts` têm política ADR-020). —
  2-4h/ea.

**Money / schema — misses de baixo risco**

- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry, cron LIVE-wired]` **(v: CONFIRMADO ×2 — SEC + PILOT +
  orquestrador)** — `src/modules/payments/reconcile.ts:255-257 UPDATE refunds SET … updated_at = now()`, mas `refunds` **não
  tem** `updated_at` (`payments.ts:149-172`; o comentário `:7` admite "updated_at adiado a P3/P4") → **42703** → status nunca
  sai de `pending` → reconcile de refund **DOA**. O cron **É live-wired** (`queue/index.ts:149` + repeatable `:258-263`). O
  path vivo `updateRefundStatus` (`repository.ts:476-485`) **omite** `updated_at` → intacto; manual escreve `succeeded`
  direto → cron nunca o seleciona → **pilot-inerte**. CI-invisível (só unit mockado). **Fix = remover `updated_at=now()`.** —
  **0,25h**. `[xrepo: Stripe]`
- **`reconcile-fifo-window-starvation`** `[NOVO]` **(v: SEC)** — `reconcileStuckIntents` seleciona 50 `pending` mais antigos
  (`reconcile.ts:101-108`); charges manuais `pending` (provider_charge_id NULL) são selecionados e **`continue`-skipped**
  (`:119`) → numa org mista com ≥50 pendings manuais estagnados a janela é monopolizada → charges Stripe reais nunca
  reconciliam. Em piloto puro-manual = spam de warn-log por tick. — **LOW/GA.** — Esforço: S (filtrar NULL-provider no
  SELECT).
- **`manual-charge-amount-unbounded-overflow-500`** `[carry]` **(v: SEC; alcançável Clerk-user)** — `manual.ts:31
  z.number().finite().positive()` (sem `.max`/`.multipleOf`); escreve `.toFixed(2)` em `amount_total numeric(10,2)`
  (`service.ts:377`); amount ≥ 1e8 → 22003 → **500 opaco**. Defeito idêntico no path Stripe (`charge-intent.ts:48`). —
  **trivial** (`.max(99_999_999.99).multipleOf(0.01)`).
- **`manual-charge-currency-unvalidated` / `manual-paid-refund-disjoint-lock-keys` / `service-packages-validity-days-
  numeric` / `buffer-windows-no-updated-at` / `payment-accounts-professional-no-uniqueness` / `received-events-no-org-
  column`** `[carry]` **(v: SEC + SCHEMA)** — `currency: z.string().default("BRL")` sem CHECK (PI hardcoda `"brl"` →
  stored-vs-charged divergível); lock-keys disjuntas `manual-paid` vs `manual-refund` (`service.ts:442` vs `:510`) + expire
  sem lock (ver #4 sharpen); `validity_days numeric` (`payments.ts:183`); `buffer_windows` muta sem `updated_at`;
  `payment_accounts.orgUniq` parcial `WHERE ='organization'` (`payments.ts:63-65`) → duplicatas `professional`-level;
  `received_events` sem `organization_id`. — S/ea.
- **`fk-columns-without-index` + `section-11-3-critical-indexes-partially-absent`** `[carry, ≈55]` **(v: SCHEMA — recount)**
  — recount honesto: **91 `.references()`**; **13 tabelas** com índice org-leading → **18 tabelas org-FK com
  `organization_id` completamente sem índice** + ~43 não-org não-cobertas → agregado **≈55**. Ausentes `(org,status)` em
  appointments/charges/executions, `(org,start_at)`/`(org,customer_id)` em appointments, `(org,customer_id)` em charges (PRD
  §11.3 l.1268-1274); `conversations` TEM `(org,status)`+`(org,last_message_at)` → canon-satisfeita. **SHARPEN NOVO (v:
  SCHEMA):** a tabela `customers` (PII primária) tem **ZERO índices** (`customers.ts:35-56`) → "listar customers da org" +
  lookup phone/email = full-scan. Padrão sistêmico, inerte a 1 org. — **3-4h** (uma migration). `[a/schema]`
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized` + `waitlist-priority-score-client-settable`**
  `[carry]` **(v: SCHEMA — canon-reforçado)** — backend/ADR-020 (`aceita`) + ADR-021 (`aceita 2026-05-21`) **não
  materializadas** (grep `message_template`/`urgency_level`/`skip_count` = 0). ADR-021 "Opção C" (l.49-51): `priority_score =
  MAX(0, age_hours + urgency_level×100 − skip_count×10)` + "deprecate client input em V1 (server ignores)" — **vinculante**.
  Mas `calendar.ts:204 priority_score numeric notNull default '0'` **sem CHECK**, escrito do input na rota (Clerk-authed +
  org-scoped, não anônima) `waitlist/routes.ts:71`, no PATCH `repository.ts:361`, no INSERT `:278` **e** no seam de IA
  `seam-tool.ts:83`, e `match` ordena por ele (`match.ts:74-75`) → **inverso direto** de ADR-021. **NÃO re-inflar
  `conversations.priority_score`** (zero writers → dormante). — ADR-020 **8h**; ADR-021 **6-10h** / CHECK+drop-input **2h**.

**Auth / harness / schema (resíduos — BAIXO/latente/inerte)**

- **`newOpaqueId-uuidv4-dormant-landmine` + `verifyStaffRefreshToken-dead-misleading`** `[carry]` **(v: AUTH)** —
  `staff-auth.ts:139 newOpaqueId(): randomUUID()` (UUIDv4) viola CLAUDE.md invariante #7, **zero callers**;
  `staff-auth.ts:119-121 verifyStaffRefreshToken` **zero callers** (refresh vivo usa lookup-by-hash DB), docstring afirma
  "constante-equivalente" mas usa `===`. Ambos inertes mas armadilhas exportadas. Deletar. — trivial.
- **`staff-role-stale-cache-at-login` / `bcrypt-72-byte` / `staff-session-no-logout` / `login-user-enumeration-timing` /
  `staff-refresh-no-reuse-detection` / `clerk-provisioned-role-hardcoded-operator` / `clerk-resolvelocaluser-fail-open` /
  `clerk-webhook-unknown-type-silent-200`** `[carry]` **(v: AUTH)** — cache-aside 300s cunha role no login (refresh é
  DB-direct → só role stale ≤5min); `password.max(512)` + bcrypt ignora >72B; sem logout/revoke (access HS256 stateless
  ≤900s); throw antes do bcrypt = enum-timing; rotação delete-então-emite sem reuse-detection; `ON CONFLICT` role 'operator'
  literal; `resolveLocalUser` fail-open; webhook sem `else` → 200 (svix-verified primeiro). — S/ea.
- **`service-policies-no-org-no-created-at`** `[NOVO, LOW/config]` **(v: SCHEMA)** — `service_policies` (`catalog.ts:101-115`)
  sem `organization_id` + sem `created_at` (só `updated_at`); PK = `service_id` (1:1 FK→services); org-scoping via join;
  policy JSON é config (fit_in/waitlist/payment/handoff), não PII → **LGPD-imaterial**. Normalização defensável; flagado p/
  completude. — n/a.
- **`dispatch-callback-base-url-dead-on-harness-side` + `poisoned-dispatch-orphans-pending-execution-row`** `[NOVO ×2, L]`
  **(v: L + orquestrador)** — backend sempre manda `callback_base_url` (`harness-dispatcher.ts:94`) mas o harness ignora o
  valor per-dispatch e usa o estático `config.bevox.callbackBaseUrl` (`bevox-callback.ts:7`) → routing per-dispatch
  não-funcional. E na ZodError do `message_id`-poison, a row `executions` já foi INSERTada como `'pending'`
  (`harness-dispatcher.ts:74-79`) **antes** do parse (`:91`); `claimTimedOutExecutions` varre só `dispatching/processing/
  waiting_input` (`orchestration/repository.ts:428`), **nunca `pending`** → cada dispatch envenenado deixa um órfão `pending`
  permanente (dívida forense que acumula quando a IA ligar). — Esforço: trivial/ea. `[xrepo: bevox-harness]`

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recount reproduzido EXATO 103/106/80/95/0/0/11)**

- **`openapi-drift-undocumented-handlers` (11 → 7 drift-real + 4 isentos)** `[carry]` **(v: ROUTES)** — **4
  documentados-isentos** por comentário (google/stripe webhooks). **7 drift-real sem isenção**: `GET /customers/{id}/export`
  (`customers/routes.ts:97`), `GET`+`PATCH /autonomy` (`autonomy/routes.ts:18,23`), `GET /channel-connections`
  (`channels/routes.ts:13`), `GET`+`PATCH /payment-account/policy` (`payments/routes.ts:89,95`), `GET /api/v1/realtime`
  (`realtime/routes.ts:26`). Nota de higiene: o comentário de isenção Stripe nomeia só `/webhooks/stripe`, não
  `/webhooks/stripe/platform` (isento-por-inferência). — **2-3h**. **#9.**
- **`no-mechanical-route-zod-openapi-binding` + `openapi-check-is-not-a-validator`** `[carry, ~148 parses]` **(v: ROUTES)** —
  ZERO rotas usam `schema:` do Fastify; sem `ZodTypeProvider`/`serializerCompiler`; ~**148** `.parse()`/`.safeParse()` inline
  em route files; OpenAPI 100% YAML estático → razão estrutural do drift. `pnpm openapi:check` é `openapi-typescript --output
  -` (**gerador de tipos**, não validador — sem spectral/redocly) → exit 0 só prova parse (rodado esta sessão = 0). —
  **M-ALTO** (binding) + **1h** (validador no CI).
- **`error-envelope-dual-schema` / `idempotency-key-param-self-inconsistency` / `status-callback-missing-dead_letter` /
  `enum-create-refund-missing` / `freeform-200-underspec-systemic` / `sse-bearer-only` / `checkout-3-way-divergence` /
  `rate-limit-429-undocumented` / `operationId:0`** `[carry]` **(v: ROUTES)** — `Error`(sem request_id) domina vs
  `ErrorEnvelope`(com, só 7 refs payments) enquanto o handler **sempre** emite request_id (`error-handler.ts:55`); param
  `IdempotencyKey` diz "obrigatória em toda mutação" mas em ~32/52 ops; enum `status` yaml sem `dead_letter` (Zod tem, branch
  vivo `routes.ts:75`); `ExecutionProposal.action` omite `create-refund` (executado `seams.ts:172`) — `send-message` ESTÁ em
  ambos; 200 free-form `additionalProperties:true` (~37); ambos SSE só `Authorization: Bearer` → `EventSource` do browser não
  autentica; `checkout` 3-way (`charge-intent.ts:87,109 [pix,checkout]` vs yaml `[pix]` vs PRD `payment_link`); 429 não
  documentado; operationId:0. — 0,25-2h/ea.
- **`checkout-501-response-undocumented`** `[NOVO, LOW/GA, pilot-inert]` **(v: ROUTES)** — o path de criação de charge emite
  um `501 NOT_IMPLEMENTED` terminal p/ `payment_method=checkout` (`payments/checkout.ts:43` sempre lança, guardado pré-IO em
  `payments/routes.ts:112-113`), mas o yaml documenta **zero** respostas `"501"` (grep=0) — exatamente análogo ao gap do 429,
  e a dimensão response-code do `checkout-3-way-divergence`. Piloto é pix-only (checkout é o stub M5-P5) → inerte. — trivial.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: orquestrador)** — tags só `v1.0.0`/`v1.0.1`;
  `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora (incl. dispatch amendment);
  `release.yml` dispara só em `push tags: ["v*.*.*"]` (sem workflow_dispatch, sem provenance/sbom) → **nenhuma imagem (SemVer
  OU sha) pós-`v1.0.1`**. `describe` = `v1.0.1-36`. Versão diverge **4-way** (`package.json 0.1.0` / `openapi 1.11.0` / tag
  `v1.0.1` / hub `vX.Y.Z`). — **0,5-1h** (cortar tag). `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: orquestrador)** — `src/integration/resolve-organization-id.ts` **NÃO existe**
  (bridge colapsada SP-3) mas é citado como vivo em **~12 lugares** (`README.md:84`, rules `backend-tenancy.md`/
  `backend-routes.md`, `PostToolUse-tenancy.sh`, agent `engineering-backend-architect.md`, `skills/.../SKILL.md`);
  `CLAUDE.md §8 l.171` diz seed grava `PILOTSEEDONLYNOTASECRET` (stale — seed gera base32 + assert + blocklist);
  `backend-harness-contract.md`/`backend-workers.md` dizem `dead_letter` via `worker.on('failed')` (**errado** — é via PATCH
  que o harness nunca manda); `backend-db.md:31` diz `on delete restrict` (código+canon = **cascade**, §11.2 l.1203). —
  0,3-0,5h/ea. (Nota: `CLAUDE.md §1` já diz corretamente que a bridge foi colapsada — a inconsistência é entre `§1` e o
  README/rules.)
- **`rule-backend-routes-staff-role-and-adr-miscite`** `[carry]` **(v: AUTH, canon-corroborado)** —
  `.claude/rules/backend-routes.md:24,33` declara staff roles `bevox_admin|support|observer (canon: ADR-022 staff RBAC)` +
  invoca `requireRole` inexistente: triple-errado (nomes curtos; staff RBAC = **backend/ADR-013**; backend/ADR-022 =
  `policy-json-sub-keys`). — **0,25h**.
- **`canon-status-method-self-contradiction`** `[carry, root-cause]` **(v: L — canon)** — PRD §10.4 formal (l.1076) + arch
  flow (l.817) especificam `PATCH .../status`, mas o sumário de prosa lista os 4 callbacks como `POST` (l.447-450). O
  dispatch-amendment atualizou o contrato formal p/ PATCH mas deixou o sumário POST stale — **provável raiz** do harness
  POSTar. Vai pro **canon** (errata), não a este repo. — `[xrepo: canon]`
- **`stray-gap-workflow-js-scratch-accumulation` / `codeql-upload-never-noop` / `release-no-provenance-sbom` / `adr-number-
  collision-cross-namespace`** `[carry]` **(v: orquestrador)** — **5** `.claude/state/gap*.js` (gap0704/0709/0714/0715/0717,
  gitignored — `git check-ignore` confirma os 5) → **zero impacto em CI** (checkout limpo não os tem); só `pnpm lint`
  **local** dá RED (5 errors). **Esta sessão NÃO adicionou nenhum** (usou Agent tool, não Workflow). `codeql.yml:26
  upload:never`; `release.yml` sem provenance/sbom; ADR 008-023 colidem backend/_shared. — 0,1-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária esta sessão)

- **`legacy-lexicon-clean`** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/`db/`: executável **ZERO**
  (composites + alias `AS account_id` + `res.accountId` Stripe + doc-comments + snapshots). 3 "crus" = doc-comments.
  Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153 generateMfaSecret()` base32 160-bit + `:154
  assertMfaSecretNotPlaceholder`; blocklist `mfa.ts:35` (o sentinel só como comentário `:66`); `auth/service.ts:84-87` sem
  MFA check (correto — TOTP é Marco-3). **NÃO implementar "rejeitar sentinel no login"**. CLAUDE.md §8 stale (doc).
- **`mark-no-show-is-not-a-code-bug`** `[REFUTED, carry]` — OpenAPI serve `/appointments/{id}/no-show` casando
  `routes.ts:125-131`; só a prosa PRD §10.1 l.971 diz `mark-no-show`. **Não re-flagar.**
- **`booking-main-path-exactly-once-sound`** — advisory xact-lock + recount in-lock + unique index + replay 23505
  (`booking.ts:223-263`); POST honra `Idempotency-Key`. **Não flagar.**
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc|pan`=**0**); decimal `numeric(10,2)`; webhooks
  dedupe-aware + org-scoped (cross-tenant paid-flip impossível `webhook-platform.ts:67-73`); over-refund replay-safe
  (`service.ts:515`); ambos webhook-secrets `requiredInProd`; `money-mutation-http-idempotency` by-design (`manual:<id>` +
  ON CONFLICT); `charge_type-drift` espelhado; clerk-webhook svix-verified.
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:65,69,93-95`). Coexiste com o
  token-IDOR (autenticidade ≠ autorização). `idempotency-on-callbacks` **REFUTED** (state-machine, `/complete`→409; o
  harness **manda** `Idempotency-Key` mas o 409 by-design cobre o dedup — não re-flagar como gap).
- **`dispatch-amendment-faithful-to-canon`** — `deadline_ms`/`original_execution_id`/`dead_letter` byte-faithful ao canon
  PRD §10.4 Am1. **Não re-flagar.**
- **`hmac-verification-correct`** — metaapi (`timingSafeEqual`+±300s), Stripe `constructEvent`, Clerk svix, Google
  timing-safe — todos verificam assinatura (o gap metaapi é **ordem**: decrypt antes do HMAC, ver MÉDIO).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer`; `requireStaff({roles})`→403; observer excluído de actions, incluído em reads/SSE; `TEST_AUTH_BYPASS`
  double-guarded (`env.ts:225-231`).
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` é **canon-correto** (§11.2 l.1203); timestamptz
  everywhere; CHECK (`end_at>start_at`, `sessions_remaining>=0`, `confidence∈[0,1]`); `ai_suggestions` dropada em 0005;
  sessions numeric→integer em 0015; ADR-022 policy-json materializada; ADR-023 = 0016; `uuidv7-sql-default` pós-0000 ausente
  é **fail-CLOSED** (`$defaultFn` supre v7). Migrations journal íntegro (21 entradas = 21 `.sql`; 0 `gen_random_uuid`/
  `uuid_generate_v4`).
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (origin/main, verbatim): 10 delivered (aisuggestion,
  staff-rbac, m4-chatwoot-p1..p4, m5-p4-manual-payment, m5-p3c-multimedia-consume, m5-p3a-refundpolicy, m5-p3b-create-refund-
  seam) + `backend-psp-br-secondary` **parked**. **Nenhum work-item** p/ calendar/ADR-010, customer-identity/ADR-009,
  templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker**. Usar esta auditoria como o gate.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do piloto +
1 dos 2 jobs de CI vermelhos**.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia (nem override `extra` resgata, nem módulo onboarding existe) → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) + fechar teardown `closeDb()/closeRedis()` (os 57P01) | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado (HS256) não autentica no calendar (RS256) → gate upstream dos 2 CRÍTICOs |
| 4 | **`pnpm audit`: `zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**50 highs**, incl. o core de validação `zod`) e re-acende o scanner agendado (dark desde 09-22) — completa "CI verde" |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** na fronteira de entrega + CHECK + backfill + teste e2e | **3-4h** | **Pilot-universal via staff-approve**: hoje **100%** das respostas de IA são dropadas em silêncio como `done` |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + `/metrics`+`/healthz` no worker + `w.on('failed')` capturar | **1-2h** | Fecha o buraco-negro (Sentry/OTel/Prometheus) dos **11 workers** que o piloto roda |
| 7 | **Gatear `insertPayment`+side-effects no rows-affected de `markChargePaid`** + lock único por charge (inclui `expireChargeManually`) | **~1h** | Fecha o bug HIGH de dinheiro **irreversível** (re-mark/expire-race órfão) alcançável por Clerk-user no money-path manual |
| 8 | **Anexar `requireRateLimit` (já construído) a `/staff/sessions[/refresh]` + mutators de money + webhooks** + `.min(32)` no `STAFF_JWT_SECRET` + corrigir `expires_in` do token staff | **~3,5h** | Fecha o buraco app-wide de rate-limit (brute-force + DoS pré-HMAC) + o piso de entropia + o bug de contrato `expires_in` do painel staff |
| 9 | **`GET /appointments` (REST, Clerk + staff-ops)** + documentar os 7 handlers drift no OpenAPI + validador OpenAPI no CI | **4-6h** | "Ver agenda" não tem endpoint em plano nenhum (nem OpenAPI); fecha o drift silencioso categoria b |
| 10 | **Aplicar gate `ai_opt_out`/consent + aviso-automático no intake + `dsr_requests`** + hidratar DSR export + torná-lo alcançável pelo ator do piloto | **8-12h** | LGPD (piloto roda com PII real; flag arquiteturalmente ignorado, PII pré-aviso, 5 cópias não-apagáveis, DSR inacessível/não-auditado) |
| — | Higiene batch: `message_id → m.id` (fire-first poison, ~15min) + `buildDispatchMessages` LIMIT; vincular token de callback ao `:id` (IDOR); HMAC-antes-do-decrypt; harness `status` POST→PATCH + errata canon l.447 (cross-repo); StatusHistory + `created_by` + audit de appointment + matriz de transição (`cancelled→confirmed`/`completed→cancelled`); índices FK (~55 + `customers`); versão/tag SemVer (22 commits); docs stale (incl. CLAUDE.md §8); `rm .claude/state/gap*.js`; `amount_total.max`+currency enum; deletar `newOpaqueId`/`verifyStaffRefreshToken`; filtro de org no staff SSE | **~22h** | Contrato harness + agenda-correção + perf GA + LGPD-audit + money-hardening + governança |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status`-callback POST vs PATCH 404 total** (root-cause
  único; backend canon-correto §10.4+ADR-019 Am1; fix harness→PATCH + errata canon l.447); `message_id` não-UUID → ZodError
  **pré-enqueue fire-first** em toda dispatch de IA (MASCARA unbounded + `active_execution_id`-wedge); `buildDispatchMessages`
  sem LIMIT → poison; `aborted_*`→400 (bug harness), `strategy='failed'`→não-`error` (bug backend), skills-allowlist vazio,
  `stream`-field ausente + char-vs-byte, `default_model` (latente), `trace content` descartado, token-IDOR (status-agnóstico),
  `completing`-sem-backstop, orphan `pending`-rows, callback-base-url ignorado, `/complete` tenant não-verificado.
  Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` (`messages/schemas.ts:7`)
  **re-confirmado esta sessão** → `wa`/`ig` do backend causa o drop de outbound (pilot-universal); retries de webhook
  amplificam a perda de inbound (dedupe-poison + null-tenant one-time-500 + unknown-provider-silent-drop + audit-duplicado +
  pre-HMAC amplification).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um
  principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona. A DSR export também é Clerk-only →
  inacessível ao ator semeado.
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`); refund manual não
  passa por webhook; o reconcile de refund Stripe está **DOA (42703), cron-only mas LIVE-wired** (webhook vivo intacto);
  `intent-reconcile` half-applies paid; `reconcile-fifo-starvation`. Escape do piloto: manual-mode (ADR-023 aceita). **MCP
  `stripe` requer auth interativa — indisponível nesta sessão headless** (reportado; não bloqueante p/ auditoria de código).
- **canon (`bevox-knowledge origin/main` @ `7874971`)** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score
  **Opção C vinculante**), backend/ADR-009 (identidade canônica) não-implementadas; _shared/ADR-019 (bases legais → gate
  consent + aviso + captura), _shared/ADR-020 (retenção → scoping de message_records/received_events, `created_at` de
  servidor, retention worker, DSR deletion + `dsr_requests`). Drifts "canon-atrás-do-código" (`/status` POST↔PATCH l.447,
  `create-refund`, `dead_letter` no enum) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra, `origin/master` @ `fd1373b`)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa
  `v1.0.1` (sem os 22 commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem
  principal Clerk); a network-policy do `/metrics` é o único controle do vazamento de org-UUID.
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` desde **09-22** (~5 sem) + slot 10-26 ausente → gate
  agendado dark; causa não-introspectável offline.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs são
  invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-25)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/ db/`
**vazio**; `HEAD` = o commit do próprio audit 10-25 (ontem); `describe` `v1.0.1-36` (era `-35`).

**Ground-truth (mensurável) — 2ª passada consecutiva com delta-zero nos sinais de CI de segurança + fast-gate:**
- **`ci-security` PLATÔ 3ª passada byte-idêntico:** **115 vulns / 10 low / 55 moderate / 50 high** hoje vs 10-25 e 10-24
  (todos **115 / 10-55-50**) → **delta ZERO**. Mesmo conjunto de 19 módulos-high, `zod@4.4.3` permanece. Tendência
  **12→15→18→49³→50→50→50**.
- **`ci-tests`:** RED idêntico (mesmo flaky `booking_notice:259` ~09:04 UTC), com **2× teardown 57P01** (vs 4× no 10-25, 2×
  no 10-24 — ruído recuou, não muda pass/fail).
- **`ci-scheduled-runs-dark`:** janela **inalterada** (dark 09-22→10-20) **MAS possível aprofundamento**: o slot seg-cron de
  hoje (10-26 06:00 UTC) **não produziu run algum** até 09:04 UTC (vs os startup_failure que apareciam antes). 1º sinal de
  "não-agenda" além de "falha-ao-agendar".
- fast-gate GREEN idêntico (Typecheck/Format/OpenAPI-parse/Build+alias-gate/Unit **469/469, 69 files**).

**0 REFUTAÇÕES DE CÓDIGO (5ª passada consecutiva, 10-22..10-26):** nenhum dos 7 agentes refutou um achado de código esta
passada (tentativas adversariais explícitas em AUTH, LGPD, money, harness, schema — todas falharam na evidência). As
2 de-claims LGPD do 10-25 (âncora transitiva de `message_records`; `consent_granted_at` imaterial) **STANDES**. `mark-no-show`
segue REFUTED; `conversations.priority_score` não-inflado (dormante).

**~14 misses/sharpenings NOVOS (todos latentes / by-design-adjacent / governança — nenhum piloto-bloqueador novo):**
1. `staff-token-expires_in-advertises-refresh-ttl` (MÉDIO; AUTH) — **o mais real**: `expires_in`=7d vs access=15min →
   401 silenciosos no painel staff que o piloto usa.
2. `staff-ops-realtime-sse-firehose-unaudited` (MÉDIO/LGPD; AUTH) — `psubscribe("realtime:*")` cross-org, requireStaff-only,
   não-auditado.
3. `audit_events-not-customer-scoped` + `audit_events-has-no-staff-actor-type` (BAIXO/Marco-3; LGPD+AUTH) — o shape de
   `audit_events` impede a extração DSR por-titular e a atribuição a staff.
4. `staff-manual-actions-pii-sink` (BAIXO/GA; LGPD) — jsonb de ação de operador = PII sem customer_id, fora da ADR-020/DSR.
5. `package-session-not-restored-on-cancel-after-complete` (MÉDIO/GA; PILOT) — `completed→cancelled` consome pacote sem
   restaurar.
6. `manual-remark` SHARPENED → `expireChargeManually` **lock-free** → órfão manufaturável desde `pending` (não só re-mark de
   terminal); broadens o HIGH #4.
7. `message_id`-poison SHARPENED → root-cause é **selecionar a coluna errada** (`external_message_id` vs `id`); canon pede o
   PK UUIDv7; e MASCARA os findings unbounded + `active_execution_id`-wedge.
8. `reconcile-fifo-window-starvation` (BAIXO/GA; SEC) — 50 pendings manuais estagnados monopolizam a janela → Stripe nunca
   reconcilia.
9. `poisoned-dispatch-orphans-pending-execution-row` (BAIXO; L) — a ZodError do poison deixa row `pending` nunca varrida.
10. `dispatch-callback-base-url-dead-on-harness-side` (BAIXO; L) — harness ignora o `callback_base_url` per-dispatch.
11. `service-policies-no-org-no-created-at` (BAIXO/config; SCHEMA) — LGPD-imaterial, flagado p/ completude.
12. `customers`-table-**zero-índices** (sharpen do FK-without-index; SCHEMA) — a tabela PII primária é full-scan.
13. `impersonation` SHARPENED → o branch staff de `organization-scope.ts:55-57` é **código morto inalcançável** (nenhuma
    rota pareia requireStaff+requireOrganizationScope) → o bug do `impersonation_id`-como-org-claim é latente, não exploitável.
14. `checkout-501-response-undocumented` (BAIXO/GA; ROUTES) — o path checkout emite `501` (`payments/checkout.ts:43`) mas o
    yaml não documenta nenhum `"501"` (análogo ao gap do 429; inerte no piloto pix-only).

**Correções de linha/contagem:** reconcile vive em `src/modules/payments/reconcile.ts` (não `src/queue/`); `refunds` tem
`createdAt` sem `updatedAt` (comentário `payments.ts:7` admite o adiamento); FK-sem-índice recount = **91 refs / 18 org-FK
unindexed / ≈55 agregado**; worker count = **11** (docstring "4" stale); openapi version = **1.11.0** (4-way drift);
`57P01` = **2×** (era 4×); describe `-36` (era `-35`); `blocklist` do sentinel em `mfa.ts:35` (o comentário em `:66`).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH pilot-universal +
métrica-cega); `manual-remark orphan` (HIGH irreversível, reachability Clerk-user); `reconcile-refund-42703` (cron-only);
`callback-token-IDOR`; `rbac-org-role`; `clerk-provisioning`; os mismatches de `/complete` + o `status`-method 404 +
`active_execution_id` + `message_id`-poison; toda a bateria LGPD; autonomia/observabilidade; priority-score/reminders/
templates Marco-2/3; a staleness `.claude`/CLAUDE.md/README; version-drift (22 commits, nenhuma imagem pós-`v1.0.1`);
scheduled-CI-dark.

**Arco desde a passada mais antiga (06-02):** os **3 CRÍTICOs originais** — (1) telefone/`wa_id` nunca persistido no intake
(hoje recaracterizado como o `outbound-provider-vocab`), (2) `seed-pilot` inexecutável nas imagens de prod (**fechado** — o
Dockerfile-bug foi corrigido ~07-19), (3) zero testes de `calendar/booking.ts` (**fechado** — `calendar-booking.test.ts` tem
8 testes) — foram **fechados/recaracterizados**; os 2 CRÍTICOs atuais (grade + calendar no seed) emergiram ~06-23 e
**persistem há ~4 meses**; o gate auth-actor foi isolado no 07-20 e re-confirmado 9×. A frente de CRÍTICOs está **estável e
sem correção há ~4,8 meses**; nesta passada a dívida de segurança do lockfile re-platôou byte-idêntica (50 high) pela **3ª
vez** e o scanner agendado do GitHub segue dark há ~5 semanas (com o 1º slot "não-agendado" hoje).

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a
**re-verificar de fonte-primária** o inventário do 10-25 do seu domínio contra o **código atual** com evidência fresca
`file:linha`, a **REFUTAR** superestimações (com a lista explícita de refutados/de-escalados a NÃO re-flagar), e a caçar
misses. **5 usaram agent-types locais** deste repo (`.claude/agents/`): `harness-callback-auditor` (l),
`backend-staff-rbac-reviewer` (auth), `backend-schema-migration-engineer` (schema/índices/tracker h), `backend-route-reviewer`
(b), `Security Engineer` (payments j + channels k); **2 general-purpose** (LGPD g; pilot/calendar/obs a+m). **Resultado
agregado: 74 achados de domínio re-confirmados pelos agentes (inventário 10-25 ~95 itens), 0 refutações de código, 14
misses/sharpenings NOVOS.** Tallies por agente: AUTH confirmed=19/new=3; LGPD confirmed=14/new=2; PILOT confirmed=14/new=1;
PAYMENTS confirmed=9/new=2; HARNESS confirmed=8/new=4; SCHEMA confirmed=9/new=1 (+tracker verbatim); ROUTES (OpenAPI b)
confirmed=11/new=1 — recount reproduzido **EXATO** (103 call-sites [=99 routes + 4 webhook-files] / 106 runtime-ops / 80
yaml-paths / 95 yaml-ops / 0 operationId / 0 phantom / 11 undoc; bijeção 106−11=95 verificada ao nível de operação; o único
call-site multi-op é o loop `calendar/routes.ts:131`).

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD -- src/
db/` = vazio; last-commit-touching src/ **e** db/ = `dbd231e` 06-03; describe `v1.0.1-36`); origin/main dos 4 repos (backend
dbd231e / canon 7874971 / harness 2979eb0 / meta-api 5516c2a / hub fd1373b, inalterados — working-trees de meta-api/harness em
branches locais sem mudança de contrato); léxico legado (grep triado = zero executável; 3 crus = doc-comments); PCI-nil (grep
`card_number|cvv|cvc|pan`=0); MFA (seed `generateMfaSecret` base32 + `assertMfaSecretNotPlaceholder` + blocklist; sentinel só
comentário; CLAUDE.md §8 stale); debt (0 FIXME/HACK/XXX, 1 @deprecated, 7 TODO Marco-2/3); version-drift (`merge-base
--is-ancestor dbd231e v1.0.1` = FALSE, 22 commits, 4-way); docs-stale (`resolve-organization-id.ts` ABSENT + ~12 citações);
PRD §16.1 l.1483 CI-verde (lido de origin/main — o working tree da canon está numa feature branch `fix/a14-...`);
ADR-statuses (010/013/014/018/019/020/021/022/023 aceita, 016 proposed, 011 superseded); CI workflow gates (ci.yml 4 jobs sem
continue-on-error + services pg16/redis7; security.yml osv + `pnpm audit --audit-level high` continue-on-error:false +
seg-cron; codeql.yml ter-cron + upload:never; release.yml `tags v*.*.*` sem provenance/sbom); worker count (**11** `new
Worker` + 0 telemetry-init em queue/); os achados-âncora (prof_schedules writer=só test:120; seed-pilot 4 inserts;
requireRateLimit 0 callers; `message_id` vs `external_message_id`; reconcile `refunds` sem `updated_at`;
`claimTimedOutExecutions` varre 3 status não `pending`/`completing`; `upsertChannelConnection` 1 caller;
`expireChargeManually` lock-free; GET-appointment grep=0).

**Ground-truth de CI rodado de fato** (2026-10-26 ~09:00–09:20 UTC): Typecheck ✓ (exit 0) / Format ✓ (exit 0) / Build ✓ (exit
0, incl. alias build-gate) / OpenAPI-parse ✓ (exit 0) / Unit ✓ (**469/469, 69 files**) = **GREEN**; `test:integration` = **RED
exit 1** (`1 failed | 92 passed (93)`, flaky `booking_notice:259` ~09:04 UTC < 13:00 + **2× teardown 57P01**); `pnpm audit
--audit-level high` = **RED exit 1, 115 vulns / 50 high** (10 low · 55 moderate · 50 high · 0 critical; 19 módulos; byte-
idêntico ao 10-25 e 10-24); `lint` = RED por artefato local (5 `.claude/state/gap*.js` gitignored → CI GREEN; 0 adicionados
esta sessão); `pnpm openapi:check` = exit 0 (mas é parse-smoke, não validador). **Estado GitHub:** `gh run list --branch
main` → scheduled runs em `startup_failure` (0s) 09-22→10-20 (último run real 09-21); slot 10-26 06:00 UTC ausente até 09:04.

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree numa feature branch
(`fix/a14-bevox-meta-api-ig-callback-spec` @ `0317985`) mas **`origin/main` @ `7874971` (06-03)** — leu-se `origin/main` para
PRD/ADRs/delivery-tracker. Numeração de ADR **colide** entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner / CodeQL
não reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta reais) não
exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de writers/endpoints +
CI rodado (incl. 14 suítes de integração live Postgres+Redis). (4) MCP `stripe` + `claude.ai Google Drive` requerem auth
interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5) Esta passada é re-verificação sobre
código byte-idêntico ao do 10-25; o valor incremental é **CI fresco (delta-zero no Security byte-idêntico 3ª vez + fast-gate
GREEN + Tests RED idêntico com 57P01 recuado 4→2; scheduled-dark inalterado MAS com 1º slot não-agendado hoje) + 0 refutações
de código (5ª passada) + ~14 misses/sharpenings NOVOS (2 de valor real: `expires_in`-bug + `expire`-lock-free) + as 2
de-claims LGPD STANDES + correções de linha/contagem**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-26. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
