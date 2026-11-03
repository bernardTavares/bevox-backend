#!/usr/bin/env bash
# PostToolUse-schema.sh — avisa quando db/schema/** é editado sem nova migration.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET="${CLAUDE_TOOL_FILE_PATH:-}"
[[ "$TARGET" =~ ^db/schema/.+\.ts$ ]] || exit 0

# Nova migration desde HEAD? (added ou untracked em db/migrations/)
new_migrations=$(git -C "$REPO_ROOT" status --porcelain db/migrations/ 2>/dev/null | awk '/^(\?\?|A )/ {n++} END {print n+0}')
if [[ "${new_migrations:-0}" -eq 0 ]]; then
  dispatch_warning schema "schema editado em '$TARGET' mas nenhuma migration nova em 'db/migrations/' — rodar 'pnpm migrate:generate <descricao>'"
fi

exit 0
