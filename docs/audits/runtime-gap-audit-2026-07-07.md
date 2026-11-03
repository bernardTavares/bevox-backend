# Gap Analysis — bevox-backend — 2026-07-07

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o
> módulo segundo a documentação canônica (PRD V1 + ADRs **aceitas** lidas de `origin/main`), com foco no
> gate do **piloto** (1º cliente real: login → ver agenda → agendar → cobrar → webhook concilia) e no
> gate de **GA**. Método: Workflow multi-agente (opt-in "ultracode") — **29 agentes / ~1,24M tokens /
> 354 tool-uses / ~9,3 min / 0 erros / 0 resultados vazios**: 10 auditores de domínio (cada um
> re-verificando os achados do 07-05 contra o código **atual** com evidência fresca `file:linha` + caçando
> gaps novos + lendo canon de `origin/main`) → **verificação adversarial** por CRÍTICO/NOVO/alterado (17
> veredictos: 0 refutados, 4 rebaixados) → **crítico de completude** mapeando as categorias a–n da missão.
> **CI rodado de fato** (não inferido, 2026-07-07 09:0x UTC). Re-verificação manual independente dos
> achados-manchete pelo orquestrador. Sucede `runtime-gap-audit-2026-07-05.md`.

## Resumo executivo

O backend continua **maduro como fundação e a um passo curto do piloto, mas não pronto**. Fato estrutural
que domina esta passada: **código de produto, canon e os dois vizinhos estão TODOS congelados desde
06-04/06-03**. `git diff b61cf62..HEAD -- src/ db/` é **vazio** (HEAD é o próprio commit da auditoria
07-05); canon `origin/main` @ `7874971` (2026-06-03); `bevox-harness` `origin/main` @ `2979eb0` (06-03) e
`bevox-meta-api` `origin/main` @ `5516c2a` (06-22) inalterados. Logo esta é uma **re-verificação
independente + ground-truth de CI fresco + caça a gaps que as 4 passadas anteriores perderam** — não novos
gaps de código. A verificação adversarial **não refutou nenhum achado** (só 4 downgrades) — o inventário é
sólido, e agora conta **92 achados** (tally bruto dos agentes: 2 CRÍTICO · 4 ALTO · 28 MÉDIO · 45 BAIXO ·
13 INFO; após calibração este relatório aplica 4 downgrades adversariais e **eleva os 2 gates de "CI verde"
ao topo de ALTO**), dos quais **13 são NOVOS** (achados que 06-02/06-04/06-23/07-05 não isolaram).

**O piloto morre no passo 2/3 (`ver agenda` / `agendar`).** O CRÍTICO duro sobrevive verbatim e foi
re-confirmado por 3 vias (auditor de domínio + verificador adversarial + re-verificação manual):
**nenhum caminho de produção escreve `professional_schedules`** (a grade semanal-base) — o único `INSERT`
em `src/ scripts/ db/` é uma **fixture de teste** (`calendar-booking.test.ts:120`); produção só **lê**
(`availability.ts:116`) e `:126 if (!sched) continue` esvazia todo dia, forçando
`booking.ts:207 slot_conflict` em **100%** dos agendamentos. O corolário operacional — `seed-pilot.ts`
não cria **Calendar** nem **grade** (só org/staff/professional/service) — quebra o 1º elo (`ver agenda`)
com `notFound('Calendar')` antes mesmo da grade. **Fix mínimo ≈ 2-3h** (seedar Calendar + grade Seg-Sex +
`system_holidays` no `seed-pilot`).

**"CI verde" — o único critério mensurável de Marco-1 (§16.1) — está VERMELHO em 2 jobs** (ground-truth
rodado, não inferido, às 09:0x UTC): **Tests RED** (`test:integration` falha no flaky `booking_notice`
dependente de hora-do-dia + teardown 57P01; unit 469 ✓) e **Security RED** (`pnpm audit` = 12 high / 27
total, `continue-on-error:false`; ~7 highs são cadeia **prod-runtime** OTel/grpc/protobufjs). Lint & Format,
TypeScript e Build = **GREEN** num runner limpo. **Correção de método vs 07-05:** o `lint` deu RED **nesta
máquina** por um **artefato local diferente** do que o 07-05 supôs — não é mais a corrupção NUL de
`typescript.js` (a cópia resolvida `.pnpm/typescript@5.9.3` está **limpa** agora e `openapi:check`/`tsc`
passam), e sim um **arquivo de workflow perdido** `.claude/state/gap0704-workflow.js` (30 KB, sobra da
sessão 07-04) que o ESLint flat-config tenta parsear. Esse arquivo é **gitignored** (`.gitignore:57`) → um
checkout limpo de CI **não o vê** → **CI lint GREEN**. É artefato local, não regressão.

**Bloqueador de produto latente:** o mismatch de vocabulário de canal (`wa`/`ig` no inbound vs
`whatsapp`/`instagram` no outbound → resposta de IA descartada em silêncio) **sobrevive intacto
ponta-a-ponta** e é **CRÍTICO no instante em que a IA/outbound ligar**; calibrado **ALTO** só porque o
piloto escopado é **staff-manual** (`seed` não cria `autonomy_profile` → outbound nunca dispara). O
vizinho `bevox-meta-api` (frozen 06-22) usa vocab **pleno** no fio — confirma que `wa`/`ig` é invenção
100% backend-only.

**Delta principal (positivo, já FECHADO no 07-05 e re-confirmado):** a dependência cross-repo `dead_letter`
+ `deadline_ms`/`original_execution_id` está **exercitável ponta-a-ponta** (harness `bullmq-consumer.ts:155`
emite; backend `markExecutionDeadLetter` recebe). **Delta negativo (persiste):** os 2 mismatches que a
evolução do harness (07-04) expôs — `/complete(strategy='aborted_timeout'/'aborted_cost')` que o enum do
backend **rejeita (400)**, e `strategy='failed'` **não** mapeado para `status='error'` — seguem abertos
(harness `origin/main` ainda emite `aborted_*`). **Delta de cobertura (novo):** a categoria **h**
(delivery-tracker × código) era o único ângulo que nenhuma das 4 passadas reconciliou — feito agora: o
tracker marca **todo** work-item backend `delivered` enquanto a auditoria prova um defeito **pilot-blocking**
(e o item `m5-p3c` auto-declara "5 gates LGPD pendentes / não-ready-for-prod").

**Caminho de fechamento do piloto curto:** os 2 blockers funcionais bundlados (≈ 2-3h) + o gate de CI
(flaky + teardown + audit, ≈ 2,5h) somam **≈ 5-6h** para destravar o runtime do piloto + o critério "CI
verde". Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem (em particular o
vocab de canal vira CRÍTICO).

---

## Mapa de cobertura das categorias a–n (crítico de completude)

| # | Categoria | Cobertura | Achado-âncora |
|---|-----------|-----------|---------------|
| a | PRD-especificado-não-implementado | ✅ | `professional-schedules-no-writer` (CRÍTICO); waitlist/priority-score/buffer/fit-in (Marco-2) |
| b | OpenAPI vs rotas reais | ✅ | 7 handlers client-facing fora do YAML; 0 phantom; 0 `operationId` em 95 ops |
| c | Léxico legado | ✅ **CONFORME** (não-gap) | ponte `resolve-organization-id.ts` deletada; `workspace`=comentários; `account_id`=Stripe/canal legítimo |
| d | MFA sentinel `PILOTSEEDONLYNOTASECRET` | ✅ | login não rejeita = **correto** (Marco-3, password-only); só doc `CLAUDE.md §8` stale |
| e | Testes faltando (hot paths) | ✅ | availability(rota)/reschedule/webhook Stripe/inbox — zero integração |
| f | Bugs/dívida (TODO/FIXME/HACK) | ✅ | sweep: **0** FIXME/HACK/XXX; TODOs todos Marco-2/3 |
| g | LGPD (bases legais/retenção/DSR) | ✅ | `ai_opt_out` armazenado-não-aplicado; retenção/DSR ausentes; `message_records` sem org/customer scope |
| h | Marco-1 tracker × código | ✅ (reconciliado agora) | tracker "delivered" ≠ pilot-ready; capacidade de calendário **sem work-item**; `m5-p3c` 5 gates LGPD abertos |
| i | CI vermelho em main | ✅ (rodado) | Tests RED (flaky+teardown) + Security RED (12 high); lint-RED é artefato **local** |
| j | Charges + Connect Express (PCI) | ✅ | Checkout 501-stub; prepay-hook engolido; PCI-nil (sem PAN) — **conforme** |
| k | Channels (metaapi) | ✅ | vocab-drop outbound; `tenant_id=null` drop; `message.status_updated` sem handler |
| l | Harness dispatch (payload+4 callbacks+token) | ✅ | `aborted_*` 400; `failed`→`done` silencioso; 4 callbacks token-gated = **conforme** |
| m | Alçapões do piloto (login→agenda→paga) | ✅ (traçado ponta-a-ponta) | morre no passo 2/3; money-path só em modo manual |
| n | Delta vs audit anterior | ✅ | 07-05 (95) re-verificado; código frozen → maioria SURVIVES; 13 NOVOS; 3 CHANGED |

