# Gap Analysis — bevox-backend — 2026-10-30

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo segundo a
> documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (agent-types locais — `harness-callback-auditor`,
> `backend-staff-rbac-reviewer`, `Security Engineer` + 4 `general-purpose`), cada um re-verificando **de fonte-primária**
> o inventário do 10-29 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR**
> adversarialmente (≥2 por domínio, com a lista explícita de de-escalados a NÃO re-inflar) + caçar misses;
> **verificação independente de fonte-primária pelo orquestrador** (freeze, CI, canon `origin/main`, léxico, MFA, debt,
> version-drift, 2 CRÍTICOs, roots de dinheiro/dispatch, docs-stale); e **CI rodado de fato** (2026-10-30 ~09:03 UTC, não
> inferido). Sucede `runtime-gap-audit-2026-10-29.md`.

## Resumo executivo

**18ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,9
meses.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é **vazio** (produto byte-idêntico a `dbd231e`,
2026-06-03; `git describe` = `v1.0.1-40-gc5091aa`, o `-40` são commits de audit docs-only — era `-39` no 10-29). Canon
`bevox-knowledge origin/main` @ `7874971`, `bevox-harness origin/main` @ `2979eb0`, `bevox-meta-api origin/main` @
`5516c2a`, hub `bevox-PRD-consolidation origin/master` @ `fd1373b` — **todos inalterados vs 10-29**.

**Manchete-delta — o platô de segurança segurou pela 3ª passada consecutiva, e o único sinal de CI que se mexeu foi um
flaky NOVO (ambiental, não de código) na suíte unit.** Dois fatos, ambos de precisão:

1. **`pnpm audit --audit-level high` = RED, 120 vulns / 10 low · 58 moderate · 52 high · 0 critical — byte-idêntico ao
   10-29** (os **mesmos 19 módulos-high**, as mesmas contagens por-módulo: `undici`=10, `brace-expansion`=10, `fast-uri`=7,
   `fastify`=4, `@grpc/grpc-js`=3, `js-yaml`=3, `protobufjs`=2, `nanoid`=2, + 11×1 incl. `zod`). **3ª passada consecutiva a
   52.** Tendência high: **12→15→18→49³→50⁴→52³**.
2. **A suíte `pnpm test` (unit) virou intermitentemente-flaky.** No 10-29 era **469/469 GREEN** estável; hoje a **1ª** rodada
   full-paralela deu **2 failed | 467 passed (469)** (testes de Sentry/`instrument`), mas o teste **passa em isolamento** e a
   **2ª rodada full deu exit 0 (469/469)** → **test-pollution flaky** (estado global do SDK Sentry sob vitest paralelo),
   **ambiental, NÃO regressão de código** (o produto é byte-idêntico). É o **3º flaky** da matriz de CI (junta-se ao
   `booking_notice:259` dependente-de-hora e ao teardown `57P01`), e significa que o job `Unit` — antes verde-estável —
   **pode agora piscar vermelho**.

**Principais riscos (inalterados):** o piloto **morre no passo 2 ("ver agenda")** — não é executável como semeado.
Veredito unânime dos 7 auditores + orquestrador: **login → OK; ver-agenda → 1ª FALHA DURA = 401 auth-actor** (`clerk-auth.ts:89-97`
pina RS256; o seed cunha JWT staff HS256). Atrás desse gate, os dois CRÍTICOs de agenda persistem há ~4 meses: **o seed não cria
Calendar** e **`professional_schedules` não tem escritor em lugar nenhum do app** — e esta passada isolou o **porquê sistêmico**:
o `advance` do onboarding (`organizations/repository.ts:151-159`) é um **UPDATE de enum sem guarda e sem efeito colateral**, então o
estágio `schedule` do onboarding "completa" sem gravar uma única linha de grade → 100% dos agendamentos = `slot_conflict`,
app-wide. O money-path manual **funciona** (ADR-023 aceita) mas carrega 1 bug HIGH **irreversível** (re-mark órfão). Os dois
dropes de canal **pilot-universais** persistem (100% das respostas de IA WA dropadas em silêncio como `done`; 100% do inbound IG
não-dispatchado). E o único bloqueador **mensurável** de Marco-1 pelo canon (PRD §16.1 l.1483 "CI verde") segue **RED** (Tests +
Security), com o gate agendado **dark há ~5,5 semanas** (09-22→10-27).

**Resultado dos 7 auditores:** inventário do 10-29 re-confirmado **verbatim**; **0 refutações de código** (corpus carregado
permanece 0-refutado — ~9ª passada); **~18 misses NOVOS** (a maioria LOW/latente/governança; **1 MÉD-HIGH no pilot-path**:
onboarding-advance guardless) + **3 de-escalações** (não re-inflar) + várias sharpenings e correções de contagem.

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte-primária esta sessão (repetem-se vs 10-29 porque o brief é o mesmo):

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`, re-confirmado firsthand) — **não** `/complete,/artifact,
   /tool-result,/turn` como o brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (`aceita`), **não "channels"**. **Channels = _shared/ADR-011.**
   backend/ADR-018 = refund/cancellation (`aceita`). O range "0011 a 0018 Marco-1" do brief é aproximado; lido **firsthand de
   origin/main hoje**: backend/ **008/009/010/012/013/014/015/017/018/019/020/021/022/023 = `aceita`**; **016 (token-billing) =
   `proposed`** (→ corretamente NÃO implementado); **011 = `Superseded by ADR-019`**. _shared/ADR-019 (bases legais LGPD, `aceita`
   2026-04-23) + _shared/ADR-020 (retenção, `aceita`). **Colisão de numeração**: `backend/ADR-020` = MessageTemplate, `_shared/
   ADR-020` = retenção; `backend/ADR-021` = priority-score-formula, `_shared/ADR-021` = tenancy-organizationId — sempre qualificar.
3. O grep `account_id\b`/`accountId` do brief captura dezenas de ocorrências em `src/`/`db/`, **todas sancionadas** (composites
   `chatwoot_account_id`/`external_account_id`/`payment_account_id`/`channel_account_id`, alias `AS account_id`, propriedade
   Stripe `res.accountId`, doc-comments, snapshots drizzle). O léxico de **tenant proibido** (`workspace_id`/`workspaces`)
   **executável é ZERO**; os **3** hits crus são **doc-comments** (`organizations/routes.ts:3`, `db/schema/autonomy.ts:3`,
   `autonomy/routes.ts:5`). Invariante §4.1 mantida — **não-gap**.
4. **MFA sentinel (categoria d) — não há bug a corrigir** (verificado firsthand). `scripts/seed-pilot.ts:153` chama
   `generateMfaSecret()` (base32 160-bit) + `:154 assertMfaSecretNotPlaceholder()` e grava um secret **real** (`:165`). O
   sentinel `PILOTSEEDONLYNOTASECRET` só aparece como **doc-comment** da blocklist (`src/shared/mfa.ts:66`). Login staff sem MFA é
   **correto** (TOTP é Marco-3, PRD §16.3/ADR-013; `auth/service.ts:84-86`). **NÃO implementar "rejeitar o sentinel"** (é moot). Fix
   de código = **0h**; o único resíduo é a prosa de **`CLAUDE.md §8 l.171`** (factualmente stale — ainda afirma literalmente que o
   seed grava `mfa_secret = PILOTSEEDONLYNOTASECRET`). Vai pro doc, não é bug.
5. **A premissa da categoria i do brief está stale.** O brief diz "Tests (harness-contract FK seeding, issue #36)" e "Lint &
   Format (prettier debt)". Ambos **resolvidos**: `pnpm format:check` = **GREEN** ("All matched files use Prettier code style!");
   o Tests-RED atual é o flaky `booking_notice:259` (hora-do-dia) + 2× teardown `57P01` + (NOVO) o flaky de pollution unit, **não**
   #36. O lint-RED é **só local** (5 arquivos `.claude/state/gap*.js` gitignored — `git check-ignore` confirma os 5; **0 adicionados
   nesta sessão**, `git status` limpo) → **CI-GREEN** (checkout limpo não os tem).
6. Código congelado desde **06-03** (`dbd231e`). **RBAC de staff é canon backend/ADR-013** (roles
   `bevox_admin|bevox_support|bevox_observer`, confirmado `staff-auth.ts:33`), **não ADR-022** (backend/ADR-022 =
   `policy-json-sub-keys`, `aceita`). O work-item `backend-staff-rbac` no tracker é `governed_by` ADR-013.
7. O `status`-callback **não é** drift de OpenAPI: é **PATCH** no YAML (`openapi:1821-1822`) **e** no handler (`routes.ts:56`) —
   concordam. A quebra POST-vs-PATCH é **cross-repo** (harness POSTa) — **categoria l, não b** (re-refutado como drift-b esta passada).
8. O path do metaapi é `src/modules/channels/metaapi/`. `pnpm openapi:check` é `openapi-typescript --output -` (**gerador de
   tipos**, exit 0 = só prova que o YAML parseia) — **não** valida rota↔spec, por isso o drift OpenAPI (11 rotas) é invisível ao CI.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1483-1488)** — lido verbatim de `origin/main`; **todos os 6 checkboxes ainda `[ ]`**
  (incl. "Repositório criado; CI verde", migrations pg16, módulos auth/organizations/users/professionals/services/customers,
  OpenAPI publicado, contrato harness documentado+testado com stub, deploy staging Docker Compose). O checklist do PRD é
  **estático/aspiracional** (ninguém marca os boxes); o status vivo mora no delivery-tracker (ADR-023). **Funcionalmente**, tudo
  está materialmente entregue no código **EXCETO "CI verde"**, que é o único bloqueador **mensurável** de Marco-1 e segue **RED**
  (Tests + Security).
- **§16.3 Marco-3** inclui payments Stripe Connect, reminders, **LGPD DSR/retenção/consentimento**, **MFA TOTP**, observabilidade
  completa, rate-limit distribuído. Os CRÍTICOs de agenda são **Marco-2/3-por-rótulo mas pilot-blocking**; o módulo de audit
  (StatusHistory/OperationalMetricSnapshot) é escopo Marco-3 (l.1402). O README "Marco 1 bootstrap" **subdeclara** o que o código
  entrega (calendar + payments-manual + worker assíncrono + channels/metaapi + google-sync). **"Marco-1 concluído?" ≠ "piloto-pronto?".**
- **Status de ADR (origin/main, re-lido hoje):** backend/ 008/009/010/012/013/014/015/017/018/019/**020**/**021**/022/023 =
  **`aceita`**; 016 = **`proposed`**; 011 = **`Superseded by ADR-019`**. **backend/ADR-010 (calendar) e backend/ADR-009
  (customer-identity) são `aceita`** → os 2 CRÍTICOs são escopo aceito, não especulativo. **backend/ADR-020 (MessageTemplate) e
  backend/ADR-021 (priority-score "Opção C") são `aceita`** → vinculantes e não-materializadas.

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-30) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO app-wide, grep=0 firsthand) + raiz sistêmica NOVA = `onboarding-advance` guardless; seed-no-calendar; `StatusHistory`+`OperationalMetricSnapshot`+`created_by`+`confirmed_at` (grep=0); ADR-020 templates + ADR-021 priority-score (client-settable sem CHECK, **inverso de ADR-021 Opção C vinculante**) |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recount reproduzido **EXATO**: `103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 / 11 undoc (7 drift-real + 4 webhooks provider)`; ZodTypeProvider=0; inline `.parse/.safeParse`=**168** (153+15); `api.ts` cego às 11 (NOVO); status-callback PATCH↔PATCH (NÃO drift-b, re-REFUTED) |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO**; 3 "crus" = doc-comments |
| d | MFA sentinel | ✅ **CONFORME** | seed gera base32 160-bit + assert; sentinel só blocklist doc-comment; login sem MFA = correto; **`CLAUDE.md §8 l.171` stale**; fix=0h |
| e | Testes faltando | ✅ | webhook Stripe (`constructEvent`=0 em test/); reconcile só unit-mockado (→42703 CI-invisível); transition/reschedule **não testados** (docstring admite); `getAvailableSlots` **ZERO cobertura**; `seed-pilot.test` false-green (`TEST_AUTH_BYPASS_ENABLED=true` em 10 suítes → o gate HS256↔RS256 nunca aflora no CI); módulos **health/professionals/realtime/services = 0 arquivos de teste dedicados** |
| f | Bugs/dívida | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); **~11** TODO reais, todos Marco-2/3 (o `payments/service.ts:272` "TODOS" é PT, não marcador) |
| g | LGPD | ✅ | ingestão PII **ungated** pré-aviso vs rights-path **RS256-gated** (inalcançável no piloto HS256); **5** cópias de PII inbound cruas + execution_traces (6ª) + **appointments/waitlist desnormalizados (7ª/8ª, NOVO)**; DSR export **stub** (messages/audit `[]`) **omite telefone/channels + superseded-facts**; `customers` sem erasure-path; **zero** base-legal/consentimento/`consent_events`/`dsr_requests` persistidos; **sinks titular-apagáveis ≈ ZERO** |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main l.781-826, verbatim, **sem drift**); **nenhum** work-item p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker** |
| i | CI vermelho | ✅ (rodado 09:03 UTC) | Tests RED (flaky `booking_notice:259` + 2× `57P01`) + Security RED **52 high / 120** (platô **3ª vez byte-idêntico**, 19 módulos); **Unit NOVO-flaky** (2/469 pollution, passa isolado+rerun); format/build/openapi GREEN; lint-RED = 5 `gap*.js` gitignored (0 adicionados) → CI-GREEN; scheduled dark **09-22→10-27** (sem slot hoje, sexta) |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + irreversível** (raiz ÚNICA `repository.ts:395-413` void-returns; refunded-remark=2º row `paid`); `expireChargeManually` **sem `withRedisLock`** + audita-falso; reconcile half-applies + FIFO-starvation + `reconcile-refund-42703` (cron-only LIVE-wired); **DE-ESCALADO: Stripe-path NÃO manufaturável + `payment_accounts` prof-uniqueness imaterial**; PCI-nil (grep=0) |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH pilot-universal** (`wa`/`ig` vs meta-api `whatsapp`/`instagram`; raiz `normalize.ts:35,44`; sem escape semeado); `ig-inbound-silent-nondispatch` (100% IG dropado, byte-level 2 repos) + **`ig-metered-as-accepted` (NOVO)**; `event_type` cardinality-bomb pré-auth; HMAC correto |
| l | Harness dispatch | ✅ | `message_id`-poison **CAUSA inércia do harness** (agora **ambos** os paths: pilot + staff-replay); `status`-callback **POST↔PATCH 404 total** (método=causa única); token-IDOR status-agnóstico; `proposal-missing-idempotency_key`; **PERM-05 Layer-2 fail-OPEN (SHARPEN)**; `/traces` sem-produtor + payload-dropado; `/stream` double-gated (DE-ESCALADO) |
| m | Alçapões do piloto | ✅ (traçado) | veredito unânime dos 7: **quadruple-gated**, 1ª falha = **401 auth-actor** (`clerk-auth.ts:89-97`); money-path manual OK (Clerk-user) + bug HIGH irreversível; `getAvailableSlots` test-invisível **mascara os 2 CRÍTICOs no CI** |
| n | Delta vs audit anterior | ✅ | 10-29 re-verificado; **0 refutações de código** (corpus 0-refutado, ~9 passadas); Security **3º platô byte-idêntico**; **Unit NOVO-flaky**; ~18 misses NOVOS (1 MÉD-HIGH pilot) + 3 de-escalações + correções de contagem |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária por 7
auditores; veredito unânime = NÃO executável como semeado, 1ª falha dura no passo 2:**

1. **LOGIN (staff) — PASSA mecanicamente.** `seed-pilot` cria org + `bevox_admin`; `loginStaff` (`auth/service.ts:64-90`) é
   password-only (MFA seam presente não-enforced `:84-87`); cunha JWT staff **HS256** (`staff-auth.ts:70`). **Sem
   rate-limit/lockout** (`auth/routes.ts:90` sem preHandler; `requireRateLimit` 0 callers).
2. **VER AGENDA — 1ª FALHA DURA = 401 (auth-actor).** `GET .../availability` (`calendar/routes.ts:48`) é gated por `read`
   (`:22`); `requireClerkAuth` aceita **só RS256** (`clerk-auth.ts:89-90`). O único principal semeado é staff **HS256** → **401 no
   preHandler, antes do handler**. **Quadruple-gated:** `401 auth-actor` → (se corrigido) `404 no-calendar`
   (`availability.ts:75`, **CRÍTICO-2**) → `grade vazia app-wide` (`availability.ts:126`, **CRÍTICO-1**, `professional_schedules`
   grep-0-writers) → `sem payment_accounts semeado`. A tabela `users` é **não-bootstrappável** (`req.user` universalmente null).
3. **AGENDAR — BLOQUEADO a jusante.** **Main-path exactly-once É SÃO** (advisory xact-lock + recount in-lock + unique index +
   replay 23505, `booking.ts:223-263`) — e é o **único** path que os testes cobrem. `rescheduleAppointment` roteia pelo
   `createAppointment` são → **capacity-sound, NÃO re-flagar como defeito de transition**. `transitionAppointment`
   (`booking.ts:424-474`) tem UPDATE incondicional any→any (comentário `:436-438` admite) + `cancelled→confirmed` over-book + 
   `completed→cancelled` não-restaura pacote — **não-testados por admissão do autor** (`calendar-booking.test.ts:18-24`).
4. **COBRAR — money-path manual FUNCIONA (via Clerk-user; não hands-off-seedável).** Serviço semeado sem `requiresPrepayment` +
   `seed-pilot` não cria `payment_accounts`. **1 bug HIGH irreversível** (refunded-remark insere 2º row `paid`); overflow 500 em
   `amount_total` ≥ 1e8. `/charges/manual` + `/refund-manual` usam o preHandler `write` que **ENFORCE** a `Idempotency-Key` (400 na
   ausência) → **sem duplicate-charge** (claim do 10-28 segue REFUTED).
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura (`constructEvent`=0 em
   test/); reconcile cru `half-applies paid`; reconcile de refund DOA (42703) — cron-only mas live-wired; manual não afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[SHARPENED]`/`[DE-ESCALADO]`/`[REFUTED]` = status vs 10-29; **(v: …)** = verificação; `[xrepo]` =
