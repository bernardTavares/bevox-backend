# Gap Analysis — bevox-backend — 2026-06-04

> Auditoria canônica autônoma (headless). Escopo: tudo o que falta para terminar o
> módulo segundo a documentação canônica (PRD V1 + ADRs **aceitas**), com foco no gate
> do **piloto** (1º cliente real: login → ver agenda → agendar → cobrar → webhook concilia).
> Método: Workflow multi-agente (12 auditores de domínio + crítico de completude +
> traçador do caminho do piloto + verificação adversarial por achado), re-verificação
> manual independente dos achados de maior consequência, e ground-truth de CI rodado de
> fato (não inferido). Detalhe em **Notas de método**. Sucede a `runtime-gap-audit-2026-06-02.md`.

## Resumo executivo

O backend **avançou muito** desde 06-02: os **3 bloqueadores CRÍTICOS do piloto daquela
auditoria estão fechados** (telefone/`wa_id` no intake #19; `seed-pilot` executável na
imagem migrator #18; testes de `booking` #21), e a maior parte dos ALTO/MÉDIO de entrega
de mensagem, auth e contrato também (≈17 PRs de remediação). **Porém o piloto ainda não
está pronto**, por **2 CRÍTICOs novos** — ambos descobertos só agora porque o código
amadureceu até expô-los: (1) **nenhum caminho cria `professional_schedules`** (jornada
base), então após o seed a agenda fica vazia e todo agendamento dá `slot_conflict` — quebra
"ver agenda" e "agendar"; (2) **vocabulário de canal divergente** (`'wa'/'ig'` no inbound vs
`'whatsapp'/'instagram'` no outbound) faz a resposta da IA ser **silenciosamente descartada**
em 100% das conversas reais — quebra o produto-núcleo conversacional.

O **CI continua vermelho** (viola "CI verde", o único critério mensurável de Marco-1, §16.1),
mas por causas **mais benignas e triviais** que em 06-02: um vazamento de pool no *teardown*
de `calendar-booking.test.ts` (exit 1 com 93/93 asserts verdes; fix ~15 min) e os mesmos 4
*highs* do `pnpm audit` (OTel + `tmp`; bump sob nota ADR-012). A lente charge-flow está
**sólida** (idempotência tripla, dedupe de webhook, split/destination correto, PCI scope
nulo); o resíduo de pagamento é a **rede de webhook-perdido incompleta** no cron de
reconciliação. **Riscos sistêmicos de governança** persistem: amendment de dispatch (#39)
cita ADR/PRD "aceitos em 2026-06-03" **inexistentes** no canon (fork de spec, ADR-005); e a
**versão diverge em 4 fontes**.

Estado: **muito perto do piloto, mas não pronto.** O caminho de fechamento é curto — os 2
CRÍTICOs + o gate de CI somam **< 12h** de esforço.

---

## Achados por severidade

Legenda: `(v: <veredito>)` = resultado da verificação adversarial (`confirmed` /
`downgraded` / `refuted`); **(re-verificado)** = também confirmei manualmente abrindo os
arquivos; `[xrepo: …]` = dependência cross-repo. Calibração de severidade ancorada em PRD
§16 (critérios de prontidão) — itens explicitamente listados em §16.2/§16.3 são
**deferimentos legítimos** a Marco-2/3, não regressões de Marco-1.

### CRÍTICO (bloqueia piloto)

- **`professional-schedules-no-writer-blocks-availability`** (NOVO) — Não existe **nenhum**
  caminho (seed, endpoint REST ou migration) que escreva `professional_schedules` (a jornada
  semanal base do profissional). `availability.ts:114-126` faz `SELECT` por
  `(professional_id, day_of_week)` e na linha 126 `if (!sched) continue` **antes** de
  processar overrides — logo um profissional sem linha-base nunca fica *bookable*. O único
  `INSERT` em `professional_schedules` no repo inteiro é a *fixture*
  `test/integration/calendar-booking.test.ts:120`; a única rota de schedule
  (`calendar/routes.ts:41` → `createScheduleOverride`) grava só `professional_schedule_overrides`
  (exceções pontuais). `seed-pilot.ts` cria org/staff/professional/service mas nenhuma
  jornada. — Impacto: após o seed, `GET …/availability` devolve dias vazios (tela de agenda
  vazia) e `createAppointment` retorna sempre `slot_conflict` (`booking.ts:200-207`). O 1º
  cliente não consegue ver disponibilidade nem agendar; **sem workaround de produto**. Escopo
  Marco-1 (PRD §5.3:383 "grade fixa"), não deferimento. — Esforço: **2h** (seedar jornada
  Seg-Sex no `seed-pilot`) a **6-8h** (endpoint CRUD completo) — (v: confirmed) **(re-verificado)**

- **`outbound-provider-vocab-mismatch-drops-delivery`** (NOVO; 2ª causa-raiz do CRÍT #1 de
  06-02, não coberta pela remediação de telefone) — O inbound persiste o provider
  **abreviado** (`normalize.ts:16,35` `'wa'`/`'ig'`; `metaapi/routes.ts:240,246` grava
  `channel_connections.provider='wa'`), mas o outbound só reconhece o **pleno**:
  `metaapi/repository.ts:197` `provider = r.provider==='whatsapp'||r.provider==='instagram' ? … : null`
  (lê exatamente `cc.provider` da `channel_connections`). Com `provider=null`,
  `executions/seams.ts:360` (`if (!ctx || !ctx.provider || !ctx.customerPhone)`) dispara e
  retorna `skipped_missing_recipient` (`:376`). **Não há nenhuma tradução `wa→whatsapp` no
  código** (grep exaustivo). Os testes mascaram: `channels-metaapi-outbound.test.ts:86`
  semeia `provider='whatsapp'` à mão; `channels-metaapi-inbound.test.ts:373` afirma
  `provider='wa'` — as duas metades usam vocabulários inconsistentes. Roda em modo autônomo
  (`complete-service.ts:89`) **e** no *approve* manual (`service.ts:68`) — mesmo
  `findExecutionDeliveryContext`, mesmo drop. — Impacto: a resposta da IA é computada e
  **silenciosamente descartada** para 100% das conversas que entram pelo webhook real. Quebra
  o produto-núcleo (cliente manda WhatsApp → IA responde). **Caveat:** o caminho de IA está
  hoje *inerte em prod* (harness não emite proposals) — se o piloto for puramente
  staff-manual (login→agenda→paga sem auto-resposta), o bug não dispara; vira bloqueador duro
  no instante em que a IA for ligada. — Esforço: **2-4h** (unificar `wa↔whatsapp` /
  `ig↔instagram` num ponto canônico + backfill de rows + teste e2e com o vocabulário do
  inbound) — (v: confirmed) **(re-verificado)** `[xrepo: bevox-meta-api — alinhar glossário de canal §10.3]`

### ALTO (bloqueia GA / disciplina de release; não bloqueia o caminho funcional do piloto)

**Gate "CI verde" (§16.1 — único critério Marco-1 mensurável; ambos mantêm o CI vermelho, nenhum é defeito de runtime de produto)**

- **`calendar-booking-teardown-uncaught-57P01-ci-red`** (NOVO; consolida os achados de
  `calendar` e `tests-ci`) — `test/integration/calendar-booking.test.ts:185-189` no `afterAll`
  chama só `pool?.end()` (o pool **local** do teste) + `pgContainer.stop()`, mas **nunca**
  `closeDb()`/`closeRedis()`. O `beforeAll:176` chama `initDb()` que cria o **pool singleton**
  interno (`src/db/client.ts`) consumido por `booking.ts` via `getDb()`. Ao parar o container,
  as conexões idle do singleton recebem `57P01` ("terminating connection…") e
  `db/client.ts:65-67` (`pool.on('error', err => process.emit('uncaughtException', err))`)
  re-emite como uncaughtException → `pnpm test:integration` sai **exit 1** apesar de 93/93
  asserts verdes. É a **única** das 13 suites que chamam `initDb` sem `closeDb` no teardown. O
  verificador **reproduziu** (exit 1; 2 banners `57P01` com `application_name='bevox-backend'`
  = o singleton). — Impacto: mantém o job *Tests* RED em `main` (e mascara falhas futuras de
  integração). Ironia: regressão introduzida pela própria remediação do CRÍT #3 de 06-02. —
  Esforço: **0.25-0.5h** — (v: confirmed; severidade na fronteira CRÍTICO/ALTO — fica em ALTO
  por **não** ter impacto no runtime do piloto) **(re-verificado)**

- **`rbac-org-role-not-enforced`** (carry de 06-02, agora isolado) — `requireRole` **não
  existe** (grep retorna só 3 comentários TODO: `auth/repository.ts:261-262`,
  `global.d.ts:35`, `clerk-auth.ts:25`). Todas as rotas de produto montam apenas
  `[requireClerkAuth, requireOrganizationScope]` (+`requireIdempotency` em writes) — qualquer
  membro autenticado da org (inclusive `professional_viewer`) pode mutar todos os recursos.
  `req.user.role` é resolvido (`clerk-auth.ts:183`) mas consumido por **zero** handler. PRD
  §5.1 exige "RBAC por organization (owner/admin/operator/professional_viewer)" e §12.2.3 "Admin
  não pode alterar o próprio role (guard)" — **não** é deferido a Marco posterior. — Impacto:
  no piloto (1 org / 1 admin / auth por claims) o *blast-radius* é baixo; é pré-requisito de GA
  multi-usuário. — Esforço: **8-12h** — (v: confirmed) `[xrepo: canon ADR-013]`

- **`clerk-user-provisioning-broken`** (open desde 06-02) — `auth/repository.ts:217-227`
  `findOrganizationByClerkOrg` ainda faz `SELECT … FROM users WHERE clerk_user_id=${clerkOrgId}`
  (compara org-id com coluna user-id); não há handler `organization.created` (grep=0) nem tabela
  de mapping Clerk-org→Bevox-org; o único `INSERT INTO users` só roda se a função retornar org →
  no-op para user novo. **Causa-raiz a montante:** `clerk-webhook-ignores-organization-created`
  (`auth/routes.ts:165-190` só ramifica em `user.*`; eventos `organization.*` retornam 200 sem
  efeito). — Impacto: nenhuma organization é provisionada automaticamente no signup; bootstrap
  100% via seed/manual. Mitigado no piloto (claims-based auth + seed). Bloqueia self-serve (GA).
  — Esforço: **8-12h** — (v: confirmed) `[xrepo: Clerk — config de webhook/claim no dashboard]`

- **`waitlist-accept-books-wrong-time`** (open desde 06-02) — `waitlist/routes.ts:114-127`
  usa `offered_at` (instante da oferta) como horário do appointment; o slot real
  (`slot_start_at`) vive só em `waitlist_match_outbox`, nunca persistido em `waitlist_entries`
  (sem coluna). Só morde policy `mode='offer'` (default `auto_book` usa o slot correto). —
  Esforço: **5h** — (v: confirmed)

### MÉDIO (degrada qualidade)

**Pagamentos / reconciliação**
- **`reconcile-cron-flips-paid-without-orchestration`** (NOVO) — `reconcile.ts:140-149`
  mapeia `pi.status==='succeeded' → UPDATE charges SET status='paid'` via SQL cru, **sem**
  chamar `applyChargePaid`. Uma charge que pagou no Stripe mas perdeu o webhook (o cenário
  exato que o cron existe para corrigir) é reconciliada a `paid` **sem** row em `payments`
  (§8.4 passo 8), **sem** confirmar o appointment (§8.4 passo 10), **sem** grant de
  `CustomerPackage`, **sem** audit. — Impacto: a rede de segurança de webhook-perdido (que o
  gate "webhook concilia" testa) está incompleta; ledger/booking/pacote dessincronizam
  silenciosamente. Piloto-MÉDIO: Pix webhooks são confiáveis, o cron só dispara após 24h, e o
  modo manual (default do piloto) não passa pelo cron. — Esforço: **4h**
- **`pix-reconcile-depends-on-second-stripe-endpoint`** (NOVO; pilot-path) — `payment_intent.succeeded`
  é tratado **só** em `webhook-platform.ts:99-120` (secret `STRIPE_WEBHOOK_SECRET_PLATFORM`);
  o webhook Connect-scoped (`webhook.ts`) só trata `account.updated`, demais tipos caem em
  `markWebhookProcessed`+200 sem ação (o comentário promete "P2 estende o mesmo switch" mas não
  há branch). — Impacto: se o operador criar só um endpoint Stripe, o `payment_intent.succeeded`
  do Pix nunca chega ao handler que concilia → charge fica `pending` para sempre e o appointment
  nunca confirma, silenciosamente. Mitigado: modo manual não depende de webhook. — Esforço: **3h**
- **`stripe-webhook-reconcile-zero-integration-tests`** (NOVO) — as 3 rotas de webhook Stripe
  (passo final do piloto) têm **zero** teste de integração; só unit com `constructEvent`
  mockado. Pode usar `stripe.webhooks.generateTestHeaderString` sem rede. — Esforço: **8h** `[xrepo: Stripe]`
- **`manual-mark-paid-reconcile-no-success-integration-assert`** (NOVO) — `POST /charges/:id/mark-paid`
  (o caminho de conciliação que o piloto **realmente** usa) não tem `it()` que asserte a
  transição `pending→paid` no DB com auth+org-scope. — Esforço: **3h**

**Agenda / Calendar**
- **`prepay-hook-zero-coverage`** (NOVO) — o hook `requires_prepayment → createCharge`
  (`booking.ts:275-340`, §8.3 passo 4) não tem nenhum teste (a suite de booking o exclui;
  `payments-manual-mode.test.ts` faz raw `INSERT` bypassando `createAppointment`). — Esforço: **5h**
- **`transition-reschedule-zero-integration-coverage`** (NOVO) — `transitionAppointment`
  (cancel/confirm/complete/no_show, com sync-outbox delete e re-match de waitlist) e
  `rescheduleAppointment` sem teste de integração. — Esforço: **8h**
- **`buffer-before-after-minutes-dead-columns`** (NOVO; distinto de fit-in) —
  `services.buffer_before_minutes/buffer_after_minutes` (PRD §5.2:368/§5.3:383) são colunas
  mortas; `availability.ts`/`booking.ts` ignoram buffer → dois agendamentos consecutivos sem
  intervalo de preparo são permitidos. — Esforço: **6h** `[xrepo: canon ADR-010]`
- **`fit-in-encaixe-ausente`** (open) — encaixe (§5.3:389) + flags `allow_fit_in`/`max_fit_ins_per_slot`
  (§5.2:370) existem no schema (`catalog.ts:65-66,110`) mas zero lógica os consome. — Esforço: **16h**
- **`no-calendar-integration-tests` (parcial)** — `booking.ts` coberto, mas `google/sync.ts`
  (engine de sync outbound/inbound/watch) e `waitlist` (CAS/outbox/offer/auto_book) **sem**
  integração. — Esforço: **20h**
- **`manual-booking-path-divergence-§8.3`** (open) — PRD §8.3 pede
  `POST /organizations/:id/appointments {start_at}`; código expõe
  `POST …/calendars/:id/appointments {date,start_time}`. — Esforço: **4h**
- **`waitlist-match-utc-vs-calendar-tz`** (open) — `match.ts:32-50` compara a janela em UTC,
  não no fuso do calendar (erra perto da meia-noite em America/Sao_Paulo). — Esforço: **6h**
- **`calendar-crud-incompleto`** (open) — só `GET`/`POST /calendars`; faltam GET-by-id/PATCH/DELETE (§5.3). — Esforço: **4h**

**Observabilidade / SSE / contrato harness**
- **`domain-prometheus-metrics-not-registered`** (NOVO; completude) — métricas de domínio
  mandatórias (§12.10:1309 / §5.7 Módulo 16) **não existem**: `executions_pending_approval_count`,
  `charges_succeeded_total`, `appointments_no_show_rate`, `buffer_windows_opened_total` etc.
  (grep=0 em `src/shared/metrics.ts`). HTTP/queue metrics existem. — Esforço: **6h**
- **`sse-appointment-and-charge-events-never-published`** (NOVO; completude) —
  `realtime/publish.ts:9-11` só publica `execution.*`; `appointment.created/updated` e
  `charge.updated` (§8.3 passo 6, §8.4 passo 11, §10.1:1013) nunca são emitidos. A tela do
  profissional não auto-atualiza no pagamento. — Esforço: **5h**
- **`dispatch-contract-amendment-sem-base-canonica`** (NOVO; harness-dispatch) — o amendment
  do PR#39 (`deadline_ms`, `original_execution_id`, `status=dead_letter`) cita "PRD §10.4 /
  ADR-019 Amendment 1, aceito 2026-06-03" que **não existe** no canon (verificado: §10.4 não
  lista esses campos; PATCH /status canônico = `{running|paused|cancelled}`; backend/ADR-019 de
  2026-05-20 não tem seção Amendment). Fork de spec (viola ADR-005/§9). Campos aditivos/opcionais
  + harness inerte → MÉDIO (débito de governança + risco de drift cross-repo). Inclui sub-itens
  BAIXO `openapi-status-callback-sem-dead-letter` e `complete-callback-strategy-workflow-fora-do-canon`
  e o informativo `deadline-ms-nao-aplicado-backend-side` (eco no wire; backend deriva timeout de
  `dispatched_at`). — Esforço: **3h** (pacote) `[xrepo: canon (ADR/PRD amendment real) + bevox-harness]`
- **`circuit-breaker-opossum-absent`** (NOVO; completude) — nenhum circuit breaker em
  integrações externas (§7.5/§12.7/§16.3); existe timeout (`AbortSignal.timeout(10s)`) e retry
  BullMQ, mas `stripe-client.ts` sequer configura timeout/`maxNetworkRetries`. — Impacto:
  degrada *fail-fast* sob falha sustentada; deferimento a Marco-3/GA, alvo primário (LLM) inerte
  no piloto. — Esforço: **6-10h** (dep `opossum` dispara gate §6) — (v: downgraded ALTO→MÉDIO)
  `[xrepo: bevox-harness / Stripe / Google / meta-api]`

**LGPD (escopo Marco-3 por §16.3, mas piloto roda com dado pessoal real — verificação técnica-documental, não substitui DPO/jurídico)**
- **`consent-and-ai-opt-out-stored-not-applied`** (open) — `customers.ai_opt_out` é gravado
  (`repository.ts:67`) mas **nunca consultado** no pipeline (`cutoff.ts` dispara ao harness sem
  lê-lo). É o único item de privacidade com *teeth* durante o piloto: um cliente que pede "não
  use IA comigo" ainda tem a conversa mandada ao LLM (transferência internacional, _shared/ADR-019
  item 7). — Esforço: **8h**
