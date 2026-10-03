'use strict';

/**
 * Antigravity Quota Guard — Canonical Configuration Defaults
 * Single source of truth for all default configuration values.
 * 
 * Invariant: DEFAULT VALUE ≠ HARDCODED BEHAVIOR
 * No operational parameter, threshold, timeout, or limit may be hardcoded
 * in application logic. All access must resolve via this configuration.
 */

const { CANONICAL_SECURITY_INVARIANTS } = require('./security-invariants.js');

const CONFIG_SCHEMA_VERSION = '2.2.0';

const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_SCHEMA_VERSION,

  // =========================================================================
  // Tier 1: User Configurable Settings (Standard Mode)
  // =========================================================================
  language: 'fa', // 'fa' | 'en'

  thresholds: Object.freeze({
    warnPercent: 20,
    stabilizePercent: 15,
    checkpointPercent: 13,
    stopPercent: 12,
    minResumePercent: 70
  }),

  durations: Object.freeze({
    staleGraceSeconds: 60,
    refreshIntervalSeconds: 180
  }),

  visuals: Object.freeze({
    hudScope: 'fiveHour', // 'fiveHour' | 'weekly' | 'both'
    displayMode: 'standard', // 'minimal' | 'standard' | 'expert' | 'god'
    badgeStyle: 'detailed', // 'detailed' | 'compact'
    themePreset: 'clinical', // 'clinical' | 'vibrant' | 'minimal' | 'custom'
    colors: Object.freeze({
      safe: '#10b981',
      warn: '#d97706',
      critical: '#e11d48',
      text: '#f8fafc',
      background: '#0f172a'
    })
  }),

  display: Object.freeze({
    timeZoneMode: 'system', // 'system' | 'fixed'
    fixedTimeZone: null, // string (e.g. 'America/New_York') when timeZoneMode === 'fixed'
    badgeTimeFormat: 'relative' // 'relative' | 'both'
  }),

  notifications: Object.freeze({
    enabled: true,
    soundEnabled: true,
    soundName: 'Glass',
    desktopNotification: true
  }),

  snapshot: Object.freeze({
    enabled: true,
    includeTranscript: true,
    transcriptMessageLimit: 5,
    transcriptCharLimitPerMessage: 2000,
    includeAccountEmail: false, // masked for privacy by default
    includeArtifactInventory: true,
    retentionCount: 10
  }),

  handover: Object.freeze({
    autoOpenAccountFlow: true,
    autoDetectAccountChange: true,
    autoVerifyQuota: true,
    autoPrepareRecovery: true,
    resumeMode: 'automatic_when_supported' // 'automatic_when_supported' | 'one_click' | 'manual'
  }),

  // =========================================================================
  // Tier 2: Advanced & Expert Configurable Settings
  // =========================================================================
  expert: Object.freeze({
    mode: 'standard', // 'standard' | 'advanced' | 'god'
    godModeLifetime: 'persistent' // 'persistent' | 'until_restart' | 'timed'
  }),

  auth: Object.freeze({
    automationMode: 'assisted', // 'official_only' | 'assisted' | 'experimental'
    allowExperimentalUiAutomation: false
  }),

  quota: Object.freeze({
    providerMode: 'auto_safe', // 'auto_safe' | 'cli_statusline' | 'cli_only' | 'private_rpc'
    allowPrivateRpcFallback: false,
    allowPrivateProviderDiscovery: false
  }),

  diagnostics: Object.freeze({
    allowInternalAuthStateInspection: false,
    showRawQuotaPayload: false,
    showProviderResolution: false,
    showSessionMetadata: false
  }),

  scanning: Object.freeze({
    maxDepth: 4,
    maxFiles: 50,
    maxTotalBytes: 50 * 1024 * 1024, // 50MB
    timeoutMs: 3000
  }),

  resume: Object.freeze({
    requireFreshQuota: true,
    requireAccountChangeOrReset: true,
    allowManualSameAccountResume: true
  }),

  simulation: Object.freeze({
    enabled: false
  }),

  shadowMode: Object.freeze({
    enabled: false
  }),

  // =========================================================================
  // Tier 3: Non-Configurable Canonical Security Invariants Reference
  // =========================================================================
  securityInvariants: CANONICAL_SECURITY_INVARIANTS
});

module.exports = {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG
};
