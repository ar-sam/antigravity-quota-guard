'use strict';

/**
 * Antigravity Quota Guard — Injected Payload
 * Native Titlebar HUD, Control Center Popover, Dynamic Settings Engine,
 * Interactive Bilingual User Guide & Multi-Account Handover Modal.
 * 
 * 100% Clean Room Implementation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, exec } = require('child_process');

// Configuration paths
const CONFIG_DIR = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONFIG_LKG_FILE = path.join(CONFIG_DIR, 'config.lkg.json');
const RUNTIME_DIR = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'runtime');
const CHECKPOINTS_DIR = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'checkpoints');

const VALID_HUD_SCOPES = ['fiveHour', 'weekly', 'both'];

const DEFAULT_CONFIG = {
  version: '2.2.0',
  language: 'fa',
  thresholds: { warnPercent: 20, stabilizePercent: 15, checkpointPercent: 13, stopPercent: 12, minResumePercent: 70 },
  visuals: {
    badgeStyle: 'detailed',
    hudScope: 'fiveHour',
    themePreset: 'clinical',
    colors: { safe: '#10b981', warn: '#d97706', critical: '#e11d48', text: '#f8fafc', background: '#0f172a' }
  },
  audio: { soundEnabled: true, soundName: 'Glass', desktopNotification: true },
  notifications: { enabled: true, soundEnabled: true, soundName: 'Glass', desktopNotification: true },
  sync: { refreshIntervalMinutes: 3, autoDetectBucket: true, targetBucket: 'auto' },
  snapshot: {
    enabled: true,
    includeTranscript: true,
    transcriptMessageLimit: 5,
    includeAccountEmail: false,
    includeArtifactInventory: true,
    retentionCount: 10
  },
  handover: {
    autoOpenAccountFlow: true,
    autoDetectAccountChange: true,
    autoVerifyQuota: true,
    autoPrepareRecovery: true,
    resumeMode: 'automatic_when_supported',
    requireNewAccountOrMinQuota: true,
    autoOpenSettings: false
  },
  expert: {
    mode: 'standard',
    godModeLifetime: 'persistent'
  },
  quota: {
    providerMode: 'auto_safe'
  },
  diagnostics: {
    showRawQuotaPayload: false
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

// Helper: load config safely
function loadConfigSafe() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
        throw new Error('Config must be an object');
      }
      const merged = deepMerge(DEFAULT_CONFIG, cfg);
      if (!merged.visuals || typeof merged.visuals !== 'object') {
        merged.visuals = {};
      }
      if (!VALID_HUD_SCOPES.includes(merged.visuals.hudScope)) {
        merged.visuals.hudScope = 'fiveHour';
      }
      if (merged.thresholds && typeof merged.thresholds === 'object') {
        const { stopPercent, stabilizePercent, warnPercent } = merged.thresholds;
        if (typeof stopPercent === 'number' && typeof stabilizePercent === 'number' && typeof warnPercent === 'number') {
          if (stopPercent >= stabilizePercent || stabilizePercent > warnPercent) {
            merged.thresholds.stopPercent = 12;
            merged.thresholds.stabilizePercent = 15;
            merged.thresholds.warnPercent = 20;
          }
        }
      }
      return merged;
    }
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function sanitizeAndRepairThresholdsPayload(thresholds) {
  const defaults = { warnPercent: 20, stabilizePercent: 15, checkpointPercent: 13, stopPercent: 12, minResumePercent: 70 };
  if (!thresholds || typeof thresholds !== 'object') return { ...defaults };

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

  if (c <= st) c = Math.min(100, st + 1);
  if (s <= c) s = Math.min(100, c + 2);
  if (w <= s) w = Math.min(100, s + 5);
  if (r <= st) r = Math.min(100, Math.max(r, st + 5));

  return { warnPercent: w, stabilizePercent: s, checkpointPercent: c, stopPercent: st, minResumePercent: r };
}

// Helper: save config safely
function saveConfigSafe(newCfg) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    let existing = {};
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      }
    } catch (_) {}
    const merged = deepMerge(deepMerge(DEFAULT_CONFIG, existing), newCfg || {});
    if (!merged.visuals || typeof merged.visuals !== 'object') {
      merged.visuals = {};
    }
    if (!VALID_HUD_SCOPES.includes(merged.visuals.hudScope)) {
      merged.visuals.hudScope = 'fiveHour';
    }
    if (merged.thresholds && typeof merged.thresholds === 'object') {
      merged.thresholds = sanitizeAndRepairThresholdsPayload(merged.thresholds);
    }
    const serialized = JSON.stringify(merged, null, 2);
    // Write atomically to config.json
    const tmpFile = `${CONFIG_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpFile, serialized, 'utf8');
    fs.renameSync(tmpFile, CONFIG_FILE);

    // Sync config.lkg.json so LKG always mirrors the latest valid saved config
    try {
      const tmpLkg = `${CONFIG_LKG_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpLkg, serialized, 'utf8');
      fs.renameSync(tmpLkg, CONFIG_LKG_FILE);
    } catch (_) {}

    return true;
  } catch (err) {
    console.error('[QuotaGuard] Failed to save config:', err);
    return false;
  }
}

// Model classification heuristic (shared)
function classifyModel(modelString) {
  if (!modelString || typeof modelString !== 'string') return null;
  const s = modelString.toLowerCase();
  if (/claude|gpt|sonnet|opus|haiku|o1|o3/.test(s)) {
    return 'claude_gpt';
  }
  if (/gemini|flash|pro/.test(s)) {
    return 'gemini';
  }
  return null;
}

// R1: Independent Dual-Bucket Usage Parsing
function parseQuotaUsage(stdout) {
  const result = {
    gemini: {
      fiveHour: null,
      weekly: null,
      resetTimeFiveHour: null,
      resetTimeWeekly: null,
      resetTime: null,
      weeklyResetTime: null
    },
    claude_gpt: {
      fiveHour: null,
      weekly: null,
      resetTimeFiveHour: null,
      resetTimeWeekly: null,
      resetTime: null,
      weeklyResetTime: null
    },
    activeModel: 'fallback',
    lastUpdated: new Date().toISOString()
  };

  if (!stdout || typeof stdout !== 'string') {
    return result;
  }

  const lines = stdout.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^quota:/i.test(line)) continue;

    let target = null;
    if (/gemini\s*models/i.test(line)) {
      target = result.gemini;
    } else if (/claude\s*(?:and|&)\s*gpt|claude/i.test(line)) {
      target = result.claude_gpt;
    }

    if (!target) continue;

    const pctMatch = line.match(/(\d+)%/);
    const pct = pctMatch ? parseInt(pctMatch[1], 10) : null;

    const timeMatch = line.match(/(\d{4}-\d{2}-\d{2}T[^\s]+)/);
    const timestamp = timeMatch ? timeMatch[1] : null;

    if (/five\s*hour/i.test(line)) {
      if (pct !== null) target.fiveHour = pct;
      if (timestamp) {
        target.resetTimeFiveHour = timestamp;
        target.resetTime = timestamp;
      }
    } else if (/weekly/i.test(line)) {
      if (pct !== null) target.weekly = pct;
      if (timestamp) {
        target.resetTimeWeekly = timestamp;
        target.weeklyResetTime = timestamp;
      }
    }
  }

  return result;
}

// Compatibility aliases
const parseUsageStdout = parseQuotaUsage;
const parseUsageOutput = parseQuotaUsage;
const parseAgyUsage = parseQuotaUsage;
const parseDualBucketUsage = parseQuotaUsage;

// Direct Connect-RPC JSON Parser for Language Server response
function parseRpcQuotaData(summaryJson, statusJson) {
  const result = {
    account_email: (statusJson && statusJson.userStatus && statusJson.userStatus.email) || 'Google Account',
    account_name: (statusJson && statusJson.userStatus && statusJson.userStatus.name) || '',
    user_tier: (statusJson && statusJson.userStatus && statusJson.userStatus.userTier && statusJson.userStatus.userTier.name) || '',
    gemini: {
      fiveHour: null,
      weekly: null,
      resetTimeFiveHour: null,
      resetTimeWeekly: null,
      resetTime: null,
      weeklyResetTime: null
    },
    claude_gpt: {
      fiveHour: null,
      weekly: null,
      resetTimeFiveHour: null,
      resetTimeWeekly: null,
      resetTime: null,
      weeklyResetTime: null
    },
    models: {},
    activeModel: 'fallback',
    lastUpdated: new Date().toISOString(),
    captured_at_epoch: Date.now() / 1000,
    bucket_id: 'gemini-5h',
    remaining_percent: null,
    remaining_fraction: null,
    weekly_percent: null,
    reset_time: null
  };

  const groups = (summaryJson && summaryJson.response && summaryJson.response.groups) || [];
  for (const group of groups) {
    const isGemini = /gemini/i.test(group.displayName || '');
    const isClaudeGpt = /claude|gpt/i.test(group.displayName || '');
    const target = isGemini ? result.gemini : (isClaudeGpt ? result.claude_gpt : null);
    if (!target) continue;

    const buckets = group.buckets || [];
    for (const b of buckets) {
      const frac = typeof b.remainingFraction === 'number'
        ? b.remainingFraction
        : (typeof b.remaining_fraction === 'number' ? b.remaining_fraction : null);
      const pct = frac !== null ? Math.round(frac * 1000) / 10 : null;
      const is5h = b.window === '5h' || /5h|five/i.test(b.bucketId || '');
      const isWeekly = b.window === 'weekly' || /week/i.test(b.bucketId || '');

      if (is5h && pct !== null) {
        target.fiveHour = pct;
        target.resetTimeFiveHour = b.resetTime || null;
        target.resetTime = b.resetTime || null;
      } else if (isWeekly && pct !== null) {
        target.weekly = pct;
        target.resetTimeWeekly = b.resetTime || null;
        target.weeklyResetTime = b.resetTime || null;
      }
    }
  }

  const clientModels = (statusJson && statusJson.userStatus && statusJson.userStatus.cascadeModelConfigData && statusJson.userStatus.cascadeModelConfigData.clientModelConfigs) || [];
  for (const m of clientModels) {
    if (m.modelId || m.label) {
      const key = (m.modelId || m.label).toLowerCase();
      const frac = m.quotaInfo && m.quotaInfo.remainingFraction;
      result.models[key] = {
        label: m.label,
        modelId: m.modelId,
        remainingPercent: typeof frac === 'number' ? Math.round(frac * 1000) / 10 : null,
        resetTime: (m.quotaInfo && m.quotaInfo.resetTime) || null
      };
    }
  }

  result.remaining_percent = result.gemini.fiveHour;
  result.remaining_fraction = typeof result.gemini.fiveHour === 'number' ? result.gemini.fiveHour / 100 : null;
  result.weekly_percent = result.gemini.weekly;
  result.reset_time = result.gemini.resetTimeFiveHour;

  return result;
}

// Discover credentials for running language_server
function getRunningLanguageServerCredentials() {
  // Method 1: Local languageServer export (Electron main process inside app.asar)
  try {
    const ls = require('./languageServer.js');
    const port = typeof ls.getLsPort === 'function' ? ls.getLsPort() : 0;
    const proc = typeof ls.getLsProcess === 'function' ? ls.getLsProcess() : null;
    let token = null;
    if (proc && Array.isArray(proc.spawnargs)) {
      const idx = proc.spawnargs.indexOf('--csrf_token');
      if (idx !== -1 && idx + 1 < proc.spawnargs.length) {
        token = proc.spawnargs[idx + 1];
      }
    }
    if (port > 0 && token) {
      return { port, token };
    }
  } catch (_) {}

  // If running inside Electron main process, NEVER block the event loop with execSync
  if (process.type === 'browser') {
    return null;
  }

  // Method 2: Process list discovery (CLI / external tools only)
  try {
    const { execSync } = require('child_process');
    const ps = execSync('ps aux | grep -i language_server | grep -v grep', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 }).toString();
    const tokenMatch = ps.match(/--csrf_token\s+([a-f0-9-]+)/i);
    const pidMatch = ps.match(/\s+(\d+)\s+.*language_server/);
    if (tokenMatch && pidMatch) {
      const token = tokenMatch[1];
      const pid = pidMatch[1];
      const lsof = execSync(`lsof -Pan -p ${pid} -i -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 }).toString();
      const portMatch = lsof.match(/:(\d+)\s+\(LISTEN\)/);
      if (portMatch) {
        return { port: parseInt(portMatch[1], 10), token };
      }
    }
  } catch (_) {}

  // Method 3: Parse ~/Library/Logs/Antigravity/main.log for port if lsof failed
  try {
    const mainLogPath = path.join(os.homedir(), 'Library', 'Logs', 'Antigravity', 'main.log');
    if (fs.existsSync(mainLogPath)) {
      const logContent = fs.readFileSync(mainLogPath, 'utf8');
      const matches = Array.from(logContent.matchAll(/Local:\s+https:\/\/127\.0\.0\.1:(\d+)\//g));
      if (matches.length > 0) {
        const lastPort = parseInt(matches[matches.length - 1][1], 10);
        return { port: lastPort, token: null };
      }
    }
  } catch (_) {}

  return null;
}

// Fetch live quota via Node HTTPS from language server
function fetchRpcQuotaNode(port, token, callback) {
  const https = require('https');
  let summaryData = null;
  let statusData = null;
  let hasError = false;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-codeium-csrf-token'] = token;

  function finish() {
    if (hasError) return;
    if (summaryData && statusData) {
      try {
        const parsed = parseRpcQuotaData(summaryData, statusData);
        callback(null, parsed);
      } catch (err) {
        hasError = true;
        callback(err);
      }
    }
  }

  const reqSummary = https.request(`https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`, {
    method: 'POST',
    headers,
    rejectUnauthorized: false,
    timeout: 3000
  }, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try { summaryData = JSON.parse(d); finish(); } catch (e) { if (!hasError) { hasError = true; callback(e); } }
    });
  });
  reqSummary.on('error', (e) => { if (!hasError) { hasError = true; callback(e); } });
  reqSummary.write('{}');
  reqSummary.end();

  const reqStatus = https.request(`https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`, {
    method: 'POST',
    headers,
    rejectUnauthorized: false,
    timeout: 3000
  }, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try { statusData = JSON.parse(d); finish(); } catch (e) { if (!hasError) { hasError = true; callback(e); } }
    });
  });
  reqStatus.on('error', (e) => { if (!hasError) { hasError = true; callback(e); } });
  reqStatus.write('{}');
  reqStatus.end();
}

// Helper: read cached quota instantly from disk (< 1ms, zero blocking)
function getCachedQuotaQuick() {
  try {
    // 1. Try reading derived runtime-state.json from V2.2 Global Coordinator
    const coordinatorStatePath = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'runtime-state.json');
    if (fs.existsSync(coordinatorStatePath)) {
      const state = JSON.parse(fs.readFileSync(coordinatorStatePath, 'utf8'));
      if (state && state.quotaHealth && state.quotaHealth.buckets) {
        const buckets = state.quotaHealth.buckets;
        const res = {
          account_email: state.accountIdentity || 'Google Account',
          gemini: {
            fiveHour: buckets['gemini-5h']?.remainingPercent ?? null,
            weekly: buckets['gemini-weekly']?.remainingPercent ?? null,
            resetTimeFiveHour: buckets['gemini-5h']?.resetTime || null,
            resetTimeWeekly: buckets['gemini-weekly']?.resetTime || null,
            resetTime: buckets['gemini-5h']?.resetTime || null,
            weeklyResetTime: buckets['gemini-weekly']?.resetTime || null
          },
          claude_gpt: {
            fiveHour: buckets['claude-5h']?.remainingPercent ?? null,
            weekly: buckets['claude-weekly']?.remainingPercent ?? null,
            resetTimeFiveHour: buckets['claude-5h']?.resetTime || null,
            resetTimeWeekly: buckets['claude-weekly']?.resetTime || null,
            resetTime: buckets['claude-5h']?.resetTime || null,
            weeklyResetTime: buckets['claude-weekly']?.resetTime || null
          },
          models: {},
          activeModel: 'fallback',
          lastUpdated: state.updatedAt || new Date().toISOString(),
          captured_at_epoch: Date.now() / 1000,
          bucket_id: 'gemini-5h',
          remaining_percent: typeof state.effectiveQuota === 'number' ? state.effectiveQuota : null,
          remaining_fraction: typeof state.effectiveQuota === 'number' ? state.effectiveQuota / 100 : null,
          weekly_percent: buckets['gemini-weekly']?.remainingPercent ?? null,
          reset_time: buckets['gemini-5h']?.resetTime || null,
          guardState: state.guardState || state.state || 'SAFE'
        };
        return res;
      }
    }

    // 2. Fall back to live_quota.json
    if (fs.existsSync(RUNTIME_DIR)) {
      const liveFile = path.join(RUNTIME_DIR, 'live_quota.json');
      if (fs.existsSync(liveFile)) {
        const d = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
        if (d && (d.gemini || typeof d.remaining_percent === 'number')) {
          normalizeCachedData(d);
          return d;
        }
      }
      const files = fs.readdirSync(RUNTIME_DIR).filter(f => f.endsWith('.json'));
      if (files.length > 0) {
        files.sort((a, b) => fs.statSync(path.join(RUNTIME_DIR, b)).mtimeMs - fs.statSync(path.join(RUNTIME_DIR, a)).mtimeMs);
        const d = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, files[0]), 'utf8'));
        if (d && (d.gemini || typeof d.remaining_percent === 'number')) {
          normalizeCachedData(d);
          return d;
        }
      }
    }
  } catch (_) {}
  return null;
}

// Helper: read latest quota from live RPC, disk cache, or query agy
function getLatestQuotaData(callback) {
  // 1. Try querying running language server directly via Connect-RPC (100% real-time, no geo-block)
  const creds = getRunningLanguageServerCredentials();
  if (creds && creds.port && creds.token) {
    fetchRpcQuotaNode(creds.port, creds.token, (err, rpcData) => {
      if (!err && rpcData) {
        try {
          if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
          const liveCacheFile = path.join(RUNTIME_DIR, 'live_quota.json');
          fs.writeFileSync(liveCacheFile, JSON.stringify(rpcData, null, 2), 'utf8');
        } catch (_) {}
        return callback(null, rpcData);
      }
      fallbackQuery();
    });
  } else {
    fallbackQuery();
  }

  function fallbackQuery() {
    let cachedData = null;
    let cacheAgeMinutes = Infinity;
    try {
      if (fs.existsSync(RUNTIME_DIR)) {
        const files = fs.readdirSync(RUNTIME_DIR).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
          files.sort((a, b) => {
            const sa = fs.statSync(path.join(RUNTIME_DIR, a)).mtimeMs;
            const sb = fs.statSync(path.join(RUNTIME_DIR, b)).mtimeMs;
            return sb - sa;
          });
          const latestFile = path.join(RUNTIME_DIR, files[0]);
          const stat = fs.statSync(latestFile);
          cacheAgeMinutes = (Date.now() - stat.mtimeMs) / (60 * 1000);
          cachedData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
        }
      }
    } catch (_) {}

    // If cache is fresh (< 3 minutes), return it immediately
    if (cachedData && cacheAgeMinutes < 3) {
      normalizeCachedData(cachedData);
      return callback(null, cachedData);
    }

    // Try agy -p "/usage" asynchronously
    const env = Object.assign({}, process.env, {
      PATH: (process.env.PATH || '') + ':' + path.join(os.homedir(), '.local', 'bin') + ':/usr/local/bin:/opt/homebrew/bin'
    });

    exec('agy -p "/usage"', { env, timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        const parsed = parseQuotaUsage(stdout);

        if (parsed.gemini.fiveHour !== null || parsed.claude_gpt.fiveHour !== null) {
          const liveResult = {
            account_email: (cachedData && cachedData.account_email) || 'Google Account',
            gemini: parsed.gemini,
            claude_gpt: parsed.claude_gpt,
            activeModel: 'fallback',
            lastUpdated: parsed.lastUpdated,
            captured_at_epoch: Date.now() / 1000,
            bucket_id: 'gemini-5h',
            remaining_percent: parsed.gemini.fiveHour !== null ? parsed.gemini.fiveHour : (parsed.claude_gpt.fiveHour !== null ? parsed.claude_gpt.fiveHour : null),
            remaining_fraction: typeof (parsed.gemini.fiveHour !== null ? parsed.gemini.fiveHour : parsed.claude_gpt.fiveHour) === 'number' ? (parsed.gemini.fiveHour !== null ? parsed.gemini.fiveHour : parsed.claude_gpt.fiveHour) / 100 : null,
            weekly_percent: parsed.gemini.weekly !== null ? parsed.gemini.weekly : (parsed.claude_gpt.weekly !== null ? parsed.claude_gpt.weekly : null),
            reset_time: parsed.gemini.resetTimeFiveHour || null
          };
          return callback(null, liveResult);
        }
      }

      if (cachedData) {
        normalizeCachedData(cachedData);
        if (cacheAgeMinutes > 15) {
          cachedData.is_stale = true;
        }
        return callback(null, cachedData);
      }

      return callback(new Error('No quota data available'));
    });
  }

  function normalizeCachedData(cd) {
    if (!cd.gemini) {
      const p = typeof cd.remaining_percent === 'number'
        ? cd.remaining_percent
        : (typeof cd.remaining_fraction === 'number' ? Math.round(cd.remaining_fraction * 100) : null);
      cd.gemini = {
        fiveHour: p,
        weekly: typeof cd.weekly_percent === 'number' ? cd.weekly_percent : null,
        resetTimeFiveHour: cd.reset_time || null,
        resetTimeWeekly: null,
        resetTime: cd.reset_time || null,
        weeklyResetTime: null
      };
    }
    if (!cd.claude_gpt) {
      cd.claude_gpt = {
        fiveHour: null,
        weekly: null,
        resetTimeFiveHour: null,
        resetTimeWeekly: null,
        resetTime: null,
        weeklyResetTime: null
      };
    }
    if (typeof cd.remaining_percent !== 'number' && typeof cd.remaining_fraction === 'number') {
      cd.remaining_percent = Math.round(cd.remaining_fraction * 1000) / 10;
    }
  }
}

// Helper: play chime sound
function playChime(soundName) {
  const name = soundName || 'Glass';
  const soundPath = `/System/Library/Sounds/${name}.aiff`;
  if (process.platform === 'darwin' && fs.existsSync(soundPath)) {
    execFile('/usr/bin/afplay', [soundPath], () => {});
  }
}

// Injected Renderer Script Generator
function getRendererInjectionCode(initialConfig, initialQuota) {
  return `
(function() {
  if (window.__QUOTA_GUARD_INITIALIZED__) return;
  window.__QUOTA_GUARD_INITIALIZED__ = true;

  let config = ${JSON.stringify(initialConfig)};
  let quota = ${JSON.stringify(initialQuota)};
  let isHandoverPanelOpen = false;
  let isHandoverPanelMinimized = false;
  let handoverDismissed = false;
  let isPendingHandoverHalting = false;
  let snapshotProgress = 0;
  let currentHandoffMarkdown = '';
  let isHandoverModalOpen = false;
  let isUserGuideModalOpen = false;
  let lastActiveModelString = '';
  let guideEscListener = null;

  function dispatchAction(action) {
    try {
      if (window.require) {
        const { ipcRenderer } = window.require('electron');
        if (ipcRenderer && typeof ipcRenderer.send === 'function') {
          ipcRenderer.send('QUOTA_GUARD_IPC', action);
        }
      }
    } catch (_) {}
    console.log('__QUOTA_GUARD_ACTION__:' + action);
  }

  function playWebAudioChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.0, now + 0.12);
      gain2.gain.setValueAtTime(0.12, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.65);
    } catch (_) {}
  }
  window.__QUOTA_GUARD_PLAY_CHIME__ = playWebAudioChime;

  // Ensure default structures exist
  if (!quota || typeof quota !== 'object') quota = {};
  if (!quota.gemini) {
    quota.gemini = {
      fiveHour: typeof quota.remaining_percent === 'number' ? quota.remaining_percent : null,
      weekly: typeof quota.weekly_percent === 'number' ? quota.weekly_percent : null,
      resetTimeFiveHour: quota.reset_time || null,
      resetTimeWeekly: null
    };
  }
  if (!quota.claude_gpt) {
    quota.claude_gpt = { fiveHour: null, weekly: null, resetTimeFiveHour: null, resetTimeWeekly: null };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  if (!config.language) config.language = 'fa';
  if (!config.thresholds || typeof config.thresholds !== 'object') {
    config.thresholds = { warnPercent: 20, stabilizePercent: 15, checkpointPercent: 13, stopPercent: 12, minResumePercent: 70 };
  }
  if (!config.visuals || typeof config.visuals !== 'object') config.visuals = {};
  if (!config.visuals.hudScope) config.visuals.hudScope = 'fiveHour';
  if (!config.visuals.badgeStyle) config.visuals.badgeStyle = 'detailed';
  if (!config.visuals.colors || typeof config.visuals.colors !== 'object') {
    config.visuals.colors = { safe: '#10b981', warn: '#d97706', critical: '#e11d48', text: '#f8fafc', background: '#0f172a' };
  }
  if (!config.audio || typeof config.audio !== 'object') {
    config.audio = { soundEnabled: true, soundName: 'Glass', desktopNotification: true };
  }

  // Helper: Model Classifier
  function classifyModel(modelString) {
    if (!modelString || typeof modelString !== 'string') return null;
    const s = modelString.toLowerCase();
    if (/claude|gpt|sonnet|opus|haiku|o1|o3/.test(s)) {
      return 'claude_gpt';
    }
    if (/gemini|flash|pro/.test(s)) {
      return 'gemini';
    }
    return null;
  }

  // Direct Connect-RPC JSON Parser for Language Server response inside renderer
  function parseRpcQuotaData(summaryJson, statusJson) {
    const res = {
      account_email: (statusJson && statusJson.userStatus && statusJson.userStatus.email) || 'Google Account',
      account_name: (statusJson && statusJson.userStatus && statusJson.userStatus.name) || '',
      user_tier: (statusJson && statusJson.userStatus && statusJson.userStatus.userTier && statusJson.userStatus.userTier.name) || '',
      gemini: { fiveHour: null, weekly: null, resetTimeFiveHour: null, resetTimeWeekly: null },
      claude_gpt: { fiveHour: null, weekly: null, resetTimeFiveHour: null, resetTimeWeekly: null },
      models: {},
      lastUpdated: new Date().toISOString()
    };
    const groups = (summaryJson && summaryJson.response && summaryJson.response.groups) || [];
    for (const group of groups) {
      const isGemini = /gemini/i.test(group.displayName || '');
      const isClaudeGpt = /claude|gpt/i.test(group.displayName || '');
      const target = isGemini ? res.gemini : (isClaudeGpt ? res.claude_gpt : null);
      if (!target) continue;
      const buckets = group.buckets || [];
      for (const b of buckets) {
        const frac = typeof b.remainingFraction === 'number' ? b.remainingFraction : null;
        const pct = frac !== null ? Math.round(frac * 1000) / 10 : null;
        const is5h = b.window === '5h' || /5h|five/i.test(b.bucketId || '');
        const isWeekly = b.window === 'weekly' || /week/i.test(b.bucketId || '');
        if (is5h && pct !== null) {
          target.fiveHour = pct;
          target.resetTimeFiveHour = b.resetTime || null;
        } else if (isWeekly && pct !== null) {
          target.weekly = pct;
          target.resetTimeWeekly = b.resetTime || null;
        }
      }
    }
    const clientModels = (statusJson && statusJson.userStatus && statusJson.userStatus.cascadeModelConfigData && statusJson.userStatus.cascadeModelConfigData.clientModelConfigs) || [];
    for (const m of clientModels) {
      if (m.modelId || m.label) {
        const key = (m.modelId || m.label).toLowerCase();
        const frac = m.quotaInfo && m.quotaInfo.remainingFraction;
        res.models[key] = {
          label: m.label,
          modelId: m.modelId,
          remainingPercent: typeof frac === 'number' ? Math.round(frac * 1000) / 10 : null,
          resetTime: (m.quotaInfo && m.quotaInfo.resetTime) || null
        };
      }
    }
    res.remaining_percent = res.gemini.fiveHour;
    res.weekly_percent = res.gemini.weekly;
    return res;
  }

  // Native In-Browser Connect-RPC Quota Fetcher
  async function fetchLiveQuotaDirect() {
    try {
      const csrf = (window.__APP_CONFIG__ && window.__APP_CONFIG__.csrfToken) || '';
      if (!csrf) return null;
      const headers = { 'Content-Type': 'application/json', 'x-codeium-csrf-token': csrf };

      const [summaryRes, statusRes] = await Promise.all([
        fetch('/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', { method: 'POST', headers, body: '{}' })
          .then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/exa.language_server_pb.LanguageServerService/GetUserStatus', { method: 'POST', headers, body: '{}' })
          .then(r => r.ok ? r.json() : null).catch(() => null)
      ]);

      if (summaryRes) {
        const live = parseRpcQuotaData(summaryRes, statusRes);
        if (live) {
          window.__QUOTA_GUARD_UPDATE__(live);
          console.log('__QUOTA_GUARD_ACTION__:SYNC_LIVE_DATA:' + JSON.stringify(live));
          return live;
        }
      }
    } catch (_) {}
    return null;
  }

  // Per-conversation active execution snapshot registry
  const activeExecutionMap = new Map();

  function getActiveConversationId() {
    const path = window.location.pathname || window.location.href || '';
    const match = path.match(new RegExp('/c/([a-zA-Z0-9_-]+)'));
    return match ? match[1] : 'root';
  }

  function isExecutionActiveInDOM() {
    // Cancel / Stop button in chat input area specifically
    const cancelBtn = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
                      document.querySelector('[data-tooltip-id*="cancel"]') ||
                      document.querySelector('button[aria-label*="Cancel ("]') ||
                      document.querySelector('button[aria-label*="Stop"]') ||
                      document.querySelector('#input-container button[aria-label*="Cancel"]') ||
                      document.querySelector('#input-container button[aria-label*="Stop"]') ||
                      document.querySelector('[data-testid*="chat-input"] button[aria-label*="Cancel"]') ||
                      document.querySelector('[data-testid*="stop-generating"]') ||
                      document.querySelector('button[aria-label*="Stop generating"]');
    if (cancelBtn && cancelBtn.offsetParent !== null) {
      return true;
    }
    return false;
  }

  // R2: Dynamic Active Model & Conversation Tracker with Active Execution Locking
  function detectActiveModel() {
    const convoId = getActiveConversationId();
    const isRunning = isExecutionActiveInDOM();

    let pickerCategory = null;
    let pickerModelName = '';

    const trigger = document.querySelector('[data-testid="model-selector-trigger"]') ||
                    document.querySelector('button[aria-label*="current:"]') ||
                    document.querySelector('button[aria-label*="Select model"]');

    if (trigger) {
      const text = trigger.textContent || '';
      const aria = trigger.getAttribute('aria-label') || '';
      
      const ariaMatch = aria.match(/current:\s*([^,]+)/i);
      if (ariaMatch && ariaMatch[1]) {
        pickerModelName = ariaMatch[1].trim();
      } else if (text.trim() && !/select\s*model/i.test(text.trim())) {
        pickerModelName = text.trim();
      } else {
        pickerModelName = aria.replace(/select\s*model,?\s*/i, '').trim();
      }

      pickerCategory = classifyModel(pickerModelName + ' ' + text + ' ' + aria);
    }

    // Handle Active Execution state transitions
    if (isRunning) {
      if (!activeExecutionMap.has(convoId)) {
        const snapModel = pickerModelName || (pickerCategory === 'gemini' ? 'Gemini' : 'Claude/GPT') || 'Gemini';
        const snapCat = pickerCategory || classifyModel(snapModel) || 'gemini';
        activeExecutionMap.set(convoId, {
          executingModel: snapModel,
          executingCategory: snapCat,
          startedAt: Date.now()
        });
      }
    } else {
      if (activeExecutionMap.has(convoId)) {
        activeExecutionMap.delete(convoId);
      }
    }

    const currentRun = activeExecutionMap.get(convoId);
    if (isRunning && currentRun) {
      return {
        category: currentRun.executingCategory,
        modelName: currentRun.executingModel,
        isExecuting: true,
        queuedModelName: pickerModelName || null,
        queuedCategory: pickerCategory || null,
        isFallback: false
      };
    }

    if (pickerCategory) {
      return {
        category: pickerCategory,
        modelName: pickerModelName || (pickerCategory === 'gemini' ? 'Gemini' : 'Claude/GPT'),
        isExecuting: false,
        queuedModelName: null,
        queuedCategory: null,
        isFallback: false
      };
    }

    // Fallback when outside active chat or on welcome states:
    // Display the lowest remaining quota across buckets (Math.min(gemini.fiveHour, claude_gpt.fiveHour))
    const g5h = (quota && quota.gemini && typeof quota.gemini.fiveHour === 'number') ? quota.gemini.fiveHour : null;
    const c5h = (quota && quota.claude_gpt && typeof quota.claude_gpt.fiveHour === 'number') ? quota.claude_gpt.fiveHour : null;

    let fallbackCategory = 'gemini';
    if (g5h !== null && c5h !== null) {
      fallbackCategory = g5h <= c5h ? 'gemini' : 'claude_gpt';
    } else if (c5h !== null) {
      fallbackCategory = 'claude_gpt';
    }
    return {
      category: fallbackCategory,
      modelName: fallbackCategory === 'gemini' ? 'Gemini (Auto-Critical)' : 'Claude/GPT (Auto-Critical)',
      isExecuting: false,
      queuedModelName: null,
      queuedCategory: null,
      isFallback: true
    };
  }

  // I18N Translations
  const i18n = {
    fa: {
      hudTitle: 'سهمیه Antigravity',
      quotaTitle: 'مدیریت سهمیه هوش مصنوعی',
      activeAccount: 'حساب فعال:',
      activeModel: 'مدل فعال:',
      geminiBucket: '🔷 مدل‌های جمینای (Gemini)',
      claudeBucket: '🟣 مدل‌های کلود و جی‌پی‌تی (Claude & GPT)',
      fiveHourRemaining: '۵ ساعته:',
      weeklyRemaining: 'هفتگی:',
      resetsIn: 'زمان بازنشانی:',
      refresh: 'به‌روزرسانی',
      checkpoints: 'چک‌پوینت‌ها',
      settings: 'تنظیمات',
      langToggle: 'English',
      // Settings
      settingsTitle: 'تنظیمات محافظ سهمیه (Quota Guard)',
      guideButton: '📖 راهنمای جامع و آموزش استفاده / User Guide',
      guideButtonSub: 'آموزش سهمیه‌ها، سوئیچ حساب در ۱۲٪ و عیب‌یابی',
      hudScopeLabel: 'محدوده نمایش در نوار عنوان (HUD Scope):',
      scopeFiveHour: '۵ ساعته (پیش‌فرض)',
      scopeWeekly: 'سقف هفتگی',
      scopeBoth: 'هر دو (۵ ساعته و هفتگی)',
      thresholdsTab: 'آستانه‌ها',
      visualsTab: 'رنگ و تم',
      audioTab: 'صدا و اعلان',
      tabThresholds: '⚙️ آستانه‌ها و سهمیه',
      tabAppearance: '🎨 ظاهر و اعلان‌ها',
      tabPrivacy: '🔒 حریم خصوصی و بازیابی',
      tabAdvanced: '🚀 تنظیمات پیشرفته و حرفه‌ای',
      checkpointThreshold: 'آستانه ثبت چک‌پوینت خودکار (%):',
      snapshotEnabled: 'فعال بودن ثبت خودکار چک‌پوینت در زمان توقف',
      includeTranscript: 'ثبت آخرین پیام‌های مکالمه در سند بازیابی',
      includeArtifacts: 'ثبت فهرست اسناد فعال در چک‌پوینت',
      maskAccount: 'پنهان‌سازی آدرس ایمیل جهت حفظ حریم خصوصی',
      openCheckpointsFolder: '📂 باز کردن پوشه چک‌پوینت‌ها',
      operatingMode: 'سطح کاربری سیستم (Operating Mode):',
      modeStandard: 'استاندارد (Standard) — محافظت پایه',
      modeAdvanced: 'پیشرفته (Advanced) — لاگ‌ها و تلمتری دقیق',
      modeGod: 'حالت خدا (God Mode) — اتوماسیون کامل و دسترسی آزاد',
      handoverMode: 'روش فرآیند تعویض حساب:',
      modeAuto: 'خودکار در صورت پشتیبانی',
      modeOneClick: 'تأیید با یک کلیک (توصیه‌شده)',
      modeManual: 'دستی کامل',
      handoverAutoOpen: 'باز کردن خودکار بخش تنظیمات حساب در زمان توقف',
      handoverAutoDetect: 'تشخیص خودکار تغییر حساب و سهمیه جدید',
      quotaProvider: 'منبع دریافت تلمتری سهمیه:',
      providerAutoSafe: 'هماهنگ‌کننده ترکیبی (Auto-Safe)',
      providerCliStatusline: 'فقط خط فرمان (CLI Statusline)',
      diagnosticsRaw: 'نمایش تلمتری خام در لاگ کنسول',
      warnThreshold: 'آستانه هشدار (Warn %):',
      stabilizeThreshold: 'آستانه تثبیت (Stabilize %):',
      stopThreshold: 'آستانه توقف تعویض حساب (Stop %):',
      resumeThreshold: 'حداقل سهمیه برای ادامه (Resume %):',
      themePreset: 'پالت رنگ:',
      colorSafe: 'رنگ وضعیت امن:',
      colorWarn: 'رنگ هشدار:',
      colorCrit: 'رنگ توقف بحرانی:',
      soundToggle: 'پخش صدای هشدار در زمان توقف',
      soundChoice: 'نوع صدای زنگ:',
      testSound: 'تست صدا',
      notifyToggle: 'نمایش اعلان دسکتاپ',
      save: 'ذخیره تنظیمات',
      cancel: 'انصراف',
      reset: 'بازگشت به کارخانه',
      // Handover Modal & Floating Warning Panel (R2)
      handoverTitle: '⚠️ سهمیه به پایان نزدیک شد (آستانه توقف)',
      handoverDesc: 'جهت جلوگیری از قطع ناگهانی و از دست رفتن پیوستگی مکالمه، کار متوقف شد و چک‌پوینت امن در حال ذخیره‌سازی است. لطفاً پس از تکمیل، حساب گوگل خود را تعویض نمایید.',
      openSettings: 'تنظیمات حساب Antigravity',
      verifyResume: 'بررسی سلامت حساب و ادامه کار',
      checkingQuota: 'در حال بررسی سهمیه حساب جدید...',
      copyHandoff: 'کپی سند بازیابی',
      copiedHandoff: 'سند بازیابی در کلیپ‌بورد کپی شد!',
      dismiss: 'رد کردن',
      minimize: 'کوچک‌سازی',
      restore: 'بزرگ‌نمایی',
      snapshotPhase1: 'در حال جمع‌آوری متادیتای جلسه...',
      quotaLow: 'سهمیه بحرانی',
      switchSuccess: 'حساب با موفقیت تعویض شد! در حال ادامه...',
      // Active Execution Lock Tags
      activeRunningTag: '⚡ در حال پردازش',
      queuedNextTag: '📌 آماده برای پیام بعدی',
      // Guide Tabs
      guideTitle: '📖 راهنمای جامع و آموزش استفاده از محافظ سهمیه',
      tabQuotas: 'سهمیه‌ها و محدودیت‌ها',
      tabHandover: 'تعویض حساب در ۱۲٪',
      tabSettings: 'تنظیمات و شخصی‌سازی',
      tabFaq: 'پرسش‌های متداول و دستورات',
      close: 'بستن'
    },
    en: {
      hudTitle: 'Antigravity Quota',
      quotaTitle: 'AI Quota Monitor',
      activeAccount: 'Active Account:',
      activeModel: 'Active Model:',
      geminiBucket: '🔷 Gemini Models',
      claudeBucket: '🟣 Claude & GPT Models',
      fiveHourRemaining: '5-Hour Limit:',
      weeklyRemaining: 'Weekly Limit:',
      resetsIn: 'Resets in:',
      refresh: 'Refresh',
      checkpoints: 'Checkpoints',
      settings: 'Settings',
      langToggle: 'فارسی',
      // Settings
      settingsTitle: 'Quota Guard Settings',
      guideButton: '📖 User Guide & Manual / راهنمای جامع',
      guideButtonSub: 'Quota mechanics, 12% handover & troubleshooting',
      hudScopeLabel: 'Titlebar HUD Metric Scope:',
      scopeFiveHour: '5-Hour (Default)',
      scopeWeekly: 'Weekly Limit',
      scopeBoth: 'Both (5-Hour & Weekly)',
      thresholdsTab: 'Thresholds',
      visualsTab: 'Themes & Colors',
      audioTab: 'Audio & Alerts',
      tabThresholds: '⚙️ Thresholds & Quota',
      tabAppearance: '🎨 Appearance & Alerts',
      tabPrivacy: '🔒 Privacy & Snapshot',
      tabAdvanced: '🚀 Advanced & Expert',
      checkpointThreshold: 'Silent Checkpoint Threshold (%):',
      snapshotEnabled: 'Enable automatic checkpoints on stop',
      includeTranscript: 'Include recent dialogue in recovery document',
      includeArtifacts: 'Include active workspace artifacts',
      maskAccount: 'Mask account email for privacy',
      openCheckpointsFolder: '📂 Open Checkpoints Directory',
      operatingMode: 'System Operating Mode:',
      modeStandard: 'Standard — Baseline safety protection',
      modeAdvanced: 'Advanced — Detailed telemetry & logs',
      modeGod: 'God Mode — Full UI automation capabilities',
      handoverMode: 'Account Handover Strategy:',
      modeAuto: 'Automatic when supported',
      modeOneClick: 'One-Click reviewed (Recommended)',
      modeManual: 'Full manual',
      handoverAutoOpen: 'Auto-open account flow on stop',
      handoverAutoDetect: 'Auto-detect account change & quota',
      quotaProvider: 'Quota Telemetry Provider:',
      providerAutoSafe: 'Hybrid Coordinator (Auto-Safe)',
      providerCliStatusline: 'CLI Statusline Only',
      diagnosticsRaw: 'Show raw telemetry in console logs',
      warnThreshold: 'Warning Threshold (%):',
      stabilizeThreshold: 'Stabilize Threshold (%):',
      stopThreshold: 'Account Switch Stop Threshold (%):',
      resumeThreshold: 'Min Quota to Resume (%):',
      themePreset: 'Color Preset:',
      colorSafe: 'Safe Color:',
      colorWarn: 'Warning Color:',
      colorCrit: 'Critical Color:',
      soundToggle: 'Play alert sound on handover stop',
      soundChoice: 'Alert Sound:',
      testSound: 'Test Sound',
      notifyToggle: 'Show desktop notification',
      save: 'Save Settings',
      cancel: 'Cancel',
      reset: 'Reset to Defaults',
      // Handover Modal & Floating Warning Panel (R2)
      handoverTitle: '⚠️ Quota Safety Threshold Reached',
      handoverDesc: 'To prevent sudden cutoff and context loss, execution was paused and a durable recovery checkpoint is being saved. Please switch your Google Account once complete.',
      openSettings: 'Open Antigravity Account Settings',
      verifyResume: 'Verify & Resume Execution',
      checkingQuota: 'Checking new account quota...',
      copyHandoff: 'Copy Recovery Document',
      copiedHandoff: 'Recovery Document Copied!',
      dismiss: 'Dismiss',
      minimize: 'Minimize',
      restore: 'Restore',
      snapshotPhase1: 'Collecting session metadata...',
      quotaLow: 'Quota Low',
      switchSuccess: 'Account switched successfully! Resuming...',
      // Active Execution Lock Tags
      activeRunningTag: '⚡ Processing',
      queuedNextTag: '📌 Queued for Next',
      // Guide Tabs
      guideTitle: '📖 Quota Guard Comprehensive User Guide',
      tabQuotas: 'AI Quotas Explained',
      tabHandover: '12% Handover Protocol',
      tabSettings: 'Settings Guide',
      tabFaq: 'FAQ & Commands',
      close: 'Close'
    }
  };

  function t(key) {
    const lang = config.language || 'fa';
    return (i18n[lang] && i18n[lang][key]) || (i18n.en && i18n.en[key]) || key;
  }

  // Inject Styles
  const styleEl = document.createElement('style');
  styleEl.id = '__quota_guard_styles';
  styleEl.textContent = \`
    #qg-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 24px;
      padding: 0 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s ease, border-color 0.15s ease;
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "IRANYekanX", "Segoe UI", Roboto, sans-serif;
      white-space: nowrap;
      margin: 0 4px;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
    }
    #qg-badge:hover {
      background: #334155;
      border-color: rgba(255, 255, 255, 0.28);
    }
    .qg-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
      transition: background-color 0.3s ease;
      flex-shrink: 0;
    }
    @keyframes qg-pulse {
      0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    .qg-dot.pulsing {
      animation: qg-pulse 1.8s infinite cubic-bezier(0.4, 0, 0.6, 1);
    }
    .qg-tag-running {
      font-size: 10px;
      font-weight: 700;
      color: #10b981;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 9999px;
      padding: 2px 7px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .qg-tag-queued {
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
      background: rgba(148, 163, 184, 0.1);
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 9999px;
      padding: 2px 7px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    /* Popover */
    #qg-popover {
      position: fixed;
      top: 40px;
      right: 20px;
      width: 340px;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.7);
      padding: 14px;
      color: #f1f5f9;
      font-family: "IRANYekanX", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      z-index: 100000;
      display: none;
      backdrop-filter: blur(14px);
    }
    #qg-popover[dir="rtl"] {
      direction: rtl;
      text-align: right;
    }
    #qg-popover[dir="rtl"] .qg-header {
      flex-direction: row;
    }
    #qg-popover[dir="rtl"] .qg-actions {
      flex-direction: row;
    }
    #qg-popover[dir="rtl"] .qg-bar-fill {
      margin-left: auto;
      margin-right: 0;
    }
    #qg-popover.open { display: block; }
    .qg-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .qg-bucket-card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .qg-bucket-card.active-bucket {
      border-color: rgba(59, 130, 246, 0.5);
      background: rgba(59, 130, 246, 0.06);
    }
    .qg-bar-container { background: rgba(255,255,255,0.08); border-radius: 6px; height: 6px; overflow: hidden; margin: 4px 0 8px; }
    .qg-bar-fill { height: 100%; border-radius: 6px; transition: width 0.4s ease; }
    .qg-actions { display: flex; gap: 6px; margin-top: 12px; }
    .qg-btn {
      flex: 1;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.06);
      color: #f8fafc;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.2s;
      font-family: inherit;
    }
    .qg-btn:hover { background: rgba(255, 255, 255, 0.14); }
    .qg-btn-primary { background: #3b82f6; border-color: #3b82f6; }
    .qg-btn-primary:hover { background: #2563eb; }
    
    /* Guide Button in Settings */
    .qg-btn-guide {
      width: 100%;
      margin: 10px 0 14px;
      padding: 10px 14px;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(99, 102, 241, 0.18));
      border: 1px solid rgba(59, 130, 246, 0.45);
      border-radius: 8px;
      color: #93c5fd;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      transition: all 0.2s ease;
    }
    .qg-btn-guide:hover {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(99, 102, 241, 0.3));
      border-color: rgba(59, 130, 246, 0.7);
      color: #ffffff;
      transform: translateY(-1px);
    }
    .qg-btn-guide-sub {
      font-size: 10px;
      opacity: 0.75;
      font-weight: normal;
    }

    /* Floating Handover Warning Panel (R2 Non-blocking) */
    #qg-handover-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 420px;
      max-width: calc(100vw - 40px);
      z-index: 99999;
      background: #0f172a;
      border: 1px solid rgba(239, 68, 68, 0.45);
      border-radius: 12px;
      box-shadow: 0 16px 45px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(239, 68, 68, 0.2);
      color: #f8fafc;
      font-family: "IRANYekanX", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 16px;
      box-sizing: border-box;
      pointer-events: auto;
      transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                  height 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                  border-radius 0.25s,
                  box-shadow 0.25s;
    }
    #qg-handover-panel[dir="rtl"] {
      right: auto;
      left: 20px;
      direction: rtl;
      text-align: right;
    }

    /* Minimized Status Pill (42px) */
    #qg-handover-panel.minimized {
      width: auto !important;
      min-width: 260px;
      height: 42px !important;
      padding: 0 14px !important;
      border-radius: 21px !important;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-color: rgba(239, 68, 68, 0.6);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 12px rgba(239, 68, 68, 0.25);
    }
    #qg-handover-panel.minimized .qg-panel-full-content {
      display: none !important;
    }
    #qg-handover-panel.minimized .qg-panel-minimized-bar {
      display: flex !important;
      width: 100%;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .qg-pill-info {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
    }
    .qg-pill-progress {
      font-size: 11px;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      padding: 2px 6px;
      border-radius: 10px;
    }
    .qg-pill-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Window Controls */
    .qg-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .qg-panel-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .qg-panel-title {
      margin: 0;
      color: #ef4444;
      font-size: 14px;
      font-weight: 700;
    }
    .qg-panel-ctrl-btn {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #94a3b8;
      border-radius: 4px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 11px;
      line-height: 1;
      padding: 0;
      transition: all 0.15s;
    }
    .qg-panel-ctrl-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.3);
    }

    .qg-panel-desc {
      font-size: 11.5px;
      line-height: 1.5;
      opacity: 0.88;
      margin: 0 0 12px;
    }
    .qg-panel-meta-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 12px;
      font-size: 11px;
    }
    .qg-meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .qg-meta-row:last-child {
      margin-bottom: 0;
    }

    /* Progress Track & Fill */
    .qg-snapshot-progress-section {
      margin-bottom: 14px;
    }
    .qg-progress-labels {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      margin-bottom: 6px;
    }
    .qg-progress-track {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    .qg-progress-fill {
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #10b981);
      transition: width 0.35s ease;
    }

    /* Action Button Stack */
    .qg-panel-action-stack {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .qg-btn-copy {
      background: rgba(59, 130, 246, 0.18);
      border: 1px solid #3b82f6;
      color: #60a5fa;
      font-weight: 600;
    }
    .qg-btn-copy:hover {
      background: rgba(59, 130, 246, 0.3);
    }
    .qg-btn-dismiss {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #94a3b8;
      font-size: 11px;
    }
    .qg-btn-dismiss:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #f8fafc;
    }
    .qg-panel-resume-msg {
      margin-top: 8px;
      font-size: 11px;
      text-align: center;
      color: #94a3b8;
    }
    .qg-pulse-dot {
      animation: qg-pulse 1.2s infinite ease-in-out;
    }

    /* Modal Backdrop */
    .qg-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(5px);
      z-index: 100001;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qg-modal {
      width: 560px;
      max-width: 92vw;
      max-height: 88vh;
      overflow-y: auto;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.8);
      padding: 20px;
      color: #f8fafc;
      font-family: "IRANYekanX", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .qg-modal[dir="rtl"] {
      direction: rtl;
      text-align: right;
    }
    .qg-settings-tabs {
      display: flex;
      gap: 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      margin-bottom: 16px;
      padding-bottom: 8px;
      overflow-x: auto;
    }
    .qg-settings-tab {
      padding: 6px 11px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
    }
    .qg-settings-tab:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    .qg-settings-tab.active {
      background: #3b82f6;
      border-color: #3b82f6;
      color: #ffffff;
      font-weight: 600;
    }
    .qg-tab-panel {
      display: none;
    }
    .qg-tab-panel.active {
      display: block;
    }
    .qg-select-control {
      width: 100%;
      background: #1e293b;
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      outline: none;
    }
    .qg-checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      cursor: pointer;
      margin-bottom: 8px;
      user-select: none;
    }
    .qg-field { margin-bottom: 14px; }
    .qg-field label { display: block; font-size: 12px; margin-bottom: 5px; opacity: 0.9; }
    .qg-slider-row { display: flex; align-items: center; gap: 10px; }
    .qg-slider { flex: 1; accent-color: #3b82f6; cursor: pointer; direction: ltr; }
    .qg-val { width: 45px; text-align: center; font-size: 12px; font-weight: bold; background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; }

    /* Segmented Scope Controls */
    .qg-segmented-row {
      display: flex;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 3px;
      gap: 4px;
    }
    .qg-segmented-btn {
      flex: 1;
      padding: 6px 4px;
      font-size: 11px;
      border: none;
      background: transparent;
      color: #94a3b8;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
    }
    .qg-segmented-btn.active {
      background: #3b82f6;
      color: #ffffff;
      font-weight: 600;
      box-shadow: 0 2px 6px rgba(59, 130, 246, 0.4);
    }

    /* Guide Modal */
    .qg-guide-modal {
      width: 660px;
      max-width: 95vw;
      max-height: 86vh;
      overflow-y: auto;
      background: #0b1120;
      border: 1px solid rgba(59, 130, 246, 0.35);
      border-radius: 14px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.9);
      padding: 22px;
      color: #e2e8f0;
      font-family: "IRANYekanX", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.7;
    }
    .qg-guide-modal[dir="rtl"] {
      direction: rtl;
      text-align: right;
    }
    .qg-guide-modal[dir="rtl"] .qg-guide-tabs {
      flex-direction: row;
    }
    .qg-guide-tabs {
      display: flex;
      gap: 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      margin-bottom: 16px;
      padding-bottom: 8px;
      overflow-x: auto;
    }
    .qg-guide-tab {
      padding: 7px 12px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
      font-family: inherit;
    }
    .qg-guide-tab:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #f1f5f9;
    }
    .qg-guide-tab.active {
      background: rgba(59, 130, 246, 0.22);
      border-color: rgba(59, 130, 246, 0.6);
      color: #60a5fa;
      font-weight: 600;
    }
    .qg-guide-content h4 {
      margin: 12px 0 6px;
      color: #60a5fa;
      font-size: 13px;
    }
    .qg-guide-content p, .qg-guide-content li {
      font-size: 12px;
      color: #cbd5e1;
    }
    .qg-guide-content code {
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
      color: #f472b6;
    }
    .qg-guide-content ol, .qg-guide-content ul {
      padding-inline-start: 20px;
      margin: 6px 0 12px;
    }
    .qg-card-callout {
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.25);
      border-radius: 8px;
      padding: 10px 14px;
      margin: 10px 0;
      font-size: 11px;
    }
  \`;
  document.head.appendChild(styleEl);

  // Create HUD Badge
  const badge = document.createElement('div');
  badge.id = 'qg-badge';
  badge.innerHTML = \`<span class="qg-dot" id="qg-dot"></span><span id="qg-text">🛡️ QS: --%</span>\`;
  
  // Create Popover
  const popover = document.createElement('div');
  popover.id = 'qg-popover';
  document.body.appendChild(popover);

  function getStatusColor(percent) {
    const c = config.visuals.colors || { safe: '#10b981', warn: '#d97706', critical: '#e11d48' };
    const th = config.thresholds || { stopPercent: 12, warnPercent: 20 };
    if (percent === null || percent === undefined) return '#94a3b8';
    if (percent <= th.stopPercent) return c.critical;
    if (percent <= th.warnPercent) return c.warn;
    return c.safe;
  }

  // Format Badge Text based on Scope, Style & Active Execution
  function formatBadgeText(fiveHour, weekly, activeBucketName, isExecuting) {
    const scope = (config.visuals && config.visuals.hudScope) || 'fiveHour';
    const style = (config.visuals && config.visuals.badgeStyle) || 'detailed';

    const fRound = typeof fiveHour === 'number' ? Math.round(fiveHour) + '%' : '--%';
    const wRound = typeof weekly === 'number' ? Math.round(weekly) + '%' : '--%';

    if (style === 'compact') {
      if (scope === 'weekly') return '🛡️ ' + (isExecuting ? '⚡ ' : '') + (typeof weekly === 'number' ? Math.round(weekly) + '%W' : '--%W');
      if (scope === 'both') return '🛡️ ' + (isExecuting ? '⚡ ' : '') + fRound + ' · ' + wRound;
      return '🛡️ ' + (isExecuting ? '⚡ ' : '') + fRound;
    }

    // Detailed style
    const shortName = (activeBucketName || '').replace(/\s*\(.*\)/, '').trim();
    const tagPrefix = isExecuting ? (' [' + shortName + ' ⚡]') : '';

    if (scope === 'weekly') {
      return '🛡️ QS' + (isExecuting ? tagPrefix : ' [W]') + ': ' + wRound;
    }
    if (scope === 'both') {
      return '🛡️ QS' + tagPrefix + ': ' + fRound + ' | W: ' + wRound;
    }
    return '🛡️ QS' + tagPrefix + ': ' + fRound;
  }

  // Render Popover Content with Both Isolated Buckets (only when opened)
  function renderPopoverContent() {
    const lang = config.language || 'fa';
    const isFa = lang === 'fa';
    popover.setAttribute('dir', isFa ? 'rtl' : 'ltr');
    popover.style.direction = isFa ? 'rtl' : 'ltr';
    popover.style.textAlign = isFa ? 'right' : 'left';

    const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const fmtPct = (val) => {
      if (val === null || val === undefined || isNaN(val)) return '--%';
      const r = Math.round(val);
      if (!isFa) return r + '%';
      return String(r).replace(/[0-9]/g, d => faDigits[+d]) + '٪';
    };

    const modelInfo = detectActiveModel();
    const gBucket = (quota && quota.gemini) || { fiveHour: null, weekly: null, resetTimeFiveHour: null };
    const cBucket = (quota && quota.claude_gpt) || { fiveHour: null, weekly: null, resetTimeFiveHour: null };

    const g5 = typeof gBucket.fiveHour === 'number' ? gBucket.fiveHour : null;
    const gW = typeof gBucket.weekly === 'number' ? gBucket.weekly : null;
    const c5 = typeof cBucket.fiveHour === 'number' ? cBucket.fiveHour : null;
    const cW = typeof cBucket.weekly === 'number' ? cBucket.weekly : null;

    let geminiStatusBadge = '';
    if (modelInfo.category === 'gemini') {
      if (modelInfo.isExecuting) {
        geminiStatusBadge = '<span class=\"qg-tag-running\">' + t('activeRunningTag') + '</span>';
      } else {
        geminiStatusBadge = '<span style=\"color:#60a5fa; font-size:10px;\">● ' + t('activeModel') + '</span>';
      }
    } else if (modelInfo.isExecuting && modelInfo.queuedCategory === 'gemini') {
      geminiStatusBadge = '<span class=\"qg-tag-queued\">' + t('queuedNextTag') + '</span>';
    }

    let claudeStatusBadge = '';
    if (modelInfo.category === 'claude_gpt') {
      if (modelInfo.isExecuting) {
        claudeStatusBadge = '<span class=\"qg-tag-running\">' + t('activeRunningTag') + '</span>';
      } else {
        claudeStatusBadge = '<span style=\"color:#a855f7; font-size:10px;\">● ' + t('activeModel') + '</span>';
      }
    } else if (modelInfo.isExecuting && modelInfo.queuedCategory === 'claude_gpt') {
      claudeStatusBadge = '<span class=\"qg-tag-queued\">' + t('queuedNextTag') + '</span>';
    }

    popover.innerHTML = \`
      <div class="qg-header">
        <strong style="font-size: 13px;">🛡️ \${t('quotaTitle')}</strong>
        <div style="display: flex; gap: 4px; align-items: center;">
          <span style="font-size: 10px; background: rgba(59,130,246,0.2); color: #93c5fd; padding: 2px 6px; border-radius: 4px;">
            \${modelInfo.modelName}\${modelInfo.isExecuting ? ' ⚡' : ''}
          </span>
          \${modelInfo.isExecuting && modelInfo.queuedModelName && modelInfo.queuedModelName !== modelInfo.modelName ? \`
            <span style="font-size: 10px; background: rgba(148,163,184,0.15); color: #94a3b8; padding: 2px 6px; border-radius: 4px;">
              ↳ \${modelInfo.queuedModelName}
            </span>
          \` : ''}
        </div>
      </div>
      <div style="font-size: 11px; margin-bottom: 8px; opacity: 0.85;">
        \${t('activeAccount')} <strong>\${(quota && quota.account_email) || 'Google'}</strong>
      </div>

      <!-- Gemini Bucket -->
      <div class="qg-bucket-card \${modelInfo.category === 'gemini' ? 'active-bucket' : ''}">
        <div style="font-size: 11px; font-weight: 600; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>\${t('geminiBucket')}</span>
          \${geminiStatusBadge}
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.9;">
          <span>\${t('fiveHourRemaining')}</span>
          <strong>\${fmtPct(g5)}</strong>
        </div>
        <div class="qg-bar-container">
          <div class="qg-bar-fill" style="width: \${g5}%; background-color: \${getStatusColor(g5)};"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.9;">
          <span>\${t('weeklyRemaining')}</span>
          <strong>\${fmtPct(gW)}</strong>
        </div>
        <div class="qg-bar-container">
          <div class="qg-bar-fill" style="width: \${gW}%; background-color: #3b82f6;"></div>
        </div>
        \${gBucket.resetTimeFiveHour ? '<div style=\"font-size:9px; opacity:0.7;\">' + t('resetsIn') + ' ' + gBucket.resetTimeFiveHour + '</div>' : ''}
      </div>

      <!-- Claude & GPT Bucket -->
      <div class="qg-bucket-card \${modelInfo.category === 'claude_gpt' ? 'active-bucket' : ''}">
        <div style="font-size: 11px; font-weight: 600; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
          <span>\${t('claudeBucket')}</span>
          \${claudeStatusBadge}
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.9;">
          <span>\${t('fiveHourRemaining')}</span>
          <strong>\${fmtPct(c5)}</strong>
        </div>
        <div class="qg-bar-container">
          <div class="qg-bar-fill" style="width: \${c5}%; background-color: \${getStatusColor(c5)};"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; opacity:0.9;">
          <span>\${t('weeklyRemaining')}</span>
          <strong>\${fmtPct(cW)}</strong>
        </div>
        <div class="qg-bar-container">
          <div class="qg-bar-fill" style="width: \${cW}%; background-color: #a855f7;"></div>
        </div>
        \${cBucket.resetTimeFiveHour ? '<div style=\"font-size:9px; opacity:0.7;\">' + t('resetsIn') + ' ' + cBucket.resetTimeFiveHour + '</div>' : ''}
      </div>

      <div class="qg-actions">
        <button class="qg-btn" id="qg-btn-refresh">🔄 \${t('refresh')}</button>
        <button class="qg-btn" id="qg-btn-checkpoints">📁 \${t('checkpoints')}</button>
        <button class="qg-btn" id="qg-btn-settings">⚙️ \${t('settings')}</button>
      </div>
    \`;

    // Hook popover buttons
    document.getElementById('qg-btn-refresh')?.addEventListener('click', (e) => {
      e.stopPropagation();
      fetchLiveQuotaDirect();
      console.log('__QUOTA_GUARD_ACTION__:CHECK_QUOTA');
    });
    document.getElementById('qg-btn-checkpoints')?.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('__QUOTA_GUARD_ACTION__:OPEN_CHECKPOINTS_DIR');
    });
    document.getElementById('qg-btn-settings')?.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.classList.remove('open');
      openSettingsModal();
    });
  }

  // Update HUD Badge & Popover (fast, non-destructive)
  function updateHUD() {
    const modelInfo = detectActiveModel();
    lastActiveModelString = modelInfo.modelName;

    const gBucket = (quota && quota.gemini) || { fiveHour: null, weekly: null, resetTimeFiveHour: null };
    const cBucket = (quota && quota.claude_gpt) || { fiveHour: null, weekly: null, resetTimeFiveHour: null };

    const activeBucket = modelInfo.category === 'claude_gpt' ? cBucket : gBucket;

    const fiveHour = typeof activeBucket.fiveHour === 'number' ? activeBucket.fiveHour : null;
    const weekly = typeof activeBucket.weekly === 'number' ? activeBucket.weekly : null;

    // Determine critical threshold in scope for dot color
    const scope = (config.visuals && config.visuals.hudScope) || 'fiveHour';
    let criticalPct = fiveHour;
    if (scope === 'weekly') {
      criticalPct = weekly;
    } else if (scope === 'both') {
      if (fiveHour !== null && weekly !== null) {
        criticalPct = Math.min(fiveHour, weekly);
      } else {
        criticalPct = fiveHour ?? weekly ?? null;
      }
    }

    // 1. Quota Recovery check (clears dismissal lock & pending halt)
    if (typeof criticalPct === 'number' && criticalPct > config.thresholds.stopPercent) {
      handoverDismissed = false;
      isPendingHandoverHalting = false;
    }

    const dot = document.getElementById('qg-dot');
    const txt = document.getElementById('qg-text');
    if (dot) {
      const color = getStatusColor(criticalPct);
      if (dot.style.backgroundColor !== color) dot.style.backgroundColor = color;
      dot.classList.toggle('pulsing', !!modelInfo.isExecuting);
    }
    if (txt) {
      const newBadgeText = formatBadgeText(fiveHour, weekly, modelInfo.modelName, modelInfo.isExecuting);
      if (txt.textContent !== newBadgeText) txt.textContent = newBadgeText;
    }

    // Only update popover DOM if it is open!
    if (popover && popover.classList.contains('open')) {
      renderPopoverContent();
    }

    // R3 Turn Boundary Halting Protocol & R2 Floating Warning Panel
    if (typeof criticalPct === 'number' && criticalPct <= config.thresholds.stopPercent) {
      if (!handoverDismissed && !isHandoverPanelOpen) {
        const isExecuting = isExecutionActiveInDOM();
        if (isExecuting) {
          // Do NOT interrupt mid-turn! Defer until turn concludes.
          isPendingHandoverHalting = true;
        } else {
          // Clean turn boundary reached (or was idle): trigger safe handover
          isPendingHandoverHalting = false;
          openHandoverPanel();
        }
      }
    }
  }

  // Helper: Position Popover directly below badge
  function positionPopover() {
    const rect = badge.getBoundingClientRect();
    if (rect && rect.bottom > 0) {
      popover.style.top = (rect.bottom + 6) + 'px';
      const popoverWidth = 340;
      const rightMargin = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, window.innerWidth - rect.right));
      popover.style.right = rightMargin + 'px';
      popover.style.left = 'auto';
    }
  }

  // Toggle popover
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !popover.classList.contains('open');
    if (willOpen) {
      positionPopover();
      renderPopoverContent();
    }
    popover.classList.toggle('open');
  });
  document.addEventListener('click', () => popover.classList.remove('open'));
  popover.addEventListener('click', (e) => e.stopPropagation());

  // Locate the native Antigravity titlebar action container
  function findTitlebarTarget() {
    // Helper to strictly exclude floating overlays or auxiliary pane elements
    function isSafeTitlebarElement(el) {
      if (!el) return false;
      if (el.closest('.absolute.right-0') ||
          el.closest('[data-aux-pane-open]') ||
          el.closest('.aux-pane') ||
          (el.style && el.style.position === 'absolute' && el.style.right === '0px')) {
        return false;
      }
      return true;
    }

    // 1. Primary Target: The native Antigravity main titlebar header row
    const mainTitlebar = document.querySelector('.flex.w-full.min-w-0.select-none.items-center.justify-between');
    if (mainTitlebar) {
      const rightRow = mainTitlebar.querySelector('.flex.items-center.justify-end > div');
      if (rightRow && isSafeTitlebarElement(rightRow)) {
        const anchor = rightRow.querySelector('[data-testid="titlebar-more-actions"]') ||
                       document.getElementById('rtl-topbar-wrapper') ||
                       rightRow.firstChild;
        return { container: rightRow, insertBefore: anchor };
      }
    }

    // 2. Direct lookup of known action buttons in the main titlebar (NOT in floating overlays)
    const candidates = [
      document.querySelector('[data-testid="titlebar-more-actions"]'),
      document.getElementById('rtl-topbar-wrapper'),
      document.querySelector('[data-testid="open-editor-multi"]'),
      document.querySelector('[data-testid="open-in-cider"]'),
      document.querySelector('[data-testid="app-update-button"]')
    ];
    for (const btn of candidates) {
      if (btn && btn.parentElement && isSafeTitlebarElement(btn.parentElement)) {
        return { container: btn.parentElement, insertBefore: btn };
      }
    }

    // 3. Fallback: Title menu bar (Windows / Linux)
    const menuBar = document.querySelector('[data-testid="title-menu-bar"]');
    if (menuBar && isSafeTitlebarElement(menuBar)) {
      return { container: menuBar, insertBefore: null };
    }

    // 4. Fallback: Any top-level header or titlebar container (safe only)
    const header = document.querySelector('.titlebar') || document.querySelector('header');
    if (header && isSafeTitlebarElement(header)) {
      return { container: header, insertBefore: null };
    }

    return null;
  }

  // Mount Badge seamlessly inside native Titlebar flex row
  function mountBadge() {
    const target = findTitlebarTarget();
    const existing = document.getElementById('qg-badge');

    if (target && target.container) {
      const { container, insertBefore } = target;
      if (existing && existing.parentElement === container) {
        return; // Already cleanly mounted inside the titlebar flex row
      }

      // Reset any legacy fixed styles
      badge.style.position = '';
      badge.style.top = '';
      badge.style.right = '';
      badge.style.zIndex = '';

      if (insertBefore && insertBefore.parentElement === container) {
        container.insertBefore(badge, insertBefore);
      } else {
        container.appendChild(badge);
      }
      updateHUD();
      return;
    }

    // If titlebar hasn't hydrated yet, do NOT dump on body with position:fixed!
    // Simply wait for the next event loop check when the titlebar mounts.
  }

  // R4: In-App Interactive Bilingual User Guide Modal
  function openUserGuideModal() {
    const existing = document.getElementById('qg-guide-modal');
    if (existing) existing.remove();
    if (guideEscListener) {
      window.removeEventListener('keydown', guideEscListener);
      guideEscListener = null;
    }

    isUserGuideModalOpen = true;

    const backdrop = document.createElement('div');
    backdrop.id = 'qg-guide-modal';
    backdrop.className = 'qg-modal-backdrop';
    backdrop.style.zIndex = '100005';

    const lang = config.language || 'fa';
    const isFa = lang === 'fa';

    backdrop.innerHTML = \`
      <div class="qg-guide-modal" dir="\${isFa ? 'rtl' : 'ltr'}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;">
          <h3 style="margin:0; font-size:14px; color:#60a5fa; display:flex; align-items:center; gap:8px;">
            \${t('guideTitle')}
          </h3>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="qg-btn" id="qg-guide-lang-toggle" style="padding:2px 8px; font-size:11px;">\${t('langToggle')}</button>
            <button class="qg-btn" id="qg-guide-close" style="padding:2px 8px; font-size:12px; color:#ef4444;">✕</button>
          </div>
        </div>

        <!-- 4 Tabs Navigation -->
        <div class="qg-guide-tabs">
          <button class="qg-guide-tab active" data-tab="0">📊 \${t('tabQuotas')}</button>
          <button class="qg-guide-tab" data-tab="1">🔄 \${t('tabHandover')}</button>
          <button class="qg-guide-tab" data-tab="2">⚙️ \${t('tabSettings')}</button>
          <button class="qg-guide-tab" data-tab="3">❓ \${t('tabFaq')}</button>
        </div>

        <!-- Tab 0: Quotas Explained -->
        <div class="qg-guide-panel" id="qg-panel-0" style="display:block;">
          \${isFa ? \`
            <h4>۱. سازوکار پنجره متحرک ۵ ساعته (Rolling 5-Hour Window)</h4>
            <p>سهمیه مدل‌ها در Antigravity به صورت یک پنجره متحرک ۵ ساعته بازنشانی می‌شود. هر توکنی که مصرف می‌شود، دقیقاً ۵ ساعت بعد آزاد شده و به مخزن سهمیه شما بازمی‌گردد. زمان <code>Resets In</code> نزدیک‌ترین زمان آزادسازی توکن‌های مصرف‌شده را نشان می‌دهد.</p>
            
            <h4>۲. سقف هفتگی مصرف (Weekly Limit)</h4>
            <p>علاوه بر پنجره ۵ ساعته، حسابتان یک سقف مصرف هفتگی دارد که در دوره‌های ۷ روزه تقویمی محاسبه می‌شود. در صورت پر شدن سقف هفتگی، استفاده از مدل تا موعد هفتگی قفل خواهد شد.</p>

            <h4>۳. تفکیک مستقل سبدهای مدل (Isolated Model Buckets)</h4>
            <ul>
              <li><strong>سبد مدل‌های جمینای (Gemini Models):</strong> شامل Gemini 3.8 Flash و Gemini 3.5 Pro با سهمیه اختصاصی.</li>
              <li><strong>سبد مدل‌های کلود و جی‌پی‌تی (Claude & GPT Models):</strong> شامل Claude 3.7 Sonnet و GPT-4o با بودجه ریت‌لیمیت کاملاً جداگانه.</li>
            </ul>

            <div class="qg-card-callout">
              <strong>💡 حل ریشه‌ای باگ قفل ۱۰۰٪ (100% Lock Bug Resolution):</strong><br>
              در نگارش‌های پیشین، پارسر خروجی CLI بدون تفکیک سطرها مقادیر را بازنویسی می‌کرد و سبد پر Claude (۱۰۰٪) سهمیه مصرف‌شده Gemini را می‌پوشاند. اکنون سامانه دارای پارسر دو-سبدی ایزوله است و سهمیه مدل چت فعلی را به دقت و در لحظه نمایش می‌دهد.
            </div>
          \` : \`
            <h4>1. Rolling 5-Hour Limit Mechanics</h4>
            <p>Antigravity quotas utilize a continuous rolling 5-hour window. Tokens consumed restore exactly 5 hours post-generation. The <code>Resets In</code> metric indicates the timestamp when your earliest consumed batch frees up.</p>

            <h4>2. Cumulative Weekly Ceiling</h4>
            <p>Alongside the rolling window, accounts operate under a 7-day calendar budget ceiling. When weekly capacity depletes, model access pauses until the weekly reset cycle.</p>

            <h4>3. Dual Isolated Model Buckets</h4>
            <ul>
              <li><strong>Gemini Models Bucket:</strong> Covers Gemini 3.8 Flash and Gemini 3.5 Pro under dedicated quota pools.</li>
              <li><strong>Claude & GPT Models Bucket:</strong> Covers Claude 3.7 Sonnet, GPT-4o, and reasoning models under separate rate limits.</li>
            </ul>

            <div class="qg-card-callout">
              <strong>💡 100% Lock Bug Fixed:</strong><br>
              Legacy parsers sequentially scanned telemetry lines, causing untouched 100% Claude quotas to unconditionally overwrite active Gemini usage. Quota Guard now strictly isolates both buckets in independent data structures.
            </div>
          \`}
        </div>

        <!-- Tab 1: 12% Account Handover -->
        <div class="qg-guide-panel" id="qg-panel-1" style="display:none;">
          \${isFa ? \`
            <h4>چرا توقف اضطراری در ۱۲٪؟ (Turn Boundary Safety)</h4>
            <p>تولید کدهای بزرگ و فراخوانی ابزارهای مهندسی نیاز به حداقل سهمیه کافی دارند. اگر سهمیه حین کار به ۰٪ برسد، فرایند به صورت ناقص خفه شده (Abrupt Stream Drop) و فایل‌های ویرایش‌شده دچار آسیب می‌شوند. توقف دقیق در ۱۲٪ روی مرز نوبت پیام، سلامت و پایداری کل پروژه را تضمین می‌کند.</p>

            <h4>مراحل ۵ گانه تعویض حساب با حفظ ۱۰۰٪ کانتکست (Zero Context Loss):</h4>
            <ol>
              <li><strong>توقف خودکار و زنگ هشدار:</strong> به محض رسیدن سهمیه مدل فعال به ۱۲٪، اعلان صوتی پخش شده و پنجره Handover کار را متوقف می‌سازد.</li>
              <li><strong>ذخیره خودکار چک‌پوینت:</strong> آخرین وضعیت پایدار پروژه و تاریخچه چت در <code>~/.gemini/antigravity-quota-guard/checkpoints/</code> ذخیره می‌گردد.</li>
              <li><strong>باز کردن تنظیمات حساب:</strong> با کلیک روی "باز کردن تنظیمات حساب" (یا میانبر <code>Cmd+,</code> در مک / <code>Ctrl+,</code>)، پنجره اکانت‌ها را باز کنید.</li>
              <li><strong>سوئیچ به حساب گوگل رزرو:</strong> در بخش Accounts، حساب گوگل دیگر خود را انتخاب یا وارد نمایید.</li>
              <li><strong>بررسی سلامت و ادامه کار:</strong> روی "بررسی سلامت حساب و ادامه کار" کلیک کنید. با تایید سهمیه بالای ۷۰٪، مکالمه بدون نیاز به شروع چت جدید از سر گرفته می‌شود.</li>
            </ol>
          \` : \`
            <h4>Why Pause at 12% at the Turn Boundary?</h4>
            <p>Complex engineering tasks require non-trivial quota buffers. Hitting 0% mid-generation causes stream truncation, partial tool executions, and file state corruption. Pausing at 12% on a clean turn boundary ensures complete session continuity.</p>

            <h4>5-Step Account Handover Protocol (Zero Context Loss):</h4>
            <ol>
              <li><strong>Safety Pause & Chime:</strong> When active model quota reaches 12%, an alert sounds and the Handover Modal locks execution safely.</li>
              <li><strong>Automated Checkpointing:</strong> Session snapshot is persisted to <code>~/.gemini/antigravity-quota-guard/checkpoints/</code>.</li>
              <li><strong>Open Account Settings:</strong> Click "Open Antigravity Account Settings" or press <code>Cmd+,</code> (macOS) / <code>Ctrl+,</code> (Linux/Windows).</li>
              <li><strong>Switch to Alternate Account:</strong> Select or log in with your backup Google account.</li>
              <li><strong>Verify & Resume:</strong> Click "Verify & Resume Execution". Upon confirming healthy quota (>70%), execution unfreezes automatically.</li>
            </ol>
          \`}
        </div>

        <!-- Tab 2: Settings & Customization -->
        <div class="qg-guide-panel" id="qg-panel-2" style="display:none;">
          \${isFa ? \`
            <h4>۱. آستانه‌های هشدار و توقف (Threshold Sliders)</h4>
            <ul>
              <li><strong>Warn % (پیش‌فرض ۲۰٪):</strong> نشانگر نوار عنوان زرد شده و آماده‌سازی برای تعویض حساب آغاز می‌شود.</li>
              <li><strong>Stabilize % (پیش‌فرض ۱۵٪):</strong> خاتمه دادن به وظایف سنگین و جلوگیری از تسک‌های موازی.</li>
              <li><strong>Stop % (پیش‌فرض ۱۲٪):</strong> توقف ایمن کار و باز شدن پنجره تعویض حساب.</li>
              <li><strong>Min Resume % (پیش‌فرض ۷۰٪):</strong> حداقل سهمیه لازم در حساب جدید برای بازگشایی چت.</li>
            </ul>

            <h4>۲. دامنه نمایش در نوار عنوان (HUD Scope)</h4>
            <ul>
              <li><code>۵ ساعته (fiveHour):</code> نمایش سهمیه ۵ ساعته مدل چت فعال (مانند <code>🛡️ QS: 78%</code>).</li>
              <li><code>سقف هفتگی (weekly):</code> نمایش درصد سقف هفتگی (مانند <code>🛡️ QS [W]: 75%</code>).</li>
              <li><code>هر دو (both):</code> نمایش همزمان هر دو سهمیه (مانند <code>🛡️ QS: 78% | W: 75%</code>).</li>
            </ul>

            <h4>۳. پالت‌های رنگی و هشدارهای صوتی</h4>
            <p>امکان انتخاب تم درمانی آرام (Clinical)، تم استاندارد (Standard) یا نئونی پررنگ (Vibrant)، به همراه انتخاب صدای زنگ هشدار مک (Glass, Ping, Pop, Submarine) و دکمه تست آنلاین صدا.</p>
          \` : \`
            <h4>1. Threshold Sliders</h4>
            <ul>
              <li><strong>Warn % (Default 20%):</strong> Status dot turns warning amber to signal upcoming handover.</li>
              <li><strong>Stabilize % (Default 15%):</strong> Wrap up long iterations and avoid spawning heavy parallel subtasks.</li>
              <li><strong>Stop % (Default 12%):</strong> Freezes turn execution safely and triggers the handover modal.</li>
              <li><strong>Min Resume % (Default 70%):</strong> Ensures new account has sufficient quota headroom before continuing.</li>
            </ul>

            <h4>2. Titlebar HUD Scope</h4>
            <ul>
              <li><code>5-Hour (fiveHour):</code> Displays active model's 5-hour rolling limit (e.g. <code>🛡️ QS: 78%</code>).</li>
              <li><code>Weekly Limit (weekly):</code> Displays active model's weekly ceiling (e.g. <code>🛡️ QS [W]: 75%</code>).</li>
              <li><code>Both (both):</code> Displays dual metrics side-by-side (e.g. <code>🛡️ QS: 78% | W: 75%</code>).</li>
            </ul>

            <h4>3. Color Presets & Audio Alerts</h4>
            <p>Choose between Clinical, Standard, or Vibrant themes, and configure macOS notification chimes (Glass, Ping, Pop, Submarine) with live audio testing.</p>
          \`}
        </div>

        <!-- Tab 3: FAQ & Troubleshooting -->
        <div class="qg-guide-panel" id="qg-panel-3" style="display:none;">
          \${isFa ? \`
            <h4>جعبه‌ابزار دستورات ترمینال (CLI Commands)</h4>
            <ul>
              <li><code>./patch.sh status</code> یا <code>quota-guard status</code>: بررسی وضعیت فرآیند، پچ، و سلامت سهمیه‌ها.</li>
              <li><code>./patch.sh update</code>: به‌روزرسانی سریع پچ درجا پس از آپدیت گوگل بدون نیاز به نصب مجدد.</li>
              <li><code>./patch.sh config</code>: ویرایش تعاملی تنظیمات و آستانه‌ها در محیط ترمینال.</li>
              <li><code>./patch.sh uninstall</code>: بازگردانی باینری اصلی کارخانه بدون هیچ اثری.</li>
            </ul>

            <h4>پرسش‌های پرتکرار</h4>
            <p><strong>اگر نوار سهمیه بعد از آپدیت گوگل ناپدید شد چه کنم؟</strong><br>
            گوگل فایل <code>app.asar</code> را با نسخه جدید جایگزین کرده است. دستور <code>./patch.sh update</code> را اجرا کنید تا پچ روی نسخه جدید اعمال شود.</p>

            <p><strong>آیا کدهای پروژه من دستکاری می‌شود؟</strong><br>
            خیر. محافظ سهمیه فقط در لایه مانیتورینگ رابط کاربری فعالیت دارد و دسترسی به فایل‌های کاری پروژه شما ندارد.</p>

            <div class="qg-card-callout">
              <strong>پشتیبانی و بازگشت به تنظیمات اولیه:</strong><br>
              برای بازگشت به تنظیمات کارخانه، روی دکمه "بازگشت به کارخانه" در تنظیمات کلیک کرده یا در ترمینال دستور <code>./patch.sh config</code> و سپس Reset را انتخاب نمایید.
            </div>
          \` : \`
            <h4>CLI Commands Cheat Sheet</h4>
            <ul>
              <li><code>./patch.sh status</code> or <code>quota-guard status</code>: Inspect live telemetry and patch health.</li>
              <li><code>./patch.sh update</code>: In-place refresh preserving factory backups.</li>
              <li><code>./patch.sh config</code>: Interactive terminal settings editor.</li>
              <li><code>./patch.sh uninstall</code>: Pristine factory restore.</li>
            </ul>

            <h4>Frequently Asked Questions</h4>
            <p><strong>What if the titlebar badge disappears after a Google update?</strong><br>
            Google replaced the binary during its auto-update. Simply run <code>./patch.sh update</code> to refresh the patch in place.</p>

            <p><strong>Are my project files touched?</strong><br>
            Never. Quota Guard is strictly isolated to UI HUD injection and never touches your workspace repositories.</p>

            <div class="qg-card-callout">
              <strong>Factory Reset:</strong> Click "Reset to Defaults" in the settings modal or select Reset in <code>./patch.sh config</code>.
            </div>
          \`}
        </div>

        <div style="margin-top:16px; display:flex; justify-content:flex-end;">
          <button class="qg-btn qg-btn-primary" id="qg-guide-btn-done" style="padding:6px 18px;">\${t('close')}</button>
        </div>
      </div>
    \`;

    document.body.appendChild(backdrop);

    // Tab switching handler
    const tabButtons = backdrop.querySelectorAll('.qg-guide-tab');
    const panels = backdrop.querySelectorAll('.qg-guide-panel');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabIdx = btn.getAttribute('data-tab');
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        panels.forEach((p, idx) => {
          p.style.display = String(idx) === tabIdx ? 'block' : 'none';
        });
      });
    });

    // Close handlers
    const closeGuide = () => {
      backdrop.remove();
      isUserGuideModalOpen = false;
      if (guideEscListener) {
        window.removeEventListener('keydown', guideEscListener);
        guideEscListener = null;
      }
    };

    guideEscListener = (e) => {
      if (e.key === 'Escape') closeGuide();
    };
    window.addEventListener('keydown', guideEscListener);

    // Language toggle inside guide
    document.getElementById('qg-guide-lang-toggle')?.addEventListener('click', () => {
      config.language = config.language === 'fa' ? 'en' : 'fa';
      console.log('__QUOTA_GUARD_ACTION__:SAVE_CONFIG:' + JSON.stringify(config));
      closeGuide();
      openUserGuideModal();
      updateHUD();
    });

    document.getElementById('qg-guide-close')?.addEventListener('click', closeGuide);
    document.getElementById('qg-guide-btn-done')?.addEventListener('click', closeGuide);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeGuide();
    });
  }

  // Settings Modal Dialog (4-Tab Schema-Driven)
  function openSettingsModal() {
    minimizeHandoverPanel();
    const existing = document.getElementById('qg-settings-modal');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'qg-settings-modal';
    backdrop.className = 'qg-modal-backdrop';

    const cfgCopy = JSON.parse(JSON.stringify(config));
    if (!cfgCopy.visuals) cfgCopy.visuals = {};
    if (!cfgCopy.visuals.hudScope) cfgCopy.visuals.hudScope = 'fiveHour';
    if (!cfgCopy.thresholds) cfgCopy.thresholds = {};
    if (!cfgCopy.audio) cfgCopy.audio = {};
    if (!cfgCopy.notifications) cfgCopy.notifications = {};
    if (!cfgCopy.snapshot) cfgCopy.snapshot = {};
    if (!cfgCopy.handover) cfgCopy.handover = {};
    if (!cfgCopy.expert) cfgCopy.expert = {};
    if (!cfgCopy.quota) cfgCopy.quota = {};
    if (!cfgCopy.diagnostics) cfgCopy.diagnostics = {};

    const isFa = cfgCopy.language === 'fa';

    backdrop.innerHTML = \`
      <div class="qg-modal" dir="\${isFa ? 'rtl' : 'ltr'}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="margin:0; font-size:15px; font-weight:700;">⚙️ \${t('settingsTitle')}</h3>
          <button class="qg-btn" id="qg-lang-toggle" style="flex:none; padding:3px 8px;">\${t('langToggle')}</button>
        </div>

        <!-- 4-Tab Navigation Header -->
        <div class="qg-settings-tabs">
          <button class="qg-settings-tab active" data-tab="0">\${t('tabThresholds')}</button>
          <button class="qg-settings-tab" data-tab="1">\${t('tabAppearance')}</button>
          <button class="qg-settings-tab" data-tab="2">\${t('tabPrivacy')}</button>
          <button class="qg-settings-tab" data-tab="3">\${t('tabAdvanced')}</button>
        </div>

        <!-- Tab 0: Thresholds & Quota -->
        <div class="qg-tab-panel active" data-panel="0">
          <div class="qg-card-callout" style="margin-bottom:12px; font-size:11px; opacity:0.85;">
            ℹ️ \${isFa
              ? 'ترتیب الزامی آستانه‌ها: هشدار > تثبیت > ثبت چک‌پوینت > توقف تعویض حساب. حداقل سهمیه برای بازیابی باید بالاتر از آستانه توقف باشد.'
              : 'Required threshold order: Warn > Stabilize > Checkpoint > Stop. Resume threshold must be strictly above Stop.'}
          </div>

          <div class="qg-field">
            <label>\${t('warnThreshold')}</label>
            <div class="qg-slider-row">
              <input type="range" class="qg-slider" id="qg-set-warn" min="10" max="60" value="\${cfgCopy.thresholds.warnPercent ?? 20}">
              <span class="qg-val" id="qg-val-warn">\${cfgCopy.thresholds.warnPercent ?? 20}%</span>
            </div>
          </div>

          <div class="qg-field">
            <label>\${t('stabilizeThreshold')}</label>
            <div class="qg-slider-row">
              <input type="range" class="qg-slider" id="qg-set-stabilize" min="8" max="50" value="\${cfgCopy.thresholds.stabilizePercent ?? 15}">
              <span class="qg-val" id="qg-val-stabilize">\${cfgCopy.thresholds.stabilizePercent ?? 15}%</span>
            </div>
          </div>

          <div class="qg-field">
            <label>\${t('checkpointThreshold')}</label>
            <div class="qg-slider-row">
              <input type="range" class="qg-slider" id="qg-set-checkpoint" min="6" max="40" value="\${cfgCopy.thresholds.checkpointPercent ?? 13}">
              <span class="qg-val" id="qg-val-checkpoint">\${cfgCopy.thresholds.checkpointPercent ?? 13}%</span>
            </div>
          </div>

          <div class="qg-field">
            <label>\${t('stopThreshold')}</label>
            <div class="qg-slider-row">
              <input type="range" class="qg-slider" id="qg-set-stop" min="1" max="30" value="\${cfgCopy.thresholds.stopPercent ?? 12}">
              <span class="qg-val" id="qg-val-stop">\${cfgCopy.thresholds.stopPercent ?? 12}%</span>
            </div>
          </div>

          <div class="qg-field">
            <label>\${t('resumeThreshold')}</label>
            <div class="qg-slider-row">
              <input type="range" class="qg-slider" id="qg-set-resume" min="20" max="95" value="\${cfgCopy.thresholds.minResumePercent ?? 70}">
              <span class="qg-val" id="qg-val-resume">\${cfgCopy.thresholds.minResumePercent ?? 70}%</span>
            </div>
          </div>
        </div>

        <!-- Tab 1: Appearance & Alerts -->
        <div class="qg-tab-panel" data-panel="1">
          <!-- R4: Dedicated User Guide Button -->
          <button class="qg-btn-guide" id="qg-btn-open-guide">
            <span>\${t('guideButton')}</span>
            <span class="qg-btn-guide-sub">\${t('guideButtonSub')}</span>
          </button>

          <!-- R3: Titlebar HUD Scope Segmented Control -->
          <div class="qg-field">
            <label>\${t('hudScopeLabel')}</label>
            <div class="qg-segmented-row" id="qg-scope-selector">
              <button class="qg-segmented-btn \${cfgCopy.visuals.hudScope === 'fiveHour' ? 'active' : ''}" data-scope="fiveHour">
                \${t('scopeFiveHour')}
              </button>
              <button class="qg-segmented-btn \${cfgCopy.visuals.hudScope === 'weekly' ? 'active' : ''}" data-scope="weekly">
                \${t('scopeWeekly')}
              </button>
              <button class="qg-segmented-btn \${cfgCopy.visuals.hudScope === 'both' ? 'active' : ''}" data-scope="both">
                \${t('scopeBoth')}
              </button>
            </div>
          </div>

          <div class="qg-field">
            <label>\${t('themePreset')}</label>
            <div style="display:flex; gap:6px;">
              <button class="qg-btn" id="qg-theme-clinical">Clinical</button>
              <button class="qg-btn" id="qg-theme-standard">Standard</button>
              <button class="qg-btn" id="qg-theme-vibrant">Vibrant</button>
            </div>
          </div>

          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-sound" \${cfgCopy.audio.soundEnabled ? 'checked' : ''}>
              \${t('soundToggle')}
            </label>
            <div style="display:flex; gap:6px; margin-top:6px;">
              <select id="qg-set-sound-name" class="qg-select-control" style="width:auto;">
                <option value="Glass" \${cfgCopy.audio.soundName === 'Glass' ? 'selected' : ''}>Glass</option>
                <option value="Ping" \${cfgCopy.audio.soundName === 'Ping' ? 'selected' : ''}>Ping</option>
                <option value="Pop" \${cfgCopy.audio.soundName === 'Pop' ? 'selected' : ''}>Pop</option>
                <option value="Submarine" \${cfgCopy.audio.soundName === 'Submarine' ? 'selected' : ''}>Submarine</option>
              </select>
              <button class="qg-btn" id="qg-test-sound">▶ \${t('testSound')}</button>
            </div>
          </div>

          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-notify" \${cfgCopy.audio.desktopNotification ? 'checked' : ''}>
              \${t('notifyToggle')}
            </label>
          </div>
        </div>

        <!-- Tab 2: Privacy & Checkpoints -->
        <div class="qg-tab-panel" data-panel="2">
          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-snapshot-enabled" \${cfgCopy.snapshot.enabled !== false ? 'checked' : ''}>
              \${t('snapshotEnabled')}
            </label>
          </div>

          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-include-transcript" \${cfgCopy.snapshot.includeTranscript !== false ? 'checked' : ''}>
              \${t('includeTranscript')}
            </label>
          </div>

          <div class="qg-field" style="padding-inline-start: 22px;">
            <label style="font-size:11px; opacity:0.8;">\${isFa ? 'تعداد پیام‌های ضبط‌شده در سند بازیابی:' : 'Recent messages in recovery doc:'}</label>
            <div class="qg-slider-row">
              <input type="range" class="qg-slider" id="qg-set-transcript-limit" min="1" max="10" value="\${cfgCopy.snapshot.transcriptMessageLimit ?? 5}">
              <span class="qg-val" id="qg-val-transcript-limit">\${cfgCopy.snapshot.transcriptMessageLimit ?? 5}</span>
            </div>
          </div>

          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-include-artifacts" \${cfgCopy.snapshot.includeArtifactInventory !== false ? 'checked' : ''}>
              \${t('includeArtifacts')}
            </label>
          </div>

          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-mask-account" \${cfgCopy.snapshot.includeAccountEmail === false ? 'checked' : ''}>
              \${t('maskAccount')}
            </label>
          </div>

          <div style="margin-top:14px;">
            <button class="qg-btn" id="qg-btn-open-checkpoints" style="width:100%; justify-content:center; padding:8px;">
              \${t('openCheckpointsFolder')}
            </button>
          </div>
        </div>

        <!-- Tab 3: Advanced & Expert -->
        <div class="qg-tab-panel" data-panel="3">
          <div class="qg-field">
            <label>\${t('operatingMode')}</label>
            <select id="qg-set-expert-mode" class="qg-select-control">
              <option value="standard" \${(!cfgCopy.expert || cfgCopy.expert.mode === 'standard') ? 'selected' : ''}>\${t('modeStandard')}</option>
              <option value="advanced" \${(cfgCopy.expert && cfgCopy.expert.mode === 'advanced') ? 'selected' : ''}>\${t('modeAdvanced')}</option>
              <option value="god" \${(cfgCopy.expert && cfgCopy.expert.mode === 'god') ? 'selected' : ''}>\${t('modeGod')}</option>
            </select>
          </div>

          <div class="qg-field">
            <label>\${t('handoverMode')}</label>
            <select id="qg-set-handover-mode" class="qg-select-control">
              <option value="automatic_when_supported" \${(!cfgCopy.handover || cfgCopy.handover.resumeMode === 'automatic_when_supported') ? 'selected' : ''}>\${t('modeAuto')}</option>
              <option value="one_click" \${(cfgCopy.handover && cfgCopy.handover.resumeMode === 'one_click') ? 'selected' : ''}>\${t('modeOneClick')}</option>
              <option value="manual" \${(cfgCopy.handover && cfgCopy.handover.resumeMode === 'manual') ? 'selected' : ''}>\${t('modeManual')}</option>
            </select>
          </div>

          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-auto-open-account" \${(!cfgCopy.handover || cfgCopy.handover.autoOpenAccountFlow !== false) ? 'checked' : ''}>
              \${t('handoverAutoOpen')}
            </label>
          </div>

          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-auto-detect-account" \${(!cfgCopy.handover || cfgCopy.handover.autoDetectAccountChange !== false) ? 'checked' : ''}>
              \${t('handoverAutoDetect')}
            </label>
          </div>

          <div class="qg-field">
            <label>\${t('quotaProvider')}</label>
            <select id="qg-set-provider-mode" class="qg-select-control">
              <option value="auto_safe" \${(!cfgCopy.quota || cfgCopy.quota.providerMode === 'auto_safe') ? 'selected' : ''}>\${t('providerAutoSafe')}</option>
              <option value="cli_statusline" \${(cfgCopy.quota && cfgCopy.quota.providerMode === 'cli_statusline') ? 'selected' : ''}>\${t('providerCliStatusline')}</option>
            </select>
          </div>

          <div class="qg-field">
            <label class="qg-checkbox-row">
              <input type="checkbox" id="qg-set-raw-telemetry" \${(cfgCopy.diagnostics && cfgCopy.diagnostics.showRawQuotaPayload) ? 'checked' : ''}>
              \${t('diagnosticsRaw')}
            </label>
          </div>
        </div>

        <!-- Modal Footer -->
        <div style="display:flex; justify-content:space-between; margin-top:18px; border-top:1px solid rgba(255,255,255,0.1); padding-top:12px;">
          <button class="qg-btn" id="qg-modal-reset" style="background:rgba(239,68,68,0.2); color:#fca5a5;">\${t('reset')}</button>
          <div style="display:flex; gap:8px;">
            <button class="qg-btn" id="qg-modal-cancel">\${t('cancel')}</button>
            <button class="qg-btn qg-btn-primary" id="qg-modal-save">\${t('save')}</button>
          </div>
        </div>
      </div>
    \`;

    document.body.appendChild(backdrop);

    // Tab switching handler
    const settingsTabs = backdrop.querySelectorAll('.qg-settings-tab');
    const settingsPanels = backdrop.querySelectorAll('.qg-tab-panel');
    settingsTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabIdx = tab.getAttribute('data-tab');
        settingsTabs.forEach(t => t.classList.remove('active'));
        settingsPanels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        backdrop.querySelector(\`.qg-tab-panel[data-panel="\${tabIdx}"]\`)?.classList.add('active');
      });
    });

    // Guide button handler
    document.getElementById('qg-btn-open-guide')?.addEventListener('click', () => {
      openUserGuideModal();
    });

    // Scope selector buttons handler
    const scopeButtons = backdrop.querySelectorAll('.qg-segmented-btn');
    scopeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        scopeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cfgCopy.visuals.hudScope = btn.getAttribute('data-scope');
      });
    });

    // Smart chained slider updates to preserve monotonic invariants
    const sWarn = document.getElementById('qg-set-warn');
    const vWarn = document.getElementById('qg-val-warn');
    const sStab = document.getElementById('qg-set-stabilize');
    const vStab = document.getElementById('qg-val-stabilize');
    const sCheck = document.getElementById('qg-set-checkpoint');
    const vCheck = document.getElementById('qg-val-checkpoint');
    const sStop = document.getElementById('qg-set-stop');
    const vStop = document.getElementById('qg-val-stop');
    const sResume = document.getElementById('qg-set-resume');
    const vResume = document.getElementById('qg-val-resume');

    const syncSliderUI = () => {
      if (sWarn && vWarn) { sWarn.value = cfgCopy.thresholds.warnPercent; vWarn.textContent = sWarn.value + '%'; }
      if (sStab && vStab) { sStab.value = cfgCopy.thresholds.stabilizePercent; vStab.textContent = sStab.value + '%'; }
      if (sCheck && vCheck) { sCheck.value = cfgCopy.thresholds.checkpointPercent; vCheck.textContent = sCheck.value + '%'; }
      if (sStop && vStop) { sStop.value = cfgCopy.thresholds.stopPercent; vStop.textContent = sStop.value + '%'; }
      if (sResume && vResume) { sResume.value = cfgCopy.thresholds.minResumePercent; vResume.textContent = sResume.value + '%'; }
    };

    sStop?.addEventListener('input', () => {
      const val = parseInt(sStop.value, 10);
      cfgCopy.thresholds.stopPercent = val;
      if (cfgCopy.thresholds.checkpointPercent <= cfgCopy.thresholds.stopPercent) {
        cfgCopy.thresholds.checkpointPercent = cfgCopy.thresholds.stopPercent + 1;
      }
      if (cfgCopy.thresholds.stabilizePercent <= cfgCopy.thresholds.checkpointPercent) {
        cfgCopy.thresholds.stabilizePercent = cfgCopy.thresholds.checkpointPercent + 2;
      }
      if (cfgCopy.thresholds.warnPercent <= cfgCopy.thresholds.stabilizePercent) {
        cfgCopy.thresholds.warnPercent = cfgCopy.thresholds.stabilizePercent + 5;
      }
      if (cfgCopy.thresholds.minResumePercent <= cfgCopy.thresholds.stopPercent) {
        cfgCopy.thresholds.minResumePercent = Math.min(100, cfgCopy.thresholds.stopPercent + 10);
      }
      syncSliderUI();
    });

    sCheck?.addEventListener('input', () => {
      const val = parseInt(sCheck.value, 10);
      cfgCopy.thresholds.checkpointPercent = val;
      if (cfgCopy.thresholds.checkpointPercent <= cfgCopy.thresholds.stopPercent) {
        cfgCopy.thresholds.stopPercent = Math.max(1, cfgCopy.thresholds.checkpointPercent - 1);
      }
      if (cfgCopy.thresholds.stabilizePercent <= cfgCopy.thresholds.checkpointPercent) {
        cfgCopy.thresholds.stabilizePercent = cfgCopy.thresholds.checkpointPercent + 2;
      }
      if (cfgCopy.thresholds.warnPercent <= cfgCopy.thresholds.stabilizePercent) {
        cfgCopy.thresholds.warnPercent = cfgCopy.thresholds.stabilizePercent + 5;
      }
      syncSliderUI();
    });

    sStab?.addEventListener('input', () => {
      const val = parseInt(sStab.value, 10);
      cfgCopy.thresholds.stabilizePercent = val;
      if (cfgCopy.thresholds.stabilizePercent <= cfgCopy.thresholds.checkpointPercent) {
        cfgCopy.thresholds.checkpointPercent = Math.max(2, cfgCopy.thresholds.stabilizePercent - 2);
        if (cfgCopy.thresholds.checkpointPercent <= cfgCopy.thresholds.stopPercent) {
          cfgCopy.thresholds.stopPercent = Math.max(1, cfgCopy.thresholds.checkpointPercent - 1);
        }
      }
      if (cfgCopy.thresholds.warnPercent <= cfgCopy.thresholds.stabilizePercent) {
        cfgCopy.thresholds.warnPercent = cfgCopy.thresholds.stabilizePercent + 5;
      }
      syncSliderUI();
    });

    sWarn?.addEventListener('input', () => {
      const val = parseInt(sWarn.value, 10);
      cfgCopy.thresholds.warnPercent = val;
      if (cfgCopy.thresholds.warnPercent <= cfgCopy.thresholds.stabilizePercent) {
        cfgCopy.thresholds.stabilizePercent = Math.max(3, cfgCopy.thresholds.warnPercent - 5);
        if (cfgCopy.thresholds.stabilizePercent <= cfgCopy.thresholds.checkpointPercent) {
          cfgCopy.thresholds.checkpointPercent = Math.max(2, cfgCopy.thresholds.stabilizePercent - 2);
          if (cfgCopy.thresholds.checkpointPercent <= cfgCopy.thresholds.stopPercent) {
            cfgCopy.thresholds.stopPercent = Math.max(1, cfgCopy.thresholds.checkpointPercent - 1);
          }
        }
      }
      syncSliderUI();
    });

    sResume?.addEventListener('input', () => {
      const val = parseInt(sResume.value, 10);
      cfgCopy.thresholds.minResumePercent = Math.max(cfgCopy.thresholds.stopPercent + 5, val);
      syncSliderUI();
    });

    const sLimit = document.getElementById('qg-set-transcript-limit');
    const vLimit = document.getElementById('qg-val-transcript-limit');
    sLimit?.addEventListener('input', () => {
      vLimit.textContent = sLimit.value;
      if (!cfgCopy.snapshot) cfgCopy.snapshot = {};
      cfgCopy.snapshot.transcriptMessageLimit = parseInt(sLimit.value, 10);
    });

    // Language toggle
    document.getElementById('qg-lang-toggle')?.addEventListener('click', () => {
      config.language = config.language === 'fa' ? 'en' : 'fa';
      console.log('__QUOTA_GUARD_ACTION__:SAVE_CONFIG:' + JSON.stringify(config));
      backdrop.remove();
      openSettingsModal();
      updateHUD();
    });

    // Sound test
    document.getElementById('qg-test-sound')?.addEventListener('click', () => {
      const soundName = document.getElementById('qg-set-sound-name').value;
      playWebAudioChime();
      dispatchAction('PLAY_CHIME:' + soundName);
    });

    // Open Checkpoints Folder
    document.getElementById('qg-btn-open-checkpoints')?.addEventListener('click', () => {
      console.log('__QUOTA_GUARD_ACTION__:OPEN_CHECKPOINTS_DIR');
    });

    // God Mode Confirmation Warning
    const expertSelect = document.getElementById('qg-set-expert-mode');
    let previousExpertVal = expertSelect?.value || 'standard';
    expertSelect?.addEventListener('change', () => {
      if (expertSelect.value === 'god') {
        const confirmMsg = isFa
          ? 'هشدار امنیتی: فعال‌سازی «حالت خدا» (God Mode) کنترل پیشرفته و اتوماسیون کامل رابط را امکان‌پذیر می‌سازد. آیا از فعال‌سازی این حالت اطمینان دارید؟'
          : 'Security Warning: Enabling "God Mode" allows full UI automation and unrestricted capabilities. Are you sure you want to enable this mode?';
        if (!window.confirm(confirmMsg)) {
          expertSelect.value = previousExpertVal;
          return;
        }
      }
      previousExpertVal = expertSelect.value;
      if (!cfgCopy.expert) cfgCopy.expert = {};
      cfgCopy.expert.mode = expertSelect.value;
    });

    // Preset buttons
    const applyPreset = (presetName, colors) => {
      cfgCopy.visuals.themePreset = presetName;
      cfgCopy.visuals.colors = colors;
    };
    document.getElementById('qg-theme-clinical')?.addEventListener('click', () => applyPreset('clinical', { safe: '#10b981', warn: '#d97706', critical: '#e11d48', text: '#f8fafc', background: '#0f172a' }));
    document.getElementById('qg-theme-standard')?.addEventListener('click', () => applyPreset('standard', { safe: '#22c55e', warn: '#eab308', critical: '#ef4444', text: '#ffffff', background: '#18181b' }));
    document.getElementById('qg-theme-vibrant')?.addEventListener('click', () => applyPreset('vibrant', { safe: '#06b6d4', warn: '#f97316', critical: '#ec4899', text: '#ffffff', background: '#09090b' }));

    // Reset button
    document.getElementById('qg-modal-reset')?.addEventListener('click', () => {
      const confirmMsg = isFa
        ? 'آیا از بازگردانی تمامی تنظیمات به حالت اولیه کارخانه اطمینان دارید؟'
        : 'Are you sure you want to reset all settings to factory defaults?';
      if (window.confirm(confirmMsg)) {
        console.log('__QUOTA_GUARD_ACTION__:RESET_CONFIG');
        config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        backdrop.remove();
        updateHUD();
        if (popover && popover.classList.contains('open')) {
          renderPopoverContent();
        }
      }
    });

    // Cancel button
    document.getElementById('qg-modal-cancel')?.addEventListener('click', () => backdrop.remove());

    // Save button
    document.getElementById('qg-modal-save')?.addEventListener('click', () => {
      const soundChecked = document.getElementById('qg-set-sound')?.checked ?? true;
      const soundNameVal = document.getElementById('qg-set-sound-name')?.value || 'Glass';
      const notifyChecked = document.getElementById('qg-set-notify')?.checked ?? true;

      cfgCopy.audio.soundEnabled = soundChecked;
      cfgCopy.audio.soundName = soundNameVal;
      cfgCopy.audio.desktopNotification = notifyChecked;

      if (!cfgCopy.notifications) cfgCopy.notifications = {};
      cfgCopy.notifications.soundEnabled = soundChecked;
      cfgCopy.notifications.soundName = soundNameVal;
      cfgCopy.notifications.desktopNotification = notifyChecked;
      cfgCopy.notifications.enabled = notifyChecked || soundChecked;

      if (!cfgCopy.snapshot) cfgCopy.snapshot = {};
      cfgCopy.snapshot.enabled = document.getElementById('qg-set-snapshot-enabled')?.checked ?? true;
      cfgCopy.snapshot.includeTranscript = document.getElementById('qg-set-include-transcript')?.checked ?? true;
      cfgCopy.snapshot.includeArtifactInventory = document.getElementById('qg-set-include-artifacts')?.checked ?? true;
      cfgCopy.snapshot.includeAccountEmail = !(document.getElementById('qg-set-mask-account')?.checked ?? true);

      if (!cfgCopy.expert) cfgCopy.expert = {};
      cfgCopy.expert.mode = document.getElementById('qg-set-expert-mode')?.value || 'standard';

      if (!cfgCopy.handover) cfgCopy.handover = {};
      cfgCopy.handover.resumeMode = document.getElementById('qg-set-handover-mode')?.value || 'automatic_when_supported';
      cfgCopy.handover.autoOpenAccountFlow = document.getElementById('qg-set-auto-open-account')?.checked ?? true;
      cfgCopy.handover.autoDetectAccountChange = document.getElementById('qg-set-auto-detect-account')?.checked ?? true;

      if (!cfgCopy.quota) cfgCopy.quota = {};
      cfgCopy.quota.providerMode = document.getElementById('qg-set-provider-mode')?.value || 'auto_safe';

      if (!cfgCopy.diagnostics) cfgCopy.diagnostics = {};
      cfgCopy.diagnostics.showRawQuotaPayload = document.getElementById('qg-set-raw-telemetry')?.checked ?? false;

      config = cfgCopy;
      console.log('__QUOTA_GUARD_ACTION__:SAVE_CONFIG:' + JSON.stringify(config));
      backdrop.remove();
      updateHUD();
      if (popover && popover.classList.contains('open')) {
        renderPopoverContent();
      }
    });
  }

    function minimizeHandoverPanel() {
    const panel = document.getElementById('qg-handover-panel');
    if (panel) {
      isHandoverPanelMinimized = true;
      panel.classList.add('minimized');
    }
  }

  function restoreHandoverPanel() {
    const panel = document.getElementById('qg-handover-panel');
    if (panel) {
      isHandoverPanelMinimized = false;
      panel.classList.remove('minimized');
    }
  }

  function dismissHandoverPanel() {
    handoverDismissed = true;
    isHandoverPanelOpen = false;
    isHandoverModalOpen = false;
    isHandoverPanelMinimized = false;
    const panel = document.getElementById('qg-handover-panel');
    if (panel) panel.remove();
    const modal = document.getElementById('qg-handover-modal');
    if (modal) modal.remove();
  }

  // Floating Warning Panel (R2 Non-blocking)
  function openHandoverPanel() {
    if (isHandoverPanelOpen) return;
    const existing = document.getElementById('qg-handover-panel');
    if (existing) existing.remove();

    isHandoverPanelOpen = true;
    isHandoverModalOpen = true;
    isHandoverPanelMinimized = false;
    snapshotProgress = 0;
    currentHandoffMarkdown = '';

    // Audio chime
    if (config.audio && config.audio.soundEnabled) {
      playWebAudioChime();
      dispatchAction('PLAY_CHIME:' + (config.audio.soundName || 'Glass'));
    }
    // Desktop notification
    if (config.audio && config.audio.desktopNotification) {
      console.log('__QUOTA_GUARD_ACTION__:SHOW_NOTIFICATION:' + JSON.stringify({
        title: t('handoverTitle'),
        body: t('handoverDesc')
      }));
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(t('handoverTitle'), { body: t('handoverDesc'), silent: true });
        } catch (_) {}
      }
    }

    const modelInfo = detectActiveModel();
    const g5 = (quota && quota.gemini && typeof quota.gemini.fiveHour === 'number') ? quota.gemini.fiveHour : 12;
    const c5 = (quota && quota.claude_gpt && typeof quota.claude_gpt.fiveHour === 'number') ? quota.claude_gpt.fiveHour : 12;
    const activePct = modelInfo.category === 'claude_gpt' ? c5 : g5;
    const isFa = config.language === 'fa';

    const panel = document.createElement('div');
    panel.id = 'qg-handover-panel';
    panel.dir = isFa ? 'rtl' : 'ltr';
    panel.innerHTML = \`
      <!-- Minimized Bar View (shown when .minimized) -->
      <div class="qg-panel-minimized-bar" id="qg-panel-minimized-bar" style="display: none;">
        <div class="qg-pill-info">
          <span class="qg-pulse-dot" style="background: #ef4444; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"></span>
          <span>\${isFa ? '⚠️ ' + t('quotaLow') + ' (' + activePct + '٪)' : '⚠️ ' + t('quotaLow') + ' (' + activePct + '%)'}</span>
          <span class="qg-pill-progress" id="qg-mini-progress">0%</span>
        </div>
        <div class="qg-pill-actions">
          <button class="qg-panel-ctrl-btn" id="qg-panel-btn-restore" title="\${t('restore')}">▢</button>
          <button class="qg-panel-ctrl-btn" id="qg-panel-btn-mini-close" title="\${t('close')}">✕</button>
        </div>
      </div>

      <!-- Full Panel Content (shown when not .minimized) -->
      <div class="qg-panel-full-content" id="qg-panel-full-content">
        <div class="qg-panel-header">
          <div class="qg-panel-title-group">
            <span style="font-size: 16px;">⚠️</span>
            <h3 class="qg-panel-title">\${t('handoverTitle')}</h3>
          </div>
          <div class="qg-panel-window-controls" style="display: flex; gap: 4px;">
            <button class="qg-panel-ctrl-btn" id="qg-panel-btn-minimize" title="\${t('minimize')}">▬</button>
            <button class="qg-panel-ctrl-btn" id="qg-panel-btn-close" title="\${t('close')}">✕</button>
          </div>
        </div>

        <p class="qg-panel-desc">\${t('handoverDesc')}</p>

        <div class="qg-panel-meta-card">
          <div class="qg-meta-row">
            <span>\${t('activeAccount')}</span>
            <strong id="qg-panel-cur-email">\${(quota && quota.account_email) || 'Google'}</strong>
          </div>
          <div class="qg-meta-row">
            <span>\${t('activeModel')}</span>
            <strong>\${modelInfo.modelName}</strong>
          </div>
          <div class="qg-meta-row">
            <span>\${t('fiveHourRemaining')}</span>
            <strong style="color: #ef4444;">\${activePct}%</strong>
          </div>
        </div>

        <div class="qg-snapshot-progress-section">
          <div class="qg-progress-labels">
            <span id="qg-snapshot-status-msg" style="color: #38bdf8; font-weight: 500;">\${t('snapshotPhase1')}</span>
            <strong id="qg-snapshot-pct-text" style="color: #38bdf8;">0%</strong>
          </div>
          <div class="qg-progress-track">
            <div id="qg-snapshot-progress-fill" class="qg-progress-fill"></div>
          </div>
        </div>

        <div class="qg-panel-action-stack">
          <button class="qg-btn qg-btn-copy" id="qg-btn-copy-handoff" style="display: none;">
            📋 \${t('copyHandoff')}
          </button>
          <button class="qg-btn" id="qg-btn-open-settings" disabled style="opacity: 0.5; cursor: not-allowed;">
            ⚙️ \${t('openSettings')}
          </button>
          <button class="qg-btn qg-btn-primary" id="qg-btn-verify-resume" style="display: none;">
            ✅ \${t('verifyResume')}
          </button>
          <button class="qg-btn qg-btn-dismiss" id="qg-btn-dismiss">
            🚫 \${t('dismiss')}
          </button>
        </div>

        <div id="qg-resume-msg" class="qg-panel-resume-msg"></div>
      </div>
    \`;
    document.body.appendChild(panel);

    // Bind Window Controls
    document.getElementById('qg-panel-btn-minimize')?.addEventListener('click', (e) => {
      e.stopPropagation();
      minimizeHandoverPanel();
    });
    document.getElementById('qg-panel-btn-restore')?.addEventListener('click', (e) => {
      e.stopPropagation();
      restoreHandoverPanel();
    });
    document.getElementById('qg-panel-minimized-bar')?.addEventListener('click', (e) => {
      if (e.target.closest('.qg-panel-ctrl-btn')) return;
      restoreHandoverPanel();
    });
    document.getElementById('qg-panel-btn-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissHandoverPanel();
    });
    document.getElementById('qg-panel-btn-mini-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissHandoverPanel();
    });
    document.getElementById('qg-btn-dismiss')?.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissHandoverPanel();
    });

    // Settings Safety Lock Interlock & Auto-Minimize
    document.getElementById('qg-btn-open-settings')?.addEventListener('click', () => {
      if (snapshotProgress < 100) return; // Strict safety lock
      minimizeHandoverPanel();
      console.log('__QUOTA_GUARD_ACTION__:OPEN_SETTINGS_WINDOW');
    });

    // Copy Handoff Document
    document.getElementById('qg-btn-copy-handoff')?.addEventListener('click', () => {
      console.log('__QUOTA_GUARD_ACTION__:COPY_HANDOFF:' + JSON.stringify({ markdown: currentHandoffMarkdown }));
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && currentHandoffMarkdown) {
        navigator.clipboard.writeText(currentHandoffMarkdown).catch(() => {});
      }
      const btn = document.getElementById('qg-btn-copy-handoff');
      if (btn) {
        const origText = btn.textContent;
        btn.textContent = '✅ ' + (t('copiedHandoff') || 'Recovery Document Copied!');
        setTimeout(() => { if (btn) btn.textContent = origText; }, 2000);
      }
    });

    // Verify and Resume
    document.getElementById('qg-btn-verify-resume')?.addEventListener('click', () => {
      const msg = document.getElementById('qg-resume-msg');
      if (msg) msg.textContent = t('checkingQuota');
      console.log('__QUOTA_GUARD_ACTION__:CHECK_QUOTA');
    });

    // Trigger Snapshot Pipeline via Main Process IPC
    const snapshotMeta = {
      conversationId: getActiveConversationId(),
      activeModel: modelInfo.modelName,
      modelName: modelInfo.modelName,
      category: modelInfo.category,
      accountEmail: (quota && quota.account_email) || 'Google Account',
      accountName: (quota && quota.account_name) || '',
      userTier: (quota && quota.user_tier) || '',
      quotaMetrics: {
        geminiFiveHour: typeof quota?.gemini?.fiveHour === 'number' ? quota.gemini.fiveHour : null,
        geminiWeekly: typeof quota?.gemini?.weekly === 'number' ? quota.gemini.weekly : null,
        claudeFiveHour: typeof quota?.claude_gpt?.fiveHour === 'number' ? quota.claude_gpt.fiveHour : null,
        claudeWeekly: typeof quota?.claude_gpt?.weekly === 'number' ? quota.claude_gpt.weekly : null,
        activeBucket: modelInfo.category
      },
      geminiFiveHour: typeof quota?.gemini?.fiveHour === 'number' ? quota.gemini.fiveHour : null,
      geminiWeekly: typeof quota?.gemini?.weekly === 'number' ? quota.gemini.weekly : null,
      claudeFiveHour: typeof quota?.claude_gpt?.fiveHour === 'number' ? quota.claude_gpt.fiveHour : null,
      claudeWeekly: typeof quota?.claude_gpt?.weekly === 'number' ? quota.claude_gpt.weekly : null,
      capturedAt: new Date().toISOString()
    };
    console.log('__QUOTA_GUARD_ACTION__:CREATE_SNAPSHOT:' + JSON.stringify(snapshotMeta));
  }

  // Alias for backward compatibility
  function openHandoverModal() {
    return openHandoverPanel();
  }

  // Live Snapshot Progress Listener
  window.__QUOTA_GUARD_SNAPSHOT_PROGRESS__ = function(event) {
    if (!event || typeof event !== 'object') return;
    const percent = typeof event.percent === 'number' ? event.percent : (typeof event.pct === 'number' ? event.pct : 0);
    snapshotProgress = percent;

    const fill = document.getElementById('qg-snapshot-progress-fill');
    const pctText = document.getElementById('qg-snapshot-pct-text');
    const miniProg = document.getElementById('qg-mini-progress');
    const msgEl = document.getElementById('qg-snapshot-status-msg');

    if (fill) fill.style.width = percent + '%';
    if (pctText) pctText.textContent = percent + '%';
    if (miniProg) miniProg.textContent = percent + '%';

    const msg = event.message || event.statusMsg;
    if (msg && msgEl) {
      msgEl.textContent = msg;
    }

    if (event.markdown) {
      currentHandoffMarkdown = event.markdown;
    }

    // Safety Lock Release at 100%
    if (percent >= 100) {
      const settingsBtn = document.getElementById('qg-btn-open-settings');
      const copyBtn = document.getElementById('qg-btn-copy-handoff');
      const verifyBtn = document.getElementById('qg-btn-verify-resume');
      if (settingsBtn) {
        settingsBtn.removeAttribute('disabled');
        settingsBtn.disabled = false;
        settingsBtn.style.opacity = '1';
        settingsBtn.style.cursor = 'pointer';
        settingsBtn.style.borderColor = '#10b981';
        settingsBtn.style.color = '#10b981';
      }
      if (copyBtn) copyBtn.style.display = 'block';
      if (verifyBtn) verifyBtn.style.display = 'block';
    }
  };

  // Live updater from main process
  window.__QUOTA_GUARD_UPDATE__ = function(newData) {
    if (newData && typeof newData === 'object') {
      quota = newData;
      if (!quota.gemini) {
        quota.gemini = {
          fiveHour: typeof quota.remaining_percent === 'number' ? quota.remaining_percent : null,
          weekly: typeof quota.weekly_percent === 'number' ? quota.weekly_percent : null,
          resetTimeFiveHour: quota.reset_time || null,
          resetTimeWeekly: null
        };
      }
      if (!quota.claude_gpt) {
        quota.claude_gpt = { fiveHour: null, weekly: null, resetTimeFiveHour: null, resetTimeWeekly: null };
      }
    }
    updateHUD();

    const resumeBtn = document.getElementById('qg-btn-verify-resume');
    const resumeMsg = document.getElementById('qg-resume-msg');
    if ((isHandoverPanelOpen || isHandoverModalOpen) && resumeBtn && resumeMsg) {
      const modelInfo = detectActiveModel();
      const bucket = modelInfo.category === 'claude_gpt' ? quota.claude_gpt : quota.gemini;
      const newPct = (bucket && typeof bucket.fiveHour === 'number') ? bucket.fiveHour : (quota.remaining_percent ?? null);

      if (typeof newPct === 'number' && newPct >= config.thresholds.minResumePercent) {
        resumeMsg.textContent = '✅ ' + (t('switchSuccess') || 'Successfully verified! Resuming...');
        resumeMsg.style.color = '#10b981';
        setTimeout(() => {
          const p = document.getElementById('qg-handover-panel');
          if (p) p.remove();
          const m = document.getElementById('qg-handover-modal');
          if (m) m.remove();
          isHandoverPanelOpen = false;
          isHandoverModalOpen = false;
          isHandoverPanelMinimized = false;
        }, 1500);
      } else {
        resumeMsg.textContent = '⚠️ Quota still low: ' + newPct + '%. Please switch account.';
        resumeMsg.style.color = '#f59e0b';
      }
    }
  };

  // Mount on DOM Ready and fetch live quota
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountBadge();
      fetchLiveQuotaDirect();
    });
  } else {
    mountBadge();
    fetchLiveQuotaDirect();
  }

  // Dynamic Event-Driven Model & Route Tracking
  const checkStateAndRender = () => {
    mountBadge();
    updateHUD();
  };

  // 1. Intercept history pushState & replaceState for route transitions
  const origPushState = history.pushState;
  if (origPushState) {
    history.pushState = function() {
      const ret = origPushState.apply(this, arguments);
      setTimeout(() => { checkStateAndRender(); fetchLiveQuotaDirect(); }, 60);
      return ret;
    };
  }
  const origReplaceState = history.replaceState;
  if (origReplaceState) {
    history.replaceState = function() {
      const ret = origReplaceState.apply(this, arguments);
      setTimeout(() => { checkStateAndRender(); fetchLiveQuotaDirect(); }, 60);
      return ret;
    };
  }

  // 2. Listen to popstate & hashchange
  window.addEventListener('popstate', () => { checkStateAndRender(); fetchLiveQuotaDirect(); });
  window.addEventListener('hashchange', () => { checkStateAndRender(); fetchLiveQuotaDirect(); });

  // 3. Click capture on tabs, conversation items, send/cancel buttons, and model selector dropdowns
  document.addEventListener('click', (e) => {
    const isTab = e.target.closest('[data-testid="conversation-row-sidebar"]') ||
                  e.target.closest('[data-testid="new-conversation-button"]') ||
                  e.target.closest('a[href*="/c/"]') ||
                  e.target.closest('button[data-testid*="conversation"]') ||
                  e.target.closest('.conversation-item');
    const isModelSelector = e.target.closest('[data-testid="model-selector-trigger"]') ||
                            e.target.closest('button[aria-label*="current:"]') ||
                            e.target.closest('button[aria-label*="Select model"]') ||
                            e.target.closest('[role="menuitem"]') ||
                            e.target.closest('[role="option"]');
    const isActionBtn = e.target.closest('[data-tooltip-id*="input-send-button"]') ||
                        e.target.closest('button[aria-label*="Cancel"]') ||
                        e.target.closest('button[aria-label*="Stop"]');
    if (isTab || isModelSelector || isActionBtn) {
      setTimeout(checkStateAndRender, 60);
      setTimeout(() => { checkStateAndRender(); fetchLiveQuotaDirect(); }, 300);
    }
  }, true);

  // 4. Window focus & periodic live quota sync (60s)
  window.addEventListener('focus', () => { checkStateAndRender(); fetchLiveQuotaDirect(); });
  setInterval(fetchLiveQuotaDirect, 60000);

  // 5. Periodic low-frequency heartbeat fallback (600ms) - pure lightweight querySelector reads
  setInterval(checkStateAndRender, 600);

  // 6. Auto-minimize floating panel on Antigravity settings shortcut (Cmd+,)
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === ',' || e.keyCode === 188)) {
      minimizeHandoverPanel();
    }
  });

})();
  `;
}

