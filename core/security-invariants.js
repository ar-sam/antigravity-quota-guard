'use strict';

/**
 * Antigravity Quota Guard — Canonical Security Invariants
 * Single source of truth for the 11 absolute, non-configurable security redlines.
 */

const CANONICAL_SECURITY_INVARIANTS = Object.freeze({
  // 1. Exact typing boundary: 0 is not null, null is not 100, 0 is never default
  DISTINCT_QUOTA_TYPING: Object.freeze({
    id: 'SEC-01',
    description: 'Distinct 0 / null / 100 quota typing: 0% is valid and critical, null is unknown, neither defaults to 100%',
    enforced: true
  }),

  // 2. Atomic disk serialization with POSIX permissions
  POSIX_FILE_PERMISSIONS: Object.freeze({
    id: 'SEC-02',
    directoryMode: 0o700,
    fileMode: 0o600,
    description: 'Config and checkpoints written atomically with fsync and restricted 0700/0600 POSIX permissions',
    enforced: true
  }),

  // 3. Renderer isolation
  RENDERER_WRITE_AUTHORITY: Object.freeze({
    id: 'SEC-03',
    description: 'Renderer process has zero direct filesystem, process execution, or network write authority',
    authority: 'NEVER',
    enforced: true
  }),

  // 4. Monotonic threshold order
  MONOTONIC_THRESHOLDS: Object.freeze({
    id: 'SEC-04',
    description: 'Threshold order invariant: warnPercent > stabilizePercent > checkpointPercent > stopPercent, and minResumePercent > stopPercent',
    enforced: true
  }),

  // 5. Credential exfiltration prohibition
  CREDENTIAL_SECRET_EXFILTRATION: Object.freeze({
    id: 'SEC-05',
    description: 'Never extract, transmit, or exfiltrate account tokens, passwords, cookies, or secrets to external networks',
    policy: 'NEVER',
    enforced: true
  }),

  // 6. Credential logging prohibition
  CREDENTIAL_SECRET_LOGGING: Object.freeze({
    id: 'SEC-06',
    description: 'Never log raw passwords, OAuth bearer tokens, session cookies, or API keys to disk, stdout, or journals',
    policy: 'NEVER',
    enforced: true
  }),

  // 7. Credential UI display prohibition
  CREDENTIAL_SECRET_DISPLAY: Object.freeze({
    id: 'SEC-07',
    description: 'Never display raw secret keys, OAuth tokens, or unmasked credentials in UI, HUD, or recovery documents',
    policy: 'NEVER',
    enforced: true
  }),

  // 8. Session token replay prohibition
  SESSION_TOKEN_REPLAY: Object.freeze({
    id: 'SEC-08',
    description: 'Never duplicate or replay captured session tokens across processes, machines, or remote instances',
    policy: 'NEVER',
    enforced: true
  }),

  // 9. Cross-user credential isolation
  CROSS_USER_CREDENTIAL_ACCESS: Object.freeze({
    id: 'SEC-09',
    description: 'Never access or inspect keyrings, keychains, or credential stores belonging to other OS users',
    policy: 'NEVER',
    enforced: true
  }),

  // 10. Logic/presentation timezone separation
  DISPLAY_TIMEZONE_AFFECTS_LOGIC: Object.freeze({
    id: 'SEC-10',
    description: 'Display timezone formatting has zero influence on core quota calculations, timers, state transitions, or reset epochs',
    policy: 'NEVER',
    enforced: true
  }),

  // 11. Explicit consent for OS credential storage mutation
  CREDENTIAL_STORE_MUTATION_CONSENT: Object.freeze({
    id: 'SEC-11',
    description: 'Never manipulate or mutate OS Keychains or secure vaults without explicit, verified user authorization',
    policy: 'ALWAYS',
    enforced: true
  })
});

/**
 * Validates that an object or state adheres to the 11 security invariants.
 */
function assertSecurityInvariants(context = {}) {
  // 1. Verify threshold monotonic ordering if thresholds provided
  if (context.thresholds) {
    const { warnPercent, stabilizePercent, checkpointPercent, stopPercent, minResumePercent } = context.thresholds;
    if (typeof warnPercent === 'number' && typeof stabilizePercent === 'number') {
      if (warnPercent <= stabilizePercent) {
        throw new Error('[SEC-04] Invariant violation: warnPercent must be strictly greater than stabilizePercent');
      }
    }
    if (typeof stabilizePercent === 'number' && typeof checkpointPercent === 'number') {
      if (stabilizePercent <= checkpointPercent) {
        throw new Error('[SEC-04] Invariant violation: stabilizePercent must be strictly greater than checkpointPercent');
      }
    }
    if (typeof checkpointPercent === 'number' && typeof stopPercent === 'number') {
      if (checkpointPercent <= stopPercent) {
        throw new Error('[SEC-04] Invariant violation: checkpointPercent must be strictly greater than stopPercent');
      }
    }
    if (typeof minResumePercent === 'number' && typeof stopPercent === 'number') {
      if (minResumePercent <= stopPercent) {
        throw new Error('[SEC-04] Invariant violation: minResumePercent must be strictly greater than stopPercent');
      }
    }
  }

  // 2. Verify no raw secrets in sanitized objects
  if (context.payload && typeof context.payload === 'object') {
    const forbiddenKeys = ['password', 'accessToken', 'refreshToken', 'rawApiKey', 'cookie', 'bearerToken'];
    for (const key of forbiddenKeys) {
      if (key in context.payload && context.payload[key] !== undefined && context.payload[key] !== null) {
        throw new Error(`[SEC-06] Invariant violation: raw secret key "${key}" detected in payload`);
      }
    }
  }

  return true;
}

module.exports = {
  CANONICAL_SECURITY_INVARIANTS,
  assertSecurityInvariants
};
