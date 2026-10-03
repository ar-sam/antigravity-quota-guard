'use strict';

/**
 * Antigravity Quota Guard — CLI Statusline Feed Adapter & Multiplexer
 * Transparent tap for official CLI statusline JSON stream.
 * 
 * Invariants:
 * 1. Preserves user's original statusline command byte-for-byte.
 * 2. Backs up full semantic state: { enabled, mode, customCommand, relevantSettingsSnapshot }.
 * 3. On uninstall, completely restores the previous semantic state.
 * 4. Strictly uses nullish coalescing (??) instead of logical OR (||) to preserve 0% and falsy values.
 */

const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { FAILURE_KINDS } = require('../core/quota-contract.js');
const { parseStatuslineQuota, buildQuotaHealthBuckets } = require('../core/quota-policy.js');

function createDefaultCoordinatorClient(socketPath) {
  const sock = socketPath || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'run', 'coordinator.sock');
  return {
    updateQuota: (observation) => {
      return new Promise((resolve) => {
        if (!fs.existsSync(sock)) return resolve(null);
        try {
          const client = net.createConnection(sock, () => {
            client.write(JSON.stringify({ operation: 'UPDATE_QUOTA', payload: { observation } }) + '\n');
          });
          client.on('data', () => { client.end(); resolve(true); });
          client.on('error', () => { resolve(false); });
          client.setTimeout(200, () => { client.destroy(); resolve(false); });
        } catch (_) {
          resolve(false);
        }
      });
    }
  };
}

/**
 * Formats relative reset duration into compact string e.g. "2h 15m", "45m", "1h".
 * @param {number|null} resetInSeconds
 * @param {string|null} resetTimeIso
 * @returns {string}
 */
function formatResetRelative(resetInSeconds, resetTimeIso) {
  if (typeof resetInSeconds === 'number' && resetInSeconds > 0) {
    const totalMinutes = Math.floor(resetInSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${Math.max(1, minutes)}m`;
  }
  if (resetTimeIso) {
    const diffMs = new Date(resetTimeIso).getTime() - Date.now();
    if (diffMs > 0) {
      const totalMinutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h`;
      return `${Math.max(1, minutes)}m`;
    }
  }
  return '--';
}

/**
 * Formats compact statusline indicator per R16.
 * Output: [Quota: 94% | Reset: 2h 15m] or [Quota: --% | Reset: --]
 * @param {object} observation - Normalized observation result
 * @param {string} [locale='en']
 * @returns {string}
 */
function formatCompactIndicator(observation, locale = 'en') {
  if (!observation || !observation.success || !observation.data?.buckets) {
    return '[Quota: --% | Reset: --]';
  }

  const buckets = Object.values(observation.data.buckets);
  if (buckets.length === 0) return '[Quota: --% | Reset: --]';

  // Find lowest remaining percentage
  const percents = buckets.map(b => b.remainingPercent).filter(v => typeof v === 'number');
  const minPercent = percents.length > 0 ? Math.round(Math.min(...percents)) : '--';

  // Find earliest reset
  let earliestSeconds = null;
  let earliestTimeIso = null;
  for (const b of buckets) {
    if (typeof b.resetInSeconds === 'number' && b.resetInSeconds > 0) {
      if (earliestSeconds === null || b.resetInSeconds < earliestSeconds) {
        earliestSeconds = b.resetInSeconds;
      }
    }
    if (b.resetTime) {
      if (!earliestTimeIso || b.resetTime < earliestTimeIso) {
        earliestTimeIso = b.resetTime;
      }
    }
  }

  const resetStr = formatResetRelative(earliestSeconds, earliestTimeIso);
  return `[Quota: ${minPercent}% | Reset: ${resetStr}]`;
}

/**
 * Processes the official statusline payload into a normalized observation object.
 * Extracts: quota buckets, model identity, email, conversation/session ID, agent state.
 * 
 * @param {object} payload - Parsed statusline JSON object
 * @returns {{ buckets, modelId, modelDisplayName, email, conversationId, agentState, observedAt }|null}
 */
function processStatuslinePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const parsedBuckets = parseStatuslineQuota(payload);
  const buckets = buildQuotaHealthBuckets(parsedBuckets);

  return {
    buckets,
    modelId: payload.model?.id ?? null,
    modelDisplayName: payload.model?.display_name ?? null,
    email: payload.email ?? null,
    conversationId: payload.conversation_id ?? payload.session_id ?? null,
    agentState: payload.agent_state ?? 'unknown',
    observedAt: Date.now()
  };
}

