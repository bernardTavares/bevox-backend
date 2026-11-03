#!/usr/bin/env bash
# PreCompact.sh — snapshot leve antes de compaction. Sem conteúdo de src/**.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

STATE_FILE="$REPO_ROOT/.claude/state/last-session.md"
mkdir -p "$(dirname "$STATE_FILE")"

{
  echo "# last-session.md — gerado $(date -Iseconds 2>/dev/null || date)"
  echo ""
  echo "## Branch"
  git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "?"
  echo ""
  echo "## git status -sb"
  git -C "$REPO_ROOT" status -sb 2>/dev/null || true
  echo ""
  echo "## Últimos 5 commits"
  git -C "$REPO_ROOT" log -5 --oneline 2>/dev/null || true
  echo ""
  echo "## Última migration"
  ls "$REPO_ROOT/db/migrations/" 2>/dev/null | grep -E '^[0-9]+_' | sort -V | tail -1 || echo "(none)"
} > "$STATE_FILE"

log_info "PreCompact snapshot → $STATE_FILE"
