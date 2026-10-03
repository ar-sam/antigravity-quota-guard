'use strict';

/**
 * Antigravity Quota Guard — Surface-Aware Provider Resolver
 * 
 * Orchestrates multi-provider fallback, circuit breakers, provenance tracking,
 * and safe cold-start fail-closed degradation across Desktop, CLI, and Headless surfaces.
 * 
 * Implements R2, R16 from architecture specification.
 */

const {
  SAFETY_STATES,
  FAILURE_KINDS,
  QUOTA_SOURCE_STATUS,
  CIRCUIT_BREAKER_STATES,
  createInitialQuotaHealth,
  transitionQuotaHealth,
  isBypassValid
} = require('../core/quota-contract.js');
const { calculateEffectiveQuota } = require('../core/quota-policy.js');
const { DEFAULT_CONFIG } = require('../core/config-defaults.js');
const { capabilityRegistry, OPERATING_MODES } = require('../core/capability-registry.js');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getSocketPath } = require('../core/coordinator.js');
const { CliStatuslineFeedAdapter } = require('./cli-statusline-feed-adapter.js');
const { CliProvider } = require('./cli-provider.js');
const { PrivateRpcProvider } = require('./private-rpc-provider.js');

function createDefaultCoordinatorClient(socketPath = getSocketPath()) {
  return {
    updateQuota: (observation) => {
      return new Promise((resolve) => {
        if (!fs.existsSync(socketPath)) return resolve(null);
        try {
          const client = net.createConnection(socketPath, () => {
            client.write(JSON.stringify({ operation: 'UPDATE_QUOTA', payload: { observation } }) + '\n');
          });
          client.on('data', (d) => {
            try { resolve(JSON.parse(d.toString().trim())); } catch (_) { resolve(true); }
            client.end();
          });
          client.on('error', () => resolve(null));
          client.setTimeout(200, () => { client.destroy(); resolve(null); });
        } catch (_) {
          resolve(null);
        }
      });
    }
  };
}

class ProviderResolver {
  constructor(options = {}) {
    this.config = options.config || DEFAULT_CONFIG;
    this.registry = options.registry || capabilityRegistry;
    this.socketPath = options.socketPath || getSocketPath();
    this.coordinatorClient = options.coordinatorClient !== undefined
      ? options.coordinatorClient
      : createDefaultCoordinatorClient(this.socketPath);
    this.staleGraceSeconds = this.config.durations?.staleGraceSeconds ?? 60;

    // Circuit breaker configuration
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownDurationMs = options.cooldownDurationMs ?? 30000;

    // Initialize provider adapters
    this.providers = {
      cli_statusline: options.providers?.cli_statusline || new CliStatuslineFeedAdapter({
        coordinatorClient: this.coordinatorClient,
        originalCommand: this.config.statusline?.originalCommand ?? null
      }),
      cli_provider: options.providers?.cli_provider || new CliProvider(),
      private_rpc: options.providers?.private_rpc || new PrivateRpcProvider({
        config: this.config,
        registry: this.registry
      })
    };

    // Circuit breaker states for providers
    this.circuits = new Map();
    for (const name of Object.keys(this.providers)) {
      this.circuits.set(name, {
        state: CIRCUIT_BREAKER_STATES.CLOSED,
        failureCount: 0,
        lastSuccess: null,
        lastFailure: null,
        lastFailureKind: FAILURE_KINDS.NONE,
        cooldownDeadline: null
      });
    }

    // Cached state machine health
    this.currentHealth = createInitialQuotaHealth();
  }

  /**
   * Retrieves circuit breaker descriptor for a named provider.
   */
  getCircuit(providerName) {
    if (!this.circuits.has(providerName)) {
      this.circuits.set(providerName, {
        state: CIRCUIT_BREAKER_STATES.CLOSED,
        failureCount: 0,
        lastSuccess: null,
        lastFailure: null,
        lastFailureKind: FAILURE_KINDS.NONE,
        cooldownDeadline: null
      });
    }
    return this.circuits.get(providerName);
  }

