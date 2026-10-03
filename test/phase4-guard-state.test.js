'use strict';

/**
 * Phase 4 Gate Test: 5-Tier Guard State Machine & Silent 13% Checkpointing
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { GuardStateMachine, GUARD_STATES } = require('../core/guard-state-machine.js');

describe('Phase 4: 5-Tier Guard State Machine & Silent 13% Checkpointing', () => {

  it('Progresses through 5 tiers in order: SAFE -> WARN -> STABILIZE -> CHECKPOINT -> HALT_PENDING', async () => {
    let silentCheckpointCalls = 0;
    const sm = new GuardStateMachine({
      thresholds: {
        warnPercent: 20,
        stabilizePercent: 15,
        checkpointPercent: 13,
        stopPercent: 12,
        minResumePercent: 70
      },
      onSilentCheckpoint: async () => { silentCheckpointCalls++; }
    });

    assert.strictEqual(sm.state, GUARD_STATES.SAFE);

    // Helper: wrap percent into official quotaHealth format
    const qh = (pct) => ({ state: 'FRESH', buckets: { 'gemini-weekly': { remainingPercent: pct, category: 'gemini' } } });

    // 1. Quota drops to 20% -> WARN
    await sm.processQuota(qh(20), 'gemini-flash');
    assert.strictEqual(sm.state, GUARD_STATES.WARN);

    // 2. Quota drops to 15% -> STABILIZE
    await sm.processQuota(qh(15), 'gemini-flash');
    assert.strictEqual(sm.state, GUARD_STATES.STABILIZE);

    // 3. Quota drops to 13% -> CHECKPOINT (triggers silent snapshot once)
    await sm.processQuota(qh(13), 'gemini-flash');
    assert.strictEqual(sm.state, GUARD_STATES.CHECKPOINT);
    assert.strictEqual(silentCheckpointCalls, 1, 'Silent snapshot must be triggered at 13%');

    // Repeated call at 13% should not trigger duplicate silent snapshot
    await sm.processQuota(qh(13), 'gemini-flash');
    assert.strictEqual(silentCheckpointCalls, 1);

    // 4. Quota drops to 12% -> HALT_PENDING
    await sm.processQuota(qh(12), 'gemini-flash');
    assert.strictEqual(sm.state, GUARD_STATES.HALT_PENDING);

    // Transition to HALTED upon turn completion
    sm.transitionToHalted();
    assert.strictEqual(sm.state, GUARD_STATES.HALTED);
  });

  it('Enforces strict hysteresis: does not return to SAFE until quota exceeds warnPercent', async () => {
    const sm = new GuardStateMachine({
      thresholds: {
        warnPercent: 20,
        stabilizePercent: 15,
        checkpointPercent: 13,
        stopPercent: 12,
        minResumePercent: 70
      }
    });

    // Helper: wrap percent into official quotaHealth format
    const qh = (pct) => ({ state: 'FRESH', buckets: { 'gemini-weekly': { remainingPercent: pct, category: 'gemini' } } });

    // Enter WARN at 19%
    await sm.processQuota(qh(19), 'gemini-flash');
    assert.strictEqual(sm.state, GUARD_STATES.WARN);

    // Minor fluctuation to 20% remains in WARN
    await sm.processQuota(qh(20), 'gemini-flash');
    assert.strictEqual(sm.state, GUARD_STATES.WARN);

    // Recovers strictly above 20% (e.g. 21%) -> SAFE
    await sm.processQuota(qh(21), 'gemini-flash');
    assert.strictEqual(sm.state, GUARD_STATES.SAFE);
  });

  it('canResume validates fresh quota, minimum percentage, and account switch condition', () => {
    const sm = new GuardStateMachine({
      thresholds: {
        warnPercent: 20,
        stabilizePercent: 15,
        checkpointPercent: 13,
        stopPercent: 12,
        minResumePercent: 70
      }
    });

    // 1. Quota not fresh -> rejected
    const res1 = sm.canResume({
      quotaHealth: { state: 'UNKNOWN_BLOCKED' }
    });
    assert.strictEqual(res1.allowed, false);
    assert.strictEqual(res1.reason, 'QUOTA_NOT_FRESH');

    // 2. Insufficient quota (60% < 70%) -> rejected
    const res2 = sm.canResume({
      quotaHealth: {
        state: 'FRESH',
        buckets: { 'gemini-weekly': { remainingPercent: 60, category: 'gemini' } }
      },
      currentAccountIdentity: 'acc-2',
      initialAccountIdentity: 'acc-1'
    });
    assert.strictEqual(res2.allowed, false);
    assert.strictEqual(res2.reason, 'INSUFFICIENT_QUOTA');

    // 3. Sufficient quota with account switch -> allowed
    const res3 = sm.canResume({
      quotaHealth: {
        state: 'FRESH',
        buckets: { 'gemini-weekly': { remainingPercent: 85, category: 'gemini' } }
      },
      currentAccountIdentity: 'acc-2',
      initialAccountIdentity: 'acc-1'
    });
    assert.strictEqual(res3.allowed, true);
    assert.strictEqual(res3.reason, 'ACCOUNT_CHANGED');

    // 4. Same account but manual override confirmed -> allowed
    const res4 = sm.canResume({
      quotaHealth: {
        state: 'FRESH',
        buckets: { 'gemini-weekly': { remainingPercent: 85, category: 'gemini' } }
      },
      currentAccountIdentity: 'acc-1',
      initialAccountIdentity: 'acc-1',
      manualOverride: true
    });
    assert.strictEqual(res4.allowed, true);
    assert.strictEqual(res4.reason, 'MANUAL_USER_OVERRIDE');
  });

});
