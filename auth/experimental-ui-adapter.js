/**
 * Antigravity Quota Guard — Experimental UI Automation Adapter
 * Implements R11 and R13 for God Mode DOM automation.
 *
 * Invariant: Strictly prohibited unless:
 * 1. expert.mode === 'god'
 * 2. config.auth.allowExperimentalUiAutomation === true
 * 3. Verified mechanically against CapabilityRegistry
 */

'use strict';

const { capabilityRegistry, OPERATING_MODES } = require('../core/capability-registry');

class ExperimentalUiAdapter {
  constructor(options = {}) {
    this._registry = options.registry || capabilityRegistry;
  }

  /**
   * Verifies if experimental UI automation is permitted.
   * @param {object} config
   * @returns {{ allowed: boolean, reason: string }}
   */
  canAutomate(config = {}) {
    const mode = config.expert?.mode || OPERATING_MODES.STANDARD;
    return this._registry.isCapabilityAllowed('ACCOUNT_UI_AUTOMATION_EXPERIMENTAL', mode, config);
  }

  /**
   * Generates the experimental DOM injection script for account switching.
   * Throws if permission gates fail.
   * @param {object} config
   * @returns {object}
   */
  prepareAutomationScript(config = {}) {
    const check = this.canAutomate(config);
    if (!check.allowed) {
      const err = new Error(`Security Violation: Experimental UI automation rejected: ${check.reason}`);
      err.code = 'SECURITY_INVARIANT_VIOLATION';
      throw err;
    }

    return {
      type: 'EXPERIMENTAL_DOM_AUTOMATION',
      capabilityId: 'ACCOUNT_UI_AUTOMATION_EXPERIMENTAL',
      generatedAt: new Date().toISOString(),
      // Read-only selector inspection payload
      selectors: {
        settingsButton: 'button[data-testid="settings-nav"]',
        accountsTab: 'div[data-testid="tab-accounts"]',
        switchAccountButton: 'button[data-testid="switch-account-btn"]'
      },
      disclaimer: 'EXPERIMENTAL FEATURE: Automated account UI navigation executed under God Mode.'
    };
  }
}

module.exports = {
  ExperimentalUiAdapter
};
