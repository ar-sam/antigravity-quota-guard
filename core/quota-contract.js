'use strict';

/**
 * Antigravity Quota Guard — Canonical Quota Contract & Health Types
 * Enforces cold-start fail-closed safety state machine,
 * separated diagnostic failure kinds, and strict session-bound bypass.
 *
 * Canonical QuotaHealth shape:
 * {
 *   state: 'INIT' | 'FRESH' | 'STALE_GRACE' | 'UNKNOWN_BLOCKED',
 *   failureKind: 'NONE' | 'NETWORK_ERROR' | 'PROCESS_ERROR' | 'SCHEMA_MISMATCH' | 'PROVIDER_UNAVAILABLE' | 'IDENTITY_MISMATCH',
 *   buckets: Record<string, { remainingPercent: number, remainingFraction: number, resetTime: string|null, resetInSeconds: number|null, category: string|null }>,
 *   source: 'cli_statusline' | 'coordinator' | 'unknown',
 *   observedAt: number | null  // UTC epoch ms
 * }
 */

// Canonical Safety States
const SAFETY_STATES = Object.freeze({
  INIT: 'INIT',
  FRESH: 'FRESH',
  STALE_GRACE: 'STALE_GRACE',
  UNKNOWN_BLOCKED: 'UNKNOWN_BLOCKED'
});

// Diagnostic Failure Kinds (separated from safety states)
const FAILURE_KINDS = Object.freeze({
  NONE: 'NONE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PROCESS_ERROR: 'PROCESS_ERROR',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH'
});

// Quota Source Status
const QUOTA_SOURCE_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  STALE: 'STALE',
  UNAVAILABLE: 'UNAVAILABLE',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN'
});

// Circuit Breaker States
const CIRCUIT_BREAKER_STATES = Object.freeze({
  CLOSED: 'CLOSED',
  HALF_OPEN: 'HALF_OPEN',
  OPEN_CIRCUIT: 'OPEN_CIRCUIT'
});

// Bucket Identifiers
const BUCKET_TYPES = Object.freeze({
  GEMINI: 'gemini',
  CLAUDE_GPT: 'claude_gpt'
});

/**
 * Constructs an empty canonical Quota Health record.
 */
function createInitialQuotaHealth() {
  return {
    state: SAFETY_STATES.INIT,
    failureKind: FAILURE_KINDS.NONE,
    sourceStatus: QUOTA_SOURCE_STATUS.HEALTHY,
    lastKnownFreshTimestamp: null,
    staleSinceTimestamp: null,
    buckets: {},
    accountIdentity: null,
    source: 'unknown',
    observedAt: null,
    schemaVersion: '2.2.0',
    confidenceClass: 'UNVERIFIED'
  };
}

/**
 * Evaluates state transition based on current state, observation result, and timestamps.
 * 
 * Cold-Start Fail-Closed Invariant:
 * If in INIT and fetch fails (or no trusted observation exists),
 * transitions IMMEDIATELY to UNKNOWN_BLOCKED (0s grace).
 * STALE_GRACE (60s) is strictly reserved for transitions from an already verified FRESH state.
 */