dependência cruzada. Severidade ancorada no gate do **piloto**; escalonamento p/ GA anotado. `file:linha` = evidência lida **nesta**
sessão sobre código byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO firsthand — orquestrador + SCHEMA + PILOT)** — Nenhum caminho
  do app escreve `professional_schedules` (grade semanal-base; `db/schema/calendar.ts:41-62`, DB-real desde `0008`). Grep de
  `INSERT`/`UPDATE`/`.insert(` sobre a tabela em `src/`+`scripts/` = **0**; único hit app-wide é o SELECT `availability.ts:116`
  (+ doc-comment `:5`). Único writer repo-wide = fixture SQL `seedFullSchedule` (`test/integration/calendar-booking.test.ts:120`).
  `createScheduleOverride` (`calendar/repository.ts:97`, wired `routes.ts:41`) escreve `professional_schedule_overrides` (tabela
  **diferente**). **Escape-hatch REFUTADO:** `availability.ts:126 if(!sched) continue` executa **antes** da leitura do override
  `extra` (`:154`) → um override não resgata um profissional gridless. Downstream: `booking.ts:200 getAvailableSlots`→`:207 if
  (!slot) return {status:"slot_conflict"}`. Escopo backend/ADR-010 **aceita**. — Impacto: 100% dos agendamentos = `slot_conflict`,
  app-wide. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (seedar grade). **#1.** `[xrepo: hub runbook invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO firsthand — orquestrador + SCHEMA)** — `seed-pilot.ts`
  importa só organizations/staffAccounts/professionals/services (`:33-35`) e tem exatamente **4** `.insert(`: organizations
  (`:110`), staffAccounts (`:157`), professionals (`:195`), services (`:217`). Zero `calendars` → `availability.ts:75
  notFound("Calendar")`. `createCalendar` existe (`calendar/repository.ts:20`) e está route-wired (`routes.ts:38`) com **exatamente
  1 caller = a rota HTTP** (sem worker/bootstrap). `professional_services` não semeado → fallback "todos bookáveis"
  (`availability.ts:91-96`). `system_holidays` omitido é **fail-open** (`:108-111`), não co-bloqueador. — Esforço: **2-3h** (seedar
  Calendar + grade Seg-Sex + feriados). **#1.** `[xrepo: hub]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×3 — PILOT + AUTH + orquestrador)** — seed
  provisiona **só** org + `staff_account` (HS256, `staff-auth.ts:70`); toda rota de calendar/money é `requireClerkAuth()` RS256
  (`calendar/routes.ts:22,48`; `payments/routes.ts:51,53,59`; `clerk-auth.ts:89-90` pin RS256). Ponto exato da 1ª falha dura =
  **`clerk-auth.ts:89-97`** (`jwtVerify(..., {algorithms:["RS256"]})` rejeita o `alg:HS256` → 401 no preHandler). `grep
  requireStaff|requireRole src/modules/calendar src/modules/payments` = **0**. A tabela `users` é **não-bootstrappável**:
  `user.created` exige row `users` pré-existente p/ resolver a org (`auth/repository.ts:221-223`), mas o único writer de `users` É
  esse webhook → `req.user` universalmente null. **1ª falha dura do piloto.** — Esforço: ops (Clerk) OU ~4-6h (rota calendar
  staff-scoped). `[xrepo: Clerk]`

**Raiz sistêmica dos CRÍTICOs de agenda (NOVO desta passada)**

