/**
 * Antigravity Quota Guard — Backup Manager
 * Manages versioned ASAR backups, original LKG preservation, and statusline semantic restore.
 *
 * Implements R7, R16, and R28 from architecture specification.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Computes SHA-256 of a file.
 * @param {string} filePath
 * @returns {string}
 */
function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

class BackupManager {
  constructor(options = {}) {
    this._backupRootDir = options.backupRootDir || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'backups');
    this._maxBackups = options.maxBackups ?? 5;
  }

  /**
   * Ensures the backup root directory exists with secure permissions 0700.
   */
  ensureBackupDir() {
    if (!fs.existsSync(this._backupRootDir)) {
      fs.mkdirSync(this._backupRootDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Preserves the original unaltered ASAR if not already stored.
   * R7 Invariant: NEVER overwrites the original baseline backup.
   * @param {string} sourceAsarPath
   * @returns {string} Path to original backup
   */
  preserveOriginalAsar(sourceAsarPath) {
    this.ensureBackupDir();
    const originalPath = path.join(this._backupRootDir, 'app.asar.original');

    if (!fs.existsSync(originalPath) && fs.existsSync(sourceAsarPath)) {
      fs.copyFileSync(sourceAsarPath, originalPath);
      // Write companion hash
      const hash = sha256File(originalPath);
      fs.writeFileSync(`${originalPath}.sha256`, hash, { mode: 0o600 });
    }

    return originalPath;
  }

  /**
   * Creates a new timestamped versioned backup with a backup-manifest.json.
   * @param {string} sourceAsarPath
   * @param {object} [metadata]
   * @returns {object} Manifest of the created backup
   */
  createBackup(sourceAsarPath, metadata = {}) {
    this.ensureBackupDir();
    this.preserveOriginalAsar(sourceAsarPath);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const version = metadata.antigravityVersion || 'v2.2.0';
    const backupDirName = `backup_${timestamp}_${version}`;
    const backupDir = path.join(this._backupRootDir, backupDirName);

    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

    const targetAsarBackup = path.join(backupDir, 'app.asar');
    if (fs.existsSync(sourceAsarPath)) {
      fs.copyFileSync(sourceAsarPath, targetAsarBackup);
    }

    const originalSha = sha256File(path.join(this._backupRootDir, 'app.asar.original'));
    const backupSha = sha256File(targetAsarBackup);

    const manifest = {
      backupId: backupDirName,
      createdAt: new Date().toISOString(),
      guardVersion: metadata.guardVersion || '2.2.0',
      antigravityVersion: metadata.antigravityVersion || 'unknown',
      originalAsarSha256: originalSha,
      backupAsarSha256: backupSha,
      statuslinePreviousState: metadata.statuslinePreviousState || {
        enabled: false,
        mode: 'standard',
        customCommand: null
      },
      backupPath: targetAsarBackup
    };

    fs.writeFileSync(path.join(backupDir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

    this.pruneBackups(this._maxBackups);

    return manifest;
  }

  /**
   * Lists all available backups.
   * @returns {object[]}
   */
  listBackups() {
    this.ensureBackupDir();
    const entries = fs.readdirSync(this._backupRootDir);
    const manifests = [];

    for (const name of entries) {
      const manifestPath = path.join(this._backupRootDir, name, 'backup-manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const raw = fs.readFileSync(manifestPath, 'utf8');
          manifests.push(JSON.parse(raw));
        } catch {}
      }
    }

    return manifests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Prunes older backups beyond the configured limit while preserving app.asar.original.
   * @param {number} [limit=this._maxBackups]
   * @returns {string[]} List of pruned backup IDs
   */
  pruneBackups(limit = this._maxBackups) {
    const backups = this.listBackups();
    const pruned = [];

    if (backups.length > limit) {
      const toRemove = backups.slice(limit);
      for (const b of toRemove) {
        const dir = path.join(this._backupRootDir, b.backupId);
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          pruned.push(b.backupId);
        } catch {}
      }
    }

    return pruned;
  }

  /**
   * Restores an ASAR from a specific backup directory or from app.asar.original.
   * @param {string} targetAsarPath
   * @param {string|null} [backupId=null] - If null, restores app.asar.original
   * @returns {{ restored: boolean, restoredFrom: string, manifest: object|null }}
   */
  restoreBackup(targetAsarPath, backupId = null) {
    let sourcePath = null;
    let manifest = null;

    if (backupId) {
      const bDir = path.join(this._backupRootDir, backupId);
      sourcePath = path.join(bDir, 'app.asar');
      const mPath = path.join(bDir, 'backup-manifest.json');
      if (fs.existsSync(mPath)) {
        try { manifest = JSON.parse(fs.readFileSync(mPath, 'utf8')); } catch {}
      }
    } else {
      sourcePath = path.join(this._backupRootDir, 'app.asar.original');
    }

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Restore source does not exist: ${sourcePath}`);
    }

    // Atomic restore
    const tmp = `${targetAsarPath}.restore.${Date.now()}`;
    fs.copyFileSync(sourcePath, tmp);
    fs.renameSync(tmp, targetAsarPath);

    return {
      restored: true,
      restoredFrom: sourcePath,
      manifest
    };
  }
}

module.exports = {
  BackupManager,
  sha256File
};