// Electron Main Process Hook
function initMainProcessHooks() {
  const electron = require('electron');
  const { app, BrowserWindow, shell, ipcMain } = electron;

  // Forbidden window patterns for security & OAuth isolation (R2 Invariant)
  const FORBIDDEN_WINDOW_PATTERNS = [
    /oauth/i,
    /sign\s*in/i,
    /login/i,
    /accounts\.google\.com/i,
    /devtools/i,
    /chrome-devtools/i
  ];

  function isWindowAllowed(win) {
    if (!win || win.isDestroyed() || !win.webContents) return false;
    try {
      const url = win.webContents.getURL() || '';
      const title = win.getTitle() || '';
      for (const pattern of FORBIDDEN_WINDOW_PATTERNS) {
        if (pattern.test(url) || pattern.test(title)) {
          return false;
        }
      }
    } catch (_) {}
    return true;
  }

  function handleRendererAction(action, win) {
    if (!action || !win || !isWindowAllowed(win)) return;

    if (action === 'CHECK_QUOTA') {
      getLatestQuotaData((err, data) => {
        if (!err && data && isWindowAllowed(win)) {
          win.webContents.executeJavaScript(`window.__QUOTA_GUARD_UPDATE__ && window.__QUOTA_GUARD_UPDATE__(${JSON.stringify(data)});`).catch(() => {});
        }
      });
    } else if (action === 'RESET_CONFIG') {
      try {
        if (fs.existsSync(CONFIG_FILE)) {
          const backupPath = path.join(CONFIG_DIR, `config.backup.pre-reset.${Date.now()}.json`);
          fs.copyFileSync(CONFIG_FILE, backupPath);
        }
        saveConfigSafe(DEFAULT_CONFIG);
      } catch (_) {}
    } else if (action.startsWith('SAVE_CONFIG:')) {
      const payload = action.replace('SAVE_CONFIG:', '');
      try {
        const parsed = JSON.parse(payload);
        saveConfigSafe(parsed);
      } catch (_) {}
    } else if (action.startsWith('PLAY_CHIME:')) {
      const soundName = action.replace('PLAY_CHIME:', '');
      playChime(soundName);
    } else if (action === 'OPEN_CHECKPOINTS_DIR') {
      if (!fs.existsSync(CHECKPOINTS_DIR)) fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
      shell.openPath(CHECKPOINTS_DIR);
    } else if (action === 'OPEN_SETTINGS_WINDOW') {
      // Trigger Antigravity application settings shortcut (Cmd+, on macOS)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['command'] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['command'] });
    } else if (action.startsWith('CREATE_SNAPSHOT:')) {
      const metadataPayload = action.replace('CREATE_SNAPSHOT:', '');
      try {
        const metadata = JSON.parse(metadataPayload);
        let snapshotEngine = null;
        try {
          snapshotEngine = require('./snapshot.js');
        } catch (_) {
          try {
            snapshotEngine = require(path.join(__dirname, 'snapshot.js'));
          } catch (_) {
            try {
              snapshotEngine = require('./quota-guard-snapshot.js');
            } catch (_) {}
          }
        }

        if (snapshotEngine && typeof snapshotEngine.createSnapshot === 'function') {
          const onProg = (progress) => {
            if (win && win.webContents && !win.isDestroyed()) {
              win.webContents.executeJavaScript(`
                window.__QUOTA_GUARD_SNAPSHOT_PROGRESS__ && window.__QUOTA_GUARD_SNAPSHOT_PROGRESS__(${JSON.stringify(progress)});
              `).catch(() => {});
            }
          };
          metadata.onProgress = onProg;
          snapshotEngine.createSnapshot(metadata, onProg).catch(err => {
            console.error('[QuotaGuard] createSnapshot error:', err);
          });
        } else {
          console.error('[QuotaGuard] Snapshot engine not found');
        }
      } catch (err) {
        console.error('[QuotaGuard] Failed to parse CREATE_SNAPSHOT metadata:', err);
      }
    } else if (action.startsWith('COPY_HANDOFF:')) {
      const copyPayload = action.replace('COPY_HANDOFF:', '');
      try {
        const parsed = JSON.parse(copyPayload);
        const text = parsed.markdown || parsed.text || '';
        if (text && electron.clipboard) {
          electron.clipboard.writeText(text);
        }
      } catch (_) {}
    } else if (action.startsWith('SHOW_NOTIFICATION:')) {
      const notifPayload = action.replace('SHOW_NOTIFICATION:', '');
      try {
        const parsed = JSON.parse(notifPayload);
        if (electron.Notification && typeof electron.Notification.isSupported === 'function' && electron.Notification.isSupported()) {
          new electron.Notification({
            title: parsed.title || 'Antigravity Quota Guard',
            body: parsed.body || 'Quota safety threshold reached.',
            silent: true
          }).show();
        }
      } catch (_) {}
    } else if (action.startsWith('SYNC_LIVE_DATA:')) {
      const payload = action.replace('SYNC_LIVE_DATA:', '');
      try {
        const parsed = JSON.parse(payload);
        if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
        const liveCacheFile = path.join(RUNTIME_DIR, 'live_quota.json');
        fs.writeFileSync(liveCacheFile, JSON.stringify(parsed, null, 2), 'utf8');
      } catch (_) {}
    }
  }

  // Primary: Electron IPC listener
  if (ipcMain && typeof ipcMain.on === 'function') {
    try { ipcMain.removeAllListeners('QUOTA_GUARD_IPC'); } catch (_) {}
    ipcMain.on('QUOTA_GUARD_IPC', (event, action) => {
      const senderWin = BrowserWindow && typeof BrowserWindow.fromWebContents === 'function'
        ? BrowserWindow.fromWebContents(event.sender)
        : null;
      if (senderWin && isWindowAllowed(senderWin)) {
        handleRendererAction(action, senderWin);
      }
    });
  }

  // Listen to windows
  function hookWindow(win) {
    if (!win || !win.webContents) return;
    if (!isWindowAllowed(win)) return;

    // Secondary / Fallback: console-message listener
    win.webContents.on('console-message', (event, level, message) => {
      if (!isWindowAllowed(win)) return;
      if (typeof message !== 'string' || !message.startsWith('__QUOTA_GUARD_ACTION__:')) return;
      const action = message.replace('__QUOTA_GUARD_ACTION__:', '');
      handleRendererAction(action, win);
    });

    win.webContents.on('dom-ready', () => {
      if (!isWindowAllowed(win)) return;
      const cfg = loadConfigSafe();
      // Fast immediate injection: never block Electron window on network/process scraping!
      const initialQuota = getCachedQuotaQuick() || {
        remaining_percent: null,
        remaining_fraction: null,
        gemini: { fiveHour: null, weekly: null },
        claude_gpt: { fiveHour: null, weekly: null }
      };
      const code = getRendererInjectionCode(cfg, initialQuota);
      win.webContents.executeJavaScript(code).catch(e => console.error('[QuotaGuard] Inject error:', e));
    });
  }

  app.on('browser-window-created', (event, win) => hookWindow(win));
  BrowserWindow.getAllWindows().forEach(hookWindow);

  // Background sync timer
  setInterval(() => {
    const cfg = loadConfigSafe();
    getLatestQuotaData((err, data) => {
      if (!err && data) {
        BrowserWindow.getAllWindows().forEach(win => {
          if (win && win.webContents && isWindowAllowed(win)) {
            win.webContents.executeJavaScript(`window.__QUOTA_GUARD_UPDATE__ && window.__QUOTA_GUARD_UPDATE__(${JSON.stringify(data)});`).catch(() => {});
          }
        });
      }
    });
  }, (loadConfigSafe().sync.refreshIntervalMinutes || 3) * 60 * 1000);
}

module.exports = {
  initMainProcessHooks,
  loadConfigSafe,
  saveConfigSafe,
  getLatestQuotaData,
  playChime,
  classifyModel,
  parseQuotaUsage,
  parseUsageStdout,
  parseUsageOutput,
  parseAgyUsage,
  parseDualBucketUsage,
  parseRpcQuotaData,
  fetchRpcQuotaNode,
  getRunningLanguageServerCredentials,
  getRendererInjectionCode
};
