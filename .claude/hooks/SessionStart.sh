#!/usr/bin/env bash
# SessionStart.sh — banner inicial: branch, prettier, migration, vizinhos, canon.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

log_info "bevox-backend — sessão iniciada em $(date -Iseconds 2>/dev/null || date)"
echo "Branch: $(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo '?')"

# Ahead/behind vs origin
ahead_behind=$(git -C "$REPO_ROOT" rev-list --left-right --count "@{upstream}...HEAD" 2>/dev/null || echo "")
if [[ -n "$ahead_behind" ]]; then
  behind=$(echo "$ahead_behind" | cut -f1)
  ahead=$(echo "$ahead_behind" | cut -f2)
  echo "vs origin: ahead $ahead, behind $behind"
fi

# Prettier dirty count (best-effort; sem rodar se pnpm não existir)
echo ""
if command -v pnpm >/dev/null 2>&1; then
  prettier_out=$(cd "$REPO_ROOT" && pnpm -s format:check 2>&1 || true)
  prettier_dirty=$(printf '%s\n' "$prettier_out" | awk '/^\[warn\]/ {n++} END {print n+0}')
  if [[ "${prettier_dirty:-0}" -gt 0 ]]; then
    echo "⚠️  prettier: $prettier_dirty arquivo(s) dirty (rodar 'pnpm format')"
  else
    echo "✓ prettier: clean"
  fi
else
  echo "⚠️  pnpm não no PATH — skip prettier check"
fi

# Última migration
last_migration=$(ls "$REPO_ROOT/db/migrations/" 2>/dev/null | grep -E '^[0-9]+_' | sort -V | tail -1 || echo "")
echo "Última migration: ${last_migration:-(none)}"

# Vizinhos
echo ""
echo "📦 Repos vizinhos:"
for repo in bevox-harness bevox-meta-api bevox-PRD-consolidation; do
  if [[ -d "$REPO_ROOT/../$repo" ]]; then
    b=$(git -C "$REPO_ROOT/../$repo" branch --show-current 2>/dev/null || echo "?")
    last=$(git -C "$REPO_ROOT/../$repo" log -1 --format=%cr 2>/dev/null || echo "?")
    echo "  ✓ $repo @ $b ($last)"
  else
    echo "  ○ $repo — não encontrado"
  fi
done

# Canon
echo ""
if [[ -n "$KNOWLEDGE_ROOT" && -d "$KNOWLEDGE_ROOT" ]]; then
  echo "📚 Canon: $KNOWLEDGE_ROOT ✓"
  tracker="$KNOWLEDGE_ROOT/40_roadmap/_shared/delivery-tracker.yml"
  if [[ -f "$tracker" ]]; then
    # Linha do slot bevox-backend (best-effort sem yq)
    slot_status=$(grep -A 1 "^  bevox-backend:" "$tracker" 2>/dev/null | grep -E "status:" | head -1 | sed 's/^[[:space:]]*//' || echo "")
    [[ -n "$slot_status" ]] && echo "    slot bevox-backend: $slot_status"
  fi
else
  echo "⚠️  Canon não resolvido — exportar BEVOX_KNOWLEDGE_PATH para acessar PRD/ADR canônicos"
fi

echo ""
log_info "Use /agent backend-route-reviewer, /skill backend-module-status, etc."
