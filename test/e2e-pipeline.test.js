/**
 * End-to-End Pipeline Integration Test Suite
 * Validates the complete pipeline loop:
 *   1. Quota Telemetry Ingestion (Official statusline dynamic buckets)
 *   2. GlobalCoordinator Unix Socket IPC & CAS Monotonic Revision
 *   3. Dual-Gate Hook Handler & Turn-Boundary Halting ({ terminationBehavior: 'terminate' })
 *   4. Durable Physical Checkpoint Serialization (.json + .md with SHA-256 digest)
 *   5. Diagnostic State Resolution via Read-Only MCP Server (JSON-RPC 2.0 stdio)
 *   6. Dual-Gate PreToolUse Deny-by-Default on Mutating Tools
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawnSync } = require('child_process');

const { GlobalCoordinator } = require('../core/coordinator.js');
const { SnapshotEngine } = require('../core/snapshot-engine.js');
const { HookHandler } = require('../integrations/antigravity-hook/hook-handler.js');
const { parseStatuslineQuota } = require('../core/quota-policy.js');
const { executeTool } = require('../mcp/read-only-server.js');

test('E2E Pipeline: Telemetry -> Coordinator -> Hook -> Checkpoint -> MCP Server', async (t) => {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-e2e-pipeline-'));
  const runDir = path.join(sandboxDir, 'run');
  const socketPath = path.join(runDir, 'coordinator.sock');
  const runtimeStatePath = path.join(sandboxDir, 'runtime-state.json');
  const checkpointsDir = path.join(sandboxDir, 'checkpoints');
  const brainDir = path.join(sandboxDir, 'brain', 'e2e-test-session');
  const logsDir = path.join(brainDir, '.system_generated', 'logs');

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(checkpointsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  // Mock conversation transcript and artifact file
  const transcriptPath = path.join(logsDir, 'transcript.jsonl');
  const mockTranscript = [
    JSON.stringify({ step_index: 1, type: 'USER_INPUT', content: 'Please review the system architecture.' }),
    JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', content: 'Architecture reviewed successfully. All subsystems green.' })
  ].join('\n') + '\n';
  fs.writeFileSync(transcriptPath, mockTranscript, 'utf8');

  const mockArtifactPath = path.join(brainDir, 'architecture_plan.md');
  fs.writeFileSync(mockArtifactPath, '# Architecture Plan\n\n- Zero mutations outside sandbox.\n- High reliability.\n', 'utf8');

  // Instantiate Coordinator
  const coordinator = new GlobalCoordinator({
    runDir,
    socketPath,
    runtimeStatePath
  });

  t.after(async () => {
    try {
      await coordinator.stop();
    } catch (_) {}
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // Step 1: Start Coordinator Daemon
  await t.test('1. Coordinator binds socket and claims single-leader PID lock', async () => {
    await coordinator.start();
    assert.ok(fs.existsSync(socketPath), 'Unix domain socket must exist');
    const pidFile = path.join(runDir, 'coordinator.pid');
    assert.ok(fs.existsSync(pidFile), 'PID lockfile must exist');
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    assert.strictEqual(pid, process.pid, 'PID file must contain current process PID');
  });

  // Step 2: Push Official Quota Telemetry via Socket IPC
  await t.test('2. Telemetry ingestion via Unix socket updates health and derives runtime-state.json', async () => {
    const rawStatuslinePayload = {
      model: { id: 'gemini-2.0-flash', display_name: 'Gemini 2.0 Flash' },
      email: 'engineer@developer.local',
      conversation_id: 'e2e-test-session',
      quota: {
        'gemini-weekly': {
          remaining_fraction: 0.10, // 10% -> triggers HALT_PENDING (<= 12%)
          reset_time: '2026-10-04T12:00:00Z',
          reset_in_seconds: 7200
        }
      }
    };

    const parsedBuckets = parseStatuslineQuota(rawStatuslinePayload);
    assert.strictEqual(parsedBuckets.length, 1);
    assert.strictEqual(parsedBuckets[0].remainingPercent, 10);

    // Send UPDATE_QUOTA command through Unix socket client
    const response = await new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath, () => {
        client.write(JSON.stringify({
          operation: 'UPDATE_QUOTA',
          requestId: 'req-e2e-1',
          payload: {
            observation: {
              success: true,
              source: 'cli_statusline',
              data: {
                buckets: {
                  'gemini-weekly': {
                    remainingPercent: 10,
                    remainingFraction: 0.10,
                    resetTime: '2026-10-04T12:00:00Z',
                    resetInSeconds: 7200,
                    category: 'gemini'
                  }
                }
              }
            }
          }
        }) + '\n');
      });

      let buf = '';
      client.on('data', chunk => {
        buf += chunk.toString();
        if (buf.includes('\n')) {
          const lines = buf.split('\n').map(l => l.trim()).filter(Boolean);
          // Find the matching response line (has requestId or success)
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.requestId === 'req-e2e-1' || parsed.success !== undefined) {
                client.end();
                return resolve(parsed);
              }
            } catch (_) {}
          }
        }
      });
      client.on('error', reject);
    });

    assert.strictEqual(response.success, true);
    assert.ok(response.revision > 0, 'Revision must advance monotonically');
    assert.strictEqual(response.data.guardState, 'HALT_PENDING');

    // Verify derived projection file on disk
    assert.ok(fs.existsSync(runtimeStatePath), 'runtime-state.json must be written');
    const diskState = JSON.parse(fs.readFileSync(runtimeStatePath, 'utf8'));
    assert.strictEqual(diskState.guardState, 'HALT_PENDING');
    assert.strictEqual(diskState.effectiveQuota, 10);
  });

  // Step 3: Hook Handler Evaluates State and Halts at Turn Boundary
  let savedCheckpointPath = null;
  await t.test('3. PostInvocation hook halts execution loop and triggers durable snapshot', async () => {
    const snapshotEngine = new SnapshotEngine({
      checkpointsDir,
      retentionCount: 5
    });

    const hookHandler = new HookHandler({
      initialState: 'SAFE',
      snapshotEngine,
      stopPercent: 12
    });

    // Provide context with depleted quota (10%) and session paths
    const context = {
      conversationId: 'e2e-test-session',
      modelName: 'gemini-2.0-flash',
      transcriptPath,
      artifactDirectoryPath: brainDir,
      quotaHealth: {
        buckets: {
          'gemini-weekly': { remainingPercent: 10, remainingFraction: 0.10, category: 'gemini' }
        }
      }
    };

    const hookResult = await hookHandler.handlePostInvocation(context);

    // Contract: must terminate model execution loop
    assert.strictEqual(hookResult.terminationBehavior, 'terminate');
    assert.strictEqual(hookResult.reason, 'QUOTA_SAFETY_THRESHOLD_REACHED');
    assert.strictEqual(hookHandler.state, 'HALTED');

    // Verify physical checkpoint on disk
    const checkpointFiles = fs.readdirSync(checkpointsDir);
    const jsonFile = checkpointFiles.find(f => f.endsWith('.json'));
    const mdFile = checkpointFiles.find(f => f.endsWith('.md'));

    assert.ok(jsonFile, 'Structured checkpoint JSON must be persisted');
    assert.ok(mdFile, 'Markdown companion recovery document must be persisted');

    savedCheckpointPath = path.join(checkpointsDir, mdFile);
    const mdContent = fs.readFileSync(savedCheckpointPath, 'utf8');
    assert.ok(mdContent.includes('10%'), 'Markdown must record 10% effective quota');
    assert.ok(mdContent.includes('gemini-2.0-flash'), 'Markdown must identify active model');
    assert.ok(mdContent.includes('architecture_plan.md'), 'Markdown must list active artifact');
  });

  // Step 4: MCP Server Diagnostic Query
  await t.test('4. Read-Only MCP server returns accurate system diagnostics from disk state', async () => {
    process.env.QUOTA_GUARD_RUNTIME_STATE = runtimeStatePath;

    // Direct tool execution verification
    const guardState = executeTool('get_guard_state');
    assert.strictEqual(guardState.guardState, 'HALT_PENDING');
    assert.strictEqual(guardState.effectiveQuota, 10);

    const quotaHealth = executeTool('get_quota_health');
    assert.strictEqual(quotaHealth.state, 'FRESH');
    assert.ok(quotaHealth.buckets['gemini-weekly']);

    const capabilityMatrix = executeTool('get_capability_matrix');
    assert.strictEqual(capabilityMatrix.version, '2.2.0');
    assert.ok(Array.isArray(capabilityMatrix.capabilities));

    // Stdio JSON-RPC 2.0 protocol round-trip verification
    const mcpScript = path.join(__dirname, '../mcp/read-only-server.js');
    const rpcInput = JSON.stringify({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'get_guard_state',
        arguments: {}
      }
    }) + '\n';

    const rpcProc = spawnSync('node', [mcpScript], {
      input: rpcInput,
      encoding: 'utf8',
      env: { ...process.env, QUOTA_GUARD_RUNTIME_STATE: runtimeStatePath }
    });

    assert.strictEqual(rpcProc.status, 0);
    const rpcResponse = JSON.parse(rpcProc.stdout.trim());
    assert.strictEqual(rpcResponse.id, 101);
    assert.strictEqual(rpcResponse.result.isError, false);
    assert.ok(rpcResponse.result.content[0].text.includes('HALT_PENDING'));
  });

  // Step 5: Dual-Gate PreToolUse Deny-by-Default
  await t.test('5. PreToolUse enforces fail-closed safety on side-effecting tools while permitting MCP tools', async () => {
    const hookHandler = new HookHandler({
      initialState: 'HALTED'
    });

    // 5a: Mutating file write must be denied
    const writeAttempt = await hookHandler.handlePreToolUse({
      toolCall: { name: 'write_to_file', args: { path: '/tmp/test.txt' } },
      conversationId: 'e2e-test-session'
    });
    assert.strictEqual(writeAttempt.decision, 'deny');
    assert.strictEqual(writeAttempt.reason, 'QUOTA_GUARD_HALTED');

    // 5b: Mutating shell execution must be denied
    const execAttempt = await hookHandler.handlePreToolUse({
      toolCall: { name: 'run_command', args: { command: 'ls' } },
      conversationId: 'e2e-test-session'
    });
    assert.strictEqual(execAttempt.decision, 'deny');

    // 5c: Read-only MCP diagnostic tool in allowlist must be allowed
    const mcpAttempt = await hookHandler.handlePreToolUse({
      toolCall: { name: 'quota_guard.get_guard_state', args: {} },
      conversationId: 'e2e-test-session'
    });
    assert.strictEqual(mcpAttempt.decision, 'allow');
  });
});
