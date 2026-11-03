# Gap Analysis — bevox-backend — 2026-07-05

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para terminar o
> módulo segundo a documentação canônica (PRD V1 + ADRs **aceitas**), com foco no gate do **piloto**
> (1º cliente real: login → ver agenda → agendar → cobrar → webhook concilia) e no gate de **GA**.
> Método: Workflow multi-agente (**31 agentes / ~1,37M tokens / 418 tool-uses / ~15 min / 0 erros**) —
> 9 auditores de domínio (cada um re-verificando os achados do 06-23 contra o código **atual** com
> evidência fresca + caçando gaps novos + lendo canon de `origin/main`) + **verificação adversarial**
> por delta/CRÍTICO (18 confirmed, 3 downgraded, **0 refuted**) + **crítico de completude**. Ground-truth
> de CI **rodado de fato** (não inferido). Re-verificação manual independente dos achados-manchete.
> Sucede `runtime-gap-audit-2026-06-23.md`.

## Resumo executivo

O backend segue **maduro como fundação e a um passo curto do piloto, mas não pronto** — e o estado de
**código é idêntico ao de 06-04/06-23**: `git diff src/ db/ b61cf62..HEAD` é **vazio** (o único commit
pós-06-23 é o próprio doc de auditoria). O **canon também está congelado** (`origin/main` @ `7874971`,
2026-06-03; nenhuma ADR nova). Logo esta passada é **re-verificação independente + ground-truth de CI +
delta de vizinhos (07-04) + gaps que o 06-23 perdeu** — não novos gaps de código.

**Um único CRÍTICO duro bloqueia o piloto:** `professional-schedules-no-writer` — **nenhum** caminho de
produção (REST, seed ou migration) escreve `professional_schedules`; `availability.ts:126 if (!sched)
continue` deixa a agenda permanentemente vazia e todo `createAppointment` retorna `slot_conflict`
(quebra "ver agenda" e "agendar"). Confirmado por 3 vias independentes (auditor de domínio + verificador
adversarial + re-verificação manual). O corolário operacional (`seed-pilot` não cria Calendar nem grade)
compõe o mesmo bloqueio. **Fix mínimo ≈ 2h** (seedar grade Seg-Sex + calendar no `seed-pilot`).

**O 2º bloqueador é condicional:** o mismatch de vocabulário de canal (`wa`/`ig` no inbound vs
`whatsapp`/`instagram` no outbound → resposta de IA descartada em silêncio) é **efetivamente CRÍTICO no
instante em que a IA/outbound liga**, mas foi calibrado **ALTO** porque o piloto escopado é
**staff-manual** (default `manual_assisted`, `seed` não cria `autonomy_profile`) e **não dispara**
outbound. O delta de vizinho confirma a causa: a `bevox-meta-api` (07-04) usa vocab **pleno** no fio —
`wa`/`ig` é invenção 100% backend-only.

**CI — ground-truth 2026-07-05 (rodado):** `format:check` / `typecheck` / **unit (469)** / `build`
**GREEN**. `pnpm test:integration` **RED** por **1 falha real** — o flaky `booking_notice` por hora-do-dia
(rodei às **09:0x UTC**, < ~13:00 UTC → `expected 'slot_conflict', got 'booked'`, `calendar-booking.test.ts:259`),
mais o *teardown* 57P01 (carry) — as **outras 17 suítes passam**. `pnpm audit --audit-level high` **RED**
com **12 high / 27 total — IDÊNTICO ao 06-23** (sem escalada nesta janela; o salto 4→12 foi 06-04→06-23).
**Correção de método importante:** `lint` e `openapi:check` saíram **RED nesta máquina**, mas é
**artefato local** — o `node_modules/.../typescript.js` (gitignored) está **corrompido com bytes NUL**
(`en\0Line`, `Sm\0rtInden\0er` na linha 183109); só as ferramentas que fazem `require('typescript')`
quebram, enquanto `tsc` (bundle `tsc.js`) e vitest passam. **CI num `pnpm install` limpo não é afetado**
(o 06-23 rodou ambos GREEN) — **não é regressão de código nem de CI**.

**Delta principal (positivo):** a dependência cross-repo que o 06-23 deixou aberta — "o harness precisa
de fato **emitir** `dead_letter` e consumir `deadline_ms`/`original_execution_id`" — está **FECHADA**: a
`bevox-harness` (07-04) emite `dead_letter` (`bullmq-consumer.ts:150-155`) e consome os campos
(`execution-handler.ts:684/698/1348`); o backend já recebe (`markExecutionDeadLetter`). Contrato
exercitável ponta-a-ponta. **Delta negativo (novo):** a mesma auditoria do fio revelou **2 mismatches
novos** que o 06-23 não pegou — o harness emite `strategy='aborted_timeout'/'aborted_cost'` que o enum
do backend **rejeita (400)**, e `strategy='failed'` **não** é mapeado para `status='error'`. Ambos são
caminhos de erro, parcialmente backstopped, mas degradam a reconciliação. O **crítico de completude**
achou **2 módulos órfãos** que nenhum domínio cobria: **Módulo 7 (inbox de Conversas)** sem rotas HTTP e
**Módulo 18 (Onboarding)** com `advance` sem pré-requisito.

**Caminho de fechamento do piloto curto:** os 2 blockers funcionais + o gate de CI (flaky + teardown +
audit) somam **≈ 8-12h**. Severidades calibradas para o gate do **piloto**; para GA vários ALTO/MÉDIO
sobem. Verificação adversarial **não refutou nenhum achado** (só downgrades) — o inventário é sólido.

---

## Achados por severidade

Legenda: `[carry]`/`[novo]`/`[Δsev]`/`[reframe]`/`[fechado]` = status vs 06-23; `(v: <veredito>)` =
verificação adversarial; **(re-verificado)** = também confirmei manualmente; `[xrepo: …]` = dependência
cruzada. Calibração ancorada em PRD §16 (§16.1 Marco-1 = "CI verde" + auth/orgs/users/professionals/
services/customers + OpenAPI + contrato harness; §16.2 Marco-2 = calendar/channels/ai/autonomia/idempot./
métricas; §16.3 Marco-3 = payments/LGPD/MFA/reminders/circuit-breaker). Itens §16.2/§16.3 são
**deferimentos legítimos** — só sobem quando o piloto os exercita (payments e PII **são** exercitados).

### CRÍTICO (bloqueia piloto)

- **`professional-schedules-no-writer`** `[carry]` **(re-verificado; v: confirmed)** — Nenhum caminho de
  produção escreve `professional_schedules` (a jornada semanal base). `availability.ts:116` faz
  `SELECT … FROM professional_schedules WHERE professional_id=? AND day_of_week=?`; `:126 if (!sched)
  continue;` pula o dia sem grade → dia vazio. Grep em `src/ scripts/ db/`: só DDL (`0008` +
  `db/schema/calendar.ts:41-62`) e a **leitura** em `availability.ts`. **Único `INSERT`** é a fixture
  `test/integration/calendar-booking.test.ts:120`. `calendar/routes.ts:41` grava só
  `professional_schedule_overrides` (exceções). `scripts/seed-pilot.ts` insere org(:110)/staff(:157)/
  professional(:195)/service(:217) e **nada mais** (confirmado por `seed-pilot.test.ts:78-81`: só 4 IDs).
  → `booking.ts:200-207 if (!slot) return slot_conflict` sempre dispara. Escopo Marco-1 explícito (PRD §5.3
  "grade fixa", entidade WeeklySchedule), **não** deferimento. — Impacto: `GET …/availability` devolve dias
  vazios e todo agendamento do piloto falha; **sem workaround de produto**. — Esforço: **2h** (seedar grade
  Seg-Sex + calendar no `seed-pilot`) a **6-8h** (endpoint CRUD WeeklySchedule + OpenAPI + teste). **#1.**
  `[xrepo: nenhum]`

