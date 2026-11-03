# Gap Analysis — bevox-backend — 2026-10-25

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o módulo segundo a
> documentação canônica (PRD V1 + ADRs **aceitas**), calibrado ao gate do **piloto** (1º cliente real:
> login → ver agenda → agendar → cobrar → webhook concilia) e ao gate de **GA/Marco-1..3**.
> Método: **7 auditores de domínio em paralelo** (5 agent-types locais — `harness-callback-auditor`,
> `backend-staff-rbac-reviewer`, `backend-schema-migration-engineer`, `backend-route-reviewer`, `Security Engineer` —
> + 2 `general-purpose` para LGPD e calendar/pilot/obs), cada um re-verificando **de fonte primária** o inventário do
> 10-24 contra o código **atual** com evidência fresca `file:linha`, instruídos a **REFUTAR** superestimações (com a
> lista explícita de refutados/de-escalados a NÃO re-flagar) + caçar misses; **verificação independente de
> fonte-primária pelo orquestrador** dos achados-manchete; e **CI rodado de fato** (2026-10-25 ~09:02–09:05 UTC, não
> inferido; logs em `/tmp/audit-1025/`). Sucede `runtime-gap-audit-2026-10-24.md`.

## Resumo executivo

**13ª passada sobre um alvo byte-congelado; fundação madura; piloto ainda não pronto; nada mudou no código há ~4,7
meses — e nesta passada nada mudou em lugar nenhum.** Prova executada hoje: `git diff dbd231e..HEAD -- src/ db/` é
**vazio** — o produto é byte-idêntico desde `dbd231e` (2026-06-03; `git describe HEAD` = `v1.0.1-35-gbd935da`, o `-35`
são commits de audit docs-only, era `-34` no 10-24). Canon `bevox-knowledge` `origin/main` @ `7874971` (06-03),
`bevox-harness` @ `2979eb0` (06-03), `bevox-meta-api` @ `5516c2a` (06-22), hub `bevox-PRD-consolidation` @ `fd1373b`
(06-03) — **todos inalterados vs 10-24**. Os 7 auditores + o orquestrador **confirmaram o inventário de código do 10-24**
(~95 itens) com **ZERO refutações de código** (o `mark-no-show` segue refutado desde o 10-23), **~14 misses/sharpenings
NOVOS**, várias **correções de evidência/severidade** e **duas de-escalações honestas** (abaixo).

**Manchete-delta #1 — o platô de segurança REFORMOU-SE byte-idêntico: 115 vulns / 50 high, EXATAMENTE como no 10-24.**
Ground-truth rodado 2026-10-25 ~09:02 UTC: **Typecheck ✓ / Format ✓ / OpenAPI(parse) ✓ / Build ✓ / Unit ✓ (469/469,
69 files) = GREEN**; **Tests RED** (`test:integration` exit 1: `1 failed | 92 passed (93)` — o mesmo flaky dependente de
hora-do-dia `calendar-booking.test.ts:259`, rodei ~09:02 UTC < ~13:00 UTC → `booked` em vez de `slot_conflict`; **com 4×
teardown `57P01`** desta vez, vs 2× no 10-24, 0 no 10-23); **Security RED** (`pnpm audit --audit-level high` exit 1:
**115 vulns — 10 low / 55 moderate / 50 high / 0 critical**). Vs 10-24 (**115 / 10-55-50**) → **DELTA ZERO**. Os **19
módulos-high** são o **mesmo conjunto** (`@fastify/static`, `@grpc/grpc-js`, `@opentelemetry/{auto-instrumentations-node,
exporter-prometheus,propagator-jaeger,sdk-node}`, `brace-expansion`, `fast-uri`, `fastify`, `find-my-way`, `js-yaml`,
`nanoid`, `postcss`, `protobufjs`, `source-map-js`, `tmp`, `undici`, `vite`, `zod`), **`zod@4.4.3` permanece no high**
(GHSA-mrhx-c7xc-m3w5, camada de validação de produção). Tendência **12 → 15 → 18 → 49 → 49 → 49 → 50 → 50**: a quebra do
10-24 (49→50, `zod` entrou) durou **exatamente uma passada** e re-platôou — simétrico ao platô de 48h 10-22↔10-23. É a
primeira passada com **delta mensurável zero em todos os três sinais de CI simultaneamente** (Security + Tests + scheduled).

**Manchete-delta #2 — o scanner agendado do GitHub segue dark, janela inalterada: `startup_failure` ininterrupto
09-22 → 10-20.** Re-verifiquei via `gh run list --branch main --limit 30`: **todo** run `schedule` (Security seg-cron
`0 6 * * 1` + CodeQL ter-cron `0 6 * * 2`) termina em **`startup_failure` (0s, sem jobs)** em 09-22, 09-28, 09-29, 10-05,
10-06, 10-12, 10-13, 10-19, 10-20. O **último** run agendado que de fato executou foi **Security `failure` em 09-21** (e
CodeQL `success` em 09-15). **Idêntico ao 10-24** (que já tinha corrigido a janela para 09-22; a hipótese "auto-disable
60d" segue refutada — runs executavam até 09-21). ~5 semanas dark. Causa não-introspectável offline (billing/quota de
Actions, action-ref removida, ou política de org) — fica como dependência cruzada GitHub.

**Manchete-delta #3 — 0 refutações de código, ~14 misses NOVOS (2 verificados independentemente pelo orquestrador), e
DUAS de-escalações honestas (auditores refutaram framing anterior).** Os misses mais relevantes: **(SCHEMA)
`message-content-table-untargetable`** — `message_records` é simultaneamente **sem `organization_id`, sem `created_at`
de inserção, e sem `deleted_at`** → o conteúdo de mensagem (egresso ao LLM) não é DSR-targetável por org nem envelhecível
por cron de retenção; **(PILOT) `cancelled→confirmed` ressuscita appointment liberado sem re-check de capacidade** →
over-book silencioso (nova sub-descoberta do `transition-no-state-guard`); **(L) o IDOR de callback é status-agnóstico**
(`resolveExecutionTokenAnyStatus` → qualquer token dead-letter qualquer execução); **(LGPD) `received_events` guarda
`payload_json` E `normalized_payload_json`** = 2 cópias cruas → com as 3 de `message_records` são **5 cópias de PII
inbound não-apagáveis**; **(LGPD) a única primitiva DSR (export) é RS256-Clerk-only** → a capacidade DSR efetiva do
piloto (staff HS256) é **zero**; **(AUTH) `verifyStaffRefreshToken` é código morto + enganoso** (0 callers, `===` não
constante-tempo, docstring mente). **De-escalações honestas (NÃO re-inflar):** (1) LGPD refutou o framing "`message_records`
sem âncora temporal" — existe uma âncora **transitiva frágil** via `received_event_id → received_events.received_at`
(nullable, set-null no purge do pai); só o `created_at` **direto** de servidor é genuinamente ausente. (2) LGPD: listar
`consent_granted_at` entre "PII omitida do export" é **imaterial** (coluna sempre NULL, zero writers) — as perdas reais
são `preferences_json`/`risk_flags_json`. (3) PILOT **NARROWED** `reschedule-thin-idempotency`: o PATCH usa
`requireIdempotency()` (replay-cache HTTP) → retries de mesma-chave **são** deduplicados; o resíduo é só a janela de
falha-parcial.

**Manchete-delta #4 — correção de contagem para CIMA (SCHEMA): FKs sem índice coberto ≈ 55, não "≥16".** O recount
honesto desta sessão: **~55 colunas `.references()` sem índice coberto** — **18 `organization_id` completamente sem
índice** + ~37 FKs não-org + ~6 borderline. O "≥16 verificados / ~40" das passadas anteriores foi **subcontagem** nos
dois lados; o número honesto é ~55. Padrão sistêmico (viola `backend-db.md` "Toda FK tem index"), inerte a 1 org no
piloto, perf/cascade-GA.

**O piloto morre no passo 2 ("ver agenda") — inalterado e re-verificado por PILOT + SCHEMA + SEC(corrob) + orquestrador.**
Veredito: **o caminho do piloto NÃO é executável como semeado.** 1ª falha dura: o `seed-pilot` cunha JWT staff **HS256**
(`staff-auth.ts:69-70`), mas **toda** rota de calendar é `requireClerkAuth()` **RS256** (`clerk-auth.ts:89-108`) + claim
`organization_id` → **401 na primeira requisição de calendar**; o seed não provisiona principal Clerk nem row `users`
(`seed-pilot.ts:33-35,110-227` escreve exatamente 4 rows: organizations/staffAccounts/professionals/services). Atrás desse
gate: (b) `availability.ts:75 notFound("Calendar")` (seed não cria `calendars`); (c) `professional_schedules` **sem
escritor em todo o app** (único INSERT = fixture `calendar-booking.test.ts:120`; símbolos `weekly*`/`createSchedule`/
`WeeklySchedule` = 0 app-wide) → `availability.ts:126 if(!sched) continue` (precede a leitura do override `extra` em
`:128`) → `slots:[]` → `booking.ts:207 slot_conflict` em 100%, **app-wide, não corrigível por config nem por override**;
não existe módulo `onboarding` apesar do enum `onboarding_stage_enum` ter um valor `schedule` (`_shared.ts:44`).
backend/ADR-010 (calendar/WeeklySchedule) é **aceita** (`aceita_em 2026-04-22`, lido de origin/main). **Fix mínimo ≈ 2-3h**
(seedar Calendar + grade Seg-Sex) **mas** o fechamento real do CRÍTICO-1 exige um **writer de WeeklySchedule** (rota/repo,
≈ 4-6h). E **não há GET de agenda** em nenhum plano (Clerk, staff-ops **nem** OpenAPI) → mesmo com auth corrigida, "ver
agenda" não tem endpoint.

**Money-path manual do piloto FUNCIONA** (integração verde: `payments-manual-mode` 19/19 confirmada pelo histórico do
10-24; main-path booking exactly-once **são**) **com 2 bugs HIGH alcançáveis** — porém a reachability é **por Clerk-user**,
não pelo staff HS256 semeado (que esbarra no 401 auth-actor **upstream**): (1) `outbound-provider-vocab-mismatch`
**(HIGH, SHARPENED → pilot-universal)**: `upsertChannelConnection` tem **exatamente 1 caller** → `channel_connections.
provider` é **estruturalmente sempre `"wa"`/`"ig"`** → outbound null-coage → `skipped_missing_recipient` → execução fica
`done` (**falso-sucesso**) → **100% das respostas de IA ao piloto são dropadas em silêncio**, não condicionalmente;
meta-api `origin/main 5516c2a` exige `z.enum(["whatsapp","instagram"])` (confirmado) → `wa`/`ig` é invenção 100%-backend.
(2) `manual-remark-inserts-orphan-paid-payment` **(HIGH, irreversível)**: re-marcar paga uma charge `expired`/`refunded`/
`cancelled` → `markChargePaid` rowcount-0 **mas** `insertPayment`/confirm/grant rodam mesmo assim → payment `paid` órfão
fresco; depois **não-estornável** (`service.ts:499`).

**Caminho de fechamento do piloto curto e inalterado:** 2 blockers de agenda (≈ 2-3h seed + ≈ 4-6h writer de grade) +
gate de auth-actor (ops Clerk, ou ~4-6h rota staff-scoped) + gate de CI (flaky ≈ 0,5h; audit ≈ 4-6h por 50 highs incl.
`zod` + re-enable do scheduled) + `GET /appointments` (≈ 4-6h) ≈ **~1-1,5 dia**. Severidades ancoradas no gate do
**piloto**; para GA vários ALTO/MÉDIO sobem (vocab de canal, token-IDOR status-agnóstico, o `status`-callback 404
ponta-a-ponta, `active_execution_id`-wedge, `buildDispatchMessages`+`message_id`-poison, `rate-limit`-dead viram CRÍTICO
de GA).

---

## Correções ao brief da missão (para o revisor)

Verificadas de fonte primária esta sessão:

1. Os **4 callbacks** que o backend expõe são **`PATCH /status`, `POST /traces`, `POST /stream`, `POST /complete`**
   (`src/integration/harness-callbacks.routes.ts:56,87,109,138`) — **não** `/complete,/artifact,/tool-result,/turn`
   como o brief lista.
2. **backend/ADR-019** é **execução + colapso da AISuggestion** (`30_adr/bevox-backend/ADR-019-execucao-e-a-sugestao-
   colapso-aisuggestion.md`, **aceita 2026-05-20**), **não "channels"** como o brief diz. **Channels = _shared/ADR-011.**
   backend/ADR-018 = refund/cancellation policy (**aceita 2026-05-19**). backend/ADR-023 = manual payment mode (**aceita
   2026-05-22**). backend/ADR-010 = calendar/WeeklySchedule (**aceita 2026-04-22**). backend/ADR-014 = PSP v1 Stripe
   Connect (**aceita 2026-04-22**). **backend/ADR-016 (token-billing) = `proposed`** → corretamente NÃO implementado.
   backend/ADR-011 (aisuggestion) = **`Superseded by ADR-019`**. O range "0011 a 0018 Marco-1" do brief é aproximado; as
   ADRs aceitas vinculantes vão até 0023.
