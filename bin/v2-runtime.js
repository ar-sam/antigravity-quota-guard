#!/usr/bin/env node
'use strict';

/**
 * Antigravity Quota Guard — V2.2 Canonical Runtime Entrypoint
 * Wires together all V2.2 subsystems:
 *   - ConfigStore (config persistence & LKG)
 *   - GlobalCoordinator (Unix socket IPC, leader election)
 *   - GuardStateMachine (5-tier safety states)
 *   - HandoverOrchestrator (12-state account handover)
 *   - ContinuityGuard (multi-folder workspace capsule)
 *   - CapabilityRegistry (version probing, mode enforcement)
 *   - EventJournal (chained-hash flight recorder)
 *   - SnapshotEngine (durable checkpoint)
 *   - AuthResolver (surface-aware strategy)
 *   - HookHandler (official Antigravity hooks)
 */

const path = require('path');
const os = require('os');

class QuotaGuardRuntime {
  constructor(options = {}) {
    this._options = options;
    this._subsystems = {};
    this._initialized = false;
  }

  /**
   * Lazily loads a subsystem module with error isolation.
   * Returns null if the module fails to load (graceful degradation).
   */
  _loadModule(modulePath, name) {
    try {
      return require(modulePath);
    } catch (err) {
      process.stderr.write(`[V2Runtime] Warning: Could not load ${name}: ${err.message}\n`);
      return null;
    }
  }

  /**
   * Initializes the V2.2 runtime subsystems in dependency order.
   */
  async initialize() {
    if (this._initialized) return this;

    // 1. Configuration (foundation of everything)
    const configStoreModule = this._loadModule('../core/config-store.js', 'ConfigStore');
    if (configStoreModule) {
      const { ConfigStore } = configStoreModule;
      const store = new ConfigStore(this._options.configStore || {});
      this._subsystems.configStore = store;
      this._subsystems.config = store.loadConfig();
    }

    // 2. Event Journal (flight recorder, independent)
    const journalModule = this._loadModule('../core/event-journal.js', 'EventJournal');
    if (journalModule) {
      const { EventJournal } = journalModule;
      this._subsystems.journal = new EventJournal(this._options.journal || {});
    }

    // 3. Capability Registry
    const registryModule = this._loadModule('../core/capability-registry.js', 'CapabilityRegistry');
    if (registryModule) {
      const { CapabilityRegistry } = registryModule;
      this._subsystems.registry = new CapabilityRegistry(this._options.registry || {});
    }

    // 4. Auth Resolver (surface-aware strategy)
    const authModule = this._loadModule('../auth/auth-resolver.js', 'AuthResolver');
    if (authModule) {
      const { AuthResolver } = authModule;
      if (typeof AuthResolver === 'function') {
        this._subsystems.authResolver = new AuthResolver(this._options.auth || {});
      } else {
        this._subsystems.authResolver = authModule;
      }
    }

    // 5. Guard State Machine
    const guardModule = this._loadModule('../core/guard-state-machine.js', 'GuardStateMachine');
    if (guardModule) {
      const { GuardStateMachine } = guardModule;
      this._subsystems.guard = new GuardStateMachine(this._subsystems.config || {});
    }

    // 6. Snapshot Engine (depends on config)
    const snapshotModule = this._loadModule('../core/snapshot-engine.js', 'SnapshotEngine');
    if (snapshotModule) {
      const { SnapshotEngine } = snapshotModule;
      this._subsystems.snapshot = new SnapshotEngine(this._options.snapshot || {});
    }

    // 7. Continuity Guard (multi-folder workspace — exports functions, not a class)
    const continuityModule = this._loadModule('../core/continuity-guard.js', 'ContinuityGuard');
    if (continuityModule) {
      // continuity-guard exports utility functions (createWorkspaceCapsule, verifyWorkspaceDivergence, etc.)
      this._subsystems.continuity = continuityModule;
    }

    // 8. Handover Orchestrator (depends on guard + snapshot)
    const handoverModule = this._loadModule('../core/handover-orchestrator.js', 'HandoverOrchestrator');
    if (handoverModule) {
      const { HandoverOrchestrator } = handoverModule;
      this._subsystems.handover = new HandoverOrchestrator(
        this._subsystems.config || {},
        {
          guard: this._subsystems.guard,
          snapshot: this._subsystems.snapshot,
          journal: this._subsystems.journal
        }
      );
    }

    // 9. Hook Handler (wires to guard + snapshot)
    const hookModule = this._loadModule('../integrations/antigravity-hook/hook-handler.js', 'HookHandler');
    if (hookModule) {
      const { HookHandler } = hookModule;
      this._subsystems.hookHandler = new HookHandler({
        initialState: this._subsystems.guard?.state || 'SAFE',
        snapshotEngine: this._subsystems.snapshot,
        stopPercent: this._subsystems.config?.thresholds?.stopPercent
      });
    }

    // 10. Global Coordinator (starts Unix socket IPC server if requested)
    const coordinatorModule = this._loadModule('../core/coordinator.js', 'GlobalCoordinator');
    if (coordinatorModule) {
      const { GlobalCoordinator } = coordinatorModule;
      this._subsystems.coordinator = new GlobalCoordinator(this._options.coordinator || {});
    }

    this._initialized = true;
    return this;
  }

