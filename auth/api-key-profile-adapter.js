/**
 * Antigravity Quota Guard — CLI Gemini API Key Profile Adapter
 * Implements R13: Serialized Global CLI Authentication Provider Mutation with Exclusive Transaction Lock.
 *
 * Invariants:
 * 1. Raw API keys NEVER enter config.json or settings.json on disk.
 * 2. If another incompatible CLI session is active, REJECT automatic profile switching with
 *    EXCLUSIVE_TRANSACTION_LOCK_ERROR (never disrupt an active account session).
 * 3. Restores original modelProvider upon session release.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

class ApiKeyProfileAdapter {
  constructor(options = {}) {
    this._settingsPath = options.settingsPath || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
    this._lockHolder = null;
    this._originalProvider = null;
    this._lockTimestamp = null;
  }

  /**
   * Checks if an exclusive transaction lock is currently held.
   * @returns {boolean}
   */
  isLocked() {
    return this._lockHolder !== null;
  }

  /**
   * Acquires exclusive transaction lease to mutate CLI modelProvider.
   * R13 Invariant: Rejects with EXCLUSIVE_TRANSACTION_LOCK_ERROR if already locked or conflicting session active.
   * @param {string} profileId
   * @param {object} [options]
   * @param {boolean} [options.hasActiveConflictingCliSession=false]
   * @returns {object} Lease handle
   */
  acquireProfileLock(profileId, options = {}) {
    if (this._lockHolder !== null) {
      const err = new Error(`Cannot switch to profile '${profileId}': Exclusive lease held by '${this._lockHolder}'`);
      err.code = 'EXCLUSIVE_TRANSACTION_LOCK_ERROR';
      throw err;
    }

    if (options.hasActiveConflictingCliSession) {
      const err = new Error(`Cannot switch to profile '${profileId}': Incompatible active CLI session detected using account authentication`);
      err.code = 'EXCLUSIVE_TRANSACTION_LOCK_ERROR';
      throw err;
    }

    // Read and preserve existing settings
    let currentSettings = {};
    if (fs.existsSync(this._settingsPath)) {
      try {
        currentSettings = JSON.parse(fs.readFileSync(this._settingsPath, 'utf8'));
      } catch {
        currentSettings = {};
      }
    }

    this._originalProvider = currentSettings.modelProvider || null;
    this._lockHolder = profileId;
    this._lockTimestamp = new Date().toISOString();

    // Perform atomic update to modelProvider: "gemini"
    const updatedSettings = {
      ...currentSettings,
      modelProvider: 'gemini'
    };

    const dir = path.dirname(this._settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const tmpPath = `${this._settingsPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(updatedSettings, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this._settingsPath);

    return {
      profileId,
      acquiredAt: this._lockTimestamp,
      originalProvider: this._originalProvider
    };
  }

  /**
   * Releases the exclusive lock and safely restores original modelProvider setting.
   * @param {string} profileId
   * @returns {boolean}
   */
  releaseProfileLock(profileId) {
    if (this._lockHolder !== profileId) {
      return false;
    }

    try {
      if (fs.existsSync(this._settingsPath)) {
        let currentSettings = {};
        try {
          currentSettings = JSON.parse(fs.readFileSync(this._settingsPath, 'utf8'));
        } catch {
          currentSettings = {};
        }

        if (this._originalProvider) {
          currentSettings.modelProvider = this._originalProvider;
        } else {
          delete currentSettings.modelProvider;
        }

        const tmpPath = `${this._settingsPath}.tmp.${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify(currentSettings, null, 2), { mode: 0o600 });
        fs.renameSync(tmpPath, this._settingsPath);
      }
    } finally {
      this._lockHolder = null;
      this._originalProvider = null;
      this._lockTimestamp = null;
    }

    return true;
  }

  /**
   * Prepares environment variables for the child process.
   * R13 Invariant: Keys are injected ONLY via process environment, never stored in config.json.
   * @param {string} rawApiKey
   * @param {string} [customBaseUrl]
   * @returns {object}
   */
  prepareProcessEnvironment(rawApiKey, customBaseUrl = null) {
    if (!rawApiKey || typeof rawApiKey !== 'string') {
      throw new Error('Valid Gemini API key required for process environment');
    }

    const env = {
      GEMINI_API_KEY: rawApiKey.trim()
    };

    if (customBaseUrl) {
      env.GOOGLE_GEMINI_BASE_URL = customBaseUrl.trim();
    }

    return env;
  }
}

module.exports = {
  ApiKeyProfileAdapter
};