- **`message-records-not-customer-org-scoped-blocks-dsr`** (NOVO) — `message_records` (corpo das
  mensagens, PII) só tem `conversation_key`, sem `organization_id`/`customer_id` — bloqueia DSR
  export E deleção/pseudonimização reais (exige join frágil customer→conversations→pipeline_state→records).
  É a causa-raiz por trás de `no-dsr-export`/`deletion` ficarem POC/open. — Esforço: **10h**
- **`no-dsr-deletion-endpoint`** (open) — nenhum `app.delete` em `customers/`; nada escreve
  `deleted_at`/`archived_at` (só são lidos como filtro). — Esforço: **16h** `[xrepo: canon _shared/ADR-020]`
- **`redaction-exposes-pii-debug-trace`** (open) — `redactors.ts:69-72` omite PII quando
  `logLevel∈{debug,trace}` (deliberado); um operador com `LOG_LEVEL=debug` em prod vaza PII de
  cliente. Sem teste cobrindo redaction. — Esforço: **6h**
- **`retention-worker-adr020-absent`** (open) — nenhum worker de retenção (_shared/ADR-020);
  dado pessoal acumula sem TTL desde o 1º cliente. Marco-3, volume trivial no piloto. — Esforço: **40h**

**Onboarding / provisionamento**
- **`onboarding-advance-no-prereq-validation`** + **`…-allows-arbitrary-backward-and-skip`**
  (open/NOVO) — `advanceOnboarding` faz `UPDATE onboarding_stage=${stage}` para qualquer valor
  sem checar pré-requisitos (§5.8) nem comparar com o estágio atual (permite **retroceder**),
  sem AuditEvent (§8.5 passo 7). — Esforço: **5h**
