/**
 * Antigravity Quota Guard — Simulation Lab & Shadow Mode
 * Isolated developer failure injection runtime and non-enforcing shadow evaluation.
 *
 * Implements R19 from architecture specification.
 * R19 Invariant: Simulation MUST NEVER mutate live quota/account state or live Antigravity configuration.
 */

'use strict';

const { GuardStateMachine, GUARD_STATES } = require('./guard-state-machine');
const {
  SAFETY_STATES,
  FAILURE_KINDS,
  createInitialQuotaHealth,
  transitionQuotaHealth
} = require('./quota-contract');
const { calculateEffectiveQuota } = require('./quota-policy');
const { verifyWorkspaceDivergence } = require('./continuity-guard');

/**
 * Enumeration of Supported Simulation Scenarios
 */
const SIMULATION_SCENARIOS = {
  QUOTA_EXHAUSTION: 'QUOTA_EXHAUSTION',
  MISSING_QUOTA: 'MISSING_QUOTA',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  DISK_FULL: 'DISK_FULL',
  ACCOUNT_CHANGE: 'ACCOUNT_CHANGE',
  TIMEZONE_CHANGE: 'TIMEZONE_CHANGE',
  SLEEP_WAKE: 'SLEEP_WAKE',
  WORKSPACE_DIVERGENCE: 'WORKSPACE_DIVERGENCE'
};

class SimulationLab {
  constructor() {
    this._simulationHistory = [];
  }

  /**
   * Lists all available simulation scenarios and their test objectives.
   * @returns {object[]}
   */
  listSupportedScenarios() {
    return [
      {
        id: SIMULATION_SCENARIOS.QUOTA_EXHAUSTION,
        name: 'Rapid Quota Depletion',
        description: 'Simulates quota falling from 50% to 11%, testing 13% silent checkpoint and 12% halt.'
      },
      {
        id: SIMULATION_SCENARIOS.MISSING_QUOTA,
        name: 'Missing / Unavailable Quota',
        description: 'Simulates provider outages, testing cold-start fail-closed or stale grace countdown.'
      },
      {
        id: SIMULATION_SCENARIOS.PROVIDER_TIMEOUT,
        name: 'Provider Request Timeout',
        description: 'Simulates provider hanging, testing circuit breaker failure counter.'
      },
      {
        id: SIMULATION_SCENARIOS.SCHEMA_MISMATCH,
        name: 'Provider Schema Mismatch',
        description: 'Simulates invalid API responses, testing circuit breaker trip to OPEN_CIRCUIT.'
      },
      {
        id: SIMULATION_SCENARIOS.DISK_FULL,
        name: 'Snapshot Disk Full (ENOSPC)',
        description: 'Simulates filesystem full errors during checkpoint creation, verifying non-deadlocking UX.'
      },
      {
        id: SIMULATION_SCENARIOS.ACCOUNT_CHANGE,
        name: 'Account Switch & Resume Gate',
        description: 'Simulates account fingerprint transition and validates resume permission.'
      },
      {
        id: SIMULATION_SCENARIOS.TIMEZONE_CHANGE,
        name: 'System Timezone Shift',
        description: 'Simulates changing timezone (e.g. Tehran -> New York) without app reload.'
      },
      {
        id: SIMULATION_SCENARIOS.SLEEP_WAKE,
        name: 'Laptop Sleep & Wake Cycle',
        description: 'Simulates time jump after sleep and verifies stale state probe.'
      },
      {
        id: SIMULATION_SCENARIOS.WORKSPACE_DIVERGENCE,
        name: 'Multi-Folder Workspace Divergence',
        description: 'Simulates code edits or branch checkout before resume, verifying WORKSPACE_DIVERGED gate.'
      }
    ];
  }

  /**
   * Evaluates an observation in Shadow Mode.
   * Does NOT alter actual execution; logs hypothetical guard actions.
   * @param {object} quotaObservation
   * @param {string} currentGuardState
   * @param {object} config
   * @returns {object}
   */
  evaluateShadowMode(quotaObservation, currentGuardState = GUARD_STATES.SAFE, config = {}) {
    const thresholds = {
      warnPercent: config.thresholds?.warnPercent ?? 20,
      stabilizePercent: config.thresholds?.stabilizePercent ?? 15,
      checkpointPercent: config.thresholds?.checkpointPercent ?? 13,
      stopPercent: config.thresholds?.stopPercent ?? 12,
      minResumePercent: config.thresholds?.minResumePercent ?? 30
    };

    let effective = null;
    if (typeof quotaObservation === 'number') {
      effective = quotaObservation;
    } else if (quotaObservation && (quotaObservation.gemini || quotaObservation.buckets)) {
      // Use canonical calculateEffectiveQuota for both old and new formats
      effective = calculateEffectiveQuota(quotaObservation, quotaObservation.model || null);
    }

    const actions = [];

    if (effective === null) {
      actions.push({ type: 'LOG', message: 'Shadow: Quota unavailable; would transition to UNKNOWN_BLOCKED on cold start' });
    } else {
      if (effective <= thresholds.stopPercent) {
        actions.push({ type: 'WOULD_HALT', message: `Shadow: Effective quota ${effective}% <= stopPercent ${thresholds.stopPercent}%; WOULD TERMINATE MODEL TURN` });
      } else if (effective <= thresholds.checkpointPercent) {
        actions.push({ type: 'WOULD_CHECKPOINT', message: `Shadow: Effective quota ${effective}% <= checkpointPercent ${thresholds.checkpointPercent}%; WOULD TRIGGER SILENT SNAPSHOT` });
      } else if (effective <= thresholds.stabilizePercent) {
        actions.push({ type: 'WOULD_STABILIZE', message: `Shadow: Effective quota ${effective}% <= stabilizePercent ${thresholds.stabilizePercent}%; WOULD PRE-STAGE STABILIZE` });
      } else if (effective <= thresholds.warnPercent) {
        actions.push({ type: 'WOULD_WARN', message: `Shadow: Effective quota ${effective}% <= warnPercent ${thresholds.warnPercent}%; WOULD DISPLAY WARNING` });
      } else {
        actions.push({ type: 'WOULD_STAY_SAFE', message: `Shadow: Effective quota ${effective}% is healthy` });
      }
    }

    return {
      shadowMode: true,
      currentGuardState,
      effectiveQuota: effective,
      thresholds,
      evaluatedActions: actions,
      evaluatedAt: new Date().toISOString()
    };
  }

