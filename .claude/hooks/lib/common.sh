#!/usr/bin/env bash
# bevox-backend/.claude/hooks/lib/common.sh — funções compartilhadas pelos hooks.
# Pattern: warn-only (sem block()). Decisão: 2026-06-04 brainstorming.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HUB_ROOT="$(cd "$REPO_ROOT/../bevox-PRD-consolidation" 2>/dev/null && pwd || echo "")"
HARNESS_ROOT="$(cd "$REPO_ROOT/../bevox-harness" 2>/dev/null && pwd || echo "")"
META_API_ROOT="$(cd "$REPO_ROOT/../bevox-meta-api" 2>/dev/null && pwd || echo "")"
KNOWLEDGE_ROOT="$(cd "${BEVOX_KNOWLEDGE_PATH:-${BEVOX_KNOWLEDGE_ROOT:-$REPO_ROOT/../../bevox-knowledge}}" 2>/dev/null && pwd || echo "")"

log_info()  { printf '[hook] %s\n' "$*" >&2; }
log_warn()  { printf '[hook WARN] %s\n' "$*" >&2; }
log_error() { printf '[hook ERROR] %s\n' "$*" >&2; }

# dispatch_warning <topic> <message> — warn-only. Sempre retorna 0.
dispatch_warning() {
  local topic="$1" msg="$2"
  printf '\n⚠️  [%s] %s\n' "$topic" "$msg" >&2
  return 0
}
