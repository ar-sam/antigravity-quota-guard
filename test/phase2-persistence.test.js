'use strict';

/**
 * Phase 2 Gate Test: Persistence Invariants, LKG Engine & Secure Local Storage
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ConfigStore } = require('../core/config-store.js');
const { DEFAULT_CONFIG } = require('../core/config-defaults.js');
const { SecureStorage, STORAGE_BACKENDS } = require('../platform/secure-storage.js');
const { DaemonManager } = require('../platform/daemon-manager.js');

describe('Phase 2: Persistence Invariants, LKG Engine & Secure Local Storage', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-phase2-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('2.1 ConfigStore & LKG Recovery Lifecycle', () => {
    it('Creates config.json and config.lkg.json on first load', () => {
      const store = new ConfigStore({ baseDir: tmpDir });
      const cfg = store.loadConfig();

      assert.strictEqual(cfg.thresholds.stopPercent, 12);
      assert.ok(fs.existsSync(path.join(tmpDir, 'config.json')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'config.lkg.json')));

      const stat = fs.statSync(path.join(tmpDir, 'config.json'));
      assert.strictEqual(stat.mode & 0o777, 0o600);
    });

    it('Preserves customized user settings across multiple re-loads', () => {
      const store = new ConfigStore({ baseDir: tmpDir });
      const cfg = store.loadConfig();

      cfg.thresholds.warnPercent = 25;
      cfg.thresholds.stabilizePercent = 18;
      cfg.thresholds.checkpointPercent = 14;
      cfg.thresholds.stopPercent = 10;
      cfg.visuals.hudScope = 'both';
      store.saveConfig(cfg);

      // Re-load
      const store2 = new ConfigStore({ baseDir: tmpDir });
      const loaded = store2.loadConfig();

      assert.strictEqual(loaded.thresholds.warnPercent, 25);
      assert.strictEqual(loaded.thresholds.stopPercent, 10);
      assert.strictEqual(loaded.visuals.hudScope, 'both');
    });

    it('Quarantines corrupt config.json and safely recovers from config.lkg.json', () => {
      const store = new ConfigStore({ baseDir: tmpDir });
      const cfg = store.loadConfig();
      cfg.visuals.hudScope = 'weekly';
      store.saveConfig(cfg);

      // Intentionally corrupt config.json with malformed JSON
      fs.writeFileSync(path.join(tmpDir, 'config.json'), 'MALFORMED {{{ CORRUPT JSON', 'utf8');

      // Re-load should detect corruption, quarantine, and restore from LKG
      const recovered = store.loadConfig();

      assert.strictEqual(recovered.visuals.hudScope, 'weekly', 'Must restore LKG user setting');
      assert.strictEqual(recovered.__recoveredFromLkg, true);

      // Check quarantine file exists
      const files = fs.readdirSync(tmpDir);
      const corruptFile = files.find(f => f.startsWith('config.corrupt.'));
      assert.ok(corruptFile, 'Must create config.corrupt.<timestamp>.json quarantine file');
    });

    it('Factory reset creates config.pre-reset backup before restoring defaults', () => {
      const store = new ConfigStore({ baseDir: tmpDir });
      const cfg = store.loadConfig();
      cfg.thresholds.warnPercent = 30;
      store.saveConfig(cfg);

      const resetRes = store.factoryReset();
      assert.strictEqual(resetRes.success, true);
      assert.ok(fs.existsSync(resetRes.preResetBackupPath));

      const fresh = store.loadConfig();
      assert.strictEqual(fresh.thresholds.warnPercent, DEFAULT_CONFIG.thresholds.warnPercent);
    });

    it('Non-destructively repairs invalid fields without resetting custom user preferences', () => {
      const store = new ConfigStore({ baseDir: tmpDir });
      // Write partial config with user customizations and one invalid threshold ordering
      fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
        language: 'en',
        visuals: { themePreset: 'standard', hudScope: 'both' },
        thresholds: { stopPercent: 25, checkpointPercent: 10 }
      }), 'utf8');

      const loaded = store.loadConfig();
      assert.strictEqual(loaded.language, 'en', 'Must preserve customized language');
      assert.strictEqual(loaded.visuals.themePreset, 'standard', 'Must preserve standard theme preset');
      assert.strictEqual(loaded.visuals.hudScope, 'both', 'Must preserve customized hudScope');
      assert.ok(loaded.thresholds.checkpointPercent > loaded.thresholds.stopPercent, 'Must repair threshold ordering');
      assert.strictEqual(loaded.__recoveredFromDefaults, undefined, 'Must NOT wipe out to defaults');
    });
  });

  describe('2.2 Secure Local Storage & Fingerprinting', () => {
    it('Creates account-fingerprint.key with permissions 0600', () => {
      const storage = new SecureStorage({ baseDir: tmpDir });
      const key = storage.getOrCreateAccountFingerprintKey();

      assert.ok(Buffer.isBuffer(key));
      assert.strictEqual(key.length, 32);

      const keyPath = path.join(tmpDir, 'account-fingerprint.key');
      assert.ok(fs.existsSync(keyPath));
      const stat = fs.statSync(keyPath);
      assert.strictEqual(stat.mode & 0o777, 0o600);
    });

    it('Computes deterministic HMAC-SHA-256 account fingerprints', () => {
      const storage = new SecureStorage({ baseDir: tmpDir });
      const fp1 = storage.computeAccountFingerprint('user@example.com');
      const fp2 = storage.computeAccountFingerprint('USER@EXAMPLE.COM '); // whitespace + case normalization
      const fp3 = storage.computeAccountFingerprint('other@example.com');

      assert.strictEqual(fp1, fp2, 'Normalized emails must produce identical fingerprints');
      assert.notStrictEqual(fp1, fp3, 'Different accounts must produce distinct fingerprints');
      assert.strictEqual(fp1.length, 64, 'HMAC-SHA-256 digest length must be 64 hex characters');
    });
  });

  describe('2.3 LaunchAgent Daemon Manager', () => {
    it('Generates valid LaunchAgent XML plist and manages files', () => {
      const plistPath = path.join(tmpDir, 'com.test.plist');
      const manager = new DaemonManager({
        label: 'com.test.daemon',
        plistPath,
        entrypointPath: '/fake/entry.js'
      });

      assert.strictEqual(manager.isConfigured(), false);
      const installed = manager.installDaemon();
      assert.strictEqual(installed, true);
      assert.strictEqual(manager.isConfigured(), true);

      const xml = fs.readFileSync(plistPath, 'utf8');
      assert.ok(xml.includes('<string>com.test.daemon</string>'));
      assert.ok(xml.includes('<string>/fake/entry.js</string>'));

      const uninstalled = manager.uninstallDaemon();
      assert.strictEqual(uninstalled, true);
      assert.strictEqual(manager.isConfigured(), false);
    });
  });

});