- **`seed-pilot-creates-no-calendar`** `[carry]` **(re-verificado)** — Corolário operacional do CRÍTICO:
  `seed-pilot.ts` não cria Calendar default; sem ele `availability.ts:71-75` lança `notFound('Calendar')` —
  o 1º elo de "ver agenda" quebra antes mesmo da grade. Fecha junto com o writer. — Esforço: **1-2h** (ou
  incluído nas 2h acima) `[xrepo: hub runbook go-live invoca `seed-pilot`]`

### ALTO (bloqueia GA / gate de CI; ou dispara no instante em que a IA ligar)

**Bloqueador de produto latente (CRÍTICO quando a IA/outbound ligar)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[Δsev: CRÍTICO→ALTO]` **(re-verificado; v:
  confirmed)** — Inbound persiste provider **abreviado** `wa`/`ig` (`normalize.ts:16,35,44`; `routes.ts:246`
  → `upsertChannelConnection` → `channels/repository.ts:69` grava `channel_connections.provider='wa'`), mas
  o outbound só reconhece o **pleno**: `metaapi/repository.ts:197 provider = r.provider==='whatsapp'||'instagram'
  ? r.provider : null` → com `'wa'`, `null`. `seams.ts:360 if (!ctx||!ctx.provider||…)` → `:376
  skipped_missing_recipient` (audita `metaapi.send.skipped`, **não erro** → invisível a alertas). **Zero
  tradução `wa↔whatsapp`** em `src/` (único mapeamento é `whatsapp→wa`; nada volta). `channels.ts:22` é
  `text` sem CHECK. — Impacto: 100% das respostas de IA a conversas reais são computadas e **descartadas em
  silêncio**. **Calibração:** o piloto escopado é staff-manual (`resolver.ts` default `manual_assisted`;
  `seed` não cria `autonomy_profile`) → outbound **não dispara** → rebaixado a ALTO. **Vira bloqueador duro
  e silencioso** no instante em que a IA ligar (o valor central do produto), e é **CRÍTICO para GA de
  channels**. — Esforço: **4-8h** (unificar vocab num ponto canônico + CHECK + backfill de
  `channel_connections.provider` + teste e2e inbound→outbound) `[xrepo: bevox-meta-api usa `whatsapp`/
  `instagram` no fio — `meta-client.ts:525`, 07-04; confirma que `wa`/`ig` é backend-only]`

**Gate "CI verde" (§16.1 — único critério Marco-1 mensurável; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-teardown`** `[carry]` **(re-verificado — rodado)** — `pnpm
  test:integration` = **RED exit 1**. Causa: `calendar-booking.test.ts:246-260` seta `booking_notice=1440min`
  e agenda "amanhã 10:00" esperando `slot_conflict`; mas o slot é interpretado na tz do calendar
  (`America/Sao_Paulo`) → "amanhã 13:00 UTC", e o gate `booking.ts:191-197` só dá `slot_conflict` se
  `now() > ~13:00 UTC`. Rodei às **09:0x UTC** → retornou `booked` → **assert falha** (`:259 expected
  'slot_conflict', got 'booked'`) — exatamente o RED observado. Soma-se o *teardown* 57P01 (única suíte que
  chama `initDb` sem `closeDb`/`closeRedis` no `afterAll`). As **17 outras suítes passam** (payments 19,
  harness-contract **12**, staff-rbac 5, channels 9+5, customers-dsr 4, migration 6, seed-pilot 3, etc.).
  Produção OK (o bug é só no teste/teardown). — Impacto: mantém `Tests` RED (viola §16.1) e mascara
  regressões. — Esforço: **0,5h** (ancorar o slot a `now()`-relativo + `await closeDb()/closeRedis()`).

- **`ci-security-red-pnpm-audit-12-high`** `[carry, estável]` **(re-verificado — rodado)** — `pnpm audit
  --audit-level high` = **RED exit 1, "27 vulnerabilities … 12 high"** — **idêntico ao 06-23** (sem escalada
  nesta janela; lockfile congelado desde 2026-05-19). 7 highs prod-runtime (cadeia OTel/grpc: `@grpc/grpc-js`,
  `@opentelemetry/*` Prometheus-exporter crash, `protobufjs`) + 5 test-only (`undici`, `tmp`, `vite` via
  `testcontainers`/`vitest`). `security.yml` roda com `continue-on-error:false` → hard-fail. — Impacto:
  mantém `Security` RED (2º gate §16.1). — Esforço: **2h** (bump OTel ≥0.217 sob nota ADR-012 + `pnpm
  override` undici / tmp / vite).

**Auth / RBAC / provisionamento (pré-GA; mitigados no piloto de 1 org / 1 admin)**

- **`rbac-org-role-not-enforced`** `[carry]` **(re-verificado)** — `requireRole` **não existe** (grep = 3
  comentários TODO: `clerk-auth.ts:24-25`, `auth/repository.ts:260-262`, `types/global.d.ts:35`). Toda rota
  monta só `[requireClerkAuth, requireOrganizationScope]`; `req.user.role` **é** resolvido
  (`clerk-auth.ts:183`, tipado `owner|admin|operator|professional_viewer`) mas consumido por **zero**
  handler → `professional_viewer` pode `PATCH /organizations/:id/settings`. PRD §5.1 (l.322) exige RBAC —
  **não** deferido (auth = Marco-1). **Armadilha:** `resolveLocalUser` (`clerk-auth.ts:126-139`) é
  **fail-open** (null em erro de DB **e** não-provisionado) — precisa **fail-closed** quando `requireRole`
  consumir role. Blast-radius baixo no piloto (1 org, 1 `bevox_admin` seedado). — Esforço: **16h**
  `[xrepo: canon ADR-013]`

- **`clerk-user-provisioning-broken`** `[carry]` **(re-verificado)** — `auth/repository.ts:217-227`
  `findOrganizationByClerkOrg` faz `SELECT organization_id FROM users WHERE clerk_user_id = <orgClaim>`
  (compara clerk-org-id contra coluna clerk-user-id — dimensões erradas); sem branch `organization.created`
  no webhook (`auth/routes.ts:165-190` só `user.*`); sem mapping clerk-org→bevox-org. PRD §8.5 (l.902-907)
  manda `organization.created → INSERT Organization + User(owner)`. Sem teste cobrindo (consistente com
  estar quebrado). Mitigado no piloto (bootstrap via `seed-pilot`). — Esforço: **12h** `[xrepo: Clerk]`

**Agenda (caminho do piloto; corrompe dados quando exercitado)**

- **`waitlist-accept-books-wrong-time`** `[carry]` **(re-verificado)** — `waitlist/routes.ts:114-127` usa
  `full.offered_at` (instante da oferta, gravado em `service.ts:69`) como horário do appointment; o slot real
  (`slot_start_at`) vive só em `waitlist_match_outbox`. O caminho `auto_book` usa o slot correto
  (`service.ts:102`); só o endpoint HTTP `/accept` (modo `offer`) agenda no horário errado. — Impacto:
  double-book / horário fantasma quando waitlist é exercitada. Marco-2. — Esforço: **3-6h** (persistir
  `slot_start_at` no entry na oferta + migration + teste).

> **Nota de calibração — itens que o 06-23 tinha em ALTO e caíram para MÉDIO** (ver §Delta): a
> verificação adversarial **refutou a manchete** de `pix-reconcile-depends-on-second-stripe-endpoint`
> (não "trava pending pra sempre": o cron de reconcile **existe** e o secret é `requiredInProd`) e
> **desinflou** `version-drift-4way`. Ambos migraram para **MÉDIO** abaixo. `calendar-google-oauth-urls`
> (ALTO no 06-23) não foi re-listado por nenhum domínio nesta passada; permanece como resíduo BAIXO de
> config (`PUBLIC_API_BASE_URL`/`CALENDAR_OAUTH_SUCCESS_URL` sem `requiredInProd`) — só morde se Google
> for usado no piloto.

