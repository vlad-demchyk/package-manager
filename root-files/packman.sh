#!/bin/bash
# PackMan - Package Manager Shortcut for Unix/Linux/macOS
# Alias for package-manager.sh

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execute the main package-manager.sh script
exec "$SCRIPT_DIR/package-manager.sh" "$@"