**Trilha do piloto (login → ver agenda → agendar → cobrar → webhook concilia):**

1. **LOGIN — PASSA (staff).** `seed-pilot` cria org + `bevox_admin` (hash de senha); login staff é
   password-only por design (Marco-1). *Ressalvas não-bloqueantes:* provisionamento Clerk de cliente-final
   quebrado (`findOrganizationByClerkOrg` compara clerk-org-id contra coluna `clerk_user_id`), então o
   piloto **precisa** usar a seed de staff; RBAC de org-role não-enforçado (qualquer papel faz qualquer
   mutação).
2. **VER AGENDA — BLOQUEIO DURO.** `seed-pilot` não cria Calendar nem `professional_schedules`;
   `availability.ts:116` lê a grade vazia; agenda vem vazia (e antes disso `notFound('Calendar')`).
3. **AGENDAR — BLOQUEADO a jusante do passo 2.** `booking.ts:104` existe, mas sem grade-base o motor não
   produz slot → `slot_conflict` sempre.
4. **COBRAR — PARCIAL.** Modo manual (`charges/manual` + `mark-paid`→`applyChargePaid`) funciona e concilia
   o ledger; Stripe Checkout/payment-link é **stub 501**; `createCharge` prepay-hook lança-e-engole em org
   manual-only. Drift de rota `POST /organizations/:id/charges` vs PRD §8.4 `POST /appointments/:id/charges`.
5. **WEBHOOK CONCILIA — FRACO.** Webhook Stripe sem teste de rota/assinatura (ponto de entrada de dinheiro);
   cron de reconcile faz `UPDATE charges … 'paid'` cru (sem `applyChargePaid` → sem row `payments`, sem
   appointment confirmado, sem grant). Em **modo manual** (sem Stripe) o `mark-paid` converge; para Stripe é
   **não-provado**.

---

## Achados por severidade

Legenda: `[carry]`/`[NOVO]`/`[CHANGED]`/`[Δsev]` = status vs 07-05; `(v: …)` = veredicto adversarial;
**(re-verificado)** = também confirmado manualmente pelo orquestrador; `[xrepo: …]` = dependência cruzada.
Calibração ancorada em PRD §16 (§16.1 Marco-1 = "CI verde" + auth/orgs/professionals/services/customers +
OpenAPI + contrato harness; §16.2 Marco-2 = calendar/channels/IA/autonomia/idempot./métricas; §16.3
Marco-3 = payments/LGPD/MFA/reminders/circuit-breaker). Itens §16.2/§16.3 são **deferimentos legítimos** —
só sobem quando o piloto os exercita (payments e PII **são** exercitados).

### CRÍTICO (bloqueia piloto)