- **`onboarding-advance-is-guardless-enum-setter-no-side-effects`** `[NOVO, MÉD-HIGH pilot]` **(v: CONFIRMADO — SCHEMA)** —
  `POST .../onboarding/advance` (`organizations/routes.ts:71`) → `advanceOnboarding` (`organizations/repository.ts:151-159`) é um
  `UPDATE organizations SET onboarding_stage=$stage` **incondicional**; o schema (`organizations/schemas.ts:35`) só enum-valida o
  stage. PRD §18 l.616 manda validação de pré-requisito ("não avança a `services` sem ≥1 professional ativo"). Um cliente pode
  pular p/ qualquer stage — incluindo pular `schedule` — e o estágio `schedule` **não escreve nenhuma linha de
  `professional_schedules`**. **É a raiz sistêmica do CRÍTICO-1**: o onboarding reporta "completo" com a grade vazia → 100% dos
  bookings = `slot_conflict`. É um enum-setter free-form, não uma máquina de estados. (A máquina de estados do onboarding **existe**
  — refutei que o "Módulo 18" fosse ausente; o defeito é que o `advance` não tem guarda nem efeito.) — Esforço: **M.** `[a; xrepo:
  PRD §18]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-30; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice`** `[carry]` **(v: RODADO 09:03 UTC)** — `pnpm test:integration` = **RED exit 1**, `1 failed |
  92 passed (93)` / `Test Files 1 failed | 13 passed (14)` / `2 errors`. Falha = `calendar-booking.test.ts:259` "slot_conflict
  quando start_at < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be 'slot_conflict'` (gate só dá
  slot_conflict se `now() > ~13:00 UTC`; rodei 09:03 UTC → `booked`). **Com 2× unhandled `57P01`** (teardown testcontainers; "terminating
  connection due to administrator command"). `ci.yml:73,80` roda `pnpm test` + `pnpm test:integration` **sem continue-on-error**. —
  Esforço: **0,5h** (slot `now()`-relativo + fechar `closeDb()/closeRedis()`). **#2.**
- **`ci-unit-suite-newly-flaky-sentry-instrument-pollution`** `[NOVO, ambiental]` **(v: RODADO ×2 + isolamento)** — `pnpm test` deu
  **2 failed | 467 passed (469)** na 1ª rodada full-paralela (testes de `instrument`/Sentry, área `server-sentry.test.ts`/
  `instrument*.test.ts`); **passa em isolamento** (`vitest run test/unit/instrument.test.ts` = 1 passed) **e** a 2ª rodada full deu
  **exit 0 (469/469)**. → **test-pollution flaky** (estado global do SDK Sentry sob vitest paralelo), **ambiental, NÃO regressão de
  código**. No 10-29 era 469/469 estável → é delta observável: o job `Unit` pode piscar RED. — Esforço: **0,5-1h** (isolar o
  `vi.stubEnv("SENTRY_DSN")` / rodar os testes de instrument em pool `forks` isolado). **BAIXO-prioridade mas novo.**
- **`ci-security-red-pnpm-audit-52-high`** `[carry, 3º PLATÔ byte-idêntico]` **(v: RODADO)** — `pnpm audit --audit-level high` =
  **RED exit 1, 120 vulns (10 low · 58 moderate · 52 high · 0 critical)** — **os mesmos 19 módulos-high, as mesmas contagens
  por-módulo** que o 10-29/10-28 (`undici`=10, `brace-expansion`=10, `fast-uri`=7, `fastify`=4, `@grpc/grpc-js`=3, `js-yaml`=3,
  `protobufjs`=2, `nanoid`=2, + 11×1: `tmp`, `@opentelemetry/propagator-jaeger`, `find-my-way`, `@fastify/static`, `postcss`,
  `source-map-js`, `@opentelemetry/exporter-prometheus`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/sdk-node`,
  `vite`, `zod`). `zod@4.4.3` direct-prod permanece; `fastify@5.8.5` core carrega 4 highs. `security.yml:38` → `pnpm audit
  --audit-level high` **`continue-on-error: false`** + osv-scanner → hard-fail. **Tendência 12→15→18→49³→50⁴→52³.** — Esforço:
  **4-6h** (`pnpm add zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/
  brace-expansion). **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[carry]` **(v: orquestrador — `gh run list`)** — todo run `schedule` em `main` termina em
  **`startup_failure` (0s)** ininterrupto **09-22 → 10-27** (último = slot 10-27 às 11:14 UTC; 10-26 11:34 tb startup_failure).
  **Hoje (10-30, sexta) sem slot cron vencido** (Security=seg `0 6 * * 1`, CodeQL=ter `0 6 * * 2`); último run agendado que executou
  de verdade = Security `failure` **09-21** / CodeQL `success` **09-15** (~5,5 semanas sem scanner agendado real). `codeql.yml:26
  upload: never`. Causa não-introspectável offline (billing/quota Actions, action-ref, ou política de org). **Nota de governança:**
  os commits de audit são **locais** (`main ahead 18`, nunca pushados) → `ci.yml` **não roda** neles. — Esforço: **0,2h**
  (re-enable). `[xrepo: GitHub Actions]`

**Auth / rate-limit — buraco app-wide**

- **`rate-limit-plugin-dead-app-wide`** `[carry]` **(v: CONFIRMADO ×3 — AUTH + money/channels + orquestrador)** — `requireRateLimit`
  tem **zero callers** (só `rate-limit.ts:4` doc, `:146` decorate, `global.d.ts:66` tipo). `@fastify/rate-limit@^10.3.0` declarada
  (`package.json:37`) mas **nunca importada/registrada** — o server registra o plugin **custom** (decorate-only, zero `addHook`).
  Login staff (`auth/routes.ts:90`) + refresh (`:97`) + webhook metaapi sem preHandler → brute-force online ilimitado (bcrypt
  cost-12 único freio). Nenhuma rota emite 429 → "429 undocumented" **moot**. — Piloto baixo (1 admin). — Esforço: **~1h**. **#8.**
- **`staff-jwt-secret-no-min-length` + `secret-refine-presence-only-sistêmico`** `[carry]` **(v: CONFIRMADO ×2 — AUTH +
  orquestrador)** — `env.ts:60 STAFF_JWT_SECRET: optionalString` (sem `.min()`); `staff-auth.ts:70` assina HS256. O refine
  `requiredInProd` (`env.ts:181-213`) é **presence-only** (`if (!val[key])` `:206`) p/ **19** entradas; **nenhum** recebe validação
  de comprimento/formato no boot. `AEAD_MASTER_KEY` validado **lazy** só no 1º uso (`lib/aead.ts:19-26`). — Esforço: **0,5-2h**. **O
  buraco de auth mais duro no piloto (HS256 staff).**
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — AUTH, canon ADR-013:143)** — `requireRole` é **vaporware** (só 3
  comentários-prosa: `clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`; **não declarado** no `FastifyInstance`).
  `clerk-auth.ts:109 role = … ?? "member"` (default **fora** do enum DB). Blast-radius **nulo no piloto** (plano staff;
  `req.user` null de qualquer jeito). Canon ADR-013 l.143 manda middleware rbac (`aceita`). — Esforço: **1-2d**. `[xrepo: ADR-013]`
- **`staff-sse-firehose-crossorg-llm-content-unaudited`** `[carry, admin-alcançável-no-piloto]` **(v: CONFIRMADO — AUTH)** — `GET
  /api/v1/staff/realtime/events` (`staff-ops/realtime.routes.ts:29`, guard = todos os `STAFF_ROLES` incl observer) faz
  `psubscribe("realtime:*")` (`:66`) — firehose de **TODAS as orgs** — e escreve cada `pmessage` cru no stream (`:49-51`). O evento
  `execution.stream` carrega `chunk` = **conteúdo de resposta LLM ao vivo** (`harness-callbacks.routes.ts:128-132`). **Sem filtro de
  org, sem `audit_events`.** **Alcance admin é VIVO no piloto** (rotas staff-ops aceitam o token HS256 semeado). **SHARPEN (v:
  AUTH):** o blast **cross-org** é latente até a 2ª org ser onboardada (piloto single-org); o defeito all-staff-incl-observer +
  LLM-content-não-auditado embarca de qualquer forma. — Esforço: 2-4h. `[g/accountability]`
- **`impersonation-audit-trail-absent` + `impersonation-writes-zero-rows` + `approved_by-never-written` (NOVO) + `no-route-scoping`
  (NOVO)`** `[carry + 2 NOVO]` **(v: CONFIRMADO — AUTH)** — O hook de audit (`auth/routes.ts:70-87`) vive no plugin encapsulado
  `authRoutes` (`server.ts:198`); staff-ops são plugins **irmãos** (`server.ts:213-215`) → o hook **nunca dispara** nas ações
  staff-ops; estas gravam `actor_type='user'`, `actor_id=NULL`, sem `impersonation_id` (`actions.repository.ts:178-179`). **NOVO
  `approved_by-never-written`:** `staff_impersonations.approved_by` (`db/schema/staff.ts:39`) modela autoridade de aprovação mas
  `insertImpersonation` nunca a seta (`auth/repository.ts:147-161`); `startImpersonation` só checa org-exists (`service.ts:112-115`)
  → **qualquer admin/support auto-autoriza impersonation de qualquer org, sem gate de aprovação**. **NOVO `no-route-scoping`:** um
  token de impersonation para a org X **não** restringe rotas staff-ops a X (reads escopam pelo query-param `organization_id`,
  actions pelo `:id` do path; nenhum consulta `req.staff.impersonation_id`) → impersonation é **cosmética: nem escopa nem audita**.
  — Esforço: **1-2d.** `[xrepo: ADR-013; Marco-3]`
- **`staff-ops-getWindow-crossorg-PII-unaudited`** `[carry]` **(v: CONFIRMADO — AUTH)** — `GET /api/v1/staff/windows/:id` (guard =
  todos `STAFF_ROLES` incl observer, `read.routes.ts:19`) → com `organization_id` omitido, `read.repository.ts:112` **dropa o filtro
  de org** e busca a window de qualquer org por id, depois `:116-117 SELECT * FROM message_records` (PII crua) **mesmo quando orgId é
  fornecido**; nenhum read grava `audit_events`. Mesmo padrão `undefined→all-orgs` em `listExecutions:52`, `listAuditEvents:219`,
  `organizationHealth:191`, `dashboardOverview:13`. Habilitado por schema solto (`organization_id .optional()` não `.uuid()`,
  `schemas.ts:44,55`). **Piloto: o `bevox_admin` semeado alcança o read cross-org não-auditado.** — Esforço: M. `[g/accountability]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO — AUTH)** — `auth/repository.ts:221-223 SELECT organization_id
  FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id) + `routes.ts:169-170 orgClaim =
  organization_id ?? clerkUserId`; `upsertUserFromClerk` hardcoda `role='operator'` (`:238`); webhook só trata
  `user.created|updated|deleted`, sem `organization.created` → **paradoxo de bootstrap**. — Esforço: **4-8h** (+ADR org-mapping).
  `[xrepo: Clerk]`
- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry, pilot-universal; SHARPENED]` **(v: CONFIRMADO ×2 — channels +
  orquestrador; 4 refutações adversariais FALHARAM)** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:35,44`) e
  persiste em `channel_connections.provider` (`routes.ts:246-252` → coluna `notNull()` **sem CHECK** `db/schema/channels.ts:22`).
  `upsertChannelConnection` tem **exatamente 1 caller** (`routes.ts:246`), é o **único INSERT**, e o UPSERT nunca atualiza `provider`
  (`channels/repository.ts:73-77`) → provider é **estruturalmente sempre `"wa"`/`"ig"`**. Outbound
  `findExecutionDeliveryContext` null-coage provider ≠ pleno (`metaapi/repository.ts:197`) → `ctx.provider=null` → guard
  `executions/seams.ts:360` → `skipped_missing_recipient` (`:376`); `isDeliveryFailure` exclui skips (`:122-124`) →
  `complete-service.ts:100` fica `done` (**falso-sucesso**). meta-api `origin/main` exige `z.enum(["whatsapp","instagram"])`
  (`messages/schemas.ts:7`). **SHARPEN:** o subsistema outbound é **corretamente construído p/ o vocab pleno** (`send-message-intent.ts:14,22`)
  e simplesmente nunca é alimentado com ele; raiz conceitual de 1-linha = `normalize.ts:35/44`. Como o seed **não cria dado de
  canal**, 100% do dado de canal do piloto flui pelo webhook vivo → `"wa"` → **sem escape semeado**. — Impacto: **100%** das
  respostas de IA descartadas em silêncio como `done`. — Esforço: **3-4h**. **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`ig-inbound-silent-nondispatch`** `[carry, cross-repo byte-level]` **(v: CONFIRMADO nos 2 repos — channels + orquestrador)** —
  meta-api `origin/main` envia Instagram como `data = { messaging: [...] }` verbatim (`inbound/service.ts:245-248,320-322` +
  `workers/webhook-delivery.ts:160-166`, sem reshape), mas o backend `detectProvider`/`extractInboundMessage` chaveiam em
  `messaging_product`/`recipient`/`sender` **top-level** (`normalize.ts:32-47`, `inbound-dispatch.ts:88-112`) → IG → `"unknown"` →
  guard de dispatch `routes.ts:238-242` falha → o evento é persistido + auditado + `status="accepted"` (`:288`) + 200, **mas nunca
  semeia channel_connection, nunca escreve message_records, nunca enfileira dispatch**. WA **não afetado** (`inbound/service.ts:264`
  passa `{messaging_product:"whatsapp",...}`). — **Pilot-alcançável se IG semeado.** — Esforço: **~1h** (ou fix cross-repo no shape).
  `[xrepo: bevox-meta-api]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, irreversível; SHARPENED]` **(v: CONFIRMADO ×2 — Security Engineer +
  orquestrador)** — `markChargePaidManually` **não** tem status-gate (`service.ts:422-463`; comentário `:415-416` **proíbe**
  deliberadamente); `applyChargePaid` (`service.ts:876-925`) chama `markChargePaid` (`:890`) → insertPayment +
  confirmAppointmentIfUnconfirmed + grant **incondicional** (`:891-924`) ignorando o rowcount. **Raiz estrutural ÚNICA
  (firsthand):** os 3 UPDATEs guardados (`markChargePaid/Expired/Refunded`, `repository.ts:395-413`) são `Promise<void>` **sem
  `RETURNING`** → **nenhum caller pode** gatear no rowcount. Re-mark de `expired` → UPDATE no-op + payment `paid` órfão fresco;
  re-mark de `refunded` é **pior** — a row anterior é `reversed`, então `(org,'manual:<id>','paid')` ≠ `(…,'reversed')` → um **2º
  row `paid`** ao lado (inflação de revenue-report). Depois **irreversível** (`refundChargeManually` exige `status==='paid'`
  `:499-501`). `expireChargeManually` (`service.ts:623-650`) **audita falso** (`{status:"expired"}` sob race) **e é o único dos 3
  manuais sem `withRedisLock`**. **SHARPEN (v):** sub-superfície de grant — re-mark de `expired` com `charge_type='package'` e
  `validity_days=NULL` insere um `customer_package` **ativo fresco** off-charge (`package-intent.ts:104-113`); fecha com o mesmo fix.
  **DE-ESCALADO (v): o path Stripe NÃO é externamente manufaturável** (`webhook-platform.ts:90-97` dedupa por `event.id`) → único
  vetor externo = manual mark-paid (via Clerk org-user, sem role-gate). — Esforço: **~1,5h** (RETURNING + gate + lock). **#4.**
- **`proposal-missing-idempotency_key`** `[carry, inerte-atrás-do-message_id-poison]` **(v: CONFIRMADO byte-level — L)** — harness
  `extractProposal` (`mutation-tool.ts:341-352`) devolve só `{action,params}`; serializado verbatim em `/complete.proposals[]`
  (`execution-handler.ts:520,1973`); `idempotency_key` **grep=0** no src do harness. O backend `ProposalSchema`
  (`harness-callbacks.schema.ts:40`) **exige** `idempotency_key: z.string().min(1)` → qualquer `/complete` com proposals (o fluxo
  copilot/manual_assisted draft→approve) **falha `parse` → 400**. **2º dominó atrás do `message_id`-poison.** — Esforço: S. `[xrepo:
  bevox-harness]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — ROUTES + PILOT)** — Não existe `GET /appointments` nem
  `/appointments/:id`: `grep` REST read = **0**; só POST `/calendars/:id/appointments` (`routes.ts:71`), PATCH `/appointments/:id`
  (`:99`), POST `/appointments/:id/{verb}` (`:131`). A "agenda do dia" (PRD §263) **nem tem REST read, nem SSE push**
  (`appointment.created` §8.3 nunca emitido). — Esforço: **4-6h**. **#9.** `[xrepo: PRD §5.3/§8.3]`
