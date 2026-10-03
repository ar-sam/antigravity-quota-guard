/**
 * Antigravity Quota Guard — Handover Orchestrator
 * Coordinates the full lifecycle: Quota drop -> Silent 13% Checkpoint -> Turn Boundary Halt ->
 * Waiting for Idle -> Account Switch -> Quota Verification -> Exact Resume.
 *
 * Implements R11 from architecture specification.
 */

'use strict';

const { areIdentitiesEqual } = require('../auth/auth-contract');
const { getResumeCommand } = require('../auth/cli-session-adapter');
const { getSettingsGuidance } = require('../auth/settings-assist-adapter');

/**
 * Handover States
 * @readonly
 * @enum {string}
 */
const HANDOVER_STATES = {
  MONITORING: 'MONITORING',
  PRECHECKPOINTED: 'PRECHECKPOINTED',
  HALT_REQUESTED: 'HALT_REQUESTED',
  HALTED: 'HALTED',
  WAITING_FOR_FULL_IDLE: 'WAITING_FOR_FULL_IDLE',
  HALTED_BACKGROUND_ACTIVE: 'HALTED_BACKGROUND_ACTIVE',
  ACCOUNT_SWITCH_REQUIRED: 'ACCOUNT_SWITCH_REQUIRED',
  ACCOUNT_SWITCH_IN_PROGRESS: 'ACCOUNT_SWITCH_IN_PROGRESS',
  VERIFYING_ACCOUNT: 'VERIFYING_ACCOUNT',
  VERIFYING_QUOTA: 'VERIFYING_QUOTA',
  READY_TO_RESUME: 'READY_TO_RESUME',
  RESUMING: 'RESUMING',
  ACTIVE: 'ACTIVE'
};

class HandoverOrchestrator {
  constructor(options = {}) {
    this._state = HANDOVER_STATES.MONITORING;
    this._config = options.config || {};
    this._activeAccountIdentity = options.initialAccountIdentity || null;
    this._activeConversationId = options.initialConversationId || null;
    this._stopPayload = null;
    this._checkpointId = null;
    this._stateHistory = [];

    this._thresholds = {
      warnPercent: this._config.thresholds?.warnPercent ?? 20,
      stabilizePercent: this._config.thresholds?.stabilizePercent ?? 15,
      checkpointPercent: this._config.thresholds?.checkpointPercent ?? 13,
      stopPercent: this._config.thresholds?.stopPercent ?? 12,
      minResumePercent: this._config.thresholds?.minResumePercent ?? 70
    };
  }

  /**
   * Current orchestrator state.
   * @returns {string}
   */
  getState() {
    return this._state;
  }

  /**
   * Sets current active conversation ID.
   * @param {string} id
   */
  setConversationId(id) {
    this._activeConversationId = id;
  }

  /**
   * Sets current active account identity.
   * @param {object} identity
   */
  setAccountIdentity(identity) {
    this._activeAccountIdentity = identity;
  }