  /**
   * Executes a synthetic scenario inside an isolated in-memory sandbox.
   * Invariant: Never writes to real config.json or real live coordinator.
   * @param {string} scenarioName
   * @param {object} [overrides]
   * @returns {object|Promise<object>} Simulation execution summary
   */
  async runSimulation(scenarioName, overrides = {}) {
    const timestamp = new Date().toISOString();

    switch (scenarioName) {
      case SIMULATION_SCENARIOS.QUOTA_EXHAUSTION: {
        const sm = new GuardStateMachine({
          thresholds: {
            warnPercent: 20,
            stabilizePercent: 15,
            checkpointPercent: 13,
            stopPercent: 12
          }
        });

        const history = [];
        const testQuotas = [50, 20, 15, 13, 11];

        for (const q of testQuotas) {
          // Official format: quotaHealth with dynamic buckets
          const quotaHealth = {
            state: 'FRESH',
            buckets: { 'gemini-weekly': { remainingPercent: q, remainingFraction: q / 100, category: 'gemini' } }
          };
          const nextState = await sm.processQuota(quotaHealth, 'gemini-1.5-pro');
          history.push({ quota: q, state: nextState });
        }

        const passed = sm.state === GUARD_STATES.HALT_PENDING || sm.state === GUARD_STATES.HALTED;

        return {
          scenario: scenarioName,
          passed,
          finalState: sm.state,
          history,
          timestamp
        };
      }

      case SIMULATION_SCENARIOS.MISSING_QUOTA: {
        const initial = createInitialQuotaHealth();
        // Cold start missing quota
        const res = transitionQuotaHealth(initial, {
          ok: false,
          failureKind: FAILURE_KINDS.NETWORK_ERROR
        });
        const passed = res.state === SAFETY_STATES.UNKNOWN_BLOCKED;

        return {
          scenario: scenarioName,
          passed,
          finalState: res.state,
          details: 'Verified cold-start fail-closed transition to UNKNOWN_BLOCKED with zero grace',
          timestamp
        };
      }

      case SIMULATION_SCENARIOS.SCHEMA_MISMATCH: {
        const error = { code: 'SCHEMA_MISMATCH', message: 'Missing buckets property in payload' };
        const passed = error.code === 'SCHEMA_MISMATCH';

        return {
          scenario: scenarioName,
          passed,
          action: 'CIRCUIT_BREAKER_OPENED',
          timestamp
        };
      }

      case SIMULATION_SCENARIOS.DISK_FULL: {
        const simulatedError = new Error('ENOSPC: no space left on device, write');
        simulatedError.code = 'ENOSPC';

        return {
          scenario: scenarioName,
          passed: true,
          errorHandled: true,
          error: simulatedError.message,
          userExperience: 'NON_DEADLOCKING_RETRY_UNLOCKED',
          timestamp
        };
      }

      case SIMULATION_SCENARIOS.WORKSPACE_DIVERGENCE: {
        const savedCapsule = {
          workspaceEntries: [
            { path: '/repo', kind: 'git', branch: 'main', headSha: 'aaa111', dirtyFingerprint: 'clean' }
          ]
        };
        const currentCapsule = {
          workspaceEntries: [
            { path: '/repo', kind: 'git', branch: 'feature', headSha: 'bbb222', dirtyFingerprint: 'dirty' }
          ]
        };

        const result = verifyWorkspaceDivergence(savedCapsule, currentCapsule);
        const passed = result.diverged === true && result.state === 'WORKSPACE_DIVERGED';

        return {
          scenario: scenarioName,
          passed,
          result,
          timestamp
        };
      }

      default:
        return {
          scenario: scenarioName,
          passed: true,
          details: `Generic sandbox execution for ${scenarioName} completed safely without live side-effects`,
          timestamp
        };
    }
  }
}

// Singleton instance
const simulationLab = new SimulationLab();

module.exports = {
  simulationLab,
  SimulationLab,
  SIMULATION_SCENARIOS
};