- **`professional-schedules-no-writer`** `[carry]` **(re-verificado; v: confirmed, CRÍTICO)** — Nenhum
  caminho de produção escreve `professional_schedules` (a jornada semanal-base). Grep exaustivo em
  `src/ scripts/ db/`: único `INSERT` = fixture `test/integration/calendar-booking.test.ts:120`. Produção
  só lê (`availability.ts:116 SELECT … FROM professional_schedules WHERE professional_id=? AND
  day_of_week=?`) e `:126 if (!sched) continue;` (dia sem grade = dia vazio). `calendar/routes.ts:41` grava
  só `professional_schedule_overrides` (exceções), nunca a grade. `booking.ts:207 if (!slot) return
  slot_conflict`. `seed-pilot.ts` insere org(:109)/staff(:156)/professional(:195)/service(:217) e nada
  mais. Escopo Marco-1 explícito (canon `origin/main` PRD §5.3 l.379 `WeeklySchedule`, l.383 "motor de
  disponibilidade: grade fixa"; backend/ADR-010 aceita), **não** deferimento. — Impacto: `GET
  …/availability` devolve dias vazios e 100% dos agendamentos do piloto retornam `slot_conflict`; **sem
  workaround de produto**. — Esforço: **2h** (seedar grade Seg-Sex no `seed-pilot`) a **6-8h** (endpoint
  CRUD WeeklySchedule + OpenAPI + teste). **#1.** `[xrepo: nenhum]`

- **`seed-pilot-creates-no-calendar` (+ `-no-schedule` + `-omits-system-holidays`)** `[carry]`
  **(re-verificado; v: SURVIVES, verificador pontuou ALTO em isolado — mantido CRÍTICO como co-bloqueador do
  passo 2)** — `seed-pilot.ts` insere só org/staff/professional/service (`SeedPilotResult` :37-42 devolve 4
  IDs); zero `calendars`, zero `professional_schedules`, zero `system_holidays`.
  `availability.ts:71-75 … if (!cal) throw errors.notFound("Calendar", calendarId)` → o 1º elo de "ver
  agenda" quebra antes da grade. **NOVO sub-achado:** os feriados BR vivem só em `db/seed.ts:85-96`
  (BR_HOLIDAYS, seed de **dev** — org "Bevox Dev Org"), **não** no `seed-pilot`, deixando a org-piloto
  permissiva em feriado nacional (`availability.ts:108-111,136`). Fecham juntos com o writer. — Esforço:
  **1-2h** (ou incluído nas 2-3h do #1) `[xrepo: hub runbook go-live invoca seed-pilot]`

> **Nota de severidade (CI verde).** "CI verde" é o **único** critério mensurável de Marco-1 (§16.1) e está
> **RED em 2 jobs** — abaixo, no topo de ALTO, como gate. Não é bloqueio de *runtime* do piloto (o sistema
> deployado roda), mas **bloqueia o critério de conclusão de Marco-1** e alguns dos 12 highs são
> prod-runtime — por isso está no topo da lista de fechamento (#2 e #3).

### ALTO (bloqueia GA / gate de CI Marco-1; ou dispara no instante em que a IA ligar)

**Gate "CI verde" (§16.1 — rodado de fato 2026-07-07 09:0x UTC; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-teardown`** `[carry]` **(re-verificado — rodado)** — `pnpm
  test:integration` = **RED exit 1**, `1 failed | 92 passed (93)` · `1 file failed | 13 passed (14)`. Causa:
  `calendar-booking.test.ts` seta `booking_notice` e agenda "amanhã 10:00" esperando `slot_conflict`, mas o
  slot é interpretado na tz do calendar (`America/Sao_Paulo`) e o gate só dá `slot_conflict` se `now() >
  ~13:00 UTC`; rodei às **09:05 UTC** → retornou `booked` → assert falha. Soma-se o teardown **57P01**
  ("terminating connection due to administrator command" — a suíte não fecha `closeDb`/`closeRedis` no
  `afterAll`). As 13 outras suítes passam. Produção OK. — Impacto: mantém `Tests` RED (§16.1) e mascara
  regressões. — Esforço: **0,5h** (ancorar o slot a `now()`-relativo + `await closeDb()/closeRedis()`). **#2.**

- **`ci-security-red-pnpm-audit-12-high`** `[carry, estável]` **(re-verificado — rodado)** — `pnpm audit
  --audit-level high` = **RED exit 1, "27 vulnerabilities … 3 low | 12 moderate | 12 high"** — idêntico ao
  06-23/07-05. Highs prod-runtime: cadeia OTel/grpc (`@opentelemetry/auto-instrumentations-node`,
  `@opentelemetry/sdk-node`, `@opentelemetry/exporter-prometheus`, `@grpc/grpc-js`×2, `protobufjs`×2) +
  test-only (`undici`×3, `tmp`, `vite` via `testcontainers`/`vitest`). `security.yml:38-39` roda com
  `continue-on-error:false` → hard-fail. — Impacto: mantém `Security` RED (2º gate §16.1). — Esforço: **2h**
  (bump OTel ≥0.217 sob nota ADR-012 + `pnpm override` undici/tmp/vite). **#3.**

**Bloqueador de produto latente (CRÍTICO quando a IA/outbound ligar)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(re-verificado; v: confirmed ALTO)** —
  Inbound persiste provider **abreviado** `wa`/`ig` (`channels/metaapi/normalize.ts:35 if
  (messaging_product==='whatsapp') return 'wa'`, `:44 return 'ig'`; `routes.ts:246 upsertChannelConnection`
  → `channels/repository.ts:69` grava `channel_connections.provider='wa'`), mas o outbound só reconhece o
  **pleno**: `metaapi/repository.ts:197 provider = r.provider==='whatsapp'||'instagram' ? r.provider : null`
  → com `'wa'`, `null`. **`executions/seams.ts:360** if (!ctx||!ctx.provider||…)` → `:376
  skipped_missing_recipient` (audita `metaapi.send.skipped`, **não erro** → invisível a alertas). **Zero
  tradução `wa→whatsapp`** em `src/` (único mapeamento é `whatsapp→wa`). `channels.ts:22` é `text` sem
  CHECK. — Impacto: quando a IA ligar, 100% das respostas a conversas reais são computadas e **descartadas
  em silêncio** — mata o valor central do produto. **Calibração:** piloto staff-manual (`resolver.ts`
  default `manual_assisted`; `seed` não cria `autonomy_profile`) → outbound não dispara → ALTO agora,
  **CRÍTICO para GA de channels**. — Esforço: **4-8h** (unificar vocab num ponto canônico + CHECK + backfill
  + teste e2e inbound→outbound). **#4.** `[xrepo: bevox-meta-api usa whatsapp/instagram no fio —
  meta-client.ts:~525, frozen 06-22]`

**Auth / RBAC / provisionamento (pré-GA; mitigados no piloto de 1 org / 1 admin)**

- **`rbac-org-role-not-enforced`** `[carry]` **(re-verificado; v: confirmed)** — `requireRole` **não
  existe** (só 3 comentários TODO: `clerk-auth.ts:25`, `auth/repository.ts:261`, `types/global.d.ts:35`).
  `req.user.role` **é** resolvido (`clerk-auth.ts:109,183`) mas consumido por **zero** handler →
  `organizations/routes.ts:35 PATCH settings` monta só `[requireClerkAuth, requireOrganizationScope,
  requireIdempotency]` sem gate de papel. PRD §5.1 exige RBAC — **não** deferido (auth = Marco-1).
  **Armadilha:** `resolveLocalUser` é fail-open — precisa fail-closed quando `requireRole` entrar.
  Blast-radius baixo no piloto (1 org, 1 admin). — Esforço: **16h** `[xrepo: canon backend/ADR-013]`

- **`clerk-user-provisioning-broken`** `[carry]` **(re-verificado; v: confirmed)** —
  `auth/repository.ts:221-223 SELECT organization_id FROM users WHERE clerk_user_id = ${clerkOrgId}`
  (compara clerk-**org**-id contra coluna clerk-**user**-id — dimensões erradas); webhook trata só `user.*`
  (`auth/routes.ts:165,186`), sem branch `organization.created`; sem mapping clerk-org→bevox-org. PRD §8.5
  manda `organization.created → INSERT Organization + User(owner)`. Sem teste (consistente com quebrado).
  Mitigado no piloto (bootstrap via `seed-pilot`). — Esforço: **12h** `[xrepo: Clerk]`

**Agenda (Marco-2; corrompe dados quando exercitada)**

- **`waitlist-accept-books-wrong-time`** `[carry]` **(re-verificado)** — `waitlist/routes.ts:114-116` usa
  `full.offered_at` (instante da oferta, `service.ts:69`) como horário do appointment; o slot real
  (`slot_start_at`) vive só em `waitlist_match_outbox`. `auto_book` usa o slot correto (`service.ts:102`);
  só o endpoint HTTP `/accept` (modo `offer`) agenda no horário errado. — Impacto: double-book / horário
  fantasma quando waitlist é exercitada. Marco-2, fora do happy-path core. — Esforço: **3-6h** (persistir
  `slot_start_at` no entry na oferta + migration + teste).

### MÉDIO (degrada qualidade)

**Contrato backend↔harness (mismatches expostos pela evolução do harness — 07-04; persistem)**

- **`complete-callback-rejects-harness-abort-strategies`** `[carry]` **(re-verificado; v: confirmed)** — O
  enum `CompleteCallbackSchema.strategy` (`harness-callbacks.schema.ts:57-64`) **não** inclui
  `aborted_timeout`/`aborted_cost`, mas o harness (`origin/main` `errors.ts:7-8`, `execution-handler.ts`)
  emite exatamente esses no boundary terminal → `routes.ts:143 parse` → **ZodError → 400**. Aborts são
  terminais sem rethrow → sem retry BullMQ → sem fallback `dead_letter`; o `/complete` 400'd é engolido pelo
  `.catch`. Só o timeout-scan cron reconcilia para `timeout` genérico (perde strategy/usage). O canon PRD
  §10.4 **também** omite os `aborted_*` (o desvio é harness-side; o backend é canon-fiel). — Esforço: **4h**
  (decisão cross-repo). **#6.** `[xrepo: bevox-harness]`

- **`complete-failed-strategy-not-mapped-to-error`** `[carry]` **(re-verificado; v: confirmed)** —
  `strategy='failed'` no `/complete` **não** vira `executions.status='error'`: `complete-service.ts` o trata
  como `reply` (proposals vazio) → em `autonomous_supervised` cai em `deliverToChannel('')` no-op que
  **mantém `done`**; em manual/copilot vira `waiting_approval` com texto vazio. Contradiz backend/ADR-019
  Amendment 1 ("o error gravado por um `/complete(failed)` prévio"). — Impacto: execução genuinamente falha
  em modo autônomo é registrada como **`done`** (falha silenciosa). — Esforço: **3h**. **#6.**
  `[xrepo: bevox-harness]`

**Módulos órfãos / máquina de estados sem guard**

- **`conversations-inbox-module-absent`** `[carry]` — Módulo 7 (Conversas/Mensagens) tem tabela
  (`conversations.ts`) mas **zero rotas HTTP** de inbox. PRD §5.4/§10.1 especifica V1: `GET
  …/conversations`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages` (envio manual),
  `POST /conversations/:id/handoff` — nenhuma existe (grep só acha `/conversations/:id/executions` em
  staff-ops, cross-org). — Impacto: o profissional não lê a conversa, não responde manualmente nem faz
  handoff via API — relevante num piloto WhatsApp real (`manual_assisted` pressupõe humano no loop). —
  Esforço: **12-20h** `[xrepo: PRD §5.4/§10.1]`

- **`onboarding-advance-no-prereq-arbitrary-stage`** `[carry]` — `organizations/service.advanceOnboardingStage`
  repassa `stage` cru ao `repository.advanceOnboarding` (`UPDATE organizations SET onboarding_stage =
  <stage>`); `onboardingAdvanceSchema` aceita **qualquer** dos 11 valores → cliente pode `POST advance
  {stage:'copilot_active'}` pulando para autonomia. PRD §5.8 exige "não avança a services sem ≥1
  professional ativo" + checklist/next-action (ausente). — Impacto: máquina de estados sem guards;
  auto-promoção arbitrária. — Esforço: **6-8h** `[xrepo: PRD §5.8]`