3. O grep `account_id\b` do brief captura **232** ocorrências em `src/`/`db/`, **todas sancionadas**: composites
   `external_account_id`/`payment_account_id`/`channel_account_id`, o alias financeiro `AS account_id`, a propriedade
   Stripe `res.accountId` (`payments/service.ts:593`, semântica financeira reservada por ADR-021/019), doc-comments do
   rename, e snapshots drizzle/tipo gerado. O léxico proibido **executável** é **ZERO**; os 3 hits "crus" de
   `workspace_id`/`workspaces` são **doc-comments** explicando o rename (`autonomy/routes.ts:5`, `organizations/
   routes.ts:3`, `autonomy.ts:3`). Invariante §4.1 mantida — **não-gap**. Ver categoria c.
4. Código congelado desde **06-03** (`dbd231e`), não 06-04. O último commit que toca `src/` **e** `db/` é `dbd231e`.
5. Numeração de ADR **colide** entre `backend/` e `_shared/` (008–023) — **sempre qualificada** abaixo.
6. **RBAC de staff é canon backend/ADR-013** (roles `bevox_admin|bevox_support|bevox_observer`), **não ADR-022**
   (backend/ADR-022 = `policy-json-sub-keys`, confirmado por nome de arquivo no canon). A rule local
   `.claude/rules/backend-routes.md:24,33` mis-cita "ADR-022 staff RBAC" + nomes curtos + invoca o inexistente
   `requireRole` — ver BAIXO/governança.
7. O `status`-callback **não é** drift de OpenAPI: é **PATCH** no YAML **e** no handler (`routes.ts:56`) — eles
   **concordam**. A quebra POST-vs-PATCH é **cross-repo** (harness POSTa) — categoria l, não b. **Nit de canon
   (não-bug-backend):** PRD l.447 (linha de sumário de módulo, `POST /status`) contradiz o §10.4 autoritativo l.1076
   (`PATCH`) — merece errata no canon; backend não muda nada.

## Calibração canônica (lida do canon `origin/main` frozen — PRD §16 prontidão + ADRs aceitas)

- **§16.1 Marco-1 ("Pronto para integração", l.1481-1483)** inclui literalmente `- [ ] Repositório bevox-backend criado;
  CI verde.` (lido verbatim hoje de `origin/main`) ⇒ o único bloqueador **mensurável** de Marco-1 é **CI-verde (RED em
  Tests + Security)**. Também: migrations em pg16; módulos auth/organizations/users/professionals/services/customers;
  OpenAPI publicado; contrato harness testado com stub; deploy staging.
- **§16.2 Marco-2** (calendar, conversations, messages, channels, ai-pipeline, autonomy; Fluxos 1/2/3 e2e; token
  accounting; idempotência tools; métricas Prometheus; cobertura ≥70%). **§16.3 Marco-3** (payments Stripe Connect,
  reminders, faq, rules, audit, observability completa; WhatsApp direto; **LGPD DSR/retenção/consentimento**; **MFA
  TOTP**; backup/restore; rate-limit distribuído; SLO). Roadmap §15 l.1401: "Marco 3 — Absorção do calendar-service
  (ADR-010)".
- **Status de ADR (lido de `origin/main`):** backend/ADR-009/010/013/014/015/017/018/019/020/021/022/023 = **`aceita`**;
  backend/ADR-016 (token-billing) = **`proposed`** (corretamente não implementado); backend/ADR-011 = **`Superseded by
  ADR-019`** (aceita). _shared/ADR-019 (bases legais LGPD) + _shared/ADR-020 (retenção) = **aceitas 2026-04-23**.
- **Fato estrutural:** o código entrega muito além de Marco-1 — o README "Marco 1 bootstrap" **subdeclara** o que existe.
  O piloto exercita calendar + payments-manual (ADR-023 aceita) + o worker assíncrono independentemente do rótulo → os 2
  CRÍTICOs são **Marco-2/3-por-rótulo mas pilot-blocking**. "Marco-1 concluído?" ≠ "piloto-pronto?".

## Mapa de cobertura das categorias a–n

| # | Categoria | Cobertura | Achado-âncora (2026-10-25) |
|---|-----------|-----------|----------------------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO app-wide; sem módulo onboarding apesar do enum `schedule`); `StatusHistory` ausente (Módulo 16 l.584/588); `appointments.created_by_*` **colunas inexistentes** (§8.3 l.869); templates ADR-020 + priority-score ADR-021 **Opção C vinculante** (l.49-51) não-materializadas |
| b | OpenAPI vs rotas | ✅ **CONFORME-drift** | recount independente reproduzido **exato**: `103 call-sites / 106 runtime-ops / 80 yaml-paths / 95 yaml-ops / operationId:0 / phantom:0 / 11 undoc` (bijeção 106−11=95); 11-undoc split **4-isentos / 7-drift-real**; `mark-no-show` segue **REFUTED**; `148` parses inline (era ~145) |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | executável **ZERO** (232 sancionados; 3 "crus" = doc-comments) |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ **CONFORME** | seed gera base32 160-bit (`seed-pilot.ts:153`) + `assertMfaSecretNotPlaceholder` (`:154`) + blocklist (`mfa.ts:36`); o sentinel só aparece como **comentário** (`mfa.ts:66`); login sem MFA = **correto** (Marco-3, `auth/service.ts:84-87`); **`CLAUDE.md §8 l.171` stale** (afirma que o seed grava o sentinel literal) |
| e | Testes faltando (hot paths) | ✅ | webhook Stripe (`constructEvent`=0 em test/) / reconcile-cron (só unit mockado → 42703 CI-invisível) / availability-rota / inbound-vocab / `GET /appointments` — zero e2e; integração manual-money verde (histórico 19/19) |
| f | Bugs/dívida TODO/FIXME | ✅ | sweep `src/ db/`: **0** FIXME/HACK/XXX; **1** `@deprecated` (`orchestration/repository.ts:348`); ~9 TODOs todos Marco-2/3 (2 falsos-positivos `TODOS`=all PT-BR) |
| g | LGPD | ✅ | consent/`ai_opt_out` **arquiteturalmente inaplicável** (dispatch conversation-keyed); ingestão de PII **pré-aviso** (`intake.ts:66,82`); **5 cópias** de PII inbound cruas não-apagáveis; **NOVO** `message-content-table-untargetable`; DSR-export **inacessível no piloto** (RS256) + não-auditado (sem `dsr_requests`); retention worker ausente |
| h | Marco-1 tracker × código | ✅ | **10 delivered + 1 parked** (origin/main, verbatim); **nenhum** work-item p/ calendar/ADR-010 (`governed_by ADR-010` em zero work-items), customer-identity/ADR-009, templates/ADR-020, priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker** |
| i | CI vermelho | ✅ (rodado) | Tests RED (flaky + **4× 57P01**) + Security RED **50 high / 115** (**platô RE-FORMADO byte-idêntico**); fast-gate GREEN (469/469); lint-RED = artefato local gitignored (5 `gap*.js`, 0 adicionados); scheduled CI dark **09-22→10-20** (~5 sem) |
| j | Charges + Connect (PCI) | ✅ | `manual-remark orphan` **HIGH + irreversível**; `reconcile-refund-42703` **cron-only Stripe-latente** (webhook vivo intacto); `intent-reconcile` **half-applies paid** (SHARPENED); overflow `numeric(10,2)` em **ambos** manual+Stripe (`charge-intent.ts:48`); PCI-nil |
| k | Channels (metaapi) | ✅ | vocab-drop **HIGH pilot-universal** (SHARPENED) + métrica-cega; `pre-HMAC DB amplification` (DoS); audit-dup em retry; null-tenant **one-time 500 + drop permanente + órfão**; unknown-provider-silent-drop; HMAC correto |
| l | Harness dispatch | ✅ | `status`-callback **POST↔PATCH 404 total** (root-cause único); token-IDOR **status-agnóstico** (NOVO); `active_execution_id` wedge; `buildDispatchMessages`+`message_id`-UUID poison (fire-first); `stream` char-vs-byte (NOVO LOW); todos inertes no piloto manual |
| m | Alçapões do piloto | ✅ (traçado) | **NÃO-executável como semeado**: 1ª falha = auth-actor 401; atrás, calendar-404 + grade-vazia app-wide + **sem GET de agenda**; money-path manual OK (reachability Clerk-user); worker-telemetry buraco-negro; `cancelled→confirmed` resurrection over-book (NOVO) |
| n | Delta vs audit anterior | ✅ | 10-24 re-verificado; **0 refutações de código**; Security/Tests/scheduled **delta-zero** (1ª vez nos 3 simultâneos); ~14 misses NOVOS + 2 de-escalações honestas; FK-sem-índice **corrigido p/ CIMA ≈55** |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia) — re-verificada de fonte-primária:**

1. **LOGIN (staff) — PASSA mecanicamente, classe de token errada.** `seed-pilot` cria org (`:110`) + `bevox_admin`
   (`:157`); `loginStaff` (`auth/service.ts:63-90`) é password-only (MFA seam presente não-enforced `:84-87`); cunha JWT
   staff **HS256** (`staff-auth.ts:69-70`). Só serve a rotas `requireStaff`. **Sem rate-limit/lockout.**
2. **VER AGENDA — QUEBRA na AUTH primeiro (401).** `GET .../availability` exige `requireClerkAuth()` **RS256**
   (`calendar/routes.ts:22,48`; `clerk-auth.ts:89-108`) + claim `organization_id` → token staff HS256 → **401**. Seed não
   cria principal Clerk nem row `users`. *Se JWT Clerk à mão:* → `availability.ts:75 notFound("Calendar")` (**CRÍTICO b**).
   *Se Calendar à mão:* → grade vazia app-wide (**CRÍTICO c**). **E não há `GET /appointments` em plano nenhum** (Clerk,
   staff-ops **nem** OpenAPI) → "ver agenda" não tem endpoint.
3. **AGENDAR — BLOQUEADO a jusante.** `booking.ts:207 slot_conflict` em 100%. **Main-path exactly-once É SÃO** (advisory
   xact-lock + recount in-lock + unique index + replay 23505; POST honra `Idempotency-Key` `routes.ts:88`).
   Reschedule/transition têm 7 defeitos de correção (incl. NOVO `cancelled→confirmed` resurrection over-book); create/
   reschedule/transition não gravam `audit_events` (§12.8 l.1344) e não persistem actor (`created_by_*` **inexistente**).
4. **COBRAR — money-path manual FUNCIONA (mas não hands-off-seedável).** Serviço semeado sem `requiresPrepayment` →
   default `false` (`catalog.ts:67`; hook `booking.ts:275` nunca dispara) **e** `seed-pilot` não cria `payment_accounts`
   → precisa de `POST /payment-account/connect-manual` à mão (mesmo gate Clerk). **1 bug HIGH irreversível** re-mark de
   charge terminal (reachability Clerk-user); overflow 500 em `amount_total` ≥ 1e8 (manual **e** Stripe).
