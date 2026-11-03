# Gap Analysis — bevox-backend — 2026-10-29

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo segundo a
> documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **5 auditores de domínio em paralelo** (4 agent-types locais — `harness-callback-auditor`,
> `backend-staff-rbac-reviewer`, `Security Engineer`, + 2 `general-purpose`), cada um re-verificando **de fonte-primária**
> o inventário do 10-28 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR**
> adversarialmente (≥2 por domínio, com a lista explícita de de-escalados a NÃO re-inflar) + caçar misses;
> **verificação independente de fonte-primária pelo orquestrador** (freeze, CI, canon `origin/main`, léxico, MFA, debt,
> version-drift, 2 CRÍTICOs, roots de dinheiro/dispatch); e **CI rodado de fato** (2026-10-29 ~09:05 UTC, não inferido).
> Sucede `runtime-gap-audit-2026-10-28.md`.

## Resumo executivo

**17ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,9
meses.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é **vazio** (produto byte-idêntico a `dbd231e`,
2026-06-03; `git describe` = `v1.0.1-39-gbaec582`, o `-39` são commits de audit docs-only — era `-38` no 10-28). Canon
`bevox-knowledge origin/main` @ `7874971`, `bevox-harness origin/main` @ `2979eb0`, `bevox-meta-api origin/main` @
`5516c2a`, hub `bevox-PRD-consolidation origin/master` @ `fd1373b` — **todos inalterados vs 10-28**.

**Manchete-delta — 2ª passada consecutiva com DELTA-ZERO em TODOS os sinais de CI, e a 1ª REFUTAÇÃO DE CÓDIGO em 8
passadas.** Dois fatos novos, ambos de precisão (não de regressão):

1. **O `idempotency-required-header-unenforced` do 10-28 é FALSO POSITIVO (REFUTADO firsthand).** O preHandler `write`
   de payments **inclui** `app.requireIdempotency()` (`payments/routes.ts:53`), que **lança 400** quando a
   `Idempotency-Key` está ausente/vazia/malformada (`idempotency.ts:78-83`), **antes** do handler; `POST /charges/manual`
   **e** `/refund-manual` usam `write` (comentário `:55-58` confirma). O 10-28 confundiu `write` (tem idempotency) com
   `mutate` (não tem — `mark-paid`/`expire` são deliberadamente não-idempotentes). **Portanto a "charge duplicada no
   retry do cliente" que o 10-28 colocou no money-path do piloto NÃO existe.** O orquestrador cometeu o mesmo erro no
   spot-check inicial desta sessão (olhou os reads crus do header, não a cadeia de preHandler) — corrigido aqui. **Nota
   importante: o corpus CARREGADO permanece 0-refutado (8 passadas); foi a adição MAIS NOVA (do próprio 10-28) que errou**
   — o padrão recorrente da série (claims-novos refutados na passada seguinte; o estável segura).

2. **O platô de segurança QUEBRADO no 10-28 (+2 high → 52) re-platôou byte-idêntico hoje.** `pnpm audit --audit-level
   high` = **RED, 120 vulns / 10 low · 58 moderate · 52 high · 0 critical** — **os mesmos 19 módulos-high, as mesmas
   contagens por-módulo** que o 10-28. O "+2 high" do 10-28 **não propagou**; 52 segurou exatamente. Tendência high:
   **12→15→18→49³→50⁴→52²**.

**Principais riscos (inalterados):** o piloto **morre no passo 2 ("ver agenda")** — não é executável como semeado.
Veredito unânime dos 5 auditores + orquestrador: **login → OK; ver-agenda → 1ª FALHA DURA = 401 auth-actor** (seed cunha
JWT staff HS256; todo calendar/money exige Clerk RS256). Atrás desse gate, dois CRÍTICOs de agenda persistem há ~4 meses
(grade semanal sem escritor app-wide + seed sem Calendar → **quadruple-gated**). O money-path manual **funciona** (ADR-023
aceita) mas carrega 1 bug HIGH **irreversível** (re-mark órfão). E o único bloqueador **mensurável** de Marco-1 pelo canon
(PRD §16.1 l.1483 "CI verde") segue **RED** em 2 dos 3 sinais.

**Ground-truth de CI (rodado de fato 2026-10-29 ~09:05 UTC — inalterado vs 10-28):**
- **Security:** RED exit 1, **52 high / 120** (10 low · 58 moderate · 52 high · 0 critical); 19 módulos-high byte-idênticos
  (`undici`=10, `brace-expansion`=10, `fast-uri`=7, `fastify`=4, `@grpc/grpc-js`=3, `js-yaml`=3, `protobufjs`=2,
  `nanoid`=2, + 11×1: `tmp`, `@opentelemetry/propagator-jaeger`, `find-my-way`, `@fastify/static`, `postcss`,
  `source-map-js`, `@opentelemetry/exporter-prometheus`, `@opentelemetry/auto-instrumentations-node`,
  `@opentelemetry/sdk-node`, `vite`, `zod`). `zod@4.4.3` direct-prod permanece; `fastify@5.8.5` core carrega 4 highs.
- **Tests:** `pnpm test:integration` = RED exit 1, `1 failed | 92 passed (93)` (`Test Files 1 failed | 13 passed (14)`)
  — o mesmo flaky dependente de hora-do-dia `calendar-booking.test.ts:259` (rodei 09:05 UTC < gate ~13:00 UTC → `booked`),
  com **2× unhandled `57P01`** (teardown testcontainers). Fast-gate **GREEN idêntico** (Typecheck/Format/OpenAPI-parse/
  Build+alias-gate ✓; Unit **469/469, 69 files**).
- **scheduled CI:** todo run `schedule` em `main` (Security seg-cron; CodeQL ter-cron) segue em **`startup_failure` (0s)**
  ininterrupto **09-22 → 10-27** (último = CodeQL slot 10-27 às 11:14 UTC). **Hoje (10-29) é quinta → nenhum slot cron
  vencia** (consistente). Último run agendado que executou de verdade = Security `failure` **09-21** / CodeQL `success`
  **09-15** (~5,5 semanas sem scanner agendado real).
- **lint:** RED **só local** (5 `.claude/state/gap*.js` gitignored — `git check-ignore` confirma os 5; **0 adicionados**
  nesta sessão, `git status` limpo) → **CI-GREEN** (checkout limpo não os tem).

**Resultado dos 5 auditores:** inventário do 10-28 re-confirmado **verbatim**; **1 refutação de código** (o
`idempotency-header` do 10-28, acima) + **~7 misses NOVOS** (6 LOW/latentes/governança + **1 MÉD alcançável-no-piloto
pelo admin**) + **1 correção de framing** (perdas materiais do DSR) + várias sharpenings. **Os 2 CRÍTICOs de agenda, o
gate auth-actor, o money-bug HIGH irreversível, o `message_id`-poison e o `status`-callback 404 persistem sem regressão.**

**Os misses NOVOS mais consequentes:**
1. **`staff-sse-firehose-crossorg-llm-content-unaudited` (MÉD — AUTH, admin-alcançável-no-piloto):** `GET
   /api/v1/staff/realtime/events` (`staff-ops/realtime.routes.ts:28-29`, guard = todos os `STAFF_ROLES` incl observer) faz
   `psubscribe("realtime:*")` (`:66`) — **firehose de TODAS as orgs** — e o evento `execution.stream` carrega `chunk` =
   **conteúdo de resposta LLM ao vivo** (`harness-callbacks.routes.ts:128-132`; canal `realtime:${orgId}`). Sem filtro de
   org, **sem `audit_events`**. Diferente das rotas Clerk (passo 2), rotas staff-ops **aceitam o token HS256 do
   `bevox_admin` semeado** → **alcance admin é VIVO no piloto**; a escalada de conteúdo por `observer` é latente até semear
   2º role. Sharpening do carregado `staff-ops-realtime-sse-firehose-unaudited`. — Esforço: 2-4h.
2. **`execution-traces-pii-sink-not-titular-erasable` (LOW-MED latente — LGPD):** `execution_traces.input_json`/
   `output_json` (I/O de tool do harness, PII-capaz) é org-scoped mas **sem `customer_id`, sem `deleted_at`** e **ausente do
   DSR export**; write-path wired (`insertExecutionTraces` `harness-callbacks.repository.ts:196` ← POST `/traces`), mas
   `/traces` é producerless hoje → vazio no piloto. Estende a família de PII-não-apagável além de
   received_events/message_records.
