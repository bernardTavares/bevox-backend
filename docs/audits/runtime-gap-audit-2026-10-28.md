# Gap Analysis — bevox-backend — 2026-10-28

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo segundo a
> documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais — `harness-callback-auditor`,
> `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`, `backend-route-reviewer`, `Security Engineer` —
> + 2 `general-purpose` para LGPD e pilot/calendar/obs), cada um re-verificando **de fonte primária** o inventário do
> 10-27 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** adversarialmente (≥2
> por domínio) + caçar misses; **verificação independente de fonte-primária pelo orquestrador** (freeze, CI, canon
> `origin/main`, governança, léxico, PCI, MFA, debt, version-drift); e **CI rodado de fato** (2026-10-28 ~09:10 UTC,
> não inferido). Sucede `runtime-gap-audit-2026-10-27.md`.

## Resumo executivo

**16ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,9
meses.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é **vazio** (produto byte-idêntico a `dbd231e`,
2026-06-03; `git describe` = `v1.0.1-38-g7973a17`, o `-38` são commits de audit docs-only — era `-37` no 10-27).
Canon `bevox-knowledge origin/main` @ `7874971`, `bevox-harness origin/main` @ `2979eb0`, `bevox-meta-api origin/main`
@ `5516c2a`, hub `bevox-PRD-consolidation origin/master` @ `fd1373b` — **todos inalterados vs 10-27**. Os 7 auditores +
o orquestrador **confirmaram o inventário do 10-27 com ZERO refutações de código (7ª passada consecutiva, 10-22..10-28)**:
o código faz **verbatim** o que cada âncora afirma. Mas esta passada é claramente uma **passada de RE-CALIBRAÇÃO**:
**~14 de-escalações de alcance/severidade** de itens carregados + **~6 refutações adversariais de claims-novos-plausíveis**
(evidência negativa fresca) + **~18 misses NOVOS** (quase todos latentes / by-design-adjacent / governança — **3 de valor
real alcançáveis no piloto**), além de várias correções de linha/contagem.

**Principais riscos (inalterados):** o piloto **morre no passo 2 ("ver agenda")** — não é executável como semeado. O
veredito dos 7 auditores é unânime: **login → OK; ver-agenda → 1ª FALHA DURA = 401 auth-actor** (seed cunha JWT staff
HS256; todo calendar/money exige Clerk RS256). Atrás desse gate, dois CRÍTICOs de agenda persistem há ~4 meses (grade
semanal sem escritor app-wide + seed sem Calendar → **quadruple-gated**). O money-path manual **funciona** (ADR-023
aceita) mas carrega 1 bug HIGH **irreversível** (re-mark órfão) — e esta passada **confirma a raiz estrutural única**
dele mas **de-escala** o alcance (só o manual é externamente manufaturável; o path Stripe **não** é — dedupe por
`event.id`). E o único bloqueador **mensurável** de Marco-1 pelo canon (PRD §16.1 l.1483 "CI verde") segue **RED** em 2
dos 3 sinais.

**Manchete-delta — o platô de segurança QUEBROU (no nível de contagem), tudo o mais estável:**
- **Security:** `pnpm audit --audit-level high` = **RED, 120 vulns / 10 low · 58 moderate · 52 high · 0 critical** →
  **+5 total / +2 high / +3 moderate vs o 115/50-high que segurou 4 passadas (10-24..10-27)**. O conjunto de
  **módulos-high é byte-idêntico (os mesmos 19, 5ª passada no nível de módulo)**: novas advisories acumularam sobre
  pacotes **já presentes** no lockfile congelado — não há dependência nova. Per-módulo-high hoje: `undici`=10,
  `brace-expansion`=10, `fast-uri`=7, `fastify`=4, `@grpc/grpc-js`=3, `js-yaml`=3, `nanoid`=2, `protobufjs`=2, +11×1
  (`@fastify/static`, 4×`@opentelemetry/*`, `find-my-way`, `postcss`, `source-map-js`, `tmp`, `vite`, `zod`). **`zod@4.4.3`
  direct-prod** (exaustão-memória `<4.6.6`) permanece; `fastify@5.8.5` core carrega 4 highs (incl. *authentication bypass*
  / *request validation bypass*). **Tendência high: 12→15→18→49³→50⁴→52.** Prova estrutural: num lockfile congelado a
  dívida de segurança **cresce monotonicamente** com a base de advisories, mesmo sem mudança de código.
- **Tests:** `pnpm test:integration` = **RED exit 1**, `1 failed | 92 passed (93)` (`Test Files 1 failed | 13 passed (14)`)
  — o mesmo flaky dependente de hora-do-dia `calendar-booking.test.ts:259` (rodei 09:10 UTC < gate ~13:00 UTC → `booked`),
  **com 2× unhandled `57P01`** ("terminating connection due to administrator command" — ruído de teardown testcontainers,
  idêntico ao 10-26/10-27). Fast-gate **GREEN idêntico** (Typecheck/Format/OpenAPI-parse/Build+alias-gate ✓; Unit
  **469/469, 69 files**).
- **scheduled CI:** todo run `schedule` em `main` (Security seg-cron `0 6 * * 1`; CodeQL ter-cron `0 6 * * 2`) segue em
  **`startup_failure` (0s)** ininterrupto **09-22 → 10-27** (último = CodeQL slot 10-27 às 11:14 UTC). **Hoje (10-28) é
  quarta → nenhum slot cron vencia**; último run agendado que executou de verdade = Security `failure` 09-21 (CodeQL
  success 09-15). ~5 semanas sem scanner agendado real.

**Os 3 misses NOVOS mais consequentes (alcançáveis no piloto; entendimento mais fundo sobre código congelado):**
1. **`idempotency-required-header-unenforced` (ROUTES):** `POST /charges/manual` (`payments/routes.ts:284` — **o caminho de
   dinheiro do piloto**) lê `idempotency-key` (`:286`) **sem checar presença/vazio**, enquanto o OpenAPI declara o header
   `required:true, minLength:1` (`openapi:94-102`). Sem binding mecânico Zod↔rota (ZodTypeProvider=0), o header
   spec-obrigatório é **opcional em runtime** → **charges `pending` duplicadas no retry do cliente** — exatamente o que o
   `required:true` promete evitar. **PILOTO-ALCANÇÁVEL.**
2. **Dois "cardinality bombs" de Prometheus pré-auth** alimentando o `/metrics` **não-autenticado**: (a) `event_type` do
   webhook metaapi é `/^raw\.[a-z_]+\.[a-z_]+$/` (`channels/metaapi/schemas.ts:31`, `[a-z_]+` **ilimitado**) e vira
   **label de Counter** no path de **assinatura-inválida pré-auth** (`routes.ts:168`, `metrics.ts:63-66`); (b) o label
   `route` do HTTP cai para o **path cru** em requests 404/unmatched (`bootstrap/server.ts:163` `routeOptions?.url ??
   req.url`). Ambos permitem a um atacante **não-autenticado** inflar o registry sem limite → exaustão de memória /
   falha de scrape, **compondo** o vazamento de org-UUID do mesmo `/metrics` (enumeração ADR-021). **A security agent
   DE-ESCALOU** o `pre-HMAC DB amplification` (MÉD→LOW; leituras O(1)) e **redirecionou o DoS pré-auth real para estes
   dois bombs.** **PILOTO-ALCANÇÁVEL (não-autenticado).**
