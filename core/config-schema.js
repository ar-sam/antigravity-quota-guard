'use strict';

/**
 * Antigravity Quota Guard — Configuration Schema Validator
 * Validates configuration payloads, rejects prototype pollution,
 * enforces monotonic threshold invariants and returns sanitized config objects.
 */

const { DEFAULT_CONFIG } = require('./config-defaults.js');
const { assertSecurityInvariants } = require('./security-invariants.js');

const VALID_LANGUAGES = ['fa', 'en'];
const VALID_HUD_SCOPES = ['fiveHour', 'weekly', 'both'];
const VALID_DISPLAY_MODES = ['minimal', 'standard', 'expert', 'god'];
const VALID_BADGE_STYLES = ['detailed', 'compact'];
const VALID_THEME_PRESETS = ['clinical', 'standard', 'vibrant', 'minimal', 'custom'];
const VALID_TIMEZONE_MODES = ['system', 'fixed'];
const VALID_BADGE_TIME_FORMATS = ['relative', 'both'];
const VALID_RESUME_MODES = ['automatic_when_supported', 'one_click', 'manual'];
const VALID_EXPERT_MODES = ['standard', 'advanced', 'god'];
const VALID_GOD_MODE_LIFETIMES = ['persistent', 'until_restart', 'timed'];
const VALID_AUTH_MODES = ['official_only', 'assisted', 'experimental'];
const VALID_PROVIDER_MODES = ['auto_safe', 'cli_statusline', 'cli_only', 'private_rpc'];

/**
 * Recursively inspects for prototype pollution vectors.
 */
function assertNoPrototypePollution(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return;
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (dangerousKeys.includes(key)) {
      throw new Error(`Prototype pollution attempt detected via key: "${key}"`);
    }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      assertNoPrototypePollution(obj[key], depth + 1);
    }
  }
}

/**
 * Deep clones an object safely.
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep merges source into target without prototype pollution.
 */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return target;
  }
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
  return target;
}