### MÉDIO (degrada qualidade)

**Contrato backend↔harness (NOVOS — expostos pela evolução do harness em 07-04)**

- **`complete-callback-rejects-harness-abort-strategies`** `[NOVO]` **(v: confirmed)** — O
  `CompleteCallbackSchema.strategy` enum (`harness-callbacks.schema.ts:57-65`) = `[direct, react,
  plan-execute, rewoo, workflow, request-human, failed]` — **não** inclui `aborted_timeout`/`aborted_cost`.
  Mas o harness emite exatamente esses no boundary terminal (`bevox-harness execution-handler.ts:2096-2100`)
  → `routes.ts:143 CompleteCallbackSchema.parse` → **ZodError → 400**. Aborts são terminais sem rethrow
  (`errors.ts:7`) → sem retry BullMQ → sem `dead_letter` fallback; o `/complete` 400'd é engolido pelo
  `.catch`. Só o timeout-scan B2 (`queue/index.ts` cron `*/2`) reconcilia para `timeout` genérico (perde
  strategy/usage). — Impacto: em timeout wall-clock (>120s) ou cost-ceiling durante o piloto, o desfecho
  terminal é perdido/degradado. — Esforço: **4h** (decisão cross-repo: harness mandar `failed`, OU
  backend+canon adicionarem `aborted_*` e mapearem) `[xrepo: bevox-harness]`

- **`complete-failed-strategy-not-mapped-to-error`** `[NOVO]` **(v: confirmed)** — `strategy='failed'` no
  `/complete` **não** vira `executions.status='error'`. `complete-service.ts:17-32` trata como `reply`
  (proposals vazio) → em `autonomous_supervised` cai em `deliverToChannel('')` = skip no-op que **mantém
  `done`** (`:96-100`); em manual/copilot vira `waiting_approval` com texto vazio. O comentário do schema
  (`schema.ts:64 "'failed' é o sentinel de error boundary"`) não é honrado. Contradiz **backend/ADR-019
  Amendment 1** (assume "o error gravado por um `/complete(failed)` prévio"). — Impacto: execução
  genuinamente falha em modo autônomo é registrada como **`done`** (falha silenciosa). — Esforço: **3h**
  `[xrepo: bevox-harness execution-handler.ts:2100]`

**Módulos órfãos (NOVOS — achados pelo crítico de completude; nenhum domínio os cobria)**

- **`conversations-inbox-module-absent`** `[NOVO]` — Módulo 7 (Conversas/Mensagens) tem tabela
  (`db/schema/conversations.ts`) mas **zero rotas HTTP** de inbox. PRD §5.4/§10.1 especifica como V1
  client-facing: `GET /organizations/:oid/conversations`, `GET /conversations/:id/messages`, `POST
  /conversations/:id/messages` (envio manual pelo profissional), `POST /conversations/:id/handoff`.
  **Nenhuma existe** (grep só acha `/conversations/:id/executions` em staff-ops, cross-org). — Impacto: o
  profissional não pode **ler a conversa, responder manualmente nem fazer handoff** via API — relevante para
  um piloto WhatsApp real (o modo `manual_assisted` pressupõe humano no loop, mas o "loop" hoje é só o
  fluxo de aprovação de `executions`, não um inbox). — Esforço: **12-20h** `[xrepo: PRD §5.4/§10.1]`

- **`onboarding-advance-no-prereq-arbitrary-stage`** `[NOVO]` — `organizations/service.advanceOnboardingStage`
  só repassa `stage` a `repository.advanceOnboarding` (`repository.ts:151` `UPDATE organizations SET
  onboarding_stage = <stage>` cru); `onboardingAdvanceSchema` (`schemas.ts:35`) aceita **qualquer** um dos 11
  valores → cliente pode `POST advance {stage:'copilot_active'}` pulando direto para autonomia. PRD §5.8 exige
  "não avança a services sem ≥1 professional ativo" + checklist/next-action (ausente). — Impacto: máquina de
  estados de onboarding sem guards; auto-promoção arbitrária. — Esforço: **6-8h** `[xrepo: PRD §5.8]`

**Pagamentos / reconciliação (inclui os 2 downgrades ALTO→MÉDIO)**

- **`pix-reconcile-depends-on-second-stripe-endpoint`** `[Δsev: ALTO→MÉDIO]` **(v: downgraded)** — Fatos
  estruturais confirmados: `webhook.ts:65` trata só `account.updated`; `payment_intent.succeeded →
  applyChargePaid` vive só em `webhook-platform.ts:99-120` (endpoint `/webhooks/stripe/platform`, secret
  `STRIPE_WEBHOOK_SECRET_PLATFORM`); **backend/ADR-014 descreve UM endpoint**. **Mas a manchete "charge fica
  pending para sempre" é REFUTADA:** (1) o cron de reconcile **está implementado e agendado** —
  `reconcile.ts:131 paymentIntents.retrieve`, `:140-150` flipa pending→paid, wired em `queue/index.ts:143,249`
  (`0 */6 * * *`); (2) `STRIPE_WEBHOOK_SECRET_PLATFORM` é **`requiredInProd`** (`env.ts:203`) → prod **não
  sobe** sem ele; (3) o split de 2 endpoints é **tecnicamente defensável** para destination charges. Resíduo
  real: split canon/código **não documentado** (endpoint+secret extra sem ADR superseding) + o cron faz
  `UPDATE` cru (ver abaixo). — Esforço: **2-3h** (reconciliar via ADR/nota + startup-assert) `[xrepo: Stripe]`

- **`reconcile-cron-flips-paid-without-orchestration`** `[carry]` **(re-verificado)** — `reconcile.ts:140-150`
  faz `UPDATE charges SET status='paid'` cru, **sem** `applyChargePaid` (`service.ts:876-925`: markChargePaid
  → insertPayment → confirmAppointmentIfUnconfirmed → audit → grantCustomerPackage). — Impacto: charge
  reconciliada por cron (o cenário exato que o cron existe para corrigir) fica `paid` **sem** row em
  `payments` (§8.4 passo 8), **sem** appointment confirmado (passo 10), sem grant, sem audit → estado
  divergente entre webhook e cron. — Esforço: **3-4h** (chamar `applyChargePaid`/`applyChargeRefunded`).

- **`reconcile-cron-skips-refunded-and-grant-on-cancel`** `[carry]` — `reconcile.ts:139` declara o union com
  `refunded` mas nenhum branch o seta; cancel faz `UPDATE` cru sem reverter grant. — Esforço: **2-3h**.

- **`stripe-webhook-zero-integration-tests`** `[reframe]` **(v: confirmed)** — grep `constructEvent` em
  `test/` = **vazio**; nenhum teste bate na rota `/webhooks/stripe` nem `/platform`.
  `payments-webhook-platform.test.ts` mocka o `repository` e testa a **sequência** de `applyChargePaid`, não a
  rota/assinatura/dedupe. Ponto de entrada de dinheiro sem cobertura de rota. — Esforço: **5h** (pode usar
  `stripe.webhooks.generateTestHeaderString`) `[xrepo: Stripe]`

**Agenda / Calendar (deferimentos Marco-2 + rede de teste)**

- **`buffer-before-after-minutes-dead-columns`** `[carry]` — `catalog.ts:62-63` declara buffer; `availability.ts`/
  `booking.ts` ignoram (grep zero). PRD §5.2/§5.3. — Esforço: **4h**.
- **`fit-in-encaixe-ausente`** `[carry]` — `catalog.ts:65-66,110` (`allow_fit_in`/`max_fit_ins_per_slot`/
  `fit_in_policy_json`) inertes; zero lógica de encaixe (§5.3). — Esforço: **8h**.