- **`worker-process-has-no-scrape-surface` (SHARPEN de `worker-telemetry-uninitialized`)** `[carry + SHARPEN]` **(v: CONFIRMADO ×3 —
  harness + PILOT + orquestrador)** — `src/queue/index.ts` (entry `node dist/queue/index.js`) **não** `import "./instrument.js"` nem
  chama `initTelemetry()` (só `src/index.ts:17,30`) — importa só `captureException, shutdownTelemetry` (`:62`). `new Worker(` count =
  **11** (docstring `:5` "4 workers" stale). **SHARPEN (v: PILOT):** o worker **não expõe NENHUM listener HTTP/health/metrics**
  (grep `listen`/`createServer`/`fastify()` em queue/index.ts = 0) → o registry `prom-client` (singleton por-processo) que o
  reconcile incrementa (`reconcile.ts:88,114,162,165,203,229`) é **estruturalmente inscrapável**, e k8s **não** consegue
  HTTP-probar a liveness do worker. `/readyz` (`health/routes.ts:17`) checa PG+Redis mas não o worker. **DE-ESCALADO (mantém):
  NÃO é blackout de logging** — job-failure É Pino-logado (`queue/index.ts:268`); `captureException` dispara só em `on('error')`
  (conexão) `:272` e bootstrap `:313`, **não** no `on('failed')` final-attempt → falha de job não é Sentry-capturada. — Esforço:
  **1-2h** (import instrument + initTelemetry + `/metrics`+`/healthz` no worker + `w.on('failed')` capturar). **#6.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA ligar — INERTE no piloto manual)**

- **`dispatch-message-id-not-uuid-poisons-every-AI-dispatch`** `[carry, SHARPENED; CAUSA inércia do harness]` **(v: CONFIRMADO
  firsthand — L + orquestrador)** — `buildDispatchMessages` seleciona `external_message_id` (`orchestration/repository.ts:395`) e o
  mapeia a `message_id` (`:409`); `external_message_id` é `text NOT NULL` id nativo de canal (`db/schema/ingestion.ts:40`) —
  **nunca** UUID; o `id` interno (UUIDv7) **não é selecionado**. `DispatchMessageSchema.message_id = Uuid.optional()`
  (`harness-dispatch.schema.ts:22`) → ZodError em `DispatchPayloadSchema.parse` (`harness-dispatcher.ts:91`) **após** o INSERT
  `pending` (`:73-83`) e **antes** do enqueue (`:107`). **SHARPEN (v: L): AMBOS os paths de dispatch envenenam** — `cutoff.ts:54→57`
  (pilot) **E** `actions.repository.ts:129→131` (staff-replay) → a UX de replay do staff está igualmente morta. **É O PORQUÊ de o
  harness ser inerte** + CAUSA orphan-`pending` + MASCARA unbounded/active_execution_id/PERM-05/proposal-key. — **Inerte no piloto
  manual; CRÍTICO assim que canais/IA ligarem.** — Esforço: **~15min** (selecionar `id`). `[xrepo: bevox-harness]`
- **`harness-status-callback-method-mismatch-total`** `[carry, método=causa única; SHARPENED]` **(v: CONFIRMADO byte-level nos 2
  repos — L + orquestrador)** — Harness `post()` hardcoda `method:"POST"` (`bevox-callback.ts:28`; `/status` `:140`); `updateStatus`
  POSTa `running` (`execution-handler.ts:1410,1584`) / `dead_letter` (`bullmq-consumer.ts:155`), backend só registra **PATCH**
  `/status` (`harness-callbacks.routes.ts:56`) → **toda** chamada de status → Fastify **404**. **SHARPEN (v: L):** o harness emite só
  `"running"` + `"dead_letter"`, **ambos válidos** no enum backend (`harness-callbacks.schema.ts:16`) → o **método é a causa única**
  (os valores mapeariam). `applyStatusTransition` e `markExecutionDeadLetter` têm **1 caller cada** (a rota PATCH, `routes.ts:76,80`)
  → o 404 mascara **tanto** o dead_letter autoritativo **quanto** o `applyStatusTransition`-guard. dead_letter inalcançável
  ponta-a-ponta (POST→404 **E** backend `on('failed')` só loga `queue/index.ts:267-269`). Backend é **canon-correto** (§10.4 PATCH).
  — Esforço: **~1,5h**. **#7.** `[xrepo: bevox-harness + errata canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry, status-agnóstico]` **(v: CONFIRMADO — L; grep leituras=0)** — o
  preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:96`; escreve
  `req.executionContext` em `routes.ts:66`), mas **todo** handler age sobre o `:id` da URL (`routes.ts:73,91,113,142`) e **nunca** lê
  `req.executionContext` (grep: write-only). `findExecution(id)` devolve a org do `:id`-B, não re-ancora ao dono do token → token
  válido p/ A escreve em qualquer execução B (IDOR cross-execution/cross-tenant). **Inerte no piloto** (token nunca escapa — dispatch
  poisona pré-enqueue); **CRÍTICO-GA**. — Esforço: **1h**. `[xrepo: bevox-harness]`
- **`dispatch-messages-unbounded` / `completion-never-clears-active-execution-id` / `PERM-05-layer-2-FAIL-OPEN`** `[carry + SHARPEN,
  MASCARADOS por message_id-poison]` **(v: CONFIRMADO — L)** — `buildDispatchMessages` (`repository.ts:395-398`) sem LIMIT vs caps
  harness `100`/`8000`/`256KB`; `finalizeCompletion` (`harness-callbacks.repository.ts:136-148`) nunca toca
  `active_execution_id` (nulado só por `releasePipelineClaim:231` + `handoffConversationOnTimeout:464`; `claimPipelineForCutoff`
  exige `IS NULL :196`) → conversa **trava após uma completion**. **SHARPEN (v: L): PERM-05 Layer-2 é fail-OPEN, não só inerte** —
  backend envia `skills:[]` (`cutoff.ts:75`+`actions.repository.ts:144`) + omite `account_denied_tools` (ausente do schema
  `:25-63`); o harness `deriveAccountDeniedTools` com `allow.length===0` retorna `[]` (`permission-context.ts:63-68`) = "sem
  filtro" → **toda ferramenta registrada é concedida**. — **Inerte no piloto; CRÍTICO-GA.** — 1-8h/ea. `[xrepo: bevox-harness]`
- **`complete-service strategy/aborted mismatches`** `[carry; bodyOrgId DE-ESCALADO mantém]` **(v: CONFIRMADO — L)** —
  `strategy:"failed"`+proposals vazias → `inferSuggestionType` devolve `"reply"` (`complete-service.ts:22`), nunca `error`; harness
  emite `aborted_cost`/`aborted_timeout` **no fio** (`execution-handler.ts:2096-2100`) ausentes do enum backend
  (`harness-callbacks.schema.ts:57-65`) → `parse` 400; terminal guard **409** (`errors.ts:32`) vs canon 410. **DE-ESCALADO:**
  `/complete` lê `bodyOrgId` sem `===` (`routes.ts:150-154`), **mas** `CompletePayload`/`buildCompletePayload` **não têm**
  `organization_id` (`bevox-callback.ts:63-69,88-96`) → sempre `undefined` → fallback ao org correto (**inerte, NÃO vetor
  cross-tenant vivo**). — 1-3h/ea. `[xrepo]`
- **`applyStatusTransition-unguarded-regression`** `[carry, inerte double-masked]` **(v: CONFIRMADO — L)** — o `UPDATE executions
  SET status=…` não tem precondição de status (`harness-callbacks.repository.ts:64-66`, `WHERE id` + `RETURNING id` só). Inalcançável
  hoje (POST `/status` 404s + 1 caller). `findExecutionIdByTokenHash` exclui `done/error/cancelled/dead_letter` (`:34`) → os 4
  hard-terminais são **blindados**; a janela regressável real é soft-terminal (`completing`/`timeout`) + `processing`/
  `waiting_input`. **Vira vivo no instante em que o method-mismatch for corrigido** → fixar junto com #7. — S. `[xrepo: bevox-harness]`

### MÉDIO (degrada qualidade)

**Auth — contrato / cross-org (plano staff-ops que o piloto usa)**

- **`staff-token-expires_in-advertises-refresh-ttl-not-access-ttl`** `[carry]` **(v: CONFIRMADO ×2 — AUTH + orquestrador)** —
  `issueSession` devolve `expires_in: ttl` onde `ttl = staffRefreshTtlSeconds()` = 604800s/7d (`auth/service.ts:54,60`), mas o JWT
  access-token `exp` = `STAFF_JWT_ACCESS_TTL` = 900s/15min (`staff-auth.ts:74`) → cliente trata token de 15min como válido 672×
  demais → 401 silenciosos no painel staff. — Esforço: **0,25h** (`expires_in: cfg.STAFF_JWT_ACCESS_TTL`).
- **`audit-log-blind-to-staff-actor`** `[carry]` **(v: CONFIRMADO — AUTH + LGPD)** — toda mutação staff-ops grava `audit_events.actor_id
  = NULL` (`actions.repository.ts:178-179`); o enum `actor_type` = `user|ai|system|webhook` **sem `staff`** (`_shared.ts:84`) →
  actorship de staff é estruturalmente inexprimível. — Esforço: S-M.
- **`staff-login-user-enumeration-timing`** `[carry-residue, re-confirmado]` **(v: AUTH)** — `loginStaff` lança **antes** do bcrypt
  quando email desconhecido/inativo (`service.ts:68-70`) ou secrets ausentes (`:74-78`) → oráculo de timing distingue emails de
  staff válidos; composto por rate-limit 0-caller + sem lockout. — Esforço: S.
- **`clerk-jwt-no-aud-iss-validation`** `[carry, DE-ESCALADO ALTO→MÉD — mantém]` **(v: CONFIRMADO — AUTH)** — `clerk-auth.ts:89-92`
  verifica só `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` de claim não-verificada (`:105`).
  **DE-ESCALADO:** JWKS **instance-scoped** (`:67-73`) → atacante externo não cunha token; risco residual = cross-audience
  intra-instância (defense-in-depth). **NÃO re-inflar p/ ALTO.** — Esforço: **0,5-1h**.

**Observabilidade — `/metrics` é superfície pré-auth composta (11 workers; worker sem scrape)**

- **`metrics-public-org-id-enumeration` + dois cardinality-bombs pré-auth** `[carry]` **(v: CONFIRMADO ×3 — PILOT + channels +
  orquestrador)** — `GET /metrics` (`health/routes.ts:24`) é in-app **não-autenticado** (comentário `:22-23` admite só
  network-policy) e `httpRequestsTotal` é rotulado com `organization_id` (`metrics.ts:33`), incrementado por-request com o UUID real
  (`bootstrap/server.ts:170`) → enumera todos os org-UUIDs (vazamento ADR-021). **Bombs:** (a) `event_type` do webhook metaapi é
  `/^raw\.[a-z_]+\.[a-z_]+$/` (`schemas.ts:31`) e vira label no path de **assinatura-inválida pré-auth** (`routes.ts:132,147,152,168`,
  `metrics.ts:63-66`); (b) o label `route` cai para o path cru em 404/unmatched (`server.ts:163`). Webhook sem preHandler +
  rate-limit 0-caller → flood não-throttled. **DE-ESCALADO:** o `pre-HMAC DB amplification` é **LOW** (2 leituras O(1) + 1 decrypt,
  `routes.ts:140-162`). — Esforço: **1-2h** (auth no `/metrics` + bucket de labels). `[g/k; ADR-021]`
- **`worker-has-no-healthz-readyz` + `dead-worker-invisible`** `[carry]` **(v: CONFIRMADO — PILOT)** — o HTTP `/readyz`
  (`health/routes.ts:17`) checa PG+Redis mas não a liveness do worker; o worker não expõe porta → k8s não HTTP-proba → worker
  crashado → HTTP segue `ready` enquanto ingestão/reconcile/google-sync/waitlist/package-expiry **param em silêncio** (só logs Pino).
  — **2-3h.** (ver `worker-process-has-no-scrape-surface` em ALTO.)
- **`domain-prometheus-metrics-not-registered` + `two-dead-metrics` + `sse-events-never-published`** `[carry]` **(v: PILOT; sweep
  adversarial)** — `shared/metrics.ts` não registra os de §13.3 (`charges_*`, `appointments_no_show_rate`, grep=0). **Sweep de
  métrica-morta: exatamente 2** nunca `.set()/.inc()`: `queueSize` (`metrics.ts:41`) e `messagesReceivedTotal` (`:52`) —
  **enquanto** o paralelo `metaapi_inbound_events_total` (`:63`) É incrementado. `realtime/publish.ts:8-12` fechado a 4 tipos;
  `appointment.created`(§8.3)/`charge.updated`(§8.4) **nunca** emitidos (grep=0). — **2-3h**.
- **`ig-inbound-metered-as-accepted`** `[NOVO, LOW-MED observabilidade]` **(v: channels)** — `routes.ts:288` incrementa
  `metaapiInboundEventsTotal{status="accepted"}` para eventos IG **mesmo** quando o bloco de dispatch (`:234-286`) no-opa (o guard
  interno `:238` falha sem throw) → IG inbound é **falso-sucesso no layer de métrica de inbound**; operadores veem `accepted`
  enquanto toda mensagem IG é dropada. Espelho do falso-sucesso de outbound. — Esforço: trivial, fecha com o fix do IG-inbound.
- **`outbound-drop-IS-metered` (correção de framing)** `[NOVO/correção]` **(v: channels)** — o drop de outbound (vocab-mismatch) É
  metrado em `seams.ts:372-375` como `metaapiOutboundMessagesTotal{status="skipped_missing_recipient"}`. **NÃO** afirmar que o drop
  de outbound é telemetricamente invisível — o falso-sucesso existe **só** em `executions.status="done"` (`complete-service.ts:100`).

**Dados/LGPD + money — scoping / integridade (GA/Marco-3; piloto roda com PII real)**

- **`appointments-waitlist-denormalized-pii-not-erasable-not-exported`** `[NOVO, MÉD]` **(v: LGPD)** — `appointments`
  (`calendar.ts:128-130`) e `waitlist_entries` (`calendar.ts:194-196`) carregam `customer_name` + `customer_phone` +
  `customer_email` desnormalizados; org-scoped mas **sem `deleted_at`**, FK `customer_id` `onDelete:"set null"` → mesmo um cascade
  hipotético corta o link e deixa a PII crua. **Nenhuma** das duas tabelas está no `exportData` (DSR só faz customers+facts).
  Pilot-alcançável a cada booking/waitlist. 7ª/8ª cópia de PII. — Esforço: parte do build de DSR/retenção. `[g; _shared/ADR-020]`
- **`message-content-table-untargetable`** `[carry, de-claim mantém]` **(v: LGPD + SCHEMA)** — `message_records`
  (`ingestion.ts:32-56`) guarda PII (`content_text` + `sender_snapshot_json` + `media_json`) **sem `organization_id`, sem `created_at`
  de inserção, sem `deleted_at`** — só o nullable `message_created_at` (`:43`). Âncora transitiva via `received_event_id→received_events.received_at`
  existe mas **frágil** (FK `set null` `:37`); só o `created_at` **direto** é ausente. — **GA/LGPD.** — migration (M).
- **`appointment-transition-no-state-guard` + `package-session-not-restored-on-cancel`** `[carry]` **(v: PILOT)** —
  `booking.ts:424-474` UPDATE incondicional any→any (comentário `:436-438` admite); `cancelled→confirmed` **re-conta em capacidade
  sem recount** (`availability.ts:169` conta `status NOT IN ('cancelled')`) → over-book; `completed→cancelled` não re-incrementa
  pacote (`:461-472`). (`rescheduleAppointment` é capacity-sound — roteia pelo `createAppointment`.) — **GA integridade (inerte no
  piloto semeado).** — **2-3h**.
- **`intent-reconcile-half-applies-paid` + `reconcile-fifo-window-starvation` + `reconcile-charge-update-status-unguarded`
  (NOVO)`** `[carry + NOVO]` **(v: Security Engineer)** — `reconcile.ts:143-150` seta só `status='paid'`+`updated_at` (**e nem
  `paid_at`**) bypassando os 6 efeitos de `applyChargePaid`; `reconcileStuckIntents` (`:101-108`) seleciona 50 `pending` mais antigos
  **sem** filtro `provider_charge_id IS NOT NULL` → manuais ocupam slots FIFO (`:119 continue`). **NOVO:** o UPDATE de reconcile
  (`:144-149`) **não tem `WHERE status=…`** (ao contrário dos 3 `markCharge*`) → o advisory-lock exclui só outros reconcile-workers →
  TOCTOU regressível por webhook/manual concorrente. Branch **live** (Stripe-path, inerte no piloto manual). — **M**.