- **`org-role-management-and-self-demote-guard-missing`** (open) — sem endpoint de role-management
  na org nem guard §12.2.3; `users` é read-only; falta `POST /users/invitations` + `DELETE /users/:id`. — Esforço: **8h**
- **`webhook-user-always-operator`** (open) — `upsertUserFromClerk` insere role literal `'operator'`;
  §8.5 passo 1 manda o 1º user ser `'owner'`. Acoplado a `clerk-user-provisioning-broken`. — Esforço: **6h**

**IA / Autonomia (harness inerte em prod — `manual_assisted` é default em todas as camadas, sem env que arme `copilot`/`autonomous_supervised`; toda esta classe está blindada do piloto)**
- **`autonomy-action-granularity-not-enforced`** (open desde 06-02) — PR#32 adicionou
  `fetchOrgAutonomyPolicies` + `PolicyEvaluator` interface-only (`autonomy/seams.ts:64-145`) mas com
  **zero callers de produção** (só o teste importa). `resolveExecutionMode` (`resolver.ts:30-63`) ainda
  lê só `current_mode`; `complete-service.ts:82` ainda gateia por modo. As 3 JSONBs
  (`allowed_actions`/`required_approvals`/`confidence_thresholds`) são gravadas e lidas por **zero**
  lógica de decisão. `makeEvaluator`/`shouldAutoApprove` sem implementação. Autonomia segue binária
  por modo. Auto-rotulado "POC/foundation seam" no código. — Esforço: **16h**
  `[xrepo: canon PRD §5.5 + bevox-harness]`