5. **WEBHOOK CONCILIA — FRACO (só Stripe; manual não usa).** Webhook Stripe sem teste de rota/assinatura; reconcile cru
   `half-applies paid` sem `applyChargePaid`; reconcile de refund DOA (42703) — **cron-only, mas o cron É live-wired**
   (`queue/index.ts:149` + repeatable `:262`); o webhook vivo `updateRefundStatus` omite `updated_at` → intacto; modo
   manual não é afetado (refunds escritos `succeeded` direto, nunca `pending`).

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[SHARPENED]`/`[NARROWED]`/`[REFUTED]`/`[de-claim]` = status vs 10-24; **(v: …)** =
verificação; `[xrepo]` = dependência cruzada. Severidade ancorada no gate do **piloto**; escalonamento p/ GA anotado.
`file:linha` = evidência lida **nesta** sessão sobre código byte-idêntico a `dbd231e`.

### CRÍTICO (bloqueia runtime do piloto — sem workaround de produto)

- **`professional-schedules-no-writer`** `[carry, SHARPENED]` **(v: CONFIRMADO ×3 — SCHEMA + PILOT + orquestrador)** —
  Nenhum caminho do app escreve `professional_schedules` (grade semanal-base; tabela existe `calendar.ts:41-62`). Único
  `INSERT` = fixture `test/integration/calendar-booking.test.ts:120` (SQL cru). Símbolos `weekly*`/`createSchedule`/
  `upsertSchedule`/`WeeklySchedule` = **0 app-wide**; produção só lê (`availability.ts:116`); `:126 if(!sched) continue`
  esvazia todo dia → `slots:[]` → `booking.ts:196/207 slot_conflict`. O `if(!sched) continue` (`:126`) executa **antes**
  da leitura do override `extra` (`:128`), logo o único writer de capacidade (`createScheduleOverride` type=`extra`,
  `repository.ts:78`, rota `routes.ts:44`) **nunca** resgata um profissional sem row base → **não há escape-hatch de
  bootstrap**. **SHARPENING NOVO (v: SCHEMA):** não existe módulo `src/modules/onboarding/` apesar do
  `onboarding_stage_enum` ter um valor `schedule` (`_shared.ts:44`) — a grade jamais é preenchida por nenhum fluxo.
  Escopo §5.3 (backend/ADR-010 **aceita**; `WeeklySchedule` entidade de 1ª classe, PRD l.379 + ADR-010 l.74). —
  Impacto: 100% dos agendamentos = `slot_conflict`, app-wide. — Esforço: **4-6h** (rota+schema+repo+teste) ou **2h**
  (seedar grade como paliativo). **#1.** `[xrepo: hub runbook go-live invoca seed-pilot]`
- **`seed-pilot-creates-no-calendar-no-grid`** `[carry]` **(v: CONFIRMADO ×3 — SCHEMA + PILOT + orquestrador)** —
  `seed-pilot.ts` importa só organizations/staffAccounts/professionals/services (`:33-35`) e tem exatamente **4**
  `.insert(`: organizations (`:110`), staffAccounts (`:157`), professionals (`:195`), services (`:217`). Zero `calendars`
  → `availability.ts:75 notFound("Calendar")`. `createCalendar` existe (`calendar/repository.ts:20`) e está route-wired
  (`routes.ts:33,38`); o gap é "o seed nunca o chama e não há bootstrap não-HTTP". `professional_services` também não é
  semeado → fallback "todos os profissionais bookáveis" (`availability.ts:91-96`). `system_holidays` omitido é
  **fail-open** (`:108-111`), não co-bloqueador. — Esforço: **2-3h** (seedar Calendar + grade Seg-Sex + feriados). **#1.**
  `[xrepo: hub runbook]`

### ALTO (bloqueia GA / o gate de CI Marco-1 / pré-requisito do piloto com workaround de ops; ou dispara quando harness/IA/outbound/staff-approve ligar)

**Pré-requisito de piloto — auth-actor**

- **`pilot-actor-cannot-authenticate-to-calendar`** `[carry]` **(v: CONFIRMADO ×3 — PILOT + SEC(corrob) + grep)** — seed
  provisiona **só** org + `staff_account` (HS256, `staff-auth.ts:69-70`); toda rota de calendar é `requireClerkAuth()`
  RS256 (`calendar/routes.ts:22,48`; `clerk-auth.ts:90` pin RS256 + `:105-108` claim org) → token staff rejeitado 401.
  `grep requireStaff|requireRole src/modules/calendar/` = **0**; o seed não cria usuário Clerk nem row `users`. Sit
  **upstream** dos 2 CRÍTICOs. — Esforço: ops (Clerk) OU ~4-6h (rota de calendar staff-scoped). `[xrepo: Clerk]`

**Gate "CI verde" (§16.1 — rodado de fato 2026-10-25; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice`** `[carry]` **(v: RODADO)** — `pnpm test:integration` = **RED exit 1**,
  `1 failed | 92 passed (93)` (`Test Files 1 failed | 13 passed (14)`). Falha = `calendar-booking.test.ts:259`
  "slot_conflict quando start_at < now() + booking_notice_minutes" `AssertionError: expected 'booked' to be
  'slot_conflict'` — o gate só dá `slot_conflict` se `now() > ~13:00 UTC`; rodei ~09:02 UTC → `booked`. **Com 4×
  teardown `57P01`** desta vez (`terminating connection due to administrator command`, ruído de teardown testcontainers/
  ioredis — vs 2× no 10-24, 0 no 10-23; não mudou pass/fail). `ci.yml` (job `Tests`) roda `pnpm test` + `pnpm
  test:integration` com services pg16+redis7, **sem** `continue-on-error`. — Esforço: **0,5h** (slot `now()`-relativo +
  fechar `closeDb()/closeRedis()`). **#2.**
- **`ci-security-red-pnpm-audit-50-high`** `[carry, RE-PLATÔ byte-idêntico]` **(v: RODADO)** — `pnpm audit --audit-level
  high` = **RED exit 1, 115 vulns (10 low · 55 moderate · 50 high · 0 critical)** — **DELTA ZERO vs 10-24**. 50 high em
  **19 módulos** (mesmo conjunto exato), incl. `zod@4.4.3` (GHSA-mrhx-c7xc-m3w5, `<4.6.6`, exaustão de memória na camada de
  validação HTTP). Highs prod-runtime no core Fastify (`fastify`<5.12.2 ×4 / `@fastify/static` / `find-my-way` /
  `fast-uri` ×7 / `undici` ×7 — undici só via testcontainers, dev). `security.yml` → osv-scanner (lockfile) + `pnpm audit
  --audit-level high` com **`continue-on-error: false`** → hard-fail; triggers push/PR/seg-cron. **Tendência
  12→15→18→49→49→49→50→50.** — Esforço: **4-6h** (`pnpm add zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm
  override` undici/tmp/vite/fast-uri/nanoid/brace-expansion). **#3.**
- **`ci-scheduled-runs-dark-on-github`** `[carry, inalterado]` **(v: orquestrador — `gh run list`)** — todo run
  `schedule` em `main` (Security seg-cron `0 6 * * 1`; CodeQL ter-cron `0 6 * * 2`) termina em **`startup_failure`
  (0s)** ininterrupto de **09-22** até 10-20; último run agendado que executou = Security `failure` em **09-21** (CodeQL
  success 09-15). Causa não-introspectável offline (billing/quota Actions, action-ref removida, ou política) — **não** o
  auto-disable-de-60-dias. Gate de segurança agendado **nem roda nem alerta**. — Esforço: **0,2h** (re-enable) — fix real
  é destravar o lockfile. `[xrepo: GitHub Actions]`

**Auth / rate-limit — buraco app-wide**

- **`rate-limit-plugin-dead-app-wide`** `[carry]` **(v: CONFIRMADO ×2 — AUTH + SEC)** — `requireRateLimit` tem **zero
  callers** em todo `src/` (grep: só `rate-limit.ts:4` doc, `rate-limit.ts:146` decorate-def, `global.d.ts:66` tipo).
  `@fastify/rate-limit@^10.3.0` é dep declarada (`package.json:37`) mas **nunca importada/registrada** em `src/`; o plugin
  Lua custom é registrado (`bootstrap/server.ts:134`) mas apenas **decora** o opt-in `requireRateLimit` — **nenhuma rota
  o anexa** (login/refresh, mutações de money, webhooks metaapi/Stripe, rotas Clerk). Login staff (`auth/routes.ts:90`)
  **sem preHandler algum** → brute-force online ilimitado (bcrypt cost-12 único freio; MFA é Marco-3). — Impacto:
  brute-force de admin + superfície de DoS (ver `pre-HMAC amplification`). Piloto baixo (1 admin, senha requiredInProd).
  — Esforço: **~1h** (anexar o `requireRateLimit` já-construído a login/refresh/mutators). **#8.**
- **`staff-jwt-secret-no-min-length`** `[carry]` **(v: CONFIRMADO — AUTH)** — `env.ts:60 STAFF_JWT_SECRET: optionalString`
  (sem `.min()`); refine de prod é **presence-only** (`:206`) → secret de 1 char passa; `staff-auth.ts:69-70` assina
  HS256. O mesmo secret assina o JWT de `state` do Google OAuth (`oauth.ts:95-96,107`), **mas** audiences distintas
  (`STAFF_AUDIENCE="bevox-backend-staff"` `:36,84` vs `OAUTH_STATE_AUDIENCE="bevox-google-oauth-state"` `oauth.ts:33,
  60-63`) e ambas verificadas → **sem replay cross-plane**; o risco é o **piso de entropia** (chave fraca forja os DOIS
  planos independentemente). — Esforço: **0,5-2h** (`.min(32)` + refine prod). **O buraco de auth mais duro no piloto
  (HS256 staff).**
- **`rbac-org-role-not-enforced`** `[carry]` **(v: CONFIRMADO — AUTH, canon-reforçado)** — `requireRole` é **vaporware**:
  só 3 comentários-prosa (`clerk-auth.ts:25`, `auth/repository.ts:261`, `global.d.ts:35`); **não está sequer declarado**
  no `FastifyInstance` (`global.d.ts:52-70` lista os 6 decorators reais). `clerk-auth.ts:109 role = … ?? "member"`
  (default **fora** do enum DB `owner|admin|operator|professional_viewer`, `_shared.ts:67-72`). Rotas cliente mutantes
  (money `payments/routes.ts`; DELETE/PATCH professionals|services; PATCH org/settings; PII customers; waitlist) têm só
  `requireClerkAuth+requireOrganizationScope` → qualquer JWT org-member roda tudo intra-org (org-scope ainda bloqueia
  cross-org). **Canon ADR-013 l.143** manda middleware rbac por role — não entregue. Blast-radius **nulo no piloto**
  (piloto usa plano staff, não Clerk product-user). — Esforço: **1-2d**. `[xrepo: backend/ADR-013]`
- **`impersonation-audit-trail-absent`** `[carry, SHARPENED ×2]` **(v: CONFIRMADO — AUTH)** — `auth/service.ts:135-139`
  seta claim `impersonation_id` ao PK da row `staff_impersonations`. O hook de audit (`auth/routes.ts:70-87`) vive no
  plugin encapsulado `authRoutes` (`server.ts:198`); staff-ops é registrado como plugins **irmãos** (`server.ts:213-215`)
  → encapsulamento Fastify → o hook **nunca dispara** nas ações staff-ops; estas **são** auditadas
  (`actions.repository.ts:174-184`) **mas** gravam `actor_type='user'`, `actor_id=NULL` (literais `:179`), e **nenhum
  `impersonation_id`**. **SHARPEN-1 (NOVO):** os **reads** staff-ops (`read.routes.ts:22-40`) tomam `organization_id` do
  **query string**, são cross-org, e são **inteiramente não-auditados** → leituras de PII de tenant (executions,
  conversations) sob impersonation deixam zero trilha. **SHARPEN-2 (NOVO):** `organization-scope.ts:57` retorna o
  `impersonation_id` **como** claim de org → não é só código morto (nenhuma rota pareia `requireStaff`+
  `requireOrganizationScope`) mas **semanticamente errado** (compararia UUID de impersonation-row ao `:organization_id`
  → sempre 403). `endImpersonationSession` **não revoga** o token HS256 (stateless ≤900s). — Esforço: **1-2d**. `[xrepo:
  ADR-013]`
- **`clerk-user-provisioning-broken`** `[carry]` **(v: CONFIRMADO — AUTH)** — `auth/repository.ts:217-224 SELECT
  organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}` (clerk-**org**-id contra coluna clerk-**user**-id) +
  `routes.ts:169-170 orgClaim = organization_id ?? clerkUserId`; `upsertUserFromClerk` hardcoda `role='operator'`
  (`:238`); webhook só trata `user.*`, sem `organization.created` → paradoxo de bootstrap (1º user de uma org
  inprovisionável). Mitigado no piloto (seed). — Esforço: **4-8h** (+ADR org-mapping). `[xrepo: Clerk]`
- **`clerk-jwt-no-aud-iss-validation`** `[carry, aud/iss-only]` **(v: CONFIRMADO — AUTH)** — `clerk-auth.ts:89-92`
  verifica só `{algorithms:["RS256"], clockTolerance}`, sem `audience`/`issuer`; `organization_id` vem de claim
  não-verificada (`:105`). jose **já** valida `exp`/`nbf` + pin RS256 — o gap é estritamente **aud/iss** (qualquer token
  RS256 do mesmo JWKS/instância Clerk é aceito). **Assimetria:** tokens staff **pinam** audience; Clerk não. — Esforço:
  **0,5-1h**.

**Canais / money — alcançável no piloto (reachability por Clerk-user; staff HS256 semeado esbarra 401 upstream)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry, SHARPENED → pilot-universal]` **(v: CONFIRMADO — SEC;
  "defeito confirmado mais danoso")** — Inbound colapsa `whatsapp→"wa"`/`instagram→"ig"` (`normalize.ts:16,35,44`) e
  persiste em `channel_connections.provider` (`metaapi/routes.ts:246-252` → coluna `notNull()` **sem CHECK**). **SHARPEN
  NOVO:** `upsertChannelConnection` tem **exatamente 1 caller** (`routes.ts:246`) e o seed não cria channel_connection →
  o provider é **estruturalmente sempre `"wa"`/`"ig"`**, nunca um nome pleno deliverável. Outbound
  `findExecutionDeliveryContext` null-coage provider ≠ pleno (`metaapi/repository.ts:197`) → `ctx.provider=null` → guard
  `executions/seams.ts:360` → `skipped_missing_recipient` (`:376`); `isDeliveryFailure` exclui skips (`seams.ts:122-124`)
  → `complete-service.ts:100` fica `done` (falso-sucesso); a métrica loga `channel:"unknown"` (`seams.ts:372-374`). O send
  é um POST real (`client.ts:74,159`). meta-api `origin/main 5516c2a` exige `z.enum(["whatsapp","instagram"])`
  (`messages/schemas.ts:7`, confirmado) → `wa`/`ig` é invenção 100%-backend. **Alcançável NO piloto (Clerk-user):**
  `approve()` → `runApproval` → `deliverToChannel` (`executions/service.ts:68`) **e** `executeProposals` →
  `deliverToChannel` (`complete-service.ts:89`). — Impacto: **100%** das respostas de IA a conversas inbound-semeadas
  descartadas em silêncio como `done` (não condicional). — Esforço: **3-4h** (mapear vocab na fronteira de entrega +
  CHECK + backfill + teste e2e). **#5.** `[xrepo: bevox-meta-api frozen 06-22]`
- **`manual-remark-inserts-orphan-paid-payment`** `[carry, irreversível, reachability NARROWED a Clerk-user]` **(v:
  CONFIRMADO — SEC)** — `markChargePaidManually` **não** tem status-gate (`service.ts:422-433`; docstring `:415-416`
  proíbe-o por design); `applyChargePaid` chama `insertPayment` **incondicional** (`service.ts:891`) após `markChargePaid`
  (guardado `WHERE status='pending'`, void sem rowcount, `repository.ts:395-398`). Re-mark de `expired`/`refunded`/
  `cancelled` → `markChargePaid` rowcount-0 **mas** `insertPayment`+`confirmAppointmentIfUnconfirmed`(`:902`)+grant de
  pacote(`:915-919`) rodam; numa charge `refunded` o payment anterior está `reversed` (`markPaymentReversed`
  `:916-919`), logo UNIQUE(org,pid,**status**) não colide → payment `paid` órfão fresco. Depois **irreversível**:
  `refundChargeManually` exige `status==='paid'` (`:499`). Rotas mark-paid/expire sob `mutate` = `requireClerkAuth()+
  requireOrganizationScope()` (`routes.ts:59`) → reachable por **Clerk org-user** (sem role-gate), mas staff HS256
  semeado esbarra no 401 auth-actor upstream. Root-cause compartilhado alcança o path Stripe. Fix = gatear os 3
  side-effects no rowcount de `markChargePaid` (NÃO um status pre-check). — Esforço: **~1h**. **#4.**

**Bloqueador de produto latente / cross-repo (CRÍTICO quando harness/IA ligar — INERTE no piloto manual)**

- **`harness-status-callback-method-mismatch-total`** `[carry, root-cause único]` **(v: CONFIRMADO byte-level nos 2
  repos — L)** — Harness `post()` hardcoda `method:"POST"` (`bevox-callback.ts:28`); `updateStatus` POSTa `running`/
  `dead_letter` (`:133-147`), backend só registra **PATCH** `/status` (`harness-callbacks.routes.ts:56`) → **toda**
  chamada de status → Fastify **404**. `applyStatusTransition` + `markExecutionDeadLetter` são **código morto
  ponta-a-ponta**. O worker `on('failed')` só loga jobs backend-internos → **root-cause único**. Backend é
  **canon-correto** (§10.4 PATCH l.1076). Fix = **cross-repo** (harness→PATCH + errata canon l.447). — Esforço: **~1,5h**.
  **#7.** `[xrepo: bevox-harness + canon]`
- **`callback-token-not-bound-to-path-execution-id`** `[carry, NOVO: status-agnóstico]` **(v: CONFIRMADO — L; grep
  leituras=0)** — o preHandler resolve o `X-Execution-Token` ao `execution_id` **dono do token**
  (`execution-token.ts:71,96`), mas **todo** handler age sobre o `:id` da URL (`routes.ts:73,91,113,142`) e **nunca** lê
  `req.executionContext` (grep: leituras não-atribuição = 0). Token válido p/ A escreve em qualquer execução B (IDOR
  cross-execution/cross-tenant). **NOVO:** o branch dead_letter usa `resolveExecutionTokenAnyStatus` (`routes.ts:68`) →
  qualquer token (mesmo de execução terminal) pode dead-letter qualquer outra execução. Coexiste com
  `four-callbacks-token-gated` (autenticidade ≠ autorização). **Inerte no piloto**; **CRÍTICO-GA**. — Esforço: **1h**.
  `[xrepo: bevox-harness]`
- **`dispatch-message-id-not-uuid-poisons-every-AI-dispatch`** `[carry, fire-first]` **(v: CONFIRMADO — L + orquestrador)**
  — `buildDispatchMessages` seta `message_id: m.external_message_id` (`orchestration/repository.ts:409`);
  `external_message_id` é `text NOT NULL` (`db/schema/ingestion.ts:40`), populado do id nativo de canal (`wamid.*`/`mid.*`)
  — **nunca** UUID. Mas `Uuid = z.string().uuid()` (`harness-dispatch.schema.ts:15`), `message_id: Uuid.optional()`
  (`:22`) — campo **sempre presente** (notNull), `.optional()` não salva. `dispatchExecution` roda
  `DispatchPayloadSchema.parse(...)` (`harness-dispatcher.ts:91`) **antes** do enqueue (`:107`) → ZodError "Invalid uuid"
  em tráfego real. Atinge os 2 paths (cutoff `:54,57` + os 3 redispatch de staff `actions.repository.ts:129`). **Fire-
  first:** no instante em que o piloto ligar QUALQUER dispatch de IA, este achado dispara **antes** de criar execução
  (os achados 1/5/6/7 só observáveis após um dispatch suceder, que este impede). — **Inerte no piloto manual; CRÍTICO-GA.**
  — Esforço: **~15min** (`message_id` → `z.string().optional()`). `[xrepo: bevox-harness]`
- **`dispatch-messages-unbounded-poison`** `[carry]` **(v: CONFIRMADO — L)** — `buildDispatchMessages`
  (`orchestration/repository.ts:391-415`) seleciona **TODAS** as linhas de texto da conversa (sem LIMIT/truncation,
  `:394-398`). O harness impõe `messages.max(100)` / `content.max(8000)` / `MAX_PAYLOAD_BYTES 256KB`
  (`execution-handler.ts:606-608`) → payload acima = `UnprocessablePayloadError` (poison). Conversa > ~100 msgs: todo
  dispatch envenena. — **Inerte no piloto manual; CRÍTICO-GA.** — Esforço: **1-2h** (LIMIT/slice últimos-N + guard
  por-msg). `[xrepo: bevox-harness]`
- **`completion-never-clears-active-execution-id`** `[carry]` **(v: CONFIRMADO — L)** — só `releasePipelineClaim`
  (`orchestration/repository.ts:231`, catch de dispatch-fail) e `handoffConversationOnTimeout` (`:464`) nulam
  `active_execution_id`; `finalizeCompletion` (`harness-callbacks.repository.ts:136-143`) só escreve `executions` (grep:
  0 refs `active_execution_id` nesse arquivo); guard de dispatch exige `active_execution_id IS NULL` (`:196`) → conversa
  trava após a 1ª execução. — **Inerte no piloto**; **CRÍTICO-GA (IA single-turn)**. — Esforço: **3-4h**. `[xrepo:
  bevox-harness]`
- **`backend-never-sends-skills-allowlist`** `[carry]` **(v: CONFIRMADO — L)** — `cutoff.ts:75 skills:[]`;
  `actions.repository.ts:144 skills:[]`; `account_denied_tools` **nem existe** no `DispatchPayloadSchema`; harness trata
  `[]` como "todas as tools" (`permission-context.ts:40-47`) → PERM-05 **no-op** e2e. — **Inerte no piloto**; CRÍTICO-GA.
  — Esforço: **4-8h**. `[xrepo: bevox-harness]`
- **`complete-service strategy/tenant mismatches`** `[carry, SHARPENED]` **(v: CONFIRMADO — L)** — `strategy:"failed"`+
  proposals vazias → `"reply"` (`complete-service.ts:17-32`), nunca `error`; harness emite `aborted_cost`/`aborted_timeout`
  (único emissor terminal `execution-handler.ts:~2146`) ausentes do enum backend (`harness-callbacks.schema.ts:57-65`) →
  `CompleteCallbackSchema.parse` 400 **antes** de `lockForCompletion` → 2 de 3 desfechos terminais do harness rejeitados;
  `/complete` lê `bodyOrgId` sem `=== existing.organization_id` (`routes.ts:150-154`) e esse `organizationId`
  não-verificado é o escopo passado a `executeProposals`/`deliverToChannel` → **vetor de ação cross-tenant em GA**, não só
  mislabel de audit. — 1-3h/ea. `[xrepo]`
- **`no-appointments-read-endpoint`** `[carry, SHARPENED]` **(v: CONFIRMADO — ROUTES + PILOT)** — Não existe `GET
  /appointments` nem `/appointments/:id` em lugar nenhum: `grep app.get(...appointment` = **0**; as 6 paths YAML de
  appointment são todas POST/PATCH; calendar GET expõe só `/calendars` (`routes.ts:28`) + `/availability` (`:48`);
  staff-ops `read.routes.ts:22-97` = dashboard/executions/windows/dead-letters/audit. **A agenda é ilegível sobre REST p/
  TODO ator (Clerk E staff) — e não tem entrada no OpenAPI.** §10.1 não o enumera, mas persona mobile (PRD arch l.173) +
  §8.3 exigem. — Esforço: **4-6h** (rota+service+repo+yaml). `[xrepo: PRD §5.3/§8.3]`

### MÉDIO (degrada qualidade)

**Observabilidade — worker é buraco-negro (11 workers; harness inerte no piloto, exceto obs que o piloto exercita)**

- **`worker-process-telemetry-uninitialized`** `[carry, SHARPENED]` **(v: CONFIRMADO ×2 — PILOT + orquestrador; ALTO-
  operabilidade, exercitado-no-piloto)** — `src/queue/index.ts` (entry `node dist/queue/index.js`) **nunca** `import
  "./instrument.js"` nem `initTelemetry()` (ambos só em `src/index.ts:17,30`; grep em queue/ = 0). O worker importa
  `captureException` (`queue/index.ts:62`) mas `Sentry.init` vive em `src/instrument.ts:22` (só o HTTP entry importa) →
  `captureException` (`:272,313`) é drop silencioso; o OTel NodeSDK nunca inicia p/ os **11 `new Worker`**
  (`queue/index.ts:87,92,95,98,103,106,120,125,137,143,149`). **SHARPEN NOVO:** o handler `w.on("failed")` (`:267-269`)
  **nem tenta** `captureException` — só `log.error`; apenas `w.on("error")` (`:270-273`) chama, e esse é inerte. (Nota:
  o docstring do módulo `:6` diz "4 workers + 2 repeat jobs" — **stale/errado**, são 11.) — **1h** (import +
  `initTelemetry()`). **Alto valor / baixo esforço. #6.**
- **`metrics-public-org-id-enumeration`** `[carry]` **(v: CONFIRMADO ×2 — SEC + PILOT + orquestrador)** — `GET /metrics`
  (`health/routes.ts:24`) é in-app **não-autenticado** (sem preHandler; comentário `:22-23` admite só network-policy) e o
  counter `bevox_backend_http_requests_total` é rotulado com `organization_id` (`metrics.ts:31-33`), incrementado
  por-request com o UUID real (`bootstrap/server.ts:170`) → quem alcança `/metrics` enumera **todos os org-UUIDs +
  rota/status/volume por-org** (vazamento ADR-021) + blow-up de cardinalidade em GA. — Esforço: **1-2h** (guard
  staff/interno OU drop do label). `[g; ADR-021]`
- **`worker-has-no-healthz-readyz` + `worker-process-has-no-metrics-scrape-endpoint`** `[carry]` **(v: CONFIRMADO —
  PILOT)** — worker não sobe listener (`grep listen|fastify|renderMetrics queue/index.ts` = 0) → counters do worker
  (reconcile `:88,114,162,165`) **não-scrapáveis** **e** sem liveness/readiness → crash/stall do worker invisível. O
  piloto exercita o reconcile (passo webhook). — **2-3h**.
- **`domain-prometheus-metrics-not-registered` + `domain-metrics-declared-but-never-emitted`** `[carry]` **(v: PILOT)** —
  `shared/metrics.ts` não registra os de §12.10 l.1365 / §13.3 l.590 (`charges_succeeded_total`,
  `appointments_no_show_rate`, `executions_pending_approval_count/timeout_total/total`, `charges_total`,
  `queue_jobs_completed_total`, `buffer_windows_opened_total` — grep=0); `metrics.ts:41 queueSize` nunca `.set()` e `:52
  messagesReceivedTotal` nunca `.inc()` (e o piloto exercita ingestão). — **2-3h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` **(v: PILOT)** — `realtime/publish.ts:8-12` união fechada
  a `execution.*`/`waitlist.offered`; `appointment.created`(§8.3 l.870)/`charge.updated`(§8.4 l.879) **nunca** emitidos
  (`publishRealtime` em booking/payments = 0) → tela do profissional não auto-atualiza (SSE é são). — **2-3h**.
- **`metaapi-webhook-preauth-db-amplification`** `[carry]` **(v: CONFIRMADO — SEC + orquestrador)** — um envelope
  bem-formado (passa Zod `:130`) dispara `SELECT … channel_subscriptions` (`metaapi/routes.ts:140-144`) **+**
  `findSubscriptionById` (`:150` → 2ª query + `decrypt` AEAD em `repo.ts:41`) **antes** da validação HMAC (`:156-169`), e
  **sem rate-limit em rota nenhuma**. Flood não-autenticado → 2 queries + 1 decrypt/request (a query1→query2 é duplo-fetch
  redundante da mesma row). — **GA/DoS.** — Esforço: **~1h** (validar HMAC antes do decrypt, ou cachear o secret ativo).
  `[k]`
- **`message-content-table-untargetable`** `[NOVO]` **(v: SCHEMA; MÉDIO/LGPD)** — `message_records` (`ingestion.ts:32-56`)
  guarda PII de mensagem (`content_text` egresso ao LLM + `sender_snapshot_json` + `media_json`) mas **sem
  `organization_id`, sem `created_at` de inserção, sem `deleted_at`** — o único timestamp é o nullable provider
  `message_created_at` (`:43`). Consequência: conteúdo de mensagem não é DSR-targetável por org (só join via
  `conversation_key` text) nem envelhecível por cron keyed em tempo-de-inserção. Sharpening consolidado de
  "received_events + message_records" das passadas anteriores. — **GA/LGPD.** — Esforço: migration (M). `[g/schema]`

**Agenda — correção de dados quando exercitada (Marco-2; CONFIRMADOS por PILOT/SCHEMA)**

- **`appointment-transition-no-state-guard`** `[carry, SHARPENED]` **(v: PILOT)** — `booking.ts:445-450` UPDATE
  incondicional any→any (comentário `:435-438` admite; `prevStatus` `:443` gateia só o decremento). `cancelled→completed`
  decrementa pacote (`:485-499`). **SHARPEN NOVO:** `cancelled→confirmed` **ressuscita** um appointment liberado no seu
  `start_at` original **sem re-check de capacidade** → over-book silencioso além de `max_concurrent` se o slot foi
  re-bookado/waitlist-ofertado após o cancel. — **GA integridade.** — **2-3h** (matriz de transições legais).
- **`reschedule-non-atomic-double-book`** `[carry]` **(v: PILOT)** — `createAppointment` commita o NOVO em tx própria
  (`booking.ts:373-388`), DEPOIS uma tx **separada** (`:390-414`) cancela o ANTIGO → janela de double-count + crash entre
  commits deixa **ambos ativos permanentemente**. — **halfday** (dobrar numa tx só).
- **`appointment-mutations-no-auditevent` + `appointments-no-created-by-actor`** `[carry]` **(v: PILOT + SCHEMA)** —
  §12.8 l.1344 manda Appointment C/U/D → AuditEvent; `booking.ts:234-516` grava **zero** `audit_events`; e as colunas
  `created_by_type/created_by_id` (§8.3 step3 l.869) **não existem** (`calendar.ts` só tem `source`; grep `created_by
  src/ db/migrations/` = 0). Quem criou/mudou um booking é irrecuperável. — **halfday**.
- **`status-history-entity-absent`** `[carry]` **(v: SCHEMA)** — Módulo 16 l.584/588 + §8.3 step9 + §8.4 mandam
  `StatusHistory` p/ Appointment/Charge/Conversation; grep `status_history|StatusHistory` em `src/`+`db/schema/` = **0**.
  `AuditEvent` existe (`audit.ts:20`) mas é event-log, não histórico de transição por-entidade. (Nota: âncora anterior
  citava "§13.3"; o conteúdo canon está em **Módulo 16 — Audit**.) — **GA**. — **M**.
- **`reschedule-thin-idempotency`** `[carry, NARROWED]` **(v: PILOT)** — `booking.ts:387 idempotencyKey:undefined`.
  **NARROWING:** o PATCH usa `write` = `requireIdempotency()` (`routes.ts:24`), replay-cache HTTP completo
  (`idempotency.ts:87-132`) → retries de mesma-chave **são** deduplicados. Resíduo: (a) janela de falha-parcial (handler
  interrompido após commit do NOVO mas antes do onSend persistir → retry re-roda → órfão), e (b) o booking interno deixa
  `idempotency_key=NULL` → a rede do unique-index (`calendar.ts:163-172`) fica desengatada p/ reschedules. — **1h**.
- **`reschedule-drops-metadata` / `reschedule-self-overlap` / `reschedule-double-charge-on-prepaid`** `[carry]` — metadata
  não copiado (`booking.ts:373-388`); recount conta o appt antigo; double-charge em prepago (inerte, seed
  `requires_prepayment=false`). — 0,5-2h/ea.
- **`no-availability-422-collapsed-to-409`** `[carry]` **(v: ROUTES)** — §8.3 l.875-876 distingue 409 vs 422;
  `routes.ts:91-95` mapeia todo `slot_conflict`→409. **Não é drift OpenAPI** (yaml declara só 400/401/403/404/409 →
  código↔yaml concordam); é gap código↔**PRD** (PRD ganha, §2). — **quality**. — **S**.
- **`availability-n1-count-plus-92day-serial-loop`** `[carry]` **(v: PILOT — GA-scaling/DoS)** — COUNT(*) por-slot em
  loops aninhados (`availability.ts:167-171`); `routes.ts:52-67` itera `date_from..date_to` serial até 92 dias
  (`schemas.ts:28-29`). Auth-guardado, não rate-limited. Não pilot-blocking (1 prof). — **halfday**.

**Contrato backend↔harness / money (mismatches; INERTES no piloto manual, ALTO/MÉDIO-GA)**

- **`reconcile-refund-writes-phantom-updated_at-column`** `[carry, cron LIVE-wired]` **(v: CONFIRMADO — SEC)** —
  `reconcile.ts:255-257 UPDATE refunds SET … updated_at = now()`, mas `refunds` **não tem** `updated_at`
  (`payments.ts:149-172`) → **42703** → status nunca sai de `pending` → reconcile de refund **DOA**. O cron **É
  live-wired** (`queue/index.ts:149` + repeatable `:262`). O path vivo `updateRefundStatus` (`repository.ts:476-484`)
  **omite** `updated_at` → intacto; manual escreve `succeeded` direto (nunca `pending`) → cron nunca o seleciona →
  **pilot-inerte**. CI-invisível. **Fix = remover `updated_at=now()`.** — **0,25h**. `[xrepo: Stripe]`
- **`intent-reconcile-half-applies-paid`** `[carry, SHARPENED]` **(v: SEC)** — `reconcile.ts:143-150` seta só
  `status='paid'`+`updated_at` (charges TEM `updated_at`, sem 42703) **bypassando os 6 efeitos de `applyChargePaid`**: sem
  row `payments`, `paid_at` NULL, sem confirm de appointment, **sem grant de pacote**, sem audit → invisível às queries de
  posição ADR-018 §9. Branch **live** (Stripe-path, inerte no piloto). — **M** (rotear por `applyChargePaid`).
- **`requires-prepayment-hook-throws-manual-mode`** `[carry, de-claim parcial]` **(v: SEC)** — `booking.ts:275,299`
  hardcoda Stripe `createCharge`; conta manual (`external_account_id=NULL`) → `service.ts:193-197 lança`; caught
  (`booking.ts:315-338`) **e auditado como `charge.hook_failed` (`:330`)** → observável, não totalmente silencioso, mas
  booking retorna `booked` sem charge. Alcançável no piloto se algum serviço tiver `requires_prepayment=true`. —
  **2-3h**. `[xrepo: ADR-023 vs ADR-014]`
- **`dispatch-stream-field-absent` / `dispatch-default-model-asymmetry` / `completing-state-no-timeout-backstop` /
  `trace-content-dropped` / `stream-chunk-char-vs-byte`** `[carry, 1 NOVO LOW]` — harness gate exige `stream===true`;
  backend omite `stream` do schema → `/stream`+buffer Redis+SSE = código morto. `default_model` passa o harness
  (narrowed). `lockForCompletion` seta `completing` sem backstop. `/traces` dropa `content` mas `sendTrace` tem **0
  callers no harness** (doubly-inert). **NOVO:** `chunk: z.string().max(4096)` é cap de **caracteres**; canon/harness
  truncam em **bytes** (≤4KB) — sem overflow vivo (UTF-8 char ≤ byte), unidade diverge do contrato. — 0,25-2h/ea.
  `[xrepo]`

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real) — CONFIRMADOS pelo agente LGPD (0 refutações; 2 de-claims)**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry, SHARPENED]` **(v: CONFIRMADO — vetor vivo, headline LGPD)** —
  `ai_opt_out` só no CRUD de customers (`customers/repository.ts:21,26,67`; `default false`=opted-IN, `customers.ts:50`);
  `handleCutoff`→`buildDispatchMessages(conversationKey)` (`cutoff.ts:54`)→`orchestration/repository.ts:391-415`
  seleciona `content_text` cru por `conversation_key` **sem join de customer**; `dispatchExecution` nunca carrega
  customer. **Arquitetural:** dispatch é **conversation-keyed, nunca customer-keyed** → opt-out por-customer é
  **inaplicável** sem mudança de schema/flow; `ai_opt_out` é double-dead (1 writer staff-PATCH, 0 inbound-setters, 0
  dispatch-readers). — Esforço: **M** (link conversations.customer_id→customers + gate). **#10.**
- **`no-consent-capture-mechanism` + `intake-pii-ingested-pre-notice`** `[carry]` **(v: LGPD)** — `consent_granted_at`
  (`customers.ts:49`) tem **zero writers** (INSERT `:49-54` + PATCH_COLS `:61-68` o omitem). `intake.ts:66
  getSenderSnapshot`→`:82 resolveOrCreateCustomerChannel`→`channels/repository.ts:113-117` INSERT cego em `customers`
  (full_name=displayName) + customer_channels com telefone, **sem gate de consentimento e sem "aviso automático"** que
  _shared/ADR-019:33 item 6 exige p/ base de consentimento-implícito → PII ingerida **pré-aviso**. — **MÉDIO
  (pilot-live)**. — Esforço: **L**. `[xrepo: _shared/ADR-019]`
- **`received-events-and-message-records-un-erasable`** `[carry, SHARPENED + de-claim]` **(v: LGPD + SCHEMA)** —
  `received_events` (`ingestion.ts:12-30`) persiste **`payload_json` E `normalized_payload_json`** (envelope Meta cru:
  wa_id/telefone/nome/texto) com **zero `organization_id`/`customer_id`/`deleted_at`, sem FK**; `message_records`
  (`ingestion.ts:32-56`) sem `organization_id`/`customer_id` apesar de `content_text` + `sender_snapshot_json` +
  `media_json` → **5 cópias de PII inbound cruas não-apagáveis**; FK `received_event_id ON DELETE set null` → content
  extra-grudento. **DE-CLAIM honesto:** "sem âncora temporal" é overstatement — existe âncora **transitiva frágil** via
  `received_event_id → received_events.received_at` (nullable, set-null no purge do pai); só o `created_at` **direto** de
  servidor em `message_records` é genuinamente ausente. — Esforço: **L**. `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` **(v: CONFIRMADO — grep global = ZERO)** — grep `legal_basis|
  consent_event|dsr_request|retention|pseudonym|message_archive|content_redacted` em `src/ db/ scripts/` = **0**; os 11
  workers não purgam/pseudonimizam; `auth/repository.ts:99-100` **admite** "Hard-delete worker (canon ADR-020, ainda não
  landed)". Canon ADR-020:70 define `bevox.retention.worker` (cron 03:00 UTC) + `consent_events`/`dsr_requests`. —
  Esforço: **24-40h**. `[xrepo: _shared/ADR-020]`
- **`dsr-deletion-absent` + `dsr-export-incomplete-unrecorded-unreachable`** `[carry, de-claim + NOVO]` **(v: LGPD)** —
  nenhum endpoint de deleção de titular; `deleted_at`/`archived_at`/`consent_granted_at` = colunas triplo-mortas. DSR
  export EXISTE (`customers/routes.ts:97` scope `read`, `service.ts:97-110`) mas omite `preferences_json`/
  `risk_flags_json` + `messages`/`audit_events` hardcoded `[]` (TODO Marco-3 `service.ts:83,85`) + `customer_channels` +
  appointments + waitlist + payments + conversations + execution_traces; **não grava `audit_event` nem `dsr_requests`** →
  zero evidência art.37. **DE-CLAIM:** listar `consent_granted_at` entre "PII omitida" é imaterial (sempre NULL); perdas
  reais = `preferences_json`/`risk_flags_json`. **NOVO:** o export é `requireClerkAuth` RS256 (`routes.ts:31,97`) → o
  piloto (staff HS256) **não alcança** → capacidade DSR efetiva do piloto = **zero**. — Esforço: export **6-10h**;
  deleção **8-12h**; `dsr_requests` **S-M**. `[xrepo: _shared/ADR-020]`
- **Residue LGPD** `[carry, 1 SHARPENED, 1 NOVO]` **(v: CONFIRMADO)** — `clerk-organization-deleted-unhandled` (webhook só
  `user.*`; e received_events/message_records sem org FK → delete de org não os alcança); `execution-traces-pii` (raw sem
  customer_id, `harness-callbacks.repository.ts:187-208`; TEM org+created_at → ancorável, sem worker);
  `google-calendar-intl-transfer` (`sync.ts:203,237` empurra nome p/ US — gap art.33); `payments-raw-payload-json`
  (`repository.ts:430,438` 10yr fiscal → gap minimização); `customer-pii-mutations-unaudited` (`service.ts:29-39`);
  `denormalized-contact-snapshot` **SHARPENED → 2 tabelas** (appointments `calendar.ts:128-130` **+** waitlist_entries
  `:194-196`, onDelete set null → PII órfã; booking **ativamente escreve** `booking.ts:240-241`); **NOVO**
  `staff-pii-retention-gap` (`upsertUserFromClerk` persiste nome/email staff; ADR-020 sem row p/ staff_accounts). —
  2-4h/ea.

### BAIXO (higiene)

**Money / schema — misses de baixo risco**

- **`manual-charge-amount-unbounded-overflow-500`** `[carry, linha corrigida]` **(v: SEC; alcançável Clerk-user)** —
  `manual.ts:31 z.number().finite().positive()` (sem `.max`/`.multipleOf`); escreve `.toFixed(2)` em `amount_total
  numeric(10,2)` (`service.ts:377`); amount ≥ 1e8 → 22003 → **500 opaco**. Defeito idêntico no path Stripe
  (**`charge-intent.ts:48`** `Math.round(amountTotal*100)` — âncora `:106` **stale** + `service.ts:203`). — **trivial**
  (`.max(99_999_999.99).multipleOf(0.01)`).
- **`manual-charge-currency-unvalidated` / `manual-paid-refund-disjoint-lock-keys` / `service-packages-validity-days-
  numeric` / `buffer-windows-no-updated-at` / `payment-accounts-professional-no-uniqueness` / `received-events-no-org-
  column`** `[carry]` **(v: SEC + SCHEMA)** — `currency: z.string().default("BRL")` sem CHECK (inerte); lock-keys
  distintas `payments:manual-paid:<id>` vs `payments:manual-refund:<id>` (`service.ts:442` vs `:510`) não se excluem
  (correção vem dos guards DB, sublinha que o fix de #4 é rowcount-gate); `validity_days numeric` (`payments.ts:183`;
  0015 deixou este); `buffer_windows` muta sem `updated_at`; `payment_accounts.orgUniq` parcial `WHERE
  ='organization'` (`payments.ts:63-65`) → duplicatas `professional`-level; `received_events` sem `organization_id`. —
  S/ea.
- **`fk-columns-without-index` + `section-11-3-critical-indexes-partially-absent`** `[carry, CORRIGIDO P/ CIMA ≈55]` **(v:
  SCHEMA — recount honesto)** — ausentes `(org,status)` em appointments/charges/executions, `(org,start_at)`/
  `(org,customer_id)` em appointments, `(org,customer_id)` em charges (vs PRD §11.3 **l.1268-1274**; âncora "1270-1276"
  stale ~2 linhas; `conversations` TEM `(org,status)`+`(org,last_message_at)` → canon-satisfeita). **Recount honesto desta
  sessão: ~55 colunas `.references()` sem índice coberto — 18 `organization_id` completamente sem índice + ~37 não-org +
  ~6 borderline** (o "≥16/~40" das passadas anteriores foi subcontagem). Padrão sistêmico, inerte a 1 org. — **3-4h**
  (uma migration). `[a/schema]`
- **`adr-020-message-templates-and-adr-021-priority-score-unmaterialized`** `[carry]` **(v: SCHEMA — canon-reforçado)** —
  backend/ADR-020 (`aceita`) + ADR-021 (`aceita`) **não materializadas** (grep `message_template`/`urgency_level`/
  `skip_count` = 0 em todas as migrations). ADR-021 decide **"Adotar Opção C"** (l.49-51): `priority_score = MAX(0,
  age_hours + urgency_level×100 − skip_count×10)`, com `urgency_level INT CHECK 1..5`, `skip_count INT CHECK >=0`,
  `priority_score CHECK >=0`, recompute + cron `bevox.waitlist.priority_recompute`, e **"deprecate client input em V1
  (server ignores)"** — **ADR aceita-mas-não-materializada vinculante**, não estado-aceito-como-aceitável. — ADR-020
  **8h**; ADR-021 **6-10h**.
- **`waitlist-priority-score-client-settable`** `[carry]` **(v: SCHEMA + PILOT)** — `calendar.ts:204 numeric notNull
  default '0'`, **sem CHECK**, escrito do input na rota pública (`waitlist/routes.ts:71`), no PATCH (`repository.ts:361
  COALESCE`), no INSERT (`:278`) **e** no seam de IA (`seam-tool.ts:83`), e `match` ordena por ele (`match.ts:74-75`) →
  inverso direto de ADR-021 l.49-51 ("server ignores"). **NÃO re-inflar `conversations.priority_score`**
  (`conversations.ts:45`): **zero writers** → dormante/reservado. — **2h** (CHECK + drop de input) a **6-10h**
  (fórmula+cron). `[a/g; ADR-021]`

**Auth / harness / obs (resíduos — todos BAIXO/latente/inerte)**

- **`newOpaqueId-uuidv4-dormant-landmine` + `verifyStaffRefreshToken-dead-misleading`** `[carry + NOVO]` **(v: AUTH)** —
  `staff-auth.ts:139 newOpaqueId(): return randomUUID()` (UUIDv4) viola CLAUDE.md invariante #7; **zero callers**. **NOVO:**
  `staff-auth.ts:119-121 verifyStaffRefreshToken` tem **zero callers** (refresh vivo usa lookup-by-hash DB
  `service.ts:94-95`); docstring afirma "constante-equivalente" mas usa `===` plano. Ambos inertes mas são armadilhas
  exportadas. Deletar. — trivial.
- **`staff-role-stale-cache-at-login` / `bcrypt-72-byte` / `staff-session-no-logout` / `login-user-enumeration-timing` /
  `staff-refresh-no-reuse-detection` / `clerk-provisioned-role-hardcoded-operator` / `clerk-resolvelocaluser-fail-open` /
  `clerk-webhook-unknown-type-silent-200`** `[carry]` **(v: AUTH)** — cache-aside 300s cunha role no login
  (`service.ts:89`; refresh é DB-direct; `active` é fail-closed → só role é stale ≤5min); `password.max(512)` + bcrypt
  ignora >72B; sem logout/revoke; throw antes do bcrypt (`service.ts:68-71`) = enum-timing; rotação delete-então-emite sem
  reuse-detection; `ON CONFLICT` role 'operator' literal (`repository.ts:238`); `resolveLocalUser` fail-open; webhook sem
  `else` → 200 (svix-verified primeiro). — S/ea.

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; recount 103/106/80/95/0/0/11 exato)**

- **`openapi-drift-undocumented-handlers` (11 → 7 drift-real + 4 isentos)** `[carry]` **(v: ROUTES 11/11)** — **4
  documentados-isentos** por comentário (`yaml:2425-2430` google, `:2506-2511` stripe): `POST /webhooks/stripe`,
  `/webhooks/stripe/platform`, `POST /webhooks/google`, `GET /webhooks/google/callback`. **7 drift-real sem isenção**:
  `GET /customers/{id}/export` (`customers/routes.ts:97`), `GET`+`PATCH /autonomy` (`autonomy/routes.ts:18,23`), `GET
  /channel-connections` (`channels/routes.ts:13`), `GET`+`PATCH /payment-account/policy` (`payments/routes.ts:89,95`),
  `GET /api/v1/realtime` (`realtime/routes.ts:26`). **NOVO (hygiene):** o comentário de isenção Stripe nomeia só `/webhooks/
  stripe`, **não** `/webhooks/stripe/platform` (isento-por-inferência). — **2-3h**. **#9.**
- **`no-mechanical-route-zod-openapi-binding` + `openapi-check-is-not-a-validator`** `[carry, 148 parses]` **(v: ROUTES)**
  — ZERO rotas usam `schema:` do Fastify; sem `ZodTypeProvider`/`serializerCompiler`; **148** `.parse()`/`.safeParse()`
  inline em route files (era ~145); OpenAPI 100% YAML estático → razão estrutural do drift. `pnpm openapi:check`
  (`package.json:32`) é `openapi-typescript --output -` (**gerador de tipos**, não validador — sem spectral/redocly) →
  exit 0 só prova parse. — **M-ALTO** (binding) + **1h** (validador no CI).
- **`error-envelope-dual-schema` / `idempotency-key-param-self-inconsistency` / `status-callback-missing-dead_letter` /
  `enum-create-refund-missing` / `freeform-200-underspec-systemic` / `sse-bearer-only` / `checkout-3-way-divergence` /
  `rate-limit-429-undocumented` / `operationId:0`** `[carry, 1 linha corrigida]` **(v: ROUTES)** — `Error`(sem
  request_id, `yaml:104`) domina vs `ErrorEnvelope`(com, `:120/138`, só 7 refs payments) enquanto o handler **sempre**
  emite request_id (`error-handler.ts:55`); param `IdempotencyKey` diz "obrigatória em toda mutação" (`yaml:97-98`) mas
  em **32/52** ops mutantes; enum `status` `yaml:298` sem `dead_letter` (Zod `schema.ts:16`, branch vivo `routes.ts:75`);
  `ExecutionProposal.action` **`yaml:325-330`** (âncora 322-328 stale) omite `create-refund` (executado `seams.ts:172`,
  classificado `complete-service.ts:25`) — **`send-message` ESTÁ em ambos**, logo o único mismatch é `create-refund`;
  200 free-form `additionalProperties:true` (37 ocorrências) cobre staff-ops reads + transições + `/complete`; ambos SSE
  só `Authorization: Bearer` → `EventSource` do browser não autentica; `checkout` 3-way (`charge-intent.ts:87,109
  [pix,checkout]` vs `yaml:2602 [pix]` vs PRD `payment_link`); 429 não documentado. — 0,25-2h/ea.

**Schema — misses LOW/GA/latente**

- **`denormalized-appointment-pii-not-erasable` / `google-webhook-events-no-org` / `appointments-customer-package-id-
  unenforced-fk` / `staff-impersonations-unindexed` / `appointments-metadata-jsonb-pii-sink`** `[carry]` **(v: SCHEMA)** —
  snapshots PII em appointments+waitlist (set null só em customer_id); `google_calendar_webhook_events` sem org
  (`google.ts:109-129`); `appointments.customer_package_id` sem `.references()` (`calendar.ts:124`, ciclo de import
  deliberado); `staff_impersonations` sem índice (`staff.ts:29-40`); `appointments.metadata jsonb` sink de PII
  (`:142`, escrito `booking.ts:243`). — baixo/ea.
- **`schedule-appointment-queries-omit-org-predicate` + `professional-services-service_id-not-index-leading`** `[NOVO]`
  **(v: SCHEMA)** — `availability.ts:116,129` + `booking.ts:227-230` filtram só por `professional_id` (sem predicado
  `organization_id`, confiando no `members` list upstream) — não-exploitável hoje (professional_id é UUIDv7 org-scoped)
  mas viola "toda query org-scoped" como camada; `professional_services` só tem índice `(org,prof,service)` → o JOIN
  hot-path `WHERE ps.service_id=` (`availability.ts:87`) não é left-prefix. — S/ea.

**Governança / release / config (staleness — NÃO corrigida desde bootstrap 06-04)**

- **`version-drift-semver-image-missing-amendment`** `[carry]` **(v: orquestrador)** — tags só `v1.0.0`/`v1.0.1`;
  `merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; **22 commits** `v1.0.1..dbd231e` fora (incl. dispatch amendment);
  `release.yml` dispara só em `push tags: ["v*.*.*"]` (sem workflow_dispatch, sem provenance/sbom) → **nenhuma imagem
  (SemVer OU sha) pós-`v1.0.1`**. `describe` = `v1.0.1-35`. Versão diverge 4-way (`package.json 0.1.0` / `openapi` / tag
  `v1.0.1` / hub `vX.Y.Z`). — **0,5-1h** (cortar tag). `[xrepo: hub manifest fixa v1.0.1]`
