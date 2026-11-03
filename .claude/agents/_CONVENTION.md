# Convenção de agents do bevox-backend

Agents Claude Code locais deste repo. Diferentes da classe hub (governance-heavy) e da classe canon-resident OpenClaw.

## Composição (decisão brainstorming 2026-06-04)

8 agents. Duas origens:

### Reaproveitados do harness (4, formato persona-flavored)

- `engineering-backend-architect` — system architecture review
- `engineering-database-optimizer` — Drizzle schema + query perf
- `engineering-security-engineer` — Fastify auth + secrets + threat model
- `engineering-code-reviewer` — end-of-feature reviews

Cada um clonado literal do harness + bloco `## Backend context` no fim com constraints específicas (stack, tenant, módulos).

### Backend-specific novos (4, formato hub-compact)

- `backend-route-reviewer` — Fastify route convention (Zod + authz + OpenAPI sync)
- `backend-schema-migration-engineer` — Drizzle schema edit + migration generation
- `harness-callback-auditor` — 4 callbacks + X-Execution-Token + dispatch contract
- `backend-staff-rbac-reviewer` — staff_accounts + impersonation + JWT distinto (sucessor vivo do `rbac-staff-architect` arquivado no hub)

## Base obrigatória

Todo agent novo deriva de `_TEMPLATE.md` (formato hub-compact). Agents reaproveitados do harness MANTÊM o formato original (color/emoji/vibe/persona) — não converter.

## Autoridade (canon = SoT, ADR-005)

Lê verdade de:
- **Canon:** `$BEVOX_KNOWLEDGE_PATH/10_prd/bevox-backend/`, `30_adr/bevox-backend/`, `30_adr/_shared/`
- **PRD local legado:** NUNCA (mover via skill `bevox-knowledge-contribute`)
- **Audit corpus (`$AUDIT`):** quando aplicável

PROIBIDO como autoridade:
- `prds/**` legado no hub
- `docs/audits/v1-*/` congelado no hub
- README `docs/adr/` do hub (auto-depreciante)

## Regra de escrita

- Agents podem editar `src/`, `db/`, `test/`, `docs/` LOCAIS (não-canon)
- Agents NUNCA editam canon direto — propõem via skill `bevox-knowledge-contribute` + gate humano (ADR-006)
- `db/migrations/**` é deny global (gerado por drizzle-kit, não editado)

## Lifecycle

- 4 reaproveitados: vida útil indefinida (alinhar com harness em updates trimestrais)
- 4 backend-specific: vida útil indefinida; `backend-staff-rbac-reviewer` pode virar dormente se Marco-3 MFA estabilizar o sistema sem mudanças por 6+ meses