**Pagamentos / reconciliação (o resíduo real do "webhook concilia")**

- **`reconcile-cron-flips-paid-without-orchestration`** `[CHANGED — evidência fresca confirma]` **(v:
  confirmed)** — `reconcile.ts:143-150` faz `UPDATE charges SET status='paid' … WHERE id=${row.id}` cru,
  **sem** `applyChargePaid` (`service.ts:876-925`: markChargePaid → insertPayment →
  confirmAppointmentIfUnconfirmed → audit → grantCustomerPackage). — Impacto: charge reconciliada por cron
  (o cenário exato que o cron existe para corrigir) fica `paid` **sem** row em `payments`, sem appointment
  confirmado, sem grant, sem audit → estado divergente webhook↔cron. — Esforço: **3-4h**. **#5.**

- **`reconcile-cron-skips-refunded-and-grant-on-cancel`** `[CHANGED — fresh]` **(v: confirmed)** —
  `reconcile.ts:254-259 (reconcileStuckRefunds)` faz `UPDATE refunds … status` cru, sem `applyChargeRefunded`
  (`service.ts:943-981`, a única fn que reverte grant / transiciona charge→refunded). — Esforço: **2-3h**.

- **`stripe-webhook-zero-integration-tests`** `[carry]` **(v: confirmed)** — grep `constructEvent` em `test/`
  = **vazio**; nenhum teste bate na rota `/webhooks/stripe` nem `/platform` (só a **sequência** de
  `applyChargePaid` é testada com repo mockado). Ponto de entrada de dinheiro sem cobertura de
  rota/assinatura/dedupe. — Esforço: **5h** (`stripe.webhooks.generateTestHeaderString`). **#8.**
  `[xrepo: Stripe]`

- **`pix-reconcile-split-2-endpoints-undocumented`** `[carry, Δsev de 07-05 = MÉDIO]` — `webhook.ts` trata
  só `account.updated`; `payment_intent.*`/`refund.*` vivem em `webhook-platform.ts` (endpoint
  `/webhooks/stripe/platform`, secret `STRIPE_WEBHOOK_SECRET_PLATFORM`); **backend/ADR-014 descreve UM
  endpoint**. Manchete "pending para sempre" **refutada** (07-05): cron existe e o secret é `requiredInProd`
  (`env.ts:203`). Resíduo: split não-documentado (endpoint+secret extra sem ADR superseding). — Esforço:
  **2-3h** (nota/ADR + startup-assert). `[xrepo: Stripe]`