3. **Correção de framing (LGPD, não re-inflar na direção errada):** `risk_flags_json`/`preferences_json` têm **zero
   writers em lugar nenhum** (grep `src/ scripts/` = 0) → `dsr-export-omits-profiling` é **IMATERIAL hoje** (sempre NULL,
   mesmo status de `consent_granted_at`). **As perdas materiais do DSR export são (a) PII de `customer_channels`**
   (telefone/handle/display_name/external_user_id — escrito no intake `channels/repository.ts:120-128`, nunca exportado) **e
   (b) `customer_facts` superseded** (excluídos por `superseded_by IS NULL`). O framing "perdas reais = preferences/risk_flags"
   (memória 10-25) fica **corrigido** para channels + superseded-facts.

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte-primária esta sessão (repetem-se vs 10-28 porque o brief é o mesmo):

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`) — **não** `/complete,/artifact,/tool-result,/turn` como o
   brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (`aceita`, lido de `origin/main`), **não "channels"**.
   **Channels = _shared/ADR-011.** backend/ADR-018 = refund/cancellation (`aceita`). O range "0011 a 0018 Marco-1" do brief é
   aproximado; as ADRs aceitas **vinculantes** vão até 0023 (008/009/010/012/013/014/015/017/018/019/020/021/022/023 =
   `aceita` — lido de `origin/main` hoje; 016 token-billing = `proposed` → corretamente NÃO implementado; 011 = `Superseded
   by ADR-019`).
3. O grep `account_id\b`/`accountId` do brief captura 232 ocorrências em `src/`/`db/`, **todas sancionadas** (composites
   `chatwoot_account_id`/`external_account_id`/`payment_account_id`/`channel_account_id`, alias `AS account_id`, propriedade
   Stripe `res.accountId`, doc-comments, snapshots drizzle). O léxico proibido **executável** é **ZERO**; os **3** hits crus
   de `workspace_id`/`workspaces` são **doc-comments** (`organizations/routes.ts:3`, `db/schema/autonomy.ts:3`,
   `autonomy/routes.ts:5`). Invariante §4.1 mantida — **não-gap**.
4. **MFA sentinel (categoria d) — não há bug a corrigir** (verificado firsthand). `scripts/seed-pilot.ts:153` chama
   `generateMfaSecret()` (base32 160-bit) + `:154 assertMfaSecretNotPlaceholder()` e grava um secret **real** (`:165`); o
   comentário `:129-131` admite "NÃO é mais um placeholder literal". O sentinel `PILOTSEEDONLYNOTASECRET` só aparece como
   **doc-comment** da blocklist (`src/shared/mfa.ts:66`); grep em `src/` = só esse doc-comment. Login staff sem MFA é
   **correto** (TOTP é Marco-3, PRD §16.3/ADR-013; `auth/service.ts:84-86`). **NÃO implementar "rejeitar o sentinel"** (é
   moot — o seed não o grava). Fix de código = **0h**; o único resíduo é a prosa de **`CLAUDE.md §8 l.171`** (factualmente
   stale — ainda afirma que o seed grava `mfa_secret = PILOTSEEDONLYNOTASECRET`). Vai pro doc, não é bug.
5. **A premissa da categoria i do brief está stale.** O brief diz "Tests (harness-contract FK seeding, issue #36)" e "Lint &
   Format (prettier debt)". Ambos **resolvidos**: `pnpm format:check` = **GREEN** ("All matched files use Prettier code
   style!"); o Tests-RED atual é o flaky `booking_notice:259` (hora-do-dia) + 2× teardown `57P01`, **não** #36. O lint-RED é
   **só local** (5 arquivos `.claude/state/gap*.js` gitignored) → **CI-GREEN**.
6. Código congelado desde **06-03** (`dbd231e`), não 06-04. **RBAC de staff é canon backend/ADR-013** (roles
   `bevox_admin|bevox_support|bevox_observer`, confirmado `staff-auth.ts:33`), **não ADR-022** (backend/ADR-022 =
   `policy-json-sub-keys`). Numeração de ADR **colide** entre `backend/` e `_shared/` (008–023) — sempre qualificada abaixo.
   O work-item `backend-staff-rbac` no tracker é `governed_by` ADR-013 (não ADR-022).
7. O `status`-callback **não é** drift de OpenAPI: é **PATCH** no YAML **e** no handler (`routes.ts:56`) — concordam. A
   quebra POST-vs-PATCH é **cross-repo** (harness POSTa) — categoria l, não b.
8. O path do metaapi é `src/modules/channels/metaapi/`, não `src/modules/metaapi/`. `pnpm openapi:check` é
   `openapi-typescript --output -` (**gerador de tipos**, exit 0 = só parse; emitiu 4822 linhas de TS esta sessão) — **não**
   valida rota↔spec, por isso o drift OpenAPI é invisível ao CI.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1481-1487)** — lido verbatim de `origin/main`: `[ ]` repo criado + **CI
  verde**; migrations em pg16; módulos auth/organizations/users/professionals/services/customers; OpenAPI publicado;
  contrato harness documentado+testado com stub; deploy staging via Docker Compose. **Tudo entregue EXCETO "CI verde"**
  (checkbox ainda `[ ]` l.1483) → o único bloqueador **mensurável** de Marco-1 é **CI-verde** (RED em Tests + Security).
- **§16.3 Marco-3** inclui payments Stripe Connect, reminders, **LGPD DSR/retenção/consentimento**, **MFA TOTP**,
  observabilidade completa. Os CRÍTICOs de agenda são **Marco-2/3-por-rótulo mas pilot-blocking**; o README "Marco 1
  bootstrap" **subdeclara** o que o código entrega (calendar + payments-manual + worker assíncrono + channels/metaapi +
  google-sync). **"Marco-1 concluído?" ≠ "piloto-pronto?".**
- **Status de ADR (origin/main, re-lido hoje):** 008/009/010/012/013/014/015/017/018/019/020/021/022/023 = **`aceita`**;
  016 (token-billing) = **`proposed`**; 011 = **`Superseded by ADR-019`**. _shared/ADR-019 (bases legais LGPD) + _shared/
  ADR-020 (retenção) = **aceitas**. ADR-010 (calendar) e ADR-009 (customer-identity) são **aceitas** → os 2 CRÍTICOs são
  escopo aceito, não especulativo.

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-29) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO app-wide, grep=0 confirmado); seed-no-calendar; `StatusHistory`+`OperationalMetricSnapshot`+`created_by`+`confirmed_at` (Módulo 16/§8.3-8.4, grep=0); ADR-020 templates + ADR-021 priority-score (Opção C **vinculante**, client-settable sem CHECK) não-materializados |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recount reproduzido **EXATO**: `103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 / 11 undoc (7 drift-real)`; ZodTypeProvider=0; inline `.parse`=160-167 (por metodologia de exclusão); **`idempotency-required-header` REFUTED** |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO**; 3 "crus" = doc-comments |
| d | MFA sentinel | ✅ **CONFORME** | seed gera base32 160-bit + assert; sentinel só blocklist doc-comment; login sem MFA = correto; **`CLAUDE.md §8 l.171` stale**; fix=0h |
| e | Testes faltando | ✅ | webhook Stripe (`constructEvent`=0 em test/); reconcile só unit-mockado (→ 42703 CI-invisível); transition/reschedule **não testados** (docstring `calendar-booking.test.ts:18-22` admite "outro PR"; 0 chamadas diretas); `getAvailableSlots` não testado; `seed-pilot.test` false-green (`TEST_AUTH_BYPASS_ENABLED=true`) |
| f | Bugs/dívida | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); **~4** TODO reais, todos Marco-2/3 |
| g | LGPD | ✅ | ingestão PII **ungated** pré-aviso vs rights-path **RS256-gated** (inalcançável no piloto HS256); **5** cópias de PII inbound cruas + **execution_traces** (NOVO); DSR export **omite telefone/channels + superseded-facts** (perdas materiais); `customers` sem erasure-path; **zero** base-legal/consentimento persistido |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main l.781-826, verbatim, **sem drift**); **nenhum** work-item p/ calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker** |
| i | CI vermelho | ✅ (rodado 09:05 UTC) | Tests RED (flaky `booking_notice:259` + 2× `57P01`) + Security RED **52 high / 120** (platô **re-estabelecido byte-idêntico**, 19 módulos); fast-gate GREEN (469/469); lint-RED = 5 `gap*.js` gitignored (0 adicionados) → CI-GREEN; scheduled dark **09-22→10-27** (sem slot hoje, quinta) |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + irreversível** (refunded-remark = 2º row `paid`; raiz ÚNICA `repository.ts:395-413` void-returns); `expireChargeManually` **sem `withRedisLock`** + audita-falso; reconcile half-applies + FIFO-starvation + `reconcile-refund-42703` (cron-only LIVE-wired); **DE-ESCALADO: Stripe-path NÃO externamente manufaturável**; PCI-nil (grep=0) |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH pilot-universal** (outbound `wa`/`ig` vs enum meta-api `whatsapp`/`instagram`); `ig-inbound-silent-nondispatch` (100% IG inbound dropado, cross-repo byte-level); `event_type` cardinality-bomb (DoS pré-auth **não-throttled**); HMAC correto |
| l | Harness dispatch | ✅ | `message_id`-poison **CAUSA inércia do harness** (`external_message_id` text→`z.uuid()`); `status`-callback **POST↔PATCH 404 total** (root-cause único); token-IDOR status-agnóstico; `proposal-missing-idempotency_key` (2º dominó); **PERM-05 Layer-2 inteiro inerte** (skills+denied vazios, NOVO sharpen); `/traces` sem-produtor; `/stream` **wired-mas-gated** (DE-ESCALADO) |
| m | Alçapões do piloto | ✅ (traçado) | veredito unânime dos 5: **quadruple-gated**, 1ª falha = **401 auth-actor**; money-path manual OK (Clerk-user) + bug HIGH irreversível; **`idempotency-header-unenforced` REFUTED → sem duplicate-charge**; worker buraco-negro DE-ESCALADO (Sentry-off + Prometheus-unscrapable, logs Pino sobrevivem) |
| n | Delta vs audit anterior | ✅ | 10-28 re-verificado; **1 refutação de código** (idempotency-header, claim-novo do 10-28); corpus carregado **0-refutado (8 passadas)**; **~7 misses NOVOS** (1 MÉD admin-reachable) + 1 correção; Security/Tests/scheduled **delta-zero** |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária por 5
auditores; veredito unânime = NÃO executável como semeado, 1ª falha dura no passo 2:**

1. **LOGIN (staff) — PASSA mecanicamente.** `seed-pilot` cria org + `bevox_admin`; `loginStaff` (`auth/service.ts:64-90`)
   é password-only (MFA seam presente não-enforced `:84-87`); cunha JWT staff **HS256** (`staff-auth.ts:70`). **Sem
   rate-limit/lockout** (`auth/routes.ts:90` sem preHandler; `requireRateLimit` 0 callers).
2. **VER AGENDA — 1ª FALHA DURA = 401 (auth-actor).** `GET .../availability` (`calendar/routes.ts:48`) é gated por `read`
   = `requireClerkAuth`+`requireOrganizationScope` (`:22`); `requireClerkAuth` aceita **só RS256** (`clerk-auth.ts:90`). O
   único principal semeado é staff **HS256** → 401 **no preHandler, antes do handler**. **Quadruple-gated:** `401
   auth-actor` → (se corrigido) `404 no-calendar` (`availability.ts:75`, **CRÍTICO-2**) → `grade vazia app-wide`
   (`availability.ts:116,:126`, **CRÍTICO-1**). Book/charge/reconcile inalcançáveis a jusante.
3. **AGENDAR — BLOQUEADO a jusante.** **Main-path exactly-once É SÃO** (advisory xact-lock + recount in-lock + unique
   index + replay 23505, `booking.ts:223-263`; POST honra `Idempotency-Key`) — e é o **único** path que os testes cobrem.
   `rescheduleAppointment` roteia pelo `createAppointment` são (book-new-before-cancel-old) → **capacity-sound, NÃO
   compartilha o defeito de transition** (refinamento desta passada). `transitionAppointment` tem ~8 defeitos de correção
   (incl. `cancelled→confirmed` over-book sem recount + `completed→cancelled` não-restaura pacote), **não-testados por
   admissão do autor**.
4. **COBRAR — money-path manual FUNCIONA (via Clerk-user; não hands-off-seedável).** Serviço semeado sem `requiresPrepayment`
   + `seed-pilot` não cria `payment_accounts`. **1 bug HIGH irreversível** re-mark de charge terminal (refunded-remark
   insere 2º row `paid`); overflow 500 em `amount_total` ≥ 1e8. **`/charges/manual` + `/refund-manual` usam o preHandler
   `write` que ENFORCE a `Idempotency-Key` (400 na ausência) → sem duplicate-charge (o claim do 10-28 era falso).**
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile cru
   `half-applies paid`; reconcile de refund DOA (42703) — cron-only mas live-wired; manual não afetado.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[SHARPENED]`/`[DE-ESCALADO]`/`[REFUTED]` = status vs 10-28; **(v: …)** = verificação;
