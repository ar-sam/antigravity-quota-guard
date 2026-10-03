#!/usr/bin/env bash
# ==============================================================================
# Antigravity Quota Guard — CLI & Interactive Lifecycle Runner
# Usage:
#   ./patch.sh          - Interactive Menu
#   ./patch.sh install  - Apply patch to Antigravity
#   ./patch.sh update   - In-place refresh preserving factory backups (R5)
#   ./patch.sh upgrade  - Alias for update
#   ./patch.sh resume   - Manage and resume saved conversation checkpoints (R4)
#   ./patch.sh checkpoints - Alias for resume
#   ./patch.sh status   - Live dual-bucket quota telemetry report
#   ./patch.sh config   - Terminal configuration editor
#   ./patch.sh uninstall- Pristine factory restore
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required but not found in PATH."
  echo "Please install Node.js (version 18 or higher) to continue."
  exit 1
fi

# Ensure local dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "First run detected: Installing dependencies..."
  npm install --silent
fi

# Run the CLI engine
exec node bin/index.js "$@"
