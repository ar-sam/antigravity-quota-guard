'use strict';

/**
 * Phase 3 Gate Test: Dual-Gate Antigravity Hooks & Read-Only MCP
 * Updated for V2.2 official Antigravity contracts.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { HookHandler } = require('../integrations/antigravity-hook/hook-handler.js');
const { EXPORTED_READ_ONLY_TOOLS } = require('../mcp/read-only-server.js');
// Note: mcp/read-only-server.js is now a real stdio JSON-RPC server, not a class.
// EXPORTED_READ_ONLY_TOOLS is the canonical allowlist.

describe('Phase 3: Dual-Gate Antigravity Hooks & Read-Only MCP', () => {

  describe('3.1 Read-Only MCP Tool Allowlist', () => {
    it('Exports strictly the 4 canonical read-only diagnostic tools', () => {
      // EXPORTED_READ_ONLY_TOOLS is a frozen array of tool names
      assert.strictEqual(EXPORTED_READ_ONLY_TOOLS.length, 4);
      assert.ok(EXPORTED_READ_ONLY_TOOLS.includes('quota_guard.get_guard_state'));
      assert.ok(EXPORTED_READ_ONLY_TOOLS.includes('quota_guard.get_quota_health'));
      assert.ok(EXPORTED_READ_ONLY_TOOLS.includes('quota_guard.get_checkpoint_status'));
      assert.ok(EXPORTED_READ_ONLY_TOOLS.includes('quota_guard.get_capability_matrix'));
    });

    it('All tool names follow quota_guard.<name> namespace convention', () => {
      const allNamespaced = EXPORTED_READ_ONLY_TOOLS.every(t => t.startsWith('quota_guard.'));
      assert.ok(allNamespaced, 'All tools use quota_guard. namespace');
    });

    it('Zero mutating tool names in allowlist', () => {
      const mutatingKeywords = ['delete', 'write', 'run', 'exec', 'create', 'modify', 'update', 'set', 'patch'];
      for (const tool of EXPORTED_READ_ONLY_TOOLS) {
        const lower = tool.toLowerCase();
        for (const kw of mutatingKeywords) {
          assert.ok(!lower.includes(kw), `Allowlisted tool "${tool}" must not be mutating (contains "${kw}")`);
        }
      }
    });
  });

  describe('3.2 Dual-Gate Hook Handler', () => {
    it('PreInvocation provides advisory context only and never hard-blocks', async () => {
      const handler = new HookHandler({ stopPercent: 12 });
      const context = {
        modelName: 'gemini-1.5-pro',
        // Official format: quotaHealth with buckets map
        quotaHealth: {
          buckets: {
            'gemini-weekly': { remainingPercent: 18, remainingFraction: 0.18, category: 'gemini' }
          }
        }
      };

      const res = await handler.handlePreInvocation(context);
      assert.ok(res.injectSteps, 'Must inject advisory steps when quota <= 20%');
      assert.strictEqual(res.block, undefined, 'Must not claim unsupported blocking fields');

      // injectSteps must be array of objects with ephemeralMessage (official contract)
      assert.ok(Array.isArray(res.injectSteps), 'injectSteps must be an array');
      const step = res.injectSteps[0];
      assert.ok(typeof step === 'object' && !Array.isArray(step), 'injectSteps[0] must be an object');
      assert.ok(typeof step.ephemeralMessage === 'string', 'injectSteps[0].ephemeralMessage must be a string');
    });

    it('PreToolUse denies side-effecting tools when state is HALTED', async () => {
      const handler = new HookHandler({ initialState: 'HALTED' });

      // Official contract: tool name in toolCall.name (not top-level toolName)
      const denyRes = await handler.handlePreToolUse({ toolCall: { name: 'run_command', args: {} } });
      assert.strictEqual(denyRes.decision, 'deny');
      assert.strictEqual(denyRes.reason, 'QUOTA_GUARD_HALTED');

      const editRes = await handler.handlePreToolUse({ toolCall: { name: 'replace_file_content', args: {} } });
      assert.strictEqual(editRes.decision, 'deny');
    });

    it('PreToolUse permits read-only MCP allowlist tools even when HALTED', async () => {
      const handler = new HookHandler({ initialState: 'HALTED' });

      for (const tool of EXPORTED_READ_ONLY_TOOLS) {
        // Official payload: toolCall.name
        const allowRes = await handler.handlePreToolUse({ toolCall: { name: tool, args: {} } });
        assert.strictEqual(allowRes.decision, 'allow');
        assert.strictEqual(allowRes.reason, 'READ_ONLY_RECOVERY_ALLOWLIST');
      }
    });

    it('PreToolUse permits tools when valid session unmonitored bypass token is present', async () => {
      const handler = new HookHandler({ initialState: 'HALTED' });
      const bypassToken = { surfaceInstanceId: 'inst-1', conversationId: 'c1' };

      // Official payload: toolCall.name + bypassToken at top level
      const allowRes = await handler.handlePreToolUse({
        toolCall: { name: 'run_command', args: {} },
        bypassToken
      });
      assert.strictEqual(allowRes.decision, 'allow');
      assert.strictEqual(allowRes.reason, 'UNMONITORED_BYPASS_ACKNOWLEDGED');
    });

    it('PostInvocation issues terminationBehavior: terminate when quota <= stopPercent', async () => {
      let snapshotCalled = false;
      const mockSnapshot = {
        createCheckpoint: async () => { snapshotCalled = true; }
      };

      const handler = new HookHandler({
        stopPercent: 12,
        snapshotEngine: mockSnapshot
      });

      const context = {
        conversationId: 'convo-123',
        modelName: 'claude-3-5-sonnet',
        // Official format: buckets map
        quotaHealth: {
          buckets: {
            'claude-weekly': { remainingPercent: 11, remainingFraction: 0.11, category: 'claude' }
          }
        }
      };

      const res = await handler.handlePostInvocation(context);
      assert.strictEqual(res.terminationBehavior, 'terminate');
      assert.strictEqual(res.reason, 'QUOTA_SAFETY_THRESHOLD_REACHED');
      assert.strictEqual(snapshotCalled, true, 'Must trigger snapshot engine on turn boundary halt');
      assert.strictEqual(handler.state, 'HALTED');
    });

    it('Stop hook handles fullyIdle: false by entering HALTED_BACKGROUND_ACTIVE and returning {"decision": "stop"}', async () => {
      const handler = new HookHandler({ initialState: 'HALTED' });

      const res = await handler.handleStop({ fullyIdle: false });
      // Official Stop contract: return {"decision": "stop"}; NEVER return decision: "continue"
      assert.strictEqual(res.decision, 'stop', 'Stop must return {"decision": "stop"}');
      assert.notStrictEqual(res.decision, 'continue', 'Must NEVER return decision: "continue"');
      assert.strictEqual(res.status, undefined, 'Must NOT return {status} (not official contract)');
      assert.strictEqual(handler.state, 'HALTED_BACKGROUND_ACTIVE', 'Internal state updated to HALTED_BACKGROUND_ACTIVE');
    });

    it('CLI Bridge creates physical checkpoint file on disk when PostInvocation quota <= stopPercent', async () => {
      const { spawnSync } = require('child_process');
      const bridgeScript = path.join(__dirname, '../integrations/antigravity-hook/cli-bridge.js');
      const tmpCheckpoints = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-hook-snap-'));

      const input = JSON.stringify({
        conversationId: 'real-convo-test',
        modelName: 'claude-3-5-sonnet',
        quotaHealth: {
          buckets: {
            'claude-weekly': { remainingPercent: 10, remainingFraction: 0.10, category: 'claude' }
          }
        }
      });

      const proc = spawnSync('node', [bridgeScript, 'PostInvocation'], {
        input,
        encoding: 'utf8',
        env: { ...process.env, QUOTA_GUARD_CHECKPOINTS_DIR: tmpCheckpoints }
      });

      assert.strictEqual(proc.status, 0);
      const out = JSON.parse(proc.stdout.trim());
      assert.strictEqual(out.terminationBehavior, 'terminate');

      const files = fs.readdirSync(tmpCheckpoints);
      const jsonFile = files.find(f => f.endsWith('.json'));
      const mdFile = files.find(f => f.endsWith('.md'));

      assert.ok(jsonFile, 'Must create real .json checkpoint file on disk');
      assert.ok(mdFile, 'Must create real .md companion recovery document on disk');

      fs.rmSync(tmpCheckpoints, { recursive: true, force: true });
    });
  });

});
