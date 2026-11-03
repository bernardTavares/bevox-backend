---
name: backend-module-status
description: |
  Lê o product_modules canônico (delivery-tracker.yml em
  $BEVOX_KNOWLEDGE_PATH/40_roadmap/_shared/) e reporta status
  delivered/blocked/in-progress dos work-items do slot bevox-backend.
  Modelado no skill gap-status-report do hub, focado neste slot.
project: bevox-backend
slot: bevox-backend
bevox_knowledge_path_default: ../bevox-knowledge
version: 1.0.0
---

# backend-module-status (slot: bevox-backend)

## Quando usar

- "qual o status dos work-items do backend?"
- "o que tá delivered/blocked no slot bevox-backend?"
- "preciso de evidência de delivery pra fechar revisão"

## Pre-flight

```bash
BK="${BEVOX_KNOWLEDGE_PATH:-../bevox-knowledge}"
TRACKER="$BK/40_roadmap/_shared/delivery-tracker.yml"
[ -f "$TRACKER" ] || { echo "tracker não encontrado em $TRACKER — exportar BEVOX_KNOWLEDGE_PATH"; exit 1; }
```

Se não resolver, abortar e instruir o usuário a setar `BEVOX_KNOWLEDGE_PATH` ou clonar `bevox-knowledge`.

## O que faz

1. Lê seção `product_modules.bevox-backend` do YAML
2. Para cada work-item:
   - Status declarado (`delivered`/`in_progress`/`blocked`/`empty`)
   - Evidência canônica (arquivos esperados, commit hashes, migration filenames)
   - Verifica presença dos arquivos esperados localmente em `~/code/bevox-backend/`
3. Output: tabela markdown

## Output esperado

```markdown
| Work-item | Status canon | Evidência | Estado local |
|---|---|---|---|
| backend-aisuggestion | delivered | commit 9311911 + ai_suggestions table | ✓ tabela presente |
| backend-staff-rbac | delivered | staff_accounts + impersonations | ✓ |
| backend-m4-chatwoot-p1 | delivered | 0013_clean_romulus.sql + channel_subscriptions | ✓ migration presente |
| backend-m4-chatwoot-p4 | delivered | src/modules/ingestion/ DELETED + inbound-dispatch.ts | ✓ ingestion removed |
| ... |
```

Achados:
- Work-items canon-declarados como `delivered` mas com evidência local ausente
- Work-items `in_progress` sem PR aberto
- Work-items `blocked` com data de bloqueio > 30 dias

## Não faz

- Não modifica o tracker (canon = read-only daqui)
- Não cria PR/issue automaticamente
- Não interpreta o que "delivered" significa além do declarado em canon (single-source ADR-023)

## Referências

- Skill irmã: `gap-status-report` no hub (`~/code/bevox-PRD-consolidation/.claude/skills/gap-status-report/`)
- ADR-023 (delivery tracker como SoT)
- ADR-005 (canon = SoT)