`[xrepo]` = dependência cruzada. Severidade ancorada no gate do **piloto**; escalonamento p/ GA anotado. `file:linha` =
evidência lida **nesta** sessão sobre código byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry]` **(v: CONFIRMADO firsthand — orquestrador + SCHEMA/LGPD agent)** — Nenhum
  caminho do app escreve `professional_schedules` (grade semanal-base; tabela `db/schema/calendar.ts:41-62`, DB-real desde
  `0008`). Grep de `INSERT`/`UPDATE`/`.insert(` sobre a tabela em `src/`+`scripts/` = **0**; único hit app-wide é o SELECT
  `availability.ts:116`. O único writer é a fixture SQL `seedFullSchedule` (`test/integration/calendar-booking.test.ts:117-124`).
  `createScheduleOverride` (`calendar/repository.ts:78`, wired `routes.ts:43-44`) escreve `professional_schedule_overrides`
  (tabela **diferente**). `availability.ts:126 if(!sched) continue` executa **antes** da leitura do override `extra`
  (`:128`) → **sem escape-hatch**. Não existe `src/modules/onboarding/` apesar do `onboarding_stage_enum` ter valor
  `schedule` (`_shared.ts:43-44`). Impacto re-provado no path de booking: `booking.ts:200 getAvailableSlots` → `:207 if
  (!slot) return {status:"slot_conflict"}`. Escopo backend/ADR-010 **aceita**. — Impacto: 100% dos agendamentos =
  `slot_conflict`, app-wide. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h** (seedar grade). **#1.** `[xrepo: hub
  runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO firsthand — orquestrador + SCHEMA/LGPD agent)** —
  `seed-pilot.ts` importa só organizations/staffAccounts/professionals/services (`:33-35`) e tem exatamente **4** `.insert(`:
  organizations (`:110`), staffAccounts (`:157`), professionals (`:195`), services (`:217`). Zero `calendars` →
  `availability.ts:75 notFound("Calendar")`. `createCalendar` existe (`calendar/repository.ts:20`) e está route-wired
  (`routes.ts:38`) com **exatamente 1 caller = a rota HTTP** (sem worker/bootstrap); o gap é "o seed nunca o chama e não há
  bootstrap não-HTTP". `professional_services` também não é semeado → fallback "todos bookáveis" (`availability.ts:91-96`).
  `system_holidays` omitido é **fail-open** (`:108-111`), não co-bloqueador. — Esforço: **2-3h** (seedar Calendar + grade
  Seg-Sex + feriados). **#1.** `[xrepo: hub]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×3 — PILOT + AUTH + orquestrador)** — seed
  provisiona **só** org + `staff_account` (HS256, `staff-auth.ts:70`); toda rota de calendar/money é `requireClerkAuth()`
  RS256 (`calendar/routes.ts:22,48`; `payments/routes.ts:51,53,59`; `clerk-auth.ts:90` pin RS256 + claim org) → token staff
  rejeitado 401. `grep requireStaff|requireRole src/modules/calendar src/modules/payments` = **0**; o seed não cria usuário
  Clerk nem row `users`. **NOVO sharpen (v: AUTH):** a tabela `users` é **não-bootstrappável** — `user.created` exige uma row
  `users` pré-existente para resolver a org (`repository.ts:221-223`), mas o único writer de `users` é esse mesmo webhook, e
  o seed não insere nenhuma → `req.user` é **universalmente null** → o seam de "RBAC futuro" (`clerk-auth.ts:126-139`) nunca
  tem dado p/ enforçar. **1ª falha dura do piloto.** — Esforço: ops (Clerk) OU ~4-6h (rota calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-29; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice`** `[carry]` **(v: RODADO 09:05 UTC)** — `pnpm test:integration` = **RED exit 1**,
  `1 failed | 92 passed (93)`. Falha = `calendar-booking.test.ts:259` "slot_conflict quando start_at < now() +
  booking_notice_minutes" `AssertionError: expected 'booked' to be 'slot_conflict'` — o gate só dá `slot_conflict` se `now()
  > ~13:00 UTC`; rodei 09:05 UTC → `booked`. **Com 2× unhandled `57P01`** (teardown testcontainers; não muda pass/fail).
  `ci.yml` roda `pnpm test` + `pnpm test:integration` com pg16+redis7, **sem** `continue-on-error`. — Esforço: **0,5h**
  (slot `now()`-relativo + fechar `closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-52-high`** `[carry, PLATÔ RE-ESTABELECIDO byte-idêntico]` **(v: RODADO)** — `pnpm audit
  --audit-level high` = **RED exit 1, 120 vulns (10 low · 58 moderate · 52 high · 0 critical)** — **os mesmos 19
  módulos-high, as mesmas contagens por-módulo** que o 10-28 (`undici`=10, `brace-expansion`=10, `fast-uri`=7, `fastify`=4,
  `@grpc/grpc-js`=3, `js-yaml`=3, `protobufjs`=2, `nanoid`=2, + 11×1). O "+2 high" do 10-28 **não propagou**. `zod@4.4.3`
  direct-prod permanece; `fastify@5.8.5` core carrega 4 highs (auth-bypass/validation-bypass). `security.yml` → osv-scanner +
  `pnpm audit --audit-level high` **`continue-on-error: false`** → hard-fail. **Tendência 12→15→18→49³→50⁴→52².** — Esforço:
  **4-6h** (`pnpm add zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/
  brace-expansion). **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[carry]` **(v: orquestrador — `gh run list`)** — todo run `schedule` em `main`
  termina em **`startup_failure` (0s)** ininterrupto **09-22 → 10-27** (último = CodeQL slot 10-27 às 11:14 UTC). **Hoje
  (10-29, quinta) sem slot cron vencido** (consistente, não é regressão); último run agendado que executou de verdade =
  Security `failure` 09-21 (CodeQL success 09-15). ~5,5 semanas sem scanner agendado real. Causa não-introspectável offline
  (billing/quota Actions, action-ref, ou política de org). **Nota de governança:** os commits de audit são **locais** (`main
  ahead 17`, nunca pushados) → `ci.yml` **não roda** nos commits de audit; o "CI verde" só é aferível localmente. — Esforço:
  **0,2h** (re-enable). `[xrepo: GitHub Actions]`

**Auth / rate-limit — buraco app-wide**

- **`rate-limit-plugin-dead-app-wide`** `[carry]` **(v: CONFIRMADO ×3 — AUTH + money/channels + orquestrador)** —
  `requireRateLimit` tem **zero callers** (só `rate-limit.ts:4` doc, `:146` decorate, `global.d.ts:66` tipo).
  `@fastify/rate-limit@^10.3.0` declarada (`package.json`) mas **nunca importada/registrada** (grep = 0). Login staff
  (`auth/routes.ts:90`) + refresh (`:97`) sem preHandler → brute-force online ilimitado (bcrypt cost-12 único freio). O
  webhook metaapi (`routes.ts:110`) também sem preHandler → o cardinality-bomb pré-auth é **totalmente não-throttled**.
  Nenhuma rota emite 429 → o "429 undocumented" é **moot**. — Piloto baixo (1 admin). — Esforço: **~1h**. **#8.**
- **`staff-jwt-secret-no-min-length` + `secret-refine-presence-only-sistêmico`** `[carry]` **(v: CONFIRMADO ×2 — AUTH +
  orquestrador)** — `env.ts:60 STAFF_JWT_SECRET: optionalString` (sem `.min()`); `staff-auth.ts:70` assina HS256. O refine
  `requiredInProd` (`env.ts:181-213`) é **presence-only** (`if (!val[key])` `:206`) para a lista de **19** entradas (contada
  `:185-203`: CLERK_JWKS_URL, CLERK_WEBHOOK_SECRET, STAFF_JWT_SECRET, 5×GOOGLE_*, STRIPE_SECRET_KEY, 4×META_API_*,
  AEAD_MASTER_KEY, META_API_TIMEOUT_MS, 4×STRIPE_*); **nenhum** recebe validação de comprimento/formato no boot. O
  `AEAD_MASTER_KEY` (AES-256-GCM que decripta secrets de canal) é validado **lazy** só no 1º uso (`lib/aead.ts:19-26`) →
  chave mal-configurada **sobe limpa** e falha só no 1º decrypt. — Esforço: **0,5-2h**. **O buraco de auth mais duro no
  piloto (HS256 staff).**
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — AUTH, canon-reforçado ADR-013:143)** — `requireRole` é
  **vaporware** (só 3 comentários-prosa: `clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`; **não declarado** no
  `FastifyInstance` `global.d.ts:52-70`). `clerk-auth.ts:109 role = … ?? "member"` (default **fora** do enum DB
  `owner|admin|operator|professional_viewer`). Rotas cliente mutantes têm só `requireClerkAuth+requireOrganizationScope` →
  qualquer JWT org-member roda tudo intra-org (org-scope ainda bloqueia cross-org). Reforçado por `users`-não-bootstrappável
  (RBAC seam dataless). Canon ADR-013 l.143 manda middleware rbac (`aceita`). Blast-radius **nulo no piloto** (plano staff).
  — Esforço: **1-2d**. `[xrepo: backend/ADR-013]`
- **`staff-sse-firehose-crossorg-llm-content-unaudited`** `[NOVO, MÉD→ALTO-escalável; admin-alcançável-no-piloto]** **(v:
  CONFIRMADO — AUTH)** — `GET /api/v1/staff/realtime/events` (`staff-ops/realtime.routes.ts:28-29`, guard = todos os
  `STAFF_ROLES` incl observer) faz `psubscribe("realtime:*")` (`:66`) — firehose de **TODAS as orgs** — e escreve cada
  `pmessage` no stream (`:49-51`). O evento `execution.stream` carrega `chunk` = **conteúdo de resposta LLM ao vivo**
  (`harness-callbacks.routes.ts:128-132`; canal `realtime:${orgId}`). **Sem filtro de org, sem `audit_events`.** Cross-org é
  by-design p/ staff (admin onisciente), mas (a) é **audit-blind** e (b) entregaria a um `observer` read-only o firehose de
  conteúdo cross-org. **Alcance admin é VIVO no piloto** (rotas staff-ops aceitam o token HS256 semeado); escalada observer
  latente até 2º role. — Esforço: 2-4h. `[g/accountability]`
- **`impersonation-audit-trail-absent` + `impersonation-audit-writes-zero-rows`** `[carry]` **(v: CONFIRMADO — AUTH)** — O
  hook de audit (`auth/routes.ts:70-87`) vive no plugin encapsulado `authRoutes` (`server.ts:198`); staff-ops são plugins
  **irmãos** (`server.ts:213-215`) → o hook **nunca dispara** nas ações staff-ops; estas **são** auditadas
  (`actions.repository.ts:174-184`) mas gravam `actor_type='user'`, `actor_id=NULL`, sem `impersonation_id`. O "catch-all"
  produz **zero rows em todo path de sucesso** (start: token sem `impersonation_id` → guard `:72` falso; end: `endImpersonation`
  seta `ended_at` antes do hook `service.ts:153,183`). Única inserção = um `/end` com org-mismatch (4xx) → audita a
  impersonation ainda-ativa sob um end **falho** (artefato enganoso, não cobertura). — Esforço: **1-2d**. `[xrepo: ADR-013]`
- **`staff-ops-getWindow-crossorg-PII-unaudited`** `[carry]` **(v: CONFIRMADO — AUTH)** — `GET /api/v1/staff/windows/:id`
  (guard = todos `STAFF_ROLES` incl `bevox_observer`, `read.routes.ts:19`) → `getWindow(orgId?, id)`: com `organization_id`
  omitido, `read.repository.ts:112` **dropa o filtro de org** e busca a window de **qualquer** org por id, depois `:116-118
  SELECT * FROM message_records` (PII crua) por `conversation_key`; nenhum read grava `audit_events`. Mesmo padrão
  `undefined→all-orgs` em `listExecutions:52`, `listAuditEvents:219`, `organizationHealth:191`, `dashboardOverview:13`.
  Habilitado pelo schema solto (`organization_id` `.optional()` não `.uuid()`, `schemas.ts:44,55`). **Piloto: o `bevox_admin`
  semeado alcança o read cross-org não-auditado.** — Esforço: M. `[g/accountability]`
- **`clerk-user-provisioning-broken`** `[carry, strengthened]` **(v: CONFIRMADO — AUTH)** — `auth/repository.ts:221-223
  SELECT organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id) +
  `routes.ts:169-170 orgClaim = organization_id ?? clerkUserId`; `upsertUserFromClerk` hardcoda `role='operator'` (`:238`);
  webhook só trata `user.created|updated|deleted`, sem `organization.created` → **paradoxo de bootstrap: a 1ª row `users`
  nunca pode ser criada** (alimenta o gate auth-actor + RBAC dataless). — Esforço: **4-8h** (+ADR org-mapping). `[xrepo: Clerk]`
- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry, pilot-universal]` **(v: CONFIRMADO ×2 — money/channels +
  orquestrador; 2 refutações adversariais FALHARAM)** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"`
  (`normalize.ts:35,44`) e persiste em `channel_connections.provider` (`routes.ts:246-252` → coluna `notNull()` **sem CHECK**
  `db/schema/channels.ts:22`). `upsertChannelConnection` tem **exatamente 1 caller** (`routes.ts:246`), é o **único INSERT**
  em `channel_connections`, e o UPSERT nunca atualiza `provider` (`channels/repository.ts:73-77`) → provider é
  **estruturalmente sempre `"wa"`/`"ig"`**. Outbound `findExecutionDeliveryContext` null-coage provider ≠ pleno
  (`metaapi/repository.ts:197`) → `ctx.provider=null` → guard `executions/seams.ts:360` → `skipped_missing_recipient`
  (`:376`); `isDeliveryFailure` exclui skips (`:122-124`) → `complete-service.ts:100` fica `done` (**falso-sucesso**). meta-api
  `origin/main` exige `z.enum(["whatsapp","instagram"])` (`messages/schemas.ts:7`) → `wa`/`ig` é invenção 100%-backend.
  **Alcançável NO piloto (Clerk-user):** `approve()`→`deliverToChannel` **e** complete-autônomo→`deliverToChannel`. — Impacto:
  **100%** das respostas de IA a conversas inbound-semeadas descartadas em silêncio como `done`. — Esforço: **3-4h**. **#5.**
  `[xrepo: bevox-meta-api frozen 06-22]`
- **`ig-inbound-silent-nondispatch`** `[carry, cross-repo]` **(v: CONFIRMADO byte-level nos 2 repos — money/channels +
  orquestrador)** — meta-api `origin/main` envia Instagram como `data = { messaging: [...] }`
  (`inbound/service.ts:245-248,382`), mas o backend `detectProvider`/`extractIds` chaveiam em `messaging_product` top-level
  (WA) e `recipient.id`+`sender.id` top-level (IG) (`normalize.ts:32-47`). Para IG, top-level `recipient`/`sender` estão
  ausentes → `"unknown"` → guard de dispatch `routes.ts:240` falha → o evento é persistido + auditado + 200, **mas nunca
  semeia channel_connection, nunca escreve message_records, nunca enfileira dispatch → 100% do inbound IG silenciosamente
  não-dispatchado**. Mecanismo **distinto** do vocab-drop de outbound. — **Pilot-alcançável se IG semeado (WA não afetado).**
  — Esforço: **~1h** (ou fix cross-repo no shape). `[xrepo: bevox-meta-api]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, irreversível; refunded-remark SHARPENED]` **(v: CONFIRMADO ×2 —
  money/channels + orquestrador)** — `markChargePaidManually` **não** tem status-gate (`service.ts:422-463`, guards = exists +
  is-manual; comentário `:414-416` **proíbe** deliberadamente um gate); `applyChargePaid` (`service.ts:876-925`) chama
  `markChargePaid` (`:890`) → `insertPayment`+`confirmAppointmentIfUnconfirmed`+grant **incondicional** (`:891-924`) ignorando
  o rowcount. **Raiz estrutural ÚNICA:** os 3 UPDATEs guardados (`markChargePaid/Expired/Refunded`, `repository.ts:395-413`)
  são `Promise<void>` **sem `RETURNING`** → **nenhum caller pode** gatear no rowcount. Re-mark de `expired` → UPDATE no-op +
  payment `paid` órfão fresco; re-mark de `refunded` é **pior** — a row anterior é `reversed`, então `(org,'manual:<id>','paid')`
  ≠ `(…,'reversed')` → um **2º row `paid`** é inserido ao lado do reversed (inflação de revenue-report). Depois
  **irreversível** (`refundChargeManually` exige `status==='paid'` `:499-501`). `expireChargeManually` (`service.ts:623-650`)
  **audita falso** (`{status:"expired"}` sob race) **e é o único dos 3 manuais sem `withRedisLock`** (cf. `:442`, `:510`).
  **DE-ESCALADO (v): o path Stripe NÃO é externamente manufaturável** (`webhook-platform.ts:90-97` dedupa por `event.id`;
  Stripe emite 1 succeeded/PI) → o único vetor externo é o manual mark-paid (via Clerk org-user, sem role-gate). — Esforço:
  **~1,5h** (RETURNING + gate + lock). **#4.**
- **`proposal-missing-idempotency_key`** `[carry, inerte-atrás-do-message_id-poison]` **(v: CONFIRMADO — L; cross-repo)** —
  harness `extractProposal` (`bevox-harness origin/main:src/tools/_shared/mutation-tool.ts:351-352`) devolve só `{action,
  params}`; o objeto é emitido verbatim em `/complete.proposals[]` (`bevox-callback.ts:95`); `idempotency_key` **não existe
  em lugar nenhum** do src do harness (grep=0). O backend `ProposalSchema` (`harness-callbacks.schema.ts:40`) **exige**
  `idempotency_key: z.string().min(1)` → qualquer `/complete` com proposals (o fluxo copilot/manual_assisted draft→approve =
  a UX central do piloto staff-manual) **falha `parse` → 400 → execução nunca finaliza**. **2º dominó atrás do
  `message_id`-poison.** — Esforço: S. `[xrepo: bevox-harness]`
- **`no-appointments-read-endpoint`** `[carry]` **(v: CONFIRMADO — ROUTES + PILOT)** — Não existe `GET /appointments` nem
  `/appointments/:id`: `grep` REST read = **0**; só POST `/calendars/:id/appointments` (`routes.ts:71`), PATCH
  `/appointments/:id` (`:99`), POST `/appointments/:id/{verb}` (`:131`); nenhum outro módulo faz `FROM appointments`. A
  "agenda do dia" (PRD §263) **nem tem REST read, nem SSE push** (`appointment.created` §8.3 nunca emitido) → ilegível por
  TODO ator. — Esforço: **4-6h**. **#9.** `[xrepo: PRD §5.3/§8.3]`
- **`worker-process-telemetry-uninitialized`** `[carry, DE-ESCALADO — não é blackout de logs]` **(v: CONFIRMADO ×2 — PILOT +
  orquestrador)** — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca** `import "./instrument.js"` nem
  `initTelemetry()` (ambos só em `src/index.ts:17,30`). `new Worker(` count = **11** (linhas 87,92,95,98,103,106,120,125,
  137,143,149; docstring `:5` "4 workers" stale). O `prom-client` registry é singleton **por-processo**; o reconcile
  incrementa counters **no processo worker** (`reconcile.ts:88,114,162,165`) mas `/metrics` é servido **só pelo processo
  HTTP** (`health/routes.ts:24`) → counters do worker **estruturalmente inscrapáveis**; `/readyz` (`:17`) checa PG+Redis mas
  **não** a liveness do worker. **DE-ESCALADO: NÃO é blackout de logging** — todo job-failure É Pino-logado
  (`queue/index.ts:268`); `captureException` (`:272,:313`) é inerte (Sentry nunca init no worker). — **1-2h** (import +
  `initTelemetry()` + `/metrics`+`/healthz` no worker + `w.on('failed')` capturar). **#6.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA ligar — INERTE no piloto manual)**

- **`dispatch-message-id-not-uuid-poisons-every-AI-dispatch`** `[carry, pilot-reachable; CAUSA inércia do harness]` **(v:
  CONFIRMADO firsthand — L + orquestrador)** — `buildDispatchMessages` seleciona `external_message_id`
  (`orchestration/repository.ts:395`) e o mapeia a `message_id` (`:409`); `external_message_id` é `text NOT NULL` id nativo
  de canal (`db/schema/ingestion.ts:40`; populado em `channels/metaapi/repository.ts:292`) — **nunca** UUID; o `id` interno
  (UUIDv7) **não é selecionado**. `DispatchMessageSchema.message_id = Uuid.optional()` (`harness-dispatch.schema.ts:15,22`) →
  ZodError em `DispatchPayloadSchema.parse` (`harness-dispatcher.ts:91`) **após** o INSERT `pending` (`:73-83`) e **antes** do
  enqueue (`:107`). O harness `messageSchema` nem declara `message_id` (passthrough) → é **self-poison 100%-backend**,
  determinístico. **É O PORQUÊ de o harness ser inerte no piloto** + CAUSA orphan-`pending` + MASCARA unbounded/
  active_execution_id/PERM-05/proposal-idempotency_key. — **Inerte no piloto manual; CRÍTICO assim que canais/IA ligarem.** —
  Esforço: **~15min** (selecionar `id`). `[xrepo: bevox-harness]`
- **`harness-status-callback-method-mismatch-total`** `[carry, root-cause único]` **(v: CONFIRMADO byte-level nos 2 repos —
  L + orquestrador)** — Harness `post()` hardcoda `method:"POST"` (`bevox-harness origin/main:src/integration/
  bevox-callback.ts:28`; `/status` em `:139-144`); `updateStatus` POSTa `running` (`execution-handler.ts:1410,1584`) /
  `dead_letter` (`bullmq-consumer.ts:155`), backend só registra **PATCH** `/status` (`harness-callbacks.routes.ts:56`) →
  **toda** chamada de status → Fastify **404**. Backend é **canon-correto** (§10.4 PATCH). O worker `on('failed')`
  (`queue/index.ts:267-269`) só **loga** jobs backend-internos → **root-cause único**. **NOVO (v: L):** `applyStatusTransition`
  e `markExecutionDeadLetter` têm **exatamente 1 caller cada** — a rota PATCH `/status` (`routes.ts:76,80`) → ambos
  inalcançáveis via o harness (que POSTa) → o 404 mascara **tanto** o dead_letter autoritativo **quanto** o finding
  `applyStatusTransition`-unguarded. Fix = **cross-repo** (harness→PATCH + errata canon). — Esforço: **~1,5h**. **#7.**
  `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry, status-agnóstico]` **(v: CONFIRMADO — L; grep leituras=0)** —
  o preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token** (`execution-token.ts:67-71,96`; escreve
  `req.executionContext` em `routes.ts:66`), mas **todo** handler age sobre o `:id` da URL (`routes.ts:73,91,113,142`) e
  **nunca** lê `req.executionContext` (grep: write-only). Token válido p/ A escreve em qualquer execução B (IDOR
  cross-execution/cross-tenant). **Inerte no piloto** (token nunca escapa — dispatch poisona pré-enqueue); **CRÍTICO-GA**. —
  Esforço: **1h**. `[xrepo: bevox-harness]`
- **`dispatch-messages-unbounded` / `completion-never-clears-active-execution-id` / `PERM-05-layer-2-inerte`** `[carry +
  NOVO sharpen, MASCARADOS por message_id-poison]` **(v: CONFIRMADO — L)** — `buildDispatchMessages` (`repository.ts:394-399`)
  sem LIMIT vs caps harness `100`/`8000`/`256KB`; `finalizeCompletion` atualiza só `executions`
  (`harness-callbacks.repository.ts:136-148`), nunca `conversation_pipeline_state.active_execution_id` (nulado só por
  `releasePipelineClaim :231` + `handoffConversationOnTimeout :464`; `claimPipelineForCutoff` exige `active_execution_id IS
  NULL :196`) → conversa **trava após uma completion bem-sucedida**. **NOVO sharpen (v: L):** além do `skills:[]`
  (`cutoff.ts:75` + `actions.repository.ts:144`), o `DispatchPayloadSchema` **não tem** campo `account_denied_tools`
  (`harness-dispatch.schema.ts:25-63`) → harness defaulta denylist `[]` (`execution-handler.ts:664`) → **TODA a PERM-05
  Layer-2 (allow+deny) é inerte**, não só o allowlist. — **Inerte no piloto; CRÍTICO-GA.** — 1-8h/ea. `[xrepo: bevox-harness]`
- **`complete-service strategy/aborted mismatches`** `[carry, CONFIRMADO; bodyOrgId DE-ESCALADO]` **(v: CONFIRMADO — L)** —
  `strategy:"failed"`+proposals vazias → `inferSuggestionType` devolve `"reply"` (`complete-service.ts:22`), nunca `error`
  (harness emite exatamente isso no error-boundary) → uma execução falha é gravada `done`; harness emite `aborted_cost`/
  `aborted_timeout` **no fio** (`execution-handler.ts:2097-2099`) ausentes do enum backend (`harness-callbacks.schema.ts:57-65`)
  → `parse` 400; terminal guard 409 vs canon 410. **DE-ESCALADO:** `/complete` lê `bodyOrgId` sem `===` (`routes.ts:150-154`),
  **mas** o body do harness `/complete` **não tem** `organization_id` (grep=0) → sempre `undefined` → fallback ao org correto
  (**inerte, NÃO vetor cross-tenant vivo**). — 1-3h/ea. `[xrepo]`
- **`applyStatusTransition-unguarded-regression`** `[carry, inerte double-masked; reach refinado]` **(v: CONFIRMADO — L)** —
  o `UPDATE executions SET status=…` não tem precondição de status (`harness-callbacks.repository.ts:64-66`, `WHERE id` só) →
  um callback `running` tardio/mis-targeted regride uma execução → `processing`. Inalcançável hoje (POST `/status` 404s + 1
  caller). **Refinamento (v: L):** `findExecutionIdByTokenHash` exclui `done/error/cancelled/dead_letter` (`:34`) → os 4
  hard-terminais são **blindados**; a janela regressável real é soft-terminal (`completing`/`timeout`) + `processing`/
  `waiting_input`. **Vira vivo no instante em que o method-mismatch for corrigido** → fixar junto com #7. — S. `[xrepo: bevox-harness]`

### MÉDIO (degrada qualidade)

**Auth — contrato / cross-org (plano staff-ops que o piloto usa)**

- **`staff-token-expires_in-advertises-refresh-ttl-not-access-ttl`** `[carry]` **(v: CONFIRMADO ×2 — AUTH + orquestrador)** —
  `issueSession` devolve `expires_in: ttl` onde `ttl = staffRefreshTtlSeconds()` = 604800s/7d (`auth/service.ts:54,60`;
  `staff-auth.ts:124-126`), mas o JWT access-token `exp` = `STAFF_JWT_ACCESS_TTL` = 900s/15min (`staff-auth.ts:74`). Cliente
  que agenda refresh por `expires_in` trata token de 15min como válido **672×** tempo demais → 401 silenciosos no painel
  staff. — Esforço: **0,25h** (`expires_in: cfg.STAFF_JWT_ACCESS_TTL`).
- **`audit-log-blind-to-staff-actor`** `[carry]` **(v: CONFIRMADO — AUTH + LGPD)** — toda mutação staff-ops grava
  `audit_events.actor_id = NULL` (`actions.repository.ts:178-179`); o filtro `actor_id` do read (`read.repository.ts:222`)
  **nunca casa** um staff; o enum `actor_type` = `user|ai|system|webhook` **sem `staff`** (`_shared.ts:84`) → actorship de
  staff é estruturalmente inexprimível. — Esforço: S-M.
- **`clerk-jwt-no-aud-iss-validation`** `[carry, DE-ESCALADO ALTO→MÉD]` **(v: CONFIRMADO — AUTH)** — `clerk-auth.ts:89-92`
  verifica só `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim
  não-verificada (`:105`). **DE-ESCALADO:** o JWKS é **instance-scoped** (`:67-73`) → atacante externo não cunha token; risco
  residual = cross-audience dentro da mesma instância (defense-in-depth). Assimetria: staff **pina** audience; Clerk não. —
  Esforço: **0,5-1h**.

**Observabilidade — worker é buraco-negro + `/metrics` é superfície pré-auth composta (11 workers)**

- **`metrics-public-org-id-enumeration` + dois cardinality-bombs pré-auth** `[carry + 2 carry NOVO-do-10-28]` **(v:
  CONFIRMADO ×3 — PILOT + money/channels + orquestrador)** — `GET /metrics` (`health/routes.ts:24`) é in-app
  **não-autenticado** (sem preHandler; comentário `:22-23` admite só network-policy) e o counter
  `bevox_backend_http_requests_total` é rotulado com `organization_id` (`metrics.ts:33`), incrementado por-request com o UUID
  real (`bootstrap/server.ts:170`) → quem alcança `/metrics` **enumera todos os org-UUIDs** (vazamento ADR-021). **Dois
  cardinality-bombs:** (a) `event_type` do webhook metaapi é `/^raw\.[a-z_]+\.[a-z_]+$/` (`channels/metaapi/schemas.ts:31`,
  `[a-z_]+` **ilimitado**) e vira label de Counter no path de **assinatura-inválida pré-auth** (`routes.ts:168`,
  `metrics.ts:63-66`); (b) o label `route` cai para o **path cru** em requests 404/unmatched (`server.ts:163
  routeOptions?.url ?? req.url.split("?")[0]`). Webhook sem preHandler + rate-limit 0-caller → **flood não-throttled**.
  **DE-ESCALADO:** o `pre-HMAC DB amplification` é **LOW** (2 leituras O(1) `LIMIT 1` + 1 decrypt). — Esforço: **1-2h** (auth
  no `/metrics` + bucket de labels). `[g/k; ADR-021]`
- **`worker-has-no-healthz-readyz` + `dead-worker-invisible-to-orchestration`** `[carry]` **(v: CONFIRMADO — PILOT)** — o HTTP
  `/readyz` (`health/routes.ts:17`) checa Postgres+Redis mas **não** a liveness do worker; o worker não expõe porta → k8s não
  consegue HTTP-probe → worker crashado → o HTTP segue `ready` enquanto ingestão/reconcile/google-sync/waitlist/package-expiry
  **param em silêncio** (só logs Pino sobrevivem). — **2-3h**.
- **`domain-prometheus-metrics-not-registered` + `canonical-counter-dead-while-shadow-lives` + `sse-events-never-published`**
  `[carry]` **(v: PILOT)** — `shared/metrics.ts` não registra os de §13.3 (`charges_*`, `appointments_no_show_rate`, grep=0);
  `metrics.ts:41 queueSize` nunca `.set()` e `:52 messagesReceivedTotal` nunca `.inc()`, **enquanto** o paralelo
  `metaapi_inbound_events_total` (`:63`) É incrementado (shadow counter vivo). `realtime/publish.ts:8-12` união fechada a 4
  tipos execution/waitlist; `appointment.created`(§8.3)/`charge.updated`(§8.4) **nunca** emitidos. — **2-3h**.

**Dados/LGPD + money — scoping / integridade (GA/Marco-3, piloto roda com PII real)**

- **`message-content-table-untargetable`** `[carry]` **(v: SCHEMA + LGPD)** — `message_records`
  (`db/schema/ingestion.ts:32-56`) guarda PII (`content_text` egresso ao LLM + `sender_snapshot_json` + `media_json`) mas
  **sem `organization_id`, sem `created_at` de inserção, sem `deleted_at`** — só o nullable `message_created_at` (`:43`).
  **DE-CLAIM STANDE:** a âncora transitiva via `received_event_id→received_events.received_at` existe; só o `created_at`
  **direto** é ausente. — **GA/LGPD.** — migration (M).
- **`appointment-transition-no-state-guard` + `package-session-not-restored-on-cancel` + `resurrect-google-divergence`**
  `[carry]` **(v: PILOT)** — `booking.ts:445-450` UPDATE incondicional any→any (comentário `:437` admite); `cancelled→confirmed`
  **ressuscita sem recount** (`availability.ts:169` conta `status NOT IN ('cancelled')`) → over-book silencioso;
  `completed→cancelled` não re-incrementa pacote (`:461-472`) → consome sessão permanentemente; a ressurreição dispara após um
  `'delete'` outbox sem `'create'` compensatório → divergência Google permanente. (`rescheduleAppointment` é capacity-sound —
  roteia pelo `createAppointment`.) — **GA integridade (inerte no piloto semeado).** — **2-3h**.
- **`intent-reconcile-half-applies-paid` + `reconcile-fifo-window-starvation`** `[carry]` **(v: money/channels)** —
  `reconcile.ts:143-150` seta só `status='paid'`+`updated_at` bypassando os 6 efeitos de `applyChargePaid`; `reconcileStuckIntents`
  (`:101-108`) seleciona 50 `pending` mais antigos **sem** filtro `provider_charge_id IS NOT NULL` → manuais ocupam slots FIFO
  (`:119 continue`). Branch **live** (Stripe-path, inerte no piloto manual). — **M**.
- **`execution-traces-pii-sink-not-titular-erasable`** `[NOVO, latente]` **(v: LGPD)** — `execution_traces.input_json`/
  `output_json` (`db/schema/execution_traces.ts:29-30`, I/O de tool do harness, PII-capaz) é org-scoped mas **sem
  `customer_id`, sem `deleted_at`** e **ausente do DSR export**. Write-path wired (`insertExecutionTraces`
  `harness-callbacks.repository.ts:196` ← POST `/traces` `routes.ts:95`), mas `/traces` é producerless hoje → vazio no piloto.
  Estende a família de PII-não-apagável. — **LOW-MED/latente.** — baixo.

### BAIXO (higiene)

**LGPD (Marco-3 §16.3 — piloto roda com PII real; CONFIRMADOS; de-claims STANDES)**

- **`consent-and-ai-opt-out-stored-not-applied` + `no-consent-capture-mechanism` + `intake-pii-ingested-pre-notice`**
  `[carry]` **(v: LGPD — headline LGPD)** — `ai_opt_out` só no CRUD de customers (`repository.ts:21,26,67`; `default
  false`=opted-IN) e **lido em lugar nenhum**; dispatch é **conversation-keyed, nunca customer-keyed**
  (`orchestration/repository.ts:391-415`); `consent_granted_at` (`customers.ts:49`) tem **zero writers**; `intake` INSERT cego
  em `customers` (full_name) + customer_channels com telefone **sem gate de consentimento e sem "aviso automático"** que
  `_shared/ADR-019` exige. grep `legal_basis|consent_event|dsr_request|retention|pseudonym` = **0**. **Assimetria-chave:**
  ingestão ungated vs direitos RS256-gated (inalcançável no piloto HS256). — Esforço: **M**. **#10.** `[xrepo: _shared/ADR-019]`
- **`received-events-and-message-records-un-erasable` + `retention-worker-adr020-absent`** `[carry]` **(v: LGPD + SCHEMA)** —
  `received_events` (`ingestion.ts:12-30`) persiste `payload_json` E `normalized_payload_json` com **zero `organization_id`/
  `customer_id`/`deleted_at`**; `message_records` idem → **5 cópias de PII inbound cruas** (+ execution_traces). Canon
  ADR-020 define `bevox.retention.worker` (cron 03:00 UTC) + `consent_events`/`dsr_requests` (grep=0). — Esforço: **24-40h**.
  `[xrepo: _shared/ADR-020]`
- **`dsr-export-omits-phone-channels-and-superseded-facts` + `customers-have-no-erasure-path-at-all`** `[carry + CORREÇÃO de
  framing]` **(v: LGPD)** — o export (`customers/service.ts:97-110`) + `COLS` (`repository.ts:25-26`) **nunca** consultam
  `customer_channels`; o intake insere só `customers.full_name` → `customers.primary_phone` é **NULL p/ toda a população
  channel-origin do piloto**; telefone/handle/external_user_id vivem em `customer_channels`, **nunca exportados**. `listFacts`
  filtra `superseded_by IS NULL` (`repository.ts:106`) → facts superseded fora da portabilidade. **CORREÇÃO (v: LGPD):**
  `risk_flags_json`/`preferences_json` têm **zero writers** → `dsr-export-omits-profiling` é **IMATERIAL** (sempre NULL, como
  `consent_granted_at`); **as perdas materiais são channels + superseded-facts** (não profiling). `customers.ts:51-52` define
  `archived_at`+`deleted_at` mas grep `DELETE`/soft-delete em customers = **0 writers** → erasure de titular estruturalmente
  zero; `deleteUserByClerkId` (`auth/repository.ts:244-246`) hard-DELETE só em `users`. — Esforço: export **6-10h**; deleção
  **8-12h**. `[xrepo: _shared/ADR-020]`
- **`dsr-export-under-captures-cross-entity-audit` + `staff-manual-actions-pii-sink` + residues LGPD** `[carry]` **(v: LGPD)**
  — `audit_events` tem `entity_type/entity_id` indexado (`audit.ts:27-28,42`) → `entity_type='customer'` **é** filtrável; o gap
  é rows cross-entity. `staff_manual_actions` jsonb sem customer_id fora da DSR; `google-calendar-intl-transfer`
  (nome p/ US); `payments-raw-payload-json` (10yr fiscal); `received_events.signature_valid` hard-coded `TRUE`
  (`channels/metaapi/routes.ts:210`). — 2-4h/ea.

**Money / schema — misses de baixo risco**

- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry, cron LIVE-wired]` **(v: CONFIRMADO ×2 — money/channels +
  orquestrador + PILOT)** — `reconcile.ts:254-259 UPDATE refunds SET … updated_at = now()`, mas `refunds` **não tem**
  `updated_at` (`payments.ts:149-172`; só `createdAt` `:164`) → **42703** capturado (`:262`) → `failCount++`, status nunca sai
  de `pending` → reconcile de refund **DOA**. Cron **É live-wired** (`queue/index.ts:149-151,255-262`). O path vivo
  `updateRefundStatus` (`repository.ts:480-483`) **omite** `updated_at` → intacto; manual escreve `succeeded` direto
  (`service.ts:522-528`) → **pilot-inerte**. CI-invisível (só unit mockado). **Fix = remover `updated_at=now()`.** — **0,25h.**
  `[xrepo: Stripe]`
- **`manual-charge-amount-unbounded-overflow-500` + currency/uniqueness residues** `[carry]` **(v: money/channels)** —
  `manual.ts:31 z.number().finite().positive()` (sem `.max`) → `service.ts:377 .toFixed(2)` em `numeric(10,2)` → ≥1e8 → 22003
  → 500 opaco (**pilot-reachable via Clerk**); `currency` sem CHECK (`payments.ts:92`); `payment_accounts` sem uniqueness em
  `professional_id` (`payments.ts:63-66`). — trivial/S ea.
- **`charge-creation-skips-org-scope-on-entity-fks`** `[NOVO, LOW/informacional]` **(v: money/channels)** —
  `createManualCharge` (`service.ts:344-401`) e `createCharge` (`:185-240`) org-scope-validam só `service_package_id`;
  `customer_id`/`appointment_id`/`service_id`/`professional_id` fluem a `insertChargePending` com FKs globalmente-scoped
  (`payments.ts:77-87`). Um Clerk-user pode criar charge na própria org referenciando o id de entidade de outra org. **Sem
  leak de read cross-tenant** (reads org-scoped; `confirmAppointmentIfUnconfirmed` org-scoped `:930-937`); residual = oracle
  de existência-de-FK sobre UUIDv7 inadivinhável. Higiene de tenancy vs ADR-021, não breach. — baixo.
- **`fk-columns-without-index` + `section-11-3-critical-indexes-partially-absent`** `[carry; partial-index-trap LOW]` **(v:
  SCHEMA)** — **91 `.references()`** TS (FK-DB **≈93** incl self-ref `customers.ts:141` + 0012 hand-add); **18** tabelas org-FK
  completamente sem índice (agregado **≈55**). `customers` (PII primária) tem **ZERO** índices secundários. PRD §11.3 manda
  `(org,status)` em appointments/conversations/charges/executions + `(org,start_at)` em appointments → **4 de 5 AUSENTES** (só
  `conversations (org,status)` existe `:58`). **DE-ESCALADO:** o partial de `customer_facts` é **PRD §11.2 VERBATIM**
  (spec-correto); o de `payment_accounts` cobre o lookup dominante. — **3-4h**. `[a/schema]`
- **`adr-020-templates-and-adr-021-priority-score-unmaterialized` + `waitlist-priority-score-client-settable`** `[carry]`
  **(v: SCHEMA — canon-reforçado)** — backend/ADR-020 + ADR-021 (ambas `aceita`) **não materializadas** (grep
  `message_template`/`urgency_level`/`skip_count` = 0). ADR-021 "Opção C" manda `priority_score` server-computed + `CHECK
  (priority_score>=0)` + "server ignores client input" — **vinculante**. Mas `calendar.ts:204 priority_score numeric notNull
  default '0'` **sem CHECK** (só `0010_square_timeslip.sql:19 ADD COLUMN`), escrito do input em `waitlist/routes.ts:30,36,71,95`,
  INSERT (`repository.ts:278`), PATCH (`:361`), seam IA (`seam-tool.ts:44,83`), e `match` ordena por ele (`repository.ts:331`)
  → **inverso direto** de ADR-021. (`conversations.priority_score` dormante — não re-inflar.) — ADR-020 **8h**; ADR-021
  CHECK+drop-input **2h** / fórmula **6-10h**.
- **`status-history-entity-absent` + `appointments-no-created-by-actor` + `appointments.confirmed_at-absent` +
  `OperationalMetricSnapshot-absent`** `[carry]` **(v: SCHEMA)** — Módulo 16 (l.584/588) + §8.3/§8.4 mandam; grep de cada em
  `src/`+`db/schema/` = **0** (`confirmed_at` só um comentário `payments/repository.ts:924` admitindo). — **GA/latente.** —
  S-M/ea.
- **`appointments-customer-package-fk-snapshot-drift` + `stripe-webhook-events-org-set-null-orphan`** `[carry]` **(v: SCHEMA)**
  — `calendar.ts:124` declara `customerPackageId` sem `.references()` **mas** `0012:2` adiciona a FK (ON DELETE set null) →
  integridade existe no DB, **porém ausente de TODOS os snapshots drizzle 0012→0020** → drizzle-kit permanentemente cego a ela
  (1ª landmine de schema-thaw: `generate` emitiria `ADD CONSTRAINT` duplicado 42710). `payments.ts:236`/`0011:129` fazem
  `stripe_webhook_events.organization_id` nullable `ON DELETE set null` (desvia do cascade §11.2) → na deleção do org, rows
  Stripe (PII-adjacent) escapam o cascade de tenant. — **LOW** (latente). — baixo.

**Auth / harness / routes (resíduos — BAIXO/latente/inerte)**

- **`idempotency-cache-key-not-org-scoped`** `[NOVO, latente]` **(v: ROUTES; confirmado firsthand pelo orquestrador)** —
  `idempotency.ts:85` monta a Redis key como `idempotency:${key}` **sem prefixo `organization_id`**; o replay devolve a
  resposta cacheada **antes** do handler (`:87-99`), bypassando a dedup org-scoped do service. Se duas orgs reusarem a mesma
  `Idempotency-Key` dentro do TTL de 24h, org B receberia o `201` cacheado de org A (disclosure cross-tenant + charge de B
  nunca criada). **Requer colisão de key** (negligível com UUIDs de cliente, mas `KEY_PATTERN` permite keys fracas como `"1"`,
  `:46`). Defense-in-depth vs ADR-021. **Pilot-reachability: NENHUMA** (rotas RS256/Clerk-gated). — baixo.
- **`newOpaqueId-uuidv4-dormant-landmine` + `verifyStaffRefreshToken-dead` + `staff-refresh-unbounded-no-prune` +
  `staff-refresh-no-reuse-detection`** `[carry]` **(v: AUTH)** — `staff-auth.ts:139 newOpaqueId(): randomUUID()` (UUIDv4,
  viola invariante #7), **zero callers**; `staff-auth.ts:119-121 verifyStaffRefreshToken` **zero callers**, usa `===`; todo
  login insere `staff_refresh_tokens` sem prune (`service.ts:88`), rotação deleta só o apresentado (`:100`), tokens-irmãos
  sobrevivem 7d; refresh concorrente dobrado → 2 tokens válidos (ambos acham a row antes de qualquer delete). — trivial/S.
- **`staff-residues` + `metaapi-health-subscription-id-to-any-staff`** `[carry + NOVO LOW]` **(v: AUTH)** —
  `login-user-enumeration-timing` (throw antes do bcrypt `service.ts:68-71`); `bcrypt-72-byte`; `staff-session-no-logout`;
  `staff-role-stale-cache-at-login` (300s `repository.ts:20`); `clerk-webhook-unknown-type-silent-200` (svix-verified
  primeiro); **NOVO:** `GET /api/v1/health/metaapi` (`channels/metaapi/routes.ts:294-325`, guard todos os 3 roles) devolve um
  `subscription_id` global a qualquer staff incl observer (by-design health, baixa-sensibilidade). — S/ea.
- **`dispatch resíduos` + `trace-content-dropped`** `[carry + NOVO LOW]` **(v: L)** —
  `poisoned-dispatch-orphans-pending-execution-row` (`harness-dispatcher.ts:73-83`; `claimTimedOutExecutions repository.ts:428`
  não varre `pending` — **pilot-reachable, um órfão por inbound**); `callback-base-url-dead-on-harness-side`;
  `/traces-has-zero-harness-producers` (`sendTrace bevox-callback.ts:98` 0 callers); `/stream-wired-but-config-gated`
  (**DE-ESCALADO de "desligado"**: `sendStreamChunk` POSTa shape-correto, gated por `env.STREAM_ENABLED` default false + flag
  `stream` que o `DispatchPayloadSchema` não envia → double-gated); **NOVO:** quando `/traces` tiver produtor, o `content` do
  trace **cai no vazio** — `insertExecutionTraces` mapeia `step_name←"unknown"`, `input/output←null`
  (`harness-callbacks.repository.ts:199-204`), sem coluna p/ o `content` de reasoning. — 0,25-2h/ea. `[xrepo: bevox-harness]`
- **`max_cost_usd-never-sent`** `[NOTA — NÃO é gap]` **(v: L)** — o backend não envia `max_cost_usd` no dispatch; o harness
  cai no env `HARNESS_MAX_COST_USD` (`execution-handler.ts:690`). **ADR-016 (token-billing) é `proposed`** → corretamente
  não-implementado. Nota, não achado.

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recount reproduzido EXATO)**

- **`openapi-drift-undocumented-handlers` (11 → 7 drift-real) + `no-mechanical-route-zod-openapi-binding`** `[carry]` **(v:
  ROUTES)** — **7 drift-real sem isenção** (existem, 0 hits YAML): `GET /customers/{id}/export` (`customers/routes.ts:97`),
  `GET`+`PATCH /autonomy` (`autonomy/routes.ts:18,23`), `GET /channel-connections` (`channels/routes.ts:14`), `GET`+`PATCH
  /payment-account/policy` (`payments/routes.ts:89,95`), `GET /api/v1/realtime` (`realtime/routes.ts:27` — o único `realtime`
  no YAML é o path staff **distinto** openapi:924). ZERO rotas usam `schema:` do Fastify; sem `ZodTypeProvider`; **~160-167**
  `.parse()`/`.safeParse()` inline (depende da metodologia de exclusão). OpenAPI 100% YAML estático → razão estrutural do
  drift. `pnpm openapi:check` é gerador de tipos (exit 0 só prova parse). — **2-3h** + 1h validador CI. **#9.**
- **`enum-create-refund-missing` + `status-callback-missing-dead_letter`** `[carry, live-path twins]` **(v: ROUTES)** — YAML
  `ExecutionProposal.action` = 6 vals **sem `create-refund`** (openapi:322-328); Zod tem 7 (`harness-callbacks.schema.ts:30-38`),
  **executado** (`seams.ts:172`). **Gêmeo:** YAML `status` enum `[running,paused,cancelled]` (openapi:298) vs Zod adiciona
  `dead_letter` (`harness-callbacks.schema.ts:16`) com handler-branch vivo (`routes.ts:75-76`). — 0,25h.
- **`error-envelope-dual-schema` / `idempotency-key-param-overclaims` / `freeform-200` / `operationId:0`** `[carry; vários
  DE-ESCALADOS]` **(v: ROUTES)** — handler **sempre** emite `request_id` (`error-handler.ts:55`) mas só `ErrorEnvelope` o
  documenta; **DE-ESCALADO** `idempotency-key-param` → o defeito é a **descrição** (openapi:98 "toda mutação") overclaimar (as
  mutações `mark-paid`/`expire` usam `mutate` deliberadamente não-idempotente); 200 free-form; **DE-ESCALADO** `operationId:0`
  → o gerador `openapi-typescript` keya por path+method → **não quebra o codegen deste repo**; **DE-ESCALADO**
  `429-undocumented` → **moot** (nenhuma rota emite 429). — 0,25-2h/ea.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: orquestrador)** — tags só `v1.0.0`/`v1.0.1`;
  `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora (incl. dispatch amendment);
  `release.yml` dispara só em `push tags` → **nenhuma imagem (SemVer OU sha) pós-`v1.0.1`**. Versão diverge **4-way**
  (`package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1` / hub `vX.Y.Z`). — **0,5-1h**. `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: orquestrador — re-confirmado firsthand)** — `src/integration/resolve-organization-id.ts`
  **NÃO existe** (bridge colapsada SP-3; `ls` confirma inexistente) mas é citado como vivo em **5 lugares** (`README.md:84`,
  `backend-tenancy.md`, `backend-routes.md`, `PostToolUse-tenancy.sh`, agent `engineering-backend-architect.md`); **`CLAUDE.md
  §8 l.171`** diz seed grava `PILOTSEEDONLYNOTASECRET` (stale — seed usa `generateMfaSecret`); `backend-harness-contract.md:35`
  lista o status-callback como **POST** (handler é PATCH); `backend-db.md:31` diz `on delete restrict` (código+canon =
  cascade); `backend-routes.md:24,33` invoca `requireRole` inexistente + mis-cita "ADR-022 staff RBAC" (é backend/ADR-013). —
  0,3-0,5h/ea.
