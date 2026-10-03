#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
exec node "$REPO_DIR/integrations/antigravity-hook/cli-bridge.js" "PreInvocation"
