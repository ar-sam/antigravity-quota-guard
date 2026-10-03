#!/usr/bin/env node
'use strict';

/**
 * Antigravity Quota Guard — Read-Only Diagnostic MCP Server
 * Real stdio JSON-RPC 2.0 MCP server.
 * 
 * Invariants:
 * 1. Zero mutating tools (zero file writes, zero shell execution, zero network requests).
 * 2. Zero secret or credential exposure.
 * 3. All tool names exactly match the PreToolUse allowlist.
 */

const readline = require('readline');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

const COORDINATOR_SOCKET = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'run', 'coordinator.sock');
const RUNTIME_STATE_PATH = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'runtime-state.json');

const SERVER_INFO = {
  name: 'quota_guard',
  version: '2.2.0'
};

const TOOLS = [
  {
    name: 'get_guard_state',
    description: 'Returns current guard state, monotonic revision number, effective quota percentage, and active session count.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_quota_health',
    description: 'Returns quota health state (INIT|FRESH|STALE_GRACE|UNKNOWN_BLOCKED), failure diagnostics, and bucket data.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_checkpoint_status',
    description: 'Returns the status and metadata of the most recent durable checkpoint.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_capability_matrix',
    description: 'Returns the current system capability matrix, operating mode, and version.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
];

// Exported tool names for PreToolUse allowlist
const EXPORTED_READ_ONLY_TOOLS = Object.freeze(TOOLS.map(t => `quota_guard.${t.name}`));

function readRuntimeState() {
  try {
    if (fs.existsSync(RUNTIME_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(RUNTIME_STATE_PATH, 'utf8'));
    }
  } catch (_) {}
  return null;
}

function queryCoordinatorSync() {
  const state = readRuntimeState();
  if (state) return state;
  return { guardState: 'UNKNOWN', effectiveQuota: null, revision: 0, activeSessionCount: 0, failureKind: 'COORDINATOR_UNAVAILABLE' };
}

function executeTool(toolName, _args) {
  const state = queryCoordinatorSync();

  switch (toolName) {
    case 'get_guard_state':
      return {
        guardState: state.guardState || 'UNKNOWN',
        revision: state.revision || 0,
        effectiveQuota: state.effectiveQuota ?? null,
        activeSessionCount: state.activeSessionCount || 0,
        haltedAt: state.haltedAt || null
      };

    case 'get_quota_health':
      return {
        state: state.quotaHealth?.state || state.healthState || 'UNKNOWN',
        failureKind: state.quotaHealth?.failureKind || state.failureKind || 'NONE',
        buckets: state.quotaHealth?.buckets || null,
        source: state.quotaHealth?.source || 'unknown',
        observedAt: state.quotaHealth?.observedAt || null
      };

    case 'get_checkpoint_status':
      return {
        checkpointsEnabled: true,
        status: state.checkpointStatus || 'IDLE',
        lastCheckpointTimestamp: state.lastCheckpointTimestamp || null,
        lastCheckpointPath: state.lastCheckpointPath || null
      };

    case 'get_capability_matrix':
      return {
        version: '2.2.0',
        mode: state.operatingMode || 'standard',
        capabilities: [
          { id: 'OFFICIAL_HOOKS', status: 'VERIFIED' },
          { id: 'CLI_STATUSLINE_TAP', status: state.statuslineFeedActive ? 'VERIFIED' : 'CAPABILITY_UNAVAILABLE' },
          { id: 'SETTINGS_PATH_DOCUMENTED', status: 'VERIFIED' },
          { id: 'SIDECAR_COORDINATOR', status: state.coordinatorRunning ? 'VERIFIED' : 'SIDECAR_AVAILABLE_DISABLED' }
        ]
      };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

function sendResponse(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleRequest(req) {
  const { jsonrpc, method, id, params } = req;

  if (jsonrpc !== '2.0') {
    if (id !== undefined) {
      sendResponse({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
    }
    return;
  }

  // Notifications (no id) — just acknowledge
  if (method === 'notifications/initialized') {
    return; // No response needed
  }

  switch (method) {
    case 'initialize':
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        }
      });
      break;

    case 'tools/list':
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      if (!toolName) {
        sendResponse({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } });
        return;
      }

      try {
        const toolResult = executeTool(toolName, toolArgs);
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
            isError: false
          }
        });
      } catch (err) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: err.message }],
            isError: true
          }
        });
      }
      break;
    }

    default:
      if (id !== undefined) {
        sendResponse({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
  }
}

// Export for backward compatibility with PreToolUse allowlist check
module.exports = { EXPORTED_READ_ONLY_TOOLS };

// Main: start JSON-RPC stdio loop ONLY when executed directly as a standalone process
if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed);
      handleRequest(req);
    } catch (e) {
      sendResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Keep process alive
  process.stdin.resume();
}