- **`stray-gap-workflow-js-scratch` / `codeql-upload-never` / `release-no-provenance-sbom` / `adr-number-collision`**
  `[carry]` **(v: orquestrador)** — **5** `.claude/state/gap*.js` (gitignored, `git check-ignore` confirma os 5) → **zero
  impacto em CI**; só `pnpm lint` **local** dá RED (5 parsing-errors). **Esta sessão NÃO adicionou nenhum** (usou Agent tool,
  não Workflow; `git status` limpo). `codeql.yml:26 upload:never`; `release.yml` sem provenance/sbom; ADR 008-023 colidem
  backend/_shared. — 0,1-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária esta sessão)

- **`idempotency-header-IS-enforced-on-charges-manual`** `[REFUTED do 10-28]` — `write` = `[requireClerkAuth,
  requireOrganizationScope, requireIdempotency]` (`payments/routes.ts:53`); `requireIdempotency` lança 400 na ausência/malformação
  da `Idempotency-Key` (`idempotency.ts:78-83`, `KEY_PATTERN` `:46`); `/charges/manual` (`:284`) + `/refund-manual` (`:306`)
  usam `write`. **O `idempotency-required-header-unenforced` do 10-28 é FALSO POSITIVO** (confundiu `write` com `mutate`).
  **Não re-flagar.**