- **`execution-traces-pii-sink-not-titular-erasable`** `[carry]` **(v: LGPD)** — `execution_traces.input_json`/`output_json`
  (`db/schema/execution_traces.ts:29-30`, PII-capaz) é org-scoped mas **sem `customer_id`, sem `deleted_at`** e **ausente do DSR**.
  Write-path wired (`insertExecutionTraces src/integration/harness-callbacks.repository.ts:187-208` ← POST `/traces`), mas `/traces`
  é producerless → vazio no piloto. — **LOW-MED/latente.** — baixo.
- **`stripe-webhook-core-triple-gap`** `[NOVO sharpen, MÉD]` **(v: ROUTES)** — `POST /api/v1/webhooks/stripe`
  (`payments/webhook.ts:31`) é o ingresso de conciliação de pagamento (passo m "webhook-reconcile"), mas: **undocumented** no YAML
  (grep 0), **untyped** em `src/types/api.ts` (grep 0; `webhooks = Record<string,never>` `:4541`), e **untested** (`constructEvent`=0
  em test/). O mais consequente dos 11 undoc. — Esforço: S-M (doc + tipo + teste de assinatura).

### BAIXO (higiene)

**LGPD (Marco-3 §16.3 — piloto roda com PII real; CONFIRMADOS; de-claims mantêm)**

- **`consent-and-ai-opt-out-stored-not-applied` + `no-consent-capture-mechanism` + `intake-pii-ingested-pre-notice`** `[carry]` **(v:
  LGPD — headline)** — `ai_opt_out` só no CRUD de customers (`repository.ts:21,26,67`; `default false`=opted-IN) e **lido em lugar
  nenhum**; dispatch é **conversation-keyed, nunca customer-keyed** (`orchestration/repository.ts:391-415`); `consent_granted_at`
  (`customers.ts:49`) tem **zero writers**; `intake` INSERT cego em `customers` (full_name) + customer_channels com telefone **sem
  gate de consentimento e sem "aviso automático"** que `_shared/ADR-019` exige. grep
  `legal_basis|consent_event|dsr_request|retention|pseudonym` = **0**. **Assimetria-chave:** ingestão ungated (BullMQ, sem auth) vs
  direitos RS256-gated (inalcançável no piloto HS256). — Esforço: **M**. **#10.** `[xrepo: _shared/ADR-019]`
- **`received-events-and-message-records-un-erasable` + `retention-worker-adr020-absent` + `consent_events/dsr_requests-tables-absent`
  (NOVO nome)`** `[carry]` **(v: LGPD + SCHEMA)** — `received_events` (`ingestion.ts:12-30`) persiste `payload_json` E
  `normalized_payload_json` com **zero `organization_id`/`customer_id`/`deleted_at`**; `message_records` idem → **5 cópias de PII
  inbound cruas** (+ execution_traces 6ª + appointments/waitlist 7ª/8ª). Canon ADR-020 define `bevox.retention.worker` (cron 03:00
  UTC — o único `0 3 * * *` no código é o Google watch-renewal `calendar/google/constants.ts:9`, não retenção) + **`consent_events`
  + `dsr_requests` (5yr art.37)** — **ambos ausentes** das 45 pgTables. — Esforço: **24-40h**. `[xrepo: _shared/ADR-020]`
- **`dsr-export-is-a-stub-omitting-phone-channels-superseded-facts` + `customers-have-no-erasure-path`** `[carry; de-claim mantém]`
  **(v: LGPD)** — `exportData` (`customers/service.ts:97-110`) devolve getCustomer(COLS)+listFacts+**`messages:[]`**(`:107`)+**`audit_events:[]`**(`:108`)
  (stubs `TODO Marco-3` `:83,85`); `COLS` (`repository.ts:25-26`) **nunca** consultam `customer_channels`; o intake insere só
  `customers.full_name` → `primary_phone` é **NULL p/ toda a população channel-origin**; telefone/handle/external_user_id vivem em
  `customer_channels`, **nunca exportados**. `listFacts` filtra `superseded_by IS NULL` (`repository.ts:106`). **De-claim mantém:**
  `risk_flags_json`/`preferences_json` têm **zero writers** → `dsr-export-omits-profiling` **imaterial**; perdas materiais =
  **channels + superseded-facts** (+ appointments/waitlist NOVO). `customers.ts:51-52` define `archived_at`+`deleted_at` mas **0
  writers** (grep DELETE/soft-delete = 0) → erasure de titular estruturalmente zero; `deleteUserByClerkId`
  (`auth/repository.ts:244-246`) hard-DELETE só em `users`. **Sinks titular-apagáveis ≈ ZERO.** — Esforço: export **6-10h**; deleção
  **8-12h**. `[xrepo: _shared/ADR-020]`
- **resíduos LGPD** `[carry]` — `dsr-export-under-captures-cross-entity-audit` (`audit_events` tem `entity_type/entity_id` indexado
  `audit.ts:27-28,42` → `entity_type='customer'` **é** filtrável; gap = rows cross-entity); `staff_manual_actions` jsonb sem
  customer_id; `google-calendar-intl-transfer` (full_name → summary egressed, `sync.ts:203,237`); `payments.raw_payload_json` (10yr
  fiscal); `received_events.signature_valid` hard-coded `TRUE` (`channels/metaapi/routes.ts:210`, inert-by-construction — só pós-HMAC).
  — 2-4h/ea.

**Money / schema — misses de baixo risco**

- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry, cron LIVE-wired; NARROWED mantém]` **(v: CONFIRMADO ×2 — Security +
  orquestrador)** — `reconcile.ts:254-259 UPDATE refunds SET … updated_at = now()`, mas `refunds` **não tem** `updated_at`
  (`payments.ts:149-165`; DDL `0011_petite_tigra.sql:77-87` confirma; só `0019` adiciona idempotency_key) → **42703** capturado
  (`:262-268`) → `failCount++`, status stuck `pending` → reconcile de refund **DOA**. Cron **live-wired** (`queue/index.ts:149,255-262`).
  O path vivo `updateRefundStatus` (`repository.ts:480-483`) **omite** `updated_at` → intacto; manual escreve `succeeded` direto
  (`service.ts:525`) → **pilot-inerte**. CI-invisível (só unit mockado). **NARROWED: cron-only (webhook intacto).** — **0,25h** (remover
  `updated_at=now()`). `[xrepo: Stripe]`
