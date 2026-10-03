'use strict';

/**
 * Antigravity Quota Guard — Canonical Quota Policy Engine
 * Parses and evaluates the OFFICIAL Antigravity statusline quota payload.
 * 
 * Official payload format:
 *   quota: { "<bucket-id>": { remaining_fraction: float, reset_time: ISO8601, reset_in_seconds: int } }
 * 
 * Invariants:
 * 1. Cosmetic hudScope has ZERO authority over guard safety decisions.
 *    Effective quota is the minimum remaining_fraction across all buckets
 *    matching the active model category, converted to percentage.
 * 2. 0% is strictly preserved as 0 (never co-opted to 12 or 100).
 * 3. Null or undefined is returned as null (never defaulted to 100).
 * 4. remaining_fraction is in [0.0, 1.0]; we multiply by 100 for internal percent.
 */

const { DEFAULT_CONFIG } = require('./config-defaults.js');

/**
 * Classifies a bucket ID or model string to a canonical category.
 * Returns 'gemini', 'claude', or null (unknown/other).
 */
function classifyModelCategory(modelStringOrBucketId) {
  if (!modelStringOrBucketId || typeof modelStringOrBucketId !== 'string') return null;
  const s = modelStringOrBucketId.toLowerCase();
  // Match bucket IDs like "gemini-weekly", "gemini-5h" and model names like "Gemini 3.5 Flash"
  if (/^gemini|gemini|flash(?!-claude)|pro(?!-max-claude)/.test(s) && !/claude|gpt|sonnet|opus|haiku|o1|o3/.test(s)) {
    return 'gemini';
  }
  if (/claude|gpt|sonnet|opus|haiku|o1|o3/.test(s)) {
    return 'claude';
  }
  return null;
}

/**
 * Parses the official statusline quota object into normalized bucket array.
 * Input: statusline.quota (object with dynamic keys)
 * Output: Array of { bucketId, category, remainingPercent, resetTime, resetInSeconds }
 */
function parseStatuslineQuota(statuslinePayload) {
  if (!statuslinePayload || typeof statuslinePayload !== 'object') return [];
  const quotaObj = statuslinePayload.quota;
  if (!quotaObj || typeof quotaObj !== 'object') return [];

  const buckets = [];
  for (const [bucketId, data] of Object.entries(quotaObj)) {
    if (!data || typeof data !== 'object') continue;
    const { remaining_fraction, reset_time, reset_in_seconds } = data;
    // Strict validation: must be a finite number between 0.0 and 1.0
    if (typeof remaining_fraction !== 'number' || !Number.isFinite(remaining_fraction) || remaining_fraction < 0 || remaining_fraction > 1) {
      continue;
    }

    const fraction = remaining_fraction;
    buckets.push({
      bucketId,
      category: classifyModelCategory(bucketId),
      remainingPercent: fraction * 100, // Convert to percent for internal use
      remainingFraction: fraction,
      resetTime: reset_time || null,
      resetInSeconds: typeof reset_in_seconds === 'number' ? reset_in_seconds : null
    });
  }
  return buckets;
}

/**
 * Builds a QuotaHealth-compatible buckets object from parsed buckets.
 * Used for storing canonical state in the coordinator.
 */
function buildQuotaHealthBuckets(parsedBuckets) {
  const result = {};
  for (const b of parsedBuckets) {
    result[b.bucketId] = {
      remainingPercent: b.remainingPercent,
      remainingFraction: b.remainingFraction,
      resetTime: b.resetTime,
      resetInSeconds: b.resetInSeconds,
      category: b.category
    };
  }
  return result;
}

/**
 * Calculates effective quota percentage from parsed buckets.
 * 
 * Strategy:
 * 1. If activeModelString is known, prefer buckets matching that model category.
 * 2. If no category match, use the global minimum across ALL buckets.
 * 3. Returns null if no valid buckets exist.
 * 4. 0.0 remaining_fraction → exactly 0% (never rounded away).
 */
function calculateEffectiveQuota(quotaHealthOrBuckets, activeModelString = null) {
  // Accept either a QuotaHealth object (with .buckets) or a raw parsed bucket array
  let buckets;
  if (Array.isArray(quotaHealthOrBuckets)) {
    buckets = quotaHealthOrBuckets;
  } else if (quotaHealthOrBuckets && typeof quotaHealthOrBuckets === 'object') {
    // Legacy internal format: { buckets: { ... } } or direct bucket map
    const raw = quotaHealthOrBuckets.buckets || quotaHealthOrBuckets;
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      buckets = Object.entries(raw).map(([bucketId, data]) => ({
        bucketId,
        category: classifyModelCategory(bucketId),
        remainingPercent: typeof data.remainingPercent === 'number' ? data.remainingPercent
          : typeof data.remainingFraction === 'number' ? data.remainingFraction * 100 : null,
        remainingFraction: data.remainingFraction || null,
        resetTime: data.resetTime || null,
        resetInSeconds: data.resetInSeconds || null
      })).filter(b => b.remainingPercent !== null);
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!buckets || buckets.length === 0) return null;

  const category = classifyModelCategory(activeModelString);

  let filtered = category
    ? buckets.filter(b => b.category === category)
    : buckets;

  // Fall back to all buckets if no category match
  if (filtered.length === 0) {
    filtered = buckets;
  }

  const percents = filtered
    .map(b => b.remainingPercent)
    .filter(v => typeof v === 'number');

  if (percents.length === 0) return null;

  return Math.min(...percents); // Returns 0 for depleted, never null
}

/**
 * Evaluates the guard status tier for a given effective quota percentage and thresholds.
 */
function evaluateQuotaTier(effectiveQuota, thresholds = DEFAULT_CONFIG.thresholds) {
  if (effectiveQuota === null || effectiveQuota === undefined) {
    return 'UNKNOWN';
  }

  const { warnPercent, stabilizePercent, checkpointPercent, stopPercent } = thresholds;

  if (effectiveQuota <= stopPercent) return 'STOP';
  if (effectiveQuota <= checkpointPercent) return 'CHECKPOINT';
  if (effectiveQuota <= stabilizePercent) return 'STABILIZE';
  if (effectiveQuota <= warnPercent) return 'WARN';
  return 'SAFE';
}

module.exports = {
  classifyModelCategory,
  parseStatuslineQuota,
  buildQuotaHealthBuckets,
  calculateEffectiveQuota,
  evaluateQuotaTier
};
