#!/bin/bash
# Wrapper Unix/Linux/macOS per clean-only
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/../scripts/clean-only.js" "$@"