- **`availability-http-endpoint-zero-integration-coverage`** `[carry]` — `GET /calendars/:id/availability`
  (1º elo "ver agenda") sem teste e2e; permitiu o CRÍTICO #1 passar despercebido. — Esforço: **3h**.
- **`reschedule-transition-zero-integration-coverage`** `[carry]` — `rescheduleAppointment` (`booking.ts:345`)
  e `transitionAppointment` (`:424`, cancel/confirm/complete/no_show) + hook prepay sem integração apesar do
  header do teste alegar cobrir. O piloto exercita cancel+prepay. — Esforço: **5h**.
- **`waitlist-match-utc-vs-calendar-tz`** `[carry]` — `match.ts:32-46` compara janela em UTC, não na tz do
  calendar (dívida V1 documentada). — Esforço: **3h**.
- **`manual-booking-created-by-and-body-drift`** `[reframe]` — `appointments` sem `created_by_type/created_by_id`
  (`booking.ts:233-243` grava só `source`; o ator Clerk é descartado) → contradiz PRD §8.3 (l.869) + §587
  ("AuditEvent em toda mutação crítica"). O drift de body `{date,start_time}` vs §8.3 `{start_at}` é
  inconsistência **interna** do canon (§5.3 vs §8.3); código+OpenAPI seguem §5.3. — Esforço: **3h**.
- **`adr-021-priority-score-not-implemented`** `[Δsev: BAIXO→MÉDIO]` **(v: confirmed→MÉDIO)** — backend/ADR-021
  (aceita 2026-05-21, **vinculante**) manda `priority_score` system-derived `MAX(0, age_hours + urgency_level×100
  − skip_count×10)` e depreca input do cliente; código aceita input verbatim (`waitlist/routes.ts:30,36,71,95`),
  sem colunas `urgency_level`/`skip_count`/`last_score_update`, sem CHECK≥0, sem compute/cron. Vetor "cliente
  infla a própria prioridade" aberto (org-self-scoped). — Esforço: **6h** `[xrepo: canon backend/ADR-021]`

**Autonomia / observabilidade / SSE (harness inerte em prod — blindado do piloto staff-manual)**

- **`domain-prometheus-metrics-not-registered`** `[carry]` — `shared/metrics.ts` só tem HTTP/queue/ingest/
  metaapi; grep `charges_succeeded_total|appointments_no_show_rate|executions_pending_approval_count|
  executions_timeout_total` = **0**. PRD §12.10 (l.1365) exige esses 4. `charges_succeeded_total` é relevante
  ao piloto. — Esforço: **4h**.
- **`rate-limit-§12.6-zero-routes-applied`** `[carry]` — plugin registrado, expõe `requireRateLimit()`, mas
  **nenhuma rota** o aplica (grep = só a definição). Caps §12.6 não enforçados; código morto. — Esforço: **3h**.
- **`sse-appointment-charge-events-never-published`** `[carry]` — `realtime/publish.ts:8-12` só publica
  `execution.*`/`waitlist.offered`; `appointment.created/updated` (§8.3 l.872) e `charge.updated` (§8.4 l.894,
  §10.1 l.1013) **nunca** emitidos → a tela do profissional não auto-atualiza no agendar/pagar do piloto.
  — Esforço: **5h**.
- **`autonomy-action-granularity-not-enforced`** `[carry]` — `resolver.ts:41-62` gateia só por `current_mode`;
  `allowed_actions_json`/`required_approvals_json`/`confidence_thresholds_json` + `PolicyEvaluator`
  (`seams.ts`) com **zero callers**. **Correção vs 06-23:** ADR-022 (policy-json) cobre reminder/fit_in/
  waitlist/handoff, **não** os JSONBs de `autonomy_profiles` → este write-only **não** é absolvido pelo
  "zero-consumer aceito V1" da ADR-022. Inerte no piloto. — Esforço: **8h** `[xrepo: PRD §5.5 + harness]`
- **`circuit-breaker-opossum-absent`** `[carry]` — `stripe-client.ts:21` sem timeout/`maxNetworkRetries`/
  breaker; grep `opossum` = 0. PRD §7.5 (l.790)/§12.7 (l.1339). Deferimento Marco-3; alvo LLM inerte no
  piloto; Stripe **é** exercitado. — Esforço: **5h** (dep `opossum` dispara gate §6).

**LGPD (Marco-3 por §16.3, mas o piloto roda com PII real)**

- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` — `customers.ai_opt_out` é gravado/lido no CRUD
  (`repository.ts:21,26,67`) mas **nunca** consultado no pipeline: `cutoff.ts:34-76` resolve modo + monta
  mensagens e despacha ao harness **sem** carregar o customer nem checar `ai_opt_out`. — Impacto: cliente que
  revoga consentimento de IA ainda tem a conversa mandada ao LLM (transferência internacional, _shared/ADR-019
  item 7). Vetor existe no piloto se qualquer customer receber `ai_opt_out=true`. — Esforço: **3-5h**.

**Schema / completude PRD (deferimentos Marco-2/3 explícitos §16)**

- **`section-11-1-entities-absent`** `[carry]` — StatusHistory / OperationalMetricSnapshot / KnowledgeInterview
  / HandoffEvent / ConversationAssignment ausentes (enumeração das 45 `pgTable`). PRD §11.1. — Esforço: ~4-8h/ea.
- **`module-14-reminders-absent`** `[reframe]` — `reminder_policy_json` **já** existe (`tenancy.ts:47`);
  ausentes = `appointments.reminder_sent_at` + fila `bevox.reminders` + worker (PRD §14, l.550-558). — Esforço: **16h**.
- **`modules-10-11-faq-rules-absent`** `[carry]` — sem tabelas `faq_items`/`operational_rules` nem módulos
  (PRD §10/§11; extensões `pg_trgm`/`pgvector`). — Esforço: **24h**.
- **`message-template-entity-adr020-unimplemented`** `[carry]` — backend/ADR-020 (aceita) `message_templates`
  sem tabela/módulo; FK-alvo de `reminder_policy_json.message_template_id`. (Tracker=visibilidade por ADR-023;
  o gap é a ADR-aceita não-implementada, não o "untracked".) — Esforço: **8h** `[xrepo: canon backend/ADR-020]`

**Governança / release**

- **`version-drift-4way`** `[Δsev: ALTO→MÉDIO]` **(v: downgraded)** — `package.json 0.1.0` / `openapi 1.11.0`
  / tag `v1.0.1` (@`3291124`); HEAD **25 commits** à frente de `v1.0.1`; `merge-base --is-ancestor v1.0.1
  dbd231e = TRUE` → **PR #39 (dispatch-amendment) não está em `v1.0.1`**; `release.yml:5` só builda em tags
  `v*.*.*`. **Desinflado:** `git show v1.0.1:package.json` também é `0.1.0` (nunca rastreou release — não é
  "drift"); `release.yml` também emite `type=sha` (deploy por digest de HEAD possível). Verdade nuclear real
  (amendment aceito não está em imagem SemVer), fix trivial. — Esforço: **1-2h** (bump coerente + tag SemVer
  capturando #39) `[xrepo: hub manifest/digest]`

### BAIXO (higiene)

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static')**
- **`openapi-drift-client-facing-handlers`** `[reframe]` **(v: confirmed)** — 5 handlers client-facing
  ausentes do YAML: `GET/PATCH /autonomy` (`autonomy/routes.ts:18,23`), `GET /channel-connections`
  (`channels/routes.ts:13`), `GET /customers/:id/export` (`:97`), `GET/PATCH /payment-account/policy`
  (`payments/routes.ts:89,95`), `GET /api/v1/realtime` SSE (`realtime/routes.ts:26`). **Cluster encolheu:**
  `connect-return/refresh` **agora** no YAML (`:3082,3098`). — Esforço: **2-3h**.
- **`openapi-status-callback-missing-dead-letter`** `[carry]` — YAML `:298` enum `[running,paused,cancelled]`;
  código+canon já têm `dead_letter` (o harness **emite**). YAML atrás. — Esforço: **0,25h**.
- **`openapi-enum-drift-proposal-and-payment-method` / `openapi-proposal-enum-drift-refund-waitlist`**
  `[carry+novo]` — `ExecutionProposal.action` omite **`create-refund`** (money, vivo em `schema.ts:34`) e
  inclui **`waitlist-add`** (não-canon); `payment_method` sem `checkout`. Doc-only. — Esforço: **0,5h**.
- **`openapi-no-route-contract-test`** `[carry]` — sem `printRoutes()×YAML`; causa-raiz do drift invisível.
  — Esforço: **3-4h**.
- **`openapi-webhook-exclusion-intentional`** `[reframe→INFO]` — webhooks stripe/google fora do YAML são
  exclusão **documentada** (`:2510`), com inconsistência (metaapi **está** documentado). Não-gap; uniformizar.

**Canais (estrutural / cross-repo bevox-meta-api)**
- **`channel-provider-vocab-drift-vs-canon-glossary`** `[carry]` — `wa`/`ig` é invenção backend-only; canon
  §10.3 + meta-api usam pleno; `channels.ts:22` sem CHECK. **Causa estrutural** do CRÍTICO condicional. —
  Esforço: **2h**.
- **`vocab-mismatch-masked-by-test-seeding`** `[NOVO]` **(v: confirmed→MÉDIO na origem, listado aqui)** —
  nenhum teste flui inbound-`wa`→outbound; testes de outbound semeiam `whatsapp` à mão (`channels-metaapi-
  outbound.test.ts:70,86`; unit seams mockam `whatsapp`) → o join que null-ifica `wa` nunca é exercitado.
  Um teste honesto pegaria o CRÍTICO #2. — Esforço: **3h**.
- **`tenant-id-null-silent-drop`** `[carry]` — evento inbound `tenant_id=null` aceito/persistido
  (`routes.ts:202-219`) mas nunca despachado (`:234 if (… && organizationId)`). — Esforço: **2h**.
- **`non-message-events-no-handler`** `[carry]` — backend assina 5 tipos (`server.ts:249-255`) mas só trata
  `message.received`; `message.status_updated` (confirmação de entrega) sem handler. — Esforço: **4-6h** `[xrepo]`
- **`ig-outbound-missing-recipient`** / **`hmac-subscription-active-limit1`** `[carry]` — deferimentos V1. — 1-3h.

**LGPD / DSR (Marco-3 §16.3)**
- **`dsr-export-poc-stub-empty-messages`** `[Δsev: BAIXO→INFO na verify; mantido aqui como resíduo]** **(v:
  downgraded→INFO)** — `GET /customers/:id/export` **existe** (`routes.ts:97`) mas `service.ts:107` retorna
  `messages:[]`/`audit_events:[]` hardcoded (POC, `schema_version="1.0.0-poc"`, TODO Marco-3). Único ponto
  acionável-agora: hidratar `audit_events` por `customer_id` (já é org+entity-scoped). — Esforço: **2-3h**.
