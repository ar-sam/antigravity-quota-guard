'use strict';

/**
 * Antigravity Quota Guard — Private RPC Provider Stub
 * 
 * Invariants (R2, R12, R16):
 * 1. Registered as CAPABILITY_UNAVAILABLE in Capability Registry until an official
 *    or reverse-engineered gRPC/Connect-RPC quota interface is mechanically verified.
 * 2. Defaults to isAvailable() === false. Requires explicit God Mode activation
 *    and granular sub-toggle (quota.allowPrivateProviderDiscovery === true).
 * 3. Never initiates unauthorized network connections or unmonitored ports.
 * 4. Implements standard provider interface with circuit breaker hooks.
 */

const { FAILURE_KINDS, CIRCUIT_BREAKER_STATES } = require('../core/quota-contract.js');
const { capabilityRegistry, OPERATING_MODES } = require('../core/capability-registry.js');

const PRIVATE_RPC_PROVIDER_CAPABILITY_STATUS = 'CAPABILITY_UNAVAILABLE';
const CAPABILITY_ID = 'PRIVATE_CONNECT_RPC';

class PrivateRpcProvider {
  constructor(options = {}) {
    this.name = 'private_rpc';
    this.status = PRIVATE_RPC_PROVIDER_CAPABILITY_STATUS;
    this.capabilityId = CAPABILITY_ID;
    this.config = options.config || {};
    this.registry = options.registry || capabilityRegistry;

    // Circuit Breaker State Tracking
    this.circuit = {
      state: CIRCUIT_BREAKER_STATES.CLOSED,
      failureCount: 0,
      lastSuccess: null,
      lastFailure: null,
      cooldownDeadline: null
    };
  }

  /**
   * Evaluates provider availability.
   * Stays strictly false unless explicitly allowed by config and capability registry.
   */
  isAvailable(context = {}) {
    // Circuit breaker check
    if (this.circuit.state === CIRCUIT_BREAKER_STATES.OPEN_CIRCUIT) {
      if (this.circuit.cooldownDeadline && Date.now() < this.circuit.cooldownDeadline) {
        return false;
      }
      // Cooldown expired: eligible for half-open probe
      this.circuit.state = CIRCUIT_BREAKER_STATES.HALF_OPEN;
    }

    const mode = context.mode || this.config.expert?.mode || OPERATING_MODES.STANDARD;
    const cfg = context.config || this.config;

    // Standard mode never allows private RPC
    if (mode === OPERATING_MODES.STANDARD) {
      return false;
    }

    // Must be explicitly enabled in config
    if (!cfg.quota?.allowPrivateRpcFallback && !cfg.quota?.allowPrivateProviderDiscovery) {
      return false;
    }

    // Check capability registry permission
    const check = this.registry.isCapabilityAllowed(this.capabilityId, mode, cfg);
    if (!check.allowed) {
      return false;
    }

    // Still unavailable until mechanically verified Connect-RPC client is wired
    return false;
  }

  /**
   * Discovers running language server port and CSRF token.
   * Modularized from payload.js for dedicated provider isolation.
   */
  discoverCredentials() {
    // 1. Electron languageServer export if present in global/require context
    try {
      const ls = require('./languageServer.js');
      const port = typeof ls.getLsPort === 'function' ? ls.getLsPort() : 0;
      const proc = typeof ls.getLsProcess === 'function' ? ls.getLsProcess() : null;
      let token = null;
      if (proc && Array.isArray(proc.spawnargs)) {
        const idx = proc.spawnargs.indexOf('--csrf_token');
        if (idx !== -1 && idx + 1 < proc.spawnargs.length) {
          token = proc.spawnargs[idx + 1];
        }
      }
      if (port > 0 && token) return { port, token };
    } catch (_) {}

    // 2. Process list discovery (macOS / Linux non-browser)
    if (process.type !== 'browser' && process.platform !== 'win32') {
      try {
        const { execSync } = require('child_process');
        const ps = execSync('ps aux | grep -i language_server | grep -v grep', {
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 1500
        }).toString();
        const tokenMatch = ps.match(/--csrf_token\s+([a-f0-9-]+)/i);
        const pidMatch = ps.match(/\s+(\d+)\s+.*language_server/);
        if (tokenMatch && pidMatch) {
          const token = tokenMatch[1];
          const pid = pidMatch[1];
          const lsof = execSync(`lsof -Pan -p ${pid} -i -sTCP:LISTEN`, {
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1500
          }).toString();
          const portMatch = lsof.match(/:(\d+)\s+\(LISTEN\)/);
          if (portMatch) {
            return { port: parseInt(portMatch[1], 10), token };
          }
        }
      } catch (_) {}
    }

    return null;
  }

  /**
   * Fetches quota via Private RPC.
   * Returns fail-closed UNAVAILABLE observation.
   */
  async fetchQuota(context = {}) {
    const now = Date.now();

    if (!this.isAvailable(context)) {
      this.recordFailure(FAILURE_KINDS.PROVIDER_UNAVAILABLE);
      return {
        success: false,
        failureKind: FAILURE_KINDS.PROVIDER_UNAVAILABLE,
        error: 'PRIVATE_RPC_UNAVAILABLE_NOT_MECHANICALLY_VERIFIED',
        source: this.name,
        observedAt: now,
        schemaVersion: '2.2.0',
        confidenceClass: 'UNVERIFIED'
      };
    }

    // Placeholder for future verified Connect-RPC wire call
    this.recordFailure(FAILURE_KINDS.PROVIDER_UNAVAILABLE);
    return {
      success: false,
      failureKind: FAILURE_KINDS.PROVIDER_UNAVAILABLE,
      error: 'PRIVATE_RPC_NOT_IMPLEMENTED',
      source: this.name,
      observedAt: now,
      schemaVersion: '2.2.0',
      confidenceClass: 'UNVERIFIED'
    };
  }

  /**
   * Records a provider failure and updates circuit breaker.
   */
  recordFailure(failureKind, cooldownMs = 30000) {
    this.circuit.failureCount++;
    this.circuit.lastFailure = Date.now();

    // Invariant: SCHEMA_MISMATCH trips circuit immediately
    if (failureKind === FAILURE_KINDS.SCHEMA_MISMATCH || this.circuit.failureCount >= 3) {
      this.circuit.state = CIRCUIT_BREAKER_STATES.OPEN_CIRCUIT;
      this.circuit.cooldownDeadline = Date.now() + cooldownMs;
    }
  }

  /**
   * Records a provider success and clears circuit breaker.
   */
  recordSuccess() {
    this.circuit.state = CIRCUIT_BREAKER_STATES.CLOSED;
    this.circuit.failureCount = 0;
    this.circuit.lastSuccess = Date.now();
    this.circuit.cooldownDeadline = null;
  }

  getCircuitState() {
    return { ...this.circuit };
  }
}

module.exports = {
  PRIVATE_RPC_PROVIDER_CAPABILITY_STATUS,
  PrivateRpcProvider
};