- **`docs-stale-cluster`** `[carry]` **(v: orquestrador)** — `src/integration/resolve-organization-id.ts` **NÃO existe**
  (bridge colapsada SP-3; `global.d.ts:8`/`clerk-auth.ts:11`/`organization-scope.ts:6` confirmam) mas é citado como vivo
  em **6 lugares**: `README.md:84`, `backend-tenancy.md:28`, `backend-routes.md:34`, `PostToolUse-tenancy.sh:11`,
  `engineering-backend-architect.md:243`, `skills/bevox-backend-consumer/SKILL.md:95`; `CLAUDE.md §8 l.171` diz seed grava
  `PILOTSEEDONLYNOTASECRET` (real gera base32 + `assertMfaSecretNotPlaceholder` + blocklist `mfa.ts:36`; o sentinel só é
  **comentário** `mfa.ts:66`); `backend-harness-contract.md`/`backend-workers.md` dizem `dead_letter` via
  `worker.on('failed')` (**errado** — é via PATCH); `backend-db.md:31` diz `on delete restrict` (código+canon =
  **cascade**, §11.2 l.1203); `backend-tests.md` cita "5 falhas FK #36" (suíte passa 92/93). — 0,3-0,5h/ea.
- **`rule-backend-routes-staff-role-and-adr-miscite`** `[carry]` **(v: AUTH, canon-corroborado)** —
  `.claude/rules/backend-routes.md:24,33` declara staff roles `bevox_admin|support|observer (canon: ADR-022 staff RBAC)`
  + invoca `requireRole` inexistente: triple-errado (nomes curtos; staff RBAC = **backend/ADR-013**; backend/ADR-022 =
  `policy-json-sub-keys`). — **0,25h**.