- **`ADR-021-priority-score-waitlist-no-compute`** (open; **correção:** o alvo real é
  `waitlist_entries.priority_score`, NÃO `conversations.priority_score` — a ADR difere esta a V2) —
  backend/ADR-021 (aceita 2026-05-21) manda `priority_score` **derivado pelo sistema**
  (`MAX(0, age_hours + urgency×100 − skip×10)`) e **depreca input do cliente**. O código ainda aceita
  e persiste o `priority_score` do cliente verbatim (`waitlist/routes.ts:30,71,95` → `repository.ts:278`);
  sem colunas `urgency_level`/`skip_count`/`last_score_update`, sem `computePriorityScore`, sem cron de
  recompute. O vetor que a ADR fecha (cliente infla a própria prioridade) segue aberto. — Esforço: **8h**
  `[xrepo: canon backend/ADR-021]`
- **`autonomous-never-auto-executes-slot`** + **`escalation-request-human-no-sse`** (open) — em
  `autonomous_supervised` só `reply` é auto-executado (`complete-service.ts:82`); slot/charge/refund
  caem em `waiting_approval` (conservadorismo deliberado de segurança). A escalada `request-human`
  (`complete-service.ts:60-71`) faz conversation→waiting_human + audit mas **não** publica SSE (o union
  `realtime/publish.ts:9-11` nem tem evento de conversa) → um painel ao vivo só vê o handoff em re-poll.
  — Esforço: **2h** + **2h**

**Observabilidade / rate-limit / SSE / contrato harness**
- **`domain-prometheus-metrics-not-registered`** (NOVO; completude + auditor dedicado) — métricas de
  domínio mandatórias (§12.10:1309 / §5.7 Módulo 16) **não existem** (grep=0): `charges_succeeded_total`,
  `appointments_no_show_rate`, `executions_pending_approval_count`, `executions_timeout_total`. As de
  **infra** (latência/erro por endpoint, queue, cache) existem e satisfazem o bullet 2 de §12.10. O
  auditor dedicado argumentou **ALTO** (cegueira operacional / base do "Dashboards Grafana" §16.3);
  mantenho **MÉDIO** porque o caminho login→agenda→paga *funciona* sem elas. — Esforço: **6h**
- **`rate-limit-§12.6-zero-routes-enforced`** (NOVO) — o plugin está registrado e expõe
  `requireRateLimit()` (`rate-limit.ts:146`), mas **nenhuma rota o aplica** (grep=0 em `src/modules/`).
  §12.6:1273-1275 especifica 100/min por IP, 500/min por organization e caps por endpoint pesado — **nenhum
  em vigor**; o sliding-window Lua é código morto no request-path (as métricas de rate-limit nunca
  incrementam). V1 é "local por-processo" por design, mas a expectativa é *existir*. — Esforço: **3h**
- **`sse-appointment-and-charge-events-never-published`** (NOVO; completude) — `realtime/publish.ts:9-11`
  só publica `execution.*`; `appointment.created/updated` e `charge.updated` (§8.3 passo 6, §8.4 passo
  11, §10.1:1013) nunca são emitidos. A tela do profissional não auto-atualiza no pagamento. — Esforço: **5h**
- **`dispatch-contract-amendment-sem-base-canonica`** (NOVO; harness-dispatch) — o amendment do PR#39
  (`deadline_ms`, `original_execution_id`, `status=dead_letter`) cita "PRD §10.4 / ADR-019 Amendment 1,
  aceito 2026-06-03" que **não existe** no canon (verificado: §10.4 não lista esses campos; PATCH /status
  canônico = `{running|paused|cancelled}`; backend/ADR-019 de 2026-05-20 não tem seção Amendment). Fork de
  spec (viola ADR-005/§9). Campos aditivos/opcionais + harness inerte → MÉDIO. Inclui sub-itens BAIXO
  `openapi-status-callback-sem-dead-letter`, `complete-callback-strategy-workflow-fora-do-canon` e o
  informativo `deadline-ms-nao-aplicado-backend-side` (eco no wire; backend deriva timeout de `dispatched_at`).
  — Esforço: **3h** (pacote) `[xrepo: canon (ADR/PRD amendment real) + bevox-harness]`
