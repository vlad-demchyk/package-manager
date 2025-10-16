#!/usr/bin/env node

/**
 * PackMan - Shortcut for Package Manager
 * Alias for package-manager.js
 */

// Re-export the main function from package-manager.js
const { main } = require('./package-manager.js');

// Run the main function
if (require.main === module) {
  main();
}

module.exports = { main };