  /**
   * Starts the coordinator daemon (for sidecar / standalone daemon mode).
   */
  async startCoordinator() {
    await this.initialize();
    if (this._subsystems.coordinator) {
      await this._subsystems.coordinator.start();
      return this._subsystems.coordinator;
    }
    throw new Error('Coordinator not available');
  }

  /**
   * Returns a summary of loaded subsystems for diagnostics.
   */
  getStatus() {
    return {
      initialized: this._initialized,
      subsystems: Object.keys(this._subsystems).reduce((acc, key) => {
        acc[key] = this._subsystems[key] ? 'loaded' : 'unavailable';
        return acc;
      }, {}),
      config: this._subsystems.config ? {
        language: this._subsystems.config.language,
        thresholds: this._subsystems.config.thresholds
      } : null
    };
  }

  /**
   * Returns a specific subsystem by name.
   */
  get(name) {
    return this._subsystems[name] || null;
  }
}

// Singleton runtime instance
let _runtimeInstance = null;

/**
 * Gets or creates the singleton V2.2 runtime.
 */
function getRuntime(options = {}) {
  if (!_runtimeInstance) {
    _runtimeInstance = new QuotaGuardRuntime(options);
  }
  return _runtimeInstance;
}

// CLI entry point for --test-init and --coordinator modes
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--test-init')) {
    const runtime = getRuntime();
    runtime.initialize().then(() => {
      const status = runtime.getStatus();
      console.log(JSON.stringify(status, null, 2));
      const loaded = Object.values(status.subsystems).filter(v => v === 'loaded').length;
      const total = Object.keys(status.subsystems).length;
      console.log(`V2.2 runtime initialized: ${loaded}/${total} subsystems loaded`);
      process.exit(0);
    }).catch(err => {
      console.error('V2.2 runtime init failed:', err.message);
      process.exit(1);
    });
  } else if (args.includes('--coordinator')) {
    const runtime = getRuntime();
    runtime.startCoordinator().then(coord => {
      console.log(`Coordinator started on socket: ${coord.socketPath}`);
      // Keep running until signal
      process.on('SIGTERM', () => { coord.stop().then(() => process.exit(0)); });
      process.on('SIGINT', () => { coord.stop().then(() => process.exit(0)); });
    }).catch(err => {
      console.error('Coordinator start failed:', err.message);
      process.exit(1);
    });
  } else {
    console.log('Antigravity Quota Guard V2.2 Runtime');
    console.log('Usage: node bin/v2-runtime.js [--test-init | --coordinator]');
    process.exit(0);
  }
}

module.exports = { QuotaGuardRuntime, getRuntime };