- **`circuit-breaker-opossum-absent`** (NOVO; completude) — nenhum circuit breaker em integrações
  externas (§7.5/§12.7/§16.3); existe timeout (`AbortSignal.timeout(10s)`) e retry BullMQ, mas
  `stripe-client.ts` sequer configura timeout/`maxNetworkRetries`. Deferimento Marco-3/GA, alvo primário
  (LLM) inerte no piloto. — Esforço: **6-10h** (dep `opossum` dispara gate §6) — (v: downgraded ALTO→MÉDIO)
  `[xrepo: bevox-harness / Stripe / Google / meta-api]`
- **`§13-external-integration-readiness-google-localhost`** (open; **confirmado**) —
  `PUBLIC_API_BASE_URL` e `CALENDAR_OAUTH_SUCCESS_URL` **não** são `requiredInProd` (`env.ts:81-89,184-204`;
  default `localhost`). `google/sync.ts:449` e `google/oauth.ts:112-116` caem em localhost se as envs não
  forem setadas → um go-live que as esqueça sobe "verde" e quebra OAuth/watch do Google **silenciosamente**.
  É caminho do piloto (agenda↔Google). Fix trivial: incluí-las na lista `requiredInProd`. — Esforço: **1h**
  `[xrepo: Google / hub infra]`

**Cobertura de auditoria / canon**
- **`§11.1 entidades / Reminders (Módulo 14)`** — entidades §11.1 ausentes do schema (StatusHistory,
  OperationalMetricSnapshot, KnowledgeInterview, HandoffEvent, ConversationAssignment); Módulo 14
  Reminders ausente (sem `reminder_sent_at`, sem fila). Deferimentos Marco-2/3 explícitos no PRD §16. — Esforço: **vários**

### BAIXO (higiene)