- **`manual-charge-amount-unbounded-overflow-500` + overflow extends to service-packages (NOVO) + currency residues** `[carry +
  NOVO]` **(v: Security Engineer)** — `manual.ts:31 z.number().finite().positive()` (sem `.max`) → `service.ts:377 .toFixed(2)` em
  `numeric(10,2)` → ≥1e8 → 22003 → 500 opaco (**pilot-reachable via Clerk**). **NOVO:** `POST /service-packages` `price_amount` sem
  `.max` (`package-intent.ts:23`) → `repo:599` mesma classe 22003/500, **Clerk-reachable**. `currency` sem CHECK (`payments.ts:92`);
  **NOVO:** divergência de moeda — Stripe PI hardcoda `currency:"brl"` (`charge-intent.ts:59`) enquanto `charges.currency` guarda o
  input não-validado. `payment_accounts` uniqueness em `professional_id` **DE-ESCALADO: imaterial** (coluna sempre-NULL; os 2 INSERTs
  são `account_holder_type='organization'`). — trivial/S ea.
- **`charge-creation-skips-org-scope-on-entity-fks`** `[carry, LOW/info]` **(v: Security Engineer)** — `createManualCharge`
  (`service.ts:344-401`) e `createCharge` (`:185-240`) org-scope-validam só `service_package_id`; os demais FKs fluem a
  `insertChargePending` com FKs globais (`payments.ts:77-87`). **Sem leak de read cross-tenant** (reads org-scoped); residual =
  oracle de existência-de-FK sobre UUIDv7 inadivinhável. — baixo.
- **`refunds.reason_code-dead-column` + `connectManualAccount-dup-audit` (NOVO LOW)`** `[NOVO]` **(v: Security Engineer)** —
  `recordRefund` (`repo:451-465`) não tem param `reasonCode`; os 3 writers omitem (manual `service.ts:522`, Stripe `:781`, webhook
  `webhook-platform.ts:156`) → coluna (`payments.ts:161`) universalmente NULL embora o input carregue `reason_code`
  (`refund-intent.ts:19`). `connectManualAccount` (`service.ts:669-679`) emite `insertPaymentAudit` **sempre**, mesmo quando
  `createManualAccount` devolveu row pré-existente (idempotente) → audits duplicados em `connect-manual` repetido. — ~15-20min/ea.
- **`fk-columns-without-index` + `section-11-3-critical-indexes-partially-absent`** `[carry; contagens CORRIGIDAS p/ cima]` **(v:
  SCHEMA)** — **89 code `.references()` + 1 composite `foreignKey()` = 90 FK-cols no snapshot 0020**; **91 FK no DB real** (snapshot
  cego a 1). **20** tabelas org-FK sem índice-leading (era ~18); **61** FK-cols não-leading-indexed (era ≈55). `customers` (PII
  primária) tem **ZERO** índices secundários (perf/scan, **não** violação de §11.3 — customers não é nomeado lá). PRD §11.3 (l.1270)
  manda `(org,status)` em appointments/conversations/charges/executions + `(org,start_at)` em appointments → **4 de 5 AUSENTES** (só
  `conversations (org,status)` `:58`). **DE-ESCALADO:** o partial de `customer_facts` = §11.2 VERBATIM; o de `payment_accounts`
  cobre o lookup dominante. — **3-4h**. `[a/schema]`
- **`adr-020-templates-and-adr-021-priority-score-unmaterialized` + `waitlist-priority-score-client-settable`** `[carry]` **(v:
  SCHEMA — canon-reforçado)** — backend/ADR-020 (MessageTemplate) + ADR-021 (`aceita`) **não materializadas** (grep
  `message_template`/`urgency_level`/`skip_count`/`last_score_update` = 0). ADR-021 "Opção C" (**aceita 2026-05-21**) manda
  `priority_score` server-computed + `CHECK (priority_score>=0)` + "server ignores client input" (l.49,78,99,180) — **vinculante**.
  Mas `calendar.ts:204 priority_score numeric notNull default '0'` **sem CHECK** (só `0010_square_timeslip.sql:19`), escrito do input
  em `waitlist/routes.ts:30,36,71,95`, INSERT (`repository.ts:278`), PATCH (`:361`), seam IA (`seam-tool.ts:44,83`), e `match`
  ordena por ele (`repository.ts:331`, `match.ts:74`) → **inverso direto** de ADR-021 (refutação de recompute-server-side FALHOU —
  `waitlist/service.ts` tem 0 refs de priority). (`conversations.priority_score` dormante — não re-inflar.) — ADR-020 **8h**; ADR-021
  CHECK+drop-input **2h** / fórmula **6-10h**.
- **`status-history-entity-absent` + `appointments-no-created-by-actor` + `appointments.confirmed_at-absent` +
  `OperationalMetricSnapshot-absent`** `[carry]` **(v: SCHEMA)** — PRD Módulo 16 (l.584/588) + §8.3 (l.869) / §8.4 (l.893) mandam;
  grep de cada em `src/`+`db/schema/` = **0** (`confirmed_at` só um comentário `payments/repository.ts:924` admitindo a ausência). —
  **GA/latente (audit module = Marco-3 l.1402).** — S-M/ea.
- **`appointments-customer-package-fk-snapshot-drift` + `stripe-webhook-events-org-set-null-orphan`** `[carry; mecanismo SHARPENED]`
  **(v: SCHEMA)** — `0012_needy_human_cannonball.sql:2` hand-carrega `ADD CONSTRAINT appointments_customer_package_id_fk … ON DELETE
  set null`, mas `appointments.foreignKeys` nos snapshots 0012 **e** 0020 = 6 keys, **sem** o customer_package → drizzle-kit
  permanentemente cego (N2: 90 modelado vs 91 DB). `payments.ts:236-238` faz `stripe_webhook_events.organization_id` nullable `ON
  DELETE set null` (desvia do cascade §11.2 l.1201). **SHARPEN:** o 0012 usa o nome **hand-style** `appointments_customer_package_id_fk`;
  re-adicionar `.references()` geraria o nome longo default do drizzle → **FK duplicada redundante**, não necessariamente `42710` (que
  só dispara em colisão de nome). — **LOW** (latente schema-thaw). — baixo.

**Auth / harness / routes (resíduos — BAIXO/latente/inerte)**

- **`newOpaqueId-uuidv4-dormant-landmine` + `verifyStaffRefreshToken-dead` + `staff-refresh-unbounded-no-prune/no-reuse-detection`**
  `[carry]` **(v: AUTH)** — `staff-auth.ts:139-140 newOpaqueId(): randomUUID()` (UUIDv4, viola invariante #7), **zero callers**;
  `staff-auth.ts:120 verifyStaffRefreshToken` **zero callers**, usa `===`; `staff_refresh_tokens` sem last_used/reuse cols + sem
  prune worker (`db/schema/staff.ts:42-50`); refresh concorrente dobra tokens válidos. — trivial/S.
- **`idempotency-cache-key-not-org-scoped`** `[carry, latente]` **(v: ROUTES)** — `idempotency.ts:85` monta a Redis key como
  `idempotency:${key}` **sem prefixo `organization_id`**; replay cross-org teórico (requer colisão de key; `KEY_PATTERN` permite keys
  fracas `:46`). Defense-in-depth vs ADR-021. **Pilot-reachability: NENHUMA** (rotas RS256-gated). — baixo.
- **`openapi-drift-undocumented-handlers` (11 → 7 drift-real + 4 webhooks) + `api.ts-blind-to-11` (NOVO) + `no-mechanical-route-zod-openapi-binding`**
  `[carry + NOVO]` **(v: ROUTES)** — recount EXATO: `103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 /
  phantom:0`. **7 drift-real app-facing:** `GET`+`PATCH /autonomy` (`autonomy/routes.ts:18,23`), `GET /channel-connections`
  (`channels/routes.ts:13`), `GET`+`PATCH /payment-account/policy` (`payments/routes.ts:89,95`), `GET /customers/{id}/export`
  (`customers/routes.ts:97`), `GET /api/v1/realtime` (`realtime/routes.ts:27`; o `realtime` no YAML é o path staff **distinto**
  openapi:924). **4 webhooks provider** tb undoc (stripe, stripe/platform, google/callback, google). **NOVO:** `src/types/api.ts` é
  **cego** às 11 (`webhooks = Record<string,never>` `:4541`) → consumidores tipados não as alcançam type-safe. ZERO rotas usam
  `schema:`; sem `ZodTypeProvider`; **168** `.parse/.safeParse` inline (153+15). — **2-3h** + 1h validador CI. **#9.**
- **`enum-create-refund-missing` + `status-callback-missing-dead_letter`** `[carry, live-path twins]` **(v: ROUTES)** — YAML
  `ExecutionProposal.action` = 6 vals **sem `create-refund`** (openapi:320-326); Zod tem 7 (`harness-callbacks.schema.ts:30-38`),
  **executado** (`seams.ts:172`). **Gêmeo:** YAML `status` enum `[running,paused,cancelled]` (openapi:298) vs Zod adiciona
  `dead_letter` (`harness-callbacks.schema.ts:16`) com handler-branch vivo (`routes.ts:75-76`). — 0,25h.
- **`error-envelope-dual-schema` / `idempotency-key-param-overclaims` / `freeform-200` / `operationId:0`** `[carry; vários
  DE-ESCALADOS mantêm]` **(v: ROUTES)** — handler **sempre** emite `request_id` (`error-handler.ts:55`) mas só `ErrorEnvelope` o
  documenta; **DE-ESCALADO** `idempotency-key-param` → defeito é a **descrição** (openapi:98 "toda mutação") overclaimar; 200
  free-form; **DE-ESCALADO** `operationId:0` → o gerador keya por path+method → **não quebra o codegen**; **DE-ESCALADO**
  `429-undocumented` → **moot** (nenhuma rota emite 429, re-verificado). — 0,25-2h/ea.
- **resíduos harness** `[carry + 3 NOVO LOW]` **(v: L)** — `poisoned-dispatch-orphans-pending-execution-row`
  (`harness-dispatcher.ts:73-83`; `claimTimedOutExecutions repository.ts:428` não varre `pending` — pilot-reachable, um órfão por
  inbound); `/traces-has-zero-harness-producers` (`sendTrace bevox-callback.ts:98` 0 callers); `/stream-wired-but-config-gated`
  (**DE-ESCALADO:** `STREAM_ENABLED` default false `env.ts:137` AND flag `stream` que o payload nunca envia → double-gated);
  **NOVO:** `/traces` cai no vazio quando tiver produtor (`insertExecutionTraces` mapeia step_name←"unknown", input/output←null,
  **nunca lê `content`**, `harness-callbacks.repository.ts:199-204`); **NOVO:** `agent_config.default_model` não-enforçado
  backend-side (backend `z.string().min(1)` `:50` aceita modelo que o harness refina/rejeita → 400 por org); **NOVO:**
  `callback_base_url` é campo morto (harness usa seu próprio env `BEVOX_CALLBACK_BASE_URL`, não lê o dispatchado). — 0,25-2h/ea.
  `[xrepo: bevox-harness]`
- **`max_cost_usd-never-sent`** `[NOTA — NÃO é gap]` **(v: L)** — o backend não envia `max_cost_usd`; o harness cai no env
  (`execution-handler.ts:658`). **ADR-016 (token-billing) é `proposed`** → corretamente não-implementado. Nota, não achado.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: orquestrador)** — tags só `v1.0.0`/`v1.0.1`; `merge-base
  --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora (incl. dispatch amendment); `release.yml:3-5`
  dispara só em `push tags: ["v*.*.*"]` (+ `type=semver`) → **nenhuma imagem (SemVer OU sha) pós-`v1.0.1`**; builda runtime+migrator.
  Versão diverge **4-way** (`package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1` / hub `vX.Y.Z`). — **0,5-1h**. `[xrepo: hub manifest
  fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: orquestrador — re-confirmado firsthand)** — `src/integration/resolve-organization-id.ts`
  **NÃO existe** (`ls` confirma inexistente; a própria `CLAUDE.md:63` diz que a ponte foi colapsada) mas é citado como vivo em **5
  lugares** (`README.md:84`, `backend-tenancy.md:28`, `backend-routes.md:34`, `PostToolUse-tenancy.sh:11`,
  `engineering-backend-architect.md:243`); **`CLAUDE.md §8 l.171`** diz que o seed grava `PILOTSEEDONLYNOTASECRET` (stale — seed usa
  `generateMfaSecret`); `backend-harness-contract.md:35` lista o status-callback como **POST** (handler é PATCH); `backend-db.md:31`
  diz `on delete restrict` (código+canon = cascade); `backend-routes.md:24,33` invoca `requireRole` inexistente + mis-cita
  "ADR-022 staff RBAC" + nomes curtos `support`/`observer` (é backend/ADR-013, `bevox_support`/`bevox_observer`). — 0,3-0,5h/ea.
- **`stray-gap-workflow-js-scratch` / `codeql-upload-never` / `release-no-provenance-sbom` / `adr-number-collision`** `[carry]`
  **(v: orquestrador)** — **5** `.claude/state/gap*.js` (gitignored, `git check-ignore` confirma os 5) → **zero impacto em CI**; só
  `pnpm lint` **local** dá RED (5 parsing-errors). **Esta sessão NÃO adicionou nenhum** (`git status` limpo). `codeql.yml:26
  upload:never`; `release.yml` sem provenance/sbom; ADR 008-023 colidem backend/_shared. — 0,1-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária esta sessão — NÃO re-flagar)

- **`idempotency-header-IS-enforced-on-charges-manual`** `[REFUTED do 10-28, re-confirmado]` — `write` = `[requireClerkAuth,
  requireOrganizationScope, requireIdempotency]` (`payments/routes.ts:52-54`); `requireIdempotency` lança 400 na ausência
  (`idempotency.ts:78-83`); `/charges/manual` (`:284`) + `/refund-manual` (`:306`) usam `write`. **Sem duplicate-charge.** Não re-flagar.
- **`legacy-lexicon-clean`** — executável **ZERO**; 3 crus = doc-comments. Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153 generateMfaSecret()` + `:154 assert`; sentinel só blocklist doc-comment;
  login sem MFA = correto (Marco-3). CLAUDE.md §8 l.171 stale (doc).
