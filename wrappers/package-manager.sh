#!/bin/bash
# Wrapper Unix/Linux/macOS per package-manager
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/../scripts/core.js" "$@"