- **`message-records-not-customer-org-scoped-blocks-dsr`** `[carry]` — `message_records` (PII) só tem
  `conversation_key`, sem `organization_id`/`customer_id` → bloqueia DSR export/deleção reais. — Esforço: **6-10h**.
- **`no-dsr-deletion-endpoint`** `[carry]` — nenhum `app.delete` em `customers/`; `deleted_at`/`archived_at`
  declaradas (`customers.ts:51-52`) mas nunca escritas (PRD §12.9). — Esforço: **4-6h** `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` — nenhuma fila/worker de retenção; sem `consent_events`/
  `dsr_requests`; PII acumula sem TTL (_shared/ADR-020). — Esforço: **20-40h** `[xrepo: _shared/ADR-020]`
- **`consent-granted-at-write-never`** `[carry]` — `customers.consent_granted_at` (§12.9) nunca escrita/lida
  (ausente de `schemas.ts` e `PATCH_COLS`). — Esforço: **1-2h**.
- **`redaction-exposes-pii-debug-trace`** `[carry, BAIXO]` **(re-verificado)** — `redactors.ts:69-72` omite
  PII em debug/trace **mas** `env.ts:215-221` rejeita `LOG_LEVEL∈{debug,trace}` em prod no boot → vetor de
  prod **fechado**; resíduo só não-prod. **Sem teste** cobrindo redaction (risco de regressão silenciosa). —
  Esforço: **1-2h**.

**Pagamentos (resíduos)**
- **`mark-paid-no-success-assert`** `[carry, BAIXO]` — o service `markChargePaidManually` **é** testado
  (`payments-manual-mode.test.ts:338-568`); falta só o teste de **rota** (`POST …/mark-paid`). — Esforço: **1h**.
- **`requires-prepayment-hook-fails-for-manual-only-pilot-org`** `[carry]` — `booking.ts:275-313 createCharge`
  lança "payment account not active" em org manual-mode; mitigado: hook best-effort não-fatal + service
  seedado `requires_prepayment=false`. — Esforço: **2h** `[xrepo: ADR-023 vs ADR-014]`
- **`payment-link-checkout-stub`** `[carry]` — Checkout/payment-link (método V1 ADR-014) é stub 501
  (`checkout.ts:47-53`); piloto coberto por Pix+manual. — Esforço: **8-16h** `[xrepo: ADR-014]`
- **`charge-route-path-pix-vs-prd`** `[carry]` — `POST /organizations/:id/charges` vs PRD §5.6/§8.4
  `POST /appointments/:id/charges` (equivalente; `appointment_id` no body). — Esforço: **1h**.

**Autonomia / observabilidade / SSE (resíduos)**
- **`sse-client-endpoint-drift-and-header-auth`** `[NOVO]` **(v: confirmed)** — `GET /api/v1/realtime`
  (`realtime/routes.ts:27`) diverge do canon §10.1 (l.1012 `GET /api/v1/realtime/events?token=…`); usa
  **header-auth** que `EventSource` de browser **não** seta → inconsumível pelo bevox-client. Ausente do
  OpenAPI. — Esforço: **3h**.
- **`autonomy-readiness-score-never-computed`** `[carry]` — `readiness_score` lido/retornado, nunca computado
  (`GET /autonomy` sempre `null`). — Esforço: **3h**.
- **`autonomy-patch-nontransactional-mode-audit`** `[carry]` — `repository.ts:87,111` UPDATE + INSERT audit em
  2 chamadas não-transacionais (modo muda sem AuditEvent se a 2ª falha) + lost-update dos JSONBs. — Esforço: **2h**.
- **`escalation-request-human-no-sse`** `[carry]` — `complete-service.ts:59-70` handoff humano sem
  `publishRealtime`. — Esforço: **1h**.
- **`metrics-endpoint-unauthenticated`** `[carry]` — `GET /metrics` (`health/routes.ts:24`) sem auth; expõe
  `organization_id` como label; mitigado por network policy do hub. — Esforço: **1h**.
- **`http-metrics-route-label-unbounded-on-404`** `[carry]` — `server.ts:163 req.routeOptions?.url ?? req.url`;
  em 404 cai em `req.url` cru → cardinalidade ilimitada sob varredura. — Esforço: **1h**.
- **`idempotency-key-not-scoped-to-route-actor-org`** `[carry]` — `idempotency.ts:85 redisKey=idempotency:${key}`
  sem method/route/org/actor → mesma key em rotas distintas reusa body cacheado. — Esforço: **2h**.
- **`idempotency-ttl-no-per-route-override`** `[carry]` — TTL 86400s hardcoded (`idempotency.ts:44`). — Esforço: **1h**.

**Schema / calendar (resíduos)**
- **`appointments-charges-executions-missing-11-3-indexes`** `[reframe]` — `conversations` **já** cumpre
  (org,status)+(org,last_message_at); faltam `(org,status)` em appointments/charges/executions e `(org,start_at)`
  em appointments (§11.3). — Esforço: **2h**.