/**
 * Validates a configuration object against schema constraints.
 * Throws an Error with detailed message if validation fails.
 * Returns true if valid.
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Configuration must be a non-null object');
  }

  assertNoPrototypePollution(config);

  // Validate language
  if (config.language !== undefined && !VALID_LANGUAGES.includes(config.language)) {
    throw new Error(`Invalid language: "${config.language}". Must be one of: ${VALID_LANGUAGES.join(', ')}`);
  }

  // Validate thresholds
  if (config.thresholds) {
    const { warnPercent, stabilizePercent, checkpointPercent, stopPercent, minResumePercent } = config.thresholds;

    const checkNum = (val, name, min, max) => {
      if (val !== undefined) {
        if (typeof val !== 'number' || Number.isNaN(val) || val < min || val > max) {
          throw new Error(`Threshold ${name} must be a number between ${min} and ${max}`);
        }
      }
    };

    checkNum(warnPercent, 'warnPercent', 5, 100);
    checkNum(stabilizePercent, 'stabilizePercent', 4, 100);
    checkNum(checkpointPercent, 'checkpointPercent', 3, 100);
    checkNum(stopPercent, 'stopPercent', 1, 50);
    checkNum(minResumePercent, 'minResumePercent', 10, 100);

    // Enforce monotonic relationship
    const w = warnPercent ?? DEFAULT_CONFIG.thresholds.warnPercent;
    const s = stabilizePercent ?? DEFAULT_CONFIG.thresholds.stabilizePercent;
    const c = checkpointPercent ?? DEFAULT_CONFIG.thresholds.checkpointPercent;
    const st = stopPercent ?? DEFAULT_CONFIG.thresholds.stopPercent;
    const r = minResumePercent ?? DEFAULT_CONFIG.thresholds.minResumePercent;

    if (w <= s) {
      throw new Error(`Monotonic ordering error: warnPercent (${w}) must be > stabilizePercent (${s})`);
    }
    if (s <= c) {
      throw new Error(`Monotonic ordering error: stabilizePercent (${s}) must be > checkpointPercent (${c})`);
    }
    if (c <= st) {
      throw new Error(`Monotonic ordering error: checkpointPercent (${c}) must be > stopPercent (${st})`);
    }
    if (r <= st) {
      throw new Error(`Monotonic ordering error: minResumePercent (${r}) must be > stopPercent (${st})`);
    }

    assertSecurityInvariants({ thresholds: { warnPercent: w, stabilizePercent: s, checkpointPercent: c, stopPercent: st, minResumePercent: r } });
  }

  // Validate visuals
  if (config.visuals) {
    if (config.visuals.hudScope !== undefined && !VALID_HUD_SCOPES.includes(config.visuals.hudScope)) {
      throw new Error(`Invalid visuals.hudScope: "${config.visuals.hudScope}". Must be one of: ${VALID_HUD_SCOPES.join(', ')}`);
    }
    if (config.visuals.displayMode !== undefined && !VALID_DISPLAY_MODES.includes(config.visuals.displayMode)) {
      throw new Error(`Invalid visuals.displayMode: "${config.visuals.displayMode}". Must be one of: ${VALID_DISPLAY_MODES.join(', ')}`);
    }
    if (config.visuals.badgeStyle !== undefined && !VALID_BADGE_STYLES.includes(config.visuals.badgeStyle)) {
      throw new Error(`Invalid visuals.badgeStyle: "${config.visuals.badgeStyle}". Must be one of: ${VALID_BADGE_STYLES.join(', ')}`);
    }
    if (config.visuals.themePreset !== undefined && !VALID_THEME_PRESETS.includes(config.visuals.themePreset)) {
      throw new Error(`Invalid visuals.themePreset: "${config.visuals.themePreset}". Must be one of: ${VALID_THEME_PRESETS.join(', ')}`);
    }
  }

  // Validate display
  if (config.display) {
    if (config.display.timeZoneMode !== undefined && !VALID_TIMEZONE_MODES.includes(config.display.timeZoneMode)) {
      throw new Error(`Invalid display.timeZoneMode: "${config.display.timeZoneMode}"`);
    }
    if (config.display.badgeTimeFormat !== undefined && !VALID_BADGE_TIME_FORMATS.includes(config.display.badgeTimeFormat)) {
      throw new Error(`Invalid display.badgeTimeFormat: "${config.display.badgeTimeFormat}"`);
    }
  }

  // Validate handover
  if (config.handover) {
    if (config.handover.resumeMode !== undefined && !VALID_RESUME_MODES.includes(config.handover.resumeMode)) {
      throw new Error(`Invalid handover.resumeMode: "${config.handover.resumeMode}"`);
    }
  }

  // Validate expert mode
  if (config.expert) {
    if (config.expert.mode !== undefined && !VALID_EXPERT_MODES.includes(config.expert.mode)) {
      throw new Error(`Invalid expert.mode: "${config.expert.mode}"`);
    }
    if (config.expert.godModeLifetime !== undefined && !VALID_GOD_MODE_LIFETIMES.includes(config.expert.godModeLifetime)) {
      throw new Error(`Invalid expert.godModeLifetime: "${config.expert.godModeLifetime}"`);
    }
  }

  // Validate auth
  if (config.auth) {
    if (config.auth.automationMode !== undefined && !VALID_AUTH_MODES.includes(config.auth.automationMode)) {
      throw new Error(`Invalid auth.automationMode: "${config.auth.automationMode}"`);
    }
  }

  // Validate quota
  if (config.quota) {
    if (config.quota.providerMode !== undefined && !VALID_PROVIDER_MODES.includes(config.quota.providerMode)) {
      throw new Error(`Invalid quota.providerMode: "${config.quota.providerMode}"`);
    }
  }

  return true;
}

/**
 * Sanitizes and repairs thresholds to guarantee valid monotonic ordering
 * without losing user customizations.
 */
function sanitizeAndRepairThresholds(thresholds = {}) {
  const defaults = DEFAULT_CONFIG.thresholds;
  if (!thresholds || typeof thresholds !== 'object') {
    return deepClone(defaults);
  }

  let st = (typeof thresholds.stopPercent === 'number' && !Number.isNaN(thresholds.stopPercent))
    ? Math.max(1, Math.min(50, Math.round(thresholds.stopPercent)))
    : defaults.stopPercent;
  let c = (typeof thresholds.checkpointPercent === 'number' && !Number.isNaN(thresholds.checkpointPercent))
    ? Math.max(3, Math.min(100, Math.round(thresholds.checkpointPercent)))
    : defaults.checkpointPercent;
  let s = (typeof thresholds.stabilizePercent === 'number' && !Number.isNaN(thresholds.stabilizePercent))
    ? Math.max(4, Math.min(100, Math.round(thresholds.stabilizePercent)))
    : defaults.stabilizePercent;
  let w = (typeof thresholds.warnPercent === 'number' && !Number.isNaN(thresholds.warnPercent))
    ? Math.max(5, Math.min(100, Math.round(thresholds.warnPercent)))
    : defaults.warnPercent;
  let r = (typeof thresholds.minResumePercent === 'number' && !Number.isNaN(thresholds.minResumePercent))
    ? Math.max(10, Math.min(100, Math.round(thresholds.minResumePercent)))
    : defaults.minResumePercent;

  // Enforce monotonicity: st < c < s < w
  if (c <= st) c = Math.min(100, st + 1);
  if (s <= c) s = Math.min(100, c + 2);
  if (w <= s) w = Math.min(100, s + 5);
  if (r <= st) r = Math.min(100, Math.max(r, st + 5));

  return {
    warnPercent: w,
    stabilizePercent: s,
    checkpointPercent: c,
    stopPercent: st,
    minResumePercent: r
  };
}

