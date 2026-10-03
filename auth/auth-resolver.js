/**
 * Antigravity Quota Guard — Surface-Aware Authentication Strategy Resolver
 * Implements R11 and R13 from architecture specification.
 */

'use strict';

const { AUTH_STRATEGIES } = require('./auth-contract');
const { capabilityRegistry, OPERATING_MODES, RISK_LEVELS } = require('../core/capability-registry');

/**
 * Resolves the appropriate authentication/account switching strategy
 * based on current surface, operating mode, user configuration, and capability stability.
 *
 * @param {object} context
 * @param {string} [context.surface='desktop'] - 'desktop' | 'cli' | 'subagent' | 'headless'
 * @param {string} [context.mode='standard'] - 'standard' | 'advanced' | 'god'
 * @param {object} [context.config={}] - active user configuration
 * @param {object} [context.registry=capabilityRegistry] - capability registry
 * @returns {object} Strategy resolution descriptor
 */
function resolveAuthStrategy(context = {}) {
  const surface = (context.surface || 'desktop').toLowerCase();
  const mode = context.mode || OPERATING_MODES.STANDARD;
  const config = context.config || {};
  const registry = context.registry || capabilityRegistry;

  // 1. Desktop Surface
  if (surface === 'desktop') {
    // Check if God Mode experimental UI automation is explicitly requested and permitted
    if (mode === OPERATING_MODES.GOD && config.auth?.allowExperimentalUiAutomation === true) {
      const allowedCheck = registry.isCapabilityAllowed('ACCOUNT_UI_AUTOMATION_EXPERIMENTAL', mode, config);
      if (allowedCheck.allowed) {
        return {
          strategy: AUTH_STRATEGIES.EXPERIMENTAL_UI_AUTOMATION,
          source: 'EXPERIMENTAL',
          riskLevel: RISK_LEVELS.HIGH,
          requiresConfirmation: true,
          rationale: 'Opt-in experimental DOM automation in God Mode with active user confirmation.'
        };
      }
    }

    // Default Desktop: Documented Settings Assistance
    return {
      strategy: AUTH_STRATEGIES.DESKTOP_SETTINGS_ASSIST,
      source: 'OFFICIAL_ASSISTED',
      riskLevel: RISK_LEVELS.NONE,
      requiresConfirmation: false,
      rationale: 'Assisted navigation to Antigravity Settings -> Accounts with staged handoff context.'
    };
  }

  // 2. CLI Surface
  if (surface === 'cli') {
    // Check if configured for API Key Profile switching
    if (config.auth?.cliDefaultStrategy === 'api_key_profile' || context.requestApiKeyProfile === true) {
      const allowedCheck = registry.isCapabilityAllowed('CLI_API_KEY_PROFILE', mode, config);
      if (allowedCheck.allowed) {
        return {
          strategy: AUTH_STRATEGIES.CLI_API_KEY_PROFILE,
          source: 'OFFICIAL',
          riskLevel: RISK_LEVELS.LOW,
          requiresConfirmation: true,
          rationale: 'Coordinator-leased modelProvider: "gemini" profile switch for CLI sessions.'
        };
      }
    }

    // Default CLI: Official session logout and login
    return {
      strategy: AUTH_STRATEGIES.CLI_SESSION,
      source: 'OFFICIAL',
      riskLevel: RISK_LEVELS.NONE,
      requiresConfirmation: false,
      rationale: 'Official CLI /logout command followed by interactive login.'
    };
  }

  // Fallback for subagents, headless, or unmonitored surfaces
  return {
    strategy: AUTH_STRATEGIES.MANUAL_USER_MANAGED,
    source: 'USER_MANAGED',
    riskLevel: RISK_LEVELS.NONE,
    requiresConfirmation: false,
    rationale: 'Manual account switch required on headless or unmonitored surface.'
  };
}

module.exports = {
  resolveAuthStrategy
};
