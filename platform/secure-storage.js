'use strict';

/**
 * Antigravity Quota Guard — Capability-Driven Secure Storage
 * Provides secure storage abstraction across OS Keychain, Electron safeStorage,
 * and encrypted local fallback files.
 * 
 * Invariants:
 * 1. Secret key named account-fingerprint.key (never salt.key).
 * 2. Fallback file restricted to 0600 POSIX permissions.
 * 3. Never stores raw OAuth tokens, passwords, or cookies.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const STORAGE_BACKENDS = Object.freeze({
  OS_KEYCHAIN: 'OS_KEYCHAIN',
  ELECTRON_SAFE_STORAGE: 'ELECTRON_SAFE_STORAGE',
  SECURE_FILE_FALLBACK: 'SECURE_FILE_FALLBACK',
  UNAVAILABLE: 'UNAVAILABLE'
});

class SecureStorage {
  constructor(options = {}) {
    this.baseDir = options.baseDir || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
    this.keyFileName = 'account-fingerprint.key';
    this.keyFilePath = path.join(this.baseDir, this.keyFileName);
    this.allowKeychain = options.allowKeychain || false; // requires explicit consent
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
   * Detects the highest available secure storage backend.
   */
  detectBackend() {
    if (this.allowKeychain && process.platform === 'darwin') {
      return STORAGE_BACKENDS.OS_KEYCHAIN;
    }
    // Check if electron safeStorage is accessible
    try {
      const electron = require('electron');
      if (electron.safeStorage && electron.safeStorage.isEncryptionAvailable()) {
        return STORAGE_BACKENDS.ELECTRON_SAFE_STORAGE;
      }
    } catch (_) {}

    return STORAGE_BACKENDS.SECURE_FILE_FALLBACK;
  }

  /**
   * Retrieves or initializes the account fingerprint secret key.
   */
  getOrCreateAccountFingerprintKey() {
    this.ensureBaseDir();

    // Check if key file already exists
    if (fs.existsSync(this.keyFilePath)) {
      try {
        const key = fs.readFileSync(this.keyFilePath);
        if (key.length >= 32) {
          return key;
        }
      } catch (_) {}
    }

    // Generate fresh 32-byte cryptographic key
    const newKey = crypto.randomBytes(32);
    const fd = fs.openSync(this.keyFilePath, 'w', 0o600);
    try {
      fs.writeSync(fd, newKey);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    return newKey;
  }

  /**
   * Computes HMAC-SHA-256 fingerprint for a given account string (e.g. email).
   */
  computeAccountFingerprint(accountIdentifier) {
    if (!accountIdentifier || typeof accountIdentifier !== 'string') {
      return 'UNKNOWN';
    }
    const key = this.getOrCreateAccountFingerprintKey();
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(accountIdentifier.trim().toLowerCase(), 'utf8');
    return hmac.digest('hex');
  }
}

module.exports = {
  STORAGE_BACKENDS,
  SecureStorage
};
