/**
 * Antigravity Quota Guard — Tagged Account Identity & Authentication Contract
 * Implements R13 and R23 from architecture specification.
 *
 * Invariant: Never compare raw emails or store raw API keys. Handover comparison
 * operates strictly on tagged identity contracts.
 */

'use strict';

const crypto = require('crypto');

/**
 * Identity Kinds
 * @readonly
 * @enum {string}
 */
const IDENTITY_KINDS = {
  GOOGLE_ACCOUNT: 'GOOGLE_ACCOUNT',
  GEMINI_API_KEY_PROFILE: 'GEMINI_API_KEY_PROFILE',
  CUSTOM_GEMINI_ENDPOINT: 'CUSTOM_GEMINI_ENDPOINT',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Authentication Strategies
 * @readonly
 * @enum {string}
 */
const AUTH_STRATEGIES = {
  DESKTOP_SETTINGS_ASSIST: 'DESKTOP_SETTINGS_ASSIST',
  CLI_SESSION: 'CLI_SESSION',
  CLI_API_KEY_PROFILE: 'CLI_API_KEY_PROFILE',
  EXPERIMENTAL_UI_AUTOMATION: 'EXPERIMENTAL_UI_AUTOMATION',
  MANUAL_USER_MANAGED: 'MANUAL_USER_MANAGED'
};

/**
 * Transition Statuses
 * @readonly
 * @enum {string}
 */
const AUTH_TRANSITION_STATUS = {
  IDLE: 'IDLE',
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

/**
 * Creates a tagged account identity object.
 * @param {string} kind
 * @param {any} identifier
 * @param {object} [secureStorage] - secure storage instance for HMAC fingerprinting
 * @returns {object}
 */
function createTaggedIdentity(kind, identifier, secureStorage = null) {
  switch (kind) {
    case IDENTITY_KINDS.GOOGLE_ACCOUNT: {
      if (!identifier || typeof identifier !== 'string') {
        return {
          kind: IDENTITY_KINDS.UNKNOWN,
          displayLabel: 'Unknown Account',
          fingerprint: null
        };
      }

      const normalizedEmail = identifier.trim().toLowerCase();
      let fingerprint = null;

      if (secureStorage && typeof secureStorage.computeAccountFingerprint === 'function') {
        fingerprint = secureStorage.computeAccountFingerprint(normalizedEmail);
      } else {
        // Fallback SHA-256 if secureStorage key is not provided (e.g. testing)
        fingerprint = crypto.createHash('sha256').update(normalizedEmail).digest('hex');
      }

      return {
        kind: IDENTITY_KINDS.GOOGLE_ACCOUNT,
        fingerprint,
        displayLabel: '[Connected Account (Protected)]',
        createdAt: new Date().toISOString()
      };
    }

    case IDENTITY_KINDS.GEMINI_API_KEY_PROFILE: {
      const profileId = String(identifier || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
      return {
        kind: IDENTITY_KINDS.GEMINI_API_KEY_PROFILE,
        profileId,
        displayLabel: `API Key Profile: ${profileId}`,
        createdAt: new Date().toISOString()
      };
    }

    case IDENTITY_KINDS.CUSTOM_GEMINI_ENDPOINT: {
      const endpoint = typeof identifier === 'object' ? identifier.endpoint : String(identifier);
      const profileId = typeof identifier === 'object' ? identifier.profileId : 'custom';
      return {
        kind: IDENTITY_KINDS.CUSTOM_GEMINI_ENDPOINT,
        endpoint: endpoint || 'https://generativelanguage.googleapis.com',
        profileId: profileId || 'custom',
        displayLabel: `Custom Endpoint: ${endpoint}`,
        createdAt: new Date().toISOString()
      };
    }

    case IDENTITY_KINDS.UNKNOWN:
    default:
      return {
        kind: IDENTITY_KINDS.UNKNOWN,
        displayLabel: 'Unknown / Unmonitored',
        fingerprint: null,
        createdAt: new Date().toISOString()
      };
  }
}

/**
 * Compares two tagged identities for equality.
 * Returns true if both represent the EXACT SAME account, false if different or switched.
 * @param {object|null} id1
 * @param {object|null} id2
 * @returns {boolean}
 */
function areIdentitiesEqual(id1, id2) {
  if (!id1 && !id2) return true;
  if (!id1 || !id2) return false;

  if (id1.kind !== id2.kind) return false;

  switch (id1.kind) {
    case IDENTITY_KINDS.GOOGLE_ACCOUNT:
      return id1.fingerprint === id2.fingerprint;

    case IDENTITY_KINDS.GEMINI_API_KEY_PROFILE:
      return id1.profileId === id2.profileId;

    case IDENTITY_KINDS.CUSTOM_GEMINI_ENDPOINT:
      return id1.endpoint === id2.endpoint && id1.profileId === id2.profileId;

    case IDENTITY_KINDS.UNKNOWN:
      return false; // Unknown accounts cannot be asserted as identical

    default:
      return false;
  }
}

/**
 * Creates a structured AuthTransitionEvent payload.
 * @param {object} params
 * @param {object|null} params.fromIdentity
 * @param {object|null} params.toIdentity
 * @param {string} params.strategy
 * @param {string} params.status
 * @param {string|null} [params.error]
 * @returns {object}
 */
function createAuthTransitionEvent({ fromIdentity, toIdentity, strategy, status, error = null }) {
  return {
    eventId: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    fromIdentity: fromIdentity ? { kind: fromIdentity.kind, fingerprint: fromIdentity.fingerprint, profileId: fromIdentity.profileId } : null,
    toIdentity: toIdentity ? { kind: toIdentity.kind, fingerprint: toIdentity.fingerprint, profileId: toIdentity.profileId } : null,
    strategy,
    status,
    error,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  IDENTITY_KINDS,
  AUTH_STRATEGIES,
  AUTH_TRANSITION_STATUS,
  createTaggedIdentity,
  areIdentitiesEqual,
  createAuthTransitionEvent
};