- **`legacy-lexicon-clean`** — grep triado em `src/`/`db/`: executável **ZERO**; 3 crus = doc-comments. Invariante §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153 generateMfaSecret()` + `:154 assert`; sentinel só blocklist
  doc-comment; login sem MFA = correto (Marco-3). CLAUDE.md §8 l.171 stale (doc).
- **`mark-no-show-is-not-a-code-bug`** `[REFUTED, carry]` — OpenAPI serve `/appointments/{id}/no-show`. **Não re-flagar.**
- **`booking-main-path-exactly-once-sound` + `rescheduleAppointment-capacity-sound`** — advisory xact-lock + recount in-lock +
  unique index + replay 23505 (`booking.ts:223-263`); reschedule roteia pelo createAppointment são. **Não flagar.**
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc|pan`=**0**); decimal `numeric(10,2)`; webhooks
  dedupe-aware + org-scoped (cross-tenant paid-flip impossível `webhook-platform.ts:67-73,90-97`); over-refund replay-safe
  (`service.ts:515,753`); `money-mutation-http-idempotency` by-design (`manual:<id>` + ON CONFLICT); HMAC correto
  (metaapi timing-safe ±300s, Stripe `constructEvent`, Clerk svix, Google timing-safe).
- **`env-hardening-conformances`** — `LOG_LEVEL=debug/trace` **proibido em prod** (`env.ts:215-221`); `TEST_AUTH_BYPASS_ENABLED`
  double-guarded (`env.ts:151-158` + `:225-231`); CORS `origin:false` (`server.ts:121`); helmet registrado (`:109`);
  `__startedAt` setado no 1º onRequest hook (`server.ts:152`) antes de auth → 401/429 **são contados** (não blind-spot).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|bevox_observer`;
  `requireStaff({roles})`→403; observer excluído de actions (`actions.routes.ts:11`), incluído em reads/SSE.
- **`impersonation-org-claim-is-dead-branch`** `[DE-ESCALADO]` — `organization-scope.ts:57` trata `impersonation_id` como
  claim de org, **mas** interseção de rotas `requireStaff`+`requireOrganizationScope` = **0** → branch nunca executa → dead
  code inerte, não modelo de tenancy operante-mas-quebrado.
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` canon-correto (§11.2 l.1203); CHECK
  (`appointments_range_check`, `sessions_remaining>=0`, `confidence∈[0,1]`); **migrations journal íntegro (21 entradas = 21
  `.sql`; 0 `gen_random_uuid`/`uuid_generate_v4`)**. **Contagens:** **45** tabelas `pgTable`; **91** `.references()` TS (**≈93**
  FK-DB); **18** org-FK fully-unindexed; **11** workers; **160** inline parse.
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:64-65,68-69,93-95`). Coexiste com
  o token-IDOR (autenticidade ≠ autorização). `idempotency-on-callbacks` **REFUTED** (state-machine, `/complete`→409
  `lockForCompletion harness-callbacks.repository.ts:126-134`; o plugin idempotency **não** está wired nos callbacks — eles
  dependem puramente da state-machine).
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (origin/main l.781-826, verbatim, **sem drift**): 10
  delivered (aisuggestion, staff-rbac[ADR-013], 4× chatwoot/metaapi, m5-p4-manual-payment, m5-p3c-multimedia-consume,
  m5-p3a-refundpolicy, m5-p3b-create-refund-seam) + `backend-psp-br-secondary` **parked**. **Nenhum** work-item p/
  calendar/ADR-010, customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao
  tracker**. Usar esta auditoria como o gate.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do piloto + 1 dos
2 jobs de CI vermelhos**. (Inalterado em substância vs 10-28 — código congelado; o item idempotency-enforce do 10-28 **sai**
por ter sido refutado.)

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia (nem override resgata, nem onboarding existe) → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) + fechar teardown `closeDb()/closeRedis()` (os 57P01) | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado (HS256) não autentica no calendar/money (RS256) → **1ª falha dura do piloto**; a tabela `users` é hoje não-bootstrappável |
| 4 | **`pnpm audit`: `zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**52 highs**, incl. `zod` core de validação + `fastify` core); re-acende o scanner agendado (dark 09-22→10-27) |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** na fronteira de entrega + CHECK + backfill + teste e2e; **+ corrigir o shape IG do inbound** (`detectProvider` lê `data.messaging`) | **3-5h** | **Pilot-universal**: hoje **100%** das respostas de IA são dropadas em silêncio como `done` (outbound) **e** 100% do inbound IG é não-dispatchado (inbound) — dois bugs 100%-drop independentes |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + `/metrics`+`/healthz` no worker + `w.on('failed')` capturar | **1-2h** | Fecha o buraco (Sentry/Prometheus two-process-registry) dos **11 workers**; logs Pino sobrevivem mas sem alerta |
| 7 | **Adicionar `RETURNING id`+boolean aos 3 UPDATEs guardados de charge** + gatear efeitos no rowcount + `withRedisLock` no `expireChargeManually` | **~1,5h** | **1 fix fecha 3 superfícies**: o bug HIGH irreversível de dinheiro no manual (refunded-remark = 2º row paid; único vetor externo) **E** o path Stripe teórico **E** o audit-falso do expire |
| 8 | **`/metrics` autenticado + bucket de labels** (`event_type`→`"raw"`, `route` unmatched→const) + anexar rate-limit a `/staff/sessions[/refresh]`+money+webhooks + `.min()`/length-refine nos 19 secrets + `expires_in` do token staff + **org-scoping na Redis key de idempotency** | **~4h** | Fecha a superfície pré-auth composta do `/metrics` (enumeração org-UUID + 2 cardinality-bombs não-throttled) + o buraco app-wide de rate-limit + o piso de entropia + `expires_in` + o cache-key cross-tenant |
| 9 | **`GET /appointments` (REST, Clerk + staff-ops)** + emitir SSE `appointment.created`/`charge.updated` + documentar os 7 handlers drift + validador OpenAPI no CI; **+ filtro de org no SSE firehose staff + audit** | **4-6h** | "Ver agenda" não tem endpoint **nem** push; fecha o drift silencioso (b) + o firehose cross-org de conteúdo LLM não-auditado (admin-reachable) |
| 10 | **Aplicar gate `ai_opt_out`/consent + aviso-automático no intake + `dsr_requests`** + hidratar/corrigir DSR export (incluir telefone/channels + superseded-facts, excluir notes_internal-latente) + deleção/soft-delete de **customer** | **8-12h** | LGPD (piloto roda com PII real; ingestão ungated, 5+ cópias não-apagáveis, DSR **vazio p/ a população real** + inacessível, erasure só p/ users) |
| — | Higiene batch: `message_id → m.id` (~15min, destrava toda dispatch de IA) + `buildDispatchMessages` LIMIT + PERM-05 skills+denied + proposal-idempotency_key (cross-repo); vincular token de callback ao `:id` (IDOR); harness `status` POST→PATCH + errata canon (cross-repo, fixar junto com applyStatusTransition-guard); StatusHistory + `created_by`/`confirmed_at` + matriz de transição; índices FK (~55 + `customers`); FK snapshot-drift 0012; versão/tag SemVer (22 commits); docs stale (resolve-organization-id + CLAUDE.md §8 + rules harness/db/routes); `rm .claude/state/gap*.js`; `amount_total.max`+currency CHECK; deletar `newOpaqueId`/`verifyStaffRefreshToken` | **~24h** | Contrato harness + agenda-correção + perf GA + LGPD-audit + money-hardening + governança |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — `message_id` não-UUID → ZodError **pré-enqueue** em toda
  dispatch de IA (CAUSA inércia do harness + orphan-pending + MASCARA unbounded/active_execution_id/**PERM-05 Layer-2
  inteira**/proposal-key); `status`-callback POST vs PATCH 404 total (root-cause único; backend canon-correto §10.4; fix
  harness→PATCH + errata canon — fixar junto com `applyStatusTransition`-guard, que vira vivo pós-fix); `proposal-missing-idempotency_key`
  (draft→approve 400); `strategy='failed'`→não-`error`, `aborted_*`→400; `/stream` **wired-mas-gated**; `/traces`-sem-produtor
  (+ `trace-content` cairia no vazio); token-IDOR; `/complete` bodyOrgId **inerte**; `max_cost_usd`-não-enviado **não é gap**
  (ADR-016 proposed). Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` (`messages/schemas.ts:7`)
  **re-confirmado** → `wa`/`ig` do backend causa o drop de **outbound** (pilot-universal); o shape IG do **inbound**
  (`data={messaging}`, `inbound/service.ts:245-248`) não casa `detectProvider` do backend → **100% do inbound IG
  não-dispatchado** (cross-repo, root-cause confirmado byte-level nos 2 repos).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um
  principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona **e a tabela `users` é
  não-bootstrappável** (`user.created` exige row `users` pré-existente). A DSR export também é Clerk-only → inacessível ao ator
  semeado. JWKS instance-scoped (de-escala o aud/iss-gap p/ MÉD).
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`); refund manual não
  passa por webhook; o reconcile de refund Stripe está **DOA (42703), cron-only mas LIVE-wired**; `intent-reconcile`
  half-applies; `reconcile-fifo-starvation`; o money-bug #1 compartilha `applyChargePaid` com o webhook **mas o path Stripe não
  é externamente manufaturável** (dedupe `event.id`). Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer
  auth interativa — indisponível nesta sessão headless** (reportado; não bloqueante p/ auditoria de código).