- **`stray-gap-workflow-js-scratch-accumulation` / `codeql-upload-never-noop` / `release-no-provenance-sbom` /
  `adr-number-collision-cross-namespace`** `[carry]` **(v: orquestrador)** — **5** `.claude/state/gap*.js`
  (gap0704/0709/0714/0715/0717, gitignored — `git check-ignore` confirma) → **zero impacto em CI**; só `pnpm lint`
  **local** dá RED. **Esta sessão NÃO adicionou nenhum** (usou Agent tool, não Workflow). `codeql.yml:26 upload:never`;
  `release.yml` sem provenance/sbom; ADR 008-023 colidem backend/_shared. — 0,1-1h.

### INFO / conformidades verificadas / não-gaps (re-confirmadas de fonte-primária)

- **`legacy-lexicon-clean`** — grep `workspace_id|workspaces|account_id\b|accountId` em `src/`/`db/`: **232** hits,
  executável **ZERO** (composites + alias `AS account_id` + `res.accountId` Stripe + doc-comments + snapshots). Os 3
  "crus" (`autonomy/routes.ts:5`, `organizations/routes.ts:3`, `autonomy.ts:3`) são doc-comments do rename. Invariante
  §4.1 mantida.
- **`mfa-sentinel-correctly-inert`** — `seed-pilot.ts:153 generateMfaSecret()` base32 160-bit + `:154
  assertMfaSecretNotPlaceholder`; `mfa.ts:36` blocklist (o sentinel só como comentário `:66`); `auth/service.ts:84-87`
  sem MFA check (correto — TOTP é Marco-3). **NÃO implementar "rejeitar sentinel no login"** (travaria todo staff login).
  CLAUDE.md §8 stale (doc).