- **`onboarding-state-machine-IS-materialized`** `[REFUTED candidate-miss]` — `GET`/`POST .../onboarding[/advance]` existem no módulo
  **organizations** (`routes.ts:65,71`), backed por `organizations.onboarding_stage` (enum `_shared.ts:39-44`). O gap é o `advance`
  **guardless** (ALTO acima), não a ausência do módulo.
- **`mark-no-show-is-not-a-code-bug`** `[REFUTED, carry]` — OpenAPI serve `/appointments/{id}/no-show`. Não re-flagar.
- **`booking-main-path-exactly-once-sound` + `rescheduleAppointment-capacity-sound`** — advisory xact-lock + recount in-lock + unique
  index + replay 23505 (`booking.ts:223-263`); reschedule roteia pelo createAppointment são. Não flagar.
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc|pan`=**0**); decimal `numeric(10,2)`; webhooks dedupe-aware +
  org-scoped (cross-tenant paid-flip impossível `webhook-platform.ts:67-73,90-97`); over-refund replay-safe (`service.ts:515,753`);
  manual refund amount **bounded** (guard pré-write `:504-506`); `money-mutation-http-idempotency` by-design (`manual:<id>` + ON
  CONFLICT); HMAC correto (Stripe `constructEvent`, metaapi timing-safe ±300s pré-persist, Clerk svix, Google timing-safe).
- **`env-hardening-conformances`** — `LOG_LEVEL=debug/trace` **proibido em prod** (`env.ts:215-221`); `TEST_AUTH_BYPASS_ENABLED`
  double-guarded (`env.ts:151-158` + `:225-231`); CORS `origin:false` (`server.ts:121`); helmet registrado (`:109`).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|bevox_observer`;
  `requireStaff({roles})`→403; observer excluído de actions (`actions.routes.ts:11`), incluído em reads/SSE.
- **`impersonation-org-claim-is-dead-branch`** `[DE-ESCALADO]` — `organization-scope.ts:57` trata `impersonation_id` como claim de
  org, **mas** interseção de rotas `requireStaff`+`requireOrganizationScope` = **0** → branch inerte.
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` canon-correto (§11.2 l.1201); CHECKs presentes
  (`appointments_range_check`, `sessions_remaining>=0`, `confidence∈[0,1]`, status checks; a2c8 conta **29**); **migrations journal
  íntegro (21 entradas = 21 `.sql`; 0 `gen_random_uuid`/`uuid_generate_v4`)**. **Contagens firsthand:** **45** tabelas `pgTable`; **89
  `.references()` + 1 composite = 90 FK-cols-snapshot / 91 FK-DB**; **20** org-FK não-leading-indexed; **61** FK-cols
  não-leading-indexed; **11** workers; **168** inline parse; uuidv7-default presente (0000).
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido/ausente (`execution-token.ts:64-65,68-69,93-95`). Coexiste
  com o token-IDOR (autenticidade ≠ autorização). `idempotency-on-callbacks` **REFUTED** (state-machine; harness manda só o header, o
  plugin idempotency **não** está wired nos callbacks; `/complete`→409 via `lockForCompletion`).
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (origin/main l.781-826, verbatim, **sem drift**): 10 delivered
  (aisuggestion, staff-rbac[ADR-013], 4× chatwoot/metaapi, m5-p4-manual-payment, m5-p3c-multimedia-consume, m5-p3a-refundpolicy,
  m5-p3b-create-refund-seam) + `backend-psp-br-secondary` **parked** (Marco 6, ADR-023). **Nenhum** work-item p/ calendar/ADR-010,
  customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker**. Usar esta
  auditoria como o gate.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do piloto + 1 dos 2 jobs
de CI vermelhos**. (Inalterado em substância vs 10-29 — código congelado.)

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + gate de pré-requisito no `onboarding/advance` + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia (nem override resgata); e o `advance` guardless é a **raiz sistêmica** (onboarding "completa" sem grade) → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) + fechar teardown `closeDb()/closeRedis()` (os 57P01) **+ isolar o flaky unit de Sentry/instrument** | **0,5-1h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) e estabiliza o novo flaky de pollution unit |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado (HS256) não autentica no calendar/money (RS256) → **1ª falha dura** (`clerk-auth.ts:89-97`); a tabela `users` é hoje não-bootstrappável |
| 4 | **`pnpm audit`: `zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**52 highs**, incl. `zod` core de validação + `fastify` core); re-acende o scanner agendado (dark 09-22→10-27) |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** na fronteira (CHECK + backfill + e2e); **+ corrigir o shape IG do inbound** (`detectProvider` lê `data.messaging`) + corrigir o `accepted`-metering de IG | **3-5h** | **Pilot-universal**: hoje **100%** das respostas de IA são dropadas em silêncio como `done` (outbound) **e** 100% do inbound IG é não-dispatchado mas metrado `accepted` (inbound) |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + expor `/metrics`+`/healthz` no worker + `w.on('failed')` capturar | **1-2h** | Fecha o buraco (worker sem NENHUM scrape-surface) dos **11 workers**; logs Pino sobrevivem mas sem alerta nem liveness |
| 7 | **Adicionar `RETURNING id`/rowcount aos 3 UPDATEs guardados de charge** + gatear efeitos no rowcount + `withRedisLock` no `expireChargeManually` | **~1,5h** | **1 fix fecha 3+ superfícies**: o bug HIGH irreversível (refunded-remark = 2º row paid + grant-orphan de pacote) **E** o path Stripe teórico **E** o audit-falso do expire |
| 8 | **`/metrics` autenticado + bucket de labels** + anexar rate-limit a `/staff/sessions[/refresh]`+money+webhooks + `.min()`/length-refine nos 19 secrets + `expires_in` do token staff + org-scoping na Redis key de idempotency | **~4h** | Fecha a superfície pré-auth composta do `/metrics` (enumeração org-UUID + 2 cardinality-bombs) + o buraco app-wide de rate-limit + o piso de entropia + `expires_in` + o cache-key cross-tenant |
| 9 | **`GET /appointments` (REST, Clerk + staff-ops)** + emitir SSE `appointment.created`/`charge.updated` + documentar os 7 handlers drift (+ 4 webhooks) + validador OpenAPI no CI; **+ filtro de org no SSE firehose staff + audit** | **4-6h** | "Ver agenda" não tem endpoint **nem** push; fecha o drift silencioso (b) + o firehose cross-org de conteúdo LLM não-auditado (admin-reachable) |
| 10 | **Aplicar gate `ai_opt_out`/consent + aviso-automático no intake + `dsr_requests`/`consent_events`** + hidratar/corrigir DSR export (telefone/channels + superseded-facts + appointments/waitlist; excluir stubs) + deleção/soft-delete de **customer** | **8-12h** | LGPD (piloto roda com PII real; ingestão ungated, 8 cópias não-apagáveis, DSR **stub + vazio p/ a população real** + inacessível, erasure só p/ users) |
| — | Higiene batch: `message_id → m.id` (~15min, destrava toda dispatch de IA, **ambos** os paths) + `buildDispatchMessages` LIMIT + PERM-05 skills+denied (fail-open) + proposal-idempotency_key (cross-repo); vincular token de callback ao `:id` (IDOR); harness `status` POST→PATCH + errata canon (fixar junto com applyStatusTransition-guard); StatusHistory + `created_by`/`confirmed_at` + matriz de transição; índices FK (20/61 + `customers`); FK snapshot-drift 0012; versão/tag SemVer (22 commits); docs stale (resolve-organization-id + CLAUDE.md §8 + rules harness/db/routes); `rm .claude/state/gap*.js`; `amount_total.max` (+ service-packages) + currency CHECK; impersonation approved_by+scoping+audit; deletar `newOpaqueId`/`verifyStaffRefreshToken`; `refunds.reason_code` | **~24-30h** | Contrato harness + agenda-correção + perf GA + LGPD-audit + money-hardening + governança |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — `message_id` não-UUID → ZodError **pré-enqueue** em **ambos** os paths
  de dispatch (CAUSA inércia do harness + orphan-pending + MASCARA unbounded/active_execution_id/**PERM-05 Layer-2 fail-open**/
  proposal-key); `status`-callback POST vs PATCH 404 total (método = causa única; backend canon-correto §10.4; fix harness→PATCH +
  errata canon — fixar junto com `applyStatusTransition`-guard); `proposal-missing-idempotency_key` (draft→approve 400);
  `strategy='failed'`→não-`error`, `aborted_*`→400; `/stream` **wired-mas-gated**; `/traces`-sem-produtor (+ `trace-content` cai no
  vazio); token-IDOR; `/complete` bodyOrgId **inerte**; `agent_config.default_model` + `callback_base_url` (NOVO LOW);
  `max_cost_usd`-não-enviado **não é gap** (ADR-016 proposed). Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` (`messages/schemas.ts:7`)
  **re-confirmado byte-level** → `wa`/`ig` do backend causa o drop de **outbound** (pilot-universal, sem escape semeado); o shape IG do
  **inbound** (`data={messaging}`, `inbound/service.ts:245-248,320-322` + `webhook-delivery.ts:160-166` verbatim sem reshape) não casa
  `detectProvider` → **100% do inbound IG não-dispatchado** (metrado `accepted`).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um principal Clerk
  (usuário + org + JWT-template `organization_id`); o seed não provisiona **e a tabela `users` é não-bootstrappável**. A DSR export
  também é Clerk-only → inacessível ao ator semeado. JWKS instance-scoped (de-escala o aud/iss-gap p/ MÉD).
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`); refund manual não passa por
  webhook; o reconcile de refund Stripe está **DOA (42703), cron-only mas LIVE-wired**; `intent-reconcile` half-applies + UPDATE
  status-unguarded (NOVO); `reconcile-fifo-starvation`; o money-bug #1 compartilha `applyChargePaid` com o webhook **mas o path Stripe
  não é externamente manufaturável** (dedupe `event.id`). Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer auth
  interativa — indisponível nesta sessão headless** (reportado; não bloqueante p/ auditoria de código).
