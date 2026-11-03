# Gap Analysis — bevox-backend — 2026-06-02

> Auditoria canônica autônoma (headless). Escopo: tudo o que falta para
> terminar o módulo segundo a documentação canônica (PRD V1 + ADRs aceitas),
> com foco no gate do **piloto** (1º cliente real: login → agenda → paga).
> Método: 16 auditores em paralelo (15 dimensões + crítico de completude),
> verificação adversarial por achado, e re-verificação manual dos achados de
> maior consequência. Detalhe em **Notas de método**.

## Resumo executivo

O backend está **substancialmente mais maduro do que o README/CLAUDE.md
declaram**: o escopo nominal é "Marco 1", mas o código já entrega Marco‑2
(channels/intake, pipeline IA, autonomia) e Marco‑3 (payments Stripe+manual,
calendar/booking, Google sync) — boa parte com qualidade real (tenancy
canônica sólida, RBAC de staff correto, idempotência tripla em charges,
webhooks assinados+deduped, contrato de dispatch fiel ao PRD §10.4). O
invariante de léxico de tenant (§4.1) **se sustenta no código executável** e é
até imposto por testes-guarda.

**Porém o piloto não está pronto.** Há **3 bloqueadores CRÍTICOS** no caminho
exato do piloto, todos de baixo esforço de correção:

1. **A resposta da IA nunca chega ao WhatsApp** — o telefone do destinatário
   nunca é persistido no caminho de intake real; o outbound pula como
   `missing_recipient`. O produto‑núcleo (atendimento por IA) não funciona
   ponta‑a‑ponta. (~5h)
2. **O `seed-pilot` é inexecutável nas imagens de produção** — o pré‑requisito
   de go‑live (criar org/staff/professional/service) não roda nem na imagem
   `runtime` (script não vai pro `dist/`) nem na `migrator` (não copia `src/`,
   que os aliases `@/` exigem). O caminho oficial documentado falha no T0. (~4h)
3. **Zero testes para `calendar/booking.ts`** — o fluxo central do piloto
   (agendar) não tem rede contra concorrência/double‑booking/idempotência. (~16h)

Além disso, o **CI está vermelho em `main`** (3 jobs: Lint&Format, Tests,
Security/pnpm‑audit), o que viola diretamente o **único critério de prontidão
Marco‑1 mensurável e checado** ("CI verde", PRD §16.1) — e todos os fixes
somados custam **< 5h**.