- **canon (`bevox-knowledge origin/main` @ `7874971`)** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score
  **Opção C vinculante**), backend/ADR-009 (identidade canônica) não-implementadas; _shared/ADR-019 (bases legais → gate
  consent + aviso), _shared/ADR-020 (retenção → scoping de message_records/received_events/execution_traces, `created_at` de
  servidor, retention worker, DSR deletion + `dsr_requests`). Drifts "canon-atrás-do-código" (`/status` POST↔PATCH,
  `create-refund`, `dead_letter` no enum, `/complete` 410) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra, `origin/master` @ `fd1373b`)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa
  `v1.0.1` (sem os 22 commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account nem
  principal Clerk); a network-policy do `/metrics` é o único controle do vazamento+inflação de org-UUID.
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` desde **09-22** até 10-27 (~5,5 sem); hoje (quinta) sem
  slot vencido → gate agendado dark; causa não-introspectável offline. Os commits de audit são **locais** (nunca pushados) →
  `ci.yml` não roda neles.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs são
  invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-28)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/ db/`
**vazio**; `HEAD` = o commit do próprio audit 10-28; `describe` `v1.0.1-39` (era `-38`).

**Ground-truth (mensurável) — 2ª passada consecutiva com DELTA-ZERO em todos os sinais de CI:**
- **`ci-security`:** **120 vulns / 10 low / 58 moderate / 52 high / 0 critical** — **byte-idêntico ao 10-28** (os mesmos 19
  módulos-high, as mesmas contagens por-módulo). O "+2 high" (50→52) do 10-28 **não propagou** → re-platô. Tendência high
  **12→15→18→49³→50⁴→52²**. Prova estrutural: num lockfile congelado a dívida de segurança oscila com a base de advisories,
  mas estabiliza entre pulsos.