/**
 * Non-destructively repairs a user configuration by clamping or fixing
 * any invalid fields while preserving 100% of valid user choices.
 */
function repairConfig(userConfig = {}) {
  assertNoPrototypePollution(userConfig);
  const base = deepClone(DEFAULT_CONFIG);
  const merged = deepMerge(base, userConfig || {});

  // Repair language
  if (!VALID_LANGUAGES.includes(merged.language)) {
    merged.language = DEFAULT_CONFIG.language;
  }

  // Repair thresholds
  merged.thresholds = sanitizeAndRepairThresholds(merged.thresholds);

  // Repair visuals
  if (merged.visuals) {
    if (!VALID_HUD_SCOPES.includes(merged.visuals.hudScope)) {
      merged.visuals.hudScope = DEFAULT_CONFIG.visuals.hudScope;
    }
    if (!VALID_DISPLAY_MODES.includes(merged.visuals.displayMode)) {
      merged.visuals.displayMode = DEFAULT_CONFIG.visuals.displayMode;
    }
    if (!VALID_BADGE_STYLES.includes(merged.visuals.badgeStyle)) {
      merged.visuals.badgeStyle = DEFAULT_CONFIG.visuals.badgeStyle;
    }
    if (!VALID_THEME_PRESETS.includes(merged.visuals.themePreset)) {
      merged.visuals.themePreset = DEFAULT_CONFIG.visuals.themePreset;
    }
  }

  // Repair display
  if (merged.display) {
    if (!VALID_TIMEZONE_MODES.includes(merged.display.timeZoneMode)) {
      merged.display.timeZoneMode = DEFAULT_CONFIG.display.timeZoneMode;
    }
    if (!VALID_BADGE_TIME_FORMATS.includes(merged.display.badgeTimeFormat)) {
      merged.display.badgeTimeFormat = DEFAULT_CONFIG.display.badgeTimeFormat;
    }
  }

  // Repair handover
  if (merged.handover) {
    if (!VALID_RESUME_MODES.includes(merged.handover.resumeMode)) {
      merged.handover.resumeMode = DEFAULT_CONFIG.handover.resumeMode;
    }
  }

  // Repair expert
  if (merged.expert) {
    if (!VALID_EXPERT_MODES.includes(merged.expert.mode)) {
      merged.expert.mode = DEFAULT_CONFIG.expert.mode;
    }
    if (!VALID_GOD_MODE_LIFETIMES.includes(merged.expert.godModeLifetime)) {
      merged.expert.godModeLifetime = DEFAULT_CONFIG.expert.godModeLifetime;
    }
  }

  // Repair auth
  if (merged.auth) {
    if (!VALID_AUTH_MODES.includes(merged.auth.automationMode)) {
      merged.auth.automationMode = DEFAULT_CONFIG.auth.automationMode;
    }
  }

  // Repair quota
  if (merged.quota) {
    if (!VALID_PROVIDER_MODES.includes(merged.quota.providerMode)) {
      merged.quota.providerMode = DEFAULT_CONFIG.quota.providerMode;
    }
  }

  // Validate the final repaired object (should never throw now)
  validateConfig(merged);
  return merged;
}

/**
 * Normalizes and fills defaults for any user configuration input.
 */
function normalizeConfig(userConfig = {}) {
  return repairConfig(userConfig);
}

module.exports = {
  VALID_LANGUAGES,
  VALID_HUD_SCOPES,
  VALID_DISPLAY_MODES,
  VALID_BADGE_STYLES,
  VALID_THEME_PRESETS,
  VALID_TIMEZONE_MODES,
  VALID_BADGE_TIME_FORMATS,
  VALID_RESUME_MODES,
  VALID_EXPERT_MODES,
  VALID_GOD_MODE_LIFETIMES,
  VALID_AUTH_MODES,
  VALID_PROVIDER_MODES,
  validateConfig,
  normalizeConfig,
  repairConfig,
  sanitizeAndRepairThresholds,
  deepClone,
  deepMerge,
  assertNoPrototypePollution
};