3. **`ig-inbound-silent-nondispatch` (cross-repo CHANNELS):** meta-api `origin/main` envia Instagram como
   `data = { messaging: [...] }` (`inbound/service.ts:246-249,382`), mas o backend `detectProvider`/`extractIds` chaveiam
   em `recipient.id`/`sender.id` **top-level** (`channels/metaapi/normalize.ts:37-43`) → IG vira `"unknown"` → o guard de
   dispatch (`routes.ts:240`) falha → o evento é persistido + auditado + 200, **mas nunca semeia channel_connection, nunca
   escreve message_records, nunca enfileira dispatch de IA → 100% do inbound IG descartado em silêncio.** Mecanismo
   **distinto** do vocab-drop de **outbound** `wa`/`ig`; os dois canais têm bugs 100%-drop independentes. **PILOTO-alcançável
   se IG for semeado.** `[xrepo: bevox-meta-api]`

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária esta sessão (repetem-se vs 10-27 porque o brief é o mesmo; +1 nova):

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`) — **não** `/complete,/artifact,/tool-result,/turn`
   como o brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (**aceita**, lido de `origin/main`), **não "channels"**.
   **Channels = _shared/ADR-011.** backend/ADR-018 = refund/cancellation (**aceita**). O range "0011 a 0018 Marco-1" do
   brief é aproximado; as ADRs aceitas **vinculantes** vão até 0023 (009/010/013/014/018/019/020/021/022/023 = `aceita`;
   016 token-billing = `proposed` → corretamente NÃO implementado; 011 = `Superseded by ADR-019`).
3. O grep `account_id\b` do brief captura centenas de ocorrências em `src/`/`db/`, **todas sancionadas** (composites
   `external_account_id`/`payment_account_id`/`channel_account_id`, alias `AS account_id`, propriedade Stripe
   `res.accountId`, doc-comments, snapshots drizzle). O léxico proibido **executável** é **ZERO**; os **3** hits crus de
   `workspace_id`/`workspaces` são **doc-comments** explicando o rename (`autonomy/routes.ts:5`, `organizations/routes.ts:3`,
   `db/schema/autonomy.ts:3`). Invariante §4.1 mantida — **não-gap**.
4. **MFA sentinel (categoria d) — não há bug a corrigir** (verificado firsthand). `scripts/seed-pilot.ts:153` chama
   `generateMfaSecret()` (base32 160-bit) + `:154 assertMfaSecretNotPlaceholder()` e grava um secret **real** (`:165`); o
   sentinel `PILOTSEEDONLYNOTASECRET` só aparece como entrada de **blocklist** (`src/shared/mfa.ts:66`). Login staff sem
   MFA é **correto** (TOTP é Marco-3, PRD §16.3/ADR-013; `auth/service.ts:86`). **NÃO implementar "rejeitar o sentinel
   antes do JWT"** (travaria todo login de staff semeado; é moot pois o seed não grava mais o sentinel). Fix de código =
   **0h**; o único resíduo é a prosa de **`CLAUDE.md §8 l.171`** (factualmente stale — ainda afirma que o seed grava
   `mfa_secret = PILOTSEEDONLYNOTASECRET`). Vai pro doc, não é bug.
5. **A premissa da categoria i do brief está stale.** O brief diz "Tests (harness-contract FK seeding, issue #36)" e
   "Lint & Format (prettier debt)". Ambos **resolvidos**: `pnpm format:check` = **GREEN**; o Tests-RED atual é o flaky
   `booking_notice:259` (hora-do-dia) + 2× teardown `57P01`, **não** #36. O lint-RED é **só local** (5 arquivos
   `.claude/state/gap*.js` gitignored → `git check-ignore` confirma os 5; **0 adicionados** nesta sessão) → **CI-GREEN**
   (checkout limpo não os tem).
6. Código congelado desde **06-03** (`dbd231e`), não 06-04. **RBAC de staff é canon backend/ADR-013** (roles
   `bevox_admin|bevox_support|bevox_observer`), **não ADR-022** (backend/ADR-022 = `policy-json-sub-keys`). Numeração de
   ADR **colide** entre `backend/` e `_shared/` (008–023) — sempre qualificada abaixo.
7. O `status`-callback **não é** drift de OpenAPI: é **PATCH** no YAML **e** no handler (`routes.ts:56`) — concordam. A
   quebra POST-vs-PATCH é **cross-repo** (harness POSTa) — categoria l, não b.
8. **NOVO — o path do metaapi é `src/modules/channels/metaapi/`**, não `src/modules/metaapi/` (correção de citação de
   passadas anteriores; a estrutura em disco foi re-verificada esta sessão).

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1481-1487)** — lido verbatim de `origin/main`: `[ ]` repo criado + **CI
  verde**; migrations em pg16; módulos auth/organizations/users/professionals/services/customers; OpenAPI publicado;
  contrato harness documentado+testado com stub; deploy staging via Docker Compose. **Tudo entregue EXCETO "CI verde"** →
  o único bloqueador **mensurável** de Marco-1 é **CI-verde** (RED em Tests + Security).
- **§16.3 Marco-3** inclui payments Stripe Connect, reminders, **LGPD DSR/retenção/consentimento**, **MFA TOTP**,
  observabilidade completa. Os CRÍTICOs de agenda são **Marco-2/3-por-rótulo mas pilot-blocking**; o README "Marco 1
  bootstrap" **subdeclara** o que o código entrega (calendar + payments-manual + worker assíncrono). **"Marco-1
  concluído?" ≠ "piloto-pronto?".**
- **Status de ADR (origin/main, re-lido):** backend/ADR-009/010/013/014/018/019/020/021/022/023 = **`aceita`**;
  backend/ADR-016 (token-billing) = **`proposed`**; backend/ADR-011 = **`Superseded by ADR-019`**. _shared/ADR-019 (bases
  legais LGPD) + _shared/ADR-020 (retenção) = **aceitas 2026-04-23**. ADR-010 (calendar) e ADR-009 (customer-identity) são
  **aceitas** → os 2 CRÍTICOs são escopo aceito, não especulativo.

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-28) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO app-wide); `StatusHistory`+`OperationalMetricSnapshot` (Módulo 16, grep=0); `appointments.created_by_*`/`confirmed_at` **colunas inexistentes** (§8.3/§8.4; comentário `payments/repository.ts:922-924` admite); ADR-020 templates + ADR-021 priority-score (Opção C **vinculante**) não-materializados |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recount reproduzido **EXATO**: `103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 / 11 undoc`; bijeção 106−11=95 verificada; inline `.parse` corrigido **≈148→160** (claim mais forte); `mark-no-show` REFUTED; **NOVO** `idempotency-required-header-unenforced` (pilot-money) |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO**; 3 "crus" = doc-comments |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | seed gera base32 160-bit + assert; sentinel só blocklist; login sem MFA = correto (Marco-3); **`CLAUDE.md §8 l.171` stale**; fix de código = 0h |
| e | Testes faltando (hot paths) | ✅ | webhook Stripe (`constructEvent`=0 em test/); reconcile só unit mockado (→ 42703 CI-invisível); transition/reschedule **não testados** (docstring `calendar-booking.test.ts:18-22` admite "outro PR"); `getAvailableSlots` não testado; `seed-pilot.test` **false-green** (`TEST_AUTH_BYPASS_ENABLED=true`, assere só org/staff/prof/svc) |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); **~4** TODO reais (grep bruto=11 incluindo "TODOS"=all + prosa), todos Marco-2/3 |
| g | LGPD | ✅ | ingestão PII **ungated** pré-aviso vs rights-path **RS256-gated** (inalcançável no piloto HS256); **5** cópias de PII inbound cruas; único PII ao LLM = `content_text`; **zero** artefato de base-legal/consentimento persistido; **NOVO** DSR export **omite telefone+channels** (vazio p/ a população real); **NOVO** `customers` sem **nenhum** path de erasure (nem o soft-delete desenhado tem writer) |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main, verbatim, **sem drift**); **nenhum** work-item p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker** |
| i | CI vermelho | ✅ (rodado 09:10 UTC) | Tests RED (flaky `booking_notice:259` + 2× `57P01`) + Security RED **52 high / 120** (**platô QUEBROU no nível de contagem**, mesmos 19 módulos); fast-gate GREEN (469/469); lint-RED = 5 `gap*.js` gitignored (**0 adicionados**) → CI-GREEN; scheduled dark **09-22→10-27** (sem slot hoje, quarta) |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + irreversível** (pilot-reachable via Clerk); raiz estrutural ÚNICA confirmada (`repository.ts:395-413` void-returns) + **DE-ESCALADO: path Stripe NÃO externamente manufaturável** (dedupe `event.id`); `expireChargeManually` **sem `withRedisLock`** (único dos 3 manuais) + audita-falso; `reconcile-refund-42703` cron-only; PCI-nil (grep=0) |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH pilot-universal** (outbound); **NOVO `ig-inbound-silent-nondispatch`** (100% IG inbound dropado, cross-repo); **NOVO `event_type` cardinality-bomb** (DoS pré-auth); `metaapi-audit-duplicate-on-retry`; `pre-HMAC amplification` **DE-ESCALADO MÉD→LOW** (O(1)); HMAC correto |
| l | Harness dispatch | ✅ | `message_id`-poison **pilot-reachable, CAUSA inércia do harness**; `status`-callback **POST↔PATCH 404 total** (root-cause único); token-IDOR status-agnóstico; **`/stream` DE-ESCALADO** (wired-but-config-gated, não "desligado") → só `/traces` é genuinamente sem-produtor; **NOVO `proposal-missing-idempotency_key`** (2º dominó atrás do message_id-poison); `/complete` bodyOrgId **DE-ESCALADO** (inerte, harness não envia org) |
| m | Alçapões do piloto | ✅ (traçado) | veredito unânime dos 7: **quadruple-gated**, 1ª falha = **401 auth-actor**; money-path manual OK (Clerk-user) + bug HIGH irreversível + **NOVO** duplicate-charge via idempotency-unenforced; worker buraco-negro **DE-ESCALADO** (Sentry-off + Prometheus-unscrapable, **logs Pino sobrevivem**) |
| n | Delta vs audit anterior | ✅ | 10-27 re-verificado; **0 refutações de código (7ª passada)**; **~14 de-escalações** + **~6 refutações adversariais** + **~18 misses NOVOS**; Security **+2 high** (platô quebrou); Tests/scheduled idênticos |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária por 7
auditores; veredito unânime = NÃO executável como semeado, 1ª falha dura no passo 2:**

1. **LOGIN (staff) — PASSA mecanicamente.** `seed-pilot` cria org + `bevox_admin`; `loginStaff` (`auth/service.ts:64-90`)
   é password-only (MFA seam presente não-enforced `:84-87`); cunha JWT staff **HS256** (`staff-auth.ts:70`). **Sem
   rate-limit/lockout** (`auth/routes.ts:90` sem preHandler; `requireRateLimit` 0 callers — note que impersonation routes
   `:106,:125` **têm** preHandler, login/refresh não).
2. **VER AGENDA — 1ª FALHA DURA = 401 (auth-actor).** `GET .../availability` (`calendar/routes.ts:48`) é gated por
   `requireClerkAuth` (`:22`) que aceita **só RS256** (`clerk-auth.ts:90`). O único principal semeado é staff **HS256** →
   `requireClerkAuth` lança `unauthenticated` (401) **no preHandler, antes do handler**. **Quadruple-gated:** `401
   auth-actor` → (se corrigido) `404 no-calendar` (`availability.ts:75`, **CRÍTICO-2**) → `grade vazia app-wide`
   (`availability.ts:116,:126`, **CRÍTICO-1**). Book/charge/reconcile inalcançáveis a jusante.
3. **AGENDAR — BLOQUEADO a jusante.** **Main-path exactly-once É SÃO** (advisory xact-lock + recount in-lock + unique index
   + replay 23505, `booking.ts:223-263`; POST honra `Idempotency-Key`) — e é o **único** path que os testes cobrem.
   Reschedule/transition têm ~8 defeitos de correção (incl. `cancelled→confirmed` over-book + `completed→cancelled`
   não-restaura pacote), **não-testados por admissão do autor**.
4. **COBRAR — money-path manual FUNCIONA (via Clerk-user; não hands-off-seedável).** Serviço semeado sem `requiresPrepayment`
   + `seed-pilot` não cria `payment_accounts`. **1 bug HIGH irreversível** re-mark de charge terminal; **NOVO**
   duplicate-charge via `idempotency-required-header-unenforced`; overflow 500 em `amount_total` ≥ 1e8.
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile cru
   `half-applies paid`; reconcile de refund DOA (42703) — cron-only mas live-wired; manual não afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[SHARPENED]`/`[NARROWED]`/`[DE-ESCALADO]`/`[REFUTED]` = status vs 10-27; **(v: …)** =
