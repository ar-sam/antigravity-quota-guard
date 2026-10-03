'use strict';

/**
 * Antigravity Quota Guard — CLI Provider Stub
 * 
 * Invariants (F2):
 * 1. CLI Provider is registered as CAPABILITY_UNAVAILABLE until an official
 *    machine-readable quota command or API is mechanically verified.
 * 2. TUI interactive panels (/usage, /quota) and headless JSON invocations
 *    are strictly NOT parsed or represented as quota APIs.
 */

const { FAILURE_KINDS } = require('../core/quota-contract.js');

const CLI_PROVIDER_CAPABILITY_STATUS = 'CAPABILITY_UNAVAILABLE';

class CliProvider {
  constructor() {
    this.status = CLI_PROVIDER_CAPABILITY_STATUS;
  }

  isAvailable() {
    return false;
  }

  async fetchQuota() {
    return {
      success: false,
      failureKind: FAILURE_KINDS.PROVIDER_UNAVAILABLE,
      error: 'CLI_PROVIDER_UNAVAILABLE_NO_OFFICIAL_MACHINE_READABLE_COMMAND'
    };
  }
}

module.exports = {
  CLI_PROVIDER_CAPABILITY_STATUS,
  CliProvider
};