- **`openapi-drift` (cluster)** — 9 handlers vivos ausentes do YAML: `GET/PATCH /autonomy`,
  `GET/PATCH /payment-account/policy`, `GET /realtime` (SSE), `GET /channel-connections`,
  `GET /customers/:id/export` (PR#25), webhooks Google (callback+watch), webhooks Stripe
  (principal+platform); enum `ExecutionProposal.action` sem `create-refund`; enum `payment_method`
  sem `checkout` (PR#29); `ExecutionStatusCallback.status` sem `dead_letter` (PR#39). Direção
  inversa (YAML sem handler) = **vazia**. `@fastify/swagger` mode:'static' torna o drift silencioso
  → recomendado teste de contrato `printRoutes()`×YAML. — Esforço total: **~6h**
- **`version-drift-4way`** — package.json `0.1.0` / openapi `1.11.0` / git tag `v1.0.1` /
  placeholder `vX.Y.Z` (CLAUDE.md:164). O openapi subiu de 1.10.0→1.11.0 desde 06-02 (única fonte
  que evolui). — Esforço: **1h** `[xrepo: hub release.yml]`
- **`pnpm-audit` higiene de OSV/CodeQL** — OSV Scanner provavelmente RED pelos mesmos GHSA
  (mesmo lockfile); CodeQL usa `upload:never` (não falha por findings). — Esforço: **0.5h**
- **`legacy-lexicon-comments-only`** — `workspace_id`/`workspaces` **zero** em código/schema/snapshot
  executável (`migration.test.ts:118-124` inclusive asserta zero coluna); só comentários históricos
  (`db/schema/{tenancy,autonomy}.ts`, `autonomy/routes.ts:5`, `organizations/routes.ts:3`) + README/
  CLAUDE/SKILL/2 testes. Tensão com CLAUDE.md §4.1 ("em nenhum arquivo"). — Esforço: **0.5h**
- **`client-uuid-params-accept-any-version`** — `organizations/professionals/services/staff-ops`
  usam `z.string().uuid()` (qualquer versão) vs regex UUIDv7 estrito (§4.7). Inofensivo (WHERE não
  casa → 404). — Esforço: **1h**
- **`verify-staff-refresh-not-constant-time`** — `staff-auth.ts:118-121` usa `===` apesar do
  comentário; `timingSafeEqual` já existe no codebase. — Esforço: **0.5h**
- **`appointments/charges/executions-missing-§11.3-indexes`** — faltam índices `(organization_id, status)`
  e `(organization_id, start_at)` que o §11.3 nomeia (conversations os tem). Trivial no volume do piloto. — Esforço: **2h**
- **`received-events-message-records-sem-organization-id`** — contradiz literalmente §11.2 (que manda
  `organization_id` nessas tabelas); na prática `received_events` é pré-resolução de tenant. PII sem
  tenant-scope direto. — Esforço: **3h**
- **`reconcile-cron-skips-refunded-and-grant-on-cancel`** (NOVO) — lado refund do mesmo cron não
  dispara `applyChargeRefunded`. — Esforço: **3h**
- **`raw-payload-json-stores-full-stripe-event-at-rest`** (NOVO) — `payments.raw_payload_json` guarda
  o evento Stripe inteiro (pode conter `billing_details` PII) sem TTL. PCI scope nulo (Pix, sem PAN). — Esforço: **6h**
- **`manual-account-throws-raw-error`** (NOVO) — `payments/repository.ts:122,163` `throw new Error(str)`
  cru (viola §5; vira 500 opaco). — Esforço: **1h**
- **`charge-route-path-diverges-from-prd`** — `POST /organizations/:id/charges` vs PRD §5.6
  `POST /appointments/:id/charges`. — Esforço: **1h**
- **`checkout-stub-doc-bug`** (NOVO) — `checkout.ts:16-18` documenta uma tabela `checkout_sessions`
  "criada nesta foundation" que **não existe**. — Esforço: **0.25h**
- **`refunds.reason_code-coluna-write-never`** (reframe) — o requisito §12.5.3 está atendido via
  Stripe metadata + `audit_events`; a coluna dedicada `refunds.reason_code` nunca é populada
  (redundante). — Esforço: **2h**
- **`comentario-stale-marco-1-stub`** — `harness-callbacks.routes.ts:8,137` rotulam `/complete` como
  "Marco-1 STUB", mas ele é funcional (lock+resolveComplete+finalize+audit). — Esforço: **0.5h**
- **`executions-timeout-at-nunca-preenchido`** — coluna `timeout_at` morta; deadline é derivado de
  `dispatched_at+processing_timeout_ms`. — Esforço: **1h**
- **`no-seed-pilot-npm-script`** (NOVO) — não há script npm `seed-pilot`; o go-live depende de
  `tsx scripts/seed-pilot.ts` ad-hoc. — Esforço: **1h**
- **`idempotency-§12.3-residual`** (reframe — em grande parte FECHADO) — as **3 mutações canônicas**
  §12.3 passam pelo plugin com replay 24h: criar Charge (`payments/routes.ts:53,105`), criar Appointment
  (`calendar/routes.ts:24,71`), aprovar Suggestion (`executions/routes.ts:21,30`) — todas no grupo `write`
  com `requireIdempotency`. **Residual BAIXO:** (a) para *approve*, a chave por-header **não serializa
  aprovadores concorrentes** (o próprio código nota que exactly-once dependerá de `Proposal.idempotency_key`;
  inerte hoje); (b) as mutações **manuais** de dinheiro (`mark-paid`/`expire`/`connect-manual`) usam o grupo
  `mutate` sem `requireIdempotency` — idempotência via transição guardada no service (ADR-023), mas replay
  de rede não é deduplicado por header. — Esforço: **2h**
- **`readme-descreve-arquivo-ponte-deletado`** (NOVO; trapdoor de léxico legado) — `README.md:73-94`
  descreve uma "ponte" em `src/integration/resolve-organization-id.ts` (que **não existe** —
  `ls src/integration/` confirma) e afirma que `workspace_id` "aparece somente na ponte" (grep
  `workspace_id src/` = **ZERO**). Contradiz `CLAUDE.md §4.1` (ponte colapsada). Doc-only, mas é exatamente
  o vetor de reintrodução do léxico legado que o invariante §4.1 proíbe. — Esforço: **0.5h**
- **`autonomy-readiness-score-never-computed`** (NOVO) — `autonomy_profiles.readiness_score` é
  lido/retornado (`autonomy/repository.ts:20,26`) mas **nunca computado nem escrito** (grep=0) e nem está no
  PATCH schema → `GET /autonomy` sempre retorna `null`. §5.5 Módulo 12 manda cálculo automático (volume,
  taxa de aprovação, FAQ, políticas). Sinal de gating de progressão de autonomia (ADR-018) ausente. Fora do
  caminho do piloto. — Esforço: **8h** `[xrepo: bevox-harness ADR-018]`
- **`autonomy-patch-nontransactional-mode-audit`** (NOVO) — `applyProfilePatch` (`autonomy/repository.ts:87-124`)
  faz o UPDATE do profile e o INSERT de `audit_events` da troca de modo em duas chamadas **não-transacionais**;
  se o UPDATE commita e o audit falha, o modo muda sem o AuditEvent mandado por §5.5. Duas PATCHes concorrentes
  podem lost-update os JSONBs. — Esforço: **3h** (falta helper de tx compartilhado)
- **`executions-list-status-param-unvalidated`** (NOVO) — `listQuerySchema.status` é `z.string().optional()`
  (livre) passado direto ao filtro SQL (`executions/schemas.ts:9-12` → `repository.ts:26`). Parametrizado (sem
  injeção), mas aceita qualquer string como status (retorna vazio em vez de 400). — Esforço: **0.5h**
- **`metrics-endpoint-unauthenticated`** (NOVO) — `GET /metrics` (`health/routes.ts:24-27`) sem auth nem
  rate-limit; expõe `organization_id` como label (`server.ts:170`) → enumeração de tenants/volume se vazar
  fora da network policy. Mitigado por topologia (cluster Hetzner do hub), não por código. — Esforço: **1h**
  `[xrepo: hub network policy]`
- **`http-metrics-route-label-unbounded-on-404`** (NOVO) — `server.ts:163` usa `req.url` cru como label
  `route` em requests sem rota casada (404) → cardinalidade ilimitada no registry sob varredura. — Esforço: **1h**
- **`idempotency-ttl-no-per-route-override`** (open) — `IDEMPOTENCY_TTL_SECONDS` hardcoded 86400, sem override
  por rota (§15.6). — Esforço: **3h**
- **`send-message-proposal-no-dedicated-handler`** (NOVO) — `create-refund`/`create-charge`/`waitlist-add` têm
  handler em `executeProposals` (`seams.ts:144-190`); `send-message` cai no branch genérico → `deferred`
  (no-op honesto, não sucesso silencioso). Inerte (harness no-op). — Esforço: **1h**
- **`ig-outbound-missing-recipient-by-design`** / **`media-only-no-response-no-handoff`** /
  **`tenant-id-null-silent-drop`** / **`non-message-events-no-handler`** / **`hmac-subscription-active-limit1`**
  (channels) — deferimentos V1 / cross-repo bevox-meta-api; o `message.status_updated` sem handler é o
  mais relevante (confirmação de entrega real). — Esforço: **2-6h cada**
- **`tech-debt-design-spec-inexistente`** — `docs/.../2026-05-21-backend-m5-p2-tech-debt-design.md`
  citado por 3 arquivos de `src` (`seams.ts:38,56`) **não existe** no repo (vive no hub). — Esforço: **0.5h**
- **`faq/rules (Módulos 10/11) ausentes`** / **`§11.1 entidades ausentes`** — FAQ/OperationalRules e
  entidades canônicas (StatusHistory/OperationalMetricSnapshot/KnowledgeInterview/HandoffEvent/
  ConversationAssignment) sem schema; deferimentos Marco-2/3 (§16). **Conforme (não-gap):** ADR-022
  `reminder_policy_json`/`handoff_policy_json` com zero consumers é o **estado V1 aceito** pela própria
  ADR-022 (canon-only, sem código backend obrigatório) — corrige a listagem de 06-02.

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os **4 primeiros somam
≈ 9h** e destravam o caminho funcional do piloto + o gate de CI.

| # | Item | Esforço | Por quê primeiro |
|---|------|---------|------------------|
| 1 | **`closeDb()`/`closeRedis()` no `afterAll` de `calendar-booking.test.ts`** | **0.25h** | Destrava o job *Tests* → atende "CI verde" (§16.1). Fix trivial, regressão de teardown |
| 2 | **Seedar `professional_schedules` (jornada Seg-Sex) no `seed-pilot`** | **2h** | **CRÍTICO**: sem isso a agenda fica vazia e nenhum agendamento é possível |
| 3 | **Unificar vocabulário de canal `wa↔whatsapp`/`ig↔instagram`** (+ backfill + teste e2e) | **2-4h** | **CRÍTICO**: faz a resposta da IA realmente chegar ao cliente |
| 4 | `pnpm audit`: bump OTel (≥0.217) + override `tmp`≥0.2.6 sob nota ADR-012 | **2h** | Destrava o job *Security* (4 highs) — completa "CI verde" |
| 5 | Seedar/auto-provisão de **Calendar default** no `seed-pilot` (ou passo no runbook) | **1-2h** | Remove o 2º elo de bootstrap quebrado de "ver agenda" |
| 6 | `reconcile-cron`: chamar `applyChargePaid`/`applyChargeRefunded` em vez de UPDATE cru | **4h** | Fecha a rede de webhook-perdido do passo "webhook concilia" |
| 7 | Reconciliar versão (4 fontes) + corrigir o amendment de dispatch sem base canônica (ADR no canon ou reverter) | **3h** | Higiene de governança; remove fork de spec (ADR-005) |
| 8 | Implementar `requireRole` + sanitizar `role` ao enum + guard self-demote + aplicar nas mutações | **8-12h** | Fecha o RBAC por organização prometido (§5.1/§12.2.3) — pré-GA |
| 9 | Testes de integração do webhook Stripe + `mark-paid` happy-path | **8h** | Rede para o passo final do piloto ("cliente paga → concilia") |
| 10 | Adicionar as 9 entradas faltantes ao OpenAPI + teste de contrato `printRoutes()`×YAML | **6h** | Fecha o drift contrato↔rotas; atende "OpenAPI publicado" (§16.1) |

---

## Dependências cruzadas

- **bevox-harness** — contrato dispatch/callback: amendment #39 sem base canônica (harness
  precisa concordar em emitir `dead_letter` e consumir `deadline_ms`/`original_execution_id`);
  `create-refund` ausente do OpenAPI; circuit breaker do LLM vive na fronteira do harness.
  **Mitigante recorrente:** o harness está **inerte em produção** (nenhum proposal emitido) →
  os gaps de proposal/autonomia/IA-outbound não atingem um piloto *staff-manual*.
- **bevox-meta-api** — entrega outbound real: o **vocabulário de canal** (`whatsapp`/`instagram`
  no `POST /v1/messages`) precisa alinhar com o glossário canônico §10.3 (CRÍTICO #2);
  `tenant_id=null` drop, eventos não-message sem handler, multimedia "5 LGPD prod gates pending"
  (tracker).
- **Clerk** — `clerk-user-provisioning-broken` depende de config de webhook `organization.created`
  + claim `organization_id` no dashboard; bootstrap de tenant self-serve.
- **Stripe** — Pix exige Connect KYC `active`; conciliação por webhook depende de **dois**
  endpoints (Connect + platform) configurados corretamente; refund manual não passa por webhook.
- **Google** — OAuth redirect/watch dependem de `PUBLIC_API_BASE_URL`/`CALENDAR_OAUTH_SUCCESS_URL`
  em prod; **confirmado**: NÃO são `requiredInProd` (`env.ts:184-204`) → fallback localhost silencioso se
  esquecidas no go-live (ver MÉDIO `§13-external-integration-readiness-google-localhost`).
- **canon (ADRs aceitas não-implementadas ou divergentes)** — backend/ADR-014 (Checkout cartão/boleto),
  backend/ADR-010 (fit-in/buffer), _shared/ADR-019 (bases legais — sem coluna `legal_basis`),
  _shared/ADR-020 (retenção/DSR/`consent_events`/`dsr_requests`), backend/ADR-021 (priority-score
  sem compute), backend/ADR-022 (policy-json colunas mortas), §12.7 (retry HTTP de dispatch
  superado por BullMQ sem ADR superseding). Mudança de decisão → ADR no canon, **não** fork local (ADR-005).
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (pg_uuidv7 obrigatória);
  manifest/digest pinning; runbook go-live invoca `seed-pilot` (agora executável, #18) mas o seed
  **não cria schedule nem calendar** (CRÍTICO #1 + MÉDIO).
- **Governança** — amendment de dispatch cita ADR/PRD "aceitos em 2026-06-03" inexistentes;
  CLAUDE.md §4.4 (ADR-017 PROPOSED) contradiz canon (aceita); a numeração de ADR colide entre
  namespaces (backend/ vs _shared/).

---

## Delta vs auditoria anterior (2026-06-02)

**Fechado (re-verificado no código atual):**
- **3 CRÍTICOs do piloto** → `outbound-recipient-never-populated` (#19: intake popula
  telefone/`wa_id`); `seed-pilot-unrunnable-in-migrator-image` (#18: Dockerfile:71 `COPY src`);
  `calendar-booking-zero-tests` (#21: suite com advisory-lock/idempotência/concorrência).
- **CI Lint&Format** RED→GREEN (#34). **Tests** — causas antigas fechadas (`migration ai_suggestions`
  #35; `harness-contract` FK seeding real, issue #36).
- **ALTO/MÉDIO**: `sender-contact-id-wrong-json-key`, `outgoing-messages-not-persisted` (#30),
  `media-only-dispatch-empty-messages` (#26), `complete-ignores-delivery-failure-status-done` (#31,
  regra de status; retry segue follow-on), `clerk-jwt-real-verification-untested` (#24),
  `test-seam-auth-bypass-on-nodeenv-test` (#27, agora flag explícita + rejeição em prod),
  `openapi-missing-aisuggestion-review-endpoints` (#23), `staff-mfa-sentinel` (#22, seed base32 real),
  `clerk-auth-no-local-user-resolution` (#28, parcial — `req.user` resolvido; sanitização de role +
  `requireRole` seguem abertos), `payment-link-stripe-checkout` (#29, stub 501 fail-closed).
- **Governança/contrato**: `claude-md-adr-017-stale-invariant` — **CLAUDE.md §4 já corrigido** (ADR-017
  marcada ACEITA, materializada em `staff_accounts`); **§12.3 idempotência tripla verificada cabeada** (as 3
  mutações canônicas passam por `requireIdempotency` com replay 24h — melhor que o "unaudited" temido em 06-02).

**Sobrevive (sem regressão):** `clerk-user-provisioning-broken`, `rbac-org-role-not-enforced` (agora
isolado), `waitlist-accept-books-wrong-time`, `fit-in-encaixe-ausente`, divergências de path/CRUD de
calendar, drift de OpenAPI, version drift, `verify-staff-refresh` não constant-time, LGPD (DSR/retenção/
consent — Marco-3), `executions-timeout-at`, léxico legado em comentários.

**Novo (não existia/não exposto em 06-02):** `professional-schedules-no-writer` (CRÍTICO),
`outbound-provider-vocab-mismatch` (CRÍTICO; 2ª causa-raiz do CRÍT #1), `calendar-booking-teardown-57P01`
(ALTO — **regressão introduzida pela remediação** do CRÍT #3), `reconcile-cron-flips-paid-without-orchestration`
(MÉDIO), `pix-reconcile-depends-on-second-stripe-endpoint`, `dispatch-contract-amendment-sem-base-canonica`
(do PR#39), `domain-prometheus-metrics-not-registered`, `sse-appointment-charge-events-never-published`,
`buffer-dead-columns`, `message-records-not-customer-org-scoped`, `rate-limit-§12.6-zero-routes-enforced`,
`autonomy-readiness-score-never-computed`, `§13-external-integration-readiness-google-localhost`
(confirmado aberto), e os gaps de teste de hot-path (webhook Stripe, mark-paid, transition/reschedule,
prepay-hook).

**Reframe/correção de severidade:** `money-mutations-sem-requireStaffRole` (06-02 MÉDIO) estava
**mal-enquadrado** — `requireStaff` é para staff Bevox; as rotas de pagamento são corretamente
tenant-facing; o resíduo real é o RBAC intra-org genérico (já em `rbac-org-role-not-enforced`).
`refunds.reason_code` reclassificado para BAIXO (requisito atendido via metadata+audit).
`module-7-inbox` rebaixado ALTO→BAIXO (deferimento Marco-2 explícito, §16.2). `seed-pilot-creates-no-calendar`
rebaixado ALTO→MÉDIO (workaround canônico `POST /calendars`). `circuit-breaker` ALTO→MÉDIO (Marco-3, LLM inerte).
**Correções de inventário (ADRs):** **ADR-022** (`reminder_policy_json`/`handoff_policy_json` "colunas mortas")
**deixa de ser gap** — zero-consumers é o estado V1 aceito pela própria ADR (canon-only, sem código backend
obrigatório). **ADR-021 priority-score**: o alvo real é `waitlist_entries`, **não** `conversations` (a ADR
difere esta a V2) — 06-02 conflou os dois.

---

## Notas de método

**Orquestração.** Workflow multi-agente (opt-in "ultracode", effort máximo): **12 auditores de
domínio** (cada um fez *verificação de fechamento* dos achados de 06-02 do seu domínio **+**
*caça a gaps novos*, com a lente do agent de hub correspondente — charge-flow, lgpd-officer,
data-retention, architecture-reviewer — embutida no prompt) → **crítico de completude** (o que
nenhum domínio cobriu, varrendo PRD §1-§17) + **traçador do caminho do piloto** (login→agenda→
agendar→cobrar→webhook, elo a elo) → **verificação adversarial** de cada achado CRÍTICO/ALTO novo
(skeptic com default-refute). Custo: **22 agentes no workflow + 3 re-execuções** (3 domínios —
payments, ai-autonomy, observability/idempotência — não emitiram structured-output e foram re-rodados
como agentes de fundo, retornando markdown), **≈1,58M tokens de saída**. A verificação adversarial
**alterou 4 severidades**: rebaixou `module-7-inbox` (ALTO→BAIXO), `circuit-breaker` (ALTO→MÉDIO) e
`seed-pilot-creates-no-calendar` (ALTO→MÉDIO) como deferimentos/workarounds legítimos; e **confirmou**
os 2 CRÍTICOs novos reproduzindo as cadeias. Os auditores também **corrigiram o inventário de 06-02**
em 3 pontos (ADR-022 não-gap; ADR-021 alvo `waitlist`; §12.3 tripla cabeada) e **reenquadraram**
`money-mutations-sem-requireStaffRole` (06-02 MÉDIO — `requireStaff` é p/ staff Bevox; rotas de pagamento
são corretamente tenant-facing).

**Verificação manual independente** (fora do workflow) dos achados de maior consequência: reli
`Dockerfile` (stage migrator), `seed-pilot.ts`, `intake.ts`, `orchestration/repository.ts`,
`channels/metaapi/{normalize,routes,repository}.ts`, `executions/seams.ts`, `calendar-booking.test.ts`
+ `db/client.ts`, e cruzei o **vocabulário de provider** (`wa`/`ig` vs `whatsapp`/`instagram`)
ponta-a-ponta — confirmando o CRÍTICO #2 e que o CRÍT #1 de 06-02 só fechou pela metade.

**Ground-truth de CI rodado de fato** (não inferido como em 06-02): `format:check`/`lint`/
`typecheck`/`openapi:check`/`pnpm test` = **GREEN** (469 unit). `pnpm test:integration` = 14
suites / **93 asserts passam** mas **exit 1** por 2 `57P01` no teardown de `calendar-booking`.
`pnpm audit --audit-level high` = **RED**, 4 high (3× OTel `<0.217.0` + `tmp <0.2.6`). Node v22.22.2
(bate com `.nvmrc`; a divergência de toolchain notada em 06-02 está resolvida).

**Tracker (convergência, cat h).** O bloco `product_modules: bevox-backend` do
`delivery-tracker.yml` lista delivered até M4 + M5(P3a/P3b/P3c/P4) — **forte convergência** com o
código presente (aisuggestion-collapse, staff-rbac, chatwoot→channel, manual-payment-mode,
refundpolicy-setter, create-refund-seam, multimedia). O próprio tracker já registra os caveats
"5 LGPD prod gates pending (not ready-for-prod)" (multimedia) e "harness inert today" (refund seam).
Os PRs #18-#39 pós-datam o tracker e não têm work_items — mas ADR-023 define o tracker como
*visibilidade*, não WBS, então não é violação.

**Agentes locais.** `.claude/agents/` **não existe** neste repo. Usei os agentes embutidos via
Workflow; as **lentes dos agentes do hub** (`bevox-PRD-consolidation/.claude/agents/`:
`prd-auditor`, `charge-flow-auditor`, `data-retention-auditor`, `lgpd-officer`,
`architecture-reviewer`, `harness-runtime-inspector`, `rbac-staff-architect`) foram lidas e
embutidas nos prompts — não são *subagent types* registrados nesta sessão, logo não invocáveis
diretamente. `rbac-staff-architect` está **ARQUIVADO** no hub (work-item `backend-staff-rbac`
delivered); `harness-runtime-inspector` depende de MCP não disponível (canal-lateral dev, não prod).

**Canon.** `$BEVOX_KNOWLEDGE_PATH` **vazia** neste ambiente; canon lido por path absoluto
`~/bevox-knowledge` (consume-by-reference, ADR-005). A numeração de ADR **colide**
entre namespaces — sempre qualificado backend/ vs _shared/.

**Limitações.** (1) Severidades calibradas para o gate do **piloto** (login→agenda→paga); para GA,
vários ALTO/MÉDIO sobem. (2) OSV Scanner / CodeQL não reproduzíveis offline (estados inferidos pelo
lockfile). (3) Não tracei a pseudonimização de mensagens entre repos (harness pode ter store próprio).
(4) Caminho live (Stripe/Clerk/harness/Meta reais) não exercitado — verdicts derivam de leitura de
código + schema + ausência comprovada de writers/endpoints.

---

*Gerado autonomamente por Claude Code (headless) em 2026-06-04. Sem alteração de código de produto;
somente este relatório. Revisão humana pendente.*
