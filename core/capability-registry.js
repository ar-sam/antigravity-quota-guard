/**
 * Antigravity Quota Guard — Capability Registry & Expert/God Mode Architecture
 * Maintains system capabilities metadata, version compatibility probing,
 * 3-tier operating mode enforcement, and granular safety gates.
 *
 * Implements R12, R20, R25 from architecture specification.
 */

'use strict';

/**
 * Operating Modes
 * @readonly
 * @enum {string}
 */
const OPERATING_MODES = {
  STANDARD: 'standard',
  ADVANCED: 'advanced',
  GOD: 'god'
};

/**
 * Capability Sources
 * @readonly
 * @enum {string}
 */
const CAPABILITY_SOURCES = {
  OFFICIAL: 'OFFICIAL',
  REVERSE_ENGINEERED: 'REVERSE_ENGINEERED',
  EXPERIMENTAL: 'EXPERIMENTAL'
};

/**
 * Capability Stability Statuses
 * @readonly
 * @enum {string}
 */
const CAPABILITY_STABILITY = {
  OFFICIAL: 'OFFICIAL',
  REVERSE_ENGINEERED_STABLE: 'REVERSE_ENGINEERED_STABLE',
  EXPERIMENTAL: 'EXPERIMENTAL',
  BROKEN_BY_VERSION: 'BROKEN_BY_VERSION',
  COMPATIBILITY_HOLD: 'COMPATIBILITY_HOLD'
};

/**
 * Risk Levels
 * @readonly
 * @enum {string}
 */
const RISK_LEVELS = {
  NONE: 'NONE',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH'
};

/**
 * Sidecar States
 * @readonly
 * @enum {string}
 */
const SIDECAR_STATES = {
  SIDECAR_UNAVAILABLE: 'SIDECAR_UNAVAILABLE',
  SIDECAR_AVAILABLE_DISABLED: 'SIDECAR_AVAILABLE_DISABLED',
  SIDECAR_ENABLED: 'SIDECAR_ENABLED',
  SIDECAR_HEALTHY: 'SIDECAR_HEALTHY',
  SIDECAR_FAILED: 'SIDECAR_FAILED'
};

/**
 * Canonical System Capabilities Definition
 */