class CliStatuslineFeedAdapter {
  constructor(options = {}) {
    this.socketPath = options.socketPath || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'run', 'coordinator.sock');
    this.coordinatorClient = options.coordinatorClient !== undefined
      ? options.coordinatorClient
      : createDefaultCoordinatorClient(this.socketPath);
    this.originalCommand = options.originalCommand ?? null;
    this.failureCount = 0;
    this.circuitOpen = false;
  }

  /**
   * Parses official CLI statusline JSON payload.
   * Returns a normalized observation or failure object.
   */
  parseStatuslineJson(rawJsonString) {
    if (!rawJsonString || typeof rawJsonString !== 'string') {
      return {
        success: false,
        failureKind: FAILURE_KINDS.SCHEMA_MISMATCH,
        error: 'EMPTY_PAYLOAD'
      };
    }

    let payload;
    try {
      payload = JSON.parse(rawJsonString);
    } catch (err) {
      return {
        success: false,
        failureKind: FAILURE_KINDS.SCHEMA_MISMATCH,
        error: 'JSON_SYNTAX_ERROR'
      };
    }

    if (!payload || typeof payload !== 'object') {
      return {
        success: false,
        failureKind: FAILURE_KINDS.SCHEMA_MISMATCH,
        error: 'PAYLOAD_NOT_OBJECT'
      };
    }

    // Invariant: Missing quota object cannot produce FRESH
    if (payload.quota === undefined || payload.quota === null) {
      return {
        success: false,
        failureKind: FAILURE_KINDS.PROVIDER_UNAVAILABLE,
        error: 'NO_QUOTA_SECTION'
      };
    }

    const processed = processStatuslinePayload(payload);
    if (!processed) {
      return {
        success: false,
        failureKind: FAILURE_KINDS.SCHEMA_MISMATCH,
        error: 'PROCESSING_FAILED'
      };
    }

    // Invariant: Quota section exists but contains zero valid numeric buckets -> SCHEMA_MISMATCH
    if (!processed.buckets || Object.keys(processed.buckets).length === 0) {
      return {
        success: false,
        failureKind: FAILURE_KINDS.SCHEMA_MISMATCH,
        error: 'NO_VALID_QUOTA_BUCKETS'
      };
    }

    return {
      success: true,
      data: {
        buckets: processed.buckets,
        accountIdentity: processed.email ?? null,
        modelId: processed.modelId,
        modelDisplayName: processed.modelDisplayName,
        conversationId: processed.conversationId,
        agentState: processed.agentState,
        source: 'cli_statusline',
        observedAt: processed.observedAt,
        confidenceClass: 'HIGH'
      }
    };
  }

  /**
   * Multiplexes incoming statusline input:
   * 1. Parses and dispatches sanitized metrics to coordinator.
   * 2. Forwards raw input to original user command if present.
   * 3. Appends or returns compact quota indicator [Quota: XX% | Reset: ...].
   */
  async processStatuslineTick(rawInput, originalCommand = this.originalCommand) {
    const observation = this.parseStatuslineJson(rawInput);

    if (this.coordinatorClient) {
      try {
        await this.coordinatorClient.updateQuota(observation);
      } catch (_) {}
    }

    const indicator = formatCompactIndicator(observation);

    // Forward byte-for-byte to user's original command
    if (originalCommand) {
      const origOut = await new Promise((resolve) => {
        const proc = spawn(originalCommand, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout.on('data', chunk => { out += chunk; });
        proc.on('close', () => resolve(out));
        proc.on('error', () => resolve(''));
        proc.stdin.on('error', () => {});
        try {
          proc.stdin.write(rawInput);
          proc.stdin.end();
        } catch (_) {}
      });

      // Append compact quota indicator to original command output
      if (origOut.endsWith('\n')) {
        return origOut.slice(0, -1) + ' ' + indicator + '\n';
      }
      return origOut ? `${origOut} ${indicator}` : `${indicator}\n`;
    }

    return `${indicator}\n`;
  }
}

// Executable CLI Statusline Multiplexer
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const net = require('net');

  let originalCommand = null;
  try {
    const configPath = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      originalCommand = cfg.statusline?.originalCommand ?? null;
    }
  } catch (_) {}

  const socketPath = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'run', 'coordinator.sock');
  const coordinatorClient = {
    updateQuota: (observation) => {
      return new Promise((resolve) => {
        if (!fs.existsSync(socketPath)) return resolve(null);
        try {
          const client = net.createConnection(socketPath, () => {
            client.write(JSON.stringify({ operation: 'UPDATE_QUOTA', payload: { observation } }) + '\n');
          });
          client.on('data', () => { client.end(); resolve(true); });
          client.on('error', () => { resolve(false); });
          client.setTimeout(200, () => { client.destroy(); resolve(false); });
        } catch (_) {
          resolve(false);
        }
      });
    }
  };

  const adapter = new CliStatuslineFeedAdapter({ originalCommand, coordinatorClient });

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', async () => {
    if (raw.trim()) {
      const out = await adapter.processStatuslineTick(raw);
      if (out) process.stdout.write(out);
    }
    process.exit(0);
  });
}

module.exports = {
  CliStatuslineFeedAdapter,
  processStatuslinePayload,
  formatCompactIndicator
};
