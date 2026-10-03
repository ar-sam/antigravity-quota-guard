'use strict';

/**
 * Antigravity Quota Guard — 5-Tier Guard State Machine
 * Manages formal guard state transitions, hysteresis, silent 13% checkpointing,
 * and comprehensive resume validation.
 */

const { DEFAULT_CONFIG } = require('./config-defaults.js');
const { calculateEffectiveQuota } = require('./quota-policy.js');

const GUARD_STATES = Object.freeze({
  SAFE: 'SAFE',
  WARN: 'WARN',
  STABILIZE: 'STABILIZE',
  CHECKPOINT: 'CHECKPOINT',
  HALT_PENDING: 'HALT_PENDING',
  HALTED: 'HALTED',
  HALTED_BACKGROUND_ACTIVE: 'HALTED_BACKGROUND_ACTIVE',
  VERIFYING: 'VERIFYING',
  RESUMED: 'RESUMED'
});

class GuardStateMachine {
  constructor(options = {}) {
    this.thresholds = options.thresholds || DEFAULT_CONFIG.thresholds;
    this.state = GUARD_STATES.SAFE;
    this.silentCheckpointTriggered = false;
    this.onSilentCheckpoint = options.onSilentCheckpoint || null;
    this.haltedAt = null;
    this.lastObservedQuota = null;
  }

  /**
   * Processes a quota update and transitions state machine.
   */
  async processQuota(quotaHealth, activeModelString = null) {
    const eff = calculateEffectiveQuota(quotaHealth, activeModelString);
    this.lastObservedQuota = eff;

    if (eff === null) {
      return this.state;
    }

    const { warnPercent, stabilizePercent, checkpointPercent, stopPercent } = this.thresholds;

    // 1. Quota <= stopPercent -> HALT_PENDING or HALTED
    if (eff <= stopPercent) {
      if (this.state !== GUARD_STATES.HALTED && this.state !== GUARD_STATES.HALTED_BACKGROUND_ACTIVE) {
        this.state = GUARD_STATES.HALT_PENDING;
        this.haltedAt = Date.now();
      }
      return this.state;
    }

    // 2. Quota <= checkpointPercent -> CHECKPOINT (Trigger silent snapshot once)
    if (eff <= checkpointPercent) {
      if (this.state !== GUARD_STATES.CHECKPOINT && !this.silentCheckpointTriggered) {
        this.silentCheckpointTriggered = true;
        this.state = GUARD_STATES.CHECKPOINT;
        if (typeof this.onSilentCheckpoint === 'function') {
          try { await this.onSilentCheckpoint({ effectiveQuota: eff }); } catch (_) {}
        }
      }
      return this.state;
    }

    // 3. Quota <= stabilizePercent -> STABILIZE
    if (eff <= stabilizePercent) {
      this.state = GUARD_STATES.STABILIZE;
      return this.state;
    }

    // 4. Quota <= warnPercent -> WARN
    if (eff <= warnPercent) {
      this.state = GUARD_STATES.WARN;
      return this.state;
    }

    // 5. Quota > warnPercent -> Hysteresis check for recovery
    // CRITICAL INVARIANT: HALTED states MUST NOT auto-recover via processQuota().
    // Resume from HALTED requires explicit canResume() verification + user action.
    if (eff > warnPercent) {
      if (this.state === GUARD_STATES.HALTED ||
          this.state === GUARD_STATES.HALTED_BACKGROUND_ACTIVE) {
        // Stay halted — quota recovering does NOT automatically resume execution.
        // Only canResume() with valid account change / reset epoch can unlock.
        return this.state;
      }
      this.state = GUARD_STATES.SAFE;
      this.silentCheckpointTriggered = false; // re-arm silent checkpoint
      return this.state;
    }

    return this.state;
  }

  /**
   * Transitions to HALTED once PostInvocation concludes turn boundary.
   */
  transitionToHalted() {
    this.state = GUARD_STATES.HALTED;
    this.haltedAt = Date.now();
  }

  /**
   * Transitions to HALTED_BACKGROUND_ACTIVE when Stop hook reports background activity.
   */
  transitionToBackgroundActive() {
    this.state = GUARD_STATES.HALTED_BACKGROUND_ACTIVE;
  }

  /**
   * Validates whether execution can cleanly resume.
   */
  canResume(context = {}) {
    const {
      quotaHealth,
      currentAccountIdentity,
      initialAccountIdentity,
      nowEpoch = Date.now(),
      resetEpoch = null,
      manualOverride = false
    } = context;

    // Must have quota health and state FRESH
    if (!quotaHealth || quotaHealth.state !== 'FRESH') {
      return { allowed: false, reason: 'QUOTA_NOT_FRESH' };
    }

    // Effective quota must be >= minResumePercent
    const eff = calculateEffectiveQuota(quotaHealth);
    if (eff === null || eff < this.thresholds.minResumePercent) {
      return {
        allowed: false,
        reason: 'INSUFFICIENT_QUOTA',
        effectiveQuota: eff,
        requiredPercent: this.thresholds.minResumePercent
      };
    }

    // Condition 1: Account changed
    if (currentAccountIdentity && initialAccountIdentity && currentAccountIdentity !== initialAccountIdentity) {
      return { allowed: true, reason: 'ACCOUNT_CHANGED' };
    }

    // Condition 2: Reset epoch passed
    if (resetEpoch && nowEpoch >= resetEpoch) {
      return { allowed: true, reason: 'RESET_EPOCH_PASSED' };
    }

    // Condition 3: Explicit manual user confirmation
    if (manualOverride) {
      return { allowed: true, reason: 'MANUAL_USER_OVERRIDE' };
    }

    return { allowed: false, reason: 'ACCOUNT_NOT_CHANGED_AND_RESET_NOT_REACHED' };
  }
}

module.exports = {
  GUARD_STATES,
  GuardStateMachine
};