- **`adr-021-waitlist-priority-columns-absent`** `[carry]` — colunas `urgency_level`/`skip_count`/
  `last_score_update` + CHECK≥0 ausentes (metade do schema de ADR-021). — Esforço: **3h** (incl. no ADR-021 MÉDIO).
- **`calendar-crud-incompleto`** `[carry]` — só `GET/POST /calendars`; faltam GET-by-id/PATCH/DELETE (§5.3).
  — Esforço: **3h**.
- **`no-seed-pilot-npm-script`** `[carry]` — sem script npm `seed-pilot` (só `seed`→`seed.ts`). — Esforço: **1h**.

**Identidade / onboarding (resíduos)**
- **`webhook-user-always-operator`** `[carry]` — `auth/repository.ts:235-241` insere role literal `'operator'`;
  §8.5 manda 1º user `owner`. Acoplado a `clerk-user-provisioning-broken`. — Esforço: **3h**.
- **`org-role-management-and-self-demote-guard-missing`** `[carry]` — sem POST users/invitations, DELETE
  users/:id, troca de role (§5.2 l.343-345); guard §12.2.3 vacuamente cumprido. — Esforço: **10h**.
- **`customer-identity-consolidation-and-merge-absent`** `[NOVO]` — ADR-009 (aceita) consolidação cross-canal
  + `POST /customers/:id/merge` (§10.1) auto-declarados "deferred — out of scope" (`customers/routes.ts:42`)
  **sem ADR de deferimento no canon**. — Esforço: **8-12h** `[xrepo: canon backend/ADR-009]`

**Config `.claude/` + CLAUDE.md (staleness — NÃO corrigidos desde o bootstrap de 06-04)**
- **`rules-dead-letter-writer-mechanism-wrong`** `[carry]` **(re-verificado)** —
  `backend-harness-contract.md:46` e `backend-workers.md:20` dizem `dead_letter` via `worker.on('failed')` —
  **inexistente**; é via callback `PATCH /status` (`harness-callbacks.repository.ts:89`; backend é
  producer-only). — Esforço: **0,3h**.
- **`claude-config-stale-deleted-bridge-and-closed-issue36`** `[carry]` **(re-verificado)** —
  `backend-tenancy.md:28` + `README.md:84` citam `src/integration/resolve-organization-id.ts` que **não
  existe**; `backend-tests.md:27` cita "5 falhas FK #36" — a suíte passa **12** (issue fechada). — Esforço: **0,5h**.
- **`claude-md-section8-mfa-sentinel-doc-stale`** `[carry]` **(re-verificado)** — `CLAUDE.md:171` diz que o
  seed grava `PILOTSEEDONLYNOTASECRET`; o seed real (`seed-pilot.ts:153`) gera base32 (`generateMfaSecret`) e
  **bloqueia** o sentinel (`assertMfaSecretNotPlaceholder`, `mfa.ts:71`). A conclusão do §8 (não rejeitar no
  login; MFA é Marco-3) segue **correta**. — Esforço: **0,5h**.
- **`rules-idempotency-adr-number-collision`** `[carry, INFO]` — rules citam `ADR-015` sem qualificar
  namespace (backend/ADR-015 idempotência vs _shared/ADR-015 telegram-topics). — Esforço: **0,3h**.

### Conformidades verificadas / não-gaps / correções (INFO)

- **`dispatch-amendment-faithful-to-canon`** **(re-verificado)** — `deadline_ms`/`original_execution_id`/
  `dead_letter` (`harness-dispatch.schema.ts:58,62`; `harness-dispatcher.ts:84-103`;
  `harness-callbacks.schema.ts:16`) conferem byte-a-byte com canon **origin/main** (PRD §10.4 "AMENDMENT
  2026-06-03" + backend/ADR-019 "Amendment 1"). #39 **fiel**, **não é fork**. (Falso-positivo de 06-04
  segue retirado.)
- **`cross-repo-deadletter-deadline-dependency-closed`** `[FECHADO]` — a `bevox-harness` (07-04) emite
  `dead_letter` (`bullmq-consumer.ts:150-155`) e consome `deadline_ms`/`original_execution_id`
  (`execution-handler.ts:684/698/1237/1348`); o backend recebe (`markExecutionDeadLetter`). **Contrato
  exercitável ponta-a-ponta.** Principal delta positivo vs 06-23.
- **`four-callbacks-token-gated-401`** — os 4 callbacks validam `X-Execution-Token` (401 se ausente/inválido;
  `execution-token.ts:64-71`); `dead_letter` usa `resolveExecutionTokenAnyStatus`; lookup fiado no bootstrap.
- **`dead-letter-writer-is-callback-not-worker`** — `dead_letter` escrito por `PATCH /status`
  (`harness-callbacks.repository.ts:86-120`, guarded `WHERE status NOT IN(done,cancelled,dead_letter)`), não
  por `worker.on('failed')` (backend é producer-only na fila de dispatch).
- **`idempotency-§12.3-triple-wired`** + **`payments-mutate-state-machine-idempotent`** **(re-verificado)** —
  as mutações canônicas passam por `requireIdempotency` (customers/orgs/executions/professionals/calendar/
  services/waitlist/payments write); o grupo `mutate` de payments (mark-paid/expire/connect-manual/policy)
  omite o header **por design compensado** (state-machine + `ON CONFLICT` + `providerPaymentId` determinístico
  `manual:${charge.id}`). Não é bug.
- **`pci-scope-nil-pix-pi-no-pan`** — backend só manuseia `PaymentIntent`/Pix ids, nunca PAN (Checkout que
  traria cartão hospedado é stub 501). SAQ-A-elegível por design.
- **`adr018-refund-deferrals-canon-accepted`** — partial-refund-of-package, re-crédito, penalidade
  depósito/late-cancel, retry de `refund.failed` são deferimentos **nomeados e aceitos** em backend/ADR-018.
  Não é bug.
- **`mfa-sentinel-correctly-inert`** — seed grava base32 real + bloqueia sentinel em seed-time; login não
  rejeita sentinel (correto — MFA TOTP é Marco-3, §16.3/ADR-013).
- **`legacy-lexicon-clean`** **(re-verificado)** — grep `workspace` em `src/`/`db/` = 5 matches, **todos
  comentários**; `account_id` executável só como alias Stripe (`payments/repository.ts:1012`). Invariante
  CLAUDE.md §4.1 mantida (léxico executável ZERO).
- **`uuidv7-single-source-clean`** (crítico de completude) — grep `crypto.randomUUID|uuidv4|gen_random_uuid|
  pacote uuid` em `src/` = **zero**. Invariante §4.7 conforme.
- **`staff-rbac-3-roles-conformant`** — `staff-auth.ts:33 STAFF_ROLES` = exatamente `bevox_admin|bevox_support|
  bevox_observer`; `requireStaff({roles})` enforça (403); JWT staff HS256 audience `bevox-backend-staff`
  distinto do Clerk RS256. Conforme §4.2/ADR-013/ADR-017.
