#!/usr/bin/env node
'use strict';

/**
 * Antigravity Quota Guard — Hook CLI Bridge
 * Bridges official Antigravity command-based hooks (stdin JSON → stdout JSON)
 * to the internal HookHandler Node.js module.
 * 
 * Usage: node cli-bridge.js <HookEvent>
 * Events: PreInvocation | PreToolUse | PostInvocation | Stop
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const { HookHandler } = require('./hook-handler.js');

function sendCoordinatorOperation(operation, payload = {}) {
  return new Promise((resolve) => {
    const socketPath = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'run', 'coordinator.sock');
    if (!fs.existsSync(socketPath)) return resolve(null);
    try {
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({ operation, payload }) + '\n');
      });
      client.on('data', (d) => {
        try { resolve(JSON.parse(d.toString().trim())); } catch (_) { resolve(null); }
        client.end();
      });
      client.on('error', () => resolve(null));
      client.setTimeout(150, () => { client.destroy(); resolve(null); });
    } catch (_) {
      resolve(null);
    }
  });
}

function loadRuntimeState() {
  const baseDir = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
  const statePath = path.join(baseDir, 'runtime-state.json');
  const configPath = path.join(baseDir, 'config.json');

  let state = 'SAFE';
  let quotaHealth = null;
  let stopPercent = 12;

  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg?.thresholds?.stopPercent !== undefined) {
        stopPercent = cfg.thresholds.stopPercent;
      }
    }
  } catch (_) {}

  try {
    if (fs.existsSync(statePath)) {
      const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (stateData.guardState) {
        state = stateData.guardState;
      } else if (stateData.state) {
        state = stateData.state;
      }
      quotaHealth = stateData.quotaHealth || null;
    }
  } catch (_) {}

  return { state, quotaHealth, stopPercent };
}

async function main() {
  const eventType = process.argv[2];
  if (!eventType) {
    process.stderr.write('Usage: cli-bridge.js <PreInvocation|PreToolUse|PostInvocation|Stop>\n');
    process.exit(1);
  }

  // Read full stdin
  let rawInput = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    rawInput += chunk;
  }

  let context = {};
  if (rawInput.trim()) {
    try {
      context = JSON.parse(rawInput);
    } catch (e) {
      process.stderr.write(`cli-bridge: invalid JSON input: ${e.message}\n`);
      // Fail-closed safe response per hook type (deny on tool execution error)
      const safeResponses = {
        PreInvocation: {},
        PreToolUse: { decision: 'deny', reason: 'HOOK_INPUT_SYNTAX_ERROR' },
        PostInvocation: {},
        Stop: { decision: 'stop' }
      };
      process.stdout.write(JSON.stringify(safeResponses[eventType] || {}) + '\n');
      process.exit(0);
    }
  }

  // Load authoritative runtime state from Coordinator's derived projection
  const runtime = loadRuntimeState();
  const handler = new HookHandler({
    initialState: runtime.state,
    stopPercent: runtime.stopPercent
  });
  if (runtime.quotaHealth && !context.quotaHealth) {
    context.quotaHealth = runtime.quotaHealth;
  }

  let result = {};
  try {
    switch (eventType) {
      case 'PreInvocation':
        result = await handler.handlePreInvocation(context);
        break;
      case 'PreToolUse':
        result = await handler.handlePreToolUse(context);
        break;
      case 'PostInvocation':
        result = await handler.handlePostInvocation(context);
        if (result && result.terminationBehavior === 'terminate') {
          await sendCoordinatorOperation('TRANSITION_TO_HALTED', { reason: result.reason });
        }
        break;
      case 'Stop':
        result = await handler.handleStop(context);
        if (handler.state === 'HALTED_BACKGROUND_ACTIVE') {
          await sendCoordinatorOperation('TRANSITION_TO_BACKGROUND_ACTIVE');
        }
        break;
      default:
        process.stderr.write(`cli-bridge: unknown event type: ${eventType}\n`);
        result = {};
    }
  } catch (err) {
    process.stderr.write(`cli-bridge: handler error: ${err.message}\n`);
    // Fail-closed fallback per hook type
    const safeResults = {
      PreInvocation: {},
      PreToolUse: { decision: 'deny', reason: 'HOOK_EXECUTION_FAILURE' },
      PostInvocation: {},
      Stop: { decision: 'stop' }
    };
    result = safeResults[eventType] || {};
  }

  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch(err => {
  process.stderr.write(`cli-bridge: fatal: ${err.message}\n`);
  process.exit(0); // Exit 0 to not break Antigravity execution
});
