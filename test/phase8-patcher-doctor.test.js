/**
 * Phase 8 Test Suite: Transactional ASAR Patcher, Preflight, Backup Manager, Clipboard & Doctor
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');

const { copyToClipboard, readFromClipboard } = require('../platform/platform-clipboard');
const { PreflightChecker } = require('../installer/preflight-checker');
const { BackupManager, sha256File } = require('../installer/backup-manager');
const { AsarPatcher } = require('../installer/asar-patcher');
const { QuotaGuardDoctor } = require('../tools/doctor');

test('Phase 8: Transactional ASAR Patcher, Preflight, Backup Manager, Clipboard & Doctor', async (t) => {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-phase8-test-'));

  t.after(() => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('8.1 Platform Clipboard: Cross-Platform Copy & Read', () => {
    const testText = 'Antigravity Quota Guard V2.2 Recovery Document\nسهمیه: ۱۲٪';
    const copied = copyToClipboard(testText);
    assert.equal(copied, true);

    const readBack = readFromClipboard();
    assert.ok(typeof readBack === 'string');
    // If running in macOS with display server, readBack will match testText
    if (process.platform === 'darwin') {
      assert.equal(readBack.trim(), testText.trim());
    }
  });

  await t.test('8.2 Preflight Checker: Process, Target & Free Space Verification', () => {
    const checker = new PreflightChecker({ appPath: sandboxDir });

    // Mock an app structure
    const resourcesDir = path.join(sandboxDir, 'Contents', 'Resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    const mockAsar = path.join(resourcesDir, 'app.asar');
    fs.writeFileSync(mockAsar, 'dummy asar content');

    const appCheck = checker.checkAppTarget(sandboxDir);
    assert.equal(appCheck.exists, true);
    assert.equal(appCheck.asarPath, mockAsar);

    const spaceCheck = checker.checkDiskSpace(resourcesDir);
    assert.equal(spaceCheck.sufficient, true);

    const sameFs = checker.checkSameFilesystem(mockAsar, resourcesDir);
    assert.equal(sameFs, true);

    const preflight = checker.runPreflight({ appPath: sandboxDir, ignoreRunningProcess: true });
    assert.equal(preflight.passed, true);
  });

  await t.test('8.3 Backup Manager: Original Preservation, Manifest & Statusline State', () => {
    const backupDir = path.join(sandboxDir, 'backups');
    const bm = new BackupManager({ backupRootDir: backupDir, maxBackups: 3 });

    const sourceAsar = path.join(sandboxDir, 'test.asar');
    fs.writeFileSync(sourceAsar, 'initial-asar-bytes-original');

    // 1. Preserve original
    const origPath = bm.preserveOriginalAsar(sourceAsar);
    assert.ok(fs.existsSync(origPath));
    assert.equal(fs.readFileSync(origPath, 'utf8'), 'initial-asar-bytes-original');

    // Subsequent call must NEVER overwrite original
    fs.writeFileSync(sourceAsar, 'mutated-bytes');
    bm.preserveOriginalAsar(sourceAsar);
    assert.equal(fs.readFileSync(origPath, 'utf8'), 'initial-asar-bytes-original');

    // 2. Create versioned backup with statuslinePreviousState
    const manifest = bm.createBackup(sourceAsar, {
      antigravityVersion: '2.0.0',
      statuslinePreviousState: { enabled: true, mode: 'custom', customCommand: 'my-status.sh' }
    });

    assert.equal(manifest.statuslinePreviousState.enabled, true);
    assert.equal(manifest.statuslinePreviousState.customCommand, 'my-status.sh');

    // 3. List and prune backups
    bm.createBackup(sourceAsar);
    bm.createBackup(sourceAsar);
    bm.createBackup(sourceAsar);
    bm.createBackup(sourceAsar);

    const list = bm.listBackups();
    assert.ok(list.length <= 3, 'Must prune to maxBackups');
    assert.ok(fs.existsSync(origPath), 'Original backup must remain preserved');

    // 4. Restore original
    const restored = bm.restoreBackup(sourceAsar);
    assert.equal(restored.restored, true);
    assert.equal(fs.readFileSync(sourceAsar, 'utf8'), 'initial-asar-bytes-original');
  });

  await t.test('8.4 ASAR Patcher: Dry-Run, Exact Patch-Diff & Transactional Replacement', async () => {
    // Build real mock ASAR package
    const packSourceDir = path.join(sandboxDir, 'pack-src');
    fs.mkdirSync(path.join(packSourceDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packSourceDir, 'dist', 'utils.js'), 'function foo() { return 1; }');
    fs.writeFileSync(path.join(packSourceDir, 'index.html'), '<html><body>test</body></html>');

    const testAsarPath = path.join(sandboxDir, 'live-app.asar');
    await asar.createPackage(packSourceDir, testAsarPath);

    const patcher = new AsarPatcher({
      asarPath: testAsarPath,
      backupManager: new BackupManager({ backupRootDir: path.join(sandboxDir, 'patch-backups') }),
      preflightChecker: new PreflightChecker({ appPath: sandboxDir })
    });

    // 1. Dry-Run mode
    const dryRunRes = await patcher.patch({ dryRun: true, ignoreRunningProcess: true });
    assert.equal(dryRunRes.success, true);
    assert.equal(dryRunRes.dryRun, true);
    assert.ok(dryRunRes.diff.valid);

    // 2. Live patch with allowed diff
    const liveRes = await patcher.patch({ dryRun: false, ignoreRunningProcess: true });
    assert.equal(liveRes.success, true);
    assert.equal(liveRes.dryRun, false);
    assert.notEqual(liveRes.patchedSha256, liveRes.originalSha256);

    // 3. Exact Patch-Diff violation: modifier touches unexpected file -> must abort!
    await assert.rejects(async () => {
      await patcher.patch({
        dryRun: false,
        ignoreRunningProcess: true,
        modifierFn: async (stagedDir) => {
          fs.writeFileSync(path.join(stagedDir, 'index.html'), 'MODIFIED_ILLEGALLY');
        }
      });
    }, /Exact Patch-Diff check/);
  });

  await t.test('8.5 Doctor Diagnostic Audit: Subsystems & Health Status', () => {
    const doctor = new QuotaGuardDoctor({
      appPath: sandboxDir,
      rootDir: path.resolve(__dirname, '..'),
      configDir: path.join(sandboxDir, 'config'),
      checkpointsDir: path.join(sandboxDir, 'checkpoints')
    });

    const report = doctor.runDiagnostics();
    assert.ok(report.guardVersion.includes('2.2.0'));
    assert.ok(['HEALTHY', 'DEGRADED', 'UNHEALTHY'].includes(report.status));
    assert.ok(report.checks.pluginLayout);
    assert.ok(report.checks.displayEnvironment.timeZone);
  });
});
