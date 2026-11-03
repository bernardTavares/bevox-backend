---
name: <kebab-case; idêntico ao nome do arquivo>
description: |
  <Quando invocar. Escopo. O que NÃO faz. 2-5 linhas.>
tools: [Read, Grep, Glob, Bash]   # read-only default; Edit/Write só com justificativa em ## Limites
model: opus                        # opus default; sonnet só p/ agent mecânico (racional em ## Limites)
context_strategy: |
  Autoridade: canon via $BEVOX_KNOWLEDGE_PATH (default ../bevox-knowledge ou $HOME/bevox-knowledge);
  rules locais via .claude/rules/.
  Carregar:
  - <rules locais relevantes: .claude/rules/backend-{tenancy,routes,db,workers,tests,harness-contract,stack}.md>
  - <PRD/ADR canon: $BEVOX_KNOWLEDGE_PATH/10_prd/bevox-backend/** | $BEVOX_KNOWLEDGE_PATH/30_adr/bevox-backend/** | $BEVOX_KNOWLEDGE_PATH/30_adr/_shared/**>
  - <skill consumer relevante: bevox-agent-harness-consumer, bevox-meta-api-consumer (plugin)>
  - <input passado>
  PROIBIDO: prds/** legado do hub, docs/audits/v1-* congelado, README docs/adr do hub.
output_format: |
  <Formato de saída do agent.>
---

# Agent: <name>

## Quando me invocar
<gatilhos concretos>

## O que NÃO faço
<limites de responsabilidade>

## Autoridade
Canon via `$BEVOX_KNOWLEDGE_PATH` (ADR-005). Rules locais em `.claude/rules/`.
Nunca escrevo no canon direto — proponho via skill `bevox-knowledge-contribute` + gate humano (ADR-006).

## Limites
<read-only? Edit/Write justificado? model sonnet justificado? estado off-limits>