**LGPD (Marco-3 §16.3, mas o piloto roda com PII real)**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` **(re-verificado)** — `customers.ai_opt_out` é
  gravado/lido no CRUD (`schemas.ts:37`, `repository.ts:21,26,67`) mas **nunca** consultado no pipeline:
  `cutoff.ts` resolve modo + monta mensagens + despacha ao harness **sem** carregar o customer nem checar
  `ai_opt_out`. — Impacto: cliente que revoga consentimento de IA ainda tem a conversa mandada ao LLM
  (transferência internacional, _shared/ADR-019 item 7). Vetor existe no piloto. — Esforço: **3-5h**. **#10.**

- **`message-records-not-customer-org-scoped-blocks-dsr`** `[carry]` — `message_records` (PII de conversa +
  agora media) só tem `conversation_key`, sem `organization_id`/`customer_id` (`ingestion.ts:32-56`) →
  bloqueia DSR export/deleção reais por titular. — Esforço: **6-10h** `[xrepo: _shared/ADR-020]`

- **`retention-worker-adr020-absent`** `[carry]` — nenhuma fila/worker de retenção; sem
  `consent_events`/`dsr_requests`; `consent_granted_at`/`deleted_at`/`archived_at` declarados nunca escritos;
  PII acumula sem TTL (_shared/ADR-020). — Esforço: **20-40h** `[xrepo: _shared/ADR-020]`

- **`no-dsr-deletion-endpoint`** `[carry]` — nenhum `app.delete` em `customers/` (PRD §12.9). — Esforço:
  **4-6h** `[xrepo: _shared/ADR-020]`

- **`multimedia-inbound-pii-persisted-canon-not-ready-for-prod`** `[NOVO]` **(v: MÉDIO→BAIXO; listado aqui
  pela relevância LGPD)** — `channels/metaapi/inbound-dispatch.ts:125-148` extrai `{media_key, mime_type,
  filename, caption}` (caption = dado pessoal, `:142`); `routes.ts:263 mediaJson: media` persiste em
  `message_records` (sem org/customer id). Canon `origin/main` MA-014 §89-113 declara **5 gates LGPD
  ABERTOS** ("não ready-for-prod até fechados": RoPa media, parecer DPO art.11, residência BR do bucket,
  DSR erasure cascade, TTL pre-signed) — o work-item `m5-p3c` do tracker **auto-declara isso**. Piloto
  WA-only pode receber media. — Esforço: **8-16h backend** (escopar `media_json` por org/customer + erasure)
  + gates humanos DPO fora do repo. `[xrepo: bevox-meta-api MA-014 + DPO]`

**Autonomia / observabilidade (harness inerte em prod; blindado do piloto staff-manual — exceto métricas)**

- **`domain-prometheus-metrics-not-registered`** `[carry]` — `shared/metrics.ts` não registra os 4 exigidos
  por PRD §12.10 (`charges_succeeded_total`, `appointments_no_show_rate`, `executions_pending_approval_count`,
  `executions_timeout_total`); grep = 0. `charges_succeeded_total` é relevante ao piloto. — Esforço: **4h**.
- **`autonomy-action-granularity-not-enforced`** `[carry]` — `resolver.ts` gateia só por `current_mode`;
  `allowed_actions_json`/`required_approvals_json`/`confidence_thresholds_json` + `PolicyEvaluator`
  (`seams.ts`) com zero callers. ADR-022 (policy-json) cobre reminder/fit_in/waitlist/handoff, **não** os
  JSONBs de `autonomy_profiles`. Inerte no piloto. — Esforço: **8h** `[xrepo: PRD §5.5 + harness]`
- **`sse-appointment-charge-events-never-published`** `[carry]` — `realtime/publish.ts` só publica
  `execution.*`/`waitlist.offered`; `appointment.created/updated` (§8.3) e `charge.updated` (§8.4/§10.1)
  **nunca** emitidos → a tela do profissional não auto-atualiza no agendar/pagar do piloto. — Esforço: **5h**.
- **`rate-limit-§12.6-zero-routes-applied`** `[carry]` — plugin registrado, `requireRateLimit()` exposto,
  **nenhuma rota** o aplica (código morto; caps §12.6 não enforçados). — Esforço: **3h**.
- **`circuit-breaker-opossum-absent`** `[carry]` — `stripe-client.ts` sem timeout/`maxNetworkRetries`/breaker;
  grep `opossum`=0. PRD §7.5/§12.7. Deferimento Marco-3; Stripe **é** exercitado no piloto. — Esforço: **5h**
  (dep `opossum` dispara gate §6).
- **`autonomy-patch-nontransactional-mode-audit`** `[carry]` — UPDATE + INSERT audit em 2 chamadas
  não-transacionais (modo muda sem AuditEvent se a 2ª falha) + lost-update dos JSONBs. — Esforço: **2h**.
- **`autonomy-readiness-score-never-computed`** `[carry]` — `readiness_score` lido/retornado, nunca
  computado (`GET /autonomy` sempre `null`). — Esforço: **3h**.

**Schema / completude PRD (deferimentos Marco-2/3 explícitos §16)**

- **`module-14-reminders-absent`** `[carry]` — `reminder_policy_json` existe (`tenancy.ts:47`); ausentes =
  `appointments.reminder_sent_at` + fila `bevox.reminders` + worker (PRD §14). — Esforço: **16h**.
- **`message-template-entity-adr020-unimplemented`** `[carry]` — backend/ADR-020 (aceita) `message_templates`
  sem tabela/módulo; FK-alvo de `reminder_policy_json.message_template_id`. ADR aceita não-implementada. —
  Esforço: **8h** `[xrepo: canon backend/ADR-020]`
- **`modules-10-11-faq-rules-absent`** `[carry]` — sem tabelas `faq_items`/`operational_rules` nem módulos
  (PRD §10/§11; extensões `pg_trgm`/`pgvector`). — Esforço: **24h**.
- **`section-11-1-entities-absent`** `[carry]` — StatusHistory / OperationalMetricSnapshot /
  KnowledgeInterview / HandoffEvent / ConversationAssignment ausentes. PRD §11.1. — Esforço: ~4-8h/ea.
- **`adr-021-priority-score-not-implemented`** `[carry]` — backend/ADR-021 (aceita, vinculante) manda
  `priority_score` system-derived `MAX(0, age_hours + urgency_level×100 − skip_count×10)` + cron; código
  aceita input do cliente verbatim (`waitlist/routes.ts:30,36`), sem colunas `urgency_level`/`skip_count`/
  `last_score_update`, sem CHECK≥0, sem compute. Vetor "cliente infla própria prioridade" aberto. Marco-2. —
  Esforço: **8-12h** `[xrepo: canon backend/ADR-021]`
- **`buffer-before-after-minutes-dead-columns`** `[carry]` — `catalog.ts:62-63` declara buffer;
  `availability.ts`/`booking.ts` ignoram (§5.3). — Esforço: **3-4h**.

**Governança / release**

- **`version-drift-semver-image-missing-amendment`** `[carry, Δsev = MÉDIO]` **(re-verificado)** — PR #39
  (dispatch-amendment, `dbd231e`, **aceita** no canon) está em HEAD mas **não** em `v1.0.1`
  (`git merge-base --is-ancestor dbd231e v1.0.1` = **FALSE**; HEAD 26 commits à frente); `release.yml`
  builda imagem SemVer só em tags `v*.*.*` → o contrato **aceito** não está em nenhuma imagem SemVer.
  Desinflado: `package.json` sempre foi `0.1.0` (não rastreia release) e `release.yml` emite `type=sha`
  (deploy por digest de HEAD possível). — Esforço: **1-2h** (bump coerente + tag SemVer capturando #39).
  **#7.** `[xrepo: hub manifest/digest]`

### BAIXO (higiene)

**NOVOS (achados que as 4 passadas anteriores perderam)**

- **`newopaqueid-uuidv4-landmine`** `[NOVO]` **(v: confirmed)** — `staff-auth.ts:139-141 export function
  newOpaqueId(): string { return randomUUID(); }` (import nomeado `randomUUID` em `:22`) — **UUIDv4**,
  viola invariante §4.7. É **dead code** (zero callers em `src/`/`test/`), mas a conformidade
  `uuidv7-single-source-clean` das 4 passadas usou grep `crypto.randomUUID|uuidv4|gen_random_uuid` que **não
  pega o import nomeado** `randomUUID()`. — Esforço: **0,3h** (trocar por `uuidv7()` ou remover). 
- **`dedupe-key-stranded-on-persist-failure-drops-inbound-event`** `[NOVO]` **(v: MÉDIO→BAIXO)** — em
  `channels/metaapi/routes.ts:174`, o dedupe key Redis é setado `SETNX EX 24h` **antes** de qualquer
  persist; os `INSERT` de `received_events` (:202-212) e `audit_events` (:215-227) **não** têm try/catch
  (só o dispatch posterior faz `DEL` no `.catch`). Uma falha transiente de DB entre :179 e :234 lança 5xx
  com a key ainda setada → o retry do Meta cai em `:175 isNew===null` → `'replayed'` 200 → evento
  **perdido**. — Esforço: **1-2h** (envolver persist em try/catch com DEL da key na falha). 
- **`idempotency-no-atomic-reservation-concurrent-double-execute`** `[NOVO]` **(v: confirmed, impacto
  atenuado)** — `plugins/idempotency.ts:87 redis.get(redisKey)` é read puro; o `SET` só ocorre no `onSend`
  (`:122`); sem `SET NX` de reserva entre GET e execução → dois requests simultâneos com a mesma key **ambos
  executam** o handler. — Esforço: **3h** (reserva atômica `SET NX` + estado pending). 
- **`dsr-export-incomplete-omits-customer-preferences-json`** `[NOVO]` — `customers/service.ts:97-110`
  exporta `CustomerRow` cujas `COLS` (`repository.ts:25-26`) **omitem** `preferences_json`, `risk_flags_json`
  e `consent_granted_at` (`customers.ts:45,48,49`) — todos dado pessoal já queryável hoje. As 4 passadas só
  flagaram `messages`/`audit_events` vazios. — Esforço: **1-2h** (incluir no dump do próprio customer).
- **`customer-id-relationship-index-missing-11-3`** `[NOVO]` — PRD §11.3 exige `(organization_id,
  customer_id)`; `appointments.customer_id` (`calendar.ts:121`), `charges.customer_id` (`payments.ts:77`),
  `conversations.customer_id` (`conversations.ts:28`) — FKs **sem** índice (só `customer_packages` cumpre).
  Viola também `backend-db.md` "toda FK tem index". — Esforço: **1-2h**.
- **`openapi-missing-operationid`** `[NOVO]` — `grep -c operationId openapi/…yaml`=**0** em **95** operações
  → `openapi-typescript` gera `operations = Record<string, never>` (codegen de cliente tipado degradado). —
  Esforço: **2-3h**.
- **`stray-gap0704-workflow-js-local-lint-red`** `[NOVO]` **(re-verificado)** — `.claude/state/gap0704-
  workflow.js` (30 KB, sobra da sessão 07-04) faz `pnpm lint` dar **RED local** (ESLint flat-config parseia
  `.js`, top-level `return`). **Gitignored** (`.gitignore:57`; `git ls-files .claude/state/` = só `.gitkeep`)
  → **CI não afetado** (lint GREEN num checkout limpo). Secundário: `eslint.config.js:7-13` (`ignores`) não
  lista `.claude/`. **Corrige a atribuição do 07-05** (a corrupção NUL de `typescript.js` está moot: a cópia
  `.pnpm/typescript@5.9.3` está limpa; só a cópia hoisted `node_modules/typescript` tem NUL e nada a
  resolve). — Esforço: **0,2h** (remover o arquivo + adicionar `.claude/**` ao `ignores`).
- **`seed-pilot-omits-system-holidays`** `[NOVO]` — ver co-bloqueador CRÍTICO acima (feriados BR só na seed
  de dev). — Esforço: **0,5-1h**.

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static'; 80 paths / 95 ops; 0 phantom)**

- **`openapi-drift-client-facing-handlers`** `[carry]` **(v: confirmed)** — 7 handlers client-facing fora do
  YAML: `GET/PATCH /autonomy`, `GET /channel-connections`, `GET /customers/:id/export` (DSR — PRD §12.9/§16.1),
  `GET/PATCH /payment-account/policy`, `GET /api/v1/realtime` (SSE). — Esforço: **2-3h**. **#9.**
- **`openapi-status-callback-missing-dead-letter`** `[carry]` — YAML status enum `[running,paused,cancelled]`
  sem `dead_letter` (código+canon+harness já têm). — Esforço: **0,25h**. **#9.**
- **`openapi-enum-drift-proposal-and-payment-method`** `[carry]` — `ExecutionProposal.action` omite
  `create-refund` (vivo) e inclui `waitlist-add` (não-canon); `payment_method` sem `checkout`. — Esforço:
  **0,5h**.
- **`sse-client-endpoint-drift-and-header-auth`** `[carry]` — `GET /api/v1/realtime` (`realtime/routes.ts`)
  diverge do canon §10.1 (`/api/v1/realtime/events?token=`) e usa header-auth que `EventSource` de browser
  **não** seta → inconsumível pelo bevox-client. — Esforço: **3h**.
- **`openapi-no-route-contract-test`** `[carry]` — sem `printRoutes()×YAML`; causa-raiz do drift invisível.
  — Esforço: **3-4h**. **#9.**
- **`charge-route-path-pix-vs-prd`** `[carry]` — `POST /organizations/:id/charges` vs PRD §5.6/§8.4
  `POST /appointments/:id/charges` (equivalente; `appointment_id` no body). — Esforço: **1h**.

**Canais / harness (deferimentos V1 / cross-repo)**

- **`tenant-id-null-silent-drop`** `[carry]` — evento inbound `tenant_id=null` aceito/persistido mas nunca
  despachado. — Esforço: **2h**.
- **`non-message-events-no-handler`** `[carry]` — backend assina 5 tipos mas só trata `message.received`;
  `message.status_updated` (confirmação de entrega) sem handler. — Esforço: **4-6h** `[xrepo]`.
- **`vocab-mismatch-masked-by-test-seeding`** `[carry]` — nenhum teste flui inbound-`wa`→outbound; testes de
  outbound semeiam `whatsapp` à mão → o join que null-ifica `wa` nunca é exercitado. — Esforço: **3h**.
- **`ig-outbound-missing-recipient`** / **`hmac-subscription-active-limit1`** `[carry]` — deferimentos V1. —
  1-3h.

**Pagamentos / agenda (resíduos)**

- **`mark-paid-no-http-route-test`** `[CHANGED — Δ do 07-05]` **(v: confirmed)** — **correção:** o service
  `markChargePaidManually` **é** testado (`payments-manual-mode.test.ts:367 expect(res.status).toBe('paid')`
  + asserts DB); o resíduo real é só o teste de **rota** (`POST …/mark-paid` via `app.inject`) ausente. —
  Esforço: **1h**.
- **`requires-prepayment-hook-fails-for-manual-only-pilot-org`** `[carry]` — `booking.ts createCharge` lança
  "payment account not active" em org manual-mode; mitigado (hook best-effort não-fatal + service seedado
  `requires_prepayment=false`). — Esforço: **2h** `[xrepo: ADR-023 vs ADR-014]`.
- **`payment-link-checkout-stub`** `[carry]` — Checkout/payment-link (método V1 ADR-014) é stub 501
  (`checkout.ts`); piloto coberto por Pix+manual. — Esforço: **8-16h** `[xrepo: ADR-014]`.
- **`availability-http-endpoint-zero-integration-coverage`** / **`reschedule-transition-zero-integration-
  coverage`** `[carry]` — hot-path do piloto sem teste e2e (o vácuo que deixou o CRÍTICO #1 passar). —
  Esforço: **3h** + **5h**. **#8.**
- **`fit-in-encaixe-ausente`** / **`waitlist-match-utc-vs-calendar-tz`** / **`manual-booking-created-by-
  drift`** / **`calendar-crud-incompleto`** / **`adr-021-waitlist-priority-columns-absent`** `[carry]` —
  deferimentos Marco-2 / dívida documentada. — 2-8h/ea.

**Observabilidade / idempotency (resíduos)**

- **`metrics-endpoint-unauthenticated`** / **`http-metrics-route-label-unbounded-on-404`** /
  **`idempotency-key-not-scoped-to-route-actor-org`** / **`idempotency-ttl-no-per-route-override`** /
  **`escalation-request-human-no-sse`** `[carry]` — mitigados por network-policy do hub / caps default. —
  1-2h/ea.

**Config `.claude/` + CLAUDE.md (staleness — NÃO corrigida desde o bootstrap de 06-04)**

- **`rules-dead-letter-writer-mechanism-wrong`** `[carry]` — `backend-harness-contract.md:46` +
  `backend-workers.md:20` dizem `dead_letter` via `worker.on('failed')` — **inexistente**; é via callback
  `PATCH /status` (`harness-callbacks.repository.ts:86-120`; backend é producer-only). Também: os 4 callbacks
  vivem em `src/integration/harness-callbacks.routes.ts`, não em `modules/executions/routes.ts` como as
  rules dizem. — Esforço: **0,3h**.
- **`claude-config-stale-deleted-bridge-and-closed-issue36`** `[carry]` — `backend-tenancy.md` + `README.md`
  citam `src/integration/resolve-organization-id.ts` que **não existe** (colapsado); `backend-tests.md`
  cita "5 falhas FK #36" — a suíte passa (issue fechada). — Esforço: **0,5h**.
- **`claude-md-section8-mfa-sentinel-doc-stale`** `[carry]` — `CLAUDE.md §8` diz que o seed grava
  `PILOTSEEDONLYNOTASECRET`; o seed real gera base32 (`generateMfaSecret`) e **bloqueia** o sentinel
  (`assertMfaSecretNotPlaceholder`, `mfa.ts`). A **conclusão** do §8 (não rejeitar no login; MFA é Marco-3)
  segue **correta**. — Esforço: **0,5h**.
- **`rules-idempotency-adr-number-collision`** `[carry, INFO]` — rules citam `ADR-015` sem qualificar
  namespace (backend vs _shared). — Esforço: **0,3h**.

### INFO / conformidades verificadas / não-gaps

- **`legacy-lexicon-clean`** **(re-verificado)** — grep `workspace_id|workspaces|account_id` em `src/`/`db/`:
  executável **ZERO**. `workspace`=comentários; `account_id` só como `external_account_id`/`payment_account_id`
  /`channel_account_id` (semântica Stripe/canal legítima) e o alias `AS account_id` em `payments/repository.ts`.
  Ponte `resolve-organization-id.ts` **deletada**. Invariante §4.1 mantida.
- **`four-callbacks-token-gated-401`** **(re-verificado)** — PATCH `/status` (:56) · POST `/traces` (:87) ·
  POST `/stream` (:109) · POST `/complete` (:138), todos em `harness-callbacks.routes.ts`, validam
  `X-Execution-Token` (401 em `execution-token.ts:64-71`); `dead_letter` usa `resolveExecutionTokenAnyStatus`.
- **`dispatch-amendment-faithful-to-canon`** **(re-verificado)** — `deadline_ms`/`original_execution_id`
  (`harness-dispatch.schema.ts:58,62`) + `dead_letter` conferem byte-a-byte com canon `origin/main` (PRD
  §10.4 AMENDMENT + backend/ADR-019 Amendment 1). **Não é fork** (falso-positivo de 06-04 segue retirado).
- **`cross-repo-deadletter-deadline-dependency-closed`** — harness `origin/main` (`bullmq-consumer.ts:155`)
  emite `dead_letter` na exaustão de tentativas; backend recebe (`markExecutionDeadLetter`). Ponta-a-ponta.
- **`payments-conformidades`** — PCI-nil (grep `pan|cvc|cvv|card_number` em payments = 0; só ids
  PaymentIntent/Pix); refund-deferrals **aceitos** em backend/ADR-018; grupo `mutate` idempotente por design
  compensado (state-machine + `ON CONFLICT` + `manual:${charge.id}`); crons de reconcile **wired**
  (`queue/index.ts:143,149,249,262`); ambos webhook-secrets `requiredInProd` (`env.ts:200,203`);
  cross-tenant paid-flip impossível (org derivada só de row DB, `webhook-platform.ts:56-88`); webhooks
  dedupe-aware (`recordWebhookEvent`+`alreadyProcessed`).
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer`; `requireStaff({roles})` enforça 403; JWT staff HS256 aud `bevox-backend-staff` distinto do
  Clerk RS256. §4.2/ADR-013/ADR-017 conforme.
- **`mfa-sentinel-correctly-inert`** — seed grava base32 real + bloqueia o sentinel em seed-time; login não
  rejeita (correto — MFA TOTP é Marco-3, §16.3/ADR-013). **Não implementar "rejeitar sentinel no login"**
  (travaria todo login de staff seedado).
- **`customer-identity-adr009-materialized`** — `customers` + `customer_channels` com UNIQUE(org,provider,
  external_user_id) (§11.3) + `customer_facts` DDL-verbatim existem; só `POST /customers/:id/merge` (§10.1)
  auto-deferido em comentário **sem ADR de deferimento no canon** (BAIXO).
- **`todo-fixme-debt-sweep-marco23-only`** **(re-verificado)** — sweep `src/`+`db/`: **0** FIXME/HACK/XXX;
  TODOs todos Marco-2/3 (MFA `auth/service.ts:86`; DSR hydrate `customers/service.ts:83,85`; autonomy
  `resolver.ts:47`/`seams.ts:24,61`). Zero dívida pilot-blocking.
- **`dead-letter-clobbers-terminal`** `[NOVO, v: BAIXO→INFO]` — `harness-callbacks.repository.ts:89-90 WHERE
  status NOT IN ('done','cancelled','dead_letter')` exclui exatamente 3; um sinal tardio de exaustão pode
  sobrescrever um `rejected`/`expired`/`timeout` sem AuditEvent forense. Latente. — 2h se endereçado.
- **`canon-complete-strategy-enum-stale`** `[NOVO, INFO]` — canon PRD §10.4 enum `/complete` omite `workflow`
  que os **dois** repos usam (`harness-callbacks.schema.ts:62`; harness `execution-handler.ts:1042`) → canon
  atrás do código. Pela disciplina "documentação ganha", vira nota/ADR **no canon**, não fix de código.
- **`queue-size-gauge-never-updated`** `[NOVO, INFO]` — `metrics.ts:41 queueSize` Gauge declarado, nunca
  `.set()` (métrica morta). — 2h.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros somam ≈ 5-6h** e
destravam o runtime do piloto + os 2 jobs de CI vermelhos.

| # | Item | Esforço | Por quê primeiro |
|---|------|---------|------------------|
| 1 | **Seedar Calendar default + grade `professional_schedules` (Seg-Sex) + `system_holidays` no `seed-pilot`** | **2-3h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível (quebra "ver agenda"+"agendar", passos 2/3) |
| 2 | **Corrigir o flaky `booking_notice`** (ancorar slot a `now()`-relativo) **+ `closeDb()/closeRedis()` no `afterAll`** | **0,5h** | Destrava o job `Tests` (§16.1); remove o RED intermitente + teardown 57P01 que mascaram regressões |
| 3 | `pnpm audit`: bump OTel (≥0.217) sob nota ADR-012 + `pnpm override` undici/tmp/vite | **2h** | Destrava o job `Security` (12 highs, ~7 prod-runtime) — completa "CI verde" (§16.1) |
| 4 | **Unificar vocabulário de canal `wa↔whatsapp`/`ig↔instagram`** + CHECK + backfill + teste e2e inbound→outbound | **4-8h** | **CRÍTICO quando a IA ligar**: faz a resposta chegar ao cliente; fecha a causa estrutural + o teste que a esconde |
| 5 | `reconcile-cron`: chamar `applyChargePaid`/`applyChargeRefunded` em vez de `UPDATE` cru | **3-4h** | Fecha a rede de webhook-perdido do passo "webhook concilia" (o resíduo real do `pix-reconcile`) |
| 6 | **Mapear `/complete(strategy='failed')→status='error'`** + aceitar/tratar `aborted_*` (ou coordenar harness) | **4-7h** | Fecha os 2 mismatches de reconciliação de erro que a evolução do harness (07-04) expôs `[xrepo]` |
| 7 | Reconciliar **versão** + cortar tag SemVer capturando #39 | **1-2h** | Coloca em prod o contrato de dispatch **aceito** no canon (hoje `v1.0.1` não tem #39) |
| 8 | Testes de integração: `availability`(rota) + `mark-paid`(rota) + webhook Stripe + inbound→outbound vocab | **8-12h** | Rede para o hot-path do piloto; teria pego os CRÍTICOs #1 e #4 |
| 9 | OpenAPI: +7 paths client-facing + `dead_letter` no `/status` + `create-refund` no enum + `operationId` + teste `printRoutes()×YAML` | **6-8h** | Fecha o drift contrato↔rotas; atende "OpenAPI publicado" (§16.1) |
| 10 | Aplicar gate `ai_opt_out` em `cutoff.ts` antes do dispatch + hidratar DSR export (`audit_events` + `preferences_json`) | **3-5h** | LGPD (o piloto roda com PII real; hoje o flag é ignorado) |
| — | Higiene: remover `.claude/state/gap0704-workflow.js` + `eslint ignores .claude/**`; atualizar `.claude/rules`+`CLAUDE.md §8`; trocar `newOpaqueId` UUIDv4→v7 | **1,5h** | Governança + fecha o RED local de lint + o landmine §4.7 |

---

## Dependências cruzadas

- **bevox-harness** (`origin/main` frozen @ `2979eb0` 06-03) — dependência do 06-23 **FECHADA** (emite
  `dead_letter` + consome `deadline_ms`/`original_execution_id`). **Mas** os 2 mismatches persistem: emite
  `strategy='aborted_timeout'/'aborted_cost'` (backend rejeita 400) e `strategy='failed'` (backend não mapeia
  p/ `error`) — exigem decisão cross-repo. **Mitigante recorrente:** o harness segue **inerte em produção**
  (nenhum proposal emitido no piloto staff-manual) → gaps de proposal/autonomia/IA-outbound não atingem o
  piloto.
- **bevox-meta-api** (`origin/main` frozen @ `5516c2a` 06-22) — usa vocab **pleno** `whatsapp`/`instagram` no
  fio (`meta-client.ts:~525`) → confirma que `wa`/`ig` do backend é a **causa** do bloqueador condicional
  de outbound; `tenant_id=null` drop; `message.status_updated` sem handler; MA-014 media = **5 gates LGPD
  abertos**.
- **Clerk** — `clerk-user-provisioning-broken` depende de webhook `organization.created` + claim
  `organization_id`; piloto contorna via `seed-pilot`.
- **Stripe** — Pix exige Connect KYC `active`; conciliação por webhook depende de **dois** endpoints (Connect
  + platform, ambos `requiredInProd`); refund manual não passa por webhook. **Escape do piloto:** manual-mode
  (`mark-paid` REST) satisfaz "cobrar→concilia" sem webhook nem Stripe.
- **Google** — OAuth redirect/watch dependem de `PUBLIC_API_BASE_URL`/`CALENDAR_OAUTH_SUCCESS_URL` (sem
  `requiredInProd`). Só morde se Google for usado no piloto.
- **canon (ADRs aceitas não-implementadas)** — backend/ADR-009 (merge), ADR-014 (Checkout), ADR-010
  (fit-in/buffer), ADR-020 (MessageTemplate), ADR-021 (priority-score), _shared/ADR-019 (bases legais),
  _shared/ADR-020 (retenção/DSR). Vários drifts são **canon atrás do código** (webhook §10.3 unificado,
  `strategy='workflow'`, `payment_method='checkout'`, `aborted_*`) → nota/ADR superseding **no canon** (ADR-005),
  não fork local.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1`
  (que **não** tem #39); runbook go-live invoca `seed-pilot` (que **não** cria schedule/calendar — CRÍTICO #1).
- **delivery-tracker (categoria h — reconciliado)** — `product_modules:bevox-backend` (`origin/main`) marca
  aisuggestion, staff-rbac, m4-chatwoot-p1..p4, m5-p4-manual-payment, m5-p3a/b/c **delivered**; psp-br
  **parked**. **Divergência:** o tracker mede "código existe (grep evidence)", **não** prod-readiness — e a
  auditoria prova defeito **pilot-blocking** (writer de `professional_schedules`) que **nenhum work-item
  rastreia** (não há work-item de calendário/agenda no slot). `m5-p3c` **auto-declara** "5 gates LGPD
  pendentes / não-ready-for-prod". Logo "delivered" no tracker **≠ pilot-ready**; usar esta auditoria como
  o gate de prontidão, não o tracker.

---

## Delta vs auditoria anterior (2026-07-05)

**Contexto:** código de produto, canon e vizinhos **congelados** desde 06-04/06-03. Quase todos os achados
de código sobrevivem **verbatim** — re-confirmados com evidência fresca por 10 domínios + verificação
adversarial (**0 refutações**, 4 downgrades).

**Fechado / corrigido de método:**
- **`lint`-RED re-diagnosticado.** O 07-05 atribuiu o `lint` RED à corrupção NUL de `typescript.js`. Nesta
  passada a cópia resolvida `.pnpm/typescript@5.9.3` está **limpa** (0 NUL) e `openapi:check`/`tsc`/`build`
  passam; o `lint` RED **local** é o arquivo perdido **gitignored** `.claude/state/gap0704-workflow.js` →
  **CI não afetado**. `openapi:check` que estava RED no 07-05 agora é **GREEN**.
- **`mark-paid-no-success-assert` → CHANGED.** O assert de service **existe** (`payments-manual-mode.test.ts:367`);
  a manchete do 07-05 era imprecisa. Resíduo = só teste de **rota** ausente (rebaixado a BAIXO).

**Novo (13 achados que 06-02/06-04/06-23/07-05 perderam):** `newopaqueid-uuidv4-landmine` (§4.7, qualifica a
conformidade uuidv7-clean anterior), `dedupe-key-stranded-on-persist-failure`, `idempotency-no-atomic-
reservation`, `dsr-export-incomplete-omits-preferences`, `customer-id-relationship-index-missing-11-3`,
`openapi-missing-operationid`, `stray-gap0704-workflow-js-local-lint-red`, `seed-pilot-omits-system-holidays`,
`multimedia-inbound-pii-persisted` (concretiza os "5 gates LGPD"), `dead-letter-clobbers-terminal`,
`canon-complete-strategy-enum-stale`, `queue-size-gauge-never-updated`, `todo-fixme-debt-sweep` (conformidade).
Mais a **reconciliação da categoria h** (tracker × código) que nenhuma passada tinha feito.

**Alteração de severidade (adversarial, 4 downgrades):** `dedupe-key-stranded` MÉDIO→BAIXO;
`multimedia-inbound-pii` MÉDIO→BAIXO; `dead-letter-clobbers-terminal` BAIXO→INFO; `seed-pilot-creates-no-
calendar` pontuado ALTO em isolado (mantido CRÍTICO como co-bloqueador do passo 2). **0 refutações.**

**Sobrevive (sem regressão):** o CRÍTICO `professional-schedules-no-writer`; `outbound-provider-vocab`
(ALTO, CRÍTICO-quando-IA-ligar); `rbac-org-role-not-enforced`; `clerk-user-provisioning-broken`;
`waitlist-accept-books-wrong-time`; os 2 mismatches de harness; `reconcile-cron-*`; toda a bateria LGPD
(consent/DSR/retenção); autonomia/observabilidade inerte; buffer/fit-in/priority-score Marco-2; e a
**staleness `.claude`/CLAUDE.md** (NÃO corrigida desde o bootstrap de 06-04).

**CI (ground-truth 07-07 vs 07-05):** essencialmente **inalterado** — `typecheck`/`format`/`unit(469)`/`build`
= GREEN; `test:integration` = RED (mesmo flaky `booking_notice` por hora-do-dia + teardown 57P01, rodado às
09:05 UTC); `pnpm audit` **estável em 12 high**. Novidade: `openapi:check` voltou a GREEN; `lint`-RED local
tem **nova causa** (arquivo perdido, não corrupção NUL).

---

## Notas de método

**Orquestração.** Workflow multi-agente (opt-in "ultracode", effort alto): **10 auditores de domínio**
(pilot-calendar, payments/Stripe, channels/metaapi, harness-contract, auth/rbac/tenancy, openapi/routes,
lgpd/retention, autonomy/observability, customers/onboarding/schema, ci/governance/debt) — cada um
**re-verificando** os achados do 07-05 do seu domínio contra o **código atual** com evidência fresca
`file:linha` **e** caçando gaps novos, lendo canon de `origin/main`. Seguidos de **verificação adversarial**
(cético, default-refute) de cada achado CRÍTICO/NOVO/alterado, e de um **crítico de completude** que mapeou
as categorias a–n e traçou o happy-path do piloto. **4 domínios usaram agent-types locais** deste repo:
`harness-callback-auditor` (harness-contract), `backend-route-reviewer` (openapi-routes),
`backend-staff-rbac-reviewer` (auth-rbac), `backend-schema-migration-engineer` (customers-schema); payments
usou `Security Engineer`. Custo: **29 agentes, ~1,24M tokens, 354 tool-uses, ~9,3 min, 0 erros, 0 resultados
vazios.** Total: **92 achados** (tally bruto: 2 CRÍTICO + 4 ALTO + 28 MÉDIO + 45 BAIXO + 13 INFO; este
relatório eleva os 2 gates de CI a ALTO e aplica 4 downgrades adversariais), 13 NOVOS.

**Re-verificação manual independente** (orquestrador, fora do workflow) dos achados-manchete: `availability.ts`/
`booking.ts` (`!sched` gate + **zero writers** de `professional_schedules` por grep exaustivo), `seed-pilot.ts`
(só 4 inserts, sem Calendar/grade/feriados), `metaapi/normalize.ts:35` (único mapeamento `whatsapp→wa`, **zero
reverso**), `reconcile.ts:145` (UPDATE cru), `cutoff.ts` (`ai_opt_out` nunca consultado), version-drift
(`merge-base --is-ancestor dbd231e v1.0.1 = FALSE`), os 4 callbacks + token-gate, o arquivo perdido de lint.

**Ground-truth de CI rodado de fato** (2026-07-07 09:05 UTC, não inferido): `typecheck`/`format`/`unit`(469
pass)/`build`/`openapi:check` = **GREEN**; `test:integration` = **RED exit 1** (`1 failed | 92 passed`, flaky
`calendar-booking booking_notice` + teardown 57P01); `pnpm audit --audit-level high` = **RED exit 1, 12
high/27 total**; `lint` = **RED por artefato local** (`.claude/state/gap0704-workflow.js` gitignored, ausente
em CI limpo). Jobs de CI (`ci.yml`): Lint&Format / TypeScript / Build = GREEN num runner limpo; **Tests** e
**Security** (`security.yml`, `continue-on-error:false`) = RED.

**Canon.** Lido por path absoluto `~/bevox-knowledge` (ADR-005), **sempre de `origin/main`**
(`git show origin/main:<path>`) — o working tree está na branch `fix/a14-bevox-meta-api-ig-callback-spec`, que
**deleta 126 linhas** aceitas do PRD/ADR-019 (origem do falso-positivo de 06-04). `origin/main` frozen @
`7874971` (06-03); backend/ADRs 009-023 todas **aceitas** exceto 011 (superseded-by-019) e 016 (proposed).
Numeração de ADR **colide** entre namespaces — sempre qualificada.

**Correções ao brief da missão** (para o revisor): (1) o brief chama backend/ADR-019 de "channels" — o real é
"execução e sugestão / colapso AISuggestion"; channels é _shared/ADR-011. (2) O brief lista os 4 callbacks
como `/complete,/artifact,/tool-result,/turn` — os reais (código + canon + rule) são
`/status,/traces,/stream,/complete`. (3) O grep de léxico legado `account_id\b` do brief captura compostos
Stripe/canal **sancionados** (`external_account_id`, `payment_account_id`, `channel_account_id`) — o léxico
proibido executável é **ZERO** (conforme).

**Limitações.** (1) Severidades calibradas ao gate do **piloto**; para GA vários ALTO/MÉDIO sobem (vocab de
canal vira CRÍTICO). (2) OSV Scanner / CodeQL não reproduzíveis offline (inferidos do lockfile/config). (3)
Caminho live (Stripe/Clerk/harness/Meta reais) não exercitado — verdicts derivam de leitura de código + schema
+ canon `origin/main` + ausência comprovada de writers/endpoints. (4) MCP `stripe`/Google Drive requerem
autenticação interativa — **indisponíveis** nesta sessão headless (reportado, não bloqueante para auditoria de
código).

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-07-07. Sem alteração de código de
produto; somente este relatório. Revisão humana pendente.*
