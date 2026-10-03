/**
 * Antigravity Quota Guard — Transactional ASAR Patcher
 * Implements R7 and R21 from architecture specification:
 * - "Plugin First, ASAR Last" principle.
 * - Staging on the same filesystem.
 * - Exact patch-diff invariant (only allowlisted files may differ).
 * - Original and patched SHA-256 verification.
 * - Dry-run mode (`quota-guard patch --dry-run`).
 * - Byte-identical rollback on failure.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const { BackupManager, sha256File } = require('./backup-manager');
const { PreflightChecker } = require('./preflight-checker');

/**
 * Files permitted to differ between original and patched ASAR.
 */
const DEFAULT_ALLOWLISTED_DIFF_FILES = [
  'dist/utils.js',
  'dist/quota-guard-payload.js',
  'dist/quota-guard-snapshot.js',
  'dist/ui/desktop-hud'
];

/**
 * Safely and atomically replaces target with source, handling Windows EPERM/EBUSY.
 */
function safeAtomicReplace(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EEXIST' || err.code === 'EBUSY') {
      const oldTemp = `${targetPath}.old.${Date.now()}`;
      try {
        fs.renameSync(targetPath, oldTemp);
      } catch (_) {
        fs.copyFileSync(sourcePath, targetPath);
        try { fs.unlinkSync(sourcePath); } catch (_) {}
        return;
      }
      try {
        fs.renameSync(sourcePath, targetPath);
        try { fs.unlinkSync(oldTemp); } catch (_) {}
      } catch (moveErr) {
        try { fs.renameSync(oldTemp, targetPath); } catch (_) {}
        throw moveErr;
      }
    } else {
      throw err;
    }
  }
}

class AsarPatcher {
  constructor(options = {}) {
    this._asarPath = options.asarPath || null;
    this._backupManager = options.backupManager || new BackupManager(options);
    this._preflightChecker = options.preflightChecker || new PreflightChecker(options);
    this._allowlistedDiffFiles = options.allowlistedDiffFiles || DEFAULT_ALLOWLISTED_DIFF_FILES;
  }

  /**
   * Evaluates diff between original and patched directory.
   * R21 Invariant: Aborts if unexpected files were modified.
   * @param {string} originalExtractDir
   * @param {string} stagedExtractDir
   * @returns {{ valid: boolean, modifiedFiles: string[], unexpectedFiles: string[] }}
   */
  evaluatePatchDiff(originalExtractDir, stagedExtractDir) {
    const modifiedFiles = [];
    const unexpectedFiles = [];

    // Recursively collect all relative file paths from a directory
    const collectFiles = (dir, prefix = '') => {
      const results = [];
      if (!fs.existsSync(dir)) return results;
      const entries = fs.readdirSync(dir);
      for (const e of entries) {
        const full = path.join(dir, e);
        const rel = prefix ? `${prefix}/${e}` : e;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          results.push(...collectFiles(full, rel));
        } else {
          results.push(rel);
        }
      }
      return results;
    };

    const origFiles = new Set(collectFiles(originalExtractDir));
    const stagedFiles = new Set(collectFiles(stagedExtractDir));

    // 1. Detect deleted files (present in original, absent in staged)
    for (const f of origFiles) {
      if (!stagedFiles.has(f)) {
        unexpectedFiles.push(`deleted:${f}`);
      }
    }

    // 2. Detect added or modified files
    for (const f of stagedFiles) {
      const origFull = path.join(originalExtractDir, f);
      const stagedFull = path.join(stagedExtractDir, f);

      if (!origFiles.has(f)) {
        // New file added
        const isAllowed = this._allowlistedDiffFiles.some(af => f.startsWith(af) || f === af);
        if (isAllowed) {
          modifiedFiles.push(`added:${f}`);
        } else {
          unexpectedFiles.push(`added:${f}`);
        }
      } else {
        // Compare SHA-256 content hashes
        const h1 = sha256File(origFull);
        const h2 = sha256File(stagedFull);
        if (h1 !== h2) {
          const isAllowed = this._allowlistedDiffFiles.includes(f);
          if (isAllowed) {
            modifiedFiles.push(`modified:${f}`);
          } else {
            unexpectedFiles.push(`modified:${f}`);
          }
        }
      }
    }