- **canon (`bevox-knowledge origin/main` @ `7874971`)** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score **Opção C
  vinculante**), backend/ADR-009 (identidade canônica) não-implementadas; _shared/ADR-019 (bases legais → gate consent + aviso),
  _shared/ADR-020 (retenção → scoping de message_records/received_events/execution_traces/appointments/waitlist, `created_at` de
  servidor, retention worker, DSR deletion + `dsr_requests`/`consent_events`). Drifts "canon-atrás-do-código" (`/status` POST↔PATCH,
  `create-refund`, `dead_letter` no enum, `/complete` 410) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra, `origin/master` @ `fd1373b`)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1`
  (sem os 22 commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem principal Clerk); a
  network-policy do `/metrics` é o único controle do vazamento+inflação de org-UUID.
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` desde **09-22** até 10-27 (~5,5 sem); hoje (sexta) sem slot
  vencido → gate agendado dark; causa não-introspectável offline. Os commits de audit são **locais** (nunca pushados) → `ci.yml` não
  roda neles.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs são invisíveis ao
  tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-29)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/ db/` **vazio**;
`HEAD` = o commit do próprio audit 10-29; `describe` `v1.0.1-40` (era `-39`).

**Ground-truth (mensurável) — Security re-platôou pela 3ª vez; o ÚNICO sinal que se mexeu foi um flaky NOVO (ambiental) na unit:**
- **`ci-security`:** **120 vulns / 10 low / 58 moderate / 52 high / 0 critical** — **byte-idêntico ao 10-29** (os mesmos 19
  módulos-high, as mesmas contagens por-módulo). **3ª passada consecutiva a 52.** Tendência high **12→15→18→49³→50⁴→52³**.
- **`ci-tests`:** RED idêntico (mesmo flaky `booking_notice:259` ~09:03 UTC), com **2× unhandled 57P01**. **DELTA:** `pnpm test`
  (unit) deu **2 failed | 467 passed (469)** na 1ª rodada full (Sentry/instrument), **mas passa em isolamento e exit 0 na 2ª rodada
  full** → **flaky de test-pollution NOVO, ambiental** (no 10-29 era 469/469 estável). Fast-gate restante GREEN idêntico
  (Typecheck/Format/OpenAPI-parse/Build+alias-gate ✓).
- **`ci-scheduled-runs-dark`:** janela **09-22→10-27** inalterada (último run = slot 10-27 às 11:14 UTC `startup_failure`; 10-26 11:34
  idem). Hoje (10-30, sexta) **sem slot cron vencido** — não é regressão.
- **lint:** RED local idêntico (5 `.claude/state/gap*.js` gitignored, **0 adicionados**) → CI-GREEN.

**0 REFUTAÇÕES DE CÓDIGO (corpus carregado permanece 0-refutado — ~9ª passada).** Nenhum claim-novo foi refutado tampouco; a única
auto-refutação foi uma **hipótese-candidata** do próprio SCHEMA-agent ("Módulo 18 Onboarding ausente" = FALSO — os endpoints existem),
que **virou** o miss NOVO `onboarding-advance-guardless`.

**~18 MISSES NOVOS (1 MÉD-HIGH no pilot-path; resto LOW/MÉD/latente/governança):**
- **SCHEMA/a:** `onboarding-advance-is-guardless-enum-setter` (**MÉD-HIGH** — raiz sistêmica do CRÍTICO-1); `drizzle-DB-FK-divergence` (90 vs 91, LOW).
- **AUTH:** `impersonation-approved_by-never-written` (MÉD — auto-autoriza); `impersonation-provides-no-route-scoping` (MÉD — cosmética).
- **LGPD:** `appointments-waitlist-denormalized-pii-not-erasable` (MÉD — 7ª/8ª cópia); `consent_events/dsr_requests-absent` (LOW-MED).
- **MONEY:** `reconcile-charge-update-status-unguarded`, `refunds.reason_code-dead`, `connectManualAccount-dup-audit`, `overflow-extends-service-packages`, `currency-divergence`, `package-grant-orphan-sub-surface` (todos LOW-MED).
- **CHANNELS:** `ig-inbound-metered-as-accepted` (LOW-MED obs) + correção `outbound-drop-IS-metered`.
- **HARNESS:** `agent_config.default_model-not-mirrored`, `/traces-drops-content`, `callback_base_url-dead` (LOW).
- **ROUTES/OBS:** `api.ts-blind-to-11-routes`, `stripe-webhook-core-triple-gap` (MÉD), `worker-has-no-scrape-surface` (sharpen).

**3 DE-ESCALAÇÕES (NÃO re-inflar):** `payment_accounts professional_id uniqueness` = **imaterial** (coluna sempre-NULL); o **drop de
outbound É metrado** (`skipped_missing_recipient` — não é telemetricamente invisível); o snapshot-drift 0012 → **FK duplicada
redundante** mais provável que `42710` (nome difere).

**Sharpenings/correções de contagem:** PERM-05 Layer-2 é **fail-OPEN** (não só inerte); `message_id`-poison mata **ambos** os paths;
status-404 é **método-causa-única**; worker **sem nenhum scrape-surface**; FK-sem-índice corrigido **p/ cima** (20 tabelas / 61
FK-cols, era ~18/≈55); **90 FK-modeladas / 91 FK-DB** (era "91/≈93"); inline parse **168** (153+15, era ~160); worker **11**
(confirmado ×3).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH pilot-universal);
`ig-inbound` (100% IG dropado); `manual-remark orphan` (HIGH irreversível, manual reachable); `reconcile-refund-42703` (cron-only);
`callback-token-IDOR`; `rbac-org-role`; `clerk-provisioning`; `message_id`-poison + `status`-method 404 + `active_execution_id` wedge;
toda a bateria LGPD; worker-telemetry; priority-score/templates Marco-2/3; version-drift (22 commits, nenhuma imagem pós-`v1.0.1`);
scheduled-CI-dark; docs/CLAUDE.md/README staleness.

**Arco desde a passada mais antiga (06-02):** os 3 CRÍTICOs originais foram fechados/recaracterizados; os 2 CRÍTICOs atuais (grade +
calendar no seed) persistem há ~4 meses atrás do gate auth-actor (isolado 07-20, re-confirmado 13×), e esta passada acrescentou a
**raiz sistêmica** (`onboarding-advance` guardless). A frente de CRÍTICOs está **estável e sem correção há ~4,9 meses**; nesta passada
o **Security re-platôou byte-idêntico a 52 pela 3ª vez** e o **único movimento de CI foi um flaky unit ambiental NOVO** (não-código).
Valor incremental em **precisão (raiz sistêmica nova, ~18 misses latentes, 3 de-escalações, correções de contagem)**, não descoberta
de regressão.

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a **re-verificar
de fonte-primária** o inventário do 10-29 do seu domínio contra o **código atual** com evidência fresca `file:linha`, a **REFUTAR**
adversarialmente (≥2 por domínio, com a lista explícita de de-escalados a NÃO re-inflar), e a caçar misses. **4 usaram agent-types
locais** deste repo (`.claude/agents/`): `harness-callback-auditor` (l), `backend-staff-rbac-reviewer` (auth), `Security Engineer`
(payments j), + **4 general-purpose** (channels k; LGPD g; schema/PRD a+h + 2 CRÍTICOs; pilot m + routes b + obs + tests e + CI i).
**Resultado agregado: inventário do 10-29 re-confirmado verbatim; 0 refutações de código; ~18 misses NOVOS (1 MÉD-HIGH pilot:
onboarding-advance guardless); 3 de-escalações; correções de contagem.** Tallies: AUTH 9/9 + 4 novos; LGPD 6/6 + 2 novos; MONEY 5/5 +
6 novos + 1 de-esc; HARNESS 7/7 + residues + 3 novos; CHANNELS 5/5 (2 sharpened) + 1 novo + 1 correção; SCHEMA/PRD 6/6 (2 CRÍTICOs) +
2 novos + 1 auto-refutação→novo-miss; PILOT/ROUTES/OBS/TESTS all-confirmed + recount-exato + 4 novos.

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD -- src/ db/` =
vazio; last-commit-touching src/ **e** db/ = `dbd231e`; describe `v1.0.1-40`); origin/main dos 5 repos (backend dbd231e / canon
7874971 / harness 2979eb0 / meta-api 5516c2a / hub fd1373b, inalterados vs 10-29); léxico legado (grep triado = zero executável; 3
crus = doc-comments); MFA (seed `generateMfaSecret` + assert firsthand `seed-pilot.ts:153-154,165`; CLAUDE.md §8 l.171 stale); debt
(0 FIXME/HACK/XXX, 1 @deprecated, ~11 TODO Marco-2/3); PCI-nil; canon (PRD §16.1 todos `[ ]` verbatim l.1483-1488; ADR-statuses
008-023 lidos de origin/main — 016 proposed, 011 superseded, 020/021 aceita); version-drift (`merge-base --is-ancestor dbd231e v1.0.1`
= FALSE, 22 commits, 4-way; `release.yml` SemVer-only); os 2 CRÍTICOs firsthand (grep 0 writers `professional_schedules` + 4 inserts
`seed-pilot`); roots de dinheiro (void-returns `repository.ts:395-413`) e dispatch (`external_message_id` `repository.ts:395,409`)
firsthand; worker 11 + sem `instrument`/`initTelemetry` em `queue/index.ts` firsthand; 4 callbacks PATCH/status + 3 POST firsthand;
docs-stale (resolve-organization-id.ts inexistente + 5 citações + CLAUDE.md:171 + harness-contract/db/routes rules) firsthand;
scheduled-CI (`gh run list` — startup_failure 09-22→10-27).

**Ground-truth de CI rodado de fato** (2026-10-30 ~09:03 UTC): Typecheck ✓ / Format ✓ ("All matched files use Prettier code
style!") / Build ✓ (incl. alias build-gate) / OpenAPI-parse ✓ = **GREEN**; `pnpm test` (unit) = 1ª full **2 failed/467 (469)** →
**isolamento PASS** → 2ª full **exit 0 (469/469)** = flaky pollution ambiental; `test:integration` = **RED exit 1** (`1 failed | 92
passed (93)`, flaky `booking_notice:259` ~09:03 UTC < 13:00 + **2× teardown 57P01**); `pnpm audit --audit-level high` = **RED exit 1,
120 vulns / 52 high** (10 low · 58 moderate · 52 high · 0 critical; **19 módulos-high byte-idênticos ao 10-29**); `lint` = RED por
artefato local (5 `.claude/state/gap*.js` gitignored → CI GREEN; 0 adicionados). **Estado GitHub:** scheduled runs em
`startup_failure` (0s) 09-22→10-27; sem slot cron hoje (sexta).

**Canon.** Lido por path absoluto `~/bevox-knowledge` via `git show origin/main:<path>` (ADR-005). Numeração de ADR
**colide** entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner / CodeQL não
reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta reais) não exercitado —
verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de writers/endpoints + CI rodado (incl. 14
suítes de integração live Postgres+Redis via testcontainers) + cross-repo byte-level (harness `bevox-callback.ts`/`execution-handler.ts`,
meta-api `messages/schemas.ts`+`inbound/service.ts`+`webhook-delivery.ts` lidos de `origin/main`). (4) MCP `stripe` + `claude.ai Google
Drive` requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5) Esta passada é
re-verificação sobre código byte-idêntico; o valor incremental é **CI fresco (Security re-platôou byte-idêntico a 52 pela 3ª vez; um
flaky unit NOVO ambiental) + 0 refutações de código + ~18 misses NOVOS (1 MÉD-HIGH pilot: onboarding-advance guardless = raiz
sistêmica) + 3 de-escalações + correções de contagem (20/61 FK, 90/91 FK, 168 parse, 11 workers)**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-30. Sem alteração de código de produto; somente este
relatório. Revisão humana pendente.*
