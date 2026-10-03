'use strict';

/**
 * Antigravity Quota Guard — Configuration Storage & LKG Engine
 * Implements 3-file persistence model (config.json, config.lkg.json, runtime-state.json),
 * quarantine on corruption, atomic fsync writes, and factory reset isolation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { DEFAULT_CONFIG } = require('./config-defaults.js');
const { validateConfig, normalizeConfig, deepClone, deepMerge } = require('./config-schema.js');

function getBaseConfigDir() {
  if (process.env.QUOTA_GUARD_HOME) {
    return process.env.QUOTA_GUARD_HOME;
  }
  return path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
}

class ConfigStore {
  constructor(options = {}) {
    this.baseDir = options.baseDir || getBaseConfigDir();
    this.configFile = path.join(this.baseDir, 'config.json');
    this.lkgFile = path.join(this.baseDir, 'config.lkg.json');
    this.runtimeStateFile = path.join(this.baseDir, 'runtime-state.json');
  }

  ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    } else {
      try {
        fs.chmodSync(this.baseDir, 0o700);
      } catch (_) {}
    }
  }

  /**
   * Performs atomic write with fsync to ensure crash durability.
   */
  atomicWriteFileSync(filePath, dataString, mode = 0o600) {
    this.ensureBaseDir();
    const tmpFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const fd = fs.openSync(tmpFile, 'w', mode);
    try {
      fs.writeSync(fd, dataString, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpFile, filePath);

    // Sync parent directory
    try {
      const dirFd = fs.openSync(path.dirname(filePath), 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch (_) {}
  }

  /**
   * Loads configuration using the canonical startup lifecycle.
   */
  loadConfig() {
    this.ensureBaseDir();

    // 1. If config.json doesn't exist, create it once with defaults
    if (!fs.existsSync(this.configFile)) {
      const initial = deepClone(DEFAULT_CONFIG);
      this.saveConfig(initial);
      this.updateLkg(initial);
      return initial;
    }

    // 2. Read existing config.json
    let raw;
    try {
      raw = fs.readFileSync(this.configFile, 'utf8');
    } catch (err) {
      return this.recoverFromCorruption('READ_ERROR');
    }

    // 3. Parse JSON
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return this.recoverFromCorruption('JSON_PARSE_ERROR');
    }

    // 4. Validate schema
    try {
      validateConfig(parsed);
      // Valid! Merge with canonical defaults (user values override defaults, but missing keys get defaults)
      const merged = deepMerge(deepClone(DEFAULT_CONFIG), parsed);
      this.updateLkg(merged);
      return merged;
    } catch (validationErr) {
      // Check if it's an older schema version requiring migration
      try {
        const migrated = normalizeConfig(parsed);
        this.saveConfig(migrated);
        this.updateLkg(migrated);
        return migrated;
      } catch (_) {
        return this.recoverFromCorruption('VALIDATION_ERROR');
      }
    }
  }

  /**
   * Quarantines corrupt file and restores from LKG or defaults.
   */
  recoverFromCorruption(reason) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantinePath = path.join(this.baseDir, `config.corrupt.${timestamp}.json`);

    try {
      if (fs.existsSync(this.configFile)) {
        fs.renameSync(this.configFile, quarantinePath);
      }
    } catch (_) {}

    // Attempt restore from config.lkg.json
    if (fs.existsSync(this.lkgFile)) {
      try {
        const lkgRaw = fs.readFileSync(this.lkgFile, 'utf8');
        const lkgParsed = JSON.parse(lkgRaw);
        validateConfig(lkgParsed);
        const lkgMerged = deepMerge(deepClone(DEFAULT_CONFIG), lkgParsed);
        this.saveConfig(lkgMerged);
        return {
          ...lkgMerged,
          __recoveredFromLkg: true,
          __corruptionReason: reason,
          __quarantinePath: quarantinePath
        };
      } catch (_) {}
    }

    // No valid LKG, fallback to defaults
    const fallback = deepClone(DEFAULT_CONFIG);
    this.saveConfig(fallback);
    this.updateLkg(fallback);
    return {
      ...fallback,
      __recoveredFromDefaults: true,
      __corruptionReason: reason,
      __quarantinePath: quarantinePath
    };
  }

  /**
   * Updates config.lkg.json atomically.
   */
  updateLkg(config) {
    try {
      this.atomicWriteFileSync(this.lkgFile, JSON.stringify(config, null, 2), 0o600);
    } catch (_) {}
  }

  /**
   * Saves configuration to config.json atomically.
   */
  saveConfig(newConfig) {
    validateConfig(newConfig);
    const content = JSON.stringify(newConfig, null, 2);
    this.atomicWriteFileSync(this.configFile, content, 0o600);
    this.updateLkg(newConfig);
    return true;
  }

  /**
   * Executes factory reset, creating a pre-reset backup first.
   */
  factoryReset() {
    this.ensureBaseDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.baseDir, `config.pre-reset.${timestamp}.json`);

    if (fs.existsSync(this.configFile)) {
      try {
        fs.copyFileSync(this.configFile, backupPath);
      } catch (_) {}
    }

    const cleanDefaults = deepClone(DEFAULT_CONFIG);
    this.saveConfig(cleanDefaults);
    return {
      success: true,
      preResetBackupPath: backupPath,
      config: cleanDefaults
    };
  }
}

module.exports = {
  ConfigStore,
  getBaseConfigDir
};