- **`mark-no-show-is-not-a-code-bug`** `[REFUTED, carry]` — OpenAPI serve `/appointments/{id}/no-show` (`yaml:2229`)
  casando `routes.ts:125-131`; só a prosa PRD §10.1 l.971 diz `mark-no-show`. **Não re-flagar.**
- **`booking-main-path-exactly-once-sound`** — advisory xact-lock + recount in-lock + unique index + replay 23505
  (`booking.ts:223-263`); POST honra `Idempotency-Key` (`routes.ts:88`). **Não flagar.**
- **`payments-conformances`** — PCI-nil (grep `card_number|cvv|cvc|pan`=**0**); decimal `numeric(10,2)`; webhooks
  dedupe-aware + org-scoped (cross-tenant paid-flip impossível `webhook-platform.ts:67-73`); over-refund replay-safe
  (`service.ts:515`); ambos webhook-secrets `requiredInProd`; `money-mutation-http-idempotency` by-design (`manual.ts:109`
  + `provider_payment_id=manual:<id>` + ON CONFLICT); `charge_type-drift` espelhado; clerk-webhook svix-verified.
- **`four-callbacks-token-gated`** — todos os 4 → 401 em token inválido (`execution-token.ts:65,69,94`). Coexiste com o
  token-IDOR (autenticidade ≠ autorização). `idempotency-on-callbacks` **REFUTED** (state-machine, `/complete`→409).