verificação; `[xrepo]` = dependência cruzada. Severidade ancorada no gate do **piloto**; escalonamento p/ GA anotado.
`file:linha` = evidência lida **nesta** sessão sobre código byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO ×3 — SCHEMA + PILOT + orquestrador)** — Nenhum caminho
  do app escreve `professional_schedules` (grade semanal-base; tabela `db/schema/calendar.ts:41-62`, DB-real desde `0008`).
  Único `INSERT` app-wide = fixture SQL cru `seedFullSchedule` (`test/integration/calendar-booking.test.ts:119-124`); **zero
  `INSERT`/`UPDATE` em `src/` ou `scripts/`** (grep: só o SELECT `availability.ts:116`). `createScheduleOverride`
  (`calendar/repository.ts:78`, wired `routes.ts:43-44`) escreve `professional_schedule_overrides`, não a base.
  `availability.ts:126 if(!sched) continue` executa **antes** da leitura do override `extra` (`:128`) → o único writer de
  capacidade nunca resgata um profissional sem row base → **sem escape-hatch**. Não existe `src/modules/onboarding/` apesar
  do `onboarding_stage_enum` ter valor `schedule` (`_shared.ts:44`). Escopo backend/ADR-010 **aceita**. — Impacto: 100% dos
  agendamentos = `slot_conflict`, app-wide. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (seedar grade). **#1.**
  `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO ×2 — SCHEMA + PILOT)** — `seed-pilot.ts` importa só
  organizations/staffAccounts/professionals/services (`:33-35`) e tem exatamente **4** `.insert(`: organizations (`:110`),
  staffAccounts (`:157`), professionals (`:195`), services (`:217`). Zero `calendars` → `availability.ts:75
  notFound("Calendar")`. `createCalendar` existe (`calendar/repository.ts:20`) e está route-wired (`routes.ts:38`); o gap é
  "o seed nunca o chama e não há bootstrap não-HTTP". `professional_services` também não é semeado → fallback "todos
  bookáveis" (`availability.ts:91-96`). `system_holidays` omitido é **fail-open** (`:108-111`), não co-bloqueador. — Esforço:
  **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×3 — PILOT + AUTH + grep)** — seed provisiona
  **só** org + `staff_account` (HS256, `staff-auth.ts:70`); toda rota de calendar/money é `requireClerkAuth()` RS256
  (`calendar/routes.ts:22,48`; `payments/routes.ts:51,53,59`; `clerk-auth.ts:90` pin RS256 + claim org) → token staff
  rejeitado 401. `grep requireStaff|requireRole src/modules/calendar src/modules/payments` = **0**; o seed não cria usuário
  Clerk nem row `users` (único INSERT em `users` app-wide = `auth/repository.ts:236`, só via webhook Clerk `user.*`).
  **1ª falha dura do piloto, confirmada por todos os 7 auditores.** — Esforço: ops (Clerk) OU ~4-6h (rota calendar
  staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-28; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice`** `[carry]` **(v: RODADO 09:10 UTC)** — `pnpm test:integration` = **RED exit 1**,
  `1 failed | 92 passed (93)` (`Test Files 1 failed | 13 passed (14)`). Falha = `calendar-booking.test.ts:259` "retorna
  slot_conflict quando start_at < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be 'slot_conflict'`
  — o gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei 09:10 UTC → `booked`. **Com 2× unhandled `57P01`** (teardown
  testcontainers/ioredis, não muda pass/fail). `ci.yml` (job `Tests`) roda `pnpm test` + `pnpm test:integration` com
  pg16+redis7, **sem** `continue-on-error`. — Esforço: **0,5h** (slot `now()`-relativo + fechar `closeDb()/closeRedis()`).
  **#2.**
- **`ci-security-red-pnpm-audit-52-high`** `[carry, PLATÔ QUEBROU no nível de contagem]` **(v: RODADO)** — `pnpm audit
  --audit-level high` = **RED exit 1, 120 vulns (10 low · 58 moderate · 52 high · 0 critical)** — **+5 total / +2 high /
  +3 moderate vs 10-24..10-27 (115/50h)**. **Conjunto de módulos-high byte-idêntico** (os mesmos 19; `undici`=10,
  `brace-expansion`=10, `fast-uri`=7, `fastify`=4, …) → novas advisories sobre pacotes **já presentes**. `zod@4.4.3`
  direct-prod permanece; `fastify@5.8.5` core carrega 4 highs (auth-bypass/validation-bypass). Highs prod-runtime:
  `fastify`, `find-my-way`, `fast-uri`, `@grpc`/`@opentelemetry/*`, `protobufjs`, `zod`. `security.yml` → osv-scanner +
  `pnpm audit --audit-level high` **`continue-on-error: false`** → hard-fail. **Tendência 12→15→18→49³→50⁴→52.** — Esforço:
  **4-6h** (`pnpm add zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override`
  undici/tmp/vite/fast-uri/nanoid/brace-expansion). **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[carry]` **(v: orquestrador — `gh run list`)** — todo run `schedule` em `main`
  (Security seg-cron; CodeQL ter-cron) termina em **`startup_failure` (0s)** ininterrupto **09-22 → 10-27** (último =
  CodeQL slot 10-27 às 11:14 UTC). **Hoje (10-28) é quarta → nenhum slot cron vencia** (consistente, não é regressão); último
  run agendado que executou de verdade = Security `failure` 09-21 (CodeQL success 09-15). Gate de segurança agendado **nem
  roda nem alerta** há ~5 semanas. Causa não-introspectável offline (billing/quota Actions, action-ref, ou política de org).
  **Nota de governança:** os commits de audit são **locais** (`main ahead 16`, nunca pushados) → `ci.yml`
  (Lint/TS/Tests/Build, push/PR-triggered) **não roda** nos commits de audit; o "CI verde" só é aferível localmente. —
  Esforço: **0,2h** (re-enable). `[xrepo: GitHub Actions]`

**Auth / rate-limit — buraco app-wide**

- **`rate-limit-plugin-dead-app-wide`** `[carry]` **(v: CONFIRMADO ×3 — AUTH + ROUTES + orquestrador)** — `requireRateLimit`
  tem **zero callers** (só `rate-limit.ts:4` doc, `:146` decorate, `global.d.ts:66` tipo). `@fastify/rate-limit@^10.3.0`
  declarada (`package.json:37`) mas **nunca importada/registrada** (grep `@fastify/rate-limit src/` = 0); o plugin custom
  registrado (`bootstrap/server.ts:134`) apenas **decora** o opt-in — **nenhuma rota o anexa** (login/refresh, money,
  webhooks). Login staff (`auth/routes.ts:90`) sem preHandler → brute-force online ilimitado (bcrypt cost-12 único freio).
  **Corolário ROUTES (v):** por isso **nenhuma rota emite 429** → o "429 undocumented" é **moot** (DE-ESCALADO). — Piloto
  baixo (1 admin). — Esforço: **~1h**. **#8.**
- **`staff-jwt-secret-no-min-length` + `secret-refine-presence-only-sistêmico`** `[carry]` **(v: CONFIRMADO ×2 — AUTH +
  orquestrador)** — `env.ts:60 STAFF_JWT_SECRET: optionalString` (sem `.min()`); `staff-auth.ts:70` assina HS256. O refine
  `requiredInProd` (`env.ts:181-213`) é **presence-only** (`if (!val[key])` `:206`) para a lista de **19** secrets (contada:
  `:184-204`) — incl. `AEAD_MASTER_KEY`, `GOOGLE_TOKEN_ENC_KEY`, `STRIPE_SECRET_KEY`, `META_API_PRIVATE_KEY_PEM`; **nenhum**
  recebe validação de comprimento/formato no boot. O `AEAD_MASTER_KEY` (AES-256-GCM que decripta secrets de canal) é validado
  **lazy** só no 1º uso (`lib/aead.ts:19-26 hex 32 bytes`) → chave mal-configurada **sobe limpa** e falha só no 1º decrypt
  (path do webhook metaapi). O mesmo `STAFF_JWT_SECRET` assina o `state` JWT do Google OAuth **mas** com audiences distintas
  (ambas verificadas) → sem replay; risco = piso de entropia compartilhado. — Esforço: **0,5-2h**. **O buraco de auth mais
  duro no piloto (HS256 staff).**
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — AUTH, canon-reforçado ADR-013:143)** — `requireRole` é
  **vaporware**: só 3 comentários-prosa (`clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`); **não declarado**
  no `FastifyInstance` (`global.d.ts:52-70` lista os 6 decorators reais). `clerk-auth.ts:109 role = … ?? "member"` (default
  **fora** do enum DB `owner|admin|operator|professional_viewer`). Rotas cliente mutantes têm só
  `requireClerkAuth+requireOrganizationScope` → qualquer JWT org-member roda tudo intra-org (org-scope ainda bloqueia
  cross-org). Canon ADR-013 l.143 manda middleware rbac (status `aceita`). Blast-radius **nulo no piloto** (plano staff). —
  Esforço: **1-2d**. `[xrepo: backend/ADR-013]`
- **`impersonation-audit-trail-absent` + `impersonation-audit-writes-zero-rows`** `[carry + NOVO sharpen]` **(v: CONFIRMADO —
  AUTH)** — O hook de audit (`auth/routes.ts:70-87`) vive no plugin encapsulado `authRoutes` (`server.ts:198`); staff-ops é
  registrado como plugins **irmãos** (`server.ts:213-215`) → encapsulamento Fastify → o hook **nunca dispara** nas ações
  staff-ops; estas **são** auditadas (`actions.repository.ts:174-184`) **mas** gravam `actor_type='user'`, `actor_id=NULL`,
  sem `impersonation_id` (id de staff só em `after_json.actor_staff_id`). **NOVO sharpen (v: AUTH) — o "catch-all" de audit
  de impersonation produz ZERO rows em qualquer path alcançável:** no `start`, o token de entrada ainda **não tem**
  `impersonation_id` (cunhado no handler) → guard `:72` falso; no `end`, `endImpersonation` (`service.ts:153`) seta
  `ended_at` **antes** do hook → `findActiveImpersonation` retorna null → early-`return` (`service.ts:183`). Só os eventos
  dedicados `impersonation.start/end` disparam; a cobertura "qualquer outra ação" é **vácua** (audit theater). — Esforço:
  **1-2d**. `[xrepo: ADR-013]`
- **`staff-ops-getWindow-crossorg-PII-unaudited`** `[NOVO]` **(v: CONFIRMADO — AUTH)** — `GET /api/v1/staff/windows/:id`
  (guard = todos `STAFF_ROLES` incl `bevox_observer`, `read.routes.ts:19`) → `getWindow(orgId?, id)`: com `organization_id`
  omitido, `read.repository.ts:112` **dropa o filtro de org** e busca a window de **qualquer** org por id, depois `:116-118`
  `SELECT * FROM message_records` (conteúdo cru de mensagem = PII) por `conversation_key`; nenhum read grava `audit_events`.
  O role menos-privilegiado pode ler PII **cross-tenant** sem trilha de audit. Mesmo padrão `undefined→all-orgs` em
  `listExecutions:52`, `listAuditEvents:219`, `organizationHealth:191`, `dashboardOverview:13`. **Piloto: o `bevox_admin`
  semeado alcança o read cross-org não-auditado; a escalada por observer é latente até semear 2º role.** — Esforço: M.
  `[g/accountability]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO — AUTH)** — `auth/repository.ts:217-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id) +
  `routes.ts:169-170 orgClaim = organization_id ?? clerkUserId`; `upsertUserFromClerk` hardcoda `role='operator'` (`:238`);
  webhook só trata `user.created|updated|deleted`, sem `organization.created` → paradoxo de bootstrap. É o **porquê** de não
  existir row `users` (alimenta o gate auth-actor). — Esforço: **4-8h** (+ADR org-mapping). `[xrepo: Clerk]`
- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry, pilot-universal]` **(v: CONFIRMADO ×2 — SEC + orquestrador;
  "defeito confirmado mais danoso do outbound")** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"`
  (`channels/metaapi/normalize.ts:35,44`) e persiste em `channel_connections.provider` (`routes.ts:246-252` → coluna
  `notNull()` **sem CHECK** `db/schema/channels.ts:22`). `upsertChannelConnection` tem **exatamente 1 caller** (`routes.ts:246`)
  e é o **único INSERT** em `channel_connections`; o UPSERT nunca atualiza `provider` (`channels/repository.ts:73-77`) →
  provider é **estruturalmente sempre `"wa"`/`"ig"`**. Outbound `findExecutionDeliveryContext` null-coage provider ≠ pleno
  (`metaapi/repository.ts:197`) → `ctx.provider=null` → guard `executions/seams.ts:360` → `skipped_missing_recipient`
  (`:376`); `isDeliveryFailure` exclui skips (`:122-124`) → `complete-service.ts:100` fica `done` (**falso-sucesso**);
  métrica loga `channel:"unknown"`. meta-api `origin/main` exige `z.enum(["whatsapp","instagram"])` (`messages/schemas.ts:7`)
  → `wa`/`ig` é invenção 100%-backend. **Alcançável NO piloto (Clerk-user):** `approve()`→`runApproval`→`deliverToChannel`
  **e** `executeProposals`→`deliverToChannel`. — Impacto: **100%** das respostas de IA a conversas inbound-semeadas
  descartadas em silêncio como `done`. — Esforço: **3-4h**. **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`ig-inbound-silent-nondispatch`** `[NOVO, cross-repo]` **(v: CONFIRMADO — SEC; sharpen do "unknown-provider silent-drop"
  do 10-21)** — meta-api `origin/main` envia Instagram como `data = { messaging: [...] }` (`inbound/service.ts:246-249,382`;
  payload = `redactSecrets(rawForPersist)`), mas o backend `detectProvider`/`extractIds` chaveiam em `messaging_product`
  top-level (WA) e `recipient.id`+`sender.id` top-level (IG) (`channels/metaapi/normalize.ts:37-43`). Para IG, top-level
  `recipient`/`sender` estão ausentes → `detectProvider` → `"unknown"` → guard de dispatch `routes.ts:240` (`provider ===
  "wa" || "ig"`) falha → o evento é persistido em `received_events` + auditado `metaapi.event.accepted` + 200, **mas nunca
  semeia channel_connection, nunca escreve message_records, nunca enfileira dispatch de IA → 100% do inbound IG
  silenciosamente não-dispatchado**. Mecanismo **distinto** do vocab-drop de outbound. — **Pilot-alcançável se IG semeado.**
  — Esforço: **~1h** (ou fix cross-repo no shape). `[xrepo: bevox-meta-api]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, irreversível; raiz-única CONFIRMADA + alcance Stripe
  DE-ESCALADO]** **(v: CONFIRMADO ×2 — SEC + orquestrador)** — `markChargePaidManually` **não** tem status-gate
  (`service.ts:422-463`, guards = exists + is-manual); `applyChargePaid` (`service.ts:876-925`) chama `markChargePaid` (`:890`)
  → `insertPayment`+`confirmAppointmentIfUnconfirmed`+grant **incondicional** (`:891-924`) **ignorando o rowcount**. Re-mark de
  `expired`/`refunded` → rowcount-0 **mas** os 3 side-effects rodam → payment `paid` órfão (ON CONFLICT
  `(org,'manual:<id>','paid')` `repository.ts:439` não colide pois o anterior virou `reversed`); depois **irreversível**
  (`refundChargeManually` exige `status==='paid'` `:499-501`). **Raiz estrutural ÚNICA CONFIRMADA:** os 3 UPDATEs guardados
  (`markChargePaid`/`Expired`/`Refunded`, `repository.ts:395-413`) são `Promise<void>` **sem `RETURNING`** → **nenhum caller
  pode** gatear no rowcount. `expireChargeManually` (`service.ts:623-649`) **audita falso** (`{status:"expired"}` enquanto a
  charge é `paid` no perdedor da corrida) **e é o único dos 3 manuais sem `withRedisLock`** (cf. mark-paid `:442`, refund
  `:510`) → corre mark-paid livremente. **DE-ESCALAÇÃO NOVA (v: SEC) — o path Stripe NÃO é externamente manufaturável:**
  `webhook-platform.ts:90-97` dedupa por `event.id` **antes** de `applyChargePaid`; Stripe emite 1 `payment_intent.succeeded`
  por PI (retries reusam o `event.id`) → alcançar `applyChargePaid` numa charge já-refunded exigiria um **2º evento succeeded
  distinto** que o modelo da Stripe não produz. **A raiz é a mesma e o fix de 1 ponto fecha as 3 superfícies de código, mas o
  manual mark-paid é o único vetor externamente alcançável.** Rotas sob `mutate` = `requireClerkAuth()+requireOrganizationScope()`
  (sem role-gate, sem idempotency) → reachable por Clerk org-user. — Esforço: **~1,5h**. **#4.**
- **`proposal-missing-idempotency_key`** `[NOVO, inerte-atrás-do-message_id-poison]` **(v: CONFIRMADO — L; cross-repo)** —
  harness `extractProposal` (`bevox-harness origin/main:src/tools/_shared/mutation-tool.ts:341-352`) devolve só `{action,
  params}` (sem `idempotency_key`); o objeto é emitido verbatim em `/complete.proposals[]`
  (`execution-handler.ts:1878,520,1973`). O backend `ProposalSchema` (`harness-callbacks.schema.ts:29-41`) **exige**
  `idempotency_key: z.string().min(1)` → qualquer `/complete` com proposals (o fluxo copilot/manual_assisted draft→approve =
  a UX central do piloto staff-manual) **falha `parse` → 400 → execução nunca finaliza**, nenhuma sugestão chega ao staff.
  **2º dominó atrás do `message_id`-poison:** corrigir o poison sozinho ainda deixa o fluxo de proposals morto. — Esforço: S.
  `[xrepo: bevox-harness]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — ROUTES + PILOT)** — Não existe `GET /appointments` nem
  `/appointments/:id` em lugar nenhum: `grep` REST read = **0**; só POST `/calendars/:id/appointments` (`routes.ts:71`),
  PATCH `/appointments/:id` (`:99`), POST `/appointments/:id/{verb}` (`:131`); nenhum outro módulo faz `FROM appointments`.
  A "agenda do dia" (PRD §263 "canal principal de operação diária") **nem tem REST read, nem SSE push** (`appointment.created`
  §8.3 l.872 nunca emitido — `realtime/publish.ts:8-12` união fechada) → ilegível por TODO ator. — Esforço: **4-6h**. **#9.**
  `[xrepo: PRD §5.3/§8.3]`
- **`worker-process-telemetry-uninitialized`** `[carry, DE-ESCALADO — não é blackout de logs]` **(v: CONFIRMADO ×2 — PILOT +
  orquestrador; ALTO-operabilidade, exercitado-no-piloto)** — `src/queue/index.ts` (entry `node dist/queue/index.js`)
  **nunca** `import "./instrument.js"` nem `initTelemetry()` (ambos só em `src/index.ts:17,30`). `new Worker(` count = **11**
  (linhas 87,92,95,98,103,106,120,125,137,143,149; docstring `:5` "4 workers" stale). O `prom-client` registry
  (`metrics.ts:14`) é singleton **por-processo**; o reconcile incrementa counters **no processo worker**
  (`reconcile.ts:88,114,162,165`) mas `/metrics` é servido **só pelo processo HTTP** (`health/routes.ts:24`) → counters do
  worker **estruturalmente inscrapáveis**; `/readyz` (`:17`) checa PG+Redis mas **não** a liveness do worker (sem porta) →
  worker morto invisível. **DE-ESCALAÇÃO NOVA (v: PILOT):** todo job-failure **É** Pino-logado (`queue/index.ts:268
  log.error`) → falhas visíveis em logs enviados; `on("error")` (`:272`) e bootstrap (`:313`) **chamam** `captureException`
  mas são inertes pois Sentry nunca é init'd no worker. **O defeito é precisamente Sentry-off + Prometheus-unscrapable, com
  logs estruturados como sinal (não-alertante) sobrevivente — NÃO um blackout de logging.** Docstring `:13` auto-falsa. —
  **1-2h** (import + `initTelemetry()` + `/metrics`+`/healthz` no worker + `w.on('failed')` capturar). **Alto valor / baixo
  esforço. #6.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA ligar — INERTE no piloto manual)**

- **`dispatch-message-id-not-uuid-poisons-every-AI-dispatch`** `[carry, pilot-reachable; CAUSA inércia do harness]` **(v:
  CONFIRMADO — L + orquestrador)** — `buildDispatchMessages` seleciona `external_message_id` (`orchestration/repository.ts:395`)
  e o mapeia a `message_id` (`:409`); `external_message_id` é `text NOT NULL` id nativo de canal (`db/schema/ingestion.ts:40`)
  — **nunca** UUID; `id` interno é UUIDv7. `DispatchMessageSchema.message_id = Uuid.optional()`
  (`harness-dispatch.schema.ts:22`) → ZodError em `DispatchPayloadSchema.parse` (`harness-dispatcher.ts:91`) **após** o INSERT
  `pending` (`:73-83`) e **antes** do enqueue (`:107`). Canon (`PRD l.1060`) define `message_id` = o UUIDv7 PK interno → a
  constraint é canon-fiel; o bug é **selecionar a coluna errada** (`m.id`). Determinístico, 100% dos dispatches de IA.
  **É O PORQUÊ de o harness ser inerte no piloto** → CAUSA o orphan-`pending` + MASCARA unbounded/active_execution_id/skills/
  proposal-idempotency_key. — **Inerte no piloto manual; CRÍTICO assim que canais/IA ligarem.** — Esforço: **~15min**
  (`message_id: m.id`). `[xrepo: bevox-harness]`
- **`harness-status-callback-method-mismatch-total`** `[carry, root-cause único]` **(v: CONFIRMADO byte-level nos 2 repos —
  L + orquestrador)** — Harness `post()` hardcoda `method:"POST"` (`bevox-harness origin/main:src/integration/bevox-callback.ts:28`;
  `/status` em `:141`); `updateStatus` POSTa `running` (`execution-handler.ts:1410,1584`) / `dead_letter`
  (`bullmq-consumer.ts:155`), backend só registra **PATCH** `/status` (`harness-callbacks.routes.ts:56`) → **toda** chamada de
  status → Fastify **404**. Backend é **canon-correto** (§10.4 PATCH l.1076). O worker `on('failed')` (`queue/index.ts:267-269`)
  só **loga** jobs backend-internos → **root-cause único**. Fix = **cross-repo** (harness→PATCH + errata canon l.447). —
  Esforço: **~1,5h**. **#7.** `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry, status-agnóstico]` **(v: CONFIRMADO — L; grep leituras=0)** —
  o preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:67-71,96`; escreve
  `req.executionContext` em `routes.ts:66`), mas **todo** handler age sobre o `:id` da URL (`routes.ts:73,91,113,142`) e
  **nunca** lê `req.executionContext` (grep: `executionContext` é write-only — decl `global.d.ts:47`, decorate `:87`). Token
  válido p/ A escreve em qualquer execução B (IDOR cross-execution/cross-tenant). **Inerte no piloto** (token nunca escapa —
  dispatch poisona pré-enqueue); **CRÍTICO-GA**. — Esforço: **1h**. `[xrepo: bevox-harness]`
- **`dispatch-messages-unbounded-poison` / `completion-never-clears-active-execution-id` / `backend-never-sends-skills-
  allowlist`** `[carry, MASCARADOS por message_id-poison]` **(v: CONFIRMADO — L)** — `buildDispatchMessages`
  (`repository.ts:394-399`) sem LIMIT vs caps harness `100`/`8000`/`256KB`; `finalizeCompletion` atualiza só `executions`
  (`harness-callbacks.repository.ts:136-149`), nunca `conversation_pipeline_state.active_execution_id` (nulado só por
  `releasePipelineClaim repository.ts:231` + `handoffConversationOnTimeout :464`; `claimPipelineForCutoff` exige
  `active_execution_id IS NULL :196`) → conversa **trava após uma completion bem-sucedida**; `cutoff.ts:75 skills:[]` +
  `actions.repository.ts:144 skills:[]` → PERM-05 no-op. — **Inerte no piloto; CRÍTICO-GA.** — 1-8h/ea. `[xrepo: bevox-harness]`
- **`complete-service strategy/aborted mismatches`** `[carry, CONFIRMADO sub-claims; bodyOrgId DE-ESCALADO]` **(v:
  CONFIRMADO — L)** — `strategy:"failed"`+proposals vazias → `inferSuggestionType` devolve `"reply"`
  (`complete-service.ts:22`), nunca `error` (harness emite exatamente isso no error-boundary `execution-handler.ts:2150`) →
  uma execução falha é gravada `done`, não `error` (canon espera `error`, PRD l.1146-1149); harness emite
  `aborted_cost`/`aborted_timeout` **no fio** (`execution-handler.ts:2096-2100`, paths "ESPERADO") ausentes do enum backend
  (`harness-callbacks.schema.ts:57-65`) → `parse` 400 **antes** de `lockForCompletion` → desfechos terminais rejeitados;
  terminal guard devolve 409 (`routes.ts:159-163`) vs canon 410 (PRD l.832). **DE-ESCALAÇÃO NOVA (v: L):** `/complete` lê
  `bodyOrgId` sem `=== existing.organization_id` (`routes.ts:150-154`), **mas** o body do harness `/complete` **não tem campo
  `organization_id`** (grep nos 2 callback-files = 0) → `bodyOrgId` sempre `undefined` → fallback ao org correto. Assertion
  faltante real, **mas NÃO vetor cross-tenant vivo** — inerte. — 1-3h/ea. `[xrepo]`
- **`applyStatusTransition-unguarded-regression`** `[NOVO, inerte double-masked]` **(v: CONFIRMADO — L)** — o `UPDATE
  executions SET status=…` não tem precondição de status (`harness-callbacks.repository.ts:65-66`, `WHERE id` só) → um
  callback `running` tardio/mis-targeted regride uma execução terminal (`done`/`error`/`dead_letter`) → `processing`.
  Inalcançável hoje (POST `/status` 404s + compõe o token-IDOR); **vira vivo no instante em que o method-mismatch for
  corrigido.** Contraste: `markExecutionDeadLetter` (`:90`) e `lockForCompletion` (`:130`) **são** status-guarded. — S.
  `[xrepo: bevox-harness]`

### MÉDIO (degrada qualidade)

**Auth — contrato / cross-org (plano staff-ops que o piloto usa)**

- **`staff-token-expires_in-advertises-refresh-ttl-not-access-ttl`** `[carry]` **(v: CONFIRMADO ×2 — AUTH + orquestrador)** —
  `issueSession` devolve `expires_in: ttl` onde `ttl = staffRefreshTtlSeconds()` = 604800s/7d (`auth/service.ts:54,60`), mas o
  JWT access-token `exp` = `STAFF_JWT_ACCESS_TTL` = 900s/15min (`staff-auth.ts:74`). Cliente que agenda refresh por
  `expires_in` trata token de 15min como válido **672×** tempo demais → 401 silenciosos no painel staff (o plano que o piloto
  de fato usa). — Esforço: **0,25h** (`expires_in: cfg.STAFF_JWT_ACCESS_TTL`).
- **`staff-ops-realtime-sse-firehose-unaudited`** `[carry]` **(v: CONFIRMADO — AUTH)** — `GET /api/v1/staff/realtime/events`
  faz `sub.psubscribe("realtime:*")` (`realtime.routes.ts:66`) — **firehose cross-org de TODOS os orgs** — gated só por
  `requireStaff([...STAFF_ROLES])` (observer incluído), **sem filtro de org e sem audit**. — **MÉDIO/LGPD (GA).** — Esforço:
  **2-4h**.
- **`audit-log-blind-to-staff-actor`** `[carry]` **(v: CONFIRMADO — AUTH + LGPD)** — toda mutação staff-ops grava
  `audit_events.actor_id = NULL` (`actions.repository.ts:178-184`); o filtro `actor_id` do read de audit (`read.repository.ts:222`)
  **nunca casa** um staff → a trilha cross-org não responde "o que o staff X fez". O enum `actor_type` = `user|ai|system|webhook`
  **sem `staff`** (`_shared.ts:84`). — **MÉDIO/accountability.** — Esforço: S-M.
- **`clerk-jwt-no-aud-iss-validation`** `[carry, DE-ESCALADO ALTO→MÉD]` **(v: CONFIRMADO — AUTH)** — `clerk-auth.ts:89-92`
  verifica só `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim
  não-verificada (`:105`). **DE-ESCALAÇÃO (v: AUTH):** o JWKS é **instance-scoped** (`clerk-auth.ts:67-73` monta de
  `CLERK_JWKS_URL`) → só tokens assinados pela instância Clerk da Bevox são aceitos; atacante externo não cunha um. Risco
  residual = token p/ audience/azp distinto **dentro da mesma instância** → defense-in-depth, não porta aberta. Assimetria:
  staff **pina** audience; Clerk não. — Esforço: **0,5-1h**.

**Observabilidade — worker é buraco-negro + `/metrics` é superfície pré-auth composta (11 workers; piloto exercita obs)**

- **`metrics-public-org-id-enumeration` + dois cardinality-bombs pré-auth**
  `[carry + 2 NOVO; pré-HMAC-amplification DE-ESCALADO → LOW]` **(v: CONFIRMADO ×3 — SEC + PILOT + orquestrador)** — `GET
  /metrics` (`health/routes.ts:24`) é in-app **não-autenticado** (comentário `:22-23` admite só network-policy) e o counter
  `bevox_backend_http_requests_total` é rotulado com `organization_id` (`metrics.ts:33`), incrementado por-request com o UUID
  real (`bootstrap/server.ts:170`) → quem alcança `/metrics` **enumera todos os org-UUIDs** (vazamento ADR-021). **NOVO ×2
  (v: SEC + PILOT) — dois cardinality-bombs que compõem com a leitura não-autenticada:** (a) `event_type` do webhook metaapi
  é `/^raw\.[a-z_]+\.[a-z_]+$/` (`channels/metaapi/schemas.ts:31`, `[a-z_]+` **ilimitado**) e vira label de Counter no path de
  **assinatura-inválida pré-auth** (`routes.ts:168`, `metrics.ts:63-66`) — flood não-autenticado de `raw.a.a`/`raw.aa.a`/… →
  séries ilimitadas → exaustão de memória; (b) o label `route` cai para o **path cru** em requests 404/unmatched
  (`server.ts:163` `routeOptions?.url ?? req.url`) → o mesmo blow-up, ×`organization_id`. **Um atacante pode inflar E ler o
  mesmo endpoint.** **DE-ESCALAÇÃO (v: SEC):** o `metaapi-webhook-preauth-db-amplification` (MÉD/DoS no 10-27) é **LOW** — as
  2 leituras pré-HMAC são O(1) indexadas (`routes.ts:140-144 LIMIT 1`; `repository.ts:58-69 LIMIT 1`) + 1 decrypt de µs; o DoS
  pré-auth **real** são os cardinality-bombs. — Esforço: **1-2h** (auth no `/metrics` + bucket de labels). `[g/k; ADR-021]`
- **`worker-has-no-healthz-readyz` + `dead-worker-invisible-to-orchestration`** `[carry]` **(v: CONFIRMADO — PILOT)** — o HTTP
  `/readyz` (`health/routes.ts:17`) checa Postgres+Redis mas **não** a liveness do worker; o worker não expõe porta → k8s não
  consegue HTTP-probe → worker crashado → o HTTP segue `ready` enquanto ingestão/reconcile/google-sync/waitlist/package-expiry
  **param em silêncio** (só logs Pino sobrevivem — ver worker-telemetry). — **2-3h**.
- **`domain-prometheus-metrics-not-registered`/`never-emitted` + canonical-counter-dead-while-shadow-lives** `[carry +
  NOVO sharpen]` **(v: PILOT)** — `shared/metrics.ts` não registra os de §13.3 l.1365/l.590 (`charges_*`,
  `appointments_no_show_rate`, `executions_pending_*`, `queue_jobs_completed_total`, `buffer_windows_opened_total` — grep=0);
  `metrics.ts:41 queueSize` nunca `.set()` e `:52 messagesReceivedTotal` nunca `.inc()`. **NOVO sharpen (v: PILOT):** o
  canônico `bevox_backend_messages_received_total` (`:52`) é dead, **enquanto o paralelo
  `bevox_backend_metaapi_inbound_events_total` (`:63`) É incrementado** no path real de inbound do piloto → dashboards/alertas
  keyed no canônico leem flat-0 apesar de ingestão viva (não é cegueira pura — há um shadow counter). **Correção:**
  `httpRequestDuration` **É** observado (`server.ts:169`) — não é dead. — **2-3h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` **(v: PILOT)** — `realtime/publish.ts:8-12` união fechada a
  `execution.*`/`waitlist.offered`; `appointment.created`(§8.3 l.872)/`charge.updated`(§8.4 l.894) **nunca** emitidos → tela
  do profissional não auto-atualiza. — **2-3h**.

**Dados/LGPD — scoping de conteúdo (GA/Marco-3, piloto roda com PII real; ingestão ungated vs rights-path RS256-gated)**

- **`message-content-table-untargetable`** `[carry]` **(v: SCHEMA + LGPD; MÉDIO/LGPD)** — `message_records`
  (`db/schema/ingestion.ts:32-56`) guarda PII (`content_text` egresso ao LLM + `sender_snapshot_json` + `media_json`) mas
  **sem `organization_id`, sem `created_at` de inserção, sem `deleted_at`** — só o nullable `message_created_at` (`:43`). FK
  `received_event_id onDelete set null` (`:36-38`). **DE-CLAIM STANDE:** a âncora transitiva via
  `received_event_id→received_events.received_at` existe; só o `created_at` **direto** é ausente. Conteúdo não é DSR-targetável
  por org nem envelhecível por cron sem a âncora. — **GA/LGPD.** — Esforço: migration (M). `[g/schema]`
- **`dsr-export-omits-titular-phone-and-channels`** `[NOVO]` **(v: LGPD)** — o export (`customers/service.ts:97-110`) +
  `COLS` (`customers/repository.ts:25-26`) **nunca consultam `customer_channels`**; o intake insere só `customers.full_name`
  (`channels/repository.ts:114-117`), de modo que `customers.primary_phone` é **NULL para toda a população channel-origin do
  piloto** (cf. `metaapi/repository.ts:204 primary_phone ?? channel_phone`). O telefone real do titular +
  `external_user_id`/`display_name`/`handle` vivem em `customer_channels` e **nunca são exportados** → portabilidade (art.18/20)
  devolve dados quase-vazios/enganosos. — **GA/Marco-3.** — Esforço: baixo. `[g]`
- **`dsr-export-omits-profiling` + `is_private-facts-disclosed`** `[carry + NOVO; notes_internal DE-ESCALADO]` **(v: LGPD)** —
  o export devolve `CustomerRow` mas **omite `risk_flags_json`** (profiling automatizado, art.20) + `preferences_json`
  (colunas existem `customers.ts:45,48`); `listFacts` filtra `superseded_by IS NULL` (`repository.ts:106`) → facts
  históricos fora da portabilidade; **NOVO:** `listFacts` não filtra `is_private` → export + profile surfam facts
  `is_private=true` (anotações staff-privadas) — risco num hand-off titular-facing (nenhum existe hoje; LOW/latente).
  **DE-ESCALAÇÃO (v: LGPD):** o "export LEAKS `notes_internal`" (NOVO no 10-27) é **latente** — o único principal que chama
  export (operador Clerk RS256) **já recebe** `notes_internal` via `GET /customers/:id` (`routes.ts:55`) e `/profile`; o export
  não adiciona superfície incremental. — **MÉDIO/accuracy.** — Esforço: S-M. `[g]`
- **`appointment-transition-no-state-guard` + `package-session-not-restored-on-cancel` + `resurrect-google-divergence`**
  `[carry + NOVO]` **(v: PILOT)** — `booking.ts:445-450` UPDATE incondicional any→any (comentário `:436-438` literal "UPDATE
  permanece incondicional"); `cancelled→confirmed` **ressuscita** sem re-check de capacidade (`availability.ts:169` conta
  `status NOT IN ('cancelled')`) → **over-book silencioso**; o decremento de pacote roda em `completed`/`no_show`
  (`:485-500`) mas o branch de cancel (`:461-472`) não re-incrementa → `completed→cancelled` **consome permanentemente** uma
  sessão. **NOVO (v: PILOT):** `transitionAppointment` escreve `google_sync_outbox` **só** no branch `cancelled` (`:463`);
  uma ressurreição (`cancelled→confirmed`) dispara após um `'delete'` outbox **sem** `'create'` compensatório → evento some do
  Google Calendar mas `confirmed` no DB (divergência permanente). — **GA integridade (inerte no piloto semeado — sem
  customer_packages/Google).** — **2-3h**.
- **`reschedule-non-atomic-double-book` + `appointment-mutations-no-auditevent` + `availability-n1-count-plus-92day-serial-
  loop`** `[carry; §12.8 DE-ESCALADO]` **(v: PILOT)** — createAppointment commita o NOVO em tx própria
  (`booking.ts:373-388`), DEPOIS tx **separada** cancela o ANTIGO (`:390-414`) → janela de double-count + crash = ambos
  ativos; COUNT(*) por-slot em loops aninhados (`availability.ts:167-171`) × serial ≤92 dias (`schemas.ts:29`, loop
  `routes.ts:52-67`). **DE-ESCALAÇÃO (v: PILOT):** §12.8 l.1343 manda C/U/D→AuditEvent e `booking.ts` grava **zero
  `audit_events`**, **mas** deixa trilha durável `google_sync_outbox` (`:245,:395,:463`) + `google/sync.ts:88` grava um
  `audit_events` real no sync → mutações **não são totalmente** não-auditadas para orgs Google-connected; o mandato §12.8
  *AuditEvent* é descumprido só no path manual/non-Google (o piloto semeado). "Zero trilha" superestima. — halfday/ea.
- **`intent-reconcile-half-applies-paid`** `[carry]` **(v: SEC)** — `reconcile.ts:143-150` seta só `status='paid'`+`updated_at`
  **bypassando os 6 efeitos de `applyChargePaid`** (sem row `payments`, sem confirm, **sem grant de pacote**, sem audit).
  Branch **live** (Stripe-path, inerte no piloto). — **M**.
- **`reconcile-fifo-window-starvation`** `[carry]` **(v: SEC)** — `reconcileStuckIntents` (`reconcile.ts:101-108`) seleciona
  50 `pending` mais antigos **sem** filtro `provider_charge_id IS NOT NULL`; manuais (null `provider_charge_id`, legitimamente
  long-pending) são `continue`-skipados (`:119`) mas **ocupam** slots FIFO → reconcile Stripe estagna em modo misto (piloto
  manual-only sem vítima). — **M**.
- **`idempotency-required-header-unenforced`** `[NOVO, pilot-money]` **(v: ROUTES)** — OpenAPI declara `Idempotency-Key`
  `required:true, minLength:1` (`openapi:94-102`), mas os handlers leem `req.headers["idempotency-key"] as string` **sem
  checar presença/vazio**, e os preHandlers `write`/`mutate` (`payments/routes.ts:51-59`) só fazem auth+scope — sem binding
  mecânico (ZodTypeProvider=0), o header spec-obrigatório é **opcional em runtime**. Dente no piloto: `POST /charges/manual`
  (`:284`, lê a key em `:286` — o caminho de dinheiro não-Stripe do piloto) aceita key ausente → **charges `pending`
  duplicadas no retry do cliente**. — Esforço: baixo. `[b/j]`
- **`metaapi-event-type-metric-cardinality-bomb`** `[NOVO, pré-auth DoS]` **(v: SEC)** — ver bloco de observabilidade acima
  (`channels/metaapi/schemas.ts:31` + `routes.ts:147,152,168` + `metrics.ts:63-66`). — **GA/DoS, piloto-alcançável
  (não-autenticado).** — Esforço: baixo. `[k]`

### BAIXO (higiene)

**LGPD (Marco-3 §16.3 — piloto roda com PII real; CONFIRMADOS; de-claims STANDES)**

- **`consent-and-ai-opt-out-stored-not-applied` + `no-consent-capture-mechanism` + `intake-pii-ingested-pre-notice`**
  `[carry]` **(v: LGPD — vetor vivo, headline LGPD)** — `ai_opt_out` só no CRUD de customers (`customers/repository.ts:21,26,67`;
  `default false`=opted-IN) e **lido em lugar nenhum** (grep); dispatch é **conversation-keyed, nunca customer-keyed**
  (`orchestration/repository.ts:391-415`) → opt-out por-customer inaplicável sem mudança de schema/flow; `consent_granted_at`
  (`customers.ts:49`) tem **zero writers**; `intake.ts:82-88` INSERT cego em `customers` (full_name=displayName) +
  customer_channels com telefone **sem gate de consentimento e sem "aviso automático"** que `_shared/ADR-019:33 item 6` exige.
  **Assimetria-chave:** ingestão ungated vs direitos RS256-gated (inalcançável no piloto HS256). **Nenhum artefato de
  base-legal/consentimento é persistido em lugar nenhum** (nem `consent_events`/`dsr_requests`). — Esforço: **M**. **#10.**
  `[xrepo: _shared/ADR-019]`
- **`received-events-and-message-records-un-erasable` + `retention-worker-adr020-absent`** `[carry]` **(v: LGPD + SCHEMA)** —
  `received_events` (`ingestion.ts:12-30`) persiste `payload_json` E `normalized_payload_json` (envelope Meta cru) com **zero
  `organization_id`/`customer_id`/`deleted_at`**; `message_records` idem → **5 cópias de PII inbound cruas**. grep
  `legal_basis|consent_event|dsr_request|retention|pseudonym` em `src/ db/ scripts/` = **0**; `auth/repository.ts:99-100`
  **admite** "Hard-delete worker (ADR-020, ainda não landed)". Canon ADR-020:70 define `bevox.retention.worker` (cron 03:00
  UTC) + `consent_events`/`dsr_requests`. — Esforço: **24-40h**. `[xrepo: _shared/ADR-020]`
- **`dsr-deletion-absent` + `customers-have-no-erasure-path-at-all`** `[carry + NOVO sharpen]` **(v: LGPD)** — nenhum endpoint
  de deleção de customer; o export EXISTE mas incompleto + não grava `audit_event`/`dsr_requests` (art.37=0) + RS256-only →
  capacidade DSR do piloto = **zero**. `deleteUserByClerkId` (`auth/repository.ts:244-246`) faz um **hard `DELETE FROM users`**
  real no webhook Clerk → erasure existe **só para `users`** (operadores org-side). **NOVO sharpen (v: LGPD):** `customers.ts:51-52`
  define `archived_at`+`deleted_at`, mas `grep DELETE/soft-delete customers` = **0 writers** → titulares não têm nem
  hard-delete nem o **soft-delete desenhado** → capacidade de erasure de data-subject é **estruturalmente zero**, não "wired à
  população errada". — **DE-CLAIM STANDE:** `consent_granted_at` omitido do export é imaterial (sempre NULL). — Esforço:
  export **6-10h**; deleção **8-12h**. `[xrepo: _shared/ADR-020]`
- **`dsr-export-under-captures-cross-entity-audit`** `[DE-ESCALADO de "audit_events-não-customer-scoped"]` **(v: LGPD)** — o
  10-27 disse "o TODO do DSR export (`routes.ts:93`) é estruturalmente irrealizável" por `audit_events` não ter
  `customer_id`. **DE-ESCALAÇÃO (v: LGPD):** `db/schema/audit.ts:27-28` tem `entityType`+`entityId` com índice composto (`:42`)
  → rows `entity_type='customer'` **são** filtráveis → o TODO **é parcialmente realizável** para o subset customer-entity. O
  gap real e mais estreito: rows cross-entity carregam o customer só em `before/after_json` ou sob outros entity-types (ex.:
  ingestão `entity_type='metaapi_event'` `routes.ts:219`) e não são customer-filtráveis. "Irrealizável" → "parcialmente
  realizável; sub-captura rows cross-entity". — **LGPD/accuracy.** — Esforço: S.
- **`staff-manual-actions-pii-sink` + residue LGPD** `[carry]` **(v: LGPD)** — `staff_manual_actions.ts:14-40` jsonb de ação
  de operador = PII sem customer_id, fora da ADR-020/DSR; `execution-traces-pii` (`execution_traces.ts:29-32`, só `createdAt`,
  sem worker); `google-calendar-intl-transfer` (`sync.ts:203,237` nome p/ US — art.33); `payments-raw-payload-json`
  (`payments.ts:135`, 10yr fiscal → minimização); customers nunca escreve audit (único módulo sem audit writer);
  `clerk-organization-deleted-unhandled`; **NOVO** `received_events.signature_valid` hard-coded `TRUE`
  (`channels/metaapi/routes.ts:210`) regardless → flag de proveniência vestigial. — 2-4h/ea.

**Money / schema — misses de baixo risco**

- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry, cron LIVE-wired]` **(v: CONFIRMADO ×2 — SEC +
  orquestrador)** — `reconcile.ts:254-259 UPDATE refunds SET … updated_at = now()`, mas `refunds` **não tem** `updated_at`
  (`payments.ts:149-172`; comentário `:7` admite o adiamento) → **42703** capturado (`:262`) → `failCount++`, status nunca sai
  de `pending` → reconcile de refund **DOA**. Cron **É live-wired** (`queue/index.ts:149-151` + repeatable `:255-264`). O path
  vivo `updateRefundStatus` (`repository.ts:476-485`) **omite** `updated_at` → intacto; manual escreve `succeeded` direto
  (`service.ts:525`) → cron nunca o seleciona → **pilot-inerte**. CI-invisível (só unit mockado). **Fix = remover
  `updated_at=now()`.** — **0,25h**. `[xrepo: Stripe]`
- **`manual-charge-amount-unbounded-overflow-500` + currency/validity/uniqueness residues** `[carry]` **(v: SEC)** —
  `manual.ts:31 z.number().finite().positive()` (sem `.max`/`.multipleOf`) → `service.ts:377 .toFixed(2)` em `numeric(10,2)`
  (`payments.ts:90`) → ≥1e8 → 22003 → 500 opaco (**pilot-reachable**); `currency z.string().default("BRL")` sem CHECK
  (`manual.ts:33`+`payments.ts:92`, propaga junk ao ledger); `payment_accounts` sem uniqueness em `professional_id`
  (`payments.ts:39-41,63-66`). — trivial/S ea.
- **`fk-columns-without-index` + `section-11-3-critical-indexes-partially-absent`** `[carry; partial-index-trap DE-ESCALADO →
  LOW]` **(v: SCHEMA — recount)** — **91 `.references()`** TS (FK-DB reais **≈93** — ver snapshot-drift abaixo); **18** tabelas
  org-FK com `organization_id` completamente sem índice (calendars, professional_schedules(+overrides),
  waitlist_entries(+outbox), customers, professionals, services, executions, conversation_pipeline_state, buffer_windows,
  execution_traces, staff_manual_actions, service_packages, users, +3 google) → agregado **≈55**. A tabela `customers` (PII
  primária) tem **ZERO** índices secundários. PRD §11.3 l.1270-1271 manda `(org,status)` em
  appointments/conversations/charges/executions + `(org,start_at)` em appointments → **4 de 5 AUSENTES** (só
  `conversations (org,status)` existe `:58`). **DE-ESCALAÇÃO (v: SCHEMA) — partial-index "trap" → LOW:** dos 13 org-indexed,
  10 full + 3 partial-only, **mas** o partial de `customer_facts` é **PRD §11.2 l.1217 VERBATIM** (spec-correto, não trap) e o
  de `payment_accounts` cobre o lookup org-level dominante; só o de `refunds` + os read-paths professional/superseded ficam
  genuinamente descobertos. Net: estrutural **LOW**, não perf-bug para os access-patterns primários. — **3-4h** (uma
  migration). `[a/schema]`
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized` + `waitlist-priority-score-client-settable`**
  `[carry]` **(v: SCHEMA — canon-reforçado)** — backend/ADR-020 + ADR-021 (ambas `aceita 2026-05-21`) **não materializadas**
  (grep `message_template`/`urgency_level`/`skip_count` = 0). ADR-021 "Opção C" manda `priority_score` server-computed +
  `urgency_level`/`skip_count` + `CHECK (priority_score >= 0)` + "server ignores client input em V1" — **vinculante**. Mas
  `calendar.ts:204 priority_score numeric notNull default '0'` **sem CHECK**, escrito do input em `waitlist/routes.ts:30,36,71,95`,
  INSERT (`repository.ts:278`), PATCH (`:361`), seam de IA (`seam-tool.ts:44,83`), e `match` ordena por ele
  (`repository.ts:331`; `match.ts:74-75`) → **inverso direto** de ADR-021. (`conversations.priority_score` dormante —
  não re-inflar.) — ADR-020 **8h**; ADR-021 CHECK+drop-input **2h** / fórmula **6-10h**.
- **`status-history-entity-absent` + `appointments-no-created-by-actor` + `appointments.confirmed_at-absent` +
  `OperationalMetricSnapshot-absent`** `[carry]` **(v: SCHEMA)** — Módulo 16 (l.584/588) + §8.3/§8.4 mandam `StatusHistory` +
  `OperationalMetricSnapshot` + `appointments.created_by_type/id` + `confirmed_at`; grep de cada em `src/`+`db/schema/` =
  **0** (`confirmed_at` só um comentário `payments/repository.ts:922-924` admitindo que "não existe no schema"; confirmação é
  implementada como transição de `status`). Provenance/histórico de transição é irrecuperável. — **GA/latente.** — S-M/ea.
- **`appointments-customer-package-fk-snapshot-drift`** `[NOVO]` **(v: SCHEMA; refuta "FK dangling")** — `calendar.ts:124`
  declara `customerPackageId: uuidFk(...)` **sem** `.references()` (lê como FK faltante), **mas** a migration
  `0012_needy_human_cannonball.sql:2` **adiciona** `appointments_customer_package_id_fk` (`ON DELETE set null`) → integridade
  referencial **existe** no DB (a omissão TS é evasão de import circular — **REFUTA** "FK dangling"). Porém a FK está ausente
  de **todos** os snapshots drizzle (`meta/0012..0020_snapshot.json` todos `customer_package_fk: False`) e o `0012` **não tem
  comentário justificando** (viola `backend-db.md`). Consequência: drizzle-kit diffa TS-vs-snapshot (ambos sem a FK) → é
  **permanentemente cego** a ela; se alguém "corrigir" adicionando `.references()`, `generate` emite `ADD CONSTRAINT` contra
  uma constraint existente → **42710 duplicate_object**. FK-DB real **≈93** (91 `.references()` + 1 `foreignKey()` self-ref
  customer_facts `customers.ts:141` + 1 hand-add 0012). — **LOW-MED** (latente sob freeze; 1ª landmine no schema-thaw). — baixo.
- **`stripe-webhook-events-org-set-null-orphan`** `[NOVO]` **(v: SCHEMA)** — `payments.ts:236` / migration `0011:129` fazem
  `stripe_webhook_events.organization_id` nullable `ON DELETE set null`, a única tabela org desviando do cascade §11.2 l.1203.
  Na deleção do org, rows sobrevivem com `organization_id=NULL` → payloads Stripe (raw PII-adjacent) escapam o cascade de
  tenant. — **LOW** (Stripe-path, inerte manual-mode). — baixo.

**Auth / harness / routes (resíduos — BAIXO/latente/inerte)**

- **`newOpaqueId-uuidv4-dormant-landmine` + `verifyStaffRefreshToken-dead` + `staff-ops-org-filter-optional` +
  `staff-refresh-tokens-unbounded-no-prune`** `[carry + NOVO]` **(v: AUTH)** — `staff-auth.ts:139 newOpaqueId(): randomUUID()`
  (UUIDv4, viola invariante #7), **zero callers**; `staff-auth.ts:119-121 verifyStaffRefreshToken` **zero callers** (refresh
  vivo usa lookup-by-hash DB), usa `===`; `organization_id` em staff-ops reads é `z.string().optional()` não `.uuid()`
  (`schemas.ts:44,55`). **NOVO (v: AUTH):** todo login insere uma row `staff_refresh_tokens` (`service.ts:88-89`) sem prune; a
  rotação deleta só o token apresentado (`:100`), tokens-irmãos sobrevivem 7d; sem logout, sem cap por-staff → um refresh-token
  vazado sobrevive rotações arbitrárias até seu próprio expiry. — trivial/S.
- **`staff-residues`** `[carry]` **(v: AUTH)** — `login-user-enumeration-timing` (throw antes do bcrypt `service.ts:68-83`,
  sem dummy-hash); `bcrypt-72-byte`; `staff-session-no-logout`; `staff-refresh-no-reuse-detection`;
  `staff-role-stale-cache-at-login` (300s `repository.ts:19-20,54`); `clerk-resolvelocaluser-fail-open`;
  `clerk-webhook-unknown-type-silent-200` (svix-verified primeiro). — S/ea.
- **`dispatch resíduos`** `[carry]` **(v: L)** — `poisoned-dispatch-orphans-pending-execution-row`
  (`harness-dispatcher.ts:73-83`; `claimTimedOutExecutions repository.ts:428` filtra status IN
  ('dispatching','processing','waiting_input') → não varre `pending` — **pilot-reachable, um órfão por inbound**);
  `callback-base-url-dead-on-harness-side`; `/traces-has-zero-harness-producers` (`sendTrace bevox-callback.ts:98` 0 callers);
  `/stream-wired-but-config-gated` (**DE-ESCALADO de "desligado"**: `sendStreamChunk bevox-stream-callback.ts:76` POSTa shape-correto a `/stream`, via `StreamPublisher execution-handler.ts:1256`; gated por `env.STREAM_ENABLED` + flag `stream` per-exec que o `DispatchPayloadSchema` **não tem** → nunca opta-in); `/complete-terminal-guard-409-vs-canon-410`. — 0,25-2h/ea.
  `[xrepo: bevox-harness]`

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recount reproduzido EXATO)**

- **`openapi-drift-undocumented-handlers` (11 → 7 drift-real + 4 "isentos") + `no-mechanical-route-zod-openapi-binding`**
  `[carry; .parse recount 148→160]` **(v: ROUTES)** — **7 drift-real sem isenção** (todos existem, 0 hits YAML, refutação por
  alt-spelling FALHOU): `GET /customers/{id}/export` (`customers/routes.ts:97`), `GET`+`PATCH /autonomy`
  (`autonomy/routes.ts:18,23`), `GET /channel-connections` (`channels/routes.ts:14`), `GET`+`PATCH /payment-account/policy`
  (`payments/routes.ts:89,95`), `GET /api/v1/realtime` (`realtime/routes.ts:27` — o único `realtime` no YAML é o path staff
  **distinto** `/api/v1/staff/realtime/events` openapi:924). ZERO rotas usam `schema:` do Fastify; sem `ZodTypeProvider`;
  **160** `.parse()`/`.safeParse()` inline (168 bruto − 5 `JSON.parse` − 3 `parseInt/Float/Date.parse`; o "~148" anterior era
  subcontagem → claim **mais forte**); OpenAPI 100% YAML estático → razão estrutural do drift. `pnpm openapi:check` é
  `openapi-typescript --output -` (**gerador de tipos**, não validador) → exit 0 só prova parse. **NOVO (v: ROUTES):** a regra
  "4 webhooks isentos" é **inconsistente** — clerk + metaapi/events (mesma classe signature-verified) **SÃO** documentados, e
  `GET /webhooks/google/callback` (302-redirect) é idêntico em shape ao DOCUMENTADO `connect-return`/`connect-refresh`
  (openapi:3082,3098) → "isento" é arbitrário; reframe como "inconsistentemente documentado". — **2-3h** + 1h validador CI.
  **#9.**
- **`enum-create-refund-missing` + `status-callback-missing-dead_letter`** `[carry, SHARPENED → live-path twins]` **(v:
  ROUTES)** — YAML `ExecutionProposal.action` = 6 vals **sem `create-refund`** (openapi:325-330); Zod tem 7 incl `create-refund`
  (`harness-callbacks.schema.ts:35`), **executado** (`seams.ts:172` + `complete-service.ts:25`) e `ExecutionProposal` é refdo
  por `ExecutionCompleteCallback.proposals` (openapi:358) → um `/complete` real passa Zod mas falharia OpenAPI. **Gêmeo:** YAML
  `status` enum `[running,paused,cancelled]` (openapi:298) vs Zod adiciona `dead_letter` (`harness-callbacks.schema.ts:16`) com
  handler-branch vivo (`routes.ts:75-78`) — root = YAML congelado 1 dia antes de `dbd231e` adicionar `dead_letter`. — 0,25h.
- **`error-envelope-dual-schema` / `idempotency-key-param-overclaims` / `freeform-200` / `sse-bearer-only` / `checkout-3-way` /
  `operationId:0`** `[carry; vários DE-ESCALADOS]` **(v: ROUTES)** — handler **sempre** emite `request_id`
  (`error-handler.ts:55`) mas só `ErrorEnvelope` (7 refs, request_id:138) o documenta — `Error` (6 refs, openapi:104) não;
  **DE-ESCALADO** `idempotency-key-param-self-inconsistency` → as 20 mutações sem param são **intencionais**
  (`payments/routes.ts:55` documenta connect/mark-paid/expire non-idempotent) — o defeito é a **descrição** (openapi:98 "toda
  mutação") overclaimar (`$ref`=32 / mutation-ops=52 confirmados); 200 free-form (37× `additionalProperties:true`,
  openapi:2060); SSE só Bearer (`realtime/routes.ts:28`); `checkout` 3-way (`[pix,checkout]` `charge-intent.ts:87,109` vs
  yaml `[pix]` openapi:2602 vs 501-stub `:84`, grep "501"=0); **DE-ESCALADO** `operationId:0` → o gerador é
  `openapi-typescript` (keys por path+method, não operationId) → **não quebra o codegen deste repo**, só degrada SDK
  operationId-based; **DE-ESCALADO** `429-undocumented` → **moot** (nenhuma rota emite 429, `requireRateLimit` 0 callers). —
  0,25-2h/ea.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: orquestrador)** — tags só `v1.0.0`/`v1.0.1`;
  `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora (incl. dispatch amendment);
  `release.yml` dispara só em `push tags: ["v*.*.*"]` → **nenhuma imagem (SemVer OU sha) pós-`v1.0.1`**. Versão diverge
  **4-way** (`package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1` / hub `vX.Y.Z`). — **0,5-1h** (cortar tag).
  `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: orquestrador)** — `src/integration/resolve-organization-id.ts` **NÃO existe**
  (bridge colapsada SP-3) mas é citado como vivo em **~5 lugares** (`README.md:84`, rules `backend-tenancy.md`/
  `backend-routes.md`, `PostToolUse-tenancy.sh`, agent `engineering-backend-architect.md`); **`CLAUDE.md §8 l.171`** diz seed
  grava `PILOTSEEDONLYNOTASECRET` (stale — seed usa `generateMfaSecret`); `backend-harness-contract.md:35` lista o
  status-callback como **POST** (handler é PATCH) e `:46`/`backend-workers.md:20` dizem `dead_letter` via `worker.on('failed')`
  (**errado** — worker só loga); `backend-db.md:31` diz `on delete restrict` (código+canon = **cascade**, §11.2 l.1203);
  `backend-routes.md:24,33` invoca `requireRole` inexistente + mis-cita "ADR-022 staff RBAC" (é backend/ADR-013). —
  0,3-0,5h/ea.
- **`stray-gap-workflow-js-scratch` / `codeql-upload-never` / `release-no-provenance-sbom` / `adr-number-collision`**
  `[carry]` **(v: orquestrador)** — **5** `.claude/state/gap*.js` (gap0704/0709/0714/0715/0717, gitignored — `git
  check-ignore` confirma os 5) → **zero impacto em CI** (checkout limpo não os tem); só `pnpm lint` **local** dá RED (5
  parsing-errors). **Esta sessão NÃO adicionou nenhum** (usou Agent tool, não Workflow; `git status` limpo). `codeql.yml:26
  upload:never`; `release.yml` sem provenance/sbom; ADR 008-023 colidem backend/_shared. — 0,1-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária esta sessão)

- **`legacy-lexicon-clean`** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/`db/`: executável **ZERO**
  (composites + alias `AS account_id` + `res.accountId` Stripe + 3 doc-comments + snapshots). Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153 generateMfaSecret()` + `:154 assertMfaSecretNotPlaceholder`;
  sentinel só blocklist (`mfa.ts:66`); login sem MFA = correto (Marco-3, `auth/service.ts:86`). **NÃO implementar "rejeitar
  sentinel"**. CLAUDE.md §8 l.171 stale (doc).
- **`mark-no-show-is-not-a-code-bug`** `[REFUTED, carry]` — OpenAPI serve `/appointments/{id}/no-show` casando o handler.
  **Não re-flagar.**
- **`booking-main-path-exactly-once-sound`** — advisory xact-lock + recount in-lock + unique index + replay 23505
  (`booking.ts:223-263`); POST honra `Idempotency-Key`; é o **único** path coberto pelos testes. **Não flagar.**
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc|pan`=**0**); decimal `numeric(10,2)`; webhooks
  dedupe-aware + org-scoped (cross-tenant paid-flip impossível `webhook-platform.ts:67-73,90-97`); over-refund replay-safe
  (`service.ts:515`); ambos webhook-secrets + `AEAD_MASTER_KEY` `requiredInProd` (`env.ts:198,200,203`);
  `money-mutation-http-idempotency` by-design (`manual:<id>` + ON CONFLICT); HMAC correto nos 4 (metaapi timing-safe ±300s
  `service.ts:48-57`, Stripe `constructEvent`, Clerk svix, Google timing-safe).
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:64-65,68-69,93-95`). Coexiste
  com o token-IDOR (autenticidade ≠ autorização). `idempotency-on-callbacks` **REFUTED** (state-machine, `/complete`→409
  `lockForCompletion harness-callbacks.repository.ts:126-134`).
- **`env-hardening-conformances`** — `LOG_LEVEL=debug/trace` **proibido em prod** (`env.ts:215-221`); `TEST_AUTH_BYPASS_ENABLED`
  double-guarded (`env.ts:151-158` + `:225-231`; espelhado em clerk-auth/organization-scope); CORS `origin:false`
  (`server.ts:121`); helmet registrado (`:109`); `sql.raw(COLS)` const estática. **NOVO (v: PILOT):** `__startedAt` é setado
  no **1º** onRequest hook (`server.ts:152`), antes de qualquer auth preHandler → 401/429 **são contados** (tráfego
  auth-rejeitado NÃO é blind-spot de métrica — **REFUTA** o claim adjacente).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|bevox_observer`;
  `requireStaff({roles})`→403 (`:165-169`); observer excluído de actions (`actions.routes.ts:11`), incluído em reads/SSE.
- **`impersonation-org-claim-is-dead-branch`** `[DE-ESCALADO do 10-27 "non-functional model"]` — `organization-scope.ts:57`
  trata `impersonation_id` (PK de staff_impersonations) como claim de org, **mas** nenhuma rota pareia `requireStaff`+
  `requireOrganizationScope` (grep interseção = 0; os 12 callers de `requireOrganizationScope` são Clerk-guarded; os 3
  staff-ops usam só `requireStaff`) → o branch **nunca executa** → o defeito PK-vs-UUID é **dead code inerte**, não um modelo
  de tenancy operante-mas-quebrado.
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` canon-correto (§11.2 l.1203); CHECK
  (`appointments_range_check` end>start `calendar.ts:160`, `sessions_remaining>=0` `payments.ts:216`, `confidence∈[0,1]`
  `customers.ts:132`); **migrations journal íntegro (21 entradas = 21 `.sql`; 0 `gen_random_uuid`/`uuid_generate_v4`)**;
  ADR-023 = migration 0016; ADR-022 policy-json materializada; sessions numeric→integer em 0015; `refunds` ainda sem
  `updated_at` (substrato do 42703, inalterado). **Contagens:** **45** tabelas `pgTable` live; **91** `.references()` TS
  (**≈93** FK-DB); **18** org-FK fully-unindexed; **10 full + 3 partial + 3 PK-as-org** org-indexed.
- **`route-recount-conformant`** — 103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 /
  11 undoc; bijeção 106−11=95 verificada. **5 refutações adversariais** desta passada (evidência negativa fresca): availability
  query-param (openapi:2036-2047 casa Zod), connect-return/refresh (openapi:3082-3113), `{professionalId}` (spec↔route
  concordam, só nit camelCase), + os 2 do brief (mark-no-show, create-code 201/200).
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (origin/main l.781, verbatim, **sem drift**): 10 delivered
  (aisuggestion, staff-rbac, m4-chatwoot-p1..p4, m5-p4-manual-payment-mode, m5-p3c-multimedia-inbound, m5-p3a-refundpolicy,
  m5-p3b-create-refund-seam) + `backend-psp-br-secondary` **parked** (l.44). **Nenhum** work-item p/ calendar/ADR-010,
  customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker**. Usar
  esta auditoria como o gate.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do piloto + 1 dos
2 jobs de CI vermelhos**.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia (nem override `extra` resgata, nem módulo onboarding existe) → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) + fechar teardown `closeDb()/closeRedis()` (os 57P01) | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado (HS256) não autentica no calendar/money (RS256) → **1ª falha dura do piloto** (gate upstream dos 2 CRÍTICOs — veredito unânime dos 7 auditores) |
| 4 | **`pnpm audit`: `zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**52 highs**, incl. o core de validação `zod` e o core `fastify`) — o platô quebrou (+2 high); re-acende o scanner agendado (dark 09-22→10-27) |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** na fronteira de entrega + CHECK + backfill + teste e2e; **+ corrigir o shape IG do inbound** (`detectProvider` lê `data.messaging`) | **3-5h** | **Pilot-universal**: hoje **100%** das respostas de IA são dropadas em silêncio como `done` (outbound) **e** 100% do inbound IG é não-dispatchado (inbound) — dois bugs 100%-drop independentes |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + `/metrics`+`/healthz` no worker + `w.on('failed')` capturar | **1-2h** | Fecha o buraco (Sentry/Prometheus two-process-registry) dos **11 workers**; logs Pino sobrevivem mas sem alerta |
| 7 | **Adicionar `RETURNING id`+boolean aos 3 UPDATEs guardados de charge** (`markChargePaid/Expired/Refunded`) + gatear efeitos no rowcount + `withRedisLock` no `expireChargeManually` | **~1,5h** | **1 fix fecha 3 superfícies de código**: o bug HIGH irreversível de dinheiro no manual (único vetor externamente alcançável) **E** o path Stripe teórico **E** o audit-falso do expire |
| 8 | **`/metrics` autenticado + bucket de labels** (`event_type`→`"raw"`, `route` unmatched→const) + anexar `requireRateLimit` a `/staff/sessions[/refresh]`+money+webhooks + `.min()`/length-refine nos 19 secrets + `expires_in` do token staff | **~4h** | Fecha a superfície pré-auth composta do `/metrics` (enumeração org-UUID + 2 cardinality-bombs) + o buraco app-wide de rate-limit + o piso de entropia + o bug de contrato `expires_in` |
| 9 | **`GET /appointments` (REST, Clerk + staff-ops)** + emitir SSE `appointment.created`/`charge.updated` + documentar os 7 handlers drift + validador OpenAPI no CI; **+ enforce `Idempotency-Key` em `/charges/manual`** | **4-6h** | "Ver agenda" não tem endpoint **nem** push; fecha o drift silencioso (b) + o duplicate-charge do money-path manual |
| 10 | **Aplicar gate `ai_opt_out`/consent + aviso-automático no intake + `dsr_requests`** + hidratar/corrigir DSR export (incluir profiling+telefone/channels, excluir notes_internal, alcançável) + deleção/soft-delete de **customer** | **8-12h** | LGPD (piloto roda com PII real; ingestão ungated, 5 cópias não-apagáveis, DSR **vazio p/ a população real** + inacessível, erasure só p/ users) |
| — | Higiene batch: `message_id → m.id` (~15min, destrava toda dispatch de IA) + `buildDispatchMessages` LIMIT + proposal-idempotency_key (cross-repo); vincular token de callback ao `:id` (IDOR); harness `status` POST→PATCH + errata canon l.447 (cross-repo); StatusHistory + `created_by`/`confirmed_at` + matriz de transição (`cancelled→confirmed`/`completed→cancelled` + resync Google); índices FK (~55 + `customers`); FK snapshot-drift 0012; versão/tag SemVer (22 commits); docs stale (CLAUDE.md §8 + rules harness/db/routes); `rm .claude/state/gap*.js`; `amount_total.max`+currency CHECK; deletar `newOpaqueId`/`verifyStaffRefreshToken` | **~24h** | Contrato harness + agenda-correção + perf GA + LGPD-audit + money-hardening + governança |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — `message_id` não-UUID → ZodError **pré-enqueue** em toda
  dispatch de IA (CAUSA inércia do harness + orphan-pending + MASCARA unbounded/active_execution_id/skills/proposal-key);
  `status`-callback POST vs PATCH 404 total (root-cause único; backend canon-correto §10.4; fix harness→PATCH + errata canon
  l.447); **`proposal-missing-idempotency_key`** (harness emite proposals sem a key que o backend exige → 2º dominó, draft→approve
  400); `strategy='failed'`→não-`error`, `aborted_*`→400, skills vazio, `/stream` **wired-mas-config-gated** (não "off"),
  `/traces`-sem-produtor, token-IDOR, `applyStatusTransition`-unguarded (vira vivo pós-fix do 404), callback-base-url ignorado,
  `/complete` 409-vs-410. **`/complete` bodyOrgId cross-tenant DE-ESCALADO** (harness não envia `organization_id` → inerte).
  Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` (`messages/schemas.ts:7`)
  **re-confirmado** → `wa`/`ig` do backend causa o drop de **outbound** (pilot-universal); **NOVO:** o shape IG do **inbound**
  (`data={messaging}`, `inbound/service.ts:246-249`) não casa `detectProvider` do backend → **100% do inbound IG
  não-dispatchado** (cross-repo, root-cause confirmado nos 2 repos).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um
  principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona. A DSR export também é Clerk-only →
  inacessível ao ator semeado. JWKS instance-scoped (de-escala o aud/iss-gap p/ MÉD).
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`); refund manual não
  passa por webhook; o reconcile de refund Stripe está **DOA (42703), cron-only mas LIVE-wired**; `intent-reconcile`
  half-applies; `reconcile-fifo-starvation`; o money-bug #1 compartilha `applyChargePaid` com o webhook **mas o path Stripe não
  é externamente manufaturável** (dedupe `event.id`). Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer
  auth interativa — indisponível nesta sessão headless** (reportado; não bloqueante p/ auditoria de código).
- **canon (`bevox-knowledge origin/main` @ `7874971`)** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score
  **Opção C vinculante**), backend/ADR-009 (identidade canônica) não-implementadas; _shared/ADR-019 (bases legais → gate
  consent + aviso + captura), _shared/ADR-020 (retenção → scoping de message_records/received_events, `created_at` de servidor,
  retention worker, DSR deletion + `dsr_requests`). Drifts "canon-atrás-do-código" (`/status` POST↔PATCH l.447, `create-refund`,
  `dead_letter` no enum, `/complete` 410) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra, `origin/master` @ `fd1373b`)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa
  `v1.0.1` (sem os 22 commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem
  principal Clerk); a network-policy do `/metrics` é o único controle do vazamento+inflação de org-UUID.
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` desde **09-22** até 10-27 (~5 sem); hoje (quarta) sem
  slot vencido → gate agendado dark; causa não-introspectável offline. Os commits de audit são **locais** (nunca pushados) →
  `ci.yml` não roda neles.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs são
  invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-27)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/ db/`
**vazio**; `HEAD` = o commit do próprio audit 10-27; `describe` `v1.0.1-38` (era `-37`).

**Ground-truth (mensurável):**
- **`ci-security` PLATÔ QUEBROU (no nível de contagem):** **120 vulns / 10 low / 58 moderate / 52 high / 0 critical** hoje vs
  **115 / 10 / 55 / 50** no 10-24..10-27 → **+5 total / +2 high / +3 moderate**. O conjunto de **módulos-high é byte-idêntico
  (os mesmos 19, 5ª passada no nível de módulo)** → advisories novas sobre pacotes já presentes (não há dep nova). Tendência
  high **12→15→18→49³→50⁴→52**. Prova estrutural: a dívida de segurança de um lockfile congelado **cresce** com a base de
  advisories mesmo sem mudança de código.
- **`ci-tests`:** RED idêntico (mesmo flaky `booking_notice:259` ~09:10 UTC), com **2× unhandled 57P01** (idêntico ao
  10-26/10-27). Fast-gate GREEN idêntico (Unit **469/469, 69 files**; Typecheck/Format/OpenAPI-parse/Build+alias-gate ✓).
- **`ci-scheduled-runs-dark`:** janela estendida p/ **09-22→10-27** (último run = CodeQL slot 10-27 às 11:14 UTC,
  `startup_failure`). Hoje (10-28, quarta) **sem slot cron vencido** — não é regressão.
- **lint:** RED local idêntico (5 `.claude/state/gap*.js` gitignored, **0 adicionados**) → CI-GREEN.

**0 REFUTAÇÕES DE CÓDIGO (7ª passada consecutiva, 10-22..10-28):** nenhum dos 7 agentes achou o código divergindo de uma
âncora — o produto faz **verbatim** o que cada achado afirma (tentativas adversariais explícitas em AUTH, LGPD, money, harness,
schema, routes — todas confirmaram o código). **Porém esta é a passada mais ativa em RE-CALIBRAÇÃO desde o início da série:**

**~14 DE-ESCALAÇÕES de alcance/severidade de itens carregados (fato de código confirmado; severidade/reachability corrigida):**
1. **MONEY — o órfão no path Stripe NÃO é externamente manufaturável** (dedupe `event.id`; Stripe emite 1 succeeded/PI) → a
   raiz-única e o fix de 1-ponto standem, mas o vetor externo é **só** o manual mark-paid. (O 10-27 "manufaturável no path
   Stripe" era over-reach de reachability.)
2. **HARNESS — `/stream` é wired-mas-config-gated**, não "desligado/sem-produtor" (`sendStreamChunk` é shape-correto; falta só
   `STREAM_ENABLED`+flag `stream` que o backend nunca envia) → só `/traces` é genuinamente sem-produtor; "só 1 de 4 callbacks
   vivo" precisa dessa nuance.
3. **HARNESS — `/complete` cross-tenant `bodyOrgId` é INERTE** (o body do harness não tem `organization_id` → fallback ao org
   correto). Assertion faltante real, mas não vetor vivo.
4. **CHANNELS — `pre-HMAC DB amplification` MÉD→LOW** (leituras O(1) indexadas; o DoS pré-auth real são os 2 cardinality-bombs).
5. **AUTH — `impersonation-id-is-not-organization-id` → dead branch inerte** (nenhuma rota pareia `requireStaff`+org-scope → o
   branch nunca executa).
6. **AUTH — `clerk-jwt-no-aud-iss` ALTO→MÉD** (JWKS instance-scoped → atacante externo não cunha token).
7. **LGPD — `dsr-export-leaks-notes_internal` → latente** (o operador que exporta já vê via `GET /customers/:id`; sem superfície
   incremental). (Era NOVO no 10-27.)
8. **LGPD — `audit_events-não-customer-scoped` → "parcialmente realizável"** (tem `entity_type/entity_id` indexado; o gap é
   cross-entity).
9. **SCHEMA — `partial-index-trap` → LOW** (o partial de `customer_facts` é PRD §11.2 verbatim, spec-correto).
10. **PILOT/OBS — `worker-black-hole` não é blackout de logs** (logs Pino sobrevivem; o defeito é Sentry-off +
    Prometheus-unscrapable).
11. **PILOT/OBS — §12.8 "zero audit trail" superestima** (há `google_sync_outbox` + sync-audit p/ orgs Google-connected;
    descumprido só no path manual).
12. **ROUTES — `operationId:0 breaks codegen` → só degrada SDK operationId-based** (o gerador deste repo keya por path+method).
13. **ROUTES — `429-undocumented` → moot** (nenhuma rota emite 429).
14. **ROUTES — `idempotency-key-param 32/52` → o defeito é a descrição overclaimar**, não cobertura por-op (que é deliberada).

**~6 REFUTAÇÕES ADVERSARIAIS de claims-novos-plausíveis** (evidência negativa fresca; não entraram como achados):
`appointments.customer_package_id` **não** é FK dangling (0012 a adiciona); `auth-rejected-traffic` **não** é blind-spot de
métrica (`__startedAt` pré-auth); availability query-param, connect-return/refresh, `{professionalId}` todos **sincronizados**
OpenAPI↔rota.

**~18 MISSES NOVOS (quase todos latentes / governança; 3 de valor real alcançáveis no piloto):**
- **ROUTES:** `idempotency-required-header-unenforced` (**pilot-money** → charges duplicadas); webhook-doc-exemption-inconsistente.
- **SEC/CHANNELS:** `event_type-cardinality-bomb` (**pré-auth DoS**); `ig-inbound-silent-nondispatch` (**100% IG inbound dropado**,
  cross-repo); `metaapi-audit-duplicate-on-retry`.
- **PILOT/OBS:** `http-metrics-route-label-cardinality-blowup` (2º bomb, compõe com o `/metrics` não-auth);
  `resurrect-google-divergence`; `canonical-ingestion-counter-dead-while-shadow-lives` (há shadow counter vivo).
- **AUTH:** `impersonation-audit-writes-zero-rows` (catch-all vácuo); `staff-ops-getWindow-crossorg-PII-unaudited`;
  `staff-refresh-tokens-unbounded-no-prune`.
- **HARNESS:** `proposal-missing-idempotency_key` (2º dominó atrás do message_id-poison); `applyStatusTransition-unguarded-regression`.
- **LGPD:** `dsr-export-omits-titular-phone-and-channels` (**DSR vazio p/ a população real**); `customers-have-no-erasure-path-at-all`
  (nem o soft-delete desenhado tem writer); `is_private-facts-disclosed`; `received_events.signature_valid`-hard-coded-TRUE.
- **SCHEMA:** `appointments-customer-package-fk-snapshot-drift` (1ª landmine de schema-thaw; FK-DB real ≈93); `stripe-webhook-events-org-set-null-orphan`.

**Correções de linha/contagem:** `describe -38` (era -37); 57P01 = **2×**; inline `.parse` = **160** (era "~148"); `new Worker(`
= **11**; `.references()` TS = **91** (FK-DB **≈93**); **18** org-FK fully-unindexed; **10 full + 3 partial + 3 PK-as-org**;
**45** tabelas; `requiredInProd` secrets = **19**; 4 de 5 índices críticos §11.3 ausentes; path metaapi = `src/modules/channels/metaapi/`.

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH pilot-universal);
`manual-remark orphan` (HIGH irreversível, manual reachable); `reconcile-refund-42703` (cron-only); `callback-token-IDOR`;
`rbac-org-role`; `clerk-provisioning`; `message_id`-poison + `status`-method 404 + `active_execution_id` wedge; toda a bateria
LGPD; worker-telemetry; priority-score/templates Marco-2/3; version-drift (22 commits, nenhuma imagem pós-`v1.0.1`);
scheduled-CI-dark; docs/CLAUDE.md/README staleness.

**Arco desde a passada mais antiga (06-02):** os 3 CRÍTICOs originais foram fechados/recaracterizados; os 2 CRÍTICOs atuais
(grade + calendar no seed) persistem há ~4 meses atrás do gate auth-actor (isolado 07-20, re-confirmado 11×). A frente de
CRÍTICOs está **estável e sem correção há ~4,9 meses**; nesta passada o platô de segurança **quebrou** pela 1ª vez em 4
passadas (+2 high, mesmos 19 módulos), o scanner agendado segue dark há ~5 semanas, e a série registrou sua passada mais
densa em **re-calibração** (0 refutações de código mas ~14 de-escalações + ~6 refutações adversariais + ~18 misses) — valor
incremental em **precisão de severidade/reachability**, não descoberta de regressão.

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a
**re-verificar de fonte-primária** o inventário do 10-27 do seu domínio contra o **código atual** com evidência fresca
`file:linha`, a **REFUTAR** adversarialmente (≥2 por domínio, com a lista explícita de de-escalados a NÃO re-flagar), e a caçar
misses. **5 usaram agent-types locais** deste repo (`.claude/agents/`): `harness-callback-auditor` (l),
`backend-staff-rbac-reviewer` (auth), `backend-schema-migration-engineer` (schema/índices/tracker h), `backend-route-reviewer`
(b), `Security Engineer` (payments j + channels k); **2 general-purpose** (LGPD g; pilot/calendar/obs a+m+e). **Resultado
agregado: inventário do 10-27 re-confirmado, 0 refutações de código (7ª passada), ~14 de-escalações de alcance/severidade, ~6
refutações adversariais de claims-novos, ~18 misses NOVOS.** Tallies por agente: AUTH confirmed=9/de-esc=2/new=3; HARNESS
confirmed=todos/de-esc=2/new=2; LGPD confirmed=7/de-esc=2/new=4; SCHEMA confirmed=todos/refut=1/de-esc=1/new=2; PILOT
confirmed=todos/refut=1/de-esc=2/new=3; SEC confirmed=todos/de-esc=2/new=3; ROUTES recount-exato/refut=~4/de-esc=3/new=2.

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD -- src/
db/` = vazio; last-commit-touching src/ **e** db/ = `dbd231e`; describe `v1.0.1-38`); origin/main dos 5 repos (backend dbd231e /
canon 7874971 / harness 2979eb0 / meta-api 5516c2a / hub fd1373b, inalterados); léxico legado (grep triado = zero executável; 3
crus = doc-comments); MFA (seed `generateMfaSecret` + assert firsthand; CLAUDE.md §8 l.171 stale); debt (0 FIXME/HACK/XXX, 1
@deprecated `orchestration/repository.ts:348`, ~4 TODO Marco-2/3); PCI-nil (grep=0); canon (tracker 10+1 l.781, PRD §16.1 "CI
verde" verbatim l.1483, ADR-statuses 009/010/013/014/018/019/020/021/022/023 aceita + 016 proposed + 011 superseded lidos de
origin/main); version-drift (`merge-base --is-ancestor dbd231e v1.0.1` = FALSE, 22 commits, 4-way); scheduled-CI (`gh run list`
→ startup_failure 09-22→10-27).

**Ground-truth de CI rodado de fato** (2026-10-28 ~09:10 UTC): Typecheck ✓ / Format ✓ / Build ✓ (incl. alias build-gate) /
OpenAPI-parse ✓ / Unit ✓ (**469/469, 69 files**) = **GREEN**; `test:integration` = **RED exit 1** (`1 failed | 92 passed (93)`,
flaky `booking_notice:259` ~09:10 UTC < 13:00 + **2× teardown 57P01**); `pnpm audit --audit-level high` = **RED exit 1, 120
vulns / 52 high** (10 low · 58 moderate · 52 high · 0 critical; **19 módulos-high byte-idênticos ao 10-27, +2 advisories**);
`lint` = RED por artefato local (5 `.claude/state/gap*.js` gitignored → CI GREEN; 0 adicionados). **Estado GitHub:** scheduled
runs em `startup_failure` (0s) 09-22→10-27 (último = CodeQL 10-27 11:14 UTC); sem slot cron hoje (quarta).

**Canon.** Lido por path absoluto `~/bevox-knowledge` via `git show origin/main:<path>` (ADR-005). Numeração de ADR
**colide** entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner / CodeQL não
reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta reais) não
exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de writers/endpoints +
CI rodado (incl. 14 suítes de integração live Postgres+Redis via testcontainers) + cross-repo byte-level (harness
`bevox-callback.ts`, meta-api `messages/schemas.ts`+`inbound/service.ts` lidos de `origin/main`). (4) MCP `stripe` +
`claude.ai Google Drive` requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5)
Esta passada é re-verificação sobre código byte-idêntico; o valor incremental é **CI fresco (Security +2 high / platô quebrou;
fast-gate GREEN; Tests RED idêntico; scheduled-dark estendido) + 0 refutações de código (7ª passada) + ~14 de-escalações de
severidade/reachability + ~6 refutações adversariais + ~18 misses NOVOS (3 de valor real pilot-reachable: idempotency-header
unenforced, cardinality-bombs pré-auth, IG-inbound-dropado) + correções de linha/contagem**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-28. Sem alteração de código de produto; somente
este relatório. Revisão humana pendente.*