- **`delivery-tracker-bevox-backend-converges`** **(re-verificado origin/main)** — `product_modules:bevox-backend`
  (l.781-846) converge com o código: aisuggestion, staff-rbac, m4-chatwoot-p1..p4, m5-p4-manual-payment,
  m5-p3a/p3b/p3c **delivered**; psp-br **parked→Marco 6**. Auto-documenta deferimentos ("5 LGPD prod gates
  pending", "harness inert today"). ADR-023 = visibilidade, não WBS → ausência de reminders/faq/message-template
  ≠ contradição.
- **`impersonation-id-mistreated-as-org-id`** (INFO, latente) — `organization-scope.ts:57` compara
  `impersonation_id` (row-id) com `:organization_id`; branch **morto** hoje (rotas org-scoped não usam
  `requireStaff`). Registrar para revisão RBAC.
- **`verify-staff-refresh-not-constant-time`** (INFO) — `staff-auth.ts:119` usa `===` sobre SHA-256 de token
  aleatório → timing desprezível.
- **`webhook-endpoint-drift-vs-prd-10.3`** / **`complete-strategy-workflow-canon-doc-drift`** /
  **`payment-method-enum-payment-link-vs-checkout`** / **`charge-refunded-event-name`** — **canon PRD atrás
  do código/harness** (webhook unificado do gateway; `strategy='workflow'` e `payment_method='checkout'`
  emitidos/usados; eventos `refund.*` modernos). Pela disciplina "documentação ganha" deveriam virar
  nota/ADR **no canon** (não fork local). Não são bugs de código.
- **`legal-basis-purpose-not-modeled`** (INFO) — _shared/ADR-019 aceita **explicitamente** "V1 opt-out geral
  (SEV-M-11)"; modelagem de base-legal por finalidade é deferimento aceito.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **3 primeiros somam ≈ 3h** e
destravam o caminho funcional do piloto + o gate de CI verde.

| # | Item | Esforço | Por quê primeiro |
|---|------|---------|------------------|
| 1 | **Seedar `professional_schedules` (grade Seg-Sex) + Calendar default no `seed-pilot`** | **2h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível (quebra "ver agenda"+"agendar") |
| 2 | **Corrigir o flaky `booking_notice`** (ancorar slot a `now()`-relativo) **+ `closeDb()/closeRedis()` no `afterAll`** de `calendar-booking.test.ts` | **0,5h** | Destrava o job `Tests` (§16.1); remove o RED intermitente + teardown 57P01 que mascaram regressões |
| 3 | `pnpm audit`: bump OTel (≥0.217) sob nota ADR-012 + `pnpm override` undici/tmp/vite | **2h** | Destrava o job `Security` (12 highs) — completa "CI verde" (§16.1) |
| 4 | **Unificar vocabulário de canal `wa↔whatsapp`/`ig↔instagram`** num ponto canônico + CHECK + backfill + teste e2e inbound→outbound | **4-8h** | **CRÍTICO quando a IA ligar**: faz a resposta chegar ao cliente; fecha a causa estrutural + o teste que a esconde |
| 5 | `reconcile-cron`: chamar `applyChargePaid`/`applyChargeRefunded` em vez de `UPDATE` cru | **3-4h** | Fecha a rede de webhook-perdido do passo "webhook concilia" (é o resíduo real do `pix-reconcile`) |
| 6 | Reconciliar **versão** + cortar tag SemVer capturando #39 | **1-2h** | Coloca em prod o contrato de dispatch **aceito** no canon (hoje `v1.0.1` não tem #39) |
| 7 | **Mapear `/complete(strategy='failed')→status='error'`** + aceitar/tratar `aborted_*` (ou coordenar harness a mandar `failed`) | **4-7h** | Fecha os 2 mismatches de reconciliação de erro que a evolução do harness (07-04) expôs `[xrepo]` |
| 8 | Testes de integração: `availability` (rota) + `mark-paid` (rota) + webhook Stripe + inbound→outbound vocab | **8-12h** | Rede para o hot-path do piloto; teria pego os CRÍTICOs #1 e #2 |
| 9 | OpenAPI: +5 paths client-facing + `dead_letter` no `/status` + `create-refund` no enum + teste `printRoutes()×YAML` | **6h** | Fecha o drift contrato↔rotas; atende "OpenAPI publicado" (§16.1) |
| 10 | Aplicar gate `ai_opt_out` em `cutoff.ts` antes do dispatch | **3-5h** | LGPD opt-out de IA (o piloto roda com PII real; hoje o flag é ignorado) |
| — | Atualizar `.claude/rules` + `CLAUDE.md §8` estagnados (dead-letter mechanism, #36 fechado, ponte deletada, MFA sentinel) | **1h** | Higiene de governança; as regras orientam os próprios agentes desta auditoria |

---

## Dependências cruzadas

- **bevox-harness** (moveu 07-04) — dependência do 06-23 **FECHADA**: emite `dead_letter` + consome
  `deadline_ms`/`original_execution_id`. **Mas** abriu 2 mismatches novos: emite `strategy='aborted_timeout'/
  'aborted_cost'` (backend rejeita 400) e `strategy='failed'` (backend não mapeia p/ `error`) — exigem decisão
  cross-repo. **Mitigante recorrente:** o harness segue **inerte em produção** (nenhum proposal emitido) → gaps
  de proposal/autonomia/IA-outbound não atingem um piloto staff-manual.
- **bevox-meta-api** (moveu 07-04) — usa vocabulário **pleno** `whatsapp`/`instagram` no fio
  (`meta-client.ts:525`, `messages/service.ts`) → confirma que `wa`/`ig` do backend é a **causa** do CRÍTICO
  condicional #2; `tenant_id=null` drop; `message.status_updated` sem handler.
- **Clerk** — `clerk-user-provisioning-broken` depende de webhook `organization.created` + claim
  `organization_id`; bootstrap self-serve.
- **Stripe** — Pix exige Connect KYC `active`; conciliação por webhook depende de **dois** endpoints (Connect
  + platform, ambos `requiredInProd`); refund manual não passa por webhook. **Escape do piloto:** manual-mode
  (`mark-paid` REST) satisfaz "cobrar→concilia" sem webhook.
- **Google** — OAuth redirect/watch dependem de `PUBLIC_API_BASE_URL`/`CALENDAR_OAUTH_SUCCESS_URL` (sem
  `requiredInProd` → fallback `localhost` silencioso). Só morde se Google for usado no piloto.
- **canon (ADRs aceitas não-implementadas)** — backend/ADR-009 (identidade/merge), ADR-014 (Checkout), ADR-010
  (fit-in/buffer), ADR-021 (priority-score), ADR-020 (MessageTemplate), _shared/ADR-019 (bases legais),
  _shared/ADR-020 (retenção/DSR). Mudança de decisão → ADR no canon (ADR-005), **não** fork local. Vários
  drifts nominais (webhook §10.3, `strategy='workflow'`, `payment_method='checkout'`) são **canon atrás do
  código** — merecem nota/ADR superseding.
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (`pg_uuidv7`); manifest fixa `v1.0.1`
  (que **não** tem #39 — ver `version-drift`); runbook go-live invoca `seed-pilot` (que **não** cria schedule
  nem calendar — CRÍTICO #1).

---

## Delta vs auditoria anterior (2026-06-23)

**Contexto:** código de produto **e canon** congelados desde 06-04/06-03. Quase todos os achados de código
sobrevivem **verbatim** — re-confirmados com evidência fresca por 9 domínios + verificação adversarial
(**0 refutações**, só downgrades). O valor desta passada é (a) re-verificação independente, (b) **correções
de severidade**, (c) achados que 06-23 perdeu, (d) ground-truth de CI atual, (e) delta de vizinhos.

**Fechado / corrigido (delta mais importante):**
- **`cross-repo-deadletter-deadline-dependency` → FECHADO.** O harness (07-04) agora **emite** `dead_letter`
  e **consome** `deadline_ms`/`original_execution_id`; contrato ponta-a-ponta exercitável. Era a dependência
  cross-repo aberta nº 1 do 06-23.
- **`pix-reconcile` ALTO→MÉDIO** — a manchete "charge fica pending para sempre" foi **refutada**: o cron de
  reconcile existe e roda (`reconcile.ts:131,140-150`, `queue/index.ts:143,249`) e o secret platform é
  `requiredInProd` (`env.ts:203`, fail-fast). Resíduo real = split não-documentado + cron sem orquestração.
- **`version-drift` ALTO→MÉDIO** — "4-way" desinflado (`package.json` **sempre** foi `0.1.0`; `release.yml`
  emite `type=sha`). Verdade nuclear (amendment não-lançada em SemVer) permanece.
- **`dsr-export` BAIXO→INFO** — o endpoint existe como **POC** canon-agendado (Marco-3); só a hidratação de
  `audit_events` é acionável agora.
- **`openapi-drift` cluster encolheu** — `connect-return/refresh` **agora** no YAML; webhooks stripe/google
  são exclusão **editorial documentada** (não gap).
- **`harness-contract FK #36`** confirmado **resolvido** (a suíte passa **12** — ground-truth rodado; e
  `beforeAll` semeia orgs/conversations/customers).

**Novo (não isolado em 06-23):**
- `complete-callback-rejects-harness-abort-strategies` (MÉDIO) — mismatch cross-repo exposto pela evolução do
  harness 07-04.
- `complete-failed-strategy-not-mapped-to-error` (MÉDIO) — `failed` vira `done` silencioso em modo autônomo.
- `conversations-inbox-module-absent` (MÉDIO) — Módulo 7 inbox sem rotas HTTP (crítico de completude).
- `onboarding-advance-no-prereq-arbitrary-stage` (MÉDIO) — auto-promoção sem guard (crítico de completude).
- `customer-identity-consolidation-and-merge-absent` (BAIXO) — ADR-009 + merge auto-deferido sem ADR (crítico).
- `sse-client-endpoint-drift-and-header-auth` (BAIXO) — `/api/v1/realtime` header-auth inconsumível por
  `EventSource`.
- `payment-method-enum` / `charge-refunded-event-name` / `openapi-proposal-enum-drift(waitlist-add)` /
  `legal-basis-purpose-not-modeled` (INFO/BAIXO) — drifts nominais adicionais.

**Correção de severidade (subiu):** `adr-021-priority-score` BAIXO→MÉDIO (ADR aceita não-implementada com
dimensão de segurança). Correção de escopo: ADR-022 **não** absolve os JSONBs de `autonomy_profiles` (o INFO
"policy-json zero-consumer aceito" do 06-23 conflava dois assuntos).

**Sobrevive (sem regressão):** o CRÍTICO `professional-schedules-no-writer`; `outbound-provider-vocab`
(agora ALTO, CRÍTICO-quando-IA-ligar); `rbac-org-role-not-enforced`; `clerk-user-provisioning-broken`;
`waitlist-accept-books-wrong-time`; `reconcile-cron-*`; buffer/fit-in dead columns; `domain-prometheus-metrics`;
`rate-limit-zero-routes`; `sse-events-never-published`; `autonomy-action-granularity`; LGPD (consent/DSR/
retenção); toda a **staleness `.claude`/CLAUDE.md** (NÃO corrigida desde o bootstrap de 06-04); e os gaps de
teste de hot-path.

**CI (ground-truth 07-05 vs 06-23):** essencialmente **inalterado** — integração RED pelo mesmo flaky
`booking_notice` + teardown; `pnpm audit` **estável em 12 high** (sem escalada nesta janela, ao contrário do
salto 4→12 de 06-04→06-23). **Novidade de método:** `lint`/`openapi:check` deram RED **nesta máquina** por
**corrupção local de `node_modules`** (bytes NUL em `typescript.js`) — **não** é regressão de CI/código (o
06-23 rodou ambos GREEN; `tsc`/`build`/unit passam).

---

## Notas de método

**Orquestração.** Workflow multi-agente (opt-in "ultracode", effort máximo): **9 auditores de domínio**
(pilot-calendar, payments, channels, harness-contract, auth/rbac/tenancy, openapi/routes, lgpd,
autonomy/observability, prd/schema/governance) — cada um com a tarefa de **re-verificar** os achados do 06-23
do seu domínio contra o **código atual** com evidência fresca **e** caçar gaps novos, lendo canon de
`origin/main`. Seguidos de **verificação adversarial** (cético com default-refute) de cada achado
NOVO/alterado/CRÍTICO, e de um **crítico de completude** (o que todos perderam). 3 domínios usaram agent-types
locais deste repo (`harness-callback-auditor`, `backend-staff-rbac-reviewer`, `backend-route-reviewer`). Custo:
**31 agentes, ~1,37M tokens, 418 tool-uses, ~15 min, 0 erros, 0 resultados vazios.** Total: **95 achados** (1
CRÍTICO duro + ~6 ALTO + ~26 MÉDIO + ~38 BAIXO + ~24 INFO/conformidade), incluindo 3 do crítico de completude.

**A verificação adversarial alterou conclusões materiais** (18 confirmed, **3 downgraded, 0 refuted**):
refutou a manchete de `pix-reconcile` (ALTO→MÉDIO — cron existe + secret requiredInProd); desinflou
`version-drift` (ALTO→MÉDIO); rebaixou `dsr-export` (BAIXO→INFO — POC canon-agendado). Nenhum achado foi
totalmente refutado — o inventário do 06-23 é sólido.

**Re-verificação manual independente** (eu, fora do workflow) dos achados-manchete: reli `availability.ts`/
`booking.ts` (gate `!sched`, **zero writers** de `professional_schedules` por grep exaustivo em `src/`/
`scripts/`/`db/`), `normalize.ts`/`metaapi/repository.ts:197`/`seams.ts:360` (cadeia provider ponta-a-ponta,
**zero tradução `wa→whatsapp`**), `seed-pilot.ts` (só 4 inserts), o cluster de staleness `.claude`/CLAUDE.md,
e os vizinhos (`bevox-harness` emite `dead_letter`/consome `deadline_ms`; `bevox-meta-api` usa vocab pleno).

**Ground-truth de CI rodado de fato** (não inferido): `format:check`/`typecheck`/`unit(469)`/`build` =
**GREEN**; `pnpm test:integration` = **RED exit 1** (1 falha real `calendar-booking booking_notice` — flaky
por hora-do-dia, rodado às ~09:0x UTC → `expected 'slot_conflict', got 'booked'`; + teardown 57P01; as outras
17 suítes passam); `pnpm audit --audit-level high` = **RED exit 1, 12 high / 27 total** (idêntico ao 06-23).
`lint` e `openapi:check` = **RED por artefato local** — `node_modules/.../typescript.js` (gitignored) com
**bytes NUL** (linha 183109 `en\0Line`); só `require('typescript')` quebra (`tsc`/`build`/vitest usam bundles
íntegros). **Excluído do status de CI** (um `pnpm install` limpo no runner não é afetado; o 06-23 rodou ambos
GREEN). `.nvmrc`=22; Node local v22.22.2 — o Node não é a causa, o arquivo está corrompido em disco.

**Canon.** Lido por path absoluto `~/bevox-knowledge` (consume-by-reference, ADR-005), **sempre de
`origin/main`** (`git -C … show origin/main:<path>`) — o working tree está na branch
`fix/a14-bevox-meta-api-ig-callback-spec`, que diverge e foi a origem do falso-positivo de 06-04. `origin/main`
congelado @ `7874971` (2026-06-03). Numeração de ADR **colide** entre namespaces (backend/ vs _shared/ vs
harness/) — sempre qualificada.

**Limitações.** (1) Severidades calibradas para o gate do **piloto** (login→agenda→paga); para GA vários
ALTO/MÉDIO sobem — em particular `outbound-provider-vocab` vira CRÍTICO no instante em que a IA ligar. (2)
OSV Scanner / CodeQL não reproduzíveis offline (estados inferidos do lockfile/config). (3) Caminho live
(Stripe/Clerk/harness/Meta reais) não exercitado — verdicts derivam de leitura de código + schema + canon
`origin/main` + ausência comprovada de writers/endpoints. (4) MCP `stripe`/Google Drive requerem
autenticação interativa — indisponíveis nesta sessão headless.

---

*Gerado autonomamente por Claude Code (headless, model Opus 4.8) em 2026-07-05. Sem alteração de código de
produto; somente este relatório. Revisão humana pendente.*