- **`dispatch-amendment-faithful-to-canon`** — `deadline_ms`/`original_execution_id`/`dead_letter` (`harness-dispatch.
  schema.ts:58,62` + `StatusCallbackSchema:16`) byte-faithful ao canon PRD §10.4 Am1 (aceito 06-03). **Não re-flagar.**
- **`hmac-verification-correct`** — metaapi (`timingSafeEqual`+±300s), Stripe `constructEvent`, Clerk svix, Google
  timing-safe — todos verificam assinatura (o gap metaapi é **ordem**: decrypt antes do HMAC, ver MÉDIO).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer`; `requireStaff({roles})`→403 (`:165-170`); observer excluído de actions (`actions.routes.ts:11`),
  incluído em reads (`read.routes.ts:19`); `TEST_AUTH_BYPASS` double-guarded (`env.ts:225-231`).
- **`schema-conformances`** — `ON DELETE cascade` p/ `organization_id` é **canon-correto** (§11.2 l.1203; `backend-db.md`
  "restrict" stale); timestamptz everywhere; CHECK (`end_at>start_at`, `sessions_remaining>=0`, `confidence∈[0,1]`);
  `ai_suggestions` dropada em 0005; sessions numeric→integer em 0015; ADR-022 policy-json materializada
  (`catalog.ts:110-113`); ADR-023 = 0016; `uuidv7-sql-default` pós-0000 ausente é **fail-CLOSED** (`$defaultFn` supre v7;
  default em 14 tabelas de 0000).
- **`delivery-tracker-10-delivered-1-parked`** — slot bevox-backend (origin/main, verbatim): 10 delivered (aisuggestion,
  staff-rbac, m4-chatwoot-p1..p4, m5-p4-manual-payment, m5-p3c-multimedia-consume ["5 LGPD prod gates pending"],
  m5-p3a-refundpolicy, m5-p3b-create-refund-seam) + `backend-psp-br-secondary` **parked** (Marco 6). **Nenhum work-item**
  p/ calendar/ADR-010 (`governed_by ADR-010` em zero work-items), customer-identity/ADR-009, templates/ADR-020,
  priority-score/ADR-021 → a grade CRÍTICA é **invisível ao tracker**.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros desbloqueiam o runtime do piloto +
1 dos 2 jobs de CI vermelhos**.

| # | Item | Esforço | Por quê |
|---|------|---------|---------|
| 1 | **Writer de `professional_schedules` (grade Seg-Sex) — rota/repo OU seed paliativo — + seedar Calendar default no `seed-pilot`** | **4-6h** (writer) ou **2-3h** (seed) | **CRÍTICO (app-wide)**: sem writer a grade é estruturalmente vazia (nem override `extra` resgata, nem módulo onboarding existe) → 100% `slot_conflict` (passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (slot `now()`-relativo) + fechar teardown `closeDb()/closeRedis()` (os 4× 57P01) | **0,5h** | Destrava o job `Tests` (§16.1; ci.yml roda integração sem continue-on-error) |
| 3 | **Provisionar principal Clerk do piloto** (usuário + org + JWT-template `organization_id`) OU rota calendar staff-scoped | **ops / 4-6h** | Sem isso o principal semeado (HS256) não autentica no calendar (RS256) → gate upstream dos 2 CRÍTICOs |
| 4 | **`pnpm audit`: `zod@^4.6.6` + bump OTel/fastify sob nota ADR-012 + `pnpm override` undici/tmp/vite/fast-uri/nanoid/brace-expansion; + re-enable scheduled CI** | **4-6h** | Destrava o job `Security` (**50 highs**, incl. o core de validação `zod`) e re-acende o scanner agendado (dark desde 09-22) — completa "CI verde" |
| 5 | **Unificar vocab de canal `wa↔whatsapp`/`ig↔instagram`** na fronteira de entrega + CHECK + backfill + teste e2e | **3-4h** | **Pilot-universal via staff-approve**: hoje **100%** das respostas de IA são dropadas em silêncio como `done` |
| 6 | **Inicializar telemetria no worker** (`import instrument`+`initTelemetry()` em `queue/index.ts`) + `/metrics`+`/healthz` no worker + `w.on('failed')` capturar | **1-2h** | Fecha o buraco-negro (Sentry/OTel/Prometheus) dos **11 workers** que o piloto roda |
| 7 | **Gatear `insertPayment`+side-effects no rows-affected de `markChargePaid`** | **~1h** | Fecha o bug HIGH de dinheiro **irreversível** (re-mark órfão) alcançável por Clerk-user no money-path manual |
| 8 | **Anexar `requireRateLimit` (já construído) a `/staff/sessions[/refresh]` + mutators de money + webhooks** + `.min(32)` no `STAFF_JWT_SECRET` | **~3,5h** | Fecha o buraco app-wide de rate-limit (brute-force de admin + DoS pré-HMAC) + o piso de entropia do plano staff |
| 9 | **`GET /appointments` (REST, Clerk + staff-ops)** + documentar os 7 handlers drift no OpenAPI + validador OpenAPI no CI | **4-6h** | "Ver agenda" não tem endpoint em plano nenhum (nem OpenAPI); fecha o drift silencioso categoria b |
| 10 | **Aplicar gate `ai_opt_out`/consent + aviso-automático no intake + `dsr_requests`** + hidratar DSR export (incl. `customer_channels`/`preferences_json`) + torná-lo alcançável pelo ator do piloto | **8-12h** | LGPD (piloto roda com PII real; flag arquiteturalmente ignorado, PII ingerida pré-aviso, 5 cópias não-apagáveis, DSR inacessível/não-auditado) |
| — | Higiene batch: vincular token de callback ao `:id` (IDOR status-agnóstico); `message_id`→`z.string().optional()` (fire-first poison); `buildDispatchMessages` LIMIT; HMAC-antes-do-decrypt; harness `status` POST→PATCH (cross-repo); StatusHistory + `created_by` + audit de appointment + matriz de transição (`cancelled→confirmed`); índices FK (~55, uma migration); versão/tag SemVer (22 commits); docs stale (incl. CLAUDE.md §8); `rm .claude/state/gap*.js`; `amount_total.max`+currency enum; deletar `newOpaqueId`/`verifyStaffRefreshToken` | **~20h** | Contrato harness + agenda-correção + perf GA + LGPD-audit + money-hardening + governança |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` @ `2979eb0`, frozen 06-03) — **`status`-callback POST vs PATCH 404 total** (root-cause
  único; backend canon-correto §10.4+ADR-019 Am1; fix harness→PATCH + errata canon l.447); `buildDispatchMessages` sem
  LIMIT → poison; `message_id` não-UUID → ZodError **pré-enqueue fire-first** em toda dispatch de IA; `aborted_*`→400 (bug
  harness), `strategy='failed'`→não-`error` (bug backend), skills-allowlist vazio, `stream`-field ausente + char-vs-byte,
  `default_model` sem validação (narrowed), `trace content` descartado (doubly-inert), token-IDOR (status-agnóstico),
  `active_execution_id`-wedge, `/complete` tenant não-verificado. Mitigante: harness **inerte** no piloto staff-manual.
- **bevox-meta-api** (`origin/main` @ `5516c2a`, frozen 06-22) — enum pleno `whatsapp`/`instagram` no fio
  (`messages/schemas.ts:7`) **confirmado** → `wa`/`ig` do backend causa o drop de outbound (pilot-universal); retries de
  webhook amplificam a perda de inbound (dedupe-strand + null-tenant one-time-500 + unknown-provider-silent-drop +
  audit-duplicado + pre-HMAC amplification).
- **Clerk** — `pilot-actor-cannot-authenticate-to-calendar` + `clerk-user-provisioning-broken`: o piloto precisa de um
  principal Clerk (usuário + org + JWT-template `organization_id`); o seed não provisiona. A DSR export também é
  Clerk-only → inacessível ao ator semeado.
- **Stripe** — Pix exige Connect KYC `active`; conciliação em **dois** endpoints (ambos `requiredInProd`); refund manual
  não passa por webhook; o reconcile de refund Stripe está **DOA (42703), cron-only mas LIVE-wired** (webhook vivo
  intacto); `intent-reconcile` half-applies paid. Escape do piloto: manual-mode (ADR-023 aceita). **MCP `stripe` requer
  auth interativa — indisponível nesta sessão headless** (reportado; não bloqueante p/ auditoria de código).