function transitionQuotaHealth(currentHealth, observationResult, staleGraceSeconds = 60, now = Date.now()) {
  const current = currentHealth || createInitialQuotaHealth();

  // If observation is successful and valid (must contain >= 1 valid bucket)
  const hasValidBuckets = observationResult?.data?.buckets && typeof observationResult.data.buckets === 'object' && Object.keys(observationResult.data.buckets).length > 0;
  if (observationResult && observationResult.success && observationResult.data && hasValidBuckets) {
    const data = observationResult.data;
    return {
      ...current,
      state: SAFETY_STATES.FRESH,
      failureKind: FAILURE_KINDS.NONE,
      sourceStatus: QUOTA_SOURCE_STATUS.HEALTHY,
      lastKnownFreshTimestamp: now,
      staleSinceTimestamp: null,
      buckets: data.buckets && typeof data.buckets === 'object' ? data.buckets : current.buckets,
      accountIdentity: data.accountIdentity ?? current.accountIdentity,
      source: data.source ?? 'cli_statusline',
      observedAt: data.observedAt ?? now,
      confidenceClass: data.confidenceClass ?? 'HIGH'
    };
  }

  // If observation failed
  const failureKind = observationResult?.failureKind || FAILURE_KINDS.NETWORK_ERROR;

  // Case 1: Cold-start (from INIT) -> Immediate UNKNOWN_BLOCKED (0s grace)
  if (current.state === SAFETY_STATES.INIT) {
    return {
      ...current,
      state: SAFETY_STATES.UNKNOWN_BLOCKED,
      failureKind,
      sourceStatus: QUOTA_SOURCE_STATUS.UNAVAILABLE,
      staleSinceTimestamp: now
    };
  }

  // Case 2: From FRESH -> Enter STALE_GRACE
  if (current.state === SAFETY_STATES.FRESH) {
    return {
      ...current,
      state: SAFETY_STATES.STALE_GRACE,
      failureKind,
      sourceStatus: QUOTA_SOURCE_STATUS.STALE,
      staleSinceTimestamp: now
    };
  }

  // Case 3: In STALE_GRACE -> Check if grace duration exceeded
  if (current.state === SAFETY_STATES.STALE_GRACE) {
    const elapsedSeconds = current.staleSinceTimestamp ? (now - current.staleSinceTimestamp) / 1000 : Infinity;
    if (elapsedSeconds >= staleGraceSeconds) {
      return {
        ...current,
        state: SAFETY_STATES.UNKNOWN_BLOCKED,
        failureKind,
        sourceStatus: QUOTA_SOURCE_STATUS.UNAVAILABLE
      };
    }
    // Still in grace
    return {
      ...current,
      failureKind,
      sourceStatus: QUOTA_SOURCE_STATUS.STALE
    };
  }

  // Case 4: Already UNKNOWN_BLOCKED -> Remain UNKNOWN_BLOCKED with updated failureKind
  return {
    ...current,
    state: SAFETY_STATES.UNKNOWN_BLOCKED,
    failureKind,
    sourceStatus: QUOTA_SOURCE_STATUS.UNAVAILABLE
  };
}

/**
 * Validates a session-bound unmonitored bypass state token.
 */
function createUnmonitoredBypass(surfaceInstanceId, conversationId, accountIdentity, sessionEpoch = Date.now()) {
  if (!surfaceInstanceId || !conversationId || !accountIdentity) {
    throw new Error('Unmonitored bypass requires surfaceInstanceId, conversationId, and accountIdentity');
  }
  return Object.freeze({
    surfaceInstanceId,
    conversationId,
    accountIdentity,
    sessionEpoch,
    activatedAt: sessionEpoch
  });
}

/**
 * Checks whether an active unmonitored bypass token is valid for a given context.
 */
function isBypassValid(bypassToken, context = {}) {
  if (!bypassToken) return false;
  if (context.knownQuota !== undefined && typeof context.knownQuota === 'number' && context.knownQuota <= 12) {
    // SEC/Invariant: Cannot bypass known quota <= 12%
    return false;
  }
  if (context.workspaceDiverged) {
    // SEC/Invariant: Cannot bypass workspace divergence
    return false;
  }
  if (context.isHaltedBackground) {
    // SEC/Invariant: Cannot bypass HALTED_BACKGROUND_ACTIVE
    return false;
  }
  if (context.accountIdentity && context.accountIdentity !== bypassToken.accountIdentity) {
    // Revoked on account switch
    return false;
  }
  if (context.surfaceInstanceId && context.surfaceInstanceId !== bypassToken.surfaceInstanceId) {
    return false;
  }
  if (context.conversationId && context.conversationId !== bypassToken.conversationId) {
    return false;
  }
  return true;
}

module.exports = {
  SAFETY_STATES,
  FAILURE_KINDS,
  QUOTA_SOURCE_STATUS,
  CIRCUIT_BREAKER_STATES,
  BUCKET_TYPES,
  createInitialQuotaHealth,
  transitionQuotaHealth,
  createUnmonitoredBypass,
  isBypassValid
};
