/**
 * Phase 9 Test Suite: Docs-as-Code Pipeline & Mechanical Parity Gate
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DocsGenerator } = require('../tools/docs-generator');

test('Phase 9: Docs-as-Code Pipeline & Mechanical Parity Gate', async (t) => {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-phase9-test-'));

  t.after(() => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('9.1 Automated Docs Generation from Code Schemas', () => {
    const generator = new DocsGenerator({ rootDir: sandboxDir });
    generator.generateAll();

    const genDir = path.join(sandboxDir, 'docs', 'generated');
    assert.ok(fs.existsSync(path.join(genDir, 'SECURITY_INVARIANTS.md')));
    assert.ok(fs.existsSync(path.join(genDir, 'CONFIG_REFERENCE.md')));
    assert.ok(fs.existsSync(path.join(genDir, 'CAPABILITY_REFERENCE.md')));
    assert.ok(fs.existsSync(path.join(genDir, 'CLI_REFERENCE.md')));
    assert.ok(fs.existsSync(path.join(genDir, 'RECOVERY_REFERENCE.md')));
  });

  await t.test('9.2 Mechanical Parity Verification (npm run docs:check)', () => {
    // Generate docs in the actual repository docs/generated folder
    const repoGenerator = new DocsGenerator();
    repoGenerator.generateAll();

    const parityResult = repoGenerator.checkParity();
    assert.equal(parityResult.valid, true, `Parity check must pass without errors: ${parityResult.errors.join(', ')}`);
    assert.equal(parityResult.errors.length, 0);
  });

  await t.test('9.3 Parity Gate Rejection on Incomplete / Tampered Docs', () => {
    const generator = new DocsGenerator({ rootDir: sandboxDir });
    generator.generateAll();

    // Tamper with generated CAPABILITY_REFERENCE.md by removing a capability
    const capPath = path.join(sandboxDir, 'docs', 'generated', 'CAPABILITY_REFERENCE.md');
    fs.writeFileSync(capPath, '# Empty Capabilities\n');

    const tamperedResult = generator.checkParity();
    assert.equal(tamperedResult.valid, false, 'Tampered documentation must fail parity check');
    assert.ok(tamperedResult.errors.length > 0);
    assert.ok(tamperedResult.errors.some(e => e.includes('CAPABILITY_REFERENCE.md missing capability')));
  });
});
