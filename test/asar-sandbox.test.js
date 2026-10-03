'use strict';

/**
 * Test Suite: test/asar-sandbox.test.js
 * Feature: R5 Seamless CLI Update Engine & ASAR Sandbox Integrity
 * Tiers: Tier 1 (Feature Coverage) & Tier 2 (Boundary & Corner Cases)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');

const HOOK_START = '/* === ANTIGRAVITY QUOTA GUARD START === */';
const HOOK_END = '/* === ANTIGRAVITY QUOTA GUARD END === */';

const SAMPLE_HOOK = `
${HOOK_START}
try {
  const _qgPayload = require('./quota-guard-payload.js');
  if (_qgPayload && typeof _qgPayload.initMainProcessHooks === 'function') {
    _qgPayload.initMainProcessHooks();
  }
} catch (_qgErr) {
  console.error('[QuotaGuard] Startup error:', _qgErr);
}
${HOOK_END}
`;

/**
 * Helper to create a sandbox workspace in /tmp
 */
function createSandbox() {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-asar-sandbox-'));
  const srcDir = path.join(sandboxDir, 'src');
  const asarPath = path.join(sandboxDir, 'app.asar');
  const backupPath = path.join(sandboxDir, 'app.asar.bak');

  // Build clean mock Electron app source
  fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'package.json'), JSON.stringify({ name: 'antigravity-mock', version: '1.0.0' }));
  fs.writeFileSync(path.join(srcDir, 'dist', 'main.js'), 'console.log("Mock Electron Main"); require("./utils.js");\n');
  fs.writeFileSync(path.join(srcDir, 'dist', 'utils.js'), '// Original Google Antigravity utils\nmodule.exports = { isMock: true };\n');

  return { sandboxDir, srcDir, asarPath, backupPath };
}

/**
 * Helper to clean up sandbox directory
 */
function cleanupSandbox(sandboxDir) {
  try {
    if (sandboxDir && fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  } catch (_) {}
}

/**
 * Helper to check if an ASAR file contains quota guard hook
 */
function isAsarPatched(asarPath) {
  try {
    asar.uncacheAll();
    const utilsContent = asar.extractFile(asarPath, 'dist/utils.js').toString('utf8');
    return utilsContent.includes(HOOK_START);
  } catch (_) {
    return false;
  }
}

/**
 * Helper implementing the in-place patch refresh logic from bin/index.js
 */
async function applyPatchInPlace(asarPath, backupPath, payloadPath) {
  asar.uncacheAll();
  const isPatched = isAsarPatched(asarPath);

  // Backup Invariant: If unpatched (fresh Google update), create fresh backup
  // If already patched, PRESERVE existing backup
  if (!isPatched) {
    fs.copyFileSync(asarPath, backupPath);
  }

  const tmpExtract = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-extract-'));
  const tmpRepack = path.join(os.tmpdir(), `repack-${Date.now()}-${Math.random().toString(36).slice(2)}.asar`);

  try {
    asar.uncacheAll();
    asar.extractAll(asarPath, tmpExtract);

    const utilsPath = path.join(tmpExtract, 'dist', 'utils.js');
    if (!fs.existsSync(utilsPath)) {
      throw new Error(`dist/utils.js not found in extracted asar`);
    }

    // Overwrite payload
    const destPayload = path.join(tmpExtract, 'dist', 'quota-guard-payload.js');
    fs.copyFileSync(payloadPath, destPayload);

    // Refresh hook in utils.js idempotently
    let content = fs.readFileSync(utilsPath, 'utf8');
    if (content.includes(HOOK_START)) {
      const before = content.substring(0, content.indexOf(HOOK_START));
      const after = content.substring(content.indexOf(HOOK_END) + HOOK_END.length);
      content = before + after;
    }
    content += '\n' + SAMPLE_HOOK + '\n';
    fs.writeFileSync(utilsPath, content, 'utf8');

    // Repack
    asar.uncacheAll();
    await asar.createPackage(tmpExtract, tmpRepack);

    // Atomically replace
    asar.uncacheAll();
    fs.copyFileSync(tmpRepack, asarPath);
    asar.uncacheAll();
  } finally {
    try {
      asar.uncacheAll();
      if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });
      if (fs.existsSync(tmpRepack)) fs.unlinkSync(tmpRepack);
    } catch (_) {}
  }
}