  /**
   * Records success for a provider, resetting its circuit breaker to CLOSED.
   */
  recordSuccess(providerName) {
    const circuit = this.getCircuit(providerName);
    circuit.state = CIRCUIT_BREAKER_STATES.CLOSED;
    circuit.failureCount = 0;
    circuit.lastSuccess = Date.now();
    circuit.lastFailureKind = FAILURE_KINDS.NONE;
    circuit.cooldownDeadline = null;
  }

  /**
   * Records failure for a provider.
   * Invariant: SCHEMA_MISMATCH trips to OPEN_CIRCUIT immediately.
   */
  recordFailure(providerName, failureKind) {
    const circuit = this.getCircuit(providerName);
    circuit.failureCount++;
    circuit.lastFailure = Date.now();
    circuit.lastFailureKind = failureKind;

    if (failureKind === FAILURE_KINDS.SCHEMA_MISMATCH || circuit.failureCount >= this.failureThreshold) {
      circuit.state = CIRCUIT_BREAKER_STATES.OPEN_CIRCUIT;
      circuit.cooldownDeadline = Date.now() + this.cooldownDurationMs;
    }
  }

  /**
   * Checks if a provider is eligible to be queried (not locked in OPEN_CIRCUIT).
   */
  isProviderCallable(providerName) {
    const circuit = this.getCircuit(providerName);
    if (circuit.state === CIRCUIT_BREAKER_STATES.OPEN_CIRCUIT) {
      if (circuit.cooldownDeadline && Date.now() >= circuit.cooldownDeadline) {
        circuit.state = CIRCUIT_BREAKER_STATES.HALF_OPEN;
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Resolves candidate provider priority order based on surface and providerMode setting.
   */
  resolveCandidateChain(surface = 'desktop', providerMode = null) {
    const mode = providerMode || this.config.quota?.providerMode || 'auto_safe';

    if (mode === 'cli_only') {
      return ['cli_provider'];
    }
    if (mode === 'private_rpc') {
      return ['private_rpc'];
    }
    if (mode === 'cli_statusline') {
      return ['cli_statusline'];
    }

    // Default 'auto_safe'
    if (surface === 'cli') {
      return ['cli_statusline', 'cli_provider'];
    }

    // Desktop surface
    const chain = ['cli_statusline'];
    if (this.config.quota?.allowPrivateRpcFallback) {
      chain.push('private_rpc');
    }
    chain.push('cli_provider');
    return chain;
  }

  /**
   * Resolves effective quota with fallback, circuit breaking, and surface identity binding.
   * 
   * @param {object} context
   * @param {string} [context.surface='desktop'] - 'desktop' | 'cli' | 'subagent' | 'headless'
   * @param {string} [context.accountIdentity] - Positive account identity / HMAC fingerprint
   * @param {string} [context.activeModel] - Model identifier string
   * @param {string} [context.conversationId] - Active conversation ID
   * @param {string} [context.surfaceInstanceId] - Surface instance identifier
   * @param {object} [context.rawStatuslinePayload] - Optional live statusline JSON string
   * @param {object} [context.bypassToken] - Active session bypass token
   * @returns {Promise<object>} Normalized resolution descriptor
   */
  async resolveQuota(context = {}) {
    const now = Date.now();
    const surface = (context.surface || 'desktop').toLowerCase();
    const candidates = this.resolveCandidateChain(surface, context.providerMode);
    let successfulObservation = null;
    let lastFailureKind = FAILURE_KINDS.PROVIDER_UNAVAILABLE;
    let resolvedProviderName = null;

    for (const providerName of candidates) {
      if (!this.isProviderCallable(providerName)) {
        continue;
      }

      const provider = this.providers[providerName];
      if (!provider) continue;

      let result = null;

      try {
        if (providerName === 'cli_statusline') {
          if (context.rawStatuslinePayload) {
            result = provider.parseStatuslineJson(context.rawStatuslinePayload);
          } else {
            // No direct payload supplied
            result = {
              success: false,
              failureKind: FAILURE_KINDS.PROVIDER_UNAVAILABLE,
              error: 'NO_RAW_STATUSLINE_FEED_SUPPLIED'
            };
          }
        } else if (typeof provider.fetchQuota === 'function') {
          result = await provider.fetchQuota(context);
        }
      } catch (err) {
        result = {
          success: false,
          failureKind: FAILURE_KINDS.PROCESS_ERROR,
          error: err.message
        };
      }

      if (result && result.success && result.data) {
        // Desktop Quota Authority & Proven Identity Binding (R2 Invariant)
        if (surface === 'desktop') {
          const targetAccount = context.accountIdentity;
          const obsAccount = result.data.accountIdentity || result.data.email;
          if (!targetAccount || !obsAccount || obsAccount !== targetAccount) {
            // Mandatory Positive Match for Desktop:
            // Desktop cannot accept statusline quota without positive proof that the CLI session email strictly matches Desktop account
            this.recordFailure(providerName, FAILURE_KINDS.IDENTITY_MISMATCH);
            lastFailureKind = FAILURE_KINDS.IDENTITY_MISMATCH;
            continue;
          }
        }

        this.recordSuccess(providerName);
        successfulObservation = result;
        resolvedProviderName = providerName;
        break;
      } else {
        const kind = result?.failureKind || FAILURE_KINDS.PROVIDER_UNAVAILABLE;
        this.recordFailure(providerName, kind);
        if (lastFailureKind === FAILURE_KINDS.PROVIDER_UNAVAILABLE || !lastFailureKind) {
          lastFailureKind = kind;
        } else if (kind !== FAILURE_KINDS.PROVIDER_UNAVAILABLE) {
          lastFailureKind = kind;
        }
      }
    }

    // Apply canonical state machine transition
    const prevHealth = this.currentHealth;
    const observationForTransition = successfulObservation || {
      success: false,
      failureKind: lastFailureKind
    };
    const nextHealth = transitionQuotaHealth(
      prevHealth,
      observationForTransition,
      this.staleGraceSeconds,
      now
    );
    this.currentHealth = nextHealth;

    // Dispatch update to Coordinator
    if (this.coordinatorClient && typeof this.coordinatorClient.updateQuota === 'function') {
      try {
        await this.coordinatorClient.updateQuota(observationForTransition);
      } catch (_) {}
    }

    // Calculate effective quota percentage
    const eff = calculateEffectiveQuota(nextHealth.buckets, context.activeModel);

    // Ephemeral Unmonitored Bypass evaluation (R2)
    let bypassActive = false;
    if (nextHealth.state === SAFETY_STATES.UNKNOWN_BLOCKED && context.bypassToken) {
      bypassActive = isBypassValid(context.bypassToken, {
        knownQuota: eff,
        accountIdentity: context.accountIdentity,
        surfaceInstanceId: context.surfaceInstanceId,
        conversationId: context.conversationId
      });
    }

    const circuitState = resolvedProviderName ? this.getCircuit(resolvedProviderName).state : CIRCUIT_BREAKER_STATES.OPEN_CIRCUIT;

    return {
      success: nextHealth.state === SAFETY_STATES.FRESH,
      state: nextHealth.state,
      failureKind: nextHealth.failureKind,
      sourceStatus: nextHealth.sourceStatus,
      effectiveQuota: eff,
      buckets: nextHealth.buckets,
      accountIdentity: nextHealth.accountIdentity,
      bypassActive,
      provenance: {
        provider: resolvedProviderName || 'none',
        observedAt: nextHealth.observedAt || now,
        freshnessAge: nextHealth.observedAt ? now - nextHealth.observedAt : Infinity,
        schemaVersion: '2.2.0',
        confidenceClass: successfulObservation?.data?.confidenceClass || 'UNVERIFIED',
        circuitBreakerState: circuitState
      }
    };
  }

  /**
   * Diagnostic summary for `quota-guard doctor` and HUD expert views.
   */
  getDiagnostics() {
    const circuits = {};
    for (const [name, c] of this.circuits.entries()) {
      circuits[name] = { ...c };
    }
    return {
      currentHealthState: this.currentHealth.state,
      failureKind: this.currentHealth.failureKind,
      sourceStatus: this.currentHealth.sourceStatus,
      circuits
    };
  }
}

module.exports = {
  ProviderResolver
};