- **`ci-tests`:** RED idêntico (mesmo flaky `booking_notice:259` ~09:05 UTC), com **2× unhandled 57P01** (idêntico ao
  10-26..10-28). Fast-gate GREEN idêntico (Unit **469/469, 69 files**; Typecheck/Format/OpenAPI-parse/Build+alias-gate ✓).
- **`ci-scheduled-runs-dark`:** janela **09-22→10-27** inalterada (último run = CodeQL slot 10-27 às 11:14 UTC,
  `startup_failure`). Hoje (10-29, quinta) **sem slot cron vencido** — não é regressão.
- **lint:** RED local idêntico (5 `.claude/state/gap*.js` gitignored, **0 adicionados**) → CI-GREEN.

**1 REFUTAÇÃO DE CÓDIGO (1ª em 8 passadas; mas de um claim-NOVO do 10-28, não do corpus carregado):**
- **`idempotency-required-header-unenforced` (MÉD no 10-28, money-path do piloto) → FALSO POSITIVO.** O preHandler `write`
  inclui `app.requireIdempotency()` (`payments/routes.ts:53`), que lança 400 na ausência da `Idempotency-Key`
  (`idempotency.ts:78-83`); `/charges/manual` + `/refund-manual` usam `write`. O 10-28 confundiu `write` (idempotency-enforced)
  com `mutate` (deliberadamente não-idempotente). **A "charge duplicada no retry do cliente" NÃO existe.** O corpus
  **carregado** permanece **0-refutado (8 passadas)** — foi a adição mais nova (10-28) que errou (padrão recorrente da série:
  claims-novos refutados na passada seguinte).