  /**
   * Transitions to a new state and records in history.
   * @private
   */
  _transition(nextState, reason = '') {
    const prevState = this._state;
    this._state = nextState;
    this._stateHistory.push({
      from: prevState,
      to: nextState,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Processes quota updates from monitoring sensors.
   * @param {number|null} effectiveQuota
   * @returns {{ state: string, action: string|null }}
   */
  processQuotaUpdate(effectiveQuota) {
    if (effectiveQuota === null) {
      return { state: this._state, action: null };
    }

    if (this._state === HANDOVER_STATES.MONITORING) {
      if (effectiveQuota <= this._thresholds.stopPercent) {
        this._transition(HANDOVER_STATES.HALT_REQUESTED, `Quota ${effectiveQuota}% <= stopPercent ${this._thresholds.stopPercent}%`);
        return { state: this._state, action: 'TRIGGER_HALT_AND_SNAPSHOT' };
      } else if (effectiveQuota <= this._thresholds.checkpointPercent) {
        this._transition(HANDOVER_STATES.PRECHECKPOINTED, `Quota ${effectiveQuota}% <= checkpointPercent ${this._thresholds.checkpointPercent}%`);
        return { state: this._state, action: 'TRIGGER_SILENT_CHECKPOINT' };
      }
    } else if (this._state === HANDOVER_STATES.PRECHECKPOINTED) {
      if (effectiveQuota <= this._thresholds.stopPercent) {
        this._transition(HANDOVER_STATES.HALT_REQUESTED, `Quota dropped from checkpoint to ${effectiveQuota}%`);
        return { state: this._state, action: 'TRIGGER_HALT' };
      }
    }

    return { state: this._state, action: null };
  }

  /**
   * Handles PostInvocation turn conclusion when halt is pending.
   * Halts the model loop at turn boundary.
   * @returns {object} Hook response payload
   */
  handlePostInvocationHalt() {
    if (this._state === HANDOVER_STATES.HALT_REQUESTED) {
      this._transition(HANDOVER_STATES.HALTED, 'Cleanly halted model turn at PostInvocation boundary');
      return {
        terminationBehavior: 'terminate',
        reason: 'QUOTA_STOP_THRESHOLD_REACHED'
      };
    }
    return { terminationBehavior: 'continue' };
  }

  /**
   * Processes official Antigravity Stop event.
   * R11 Invariant: If Stop reports fullyIdle: false, transition to HALTED_BACKGROUND_ACTIVE.
   * Never return decision: "continue" when in HALTED state.
   * @param {object} stopEvent
   * @returns {{ state: string, decision: string, promptGuidance: boolean }}
   */
  handleStopEvent(stopEvent = {}) {
    this._stopPayload = stopEvent;
    const isFullyIdle = stopEvent.fullyIdle === true;

    if (this._state === HANDOVER_STATES.HALTED || this._state === HANDOVER_STATES.WAITING_FOR_FULL_IDLE) {
      if (isFullyIdle) {
        this._transition(HANDOVER_STATES.ACCOUNT_SWITCH_REQUIRED, 'Stop verified fullyIdle: true. Ready for account switch.');
        return {
          state: this._state,
          decision: 'stop',
          promptGuidance: false
        };
      } else {
        // Background tasks still active
        this._transition(HANDOVER_STATES.HALTED_BACKGROUND_ACTIVE, 'Stop reported fullyIdle: false. Background tasks active.');
        return {
          state: this._state,
          decision: 'stop', // MUST NEVER return "continue"
          promptGuidance: true
        };
      }
    }

    return {
      state: this._state,
      decision: 'stop',
      promptGuidance: false
    };
  }

  /**
   * User explicitly reviewed and stopped background tasks.
   * Unblocks progression from HALTED_BACKGROUND_ACTIVE to ACCOUNT_SWITCH_REQUIRED.
   */
  confirmBackgroundActivityStopped() {
    if (this._state === HANDOVER_STATES.HALTED_BACKGROUND_ACTIVE) {
      this._transition(HANDOVER_STATES.ACCOUNT_SWITCH_REQUIRED, 'User manually confirmed background activities halted.');
      return true;
    }
    return false;
  }

  /**
   * Initiates account switch workflow.
   * @param {string} strategy
   */
  beginAccountSwitch(strategy) {
    if (this._state === HANDOVER_STATES.ACCOUNT_SWITCH_REQUIRED) {
      this._transition(HANDOVER_STATES.ACCOUNT_SWITCH_IN_PROGRESS, `Initiating account switch using strategy ${strategy}`);
      return true;
    }
    return false;
  }

  /**
   * Verifies new account and new quota before declaring ready to resume.
   * R4 & R11 Invariant: Account identity must differ OR epoch reset, AND quota >= minResumePercent.
   * @param {object} newAccountIdentity
   * @param {number} newEffectiveQuota
   * @param {object} [options]
   * @returns {{ ready: boolean, state: string, reason: string }}
   */
  verifyAccountAndQuota(newAccountIdentity, newEffectiveQuota, options = {}) {
    this._transition(HANDOVER_STATES.VERIFYING_ACCOUNT, 'Verifying new account identity');

    const isSameAccount = areIdentitiesEqual(this._activeAccountIdentity, newAccountIdentity);
    const forceOverride = options.forceOverride === true;
    const epochAdvanced = options.epochAdvanced === true;

    if (isSameAccount && !forceOverride && !epochAdvanced) {
      this._transition(HANDOVER_STATES.ACCOUNT_SWITCH_REQUIRED, 'Account identity did not change');
      return {
        ready: false,
        state: this._state,
        reason: 'Account identity is still identical to the exhausted account. Please switch to a different account.'
      };
    }

    this._transition(HANDOVER_STATES.VERIFYING_QUOTA, 'Verifying quota for new account');

    if (typeof newEffectiveQuota === 'number' && newEffectiveQuota < this._thresholds.minResumePercent) {
      this._transition(HANDOVER_STATES.ACCOUNT_SWITCH_REQUIRED, `New quota ${newEffectiveQuota}% is below minResumePercent ${this._thresholds.minResumePercent}%`);
      return {
        ready: false,
        state: this._state,
        reason: `New account quota (${newEffectiveQuota}%) is below minimum resume threshold (${this._thresholds.minResumePercent}%).`
      };
    }

    // Successfully verified!
    this._activeAccountIdentity = newAccountIdentity;
    this._transition(HANDOVER_STATES.READY_TO_RESUME, 'Account and quota verified successfully. Ready to resume.');

    return {
      ready: true,
      state: this._state,
      reason: 'Account and quota verified successfully.'
    };
  }

  /**
   * Resumes execution. Returns exact resume command and instructions.
   * @param {object} [options]
   * @returns {{ resumed: boolean, resumeCommand: string, conversationId: string|null }}
   */
  executeResume() {
    if (this._state !== HANDOVER_STATES.READY_TO_RESUME) {
      throw new Error(`Cannot resume while in state: ${this._state}`);
    }

    this._transition(HANDOVER_STATES.RESUMING, 'Resuming execution with verified account');
    const resumeCommand = getResumeCommand(this._activeConversationId);

    // Transition back to active
    this._transition(HANDOVER_STATES.ACTIVE, 'Execution resumed and active');

    return {
      resumed: true,
      resumeCommand,
      conversationId: this._activeConversationId
    };
  }

  /**
   * Provides guidance when HALTED_BACKGROUND_ACTIVE is reached.
   * @param {string} surface
   * @param {string} [locale='fa']
   * @returns {object}
   */
  getReviewBackgroundActivityGuidance(surface = 'desktop', locale = 'fa') {
    if (surface === 'cli') {
      if (locale === 'fa') {
        return {
          title: 'وظایف پس‌زمینه همچنان فعال هستند',
          message: 'برخی زیرعامل‌ها یا وظایف در پس‌زمینه همچنان در حال اجرا هستند. قبل از تعویض حساب باید متوقف شوند.',
          commands: ['agy /tasks', 'agy /agents'],
          action: 'دستورات فوق را برای مشاهده و لغو وظایف در حال اجرا به کار بگیرید.'
        };
      }
      return {
        title: 'Background Tasks Still Active',
        message: 'Some subagents or background tasks are still running. They must be concluded before switching accounts.',
        commands: ['agy /tasks', 'agy /agents'],
        action: 'Run the commands above to review and terminate active tasks.'
      };
    }

    // Desktop
    if (locale === 'fa') {
      return {
        title: 'هشدار: وظایف پس‌زمینه فعال هستند',
        message: 'عامل‌های پس‌زمینه هنوز در حال کار هستند. برای جلوگیری از قطع ناگهانی، ابتدا آن‌ها را در پنل وظایف بررسی یا متوقف کنید، سپس دکمه «تأیید توقف و تعویض حساب» را بزنید.',
        actionButton: 'تأیید توقف و تعویض حساب'
      };
    }

    return {
      title: 'Warning: Background Activity Active',
      message: 'Background agents or tasks are still running. Please inspect or cancel them in the Tasks panel before proceeding to switch accounts.',
      actionButton: 'Confirm Stopped & Switch Account'
    };
  }
}

module.exports = {
  HandoverOrchestrator,
  HANDOVER_STATES
};
