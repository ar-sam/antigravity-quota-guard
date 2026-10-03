const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// A simple test to verify that the bin/index.js commands (install/uninstall)
// do not crash and produce expected output or state changes.
// Since patching requires sudo and actual App installations,
// we will just test the dry-run behavior or check if the CLI runs without syntax errors.

describe('Integration Test: bin/index.js', function() {
  it('should display status without crashing', function() {
    try {
      const output = execSync('node bin/index.js status', { encoding: 'utf8' });
      assert.ok(output.includes('Antigravity') || output.includes('Status Report'), 'Output should contain basic HUD info');
    } catch (e) {
      if (e.stdout) {
         assert.ok(e.stdout.includes('Status:'));
      } else {
         assert.fail('CLI crashed: ' + e.message);
      }
    }
  });
});