const CANONICAL_CAPABILITIES = [
  {
    id: 'OFFICIAL_HOOKS',
    name: 'Official Antigravity Plugin Hooks',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.NONE,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'PreInvocation, PostInvocation, PreToolUse, and Stop official lifecycle hooks.'
  },
  {
    id: 'CLI_STATUSLINE_TAP',
    name: 'Official CLI Statusline Feed Tap',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.NONE,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Non-destructive multiplexer tapping Antigravity CLI statusline JSON output.'
  },
  {
    id: 'SETTINGS_PATH_DOCUMENTED',
    name: 'Official Settings User Navigation Guidance',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.NONE,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Documented user-facing navigation guidance (Settings -> Accounts).'
  },
  {
    id: 'CLI_LOGOUT_LOGIN',
    name: 'Official CLI Account Authentication',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.NONE,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Official CLI /logout and login session flows.'
  },
  {
    id: 'CLI_RESUME_EXACT',
    name: 'Official CLI Exact Conversation Resume',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.NONE,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Exact conversation resumption using "agy --conversation <id>".'
  },
  {
    id: 'CLI_RESUME_WORKSPACE',
    name: 'Official CLI Workspace Resume Fallback',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.LOW,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Workspace-scoped CLI resume fallback using "agy -c".'
  },
  {
    id: 'READ_ONLY_MCP_DIAGNOSTICS',
    name: 'Read-Only Local MCP Diagnostic Server',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.NONE,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Secure, read-only diagnostic tools exposed to the agent via MCP.'
  },
  {
    id: 'CLI_API_KEY_PROFILE',
    name: 'CLI Gemini API Key Profile Switching',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.LOW,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: true,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Coordinates modelProvider: "gemini" profile switching with exclusive mutation lease.'
  },
  {
    id: 'PLUGIN_SIDECAR_COORDINATOR',
    name: 'Official Plugin Sidecar Coordinator',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.LOW,
    requiresRestart: true,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Global coordinator hosted inside official Antigravity Plugin Sidecar.'
  },
  {
    id: 'LAUNCH_AGENT_DAEMON',
    name: 'macOS LaunchAgent Fallback Daemon',
    source: CAPABILITY_SOURCES.OFFICIAL,
    stability: CAPABILITY_STABILITY.OFFICIAL,
    riskLevel: RISK_LEVELS.LOW,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '99.0.0',
    description: 'Host-level LaunchAgent coordinator daemon fallback.'
  },
  {
    id: 'SETTINGS_AUTO_OPEN_REVERSE_ENGINEERED',
    name: 'Programmatic Settings Auto-Open',
    source: CAPABILITY_SOURCES.REVERSE_ENGINEERED,
    stability: CAPABILITY_STABILITY.REVERSE_ENGINEERED_STABLE,
    riskLevel: RISK_LEVELS.LOW,
    requiresRestart: false,
    requiresPatch: true,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '2.5.0',
    description: 'Dispatches Cmd+, shortcut or triggers electron openSettings window event.'
  },
  {
    id: 'ACCOUNT_ROUTE_REVERSE_ENGINEERED',
    name: 'Programmatic Account Route Navigation',
    source: CAPABILITY_SOURCES.REVERSE_ENGINEERED,
    stability: CAPABILITY_STABILITY.REVERSE_ENGINEERED_STABLE,
    riskLevel: RISK_LEVELS.LOW,
    requiresRestart: false,
    requiresPatch: true,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '2.5.0',
    description: 'Direct internal navigation to the Accounts section of settings.'
  },
  {
    id: 'PRIVATE_CONNECT_RPC',
    name: 'Private Connect-RPC Discovery',
    source: CAPABILITY_SOURCES.REVERSE_ENGINEERED,
    stability: CAPABILITY_STABILITY.REVERSE_ENGINEERED_STABLE,
    riskLevel: RISK_LEVELS.MEDIUM,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: true,
    minVersion: '1.0.0',
    maxVersion: '2.2.0',
    description: 'Local gRPC/Connect-RPC inspection for real-time model quota metrics.'
  },
  {
    id: 'DIRECT_RUNTIME_STATE_INSPECTION',
    name: 'Internal Runtime State Inspection',
    source: CAPABILITY_SOURCES.REVERSE_ENGINEERED,
    stability: CAPABILITY_STABILITY.REVERSE_ENGINEERED_STABLE,
    riskLevel: RISK_LEVELS.LOW,
    requiresRestart: false,
    requiresPatch: false,
    requiresUserConfirmation: false,
    minVersion: '1.0.0',
    maxVersion: '2.5.0',
    description: 'Read-only inspection of Antigravity internal database and process tables.'
  },
  {
    id: 'ACCOUNT_UI_AUTOMATION_EXPERIMENTAL',
    name: 'Experimental Account UI Automation',
    source: CAPABILITY_SOURCES.EXPERIMENTAL,
    stability: CAPABILITY_STABILITY.EXPERIMENTAL,
    riskLevel: RISK_LEVELS.HIGH,
    requiresRestart: false,
    requiresPatch: true,
    requiresUserConfirmation: true,
    minVersion: '1.0.0',
    maxVersion: '2.1.0',
    description: 'Automated DOM-level account switching guidance and UI navigation (God Mode only).'
  }
];

class CapabilityRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this._capabilities = new Map();
    /** @type {string} */
    this._currentAntigravityVersion = 'unknown';
    /** @type {string} */
    this._sidecarState = SIDECAR_STATES.SIDECAR_UNAVAILABLE;

    // God Mode runtime state
    this._godMode = {
      active: false,
      activatedAt: null,
      lifetime: 'persistent', // 'persistent' | 'session' | 'timed'
      expiresAt: null,
      confirmedByUser: false
    };

    // Initialize canonical capabilities
    for (const cap of CANONICAL_CAPABILITIES) {
      this.registerCapability(cap);
    }
  }

  /**
   * Registers a capability in the registry.
   * @param {object} capability
   */
  registerCapability(capability) {
    if (!capability || !capability.id) {
      throw new Error('Capability must have an id');
    }
    this._capabilities.set(capability.id, {
      ...capability,
      availability: capability.availability ?? 'AVAILABLE',
      registeredAt: new Date().toISOString()
    });
  }

  /**
   * Retrieves a capability by ID.
   * @param {string} id
   * @returns {object|null}
   */
  getCapability(id) {
    return this._capabilities.get(id) ?? null;
  }

  /**
   * Lists capabilities according to current mode and optional filters.
   * @param {string} [mode='standard']
   * @param {object} [filter]
   * @returns {object[]}
   */
  listCapabilities(mode = OPERATING_MODES.STANDARD, filter = {}) {
    const list = Array.from(this._capabilities.values());

    return list.filter(cap => {
      // Source filter
      if (filter.source && cap.source !== filter.source) return false;
      // Stability filter
      if (filter.stability && cap.stability !== filter.stability) return false;
      // Availability filter
      if (filter.availability && cap.availability !== filter.availability) return false;

      // Mode filtering
      if (mode === OPERATING_MODES.STANDARD) {
        return cap.source === CAPABILITY_SOURCES.OFFICIAL;
      }
      if (mode === OPERATING_MODES.ADVANCED) {
        return cap.source === CAPABILITY_SOURCES.OFFICIAL ||
               cap.source === CAPABILITY_SOURCES.REVERSE_ENGINEERED;
      }
      // God mode includes all, subject to stability
      return true;
    });
  }

  /**
   * Probes installed Antigravity version and updates stability for all capabilities.
   * If version is beyond maxVersion, marks as BROKEN_BY_VERSION without crashing core.
   * @param {string} antigravityVersion
   * @returns {object} Summary of probe results
   */
  probeCapabilities(antigravityVersion) {
    this._currentAntigravityVersion = antigravityVersion || 'unknown';
    const broken = [];
    const hold = [];

    for (const [id, cap] of this._capabilities.entries()) {
      if (cap.source === CAPABILITY_SOURCES.OFFICIAL) {
        // Official capabilities remain stable
        continue;
      }

      // Simple semver check against maxVersion
      if (this._isVersionExceeded(antigravityVersion, cap.maxVersion)) {
        cap.stability = CAPABILITY_STABILITY.BROKEN_BY_VERSION;
        cap.availability = 'UNAVAILABLE';
        broken.push(id);
      } else if (cap.stability === CAPABILITY_STABILITY.BROKEN_BY_VERSION) {
        // Restore if compatible
        cap.stability = cap.source === CAPABILITY_SOURCES.EXPERIMENTAL
          ? CAPABILITY_STABILITY.EXPERIMENTAL
          : CAPABILITY_STABILITY.REVERSE_ENGINEERED_STABLE;
        cap.availability = 'AVAILABLE';
      }
    }

    return {
      antigravityVersion: this._currentAntigravityVersion,
      totalCapabilities: this._capabilities.size,
      brokenCapabilities: broken,
      holdCapabilities: hold
    };
  }

  /**
   * Evaluates if a capability is allowed under the active configuration and mode.
   * R12 Invariant: Even in God Mode, granular sub-toggles must be respected.
   * @param {string} capabilityId
   * @param {string} mode
   * @param {object} config
   * @returns {{ allowed: boolean, reason: string }}
   */
  isCapabilityAllowed(capabilityId, mode = OPERATING_MODES.STANDARD, config = {}) {
    const cap = this._capabilities.get(capabilityId);
    if (!cap) {
      return { allowed: false, reason: `Unknown capability: ${capabilityId}` };
    }

    if (cap.stability === CAPABILITY_STABILITY.BROKEN_BY_VERSION) {
      return { allowed: false, reason: `Capability ${capabilityId} is broken by Antigravity version ${this._currentAntigravityVersion}` };
    }

    if (cap.stability === CAPABILITY_STABILITY.COMPATIBILITY_HOLD) {
      return { allowed: false, reason: `Capability ${capabilityId} is on compatibility hold pending verification` };
    }

    // Standard mode only allows official capabilities
    if (mode === OPERATING_MODES.STANDARD) {
      if (cap.source !== CAPABILITY_SOURCES.OFFICIAL) {
        return { allowed: false, reason: `Capability ${capabilityId} requires Advanced or God Mode` };
      }
      return { allowed: true, reason: 'Official capability allowed in Standard Mode' };
    }

    // Advanced mode allows official and reverse-engineered
    if (mode === OPERATING_MODES.ADVANCED) {
      if (cap.source === CAPABILITY_SOURCES.EXPERIMENTAL) {
        return { allowed: false, reason: `Capability ${capabilityId} requires God Mode` };
      }
      return { allowed: true, reason: 'Allowed in Advanced Mode' };
    }

    // God mode checks
    if (mode === OPERATING_MODES.GOD) {
      if (!this._godMode.active) {
        return { allowed: false, reason: 'God Mode master switch is not active' };
      }

      // Check lifetime expiry
      if (this._godMode.lifetime === 'timed' && this._godMode.expiresAt && Date.now() > this._godMode.expiresAt) {
        this._godMode.active = false;
        return { allowed: false, reason: 'God Mode timed session has expired' };
      }

      // Granular sub-toggle enforcement (R12 / R25 invariant)
      if (capabilityId === 'ACCOUNT_UI_AUTOMATION_EXPERIMENTAL') {
        const allowUi = config.auth?.allowExperimentalUiAutomation ?? false;
        if (!allowUi) {
          return { allowed: false, reason: 'Experimental UI automation sub-toggle (auth.allowExperimentalUiAutomation) is disabled' };
        }
      }

      if (capabilityId === 'PRIVATE_CONNECT_RPC') {
        const allowRpc = config.quota?.allowPrivateProviderDiscovery ?? false;
        if (!allowRpc) {
          return { allowed: false, reason: 'Private RPC provider discovery sub-toggle (quota.allowPrivateProviderDiscovery) is disabled' };
        }
      }

      if (capabilityId === 'DIRECT_RUNTIME_STATE_INSPECTION') {
        const allowInspect = config.diagnostics?.allowInternalAuthStateInspection ?? true;
        if (!allowInspect) {
          return { allowed: false, reason: 'Internal auth inspection sub-toggle (diagnostics.allowInternalAuthStateInspection) is disabled' };
        }
      }

      return { allowed: true, reason: 'Allowed under active God Mode with verified granular sub-toggles' };
    }

    return { allowed: false, reason: `Unsupported operating mode: ${mode}` };
  }

  /**
   * Activates or deactivates God Mode with explicit user confirmation and lifecycle options.
   * @param {boolean} active
   * @param {object} [options]
   * @param {string} [options.lifetime='persistent'] - 'persistent' | 'session' | 'timed'
   * @param {number} [options.durationMinutes=60]
   * @param {boolean} [options.confirmedByUser=false]
   */
  setGodMode(active, options = {}) {
    if (active) {
      if (!options.confirmedByUser) {
        throw new Error('God Mode master activation requires explicit user confirmation of risk');
      }

      const lifetime = options.lifetime || 'persistent';
      let expiresAt = null;
      if (lifetime === 'timed') {
        const minutes = Number(options.durationMinutes) || 60;
        expiresAt = Date.now() + (minutes * 60 * 1000);
      }

      this._godMode = {
        active: true,
        activatedAt: new Date().toISOString(),
        lifetime,
        expiresAt,
        confirmedByUser: true
      };
    } else {
      this._godMode = {
        active: false,
        activatedAt: null,
        lifetime: 'persistent',
        expiresAt: null,
        confirmedByUser: false
      };
    }
  }

  /**
   * Returns current God Mode status.
   * @returns {object}
   */
  getGodModeStatus() {
    const isExpired = this._godMode.lifetime === 'timed' &&
                      this._godMode.expiresAt &&
                      Date.now() > this._godMode.expiresAt;

    if (isExpired) {
      this._godMode.active = false;
    }

    return { ...this._godMode };
  }

  /**
   * Updates sidecar lifecycle state.
   * @param {string} state
   */
  setSidecarState(state) {
    if (Object.values(SIDECAR_STATES).includes(state)) {
      this._sidecarState = state;
    }
  }

  /**
   * Gets current sidecar state.
   * @returns {string}
   */
  getSidecarState() {
    return this._sidecarState;
  }

  /**
   * Simple helper comparing if v1 > v2 (e.g., '2.6.0' > '2.5.0').
   * @private
   */
  _isVersionExceeded(v1, v2) {
    if (!v1 || !v2 || v1 === 'unknown') return false;
    const parts1 = v1.replace(/^v/, '').split('.').map(Number);
    const parts2 = v2.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return true;
      if (p1 < p2) return false;
    }
    return false;
  }
}

// Singleton instance
const capabilityRegistry = new CapabilityRegistry();

module.exports = {
  capabilityRegistry,
  CapabilityRegistry,
  OPERATING_MODES,
  CAPABILITY_SOURCES,
  CAPABILITY_STABILITY,
  RISK_LEVELS,
  SIDECAR_STATES,
  CANONICAL_CAPABILITIES
};