- **canon** — backend/ADR-020 (MessageTemplate), backend/ADR-021 (priority-score **Opção C vinculante**),
  backend/ADR-009 (identidade canônica) não-implementadas; _shared/ADR-019 (bases legais → gate consent + aviso +
  captura), _shared/ADR-020 (retenção → scoping de message_records/received_events, `created_at` de servidor, retention
  worker, DSR deletion + `dsr_requests`). Drifts "canon-atrás-do-código" (webhook §10.3, `/status` POST↔PATCH l.447,
  `create-refund`, `dead_letter` no enum) → errata/ADR superseding **no canon** (ADR-005), não fork local.
- **bevox-PRD-consolidation (hub infra, `origin/main` @ `fd1373b`)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest
  fixa `v1.0.1` (sem os 22 commits); runbook go-live invoca `seed-pilot` (que não cria grade, calendar, payment account
  nem principal Clerk); a network-policy do `/metrics` é o único controle do vazamento de org-UUID.
- **GitHub Actions** — scheduled Security/CodeQL em `startup_failure` desde **09-22** (~5 sem) → gate agendado dark;
  causa não-introspectável offline.
- **delivery-tracker (categoria h)** — 10 delivered + 1 parked; nenhum work-item p/ calendar/ADR-010 → os CRÍTICOs são
  invisíveis ao tracker. **Usar esta auditoria como o gate**, não o tracker.

## Delta vs auditoria anterior (2026-10-24)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-03/06-22; `git diff dbd231e..HEAD -- src/
db/` **vazio**; `HEAD` = o commit do próprio audit 10-24 (ontem).

**Ground-truth (mensurável) — 1ª passada com DELTA-ZERO nos três sinais de CI simultaneamente:**
- **`ci-security` RE-PLATÔ byte-idêntico:** **115 vulns / 10 low / 55 moderate / 50 high** hoje vs 10-24 (**115 /
  10-55-50**) → **delta ZERO**. Mesmo conjunto de 19 módulos-high, `zod@4.4.3` permanece. A quebra do 10-24 (49→50) durou
  **uma passada** e re-platôou — simétrico ao platô 10-22↔10-23. Tendência **12→15→18→49→49→49→50→50**.
- **`ci-tests`:** RED idêntico (mesmo flaky `booking_notice:259` ~09:02 UTC), mas **com 4× teardown 57P01** (vs 2× no
  10-24, 0 no 10-23, 1 no 10-22) — ruído de teardown testcontainers subiu.
- **`ci-scheduled-runs-dark`:** **inalterado** — dark desde 09-22 (último run real Security 09-21), 09-22→10-20.
- fast-gate GREEN idêntico (Typecheck/Format/OpenAPI-parse/Build/Unit **469/469, 69 files**).

**0 REFUTAÇÕES DE CÓDIGO (igual ao 10-24):** nenhum dos 7 agentes conseguiu refutar um achado de código esta passada
(tentativas adversariais explícitas em AUTH anchors 1/2/4, LGPD, money, harness — todas falharam na evidência de
schema). `mark-no-show` segue REFUTED; `conversations.priority_score` **não-inflado** (zero writers → dormante).

**~14 misses/sharpenings NOVOS (todos verificados de fonte-primária; 2 pelo orquestrador):**
1. `message-content-table-untargetable` (MÉD/LGPD; SCHEMA) — `message_records` org-less + insertion-timestamp-less +
   soft-delete-less simultaneamente.
2. `appointment-transition cancelled→confirmed resurrection over-book` (GA; PILOT) — ressuscita appt liberado sem re-check
   de capacidade.
3. `callback-token-IDOR status-agnóstico` (CRÍTICO-GA; L) — `resolveExecutionTokenAnyStatus` → qualquer token dead-letter
   qualquer execução.
4. `received_events` dupla cópia crua (`payload_json` + `normalized_payload_json`) → **5 cópias** de PII inbound (LGPD +
   SCHEMA).
5. `dsr-export-unreachable-at-pilot` (LGPD) — export RS256-Clerk-only → capacidade DSR efetiva do piloto = 0.
6. `verifyStaffRefreshToken-dead-misleading` (BAIXO; AUTH) — 0 callers, `===` não-constante, docstring mente.
7. `worker w.on('failed')` nem tenta `captureException` (sharpening de telemetry; PILOT).
8. `queue/index.ts` docstring "4 workers + 2 repeat jobs" é **stale** (são 11; PILOT).
9. `schedule/appointment queries omit org predicate` + `professional_services.service_id not index-leading` (LOW; SCHEMA).
10. `platform-webhook unnamed in exemption comment` (hygiene; ROUTES).
11. `impersonation` SHARPENED ×2 (staff-ops reads cross-org não-auditados; `org-scope:57` semanticamente errado; AUTH).
12. `stream-chunk char-vs-byte` (LOW; L).
13. `null-tenant` = one-time 500 + drop permanente + órfão received_events (sharpening; SEC).
14. `staff-pii-retention-gap` + `customer-pii-mutations-unaudited` reafirmados (LGPD).

**De-escalações honestas / NARROWs (NÃO re-inflar):**
- `message_records sem âncora temporal` **DE-CLAIM parcial** (LGPD): existe âncora **transitiva frágil** via
  `received_event_id → received_events.received_at`; só o `created_at` **direto** é ausente.
- `consent_granted_at` entre PII omitida do DSR export **DE-CLAIM** (imaterial, sempre NULL); perdas reais =
  `preferences_json`/`risk_flags_json`.
- `requires-prepayment-hook` **de-claim parcial** (auditado como `charge.hook_failed` — observável, não totalmente
  silencioso).
- `reschedule-thin-idempotency` **NARROWED** (PATCH usa replay-cache HTTP → retries de mesma-chave deduplicados; resíduo =
  janela de falha-parcial).
- `fk-without-index` **CORRIGIDO P/ CIMA ≈55** (era subcontagem "≥16/~40").
- Correções de linha: `charge-intent.ts:48` (não :106); `markChargePaidManually` `service.ts:422`; `ExecutionProposal.
  action` yaml `325-330` (não 322-328); `instrument.ts:22` (não :23); PRD §11.3 `l.1268-1274` (não 1270-1276);
  StatusHistory em "Módulo 16" (não §13.3); `148` parses (não ~145).

**Sobrevive (sem regressão):** os 2 CRÍTICO de agenda; o gate auth-actor; `outbound-provider-vocab` (HIGH pilot-universal
+ métrica-cega); `manual-remark orphan` (HIGH irreversível, reachability Clerk-user); `reconcile-refund-42703` (cron-only);
`callback-token-IDOR`; `rbac-org-role`; `clerk-provisioning`; os mismatches de `/complete` + o `status`-method 404 +
`active_execution_id` + `buildDispatchMessages`+`message_id`-poison; toda a bateria LGPD; autonomia/observabilidade;
priority-score/reminders/templates Marco-2/3; a staleness `.claude`/CLAUDE.md/README; version-drift (22 commits, nenhuma
imagem pós-`v1.0.1`); scheduled-CI-dark.

**Arco desde a passada mais antiga (06-02):** os **3 CRÍTICOs originais** (persistir telefone/`wa_id`; `seed-pilot`
executável em prod; testes de integração de booking) foram **fechados/recaracterizados**; os 2 CRÍTICOs atuais (grade +
calendar no seed) emergiram ~06-23 e **persistem há ~4 meses**; o gate auth-actor foi isolado no 07-20 e re-confirmado 8×.
**A frente de CRÍTICOs está estável e sem correção há ~4,7 meses; nesta passada a dívida de segurança do lockfile
re-platôou byte-idêntica (50 high) e o scanner agendado do GitHub segue dark há ~5 semanas — a 1ª passada em que os três
sinais de CI não se moveram.**

## Notas de método

**Orquestração.** **7 auditores de domínio em paralelo** (background, Agent tool — não Workflow), cada um instruído a
**re-verificar de fonte-primária** o inventário do 10-24 do seu domínio contra o **código atual** com evidência fresca
`file:linha`, a **REFUTAR** superestimações (com a lista explícita de refutados/de-escalados a NÃO re-flagar), e a caçar
misses. **5 usaram agent-types locais** deste repo (`.claude/agents/`): `harness-callback-auditor` (l),
`backend-staff-rbac-reviewer` (auth), `backend-schema-migration-engineer` (schema/índices/tracker h),
`backend-route-reviewer` (b), `Security Engineer` (payments j + channels k + auth-security); **2 general-purpose** (LGPD
g; calendar/pilot/obs a+m). **Resultado agregado: ~95 itens re-confirmados, 0 refutações de código, ~14 misses/sharpenings
NOVOS, 2 de-escalações honestas, ~7 correções de linha.**

**Verificação de fonte-primária independente pelo orquestrador** (fora do fan-out): freeze (`git diff dbd231e..HEAD --
src/ db/` = vazio; last-commit-touching src/ **e** db/ = `dbd231e` 06-03); origin/main dos 4 repos (backend dbd231e /
canon 7874971 / harness 2979eb0 / meta-api 5516c2a / hub fd1373b, inalterados); léxico legado (grep triado = 232
sancionados, zero executável; 3 crus = doc-comments); categoria c/j PCI-nil (grep `card_number|cvv|cvc|pan`=0); categoria
d (seed `generateMfaSecret` base32 + `assertMfaSecretNotPlaceholder` + blocklist; sentinel só comentário; CLAUDE.md §8
stale); categoria f (0 FIXME/HACK/XXX, 1 @deprecated, ~9 TODO Marco-2/3); version-drift (`merge-base --is-ancestor
dbd231e v1.0.1` = FALSE, 22 commits, describe `v1.0.1-35`); docs-stale (`resolve-organization-id.ts` ABSENT + 6 citações
vivas); delivery-tracker (10 delivered + 1 parked, lido verbatim de origin/main; `governed_by ADR-010` em zero
work-items); PRD §16.1 l.1483 CI-verde (lido de origin/main — o working tree da canon está numa feature branch);
ADR-statuses (010/014/018/019/023 aceita, 016 proposed, 011 superseded); CI workflow gates (ci.yml 4 jobs sem
continue-on-error + services pg16/redis7; security.yml osv + `pnpm audit --audit-level high` continue-on-error:false +
seg-cron; codeql.yml ter-cron + upload:never; release.yml `tags v*.*.*` sem provenance/sbom); worker count (**11** `new
Worker` + 0 telemetry-init em queue/); os 4 achados-manchete (prof_schedules writer=só test:120; seed-pilot 4 inserts;
requireRateLimit 0 callers; `message_id Uuid.optional()` vs `external_message_id`).

**Ground-truth de CI rodado de fato** (2026-10-25 ~09:00–09:05 UTC; logs em `/tmp/audit-1025/`): Typecheck ✓ / Format ✓ /
OpenAPI-parse ✓ / Build ✓ / Unit ✓ (**469/469, 69 files**) = **GREEN**; `test:integration` = **RED exit 1** (`1 failed |
92 passed (93)`, flaky `booking_notice:259` ~09:02 UTC < 13:00 + **4× teardown 57P01**); `pnpm audit --audit-level high` =
**RED exit 1, 115 vulns / 50 high** (10 low · 55 moderate · 50 high · 0 critical; 19 módulos; byte-idêntico ao 10-24);
`lint` = RED por artefato local (5 `.claude/state/gap*.js` gitignored → CI GREEN); `pnpm openapi:check` = exit 0 (mas é
parse-smoke, não validador). **Estado GitHub:** `gh run list --branch main` → scheduled runs em `startup_failure` (0s)
09-22→10-20 (último run real 09-21).

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005). Working tree numa feature branch
(`fix/a14-bevox-meta-api-ig-callback-spec`) mas **`origin/main` @ `7874971` (06-03)** — leu-se `origin/main` para
PRD/ADRs/delivery-tracker (o PRD do working tree difere de origin/main → **sempre** origin/main). Numeração de ADR
**colide** entre namespaces — sempre qualificada.

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem. (2) OSV Scanner /
CodeQL não reproduzíveis offline (config lida; estado GitHub lido via `gh`). (3) Caminho live (Stripe/Clerk/harness/Meta
reais) não exercitado — verdicts derivam de leitura de código + schema + canon `origin/main` + ausência comprovada de
writers/endpoints + CI rodado (incl. 14 suítes de integração live Postgres+Redis). (4) MCP `stripe` + `claude.ai Google
Drive` requerem auth interativa — **indisponíveis** nesta sessão headless (reportado; não bloqueante). (5) Esta passada é
re-verificação sobre código byte-idêntico ao do 10-24; o valor incremental é **CI fresco (delta-zero nos 3 sinais — 1ª
vez; Security re-platôou 115/50-high byte-idêntico; scheduled-dark inalterado) + 0 refutações de código + ~14 misses NOVOS
(2 pelo orquestrador) + 2 de-escalações honestas + ~7 correções de evidência/linha + o recount FK corrigido p/ cima
(~55)**, não descoberta de regressão.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-10-25. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