**Reframe importante para o revisor:** muitos "gaps" listados como ALTO/MÉDIO
(MFA TOTP, DSR/retenção LGPD, payment‑link Stripe Checkout, reminders, FAQ/rules)
**são deferimentos legítimos a Marco‑2/3 pelo próprio PRD §16**, não regressões
de Marco‑1 — eles só entram em cena porque o piloto puxa um cenário que cruza
Marco‑1→3. A verificação adversarial rebaixou corretamente o "bug do MFA
sentinel" (manchete de CLAUDE.md §8) de CRÍTICO para ALTO/MÉDIO: o login do
piloto **funciona** (o sentinel é inerte, MFA é Marco‑3 por §16.3/ADR‑013), e
implementar o gate **ao pé da letra** ("rejeitar o sentinel antes de emitir
JWT") **travaria todo login de staff seedado** — a descrição em CLAUDE.md §8 é,
ela própria, subespecificada.

**Riscos sistêmicos de governança/doc:** (a) **CLAUDE.md §4.4 está factualmente
errado** ao listar ADR‑017 como PROPOSED — o canon a aceitou em 2026‑05‑18 e
ela já está materializada (`staff_accounts`); seguir o §4.4 levaria um agente a
tratar trabalho correto como violação. (b) A **versão diverge em 4 fontes**
(package.json `0.1.0`, openapi `1.10.0`, git tag `v1.0.1`, placeholder
`vX.Y.Z`). (c) O **README descreve uma "ponte" de tenant que foi deletada**,
arriscando reintrodução do léxico legado.

Estado: **sólido como fundação, não pronto como piloto.** Caminho de fechamento
do piloto é curto e bem‑definido (ver "Itens‑de‑fechamento").

---

## Achados por severidade

Legenda: `(v: <verdict>)` = resultado da verificação adversarial
(`confirmed`/`downgraded`/`refuted`); `(↓ X→Y)` = severidade rebaixada na
verificação; `[xrepo: …]` = dependência cruzada; **(re‑verificado)** = também
confirmei manualmente abrindo os arquivos.

### CRÍTICO (bloqueia piloto)

- **`outbound-recipient-never-populated`** — A resposta da IA nunca é entregue
  ao WhatsApp/Instagram. `src/modules/orchestration/intake.ts:74-78` chama
  `resolveOrCreateCustomerChannel` **sem** `phoneNumber`; `channels/repository.ts:113-125`
  grava `customers.full_name='Cliente'` e `customer_channels.phone_number=NULL`;
  no outbound `channels/metaapi/repository.ts:191` resolve `customerPhone = primary_phone ?? channel_phone` (ambos NULL) e
  `executions/seams.ts:344,360` retorna `skipped_missing_recipient`. O `wa_id` do
  cliente existe só em `customer_channels.external_user_id`, que o outbound nunca
  lê. Testes mascaram (outbound semeia telefone à mão; inbound para no "job
  enfileirado"). — Impacto: produto‑núcleo (cliente manda msg → IA responde) não
  funciona ponta‑a‑ponta; resposta computada e silenciosamente descartada. —
  Esforço: **5h** — (v: confirmed)

- **`seed-pilot-unrunnable-in-migrator-image`** — O bootstrap do piloto não
  executa em nenhuma imagem de produção. `scripts/seed-pilot.ts:28-34` importa
  `@/db/client.js`, `@/plugins/staff-auth.js`, `@/shared/uuid.js` (alias `@/*`→`./src/*`,
  `tsconfig.json:37`). O stage `migrator` do `Dockerfile` (L50-66) copia
  `node_modules, package.json, tsconfig.json, scripts/, db/` — **não copia `src/`
  nem `dist/`**; e `tsconfig.build.json` exclui `scripts/` → seed‑pilot **não vai
  pro `dist/`** (confirmado: `dist/` não tem `scripts/`). Logo: `tsx scripts/seed-pilot.ts`
  na migrator falha (resolve `@/`→`src/` ausente, `ERR_MODULE_NOT_FOUND`); e o
  workaround ".mjs‑from‑dist" de CLAUDE.md §8 é impossível (migrator não tem `dist/`).
  `migrate.ts` não usa aliases → migrations passam e o **seed falha tardiamente**.
  — Impacto: sem org/staff/professional/service não há login/agenda/pagamento; o
  caminho oficial documentado quebra no go‑live. Nota: a causa real **não é** a de
  CLAUDE.md §8 ("tsx não resolve aliases" — ele resolve, re‑verifiquei: `tsx -e
  "import('@/shared/uuid.js')"` → `RESOLVED`); é `src/` ausente da imagem, e o fix
  documentado (`tsconfig-paths`) **não resolveria**. — Esforço: **4h** —
  (v: confirmed) **(re‑verificado)** `[xrepo: bevox-PRD-consolidation infra/runbook]`

- **`calendar-booking-zero-tests`** — `src/modules/calendar/booking.ts:98-337`
  (createAppointment com `pg_advisory_xact_lock` L219, recount overlap×max_concurrent
  L221-226, idempotência Redis + índice único L79-96/243-257, hook
  `requires_prepayment`→createCharge L269-308; transition/reschedule L339-510) **não
  tem nenhum teste de integração**. Os únicos testes de calendar são unitários de
  funções puras (`calendar-availability`, `calendar-schemas`); a única referência a
  `createAppointment` em `test/` é um comentário (`payments-manual-mode.test.ts:516`,
  que faz raw INSERT bypassando o booking). — Impacto: o fluxo central do piloto
  (agendar) sem rede; double‑booking sob concorrência, replay criando 2 appointments
  e o hook de prepagamento chegariam a produção sem detecção. — Esforço: **16h** —
  (v: confirmed)

### ALTO (bloqueia GA, não bloqueia piloto)

**Entrega de mensagem / canais (cluster do produto‑núcleo)**
- **`sender-contact-id-wrong-json-key`** — `orchestration/repository.ts:285-296`
  faz `sender_snapshot_json->>'id'`, mas o snapshot WhatsApp é `contacts[0]={wa_id,…}`
  (`inbound-dispatch.ts:75-76`). Logo `sender_id=NULL` para todo WA e o intake cai
  no fallback `conversation_key`. Funciona "por acidente"; perde o `wa_id` canônico
  (alimenta o blocker #1). Dedup de cliente foge da regra §8.2. — Esforço: **3h** —
  (v: confirmed) `[xrepo: canon ADR-009]`
- **`outgoing-messages-not-persisted`** — `insertMessageRecord` só é chamado no
  inbound (`metaapi/routes.ts:255`, `direction:'incoming'`); `deliverToChannel`
  (`seams.ts:465-484`) nunca grava `direction:'outgoing'`. `buildDispatchMessages`
  (`orchestration/repository.ts:309-329`) monta o contexto do harness só com linhas
  incoming → a IA perde o próprio histórico assistant em conversas multi‑turno
  (agendamento são várias trocas). Viola PRD §8.1 passo 9 (linha 822). — Esforço:
  **4h** — (v: confirmed) `[xrepo: bevox-harness]`
- **`media-only-dispatch-empty-messages`** — `harness-dispatch.schema.ts:35`
  (`messages: z.array(...)` sem `.min(1)`) + `buildDispatchMessages` filtra
  `content_text IS NOT NULL` → mensagem só‑mídia despacha execução com `messages:[]`
  e sem ref de mídia (`cutoff.ts:54`, `harness-dispatcher.ts`). IA disparada sem
  conteúdo. — Esforço: **4h** — (v: confirmed) `[xrepo: bevox-harness]`
- **`complete-ignores-delivery-failure-status-done`** — `complete-service.ts:89-103`
  (autônomo) e `service.ts:67-80` (approve/edit) chamam `deliverToChannel` e
  transicionam para `'done'` **incondicionalmente**, sem inspecionar `delivery.status`
  (que pode ser `failed_rejected`/`exhausted`/`skipped`). Viola PRD §8.1 (entrega
  falha → `status='error'` + retry). O approve manual **é** o caminho do piloto e
  sofre o gap; há trilha forense (audit + métricas) mas zero retry. — Esforço:
  **6h** — (v: confirmed) `[xrepo: bevox-meta-api]`

**Agenda / Calendar**
- **`waitlist-accept-books-wrong-time`** — `waitlist/routes.ts:113-130` usa
  `offered_at` (instante da oferta, `service.ts:69`) como horário do appointment; o
  slot real (`slot_start_at`) vive só em `waitlist_match_outbox` e nunca é persistido
  em `waitlist_entries`. Só morde policy `mode='offer'` (default é `auto_book`, que
  usa o slot correto) → ALTO, não CRÍTICO. — Esforço: **5h** — (v: confirmed)
- **`fit-in-encaixe-ausente`** — Encaixe (PRD §5.3 linha 389) + flags
  `allow_fit_in`/`max_fit_ins_per_slot` (§5.2 linha 370) não existem; `availability.ts`/`booking.ts`
  só fazem `duration_minutes`+`max_concurrent`. — Esforço: **16h** — (v: confirmed)
  `[xrepo: canon ADR-010]`
- **`no-calendar-integration-tests`** — nenhum teste de integração para
  booking/concorrência/Google‑sync/waitlist (superset de `calendar-booking-zero-tests`;
  inclui o engine de sync `sync.ts`). — Esforço: **20h** — (v: confirmed)

**Identidade / Auth / Tenancy**
- **`clerk-user-provisioning-broken`** (↓ CRÍTICO→ALTO) — `auth/repository.ts:217-227`
  `findOrganizationByClerkOrg` faz `SELECT … FROM users WHERE clerk_user_id=${clerkOrgId}`
  (bug semântico: compara org‑id com coluna user‑id); é o único `INSERT INTO users`
  (`repository.ts:236`) e só roda se a função retornar org → no‑op para user novo. Não
  há handler `organization.created` nem tabela de mapping Clerk‑org→Bevox‑org; o seed
  não cria user de produto. **Rebaixado** porque nenhum path dereferencia um `users`
  row (tudo autoriza por claims do JWT) → o cliente loga/agenda/paga **se** o Clerk
  emitir o claim `organization_id` correto (config do dashboard Clerk, fora do repo).
  — Impacto: `GET /users` vazio, `professionals.user_id` sem vínculo, actor de audit
  sem FK. — Esforço: **12h** — (v: downgraded)
- **`clerk-auth-no-local-user-resolution`** — `clerk-auth.ts:67-78` extrai só claims
  e nunca resolve o User local; linha 76 `role ?? 'member'` — `'member'` não é valor
  do `userRoleEnum` (`_shared.ts:67-72` = owner|admin|operator|professional_viewer).
  RBAC por organização não é enforced em rota nenhuma (grep `req.auth.role`/`requireRole`
  = 0). — Esforço: **8h** — (v: confirmed) `[xrepo: canon ADR-013]`
- **`staff-mfa-sentinel`** (consolidado de 3 achados: dims D/A5/J; ↓ de CRÍTICO em
  2 deles) — `auth/service.ts:84-89` `loginStaff` emite JWT só com senha; o
  comentário admite "MFA NÃO é enforced no Marco‑1 / TODO(Marco 3, ADR‑013)".
  `seed-pilot.ts:62,150` semeia `bevox_admin` com `mfa_secret='PILOTSEEDONLYNOTASECRET'`
  (valor público no repo) esperando que o auth rejeite — não rejeita. **MFA TOTP é
  Marco‑3** (PRD §16.3 linha 1452; ADR‑013:106/145) → não bloqueia o piloto; em prod
  o seed recusa senha placeholder (`seed-pilot.ts:67-71`), então o resíduo é
  auth de fator único para conta cross‑org+impersonation. — Esforço: **~8–10h** —
  (v: confirmed @ ALTO) **(re‑verificado)** `[xrepo: canon ADR-013 / PRD §16.3]`
- **`test-seam-auth-bypass-on-nodeenv-test`** — `clerk-auth.ts:90-101` e
  `organization-scope.ts:44-48` injetam `req.auth` (org arbitrária, sem token) quando
  `process.env.NODE_ENV==='test'`; `env.ts:29` aceita `'test'` e o `superRefine`
  (159-201) só restringe `production`. Um deploy com `NODE_ENV=test` → bypass TOTAL
  de auth+tenancy (defense‑in‑depth ausente num invariante §4.1). — Esforço: **3h** —
  (v: confirmed)

**Autonomia / IA**
- **`autonomy-action-granularity-not-enforced`** — `allowed_actions_json`,
  `required_approvals_json`, `confidence_thresholds_json` são persistidos
  (`schemas.ts:10-12`→`repository.ts:90-104`) mas **lidos por zero lógica de decisão**;
  `resolver.ts:20-38` só lê `current_mode`. A autonomia é binária por modo, não por
  ação/confiança (promessa central "IA dentro de regras aprovadas"). Mitigante: o
  harness está inerte em prod → sem efeito no piloto manual_assisted. — Esforço:
  **16h** — (v: confirmed) `[xrepo: canon PRD §5.5 + bevox-harness ADR-018]`

**Contrato / OpenAPI**
- **`openapi-missing-aisuggestion-review-endpoints`** — handlers vivos de revisão
  (GET fila + approve/edit/reject, `executions/routes.ts:24-53`, montados em
  `server.ts:205`) **não estão no YAML** (grep = 0). Domínio core human‑in‑the‑loop
  fora do contrato → clientes tipados (`pnpm openapi:types`) e `/docs` não os
  enxergam. O YAML está incompleto, não os handlers. — Esforço: **4h** —
  (v: confirmed) `[xrepo: canon ADR-019]`

**Pagamentos**
- **`payment-link-stripe-checkout-not-implemented`** — só Pix dinâmico;
  `charge-intent.ts:94` fixa `payment_method: z.literal('pix')`, sem caminho
  `checkout.sessions`/`paymentLinks`. PRD §5.6:534 e ADR‑014:124-127 (aceita) listam
  Checkout (cartão/boleto) como método V1. Piloto coberto por Pix+Manual Mode → ALTO,
  não bloqueia. — Esforço: **16h** — (v: confirmed) `[xrepo: canon ADR-014]`

**Testes (hot paths)**
- **`clerk-jwt-real-verification-untested`** — `verifyClerkJwt` (`clerk-auth.ts:53-79`,
  RS256 anti alg‑confusion, `organization_id` obrigatório) nunca é exercitado; todos
  os testes usam o test‑seam. Sem prova de rejeição de token forjado. — Esforço:
  **4h** — (v: confirmed) `[xrepo: canon ADR-013]`

**LGPD (direitos do titular — escopo Marco‑3 por §16.3, mas pilotando com dado real)**
- **`no-dsr-deletion-endpoint`** — PRD §12.9:1300 exige `DELETE …/customers/:cid`
  (cascade + pseudonimiza Message); `customers/routes.ts:43-79` não tem `app.delete`.
  `deleted_at`/`archived_at` existem mas nada os escreve. Mitigável via SQL no piloto.
  — Esforço: **16h** — (v: confirmed) `[xrepo: canon ADR-020]`
- **`no-dsr-export-endpoint`** — PRD §12.9:1302 exige `GET /customers/:id/export`;
  inexistente. — Esforço: **10h** — (v: confirmed) `[xrepo: canon ADR-020]`

**CI vermelho em `main` (viola "CI verde" — único gate Marco‑1 mensurável, §16.1)**
- **`ci-lint-job-red-format-check`** — `pnpm format:check` → exit 1, **18 arquivos**
  não formatados (inclui `payments/{reconcile,repository,seam-tool,service}.ts`,
  `seed-pilot.ts` + 13 testes); `pnpm lint` passa. Fix: `pnpm format`. — Esforço:
  **0.25h** — (v: confirmed)
- **`ci-security-pnpm-audit-job-red`** — `pnpm audit --audit-level high` → 4 high
  (3× crash do Prometheus exporter OTel `@opentelemetry/{auto-instrumentations-node,sdk-node,exporter-prometheus}`
  + 1× path‑traversal `tmp` via `testcontainers`), `security.yml:38-39`
  `continue-on-error:false`. Nota: o servidor Prometheus exploitável **não roda** (só
  `OTLPTraceExporter` push é instanciado; `/metrics` usa `prom-client`) → vermelho de
  pipeline, não risco de runtime. Bump exige nota sob ADR‑012. — Esforço: **2h** —
  (v: confirmed)
- **`ci-test-job-red-integration-harness-fk`** — `harness-contract.test.ts` viola
  FK `executions_conversation_id_conversations_id_fk`: `beforeAll` só insere
  `organizations` e cria execuções com `conversation_id=uuidv7()` inexistente.
  Comentário stale em `executions.ts:8-9` reforça fixture desatualizada. — Esforço:
  **1.5h** — (v: confirmed) `[xrepo: bevox-harness (contrato)]`
- **`ci-test-job-red-migration-ai-suggestions-dropped`** — `migration.test.ts:44`
  exige `ai_suggestions` em `EXPECTED_TABLES`, mas `0005_sharp_jack_power.sql:2` faz
  `DROP TABLE ai_suggestions CASCADE` (intencional, ADR‑019). Fixture stale. Fix:
  remover da lista. — Esforço: **0.5h** — (v: confirmed) `[xrepo: canon ADR-019]`

**Cobertura/governança transversal (do crítico de completude)**
- **`§13-external-integration-readiness`** — nenhuma dimensão validou o grafo de
  dependências §13/§9 ponta‑a‑ponta. Sintomas dispersos: `PUBLIC_API_BASE_URL`/`CALENDAR_OAUTH_SUCCESS_URL`
  **não** `requiredInProd` (`env.ts:81-89` → Google cai em localhost); Clerk
  org‑mapping quebrado; endpoint meta‑api. Sem lente consolidada, uma dependência
  externa mal‑configurada passa despercebida no go‑live. — Esforço: **4h** —
  (crítico de completude) `[xrepo: bevox-meta-api / Clerk / Google]`
- **`§12.3-idempotency-triple-mutation-unaudited`** — §12.3 exige Idempotency‑Key nas
  3 mutações sensíveis (criar Charge, criar Appointment, **aprovar Suggestion**) com
  replay 24h. As dims tocaram pontos isolados (payments nota mark‑paid/expire pulam o
  plugin; calendar tocou booking) mas ninguém verificou as 3 juntas. Retry de rede do
  mobile pode duplicar cobrança/agendamento. — Esforço: **4h** — (crítico de completude)
- **`claude-md-adr-017-stale-invariant`** — CLAUDE.md §4.4 (invariante) lista ADR‑017
  como PROPOSED, mas o canon a marca `status: aceita, aceita_em: 2026-05-18` e ela está
  materializada (`staff_accounts`). Um agente que siga §4.4 trataria trabalho correto
  como violação a reverter. (O dim a rotulou MÉDIO; elevo a ALTO por ser invariante
  que governa comportamento de agente sobre decisão **vinculante**.) — Esforço: **1h**
  — (re‑verificado) `[xrepo: canon ADR-017]`

### MÉDIO (degrada qualidade)

**Pagamentos** — `refunds.reason_code` nunca gravado apesar de §12.5.3 (`repository.ts:451-465`;
vive só no audit) [2h]; mutações de dinheiro (refund/mark‑paid/refund‑manual) sem
gating por role de staff (`routes.ts:50-58`, sem `requireStaffRole`) [4h].
**Calendar** — path de agendamento manual diverge de §8.3 (`/calendars/:id/appointments`
+ `{date,start_time}` vs `/organizations/:id/appointments` + `{start_at}`) [4h]; CRUD de
calendars incompleto (só create+list) [4h]; `PUBLIC_API_BASE_URL`/`CALENDAR_OAUTH_SUCCESS_URL`
não `requiredInProd` → Watch/redirect em localhost [2h]; match de waitlist compara
janela em UTC, não no fuso do calendar (`match.ts:32-50`) [6h]; calendar (Marco‑3 no §14)
implementado em Marco‑1 sem work‑item no tracker [2h]; `rescheduleAppointment`
date‑only cai em `00:00` no seam (`booking.ts:365-366`) [3h]. **Channels** — evento
inbound `tenant_id=null` aceito/persistido mas nunca despachado (drop silencioso,
`routes.ts:182-234`) [2h]; **ADR‑020 MessageTemplate (aceita) não implementada** (sem
tabela/módulo) [12h]; 4 eventos canônicos não‑message sem handler (`schemas.ts:16-22`
vs `routes.ts:234`) [6h]. **IA/executions** — modo autônomo nunca auto‑executa
proposals `slot` (só `reply`, `complete-service.ts:82`) [4h]; OpenAPI
`ExecutionProposal.action` sem `create-refund` (Zod+PRD têm) [1h]; escalada
`request-human` não publica SSE (`complete-service.ts:59-80`) [2h]. **Identidade** —
gestão de role na org + guard "admin não altera próprio role" (§12.2.3) inexistentes;
user via webhook sempre `operator` [6h]; `onboarding/advance` aceita salto sem validar
pré‑requisitos (§5.8) [5h]; **ADR‑017 contradição** (ver ALTO acima) [1h]. **OpenAPI** —
GET/PATCH `/autonomy` [2h], `/payment-account/policy` [2h], `GET /realtime` (SSE) +
`/channel-connections` [2h] todos ausentes do YAML. **MFA** — nenhum teste cobre o
gate; testes existentes contradizem sua existência [2h]. **Tech‑debt** — spec de design
`docs/.../m5-p2-tech-debt-design.md` citada por 5 arquivos **não existe** [2h]; §15.11
sem threshold de coverage em `vitest.config.ts` [2h]. **LGPD** — `consent_granted_at`/`ai_opt_out`
gravados mas nunca aplicados no pipeline [8h]; redaction de logs expõe PII em
DEBUG/TRACE (`redactors.ts:69-72`) [6h]; PII em plaintext at‑rest (↓ ALTO→MÉDIO: sem
mandato canônico de cifra de coluna; é infra/backup) [24h]; sem worker de retenção
ADR‑020 (↓ ALTO→MÉDIO: Marco‑3, volume trivial no piloto) [40h]. **Tracker** — p3a
entregou `payment-account/policy` no código mas não no OpenAPI [1.5h]. **CI** — job
`OSV Scanner` provavelmente vermelho (mesmo lockfile; não reproduzível offline) [0.5h].
**Trapdoors** — `tsconfig-paths` ausente sem follow‑up rastreável (↓ ALTO→MÉDIO:
impacto subsumido pelo CRÍTICO do seed) [2h]. **Docs** — drift de versão 4‑way [1h];
`ADR-019` ambíguo em CLAUDE.md (3 ADR‑019 no canon: harness/backend/_shared) [0.5h];
README "ponte" stale (↓ ALTO→MÉDIO: doc‑only) [0.5h]. **Completude** — Módulo 14
Reminders ausente (sem `reminder_sent_at`, sem fila) [—]; **ADR‑021‑backend
(priority‑score, aceita) não implementada** (código só aceita input do cliente, "sem
compute logic") [—]; **ADR‑022 (aceita)**: `reminder_policy_json` + `handoff_policy_json`
são colunas mortas (zero consumers) [—]; entidades §11.1 `StatusHistory`/`OperationalMetricSnapshot`/`KnowledgeInterview`
ausentes do schema [—]; §12.10 métricas de domínio (charges_succeeded_total,
appointments_no_show_rate) não verificadas quanto à emissão real [—].

### BAIXO (higiene)

Charge route org‑scoped vs `/appointments/:id/charges` do PRD [1h]; webhook não trata
literal `charge.refunded` (usa `refund.*`) [2h]; `charge_type` deposit/adjustment no
CHECK mas não na criação (deposit deferido ADR‑018 §8) [8h]; mark‑paid/expire/connect‑manual
sem plugin de idempotência (ADR‑015) [2h]; `createManualAccount` lança `new Error` cru
vs `AppError` (viola §5) [1h]; cancel de appointment não dispara refund (↓ ALTO→BAIXO:
ADR‑018 §A2.2 manda refund **humano‑aprovado**, nunca automático — finding estava
invertido) [10h]; recount/lookups scoped só por `professional_id` sem `organization_id`
explícito (seguro de fato) [2h]; `waitlist-add` seam sem índice único `(org,idem_key)`
[4h]; grade de slots frágil em transição DST (`availability.ts:160-187`) [4h]; HMAC
subscription lookup `status='active' LIMIT 1` + `extractIds` heurístico (V1 single‑sub)
[3h]; proposal `send-message` sem handler em `executeProposals` (cai em no‑op) [1h];
`executions.timeout_at` nunca preenchido (scan usa `dispatched_at`) [1h]; código/testes
citam `ADR-007 §6`/`ADR-006 §89` (ADRs _shared erradas — governança OpenClaw) [1h];
seed‑pilot comenta `mfa_enabled=false`, coluna inexistente [0.5h]; schemas de param
cliente usam `z.string().uuid()` (qualquer versão) vs regex UUIDv7 estrito (§4.7) [1h];
`verifyStaffRefreshToken` usa `===` não constant‑time apesar do comentário [0.5h];
`@fastify/swagger` mode:'static' torna o drift OpenAPI↔rotas silencioso [3h]; README
descreve `harness-dispatch.schema.ts` como portador de léxico legado, mas é
`organization_id`-native [0.1h]; léxico legado em 4 comentários de código (anotação
canon→org) [0.5h]; idempotency TTL hardcoded 24h sem override por rota (§15.6) [3h];
comentário "Marco‑1 STUB" obsoleto em `/complete` [1h]; `db/seed.ts` placeholder
`DEVSEEDONLYNOTASECRET` (mesma dependência do gate ausente) [0.5h]; Dockerfile builder
não copia `openapi/` (compensado no runtime; já causou 2 bugs históricos) [1h]; evidências
do tracker com wording impreciso (grep -c conta linhas; "enum" pós‑ADR‑019) [0.5h]; M1/M2/M3
domain surface + 9 commits pós‑tracker sem work_items (ADR‑023: tracker é visibilidade,
não WBS) [2h]; received_events guarda PII sem tenant‑scope/expiração [6h]; audit_events
sem retenção/cobertura DSR [4h]; CodeQL não reproduzível offline (sem sinal local) [0.25h];
pg_uuidv7 corretamente criado em M0000 (alçapão coberto) [0h]; FAQ (Módulo 10) +
OperationalRules (Módulo 11) ausentes (Marco‑3) [—]; README "5 módulos CRUD" vs 14 dirs
[0.25h]; README/CLAUDE.md listam "AISuggestions" como entidade apesar do DROP em 0005
[0.25h]; CLAUDE.md §4.1 proíbe léxico legado "em nenhum arquivo (inclui este CLAUDE.md)"
mas o próprio CLAUDE.md e 3 arquivos o citam como nota histórica [0.25h].

---

## Itens-de-fechamento ordenados por valor/esforço (top 10)

Priorização = (desbloqueio do piloto / risco eliminado) ÷ esforço. Os 4 primeiros
custam **< 8h somados** e destravam CI + bootstrap do piloto.

| # | Item | Esforço | Por quê primeiro |
|---|------|---------|------------------|
| 1 | `pnpm format` → corrige `ci-lint-job-red` | **0.25h** | Destrava job Lint&Format; atende "CI verde" (§16.1) |
| 2 | Remover `ai_suggestions` de `EXPECTED_TABLES` (`migration.test.ts:44`) | **0.5h** | Destrava metade do job Tests; fixture stale, não bug |
| 3 | Fixture `harness-contract.test.ts`: inserir customers+conversations | **1.5h** | Destrava o resto do job Tests; corrige comentário stale `executions.ts:8-9` |
| 4 | **Persistir telefone/`wa_id` no intake** (`intake.ts:74` + dedup `repository.ts:287`) | **5h** | **CRÍTICO**: faz a IA realmente responder ao cliente WhatsApp |
| 5 | **Tornar `seed-pilot` executável em prod** (compilar p/ `dist/` ou runner `.mjs`‑from‑dist na imagem certa) | **4h** | **CRÍTICO**: sem isso não há org/staff/serviço — piloto não inicia |
| 6 | `pnpm audit`: bump OTel (≥0.75/≥0.217) + testcontainers (tmp≥0.2.6) sob nota ADR‑012 | **2h** | Destrava job Security; remove 4 highs |
| 7 | `complete`/`approve`: setar `status='error'` quando `deliverToChannel` falha | **6h** | Evita perda silenciosa de mensagem no caminho approve do piloto |
| 8 | Testes de integração de `booking` (concorrência + idempotência) | **16h** | **CRÍTICO**: rede para o fluxo central (agendar) |
| 9 | Reconciliar versão (package.json/openapi/tag) + corrigir CLAUDE.md §4.4 (ADR‑017 aceita) + README "ponte" stale | **2h** | Higiene de governança; evita reintrodução de léxico legado e bloqueio de trabalho legítimo |
| 10 | Validar prontidão de integrações externas §13 (Clerk org‑map, Google redirect/`PUBLIC_API_BASE_URL` em prod, meta‑api) | **4h** | Fecha a lente que falta; evita falha de config externa no go‑live |

---

## Dependências cruzadas

- **bevox-harness** — contrato de dispatch/callback: `outgoing-messages-not-persisted`
  (harness perde histórico assistant), `media-only-dispatch-empty-messages`,
  `openapi create-refund` ausente, fixture `harness-contract.test.ts` (FK).
  **Mitigante recorrente:** o harness está **inerte em produção** (nenhum proposal
  emitido) → os gaps de proposal/autonomia não atingem o piloto manual_assisted.
- **bevox-meta-api** — entrega outbound real: `complete-ignores-delivery-failure`,
  `tenant_id=null` drop, eventos não‑message sem handler, prontidão do endpoint no §13.
- **Clerk / Google** (integrações externas, §13) — `clerk-user-provisioning-broken`
  depende de config de claim `organization_id` no dashboard Clerk; Google OAuth
  redirect/watch dependem de `PUBLIC_API_BASE_URL`/`CALENDAR_OAUTH_SUCCESS_URL` em prod.
- **canon (ADRs aceitas não‑implementadas ou divergentes)** — ADR‑014 (payment‑link),
  ADR‑018 (deposit/refund‑automation), **ADR‑020 message‑template (aceita, ausente)**,
  **ADR‑021‑backend priority‑score (aceita, ausente)**, **ADR‑022 (aceita, 2 sub‑keys
  mortas)**, ADR‑010 (fit‑in). Mudança de decisão → ADR superseding no canon, **não**
  fork local (ADR‑005).
- **bevox-PRD-consolidation (hub infra)** — imagem `bevox-postgres` (pg_uuidv7,
  obrigatória — M0000 falha em `postgres:16-alpine` puro), manifest/digest pinning,
  runbook de go‑live que invoca `seed-pilot` na migrator image (quebrada — ver CRÍTICO #2).
- **Governança** — CLAUDE.md §4.4 contradiz canon ADR‑017 (aceita); a própria missão
  desta auditoria herdou rótulos de ADR imprecisos (ex.: "ADR‑019 channels" — na
  verdade backend/ADR‑019 = colapso‑AISuggestion; harness/ADR‑019 = tenancy).

---

## Notas de método

**Orquestração.** Workflow multi‑agente (effort máximo, opt‑in "ultracode"): 15
dimensões de auditoria em paralelo (5 domínios PRD‑vs‑código + OpenAPI, léxico, MFA,
testes, dívida, LGPD, tracker, CI, alçapões, docs) → **verificação adversarial por
dimensão** (cada achado CRÍTICO/ALTO teve sua evidência reaberta por um agente cético,
default a `refuted`/`downgraded`) → **crítico de completude** (o que as dimensões não
cobriram). Custo: 29 agentes, ~2,39M tokens, 843 tool‑uses, ~26 min. A verificação
adversarial **alterou** ~10 severidades — notavelmente rebaixou os 3 enquadramentos do
"bug do MFA sentinel" de CRÍTICO para ALTO/MÉDIO com base no canon (§16.3/ADR‑013), e
rebaixou `refund‑on‑cancel` (ADR‑018 §A2.2 inverteu a premissa) e `clerk-user-provisioning`
(claims‑based auth).

**Verificação manual independente** (eu, fora do workflow) dos achados de maior
consequência: reli `auth/service.ts`, `staff-auth.ts`, `seed-pilot.ts`, `Dockerfile`
(5 stages), `tsconfig.build.json`, e **probei `tsx -e "import('@/shared/uuid.js')"`**
(resolveu — corrigindo a causa‑raiz que CLAUDE.md §8 atribui erradamente). Confirmei
em canon os status de ADR‑016 (`proposed`), ADR‑017 (`aceita 2026-05-18`), ADR‑020/023
(`aceita`), e a versão openapi (`1.10.0`) e tags git (`v1.0.0`/`v1.0.1`).

**Agentes locais.** `.claude/agents/` **não existe** neste repo nem em `~/.claude/`
(passo 4 da missão = resultado nulo). Usei os agent‑types embutidos via Workflow
(subagente padrão com Read/Grep/Glob/Bash) + minha própria verificação. Nenhum agente
de produto foi modificado.

**Ferramentas/canon.** `$BEVOX_KNOWLEDGE_PATH` está **vazio** neste ambiente; o canon
foi consumido pelo path absoluto `~/bevox-knowledge` (consume‑by‑reference,
ADR‑005). Comandos de CI foram reproduzidos localmente (`node_modules` presente; Node
v20.18.1, embora `.nvmrc` peça 22 — possível divergência menor de toolchain).

**Limitações.** (1) Não rodei `pnpm test:integration` (testcontainers, lento) — os 2
testes de integração vermelhos foram diagnosticados por leitura. (2) `OSV Scanner` e
`CodeQL` não são reproduzíveis offline — estados inferidos. (3) **Lacunas de cobertura
para follow‑on** (do crítico de completude, não totalmente auditadas): Módulo 14
Reminders, ADR‑021‑backend priority‑score, ADR‑022 handoff/reminder policy, entidades
§11.1 (StatusHistory/OperationalMetricSnapshot/KnowledgeInterview), Módulos 10/11
(FAQ/Rules), e a emissão real das métricas §12.10 — recomenda‑se uma 2ª passada
dirigida a essas áreas antes do GA. (4) Severidades são calibradas para o **gate do
piloto** (login→agenda→paga); para GA, vários ALTO/MÉDIO sobem.

---

*Gerado autonomamente por Claude Code (headless) em 2026‑06‑02. Sem alteração de código
de produto; somente este relatório. Revisão humana pendente.*
