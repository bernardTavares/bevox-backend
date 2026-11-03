#!/usr/bin/env bash
# PostToolUse-routes.sh — avisa quando rota Fastify é editada sem Zod schema ou sem regen OpenAPI.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET="${CLAUDE_TOOL_FILE_PATH:-}"
[[ "$TARGET" =~ ^src/modules/[^/]+/routes\.ts$ ]] || exit 0

module_dir="$(dirname "$TARGET")"
schemas_path="$REPO_ROOT/$module_dir/schemas.ts"

if [[ ! -f "$schemas_path" ]]; then
  dispatch_warning routes "rota editada em '$TARGET' mas '$module_dir/schemas.ts' não existe — Zod schema obrigatório (rule backend-routes)"
fi

# Heurística: rota tocada mas openapi/ não no stage
if [[ -d "$REPO_ROOT/openapi" ]]; then
  if ! git -C "$REPO_ROOT" diff --cached --name-only 2>/dev/null | grep -q '^openapi/'; then
    dispatch_warning routes "rota editada mas 'openapi/' não staged — rodar 'pnpm openapi:types' e revisar contrato antes de commitar"
  fi
fi

exit 0