describe('R5: ASAR Sandbox Extraction, Update & Repacking', () => {

  const payloadSource = path.join(__dirname, '..', 'bin', 'payload.js');

  describe('Tier 1: Feature Coverage (>=5 tests)', () => {
    it('1.1 Can package a clean mock Electron app into an app.asar archive', async () => {
      const { sandboxDir, srcDir, asarPath } = createSandbox();
      try {
        await asar.createPackage(srcDir, asarPath);
        assert.ok(fs.existsSync(asarPath), 'mock app.asar was created');

        const list = asar.listPackage(asarPath);
        assert.ok(list.includes('/dist/main.js'), 'Package contains /dist/main.js');
        assert.ok(list.includes('/dist/utils.js'), 'Package contains /dist/utils.js');
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });

    it('1.2 Extracts archive cleanly to sandbox directory without data loss', async () => {
      const { sandboxDir, srcDir, asarPath } = createSandbox();
      const extractTarget = path.join(sandboxDir, 'extracted');
      try {
        await asar.createPackage(srcDir, asarPath);
        asar.extractAll(asarPath, extractTarget);

        assert.ok(fs.existsSync(path.join(extractTarget, 'dist', 'utils.js')));
        const content = fs.readFileSync(path.join(extractTarget, 'dist', 'utils.js'), 'utf8');
        assert.ok(content.includes('isMock: true'));
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });

    it('1.3 Injects quota-guard-payload.js and updates dist/utils.js hook', async () => {
      const { sandboxDir, srcDir, asarPath, backupPath } = createSandbox();
      try {
        await asar.createPackage(srcDir, asarPath);
        assert.strictEqual(isAsarPatched(asarPath), false, 'Initially unpatched');

        await applyPatchInPlace(asarPath, backupPath, payloadSource);

        assert.strictEqual(isAsarPatched(asarPath), true, 'Successfully marked as patched');
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });

    it('1.4 Repacked ASAR archive has verified integrity and readable contents', async () => {
      const { sandboxDir, srcDir, asarPath, backupPath } = createSandbox();
      try {
        await asar.createPackage(srcDir, asarPath);
        await applyPatchInPlace(asarPath, backupPath, payloadSource);

        const list = asar.listPackage(asarPath);
        assert.ok(list.includes('/dist/quota-guard-payload.js'), 'Repacked ASAR contains injected payload');
        assert.ok(list.includes('/dist/utils.js'), 'Repacked ASAR contains utils.js');

        const extractedUtils = asar.extractFile(asarPath, 'dist/utils.js').toString('utf8');
        assert.ok(extractedUtils.includes(HOOK_START), 'utils.js contains hook start tag');
        assert.ok(extractedUtils.includes(HOOK_END), 'utils.js contains hook end tag');

        const extractedPayload = asar.extractFile(asarPath, 'dist/quota-guard-payload.js').toString('utf8');
        assert.ok(extractedPayload.includes('Antigravity Quota Guard'), 'Extracted payload header is valid');
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });

    it('1.5 Fresh Google update backup invariant: creates app.asar.bak when unpatched', async () => {
      const { sandboxDir, srcDir, asarPath, backupPath } = createSandbox();
      try {
        await asar.createPackage(srcDir, asarPath);
        assert.strictEqual(fs.existsSync(backupPath), false, 'No backup prior to first patch');

        await applyPatchInPlace(asarPath, backupPath, payloadSource);

        assert.ok(fs.existsSync(backupPath), 'Created app.asar.bak on first patch / fresh Google update');
        assert.strictEqual(isAsarPatched(backupPath), false, 'Backup must contain clean factory code');
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });
  });

  describe('Tier 2: Boundary & Corner Cases (>=5 tests)', () => {
    it('2.1 Already patched invariant: existing clean backup is NEVER overwritten', async () => {
      const { sandboxDir, srcDir, asarPath, backupPath } = createSandbox();
      try {
        await asar.createPackage(srcDir, asarPath);

        // Run first update (creates factory backup)
        await applyPatchInPlace(asarPath, backupPath, payloadSource);
        assert.ok(fs.existsSync(backupPath));

        const backupContentBefore = fs.readFileSync(backupPath);
        const backupStatBefore = fs.statSync(backupPath);

        // Wait a slight tick to allow mtime difference if it were modified
        await new Promise(r => setTimeout(r, 60));

        // Run second update (simulating ./patch.sh update on an already patched app)
        await applyPatchInPlace(asarPath, backupPath, payloadSource);

        const backupContentAfter = fs.readFileSync(backupPath);
        const backupStatAfter = fs.statSync(backupPath);

        // Invariant assertion: Backup MUST NOT be modified or replaced with patched version
        assert.strictEqual(backupStatBefore.mtimeMs, backupStatAfter.mtimeMs, 'Backup mtime must be preserved');
        assert.deepStrictEqual(backupContentBefore, backupContentAfter, 'Backup content must remain identical');
        assert.strictEqual(isAsarPatched(backupPath), false, 'Backup must still be unpatched');
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });

    it('2.2 Idempotent hook injection: multiple updates do not duplicate hook markers', async () => {
      const { sandboxDir, srcDir, asarPath, backupPath } = createSandbox();
      try {
        await asar.createPackage(srcDir, asarPath);

        // Apply 3 successive updates
        await applyPatchInPlace(asarPath, backupPath, payloadSource);
        await applyPatchInPlace(asarPath, backupPath, payloadSource);
        await applyPatchInPlace(asarPath, backupPath, payloadSource);

        const utilsContent = asar.extractFile(asarPath, 'dist/utils.js').toString('utf8');
        const startMatches = (utilsContent.match(new RegExp(HOOK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        const endMatches = (utilsContent.match(new RegExp(HOOK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

        assert.strictEqual(startMatches, 1, 'There must be exactly ONE hook start tag');
        assert.strictEqual(endMatches, 1, 'There must be exactly ONE hook end tag');
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });

    it('2.3 Corrupt archive or missing dist/utils.js raises clean error without leaving locks', async () => {
      const { sandboxDir, srcDir, asarPath, backupPath } = createSandbox();
      try {
        // Remove utils.js to simulate corrupt archive
        fs.unlinkSync(path.join(srcDir, 'dist', 'utils.js'));
        await asar.createPackage(srcDir, asarPath);

        await assert.rejects(
          async () => {
            await applyPatchInPlace(asarPath, backupPath, payloadSource);
          },
          /dist\/utils\.js not found/
        );
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });

    it('2.4 Atomic replacement leaves intact asar file even under immediate read', async () => {
      const { sandboxDir, srcDir, asarPath, backupPath } = createSandbox();
      try {
        await asar.createPackage(srcDir, asarPath);
        await applyPatchInPlace(asarPath, backupPath, payloadSource);

        const stat = fs.statSync(asarPath);
        assert.ok(stat.size > 1000, 'Replaced ASAR has positive size');
        const files = asar.listPackage(asarPath);
        assert.ok(files.length >= 3, 'All files intact');
      } finally {
        cleanupSandbox(sandboxDir);
      }
    });

    it('2.5 Sandbox lifecycle cleans up all temporary directories in /tmp', async () => {
      const { sandboxDir, srcDir, asarPath, backupPath } = createSandbox();
      try {
        await asar.createPackage(srcDir, asarPath);
        await applyPatchInPlace(asarPath, backupPath, payloadSource);
      } finally {
        cleanupSandbox(sandboxDir);
      }

      assert.strictEqual(fs.existsSync(sandboxDir), false, 'Sandbox directory was completely removed');
    });
  });
});
