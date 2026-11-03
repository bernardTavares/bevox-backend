#!/usr/bin/env bash
# PostToolUse-tenancy.sh — avisa se workspace_id/workspaces aparece fora dos 2 arquivos bridge.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET="${CLAUDE_TOOL_FILE_PATH:-}"
[[ "$TARGET" =~ ^(src/|db/) ]] || exit 0

# Bridge files legítimos (ADR-021 bridge legado)
BRIDGE_FILES=(
  "src/integration/resolve-organization-id.ts"
  "src/integration/harness-dispatch.schema.ts"
)
for bf in "${BRIDGE_FILES[@]}"; do
  [[ "$TARGET" == "$bf" ]] && exit 0
done

# Matcher: workspace_id OU workspaces como palavra inteira (\b é GNU grep). Comentários incluídos.
if grep -qE '\b(workspace_id|workspaces)\b' "$REPO_ROOT/$TARGET" 2>/dev/null; then
  dispatch_warning tenancy "'$TARGET' contém 'workspace_id' ou 'workspaces' — termo retirado pós ADR-021 (canon: organizationId). Bridge legítimo: src/integration/{resolve-organization-id,harness-dispatch.schema}.ts"
fi

exit 0