    return {
      valid: unexpectedFiles.length === 0,
      modifiedFiles,
      unexpectedFiles
    };
  }

  /**
   * Applies the transactional patch with preflight, backup, diff verification, and rollback.
   * @param {object} [options]
   * @param {boolean} [options.dryRun=false]
   * @param {Function} [options.modifierFn] - Function that modifies extracted files in staging dir
   * @returns {Promise<object>}
   */
  async patch(options = {}) {
    const targetAsar = options.asarPath || this._asarPath;
    if (!targetAsar || !fs.existsSync(targetAsar)) {
      throw new Error(`Target ASAR does not exist: ${targetAsar}`);
    }

    const dryRun = options.dryRun === true;

    // 1. Run Preflight Checks
    const preflight = this._preflightChecker.runPreflight({
      asarPath: targetAsar,
      ignoreRunningProcess: options.ignoreRunningProcess ?? dryRun
    });

    if (!preflight.passed && !options.force) {
      const failed = preflight.checks.filter(c => !c.passed).map(c => c.name).join(', ');
      throw new Error(`Preflight check failed: ${failed}`);
    }

    const originalSha = sha256File(targetAsar);

    // 2. Create versioned backup (unless dry run without backup requested)
    let backupManifest = null;
    if (!dryRun || options.createBackupOnDryRun) {
      backupManifest = this._backupManager.createBackup(targetAsar, {
        guardVersion: '2.2.0',
        antigravityVersion: options.antigravityVersion || '2.0.0'
      });
    }

    // 3. Staging on the same filesystem
    const asarDir = path.dirname(targetAsar);
    const timestamp = Date.now();
    const stagingExtractDir = path.join(asarDir, `.staging.extract.${timestamp}`);
    const originalExtractDir = path.join(asarDir, `.original.extract.${timestamp}`);
    const repackedAsarPath = path.join(asarDir, `.patched.${timestamp}.asar`);

    try {
      // Extract original for diff comparison
      asar.extractAll(targetAsar, originalExtractDir);
      asar.extractAll(targetAsar, stagingExtractDir);

      // 4. Apply modifier
      if (typeof options.modifierFn === 'function') {
        await options.modifierFn(stagingExtractDir);
      } else {
        // Default dummy injection into dist/utils.js for testing / marker injection
        const utilsPath = path.join(stagingExtractDir, 'dist', 'utils.js');
        if (fs.existsSync(utilsPath)) {
          let code = fs.readFileSync(utilsPath, 'utf8');
          if (!code.includes('__QUOTA_GUARD_V2_2_HYBRID__')) {
            code = `/* __QUOTA_GUARD_V2_2_HYBRID__ */\n${code}`;
            fs.writeFileSync(utilsPath, code, 'utf8');
          }
        }
      }

      // 5. Exact Patch-Diff check (R21)
      const diff = this.evaluatePatchDiff(originalExtractDir, stagingExtractDir);
      if (!diff.valid) {
        throw new Error(`Patch aborted by Exact Patch-Diff check. Unexpected files modified: ${diff.unexpectedFiles.join(', ')}`);
      }

      // 6. Repack to temporary archive on the same filesystem
      await asar.createPackage(stagingExtractDir, repackedAsarPath);
      const patchedSha = sha256File(repackedAsarPath);

      if (patchedSha === originalSha) {
        throw new Error('Patch produced identical SHA-256; no changes were applied.');
      }

      // 7. Handle Dry-Run
      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          originalSha256: originalSha,
          stagedSha256: patchedSha,
          diff,
          message: 'Dry run completed successfully. Target ASAR was not modified.'
        };
      }

      // 8. Live Transactional Atomic Replacement
      safeAtomicReplace(repackedAsarPath, targetAsar);

      // Verify post-patch
      const postSha = sha256File(targetAsar);
      if (postSha !== patchedSha) {
        // Verification failed! Byte-identical rollback immediately!
        this._backupManager.restoreBackup(targetAsar);
        throw new Error('Post-patch SHA verification failed! Rolled back to original ASAR.');
      }

      return {
        success: true,
        dryRun: false,
        originalSha256: originalSha,
        patchedSha256: postSha,
        backupManifest,
        diff
      };
    } catch (err) {
      // Clean up and ensure rollback
      if (!dryRun && fs.existsSync(targetAsar) && sha256File(targetAsar) !== originalSha) {
        try { this._backupManager.restoreBackup(targetAsar); } catch {}
      }
      throw err;
    } finally {
      // Clean up temporary extraction directories
      try { fs.rmSync(stagingExtractDir, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(originalExtractDir, { recursive: true, force: true }); } catch {}
      try { if (fs.existsSync(repackedAsarPath)) fs.rmSync(repackedAsarPath, { force: true }); } catch {}
    }
  }

  /**
   * Rolls back live ASAR to a previous backup.
   * @param {string|null} [backupId=null]
   * @returns {object}
   */
  rollback(backupId = null) {
    if (!this._asarPath) {
      throw new Error('Target ASAR path not configured for rollback');
    }
    return this._backupManager.restoreBackup(this._asarPath, backupId);
  }
}

module.exports = {
  AsarPatcher,
  DEFAULT_ALLOWLISTED_DIFF_FILES
};
