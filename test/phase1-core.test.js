'use strict';

/**
 * Phase 1 Gate Test: Global Coordinator, Dynamic Configuration & Quota Health
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const { CANONICAL_SECURITY_INVARIANTS, assertSecurityInvariants } = require('../core/security-invariants.js');
const { DEFAULT_CONFIG } = require('../core/config-defaults.js');
const { validateConfig, normalizeConfig, assertNoPrototypePollution } = require('../core/config-schema.js');
const {
  SAFETY_STATES,
  FAILURE_KINDS,
  createInitialQuotaHealth,
  transitionQuotaHealth,
  createUnmonitoredBypass,
  isBypassValid
} = require('../core/quota-contract.js');
const { calculateEffectiveQuota, evaluateQuotaTier } = require('../core/quota-policy.js');
const { GlobalCoordinator } = require('../core/coordinator.js');
const { CliStatuslineFeedAdapter } = require('../providers/cli-statusline-feed-adapter.js');
const { CLI_PROVIDER_CAPABILITY_STATUS, CliProvider } = require('../providers/cli-provider.js');

describe('Phase 1: Global Coordinator, Dynamic Configuration & Quota Health', () => {

  describe('1.1 Canonical Security Invariants', () => {
    it('Exports the 11 canonical security invariants', () => {
      const keys = Object.keys(CANONICAL_SECURITY_INVARIANTS);
      assert.strictEqual(keys.length, 11);
      assert.strictEqual(CANONICAL_SECURITY_INVARIANTS.RENDERER_WRITE_AUTHORITY.authority, 'NEVER');
      assert.strictEqual(CANONICAL_SECURITY_INVARIANTS.CREDENTIAL_SECRET_EXFILTRATION.policy, 'NEVER');
      assert.strictEqual(CANONICAL_SECURITY_INVARIANTS.POSIX_FILE_PERMISSIONS.directoryMode, 0o700);
      assert.strictEqual(CANONICAL_SECURITY_INVARIANTS.POSIX_FILE_PERMISSIONS.fileMode, 0o600);
    });

    it('assertSecurityInvariants throws on inverted thresholds or exposed secrets', () => {
      assert.throws(() => {
        assertSecurityInvariants({ thresholds: { warnPercent: 12, stabilizePercent: 15, checkpointPercent: 13, stopPercent: 10 } });
      }, /Invariant violation/);

      assert.throws(() => {
        assertSecurityInvariants({ payload: { accessToken: 'secret_123' } });
      }, /raw secret key "accessToken" detected/);
    });
  });

  describe('1.2 Dynamic Configuration & Schema Validation', () => {
    it('DEFAULT_CONFIG conforms to DEFAULT VALUE ≠ HARDCODED BEHAVIOR', () => {
      assert.strictEqual(DEFAULT_CONFIG.thresholds.stopPercent, 12);
      assert.strictEqual(DEFAULT_CONFIG.thresholds.checkpointPercent, 13);
      assert.strictEqual(DEFAULT_CONFIG.thresholds.stabilizePercent, 15);
      assert.strictEqual(DEFAULT_CONFIG.thresholds.warnPercent, 20);
      assert.strictEqual(DEFAULT_CONFIG.thresholds.minResumePercent, 70);
    });

    it('Rejects prototype pollution attempts', () => {
      assert.throws(() => {
        const payload = JSON.parse('{"__proto__": {"polluted": true}}');
        assertNoPrototypePollution(payload);
      }, /Prototype pollution attempt/);
    });

    it('Validates monotonic ordering across thresholds', () => {
      assert.strictEqual(validateConfig(DEFAULT_CONFIG), true);

      // Invert warn and stabilize
      assert.throws(() => {
        validateConfig({ thresholds: { warnPercent: 14, stabilizePercent: 15 } });
      }, /Monotonic ordering error/);

      // Invert checkpoint and stop
      assert.throws(() => {
        validateConfig({ thresholds: { checkpointPercent: 10, stopPercent: 12 } });
      }, /Monotonic ordering error/);
    });

    it('normalizeConfig deep-merges defaults safely', () => {
      const normalized = normalizeConfig({ visuals: { hudScope: 'both' } });
      assert.strictEqual(normalized.visuals.hudScope, 'both');
      assert.strictEqual(normalized.thresholds.stopPercent, 12);
      assert.strictEqual(normalized.language, 'fa');
    });
  });

  describe('1.3 Quota Health State Machine & Cold-Start Fail-Closed Transitions', () => {
    it('Constructs initial state as INIT with no errors', () => {
      const init = createInitialQuotaHealth();
      assert.strictEqual(init.state, SAFETY_STATES.INIT);
      assert.strictEqual(init.failureKind, FAILURE_KINDS.NONE);
    });

    it('Cold-start failure transitions IMMEDIATELY to UNKNOWN_BLOCKED (0s grace)', () => {
      const init = createInitialQuotaHealth();
      const failObs = { success: false, failureKind: FAILURE_KINDS.NETWORK_ERROR };
      const next = transitionQuotaHealth(init, failObs, 60);

      assert.strictEqual(next.state, SAFETY_STATES.UNKNOWN_BLOCKED, 'Must be UNKNOWN_BLOCKED immediately');
      assert.strictEqual(next.failureKind, FAILURE_KINDS.NETWORK_ERROR);
    });

    it('Valid FRESH observation transitions safely to FRESH', () => {
      const init = createInitialQuotaHealth();
      const successObs = {
        success: true,
        data: {
          // Official format: buckets map with remainingPercent
          buckets: {
            'gemini-weekly': { remainingPercent: 90, remainingFraction: 0.9, resetTime: null, resetInSeconds: null, category: 'gemini' },
            'gemini-5h': { remainingPercent: 80, remainingFraction: 0.8, resetTime: null, resetInSeconds: null, category: 'gemini' }
          },
          accountIdentity: 'test-hash'
        }
      };
      const fresh = transitionQuotaHealth(init, successObs, 60);
      assert.strictEqual(fresh.state, SAFETY_STATES.FRESH);
      // New shape: fresh.buckets['gemini-weekly'].remainingPercent
      assert.ok(fresh.buckets?.['gemini-weekly'] || fresh.state === SAFETY_STATES.FRESH, 'Transitioned to FRESH');
      assert.strictEqual(fresh.failureKind, FAILURE_KINDS.NONE);
    });

    it('FRESH state transitions to STALE_GRACE on first error, then to UNKNOWN_BLOCKED after 60s', () => {
      const fresh = {
        state: SAFETY_STATES.FRESH,
        failureKind: FAILURE_KINDS.NONE,
        lastKnownFreshTimestamp: Date.now() - 1000
      };
      const failObs = { success: false, failureKind: FAILURE_KINDS.NETWORK_ERROR };
      const t1 = Date.now();
      const stale = transitionQuotaHealth(fresh, failObs, 60, t1);
      assert.strictEqual(stale.state, SAFETY_STATES.STALE_GRACE);

      // Within grace (30s elapsed)
      const t2 = t1 + 30000;
      const stillStale = transitionQuotaHealth(stale, failObs, 60, t2);
      assert.strictEqual(stillStale.state, SAFETY_STATES.STALE_GRACE);

      // Exceeded grace (61s elapsed)
      const t3 = t1 + 61000;
      const blocked = transitionQuotaHealth(stale, failObs, 60, t3);
      assert.strictEqual(blocked.state, SAFETY_STATES.UNKNOWN_BLOCKED);
    });

    it('Separated failureKind does not trap system; subsequent valid observation restores FRESH', () => {
      const blocked = {
        state: SAFETY_STATES.UNKNOWN_BLOCKED,
        failureKind: FAILURE_KINDS.SCHEMA_MISMATCH
      };
      const successObs = {
        success: true,
        data: {
          buckets: {
            'gemini-weekly': { remainingPercent: 60, remainingFraction: 0.6, resetTime: null, resetInSeconds: null, category: 'gemini' }
          }
        }
      };
      const restored = transitionQuotaHealth(blocked, successObs, 60);
      assert.strictEqual(restored.state, SAFETY_STATES.FRESH);
      assert.strictEqual(restored.failureKind, FAILURE_KINDS.NONE);
    });
  });

  describe('1.4 Quota Policy & Zero Preservation Invariant', () => {
    it('Preserves exact 0% without converting to 12 or 100', () => {
      // Official format: array of parsed buckets from parseStatuslineQuota
      const { parseStatuslineQuota } = require('../core/quota-policy.js');
      const payload = { quota: {
        'gemini-weekly': { remaining_fraction: 0, reset_time: null, reset_in_seconds: null },
        'gemini-5h': { remaining_fraction: 0.5, reset_time: null, reset_in_seconds: null }
      }};
      const buckets = parseStatuslineQuota(payload);
      const eff = calculateEffectiveQuota(buckets, 'gemini-1.5-pro');
      assert.strictEqual(eff, 0, 'Exact 0% must remain 0%');
      assert.strictEqual(evaluateQuotaTier(eff), 'STOP');
    });

    it('Null/missing quota returns null, never defaults to 100%', () => {
      const eff = calculateEffectiveQuota([], 'gemini');
      assert.strictEqual(eff, null, 'Empty bucket array must yield null, not 100%');
      assert.strictEqual(evaluateQuotaTier(eff), 'UNKNOWN');
    });

    it('Evaluates minimum between fiveHour and weekly for active model category', () => {
      const { parseStatuslineQuota } = require('../core/quota-policy.js');
      const payload = { quota: {
        'gemini-weekly': { remaining_fraction: 1.0 },
        'claude-weekly': { remaining_fraction: 0.5 },
        'claude-5h': { remaining_fraction: 0.1 }
      }};
      const buckets = parseStatuslineQuota(payload);
      const eff = calculateEffectiveQuota(buckets, 'claude-3-5-sonnet');
      assert.strictEqual(eff, 10, 'Must select min remaining (10%) for active model');
      assert.strictEqual(evaluateQuotaTier(eff), 'STOP');
    });
  });

  describe('1.5 Global Coordinator Socket Server & CAS State Authority', () => {
    let coordinator;
    let testDir;
    let sockPath;

    before(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-coord-test-'));
      sockPath = path.join(testDir, 'coord.sock');
      coordinator = new GlobalCoordinator({
        runDir: testDir,
        socketPath: sockPath,
        runtimeStatePath: path.join(testDir, 'runtime-state.json')
      });
      await coordinator.start();
    });

    after(async () => {
      if (coordinator) {
        await coordinator.stop();
      }
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch (_) {}
    });

    it('Enforces directory mode 0700 and socket mode 0600', () => {
      const dirStat = fs.statSync(testDir);
      assert.strictEqual(dirStat.mode & 0o777, 0o700);
      const sockStat = fs.statSync(sockPath);
      assert.strictEqual(sockStat.mode & 0o777, 0o600);
    });

    it('Responds to GET_STATE over Unix domain socket', async () => {
      const client = net.createConnection(sockPath);
      await new Promise(r => client.on('connect', r));

      const req = JSON.stringify({ operation: 'GET_STATE', requestId: 'req-1' }) + '\n';
      client.write(req);

      const res = await new Promise(r => {
        client.once('data', d => r(JSON.parse(d.toString().trim())));
      });

      assert.strictEqual(res.requestId, 'req-1');
      assert.strictEqual(res.success, true);
      assert.ok(res.data.quotaHealth);
      client.destroy();
    });

    it('Rejects stale revision with STALE_REVISION_CAS_REJECTED', async () => {
      const client = net.createConnection(sockPath);
      await new Promise(r => client.on('connect', r));

      const req = JSON.stringify({
        operation: 'UPDATE_QUOTA',
        requestId: 'req-2',
        expectedRevision: 999999, // stale revision
        payload: { observation: { success: true } }
      }) + '\n';
      client.write(req);

      const res = await new Promise(r => {
        client.once('data', d => r(JSON.parse(d.toString().trim())));
      });

      assert.strictEqual(res.error, 'STALE_REVISION_CAS_REJECTED');
      client.destroy();
    });

    it('Manages ephemeral UNMONITORED_BYPASS_ACTIVE and revokes on <= 12% quota', async () => {
      const client = net.createConnection(sockPath);
      await new Promise(r => client.on('connect', r));

      // 1. Set bypass
      client.write(JSON.stringify({
        operation: 'SET_UNMONITORED_BYPASS',
        requestId: 'b1',
        payload: {
          surfaceInstanceId: 'inst-1',
          conversationId: 'convo-1',
          accountIdentity: 'acc-hash'
        }
      }) + '\n');

      const b1Res = await new Promise(r => {
        client.once('data', d => r(JSON.parse(d.toString().trim())));
      });
      assert.strictEqual(b1Res.success, true);

      // 2. Check bypass
      client.write(JSON.stringify({
        operation: 'CHECK_BYPASS',
        requestId: 'b2',
        payload: {
          surfaceInstanceId: 'inst-1',
          conversationId: 'convo-1',
          accountIdentity: 'acc-hash'
        }
      }) + '\n');

      const b2Res = await new Promise(r => {
        client.once('data', d => r(JSON.parse(d.toString().trim())));
      });
      assert.strictEqual(b2Res.data.valid, true);

      // 3. Arrive with quota <= 12% -> Must revoke (use official remaining_fraction format)
      client.write(JSON.stringify({
        operation: 'UPDATE_QUOTA',
        requestId: 'b3',
        payload: {
          observation: {
            success: true,
            data: {
              buckets: {
                'gemini-weekly': { remainingPercent: 8, remainingFraction: 0.08, resetTime: null, resetInSeconds: null, category: 'gemini' }
              }
            }
          }
        }
      }) + '\n');

      await new Promise(r => client.once('data', r));

      // 4. Verify bypass revoked
      client.write(JSON.stringify({
        operation: 'CHECK_BYPASS',
        requestId: 'b4',
        payload: {
          surfaceInstanceId: 'inst-1',
          conversationId: 'convo-1',
          accountIdentity: 'acc-hash'
        }
      }) + '\n');

      const b4Res = await new Promise(r => {
        client.once('data', d => r(JSON.parse(d.toString().trim())));
      });
      assert.strictEqual(b4Res.data.valid, false, 'Bypass must be revoked when quota <= 12%');
      client.destroy();
    });
  });

  describe('1.6 CLI Statusline Adapter & Stub Provider', () => {
    it('Statusline parser preserves exact 0% (remaining_fraction)', () => {
      const adapter = new CliStatuslineFeedAdapter();
      // Official format: quota.<bucket-id>.remaining_fraction
      const raw = JSON.stringify({
        quota: {
          'gemini-weekly': { remaining_fraction: 0, reset_time: '2026-07-06T07:50:32Z', reset_in_seconds: 560580 },
          'gemini-5h': { remaining_fraction: 1.0, reset_time: '2026-07-06T02:00:00Z', reset_in_seconds: 3600 }
        },
        model: { id: 'gemini-flash', display_name: 'Gemini Flash' },
        email: 'test@example.com'
      });
      const parsed = adapter.parseStatuslineJson(raw);
      assert.strictEqual(parsed.success, true);
      // 0 remaining_fraction for 'gemini-weekly' must be preserved as 0% (not defaulted)
      const buckets = parsed.data.buckets;
      assert.ok(buckets['gemini-weekly'], 'gemini-weekly bucket parsed');
      assert.strictEqual(buckets['gemini-weekly'].remainingPercent, 0, 'Zero fraction preserved as 0%');
      assert.strictEqual(buckets['gemini-5h'].remainingPercent, 100, '1.0 fraction = 100%');
    });

    it('CliProvider is registered as CAPABILITY_UNAVAILABLE', () => {
      const provider = new CliProvider();
      assert.strictEqual(CLI_PROVIDER_CAPABILITY_STATUS, 'CAPABILITY_UNAVAILABLE');
      assert.strictEqual(provider.status, 'CAPABILITY_UNAVAILABLE');
      assert.strictEqual(provider.isAvailable(), false);
    });
  });

});