**~7 MISSES NOVOS (6 LOW/latentes/governança + 1 MÉD admin-alcançável no piloto):**
- **AUTH:** `staff-sse-firehose-crossorg-llm-content-unaudited` (**MÉD**, firehose `realtime:*` de conteúdo LLM ao vivo,
  admin-reachable no piloto, audit-blind); `metaapi-health-subscription-id-to-any-staff` (LOW); `users`-não-bootstrappável
  (strengthen do clerk-provisioning).
- **LGPD:** `execution-traces-pii-sink-not-titular-erasable` (LOW-MED latente, sem customer_id/deleted_at, fora do DSR).
- **MONEY:** `charge-creation-skips-org-scope-on-entity-fks` (LOW info, FK-existence oracle, sem read-leak); refunded-remark =
  2º row `paid` (sharpen do money-bug #1).
- **HARNESS:** PERM-05 **Layer-2 inteira inerte** (skills+`account_denied_tools` vazios, sharpen); `trace-content-dropped`
  (LOW, quando `/traces` tiver produtor).
- **ROUTES:** `idempotency-cache-key-not-org-scoped` (LOW latente, Redis key sem prefixo de org, pilot-unreachable).

**1 CORREÇÃO de framing (LGPD):** `risk_flags_json`/`preferences_json` têm **zero writers** → `dsr-export-omits-profiling` é
**imaterial** (sempre NULL); as perdas materiais do DSR são **channels + superseded-facts** (corrige a memória 10-25).

**Sharpenings/refinamentos:** `rescheduleAppointment` é **capacity-sound** (roteia pelo createAppointment são — não
compartilha o defeito de transition); `applyStatusTransition` regride só soft-terminais (completing/timeout) + processing/
waiting_input (os 4 hard-terminais são blindados pelo token-lookup); o 404 do `status`-callback mascara **tanto** o dead_letter
autoritativo **quanto** o `applyStatusTransition`-guard (1 caller cada).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH pilot-universal);
`ig-inbound` (100% IG dropado); `manual-remark orphan` (HIGH irreversível, manual reachable); `reconcile-refund-42703`
(cron-only); `callback-token-IDOR`; `rbac-org-role`; `clerk-provisioning`; `message_id`-poison + `status`-method 404 +
`active_execution_id` wedge; toda a bateria LGPD; worker-telemetry; priority-score/templates Marco-2/3; version-drift (22
commits, nenhuma imagem pós-`v1.0.1`); scheduled-CI-dark; docs/CLAUDE.md/README staleness.

**Arco desde a passada mais antiga (06-02):** os 3 CRÍTICOs originais foram fechados/recaracterizados; os 2 CRÍTICOs atuais
(grade + calendar no seed) persistem há ~4 meses atrás do gate auth-actor (isolado 07-20, re-confirmado 12×). A frente de
CRÍTICOs está **estável e sem correção há ~4,9 meses**; nesta passada **todos os sinais de CI ficaram delta-zero pela 2ª vez
consecutiva** (Security re-platôou byte-idêntico a 52), e a série registrou sua **1ª refutação de código em 8 passadas** — mas
de um claim-novo do 10-28, não do corpus estável. Valor incremental em **precisão (uma refutação, 7 misses latentes, 1 correção
de framing)**, não descoberta de regressão.

## Notas de método

**Orquestração.** **5 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a
**re-verificar de fonte-primária** o inventário do 10-28 do seu domínio contra o **código atual** com evidência fresca
`file:linha`, a **REFUTAR** adversarialmente (≥2 por domínio, com a lista explícita de de-escalados a NÃO re-inflar), e a caçar
misses. **4 usaram agent-types locais** deste repo (`.claude/agents/`): `harness-callback-auditor` (l),
`backend-staff-rbac-reviewer` (auth), `Security Engineer` (payments j + channels k), + **2 general-purpose** (LGPD g + schema
a/h + 2 CRÍTICOs; pilot m + routes b + obs + tests e). **Resultado agregado: inventário do 10-28 re-confirmado; 1 refutação de
código (idempotency-header, claim-novo do 10-28); ~7 misses NOVOS (1 MÉD admin-reachable); 1 correção de framing (DSR).**
Tallies: HARNESS 7/7 confirmed + 2 new-latent; AUTH 10/10 confirmed + 3 new/strengthen; LGPD/SCHEMA all-confirmed + 2
CRÍTICOs-hold + 1 new + 1 correção; MONEY/CHANNELS 7/7 confirmed + 1 new-LOW; PILOT/ROUTES/OBS all-confirmed-EXCETO **1
refutação** (idempotency-header) + 1 new-latent + recount-exato.

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD -- src/
db/` = vazio; last-commit-touching src/ **e** db/ = `dbd231e`; describe `v1.0.1-39`); origin/main dos 5 repos (backend dbd231e /
canon 7874971 / harness 2979eb0 / meta-api 5516c2a / hub fd1373b, inalterados); léxico legado (grep triado = zero executável; 3
crus = doc-comments); MFA (seed `generateMfaSecret` + assert firsthand; CLAUDE.md §8 l.171 stale); debt (0 FIXME/HACK/XXX, 1
@deprecated, ~4 TODO Marco-2/3); PCI-nil (grep=0); canon (tracker 10+1 l.781-826, PRD §16.1 "CI verde" verbatim l.1483,
ADR-statuses 008-023 lidos de origin/main — 016 proposed, 011 superseded); version-drift (`merge-base --is-ancestor dbd231e
v1.0.1` = FALSE, 22 commits, 4-way); os 2 CRÍTICOs firsthand (grep 0 writers + 4 inserts); roots de dinheiro (void-returns) e
dispatch (external_message_id) firsthand; **a refutação do idempotency-header firsthand** (`payments/routes.ts:52-54` +
`idempotency.ts:72-99`); `/metrics` unauth + labels firsthand; scheduled-CI (`gh run list`).

**Ground-truth de CI rodado de fato** (2026-10-29 ~09:05 UTC): Typecheck ✓ / Format ✓ / Build ✓ (incl. alias build-gate) /
OpenAPI-parse ✓ / Unit ✓ (**469/469, 69 files**) = **GREEN**; `test:integration` = **RED exit 1** (`1 failed | 92 passed (93)`,
flaky `booking_notice:259` ~09:05 UTC < 13:00 + **2× teardown 57P01**); `pnpm audit --audit-level high` = **RED exit 1, 120
vulns / 52 high** (10 low · 58 moderate · 52 high · 0 critical; **19 módulos-high byte-idênticos ao 10-28**); `lint` = RED por
artefato local (5 `.claude/state/gap*.js` gitignored → CI GREEN; 0 adicionados). **Estado GitHub:** scheduled runs em
`startup_failure` (0s) 09-22→10-27; sem slot cron hoje (quinta).

**Canon.** Lido por path absoluto `~/bevox-knowledge` via `git show origin/main:<path>` (ADR-005). Numeração de ADR
**colide** entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner / CodeQL não
reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta reais) não
exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de writers/endpoints +
CI rodado (incl. 14 suítes de integração live Postgres+Redis via testcontainers) + cross-repo byte-level (harness
`bevox-callback.ts`, meta-api `messages/schemas.ts`+`inbound/service.ts` lidos de `origin/main`). (4) MCP `stripe` +
`claude.ai Google Drive` requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5)
Esta passada é re-verificação sobre código byte-idêntico; o valor incremental é **CI fresco (delta-zero 2ª vez consecutiva;
Security re-platôou byte-idêntico a 52) + 1 refutação de código (idempotency-header, claim-novo do 10-28 → sem duplicate-charge
no piloto) + ~7 misses NOVOS (1 MÉD admin-reachable: SSE firehose de conteúdo LLM) + 1 correção de framing (perdas materiais do
DSR = channels+superseded-facts) + sharpenings**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-29. Sem alteração de código de produto; somente
este relatório. Revisão humana pendente.*
