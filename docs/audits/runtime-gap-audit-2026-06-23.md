# Gap Analysis — bevox-backend — 2026-06-23

> Auditoria canônica autônoma (headless, effort máximo). Escopo: tudo o que falta para
> terminar o módulo segundo a documentação canônica (PRD V1 + ADRs **aceitas**), com foco no
> gate do **piloto** (1º cliente real: login → ver agenda → agendar → cobrar → webhook concilia).
> Método: Workflow multi-agente (**38 agentes / ~2,29M tokens / 779 tool-uses / ~12,8 min**) —
> 12 auditores de domínio + verificação adversarial por achado NOVO/alterado — sobre código
> **congelado desde a auditoria 06-04** (git: só `.claude/`, `.gitignore`, `CLAUDE.md` mudaram).
> Ground-truth de CI **rodado de fato** (não inferido) e re-verificação manual independente dos
> achados de maior consequência (inclui resolução de canon em **origin/main**, não no working
> tree). Detalhe em **Notas de método**. Sucede `runtime-gap-audit-2026-06-04.md`.

## Resumo executivo

O backend segue **maduro como fundação e perto do piloto, mas não pronto** — e o estado é, no
essencial, **idêntico ao de 06-04** porque o código de produto não mudou desde então (a única
entrega pós-06-04 foi o bootstrap do `.claude/`). Os **2 CRÍTICOs do piloto persistem verbatim**
(re-confirmados em código frozen + canon): (1) **nenhum caminho escreve `professional_schedules`**
→ após o seed a agenda fica vazia e todo agendamento dá `slot_conflict` (quebra "ver agenda" e
"agendar"); (2) **vocabulário de canal divergente** (`wa`/`ig` no inbound vs `whatsapp`/`instagram`
no outbound) → a resposta da IA é silenciosamente descartada (mitigado num piloto puramente
staff-manual, pois o modo default é `manual_assisted` e o seed não cria `autonomy_profile`).

O **CI continua vermelho** nos dois jobs mensuráveis de Marco-1 (§16.1 "CI verde"), e a composição
do RED **piorou** desde 06-04: além do *teardown* 57P01 de `calendar-booking` (carry), há agora um
**teste flaky por hora-do-dia** (`booking_notice`) que falha deterministicamente antes de ~13:00 UTC
— a causa real do RED de integração nesta sessão, que o 06-04 não isolou; e o `pnpm audit` saltou de
**4 → 12 highs** no mesmo lockfile congelado (crescimento da base de CVEs), com o job `Security`
hard-gated. A lente charge-flow segue **sólida** (idempotência tripla, dedupe de webhook,
orquestração `applyChargePaid`/`applyChargeRefunded` compartilhada entre webhook e modo manual,
PCI-scope nulo); o resíduo é a **rede de webhook-perdido** (crons de reconciliação que dão `UPDATE`
cru sem orquestração) e a **ausência de testes de integração** no caminho Stripe-real.

