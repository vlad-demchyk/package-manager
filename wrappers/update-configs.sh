#!/bin/bash
# Wrapper Unix/Linux/macOS per update-configs
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/../scripts/update-configs.js" "$@"
