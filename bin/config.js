'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONFIG_LKG_FILE = path.join(CONFIG_DIR, 'config.lkg.json');

const THEME_PRESETS = {
  clinical: {
    safe: '#10b981',
    warn: '#d97706',
    critical: '#e11d48',
    text: '#f8fafc',
    background: '#0f172a'
  },
  standard: {
    safe: '#22c55e',
    warn: '#eab308',
    critical: '#ef4444',
    text: '#ffffff',
    background: '#18181b'
  },
  vibrant: {
    safe: '#06b6d4',
    warn: '#f97316',
    critical: '#ec4899',
    text: '#ffffff',
    background: '#09090b'
  }
};

const SOUND_PRESETS = {
  Glass: '/System/Library/Sounds/Glass.aiff',
  Ping: '/System/Library/Sounds/Ping.aiff',
  Pop: '/System/Library/Sounds/Pop.aiff',
  Submarine: '/System/Library/Sounds/Submarine.aiff'
};

const VALID_HUD_SCOPES = ['fiveHour', 'weekly', 'both'];

const DEFAULT_CONFIG = {
  language: 'fa', // 'fa' or 'en'
  thresholds: {
    warnPercent: 20,
    stabilizePercent: 15,
    checkpointPercent: 13,
    stopPercent: 12,
    minResumePercent: 70
  },
  visuals: {
    badgeStyle: 'detailed', // 'detailed' | 'compact'
    hudScope: 'fiveHour',   // 'fiveHour' | 'weekly' | 'both'
    themePreset: 'clinical',
    colors: { ...THEME_PRESETS.clinical }
  },
  audio: {
    soundEnabled: true,
    soundName: 'Glass',
    desktopNotification: true
  },
  sync: {
    refreshIntervalMinutes: 3,
    autoDetectBucket: true,
    targetBucket: 'auto'
  },
  handover: {
    requireNewAccountOrMinQuota: true,
    autoOpenSettings: false
  }
};

function deepMerge(target, source) {
  const output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') return false;
  const scope = (config.visuals && config.visuals.hudScope) ? config.visuals.hudScope : config.hudScope;
  if (!scope || !VALID_HUD_SCOPES.includes(scope)) return false;

  // Enforce bounds validation: stopPercent < stabilizePercent <= warnPercent
  if (config.thresholds && typeof config.thresholds === 'object') {
    const t = config.thresholds;
    const hasStop = typeof t.stopPercent === 'number';
    const hasStab = typeof t.stabilizePercent === 'number';
    const hasWarn = typeof t.warnPercent === 'number';

    if (hasStop && (t.stopPercent < 0 || t.stopPercent > 100)) return false;
    if (hasStab && (t.stabilizePercent < 0 || t.stabilizePercent > 100)) return false;
    if (hasWarn && (t.warnPercent < 0 || t.warnPercent > 100)) return false;

    if (hasStop && hasStab && t.stopPercent >= t.stabilizePercent) return false;
    if (hasStab && hasWarn && t.stabilizePercent > t.warnPercent) return false;
    if (hasStop && hasWarn && t.stopPercent >= t.warnPercent) return false;
  }

  return true;
}

function loadConfig() {
  try {
    ensureConfigDir();
    if (!fs.existsSync(CONFIG_FILE)) {
      saveConfig(DEFAULT_CONFIG);
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = deepMerge(DEFAULT_CONFIG, parsed);

    // Validate and enforce valid hudScope for backward compatibility
    if (!merged.visuals || !VALID_HUD_SCOPES.includes(merged.visuals.hudScope)) {
      if (!merged.visuals) merged.visuals = {};
      merged.visuals.hudScope = 'fiveHour';
    }

    // Validate and repair thresholds without losing user settings
    if (merged.thresholds && typeof merged.thresholds === 'object') {
      try {
        const { sanitizeAndRepairThresholds } = require('../core/config-schema.js');
        merged.thresholds = sanitizeAndRepairThresholds(merged.thresholds);
      } catch (_) {
        if (typeof merged.thresholds.stopPercent === 'number' &&
            typeof merged.thresholds.stabilizePercent === 'number' &&
            typeof merged.thresholds.warnPercent === 'number') {
          if (merged.thresholds.stopPercent >= merged.thresholds.stabilizePercent ||
              merged.thresholds.stabilizePercent > merged.thresholds.warnPercent) {
            merged.thresholds.stopPercent = 12;
            merged.thresholds.stabilizePercent = 15;
            merged.thresholds.warnPercent = 20;
          }
        }
      }
    }
    return merged;
  } catch (err) {
    console.error('[QuotaGuard Config] Warning: failed to parse config.json, using safe defaults:', err.message);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig(cfg) {
  ensureConfigDir();
  let existing = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  const merged = deepMerge(deepMerge(DEFAULT_CONFIG, existing), cfg || {});
  if (!merged.visuals || !VALID_HUD_SCOPES.includes(merged.visuals.hudScope)) {
    if (!merged.visuals) merged.visuals = {};
    merged.visuals.hudScope = 'fiveHour';
  }
  if (merged.thresholds && typeof merged.thresholds === 'object') {
    try {
      const { sanitizeAndRepairThresholds } = require('../core/config-schema.js');
      merged.thresholds = sanitizeAndRepairThresholds(merged.thresholds);
    } catch (_) {
      if (typeof merged.thresholds.stopPercent === 'number' &&
          typeof merged.thresholds.stabilizePercent === 'number' &&
          typeof merged.thresholds.warnPercent === 'number') {
        if (merged.thresholds.stopPercent >= merged.thresholds.stabilizePercent ||
            merged.thresholds.stabilizePercent > merged.thresholds.warnPercent) {
          merged.thresholds.stopPercent = 12;
          merged.thresholds.stabilizePercent = 15;
          merged.thresholds.warnPercent = 20;
        }
      }
    }
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  try {
    fs.writeFileSync(CONFIG_LKG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch (_) {}
  return merged;
}

function resetConfig() {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  THEME_PRESETS,
  SOUND_PRESETS,
  VALID_HUD_SCOPES,
  validateConfig,
  loadConfig,
  saveConfig,
  resetConfig
};