**Correção de maior peso vs 06-04 (delta principal):** o achado-manchete de governança de 06-04 —
`dispatch-contract-amendment-sem-base-canonica` ("fork de spec, viola ADR-005") — é **FALSO
POSITIVO** e fica **retirado**. O amendment de dispatch (`deadline_ms`, `original_execution_id`,
`dead_letter` no `/status`) **está canonizado e aceito em origin/main** (PRD §10.4 "AMENDMENT
2026-06-03"; **backend/ADR-019 "Amendment 1 (2026-06-03)"**); o código (#39) é **fiel ao canon**. A
causa do erro de 06-04 (e de uma 1ª passada desta auditoria): o **checkout local do canon está numa
feature branch** (`fix/a14-bevox-meta-api-ig-callback-spec`) que **não contém o merge do amendment**
— greps no working tree dão zero. Lição de método registrada: **ler canon de `origin/main`**.

Estado: **caminho de fechamento do piloto curto** — os 2 CRÍTICOs + o gate de CI (flaky + teardown +
bump de deps) somam **≈ 10-12h**. Severidades calibradas para o gate do piloto; para GA vários
ALTO/MÉDIO sobem.

---

## Achados por severidade

Legenda: `(v: <veredito>)` = verificação adversarial (`confirmed`/`downgraded`/`refuted`);
**(re-verificado)** = também confirmei manualmente abrindo os arquivos/canon; `[xrepo: …]` =
dependência cruzada; `[NOVO]` / `[carry]` / `[Δsev]` / `[fechado]` = status vs 06-04. Calibração
ancorada em PRD §16 (§16.1 Marco-1 = "CI verde" + módulos auth/orgs/users/professionals/services/
customers + OpenAPI + contrato harness; §16.2 Marco-2 = calendar/channels/ai/autonomia/idempotência/
métricas; §16.3 Marco-3 = payments/LGPD/MFA/reminders/circuit-breaker). Itens listados em §16.2/§16.3
são **deferimentos legítimos** — só sobem de severidade quando o piloto os exercita (payments e PII
**são** exercitados no piloto, apesar de §16.3).

### CRÍTICO (bloqueia piloto)

- **`professional-schedules-no-writer-blocks-availability`** `[carry]` **(re-verificado)** —
  Nenhum caminho de produção (REST, seed ou migration) escreve `professional_schedules` (a jornada
  semanal base). `availability.ts:116` faz `SELECT … FROM professional_schedules WHERE professional_id=? AND day_of_week=?`
  e `:126 if (!sched) continue;` — um profissional sem linha-base para o dia é pulado e o dia sai
  vazio. O **único `INSERT` no repo inteiro** é a fixture `test/integration/calendar-booking.test.ts:120`
  (helper `seedFullSchedule`); `scripts/seed-pilot.ts` cria org/staff/professional/service e **nada
  mais** (confirmado pelo output do `seed-pilot.test.ts`: só 4 IDs). A única rota de schedule
  (`calendar/routes.ts:41` → `createScheduleOverride`) grava só `professional_schedule_overrides`
  (exceções pontuais). — Impacto: `GET …/availability` devolve dias vazios e `createAppointment`
  (`booking.ts:200-207`) retorna sempre `slot_conflict`. Quebra "ver agenda" e "agendar"; **sem
  workaround de produto**. Escopo Marco-1 explícito (PRD §5.3 "grade fixa", entidade WeeklySchedule
  §11.1), **não** deferimento. O seam de IA (`seams.ts:223` → `createAppointment`) bate no mesmo
  `slot_conflict`. — Esforço: **2h** (seedar grade Seg-Sex no `seed-pilot` alinhada à fixture) a
  **6-8h** (endpoint CRUD WeeklySchedule + OpenAPI + teste). **#1 por valor/esforço.**

- **`outbound-provider-vocab-mismatch-drops-delivery`** `[carry]` **(re-verificado)** — Inbound
  persiste provider **abreviado** `wa`/`ig` (`normalize.ts:16,35,44`; `routes.ts:237,246` grava
  `channel_connections.provider='wa'`), mas o outbound só reconhece o **pleno**:
  `metaapi/repository.ts:197` `provider = r.provider==='whatsapp'||r.provider==='instagram' ? r.provider : null`
  → com `cc.provider='wa'`, `provider=null`. `seams.ts:360` (`if (!ctx||!ctx.provider||!ctx.customerPhone)`)
  dispara → `:376 skipped_missing_recipient` (audita `metaapi.send.skipped`, **não** erro). **Não há
  tradução `wa→whatsapp` em lugar nenhum** (grep exaustivo). Os testes mascaram: outbound semeia
  `provider='whatsapp'` à mão (`channels-metaapi-outbound.test.ts:86`), inbound afirma `provider='wa'`
  (`channels-metaapi-inbound.test.ts:373`). `db/schema/channels.ts:22` é `text` sem CHECK → aceita
  qualquer literal. — Impacto: 100% das respostas de IA de conversas reais (webhook Meta) são
  computadas e descartadas em silêncio. **Caveat (verificado):** o modo default é `manual_assisted`
  (`autonomy/resolver.ts:28,62`; `db/schema/autonomy.ts:29`) e o `seed-pilot` **não cria
  `autonomy_profile`**, então a org-piloto roda manual; a entrega só ocorre no *approve* humano
  (`service.ts:68`). Um piloto puramente staff-manual (login→agenda→paga, **sem aprovar sugestão de
  IA**) **não dispara** o drop; vira bloqueador duro no instante em que a IA for ligada. — Esforço:
  **2-4h** (unificar `wa↔whatsapp`/`ig↔instagram` num ponto canônico + backfill + teste e2e com o
  vocabulário do inbound) `[xrepo: bevox-meta-api — glossário §10.3 usa `whatsapp`/`instagram`]`

### ALTO (bloqueia GA / gate de CI; não bloqueia o caminho funcional do piloto)

**Gate "CI verde" (§16.1 — único critério Marco-1 mensurável; nenhum é defeito de runtime de produto)**

- **`ci-tests-red-flaky-booking-notice-and-57P01-teardown`** `[NOVO+carry]` **(re-verificado)** —
  O job `Tests` (`ci.yml:73,80` roda unit **e** integration) está RED por **duas** causas em
  `calendar-booking.test.ts`: (a) **`[NOVO]` flaky por hora-do-dia** — `:246-260` seta
  `booking_notice=1440min` e agenda "amanhã 10:00", esperando `slot_conflict`; mas `tomorrowIso()`
  (`:138-142`) é data UTC e `booking.ts:181` interpreta na tz do calendar (default `America/Sao_Paulo`,
  `db/schema/calendar.ts:35`), então o slot é "amanhã 13:00 UTC". O gate (`booking.ts:191-197`
  `startTs < now()+1440min`) só dá `slot_conflict` se `now() > ~13:00 UTC`. Nesta sessão (06:0x -03 =
  09:1x UTC) → retorna `booked` → **assert falha** (`expected slot_conflict, got booked`) — exatamente
  o RED observado. O próprio comentário do teste (`:248-249`) admite a fragilidade. O 06-04 atribuiu o
  RED **só** ao teardown e não viu isto. (b) **`[carry]` teardown 57P01** — `afterAll:185-189` chama só
  `pool?.end()` + `container.stop()`, **nunca** `closeDb()`/`closeRedis()` (única das 11 suites que
  chamam `initDb` sem `closeDb`); ao parar o container, conexões idle do pool singleton recebem 57P01
  e `db/client.ts` re-emite como `uncaughtException` → exit 1 mesmo com asserts verdes (2 erros
  observados). — Impacto: mantém `Tests` RED (viola §16.1) e mascara regressões futuras. Produção OK
  (booking.ts está correto; o bug é só no teste/teardown). — Esforço: **0,5h** (ancorar o slot a uma
  data fixa/relativa ao `now()` + `await closeDb()/closeRedis()` no `afterAll`). (v: a 2ª-opinião
  divergiu — um cético confirmou ALTO, outro rebaixou a parte flaky a BAIXO por ser "test-only"; mantido
  **ALTO** por manter o gate §16.1 RED ativamente).

- **`ci-security-red-pnpm-audit-12-high`** `[Δsev: BAIXO→ALTO]` **(re-verificado; v: confirmed)** —
  `pnpm audit --audit-level high` = **RED exit 1**, "27 vulnerabilities … 12 high" (06-04 tinha 4).
  Lockfile **congelado** (último toque 2026-05-19) → a escalada é puro crescimento da base de
  advisories. **7 highs prod-runtime** (via cadeia OpenTelemetry/grpc: `@grpc/grpc-js@1.14.3` ×2,
  `@opentelemetry/{auto-instrumentations-node,sdk-node,exporter-prometheus}` ×3, `protobufjs` ×2) e
  **5 test-only** (`undici@7.25.0` ×3, `tmp@0.2.5`, `vite` — via `testcontainers`/`vitest`).
  `security.yml:38-39` roda exatamente isso com `continue-on-error:false` → job hard-fail; o passo
  `osv-scanner --lockfile` (`:27`, sem floor de severidade) provavelmente também RED. — Impacto:
  mantém `Security` RED (2º gate §16.1). Todos são **transitivos**; os 5 test-only têm zero superfície
  de prod; a crash do exporter Prometheus só é alcançável pelo `/metrics` (que é **não-autenticado**,
  ver BAIXO). — Esforço: **2h** (bump OTel ≥0.217 sob nota ADR-012 + `pnpm override` undici≥7.28 /
  tmp≥0.2.6 / vite-patched).

**Auth / RBAC / provisionamento (pré-GA; mitigados no piloto de 1 org / 1 admin)**

- **`rbac-org-role-not-enforced`** `[carry]` **(re-verificado)** — `requireRole` **não existe** (grep
  retorna só 3 comentários TODO: `types/global.d.ts:35`, `auth/repository.ts:261`, `clerk-auth.ts:25`).
  Toda rota de produto monta apenas `[requireClerkAuth, requireOrganizationScope]` (+`requireIdempotency`
  em writes); `req.user.role` **é** resolvido (`clerk-auth.ts:183`) mas consumido por **zero** handler.
  PRD §5.1 exige RBAC por organization (owner/admin/operator/professional_viewer) — **não** deferido.
  — Impacto: qualquer membro autenticado (inclusive `professional_viewer`) pode mutar todos os recursos
  da própria org. Blast-radius baixo no piloto (1 org, 1 `bevox_admin` seedado, auth por claims). —
  **Armadilha forward-looking:** `resolveLocalUser` (`clerk-auth.ts:126-139`) é **fail-open** (retorna
  `null` em erro de DB **e** quando não-provisionado); quando `requireRole` finalmente consumir o role,
  o `null`-por-erro precisa **fail-closed**. — Esforço: **8-12h** `[xrepo: canon ADR-013]`

- **`clerk-user-provisioning-broken`** `[carry]` **(re-verificado)** — `auth/repository.ts:221-224`
  `findOrganizationByClerkOrg` faz `SELECT organization_id FROM users WHERE clerk_user_id=${clerkOrgId}`
  (compara org-id com coluna user-id); não há branch `organization.created` no webhook Clerk
  (`auth/routes.ts:165-190` só `user.*`); sem tabela de mapping clerk-org→bevox-org. O único `INSERT
  INTO users` só roda se a função retornar org → no-op para org/user novos. PRD §8.5:902-905 manda
  `organization.created → INSERT Organization + User (owner)`. — Impacto: nenhuma org é provisionada no
  signup; self-serve quebrado. Mitigado no piloto (bootstrap via `seed-pilot` + auth por claims). —
  Esforço: **8-12h** `[xrepo: Clerk — webhook organization.created + claim organization_id]`

**Agenda / Pagamentos (caminho do piloto; fail-silent)**

- **`pix-reconcile-depends-on-second-stripe-endpoint`** `[carry; mantido ALTO]` **(re-verificado)** —
  `payment_intent.succeeded` → `applyChargePaid` vive **só** em `webhook-platform.ts:99-120` (secret
  `STRIPE_WEBHOOK_SECRET_PLATFORM`, endpoint `/webhooks/stripe/platform`); o endpoint Connect-scoped
  `webhook.ts` só trata `account.updated` (`:65`) e os demais tipos caem em `markWebhookProcessed`+200
  sem ação (`:109-110`; o comentário "P2 estende o MESMO switch" nunca foi honrado — criou-se um 2º
  arquivo). **backend/ADR-014:134,168 descreve UM endpoint** tratando todos os tipos; o código exige
  **dois** corretamente escopados. — Impacto: se o operador configurar só o endpoint Connect (ou faltar
  o `whsec_` do platform), `payment_intent.succeeded` do Pix é aceito com **200 silencioso** e nunca
  concilia → charge fica `pending` para sempre e o appointment nunca confirma — o passo final do piloto
  ("cliente paga → concilia") falha sem erro. Mitigado: o **modo manual** (default do piloto) não passa
  por webhook. — Esforço: **3h** (runbook como hard-gate + startup-assert dos 2 secrets, ou colapsar p/
  um endpoint) `[xrepo: Stripe]`

- **`waitlist-accept-books-wrong-time`** `[carry]` **(re-verificado)** — `waitlist/routes.ts:113-127`
  usa `full.offered_at` (instante da oferta, gravado em `service.ts:66-71`) como horário do appointment;
  o slot real (`slot_start_at`) vive só em `waitlist_match_outbox` (`db/schema/calendar.ts:237`), nunca
  em `waitlist_entries`. Só morde `mode='offer'` (default `auto_book` usa o slot correto, `service.ts:102-113`).
  — Esforço: **4-6h** (persistir `slot_start_at` no entry no momento da oferta + migration + teste).

- **`calendar-google-oauth-urls-not-required-in-prod`** `[carry]` — `PUBLIC_API_BASE_URL` e
  `CALENDAR_OAUTH_SUCCESS_URL` **não** são `requiredInProd` (`env.ts`); `google/sync.ts:449` e
  `google/oauth.ts` caem em `localhost` por default. — Impacto: se a org-piloto conectar Google, OAuth
  callback/watch registram URLs `localhost` e falham em silêncio num go-live que esqueça as envs ("verde
  mas quebrado"). Só morde se Google for usado no piloto. — Esforço: **1h** `[xrepo: Google / hub infra]`

### MÉDIO (degrada qualidade)

**Pagamentos / reconciliação**
- **`reconcile-cron-flips-paid-without-orchestration`** `[carry]` — `reconcile.ts` mapeia
  `pi.status==='succeeded' → UPDATE charges SET status='paid'` via SQL cru, **sem** `applyChargePaid`:
  uma charge que pagou mas perdeu o webhook (o cenário exato que o cron existe para corrigir) é
  reconciliada a `paid` **sem** row em `payments` (§8.4 passo 8), sem confirmar o appointment (passo 10),
  sem grant de pacote, sem audit. — Esforço: **4h**
- **`reconcile-cron-skips-refunded-and-grant-on-cancel`** `[carry]` — lado refund do mesmo cron não
  dispara `applyChargeRefunded`. — Esforço: **3h**
- **`stripe-webhook-zero-integration-tests`** `[carry]` — as rotas de webhook Stripe (passo final do
  piloto) têm **zero** integração; só unit com `constructEvent` mockado. Pode usar
  `stripe.webhooks.generateTestHeaderString` sem rede. — Esforço: **8h** `[xrepo: Stripe]`

**Agenda / Calendar**
- **`availability-http-endpoint-zero-integration-coverage`** `[NOVO]` **(v: confirmed)** — `grep
  availability test/integration/*` = ZERO; a rota `GET /calendars/:id/availability` (1º elo "ver
  agenda") nunca é exercitada e2e; a engine só é tocada indiretamente por `createAppointment` e por unit
  de funções puras. Permitiu o CRÍTICO #1 passar despercebido (não há teste e2e que mostre dias vazios).
  — Esforço: **3h**
- **`seed-pilot-creates-no-calendar`** `[carry]` — `seed-pilot` não cria Calendar default; 2º elo de
  bootstrap quebrado de "ver agenda" (workaround canônico `POST /calendars`). — Esforço: **1-2h**
- **`transition-reschedule-prepay-zero-integration-coverage`** `[carry]` — `transitionAppointment`
  (cancel/confirm/complete/no_show + sync-outbox + re-match waitlist), `rescheduleAppointment` e o hook
  `requires_prepayment→createCharge` sem teste de integração. — Esforço: **8h**
- **`google-sync-waitlist-runtime-no-integration-tests`** `[carry]` — `google/sync.ts` (engine de
  sync) e o runtime de waitlist (CAS/outbox/offer/auto_book) sem integração. — Esforço: **20h**
- **`buffer-before-after-minutes-dead-columns`** `[carry]` — `services.buffer_before/after_minutes`
  (PRD §5.2) são colunas mortas; `availability.ts`/`booking.ts` ignoram buffer. — Esforço: **6h** `[xrepo: canon ADR-010]`
- **`fit-in-encaixe-ausente`** `[carry]` — encaixe (§5.3) + flags `allow_fit_in`/`max_fit_ins_per_slot`
  (§5.2) existem no schema (`catalog.ts`) mas zero lógica os consome. — Esforço: **16h**
- **`waitlist-match-utc-vs-calendar-tz`** `[carry]` — `match.ts` compara janela em UTC, não no fuso do
  calendar (erra perto da meia-noite em America/Sao_Paulo). — Esforço: **6h**
- **`manual-booking-path-divergence-and-missing-audit-sse-creator`** `[carry]` — PRD §8.3 pede
  `POST /organizations/:id/appointments {start_at}`; código expõe `POST …/calendars/:id/appointments
  {date,start_time}` (+ ausência de AuditEvent/SSE de criação). — Esforço: **4h**

**Canais (cross-repo bevox-meta-api)**
- **`tenant-id-null-silent-drop`** `[carry]` — evento inbound com `tenant_id=null` aceito/persistido mas
  nunca despachado (drop silencioso). — Esforço: **3h**
- **`message-status-updated-no-handler`** `[carry]` — o backend assina os 5 tipos de evento
  (`server.ts:249-255`) mas só trata `message.received`; `message.status_updated` (confirmação de
  entrega real) sem handler. — Esforço: **2-6h** `[xrepo: bevox-meta-api]`

**Identidade / onboarding**
- **`webhook-user-always-operator`** `[carry]` — `upsertUserFromClerk` insere role literal `'operator'`;
  §8.5 manda 1º user ser `'owner'`. Acoplado a `clerk-user-provisioning-broken`. — Esforço: **6h**
- **`org-role-management-and-self-demote-guard-missing`** `[carry]` — sem endpoint de role-management na
  org nem guard §12.2.3 (admin não altera próprio role); `users` read-only. — Esforço: **8h**

**Autonomia / IA (harness inerte em prod — blindado do piloto staff-manual)**
- **`autonomy-action-granularity-not-enforced`** `[carry]` — `allowed_actions`/`required_approvals`/
  `confidence_thresholds` (JSONBs) + `fetchOrgAutonomyPolicies`/`PolicyEvaluator` (`autonomy/seams.ts`)
  com **zero callers de produção**; `resolver.ts` ainda gateia só por `current_mode`. — Esforço: **16h** `[xrepo: PRD §5.5 + bevox-harness]`
- **`ADR-021-priority-score-waitlist-no-compute`** `[carry]` **(re-verificado em canon)** —
  backend/ADR-021 (aceita) manda `priority_score` **system-derived** (`MAX(0, age_hours + urgency_level×100 − skip_count×10)`)
  e **depreca input do cliente** (server ignora); o código ainda aceita e persiste o `priority_score`
  do cliente verbatim (`waitlist/routes.ts` → `repository.ts`); sem colunas `urgency_level`/`skip_count`,
  sem compute, sem cron de recompute. O vetor "cliente infla a própria prioridade" segue aberto. — Esforço: **8h** `[xrepo: canon backend/ADR-021]`

**LGPD (Marco-3 por §16.3, mas o piloto roda com PII real)**
- **`consent-and-ai-opt-out-stored-not-applied`** `[carry]` — `customers.ai_opt_out` é gravado mas
  **nunca consultado** no pipeline (`cutoff.ts` dispara ao harness sem lê-lo): um cliente que pede "não
  use IA comigo" ainda tem a conversa mandada ao LLM (transferência internacional, _shared/ADR-019). —
  Esforço: **8h**

**Observabilidade / SSE / rate-limit / resiliência (§16.2/§16.3)**
- **`domain-prometheus-metrics-not-registered`** `[carry]` — métricas de domínio (§12.10:
  `charges_succeeded_total`, `appointments_no_show_rate`, `executions_pending_approval_count`…) não
  existem (`grep=0` em `shared/metrics.ts`); HTTP/queue metrics existem. §16.2 pede "métricas Prometheus
  mínimas". — Esforço: **6h**
- **`rate-limit-§12.6-zero-routes-enforced`** `[carry]` — plugin registrado e expõe `requireRateLimit()`
  mas **nenhuma rota o aplica** (`grep=0`); o sliding-window é código morto no request-path. — Esforço: **3h**
- **`sse-appointment-charge-events-never-published`** `[carry]` — `realtime/publish.ts` só publica
  `execution.*`; `appointment.created/updated` e `charge.updated` (§8.3/§8.4/§10.1) nunca são emitidos
  → a tela do profissional não auto-atualiza no pagamento. — Esforço: **5h**
- **`circuit-breaker-opossum-absent`** `[carry]` — nenhum circuit breaker em integrações externas
  (§7.5/§12.7/§16.3); `stripe-client.ts` sequer configura timeout/`maxNetworkRetries`. Deferimento
  Marco-3; alvo primário (LLM) inerte no piloto. — Esforço: **6-10h** (dep `opossum` dispara gate §6)

**Governança / release**
- **`version-drift-4way`** `[Δsev: BAIXO→MÉDIO]` **(re-verificado; v: confirmed)** — Além do
  descasamento cosmético (`package.json 0.1.0` / `openapi 1.11.0` / tag `v1.0.1` / placeholder
  `vX.Y.Z`), **HEAD está 24 commits à frente da única tag de release** (`v1.0.1` @ `9a88116`,
  2026-06-01). `release.yml:5` só builda imagens em tags `v*.*.*` → a imagem GHCR `:v1.0.1` (digest que
  o manifest do hub fixa) **não contém** o amendment de dispatch (#39), o fix do migrator do seed-pilot,
  o guard de media-only, nem a limpeza de CI. — Impacto: se o hub fixa `:v1.0.1`, prod roda código
  pré-amendment; se alguém cortar tag de `main` agora, sobe o estado atual. — Esforço: **1h** (decidir
  fonte única de versão + reconciliar antes do próximo release) `[xrepo: hub release.yml]`

### BAIXO (higiene)

**OpenAPI / contrato (drift silencioso — `@fastify/swagger` mode:'static')**
- **`openapi-drift` (cluster)** `[carry]` — handlers vivos ausentes do YAML (`GET/PATCH /autonomy`,
  `payment-account/policy`, `GET /realtime` SSE, `GET /channel-connections`, `customers/:id/export`,
  webhooks Google, webhooks Stripe principal/platform/connect-return/refresh) e enums defasados
  (`ExecutionProposal.action` sem `create-refund`; `payment_method` sem `checkout`). Direção inversa
  (YAML sem handler) ≈ vazia. — Esforço total: **~6h**
- **`openapi-status-callback-sem-dead-letter`** `[reframe]` **(re-verificado)** — o YAML do callback
  `/status` lista `[running,paused,cancelled]`; o **canon (origin/main §10.4) e o código já têm
  `dead_letter`** → é o **YAML que está atrás** de canon+código (não fork de código). — Esforço: **0,5h**
- **`openapi-no-route-contract-test`** `[carry]` — recomendado teste de contrato `printRoutes()×YAML`
  (o mode:'static' torna o drift invisível). — Esforço: **2h**
- **`complete-callback-strategy-workflow`** `[carry; baixa confiança]` — `strategy='workflow'` (PR#20)
  no enum de `/complete`; **verificar contra canon §10.4 em origin/main** antes de tratar como gap (o
  cluster de amendment provou que o working tree do canon está desatualizado). — Esforço: **0,5h**

**`.claude/` config (bootstrapado em bfe7095 — pós-06-04; estes são NOVOS)**
- **`rules-dead-letter-writer-mechanism-wrong`** `[NOVO]` **(v: confirmed)** — `.claude/rules/backend-harness-contract.md:46`
  e `backend-workers.md:20` afirmam que `dead_letter` é setado por `worker.on('failed')` na tentativa
  final — **não existe tal writer**: o backend é **producer-only** na fila de dispatch (`queue/index.ts:7-8`;
  `harness-dispatcher.ts:107` só `.add()`); `dead_letter` é setado pelo callback `PATCH /status='dead_letter'`
  do harness (`harness-callbacks.repository.ts:86-120`). A regra que governa esta auditoria descreve um
  mecanismo inexistente. — Esforço: **0,5h**
- **`claude-config-stale-deleted-bridge-and-closed-issue36`** `[NOVO]` **(v: confirmed)** —
  `.claude/rules/backend-tests.md` ainda cita "harness-contract tem 5 falhas FK (issue #36)" mas a suite
  **passa 12 testes** (issue #36 fechada); a rule `backend-tenancy.md`/README citam a ponte
  `resolve-organization-id.ts` que **não existe**. — Esforço: **0,5h**
- **`claude-md-section8-mfa-sentinel-doc-stale`** `[NOVO]` **(v: confirmed)** — `CLAUDE.md:171` diz que
  o seed grava `mfa_secret=PILOTSEEDONLYNOTASECRET`; o seed real (`seed-pilot.ts:153-154`) gera secret
  base32 aleatório e **bloqueia** o sentinel em seed-time (`assertMfaSecretNotPlaceholder`). A conclusão
  do §8 (não rejeitar no login; MFA é Marco-3) segue correta. — Esforço: **0,25h**
- **`rules-idempotency-adr-number-collision`** `[NOVO; INFO]` — regra cita número de ADR errado para
  idempotência (colisão de namespace backend/ vs _shared/). — Esforço: **0,25h**

**LGPD / DSR (Marco-3 §16.3)**
- **`consent-granted-at-write-never`** `[NOVO]` **(v: confirmed)** — `customers.consent_granted_at`
  (coluna declarada, §12.9:1303) **nunca é escrita nem lida** (ausente de `schemas.ts` e do FIELD_MAP do
  `repository.ts`; `grep=0` writers). Distinto de `ai_opt_out` (que é escrito). Sem registro de
  proveniência/revogação de consentimento (LGPD art. 8). — Esforço: **2h**
- **`message-records-not-customer-org-scoped-blocks-dsr`** `[carry]` — `message_records` (PII) só tem
  `conversation_key`, sem `organization_id`/`customer_id` → bloqueia DSR export/deleção reais. — Esforço: **10h**
- **`no-dsr-deletion-endpoint`** `[carry]` — nenhum `app.delete` em `customers/`; nada escreve
  `deleted_at`/`archived_at`. — Esforço: **16h** `[xrepo: _shared/ADR-020]`
- **`retention-worker-adr020-absent`** `[carry]` — nenhum worker de retenção; PII acumula sem TTL. —
  Esforço: **40h** `[xrepo: _shared/ADR-020]`
- **`redaction-exposes-pii-debug-trace`** `[Δsev: MÉDIO→BAIXO]` **(re-verificado; v: confirmed)** —
  `redactors.ts:69-72` omite PII em debug/trace, **mas** `env.ts:215-221` rejeita `LOG_LEVEL∈{debug,trace}`
  em produção (boot falha) → o vetor de vazamento em prod que o 06-04 temia está **fechado**; resíduo só
  em não-prod. Sem teste cobrindo redaction. — Esforço: **2h**

**Pagamentos (resíduos)**
- **`mark-paid-no-success-assert`** `[Δsev: MÉDIO→BAIXO]` **(re-verificado; v: confirmed)** — a lógica
  de `mark-paid` (caminho de conciliação que o piloto **usa**) **é** testada contra Postgres real no
  nível de service (`payments-manual-mode.test.ts:367-390` asserta `pending→paid`, 1 row em `payments`,
  audit, grant) — o 06-04 errou ao dizer "sem it() que asserte". Resíduo real estreito: falta o teste de
  **rota** (`app.inject` em `POST /charges/:id/mark-paid` com auth+org-scope). — Esforço: **1h**
- **`requires-prepayment-hook-fails-for-manual-only-pilot-org`** `[NOVO]` **(v: confirmed)** — o hook
  `requires_prepayment` (`booking.ts:299`) chama `createCharge` (caminho Stripe, `service.ts:190-197`),
  que lança "payment account not active" numa org **manual-mode** (sem KYC Stripe). Mitigado: hook é
  best-effort não-fatal (audita `charge.hook_failed`, mantém o appointment) **e** o service seedado tem
  `requires_prepayment=false` (não dispara). — Esforço: **2h** `[xrepo: ADR-023 vs ADR-014]`
- **`payment-link-checkout-stub`** `[carry]` — backend/ADR-014 lista Checkout/payment-link como método
  V1; código = Pix + stub 501 (#29). Piloto coberto por Pix+manual. — Esforço: **16h** `[xrepo: ADR-014]`
- **`charge-route-path-pix-vs-prd`** `[carry]` — `POST /organizations/:id/charges` vs PRD §5.6
  `POST /appointments/:id/charges`. — Esforço: **1h**

**Canais (estrutural / cross-repo)**
- **`channel-provider-vocab-drift-vs-canon-glossary`** `[NOVO]` **(v: confirmed)** — as abreviações
  `wa`/`ig` (`normalize.ts:16,35,44`) são invenção backend-only; canon §10.3 e o contrato de fio da
  meta-api (`send-message-intent.ts:14` → `client.ts:158` `POST /v1/messages`) usam `whatsapp`/`instagram`.
  Sem CHECK em `channel_connections.provider`/`customer_channels.provider` (ambos `text` livre). É a
  **causa estrutural** do CRÍTICO #2 — o fix definitivo é adotar o vocabulário canônico ponta-a-ponta +
  CHECK, não só corrigir o `repository.ts:197`. — Esforço: **2h** `[xrepo: bevox-meta-api]`
- **`non-message-events-no-handler`** / **`ig-outbound-missing-recipient`** / **`hmac-subscription-active-limit1`**
  `[carry]` — deferimentos V1 / cross-repo. — Esforço: **2-6h cada**

**Autonomia / observabilidade (resíduos)**
- **`autonomy-readiness-score-never-computed`** `[carry]` — `autonomy_profiles.readiness_score` lido/retornado
  mas nunca computado (`GET /autonomy` sempre `null`). — Esforço: **8h** `[xrepo: harness ADR-018]`
- **`autonomy-patch-nontransactional-mode-audit`** `[carry]` — `applyProfilePatch` faz UPDATE + INSERT
  de audit em 2 chamadas não-transacionais (modo muda sem AuditEvent se a 2ª falha). — Esforço: **3h**
- **`escalation-request-human-no-sse`** `[carry]` — `request-human` faz conversation→waiting_human + audit
  mas não publica SSE (o union de `realtime/publish.ts` nem tem evento de conversa). — Esforço: **2h**
- **`metrics-endpoint-unauthenticated`** `[carry]` — `GET /metrics` (`health/routes.ts`) sem auth nem
  rate-limit; expõe `organization_id` como label. Mitigado por topologia (network policy do hub). — Esforço: **1h**
- **`http-metrics-route-label-unbounded-on-404`** `[Δsev; v: confirmed]` — `server.ts:163` usa
  `req.routeOptions?.url ?? req.url` — para rotas casadas é estável (mitigação parcial vs 06-04), mas em
  404 o `setNotFoundHandler` não seta um padrão wildcard → cai em `req.url` cru → cardinalidade ilimitada
  sob varredura. — Esforço: **1h**
- **`idempotency-approve-header-key-not-actor-serialized`** / **`idempotency-ttl-no-per-route-override`**
  `[carry]` — resíduos de §12.3/§15.6 (aprovadores concorrentes não serializados; TTL hardcoded 86400). — Esforço: **2-3h**

**Schema / completude (deferimentos Marco-2/3 explícitos §16)**
- **`section-11-1-entities-absent`** `[carry]` — StatusHistory / OperationalMetricSnapshot /
  KnowledgeInterview / HandoffEvent / ConversationAssignment ausentes do schema. — Esforço: vários
- **`module-14-reminders-absent`** / **`modules-10-11-faq-rules-absent`** `[carry]` — sem
  `reminder_sent_at`/fila; sem FAQ/OperationalRules. Marco-2/3. — Esforço: vários
- **`message-template-entity-adr020-unimplemented-untracked`** `[NOVO]` **(v: confirmed)** — backend/ADR-020
  (MessageTemplate) sem tabela/módulo e sem work-item no tracker. — Esforço: **12h**
- **`appointments-charges-executions-missing-11-3-indexes`** `[carry]` — faltam índices
  `(organization_id, status)` / `(organization_id, start_at)` que §11.3 nomeia. — Esforço: **2h**
- **`adr-021-waitlist-priority-columns-absent-schema-half`** `[carry]` — colunas `urgency_level`/`skip_count`/
  `last_score_update` ausentes (metade do schema de ADR-021). — Esforço: incl. em ADR-021 acima
- **`no-seed-pilot-npm-script`** `[carry]` — sem script npm `seed-pilot`; go-live depende de `tsx … ad-hoc`. — Esforço: **1h**
- **`calendar-crud-incompleto`** `[carry]` — só `GET`/`POST /calendars`; faltam GET-by-id/PATCH/DELETE. — Esforço: **4h**
- **`verify-staff-refresh-not-constant-time`** `[Δsev→INFO]` — `staff-auth.ts` usa `===` apesar do
  comentário; `timingSafeEqual` já existe. Hash SHA-256 de token aleatório → janela de timing
  desprezível. — Esforço: **0,5h**
- **`codeql-non-blocking-upload-never`** `[carry]` — CodeQL não falha por findings (não reproduzível offline). — Esforço: 0h

### Conformidades verificadas / não-gaps / correções (INFO)

- **`dispatch-contract-amendment` — RETIRADO (falso positivo de 06-04)** **(re-verificado; v: refuted)**
  — o amendment (`deadline_ms`, `original_execution_id`, `dead_letter` no `/status`) **está canonizado**
  em **origin/main**: PRD §10.4:1069-70,1076,1120-1157 ("AMENDMENT 2026-06-03") + **backend/ADR-019
  "Amendment 1 (2026-06-03)"** (`:148+`). O código (#39) é **fiel ao canon**. O erro de 06-04 (e de uma
  1ª passada desta auditoria + 2 agentes de domínio) veio de grepar o **working tree** do canon, que
  está na branch `fix/a14-bevox-meta-api-ig-callback-spec` (sem o merge do amendment). **Lição: ler
  canon de `origin/main`.** Resíduo real = só o `openapi-status-callback-sem-dead-letter` (YAML atrás), já em BAIXO.
- **`idempotency-§12.3-triple-wired`** — as 3 mutações canônicas (criar Charge, criar Appointment,
  aprovar Suggestion) passam por `requireIdempotency` com replay 24h. Conforme.
- **`mfa-sentinel-correctly-inert-not-rejected-at-login`** — o seed grava secret base32 real e bloqueia
  o sentinel em seed-time; o login não rejeita sentinel (correto — MFA é Marco-3, §16.3/ADR-013). Conforme.
- **`adr-022-policy-json-zero-consumers-is-accepted-v1`** — `reminder_policy_json`/`handoff_policy_json`
  com zero consumers é o **estado V1 aceito** pela própria ADR-022 (canon-only). **Não é gap.**
- **`adr-018-refund-deferrals-are-canon-accepted`** **(re-verificado)** — partial-refund-of-package,
  re-credit pós-complete, deposit/late-cancel penalty, `refund.failed` retry são **deferimentos nomeados
  e aceitos** em backend/ADR-018 (detecção operator-driven via SQL; a ADR até nomeia o risco de
  revenue-leak silencioso). "Refund não-automatizado" **não é bug**. Conforme.
- **`delivery-tracker-bevox-backend-converges-with-code`** — o bloco `product_modules:bevox-backend`
  converge com o código (M4 + M5 P3a/P3b/P3c/P4). PRs #18-#39 pós-datam o tracker mas ADR-023 define o
  tracker como visibilidade (não WBS) → não é violação.
- **`legacy-lexicon-comments-only`** **(re-verificado)** — ZERO `workspace_id`/`workspaces` ou
  `account_id` de tenant em código/schema executável; só comentários históricos
  (`organizations/routes.ts:3`, `autonomy/routes.ts:5`, `db/schema/{autonomy,tenancy,ingestion,buffer_windows,execution_traces,staff_manual_actions}.ts`)
  + termos Stripe legítimos (`external_/payment_/channel_account_id`). Tensão com CLAUDE.md §4.1 ("em
  nenhum arquivo") — doc-only.
- **Fechados desde 06-02/06-04 (re-verificados):** `outgoing-messages-not-persisted` (#30),
  `complete-ignores-delivery-failure-status-done` (#31), `media-only-dispatch-empty-messages` (#26),
  `harness-contract-test-fk-seeding-gap` (#36 — suite passa 12 testes).
- **`autonomous-never-auto-executes-slot`** — em `autonomous_supervised` só `reply` é auto-executado
  (conservadorismo deliberado de segurança); slot/charge/refund caem em `waiting_approval`. Por design.
- **`impersonation-id-mistreated-as-organization-id-in-scope-guard`** `[NOVO; INFO]` **(v: confirmed)**
  — sutileza no guard de scope durante impersonation (id de impersonation tratado como org-id em um
  ponto). Sem impacto no piloto; registrar para revisão RBAC.
- **`reconcile-paid-no-amount-equality-check`** `[NOVO; INFO]` **(v: confirmed)** — o reconcile não
  compara `amount` do PI com o da charge ao flipar paid (subsumido por `reconcile-cron-flips-paid-without-orchestration`).
- **`deadline-ms-nao-aplicado-backend-side`** `[INFO]` — backend ecoa `deadline_ms` no fio mas deriva
  timeout de `dispatched_at + processing_timeout_ms` — **correto** per o amendment canônico.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **4 primeiros somam ≈ 6-8h** e
destravam o caminho funcional do piloto + o gate de CI verde.

| # | Item | Esforço | Por quê primeiro |
|---|------|---------|------------------|
| 1 | **Seedar `professional_schedules` (jornada Seg-Sex) no `seed-pilot`** | **2h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível |
| 2 | **Corrigir o flaky `booking_notice`** (ancorar slot a data fixa/relativa ao `now()`) **+ `closeDb()/closeRedis()` no `afterAll`** de `calendar-booking.test.ts` | **0,5h** | Destrava o job `Tests` (§16.1 "CI verde"); remove o RED intermitente que mascara regressões |
| 3 | `pnpm audit`: bump OTel (≥0.217) sob nota ADR-012 + `pnpm override` undici≥7.28 / tmp≥0.2.6 / vite | **2h** | Destrava o job `Security` (12 highs) — completa "CI verde" |
| 4 | **Unificar vocabulário de canal `wa↔whatsapp`/`ig↔instagram`** num ponto canônico + backfill + CHECK + teste e2e | **2-4h** | **CRÍTICO** (quando a IA ligar): faz a resposta realmente chegar ao cliente; fecha a causa estrutural |
| 5 | Seedar/auto-provisão de **Calendar default** no `seed-pilot` (ou passo no runbook) | **1-2h** | Remove o 2º elo de bootstrap quebrado de "ver agenda" |
| 6 | `reconcile-cron`: chamar `applyChargePaid`/`applyChargeRefunded` em vez de `UPDATE` cru | **4h** | Fecha a rede de webhook-perdido do passo "webhook concilia" |
| 7 | Hard-gate dos **2 endpoints Stripe** (startup-assert dos secrets + runbook) | **3h** | Evita falha silenciosa do passo final do piloto se só um endpoint for configurado |
| 8 | Testes de integração: webhook Stripe + `mark-paid` (rota) + `availability` (rota) | **8h** | Rede para o passo final do piloto e para o 1º elo "ver agenda" |
| 9 | Reconciliar **versão** (4 fontes) + decidir fonte única antes do próximo release | **1h** | Evita cortar tag de `main` sem querer e shipar estado não-testado; alinha digest do hub |
| 10 | Adicionar as entradas faltantes ao OpenAPI (+ `dead_letter` no `/status`) + teste `printRoutes()×YAML` | **6h** | Fecha o drift contrato↔rotas; atende "OpenAPI publicado" (§16.1) |
| — | Atualizar `.claude/rules` e `CLAUDE.md §8` estagnados (dead-letter, #36, ponte deletada, MFA sentinel) | **1h** | Higiene de governança local; as regras orientam os próprios agentes |

---

## Dependências cruzadas

- **bevox-harness** — contrato dispatch/callback **agora alinhado ao canon** (amendment 2026-06-03
  aceito em origin/main); o harness precisa de fato **emitir** `dead_letter` e consumir
  `deadline_ms`/`original_execution_id`. **Mitigante recorrente:** o harness está **inerte em produção**
  (nenhum proposal emitido) → gaps de proposal/autonomia/IA-outbound não atingem um piloto staff-manual.
- **bevox-meta-api** — entrega outbound real depende de alinhar o **vocabulário de canal** (`whatsapp`/
  `instagram` no `POST /v1/messages`, glossário §10.3) — causa do CRÍTICO #2; `tenant_id=null` drop;
  `message.status_updated` sem handler (confirmação de entrega).
- **Clerk** — `clerk-user-provisioning-broken` depende de webhook `organization.created` + claim
  `organization_id` no dashboard; bootstrap self-serve.
- **Stripe** — Pix exige Connect KYC `active`; conciliação por webhook depende de **dois** endpoints
  (Connect + platform) configurados; refund manual não passa por webhook.
- **Google** — OAuth redirect/watch dependem de `PUBLIC_API_BASE_URL`/`CALENDAR_OAUTH_SUCCESS_URL` em
  prod (não `requiredInProd` → fallback `localhost` silencioso).
- **canon (ADRs aceitas não-implementadas)** — backend/ADR-014 (Checkout), backend/ADR-010 (fit-in/
  buffer), backend/ADR-021 (priority-score sem compute), backend/ADR-020 (MessageTemplate), _shared/
  ADR-019 (bases legais — sem `legal_basis`/`consent_granted_at`), _shared/ADR-020 (retenção/DSR).
  Mudança de decisão → ADR no canon, **não** fork local (ADR-005).
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (pg_uuidv7); manifest/digest pinning
  (atenção: `v1.0.1` está 24 commits atrás de `main`); runbook go-live invoca `seed-pilot` (executável,
  #18) mas o seed **não cria schedule nem calendar** (CRÍTICO #1 + MÉDIO).

---

## Delta vs auditoria anterior (2026-06-04)

**Contexto:** código de produto **congelado** desde 06-04 (só `.claude/`, `.gitignore`, `CLAUDE.md`
mudaram). Logo, quase todos os achados de código de 06-04 **sobrevivem verbatim** — re-confirmados com
evidência fresca. O valor desta passada é (a) re-verificação independente, (b) **correções**, (c)
achados que 06-04 perdeu, (d) ground-truth de CI atual.

**Corrigido / retirado (o delta mais importante):**
- **`dispatch-contract-amendment-sem-base-canonica` — FALSO POSITIVO, retirado.** O amendment está
  canonizado/aceito em **origin/main** (PRD §10.4 "AMENDMENT 2026-06-03" + backend/ADR-019 Amendment 1);
  o código é fiel. 06-04 (e uma 1ª passada desta auditoria) grepou o **working tree** do canon, que está
  numa feature branch sem o merge. Era item **#7 do top-10 de 06-04** — sai da lista.
- `redaction-exposes-pii-debug-trace` **MÉDIO→BAIXO** (06-04 não viu que `env.ts:215-221` bloqueia
  debug/trace em prod no boot).
- `mark-paid-no-success-assert` **MÉDIO→BAIXO** (06-04 disse "sem it() que asserte pending→paid"; existe
  em `payments-manual-mode.test.ts:367-390` — resíduo é só o teste de rota).
- `http-metrics-route-label` mitigado parcialmente (rotas casadas usam padrão estável; resíduo só em 404).
- `verify-staff-refresh-not-constant-time` **→ INFO** (hash de token aleatório; timing desprezível).

**Fechado (re-verificado no código atual):** `outgoing-messages-not-persisted` (#30),
`complete-ignores-delivery-failure-status-done` (#31), `media-only-dispatch-empty-messages` (#26),
`harness-contract-test-fk-seeding-gap` (#36 — suite passa 12 testes).

**Novo (não isolado em 06-04):**
- `booking-notice-test-time-of-day-flaky` (ALTO) — a **causa real** do RED de integração desta sessão;
  06-04 atribuiu o RED **só** ao teardown 57P01.
- `ci-security-red-pnpm-audit-12-high` (ALTO) — escalada **4→12 highs** no lockfile congelado.
- `availability-http-endpoint-zero-integration-coverage` (MÉDIO).
- `consent-granted-at-write-never` (BAIXO LGPD); `message-template-entity-adr020-unimplemented` (BAIXO);
  `requires-prepayment-hook-fails-for-manual-only-pilot-org` (BAIXO); `channel-provider-vocab-drift-vs-canon-glossary` (BAIXO).
- **Cluster `.claude/`** (NOVO — config bootstrapada pós-06-04): `rules-dead-letter-writer-mechanism-wrong`,
  `claude-config-stale-deleted-bridge-and-closed-issue36`, `claude-md-section8-mfa-sentinel-doc-stale`,
  `rules-idempotency-adr-number-collision`.
- `version-drift`: dimensão nova — imagem deployável (`v1.0.1`) **24 commits atrás** de `main`.

**Sobrevive (sem regressão):** ambos os CRÍTICOs do piloto; `rbac-org-role-not-enforced`,
`clerk-user-provisioning-broken`, `pix-reconcile-depends-on-second-stripe-endpoint`,
`waitlist-accept-books-wrong-time`, `calendar-google-oauth-urls-not-required-in-prod`,
`reconcile-cron-*`, `buffer-dead-columns`, `fit-in-ausente`, `domain-prometheus-metrics`,
`rate-limit-zero-routes`, `sse-events-never-published`, `autonomy-action-granularity`,
`ADR-021-priority-score`, LGPD (DSR/retenção/consent), e os gaps de teste de hot-path.

---

## Notas de método

**Orquestração.** Workflow multi-agente (opt-in "ultracode", effort máximo): **12 auditores de domínio**
(pilot-path, calendar, payments, channels, harness, auth/rbac/tenancy, openapi/routes, lgpd, autonomy,
observability/idempotency, prd-completeness/tracker, governance/docs/debt) — cada um com a tarefa de
**re-verificar** os achados de 06-04 do seu domínio (carry-confirmed/refuted/closed/severity-change) **e**
caçar gaps novos, sobre código **congelado** — seguidos de **verificação adversarial** (cético com
default-refute) de **cada** achado NOVO/alterado/refutado/fechado. 3 domínios usaram agent-types locais
deste repo (`harness-callback-auditor`, `backend-staff-rbac-reviewer`, `backend-route-reviewer`). Custo:
**38 agentes, ~2,29M tokens de saída, 779 tool-uses, ~12,8 min**. Total: **95 achados** (4 CRÍTICO [2
únicos, duplo-reportados], 11 ALTO, 24 MÉDIO, 38 BAIXO, 18 INFO; 69 carry-confirmed, 13 NOVO, 9
severity-change, 3 fechados, 1 refutado).

**A verificação adversarial alterou conclusões materiais:** refutou o `dispatch-contract-amendment`
(falso positivo — ver abaixo); rebaixou `redaction`/`mark-paid`/`verify-staff-refresh`; e confirmou os
NOVOs (flaky booking_notice, 12-high audit, availability sem teste, consent-granted-at).

**Re-verificação manual independente** (eu, fora do workflow) dos achados de maior consequência: reli
`availability.ts`/`booking.ts` (gate `!sched`), `normalize.ts`/`metaapi/repository.ts`/`seams.ts`
(cadeia de provider ponta-a-ponta), `seed-pilot` (output), e **rodei o canon em `origin/main`** para
resolver o amendment de dispatch — `git -C bevox-knowledge grep origin/main` mostra `deadline_ms`/
`original_execution_id`/`dead_letter` em PRD §10.4 + backend/ADR-019 "Amendment 1 (2026-06-03)"; o
working tree (branch `fix/a14-bevox-meta-api-ig-callback-spec`) **não** os tem — origem do falso
positivo de 06-04. **Lição de método registrada: auditorias futuras devem ler canon de `origin/main`,
não do working tree.**

**Ground-truth de CI rodado de fato** (não inferido): `format:check`/`lint`/`typecheck`/`openapi:check`
= **GREEN**; `pnpm test` = **469 pass / 69 files GREEN**; `pnpm build` = **GREEN**; `pnpm test:integration`
= **RED exit 1** (1 falha real: `calendar-booking booking_notice` flaky por hora-do-dia + 2 erros 57P01
de teardown; 92/93 asserts passam); `pnpm audit --audit-level high` = **RED exit 1, 12 high**. `ci.yml`
`Tests` roda unit+integration no mesmo job; `security.yml` tem `pnpm audit` `continue-on-error:false`.

**Agentes locais.** `.claude/agents/` **agora existe** (8 agents; bootstrap bfe7095, pós-06-04) — as
auditorias anteriores diziam que não existia. 3 foram usados como agent-types no workflow; os demais
(engineering-*) e as lentes do hub foram embutidas nos prompts. A própria config `.claude/` rendeu 4
achados de staleness (regras descrevem mecanismos/issues inexistentes).

**Canon.** Lido por path absoluto `~/bevox-knowledge` (consume-by-reference, ADR-005). A
numeração de ADR **colide** entre namespaces (backend/ vs _shared/ vs harness/) — sempre qualificada. A
**branch do checkout do canon importa** (ver acima).

**Limitações.** (1) Severidades calibradas para o gate do **piloto** (login→agenda→paga); para GA vários
ALTO/MÉDIO sobem. (2) OSV Scanner / CodeQL não reproduzíveis offline (estados inferidos pelo lockfile/
config). (3) Caminho live (Stripe/Clerk/harness/Meta reais) não exercitado — verdicts derivam de leitura
de código + schema + canon + ausência comprovada de writers/endpoints. (4) Para itens dependentes de
canon recém-emendado, confiar em `origin/main`; o `complete strategy='workflow'` ficou marcado
baixa-confiança por essa razão.

---

*Gerado autonomamente por Claude Code (headless) em 2026-06-23. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
