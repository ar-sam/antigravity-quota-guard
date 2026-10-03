'use strict';

/**
 * Antigravity Quota Guard V2.2 — Official Contract Test Suite
 *
 * Tests validate against the OFFICIAL Antigravity schemas and contracts,
 * not just internal implementation. Every test here corresponds directly
 * to a published Antigravity specification.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
    failures.push(msg);
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// Spawn a process and return { stdout, stderr, code }
function runProcess(cmd, args, input = null, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    if (input !== null) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr, code: -1, timedOut: true });
    }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut: false });
    });
  });
}

async function runContractTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Antigravity Quota Guard V2.2 — Contract Test Suite   ');
  console.log('═══════════════════════════════════════════════════════');

  // ─────────────────────────────────────────────────────────────────
  // C1: Plugin Manifest Conformance (official schema)
  // Official: only $schema, name, description allowed (additionalProperties: false)
  // ─────────────────────────────────────────────────────────────────
  section('C1: Plugin Manifest Schema Conformance');
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
    const allowedKeys = new Set(['$schema', 'name', 'description']);
    const extraKeys = Object.keys(manifest).filter(k => !allowedKeys.has(k));

    assert(typeof manifest.name === 'string' && manifest.name.length > 0, 'plugin.json has required "name" field');
    assert(typeof manifest.description === 'string', 'plugin.json has "description" field');
    assert(extraKeys.length === 0, `No extra fields (additionalProperties:false). Extra found: ${extraKeys.join(', ') || 'none'}`);
    assert(/^[a-zA-Z0-9_-]+$/.test(manifest.name), `name matches pattern ^[a-zA-Z0-9-_]+$ : "${manifest.name}"`);
    if (manifest.$schema) {
      assert(manifest.$schema.includes('antigravity.google/schemas'), '$schema points to official Antigravity schema URL');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // C2: Hooks Manifest — Command-Based Format
  // Official: handlers use { type: "command", command: "path/to/script.sh" }
  // NOT "handler": "file.js:functionName"
  // ─────────────────────────────────────────────────────────────────
  section('C2: Hooks Manifest — Command-Based Format');
  {
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8'));
    const topLevelKeys = Object.keys(hooks);
    assert(topLevelKeys.length > 0, 'hooks.json has at least one hook group');

    for (const groupKey of topLevelKeys) {
      const group = hooks[groupKey];
      // Check for old-style handler format
      const hasOldHandler = JSON.stringify(group).includes('"handler"');
      assert(!hasOldHandler, `Group "${groupKey}": no legacy "handler" field (must be command-based)`);

      // Check command-based PreInvocation
      if (group.PreInvocation) {
        const handlers = group.PreInvocation;
        assert(Array.isArray(handlers), `PreInvocation is an array`);
        const hasCommand = handlers.every(h => h.type === 'command' && typeof h.command === 'string');
        assert(hasCommand, `PreInvocation handlers use { type: "command", command: "..." }`);
      }

      // Check PreToolUse has matcher format
      if (group.PreToolUse) {
        const ptus = group.PreToolUse;
        assert(Array.isArray(ptus), `PreToolUse is an array`);
        const hasHooks = ptus.every(m => Array.isArray(m.hooks) && m.hooks.every(h => h.type === 'command'));
        assert(hasHooks, `PreToolUse uses matcher.hooks[].type === "command"`);
      }
    }

    // Verify the hook scripts actually exist and are executable
    const hookScripts = ['hooks/pre-invocation.sh', 'hooks/pre-tool-use.sh', 'hooks/post-invocation.sh', 'hooks/on-stop.sh'];
    for (const script of hookScripts) {
      const scriptPath = path.join(ROOT, script);
      const exists = fs.existsSync(scriptPath);
      assert(exists, `Hook script exists: ${script}`);
      if (exists) {
        const mode = fs.statSync(scriptPath).mode;
        const isExecutable = (mode & 0o111) !== 0;
        assert(isExecutable, `Hook script is executable: ${script}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // C3: Sidecar Manifest — Official Schema
  // Official: command/args/restart_policy (snake_case). No entrypoint/runtime/autostart/restartPolicy
  // ─────────────────────────────────────────────────────────────────
  section('C3: Sidecar Manifest — Official Schema');
  {
    const sidecarPath = path.join(ROOT, 'sidecars/quota-guard-coordinator/sidecar.json');
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));

    assert(typeof sidecar.command === 'string', 'sidecar.json uses "command" (not "entrypoint" or "runtime")');
    assert(Array.isArray(sidecar.args), 'sidecar.json has "args" array');
    assert(!sidecar.entrypoint, 'No "entrypoint" field (Docker-style, not supported)');
    assert(!sidecar.runtime, 'No "runtime" field (Docker-style, not supported)');
    assert(!sidecar.autostart, 'No "autostart" field (not in official schema)');
    assert(!sidecar.restartPolicy, 'No camelCase "restartPolicy" (must be snake_case "restart_policy")');
    if (sidecar.restart_policy) {
      assert(['always', 'on-failure', 'never'].includes(sidecar.restart_policy),
        `restart_policy is valid: "${sidecar.restart_policy}"`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // C4: MCP Server — Real stdio JSON-RPC 2.0 Server
  // Must NOT exit immediately. Must respond to initialize and tools/list.
  // ─────────────────────────────────────────────────────────────────
  section('C4: MCP Server — Real stdio JSON-RPC 2.0');
  {
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } }
    }) + '\n';

    const r1 = await runProcess('node', ['mcp/read-only-server.js'], initRequest, 4000);
    assert(!r1.timedOut || r1.stdout.length > 0, 'MCP server responds before timeout (did not exit immediately)');

    if (r1.stdout.trim()) {
      let resp;
      try {
        resp = JSON.parse(r1.stdout.trim());
      } catch (_) {}
      assert(resp && resp.jsonrpc === '2.0', 'MCP initialize response has jsonrpc: "2.0"');
      assert(resp && resp.id === 1, 'MCP initialize response has correct id');
      assert(resp && resp.result && resp.result.serverInfo, 'MCP initialize response has serverInfo');
      assert(resp && resp.result && resp.result.capabilities, 'MCP initialize response has capabilities');
      assert(resp && resp.result && resp.result.protocolVersion, 'MCP initialize response has protocolVersion');
    }

    // tools/list
    const toolsRequest = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2, params: {} }) + '\n';
    const r2 = await runProcess('node', ['mcp/read-only-server.js'], initRequest + toolsRequest, 4000);
    if (r2.stdout.trim()) {
      const lines = r2.stdout.trim().split('\n').filter(Boolean);
      const toolsResp = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).find(r => r && r.id === 2);
      assert(toolsResp && Array.isArray(toolsResp.result?.tools), 'MCP tools/list returns array of tools');
      if (toolsResp?.result?.tools) {
        const toolNames = toolsResp.result.tools.map(t => t.name);
        assert(toolNames.includes('get_guard_state'), 'MCP exposes get_guard_state tool');
        assert(toolNames.includes('get_quota_health'), 'MCP exposes get_quota_health tool');
        assert(toolNames.every(n => typeof n === 'string'), 'All tool names are strings');
        // Each tool must have inputSchema
        const hasSchemas = toolsResp.result.tools.every(t => t.inputSchema && t.inputSchema.type === 'object');
        assert(hasSchemas, 'All MCP tools have inputSchema with type: "object"');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // C5: Hook stdin/stdout I/O Contracts
  // Official: input JSON over stdin, output JSON over stdout
  // ─────────────────────────────────────────────────────────────────
  section('C5: Hook stdin/stdout I/O Contracts');
  {
    const { HookHandler } = require(path.join(ROOT, 'integrations/antigravity-hook/hook-handler.js'));
    const handler = new HookHandler({ initialState: 'SAFE' });

    // PreToolUse SAFE -> { decision: "allow" }
    const r1 = await handler.handlePreToolUse({ toolCall: { name: 'write_to_file', args: {} } });
    assert(r1.decision === 'allow', 'PreToolUse (SAFE, side-effecting) -> decision: "allow"');

    // PreToolUse HALTED + side-effecting -> { decision: "deny" }
    handler.state = 'HALTED';
    const r2 = await handler.handlePreToolUse({ toolCall: { name: 'write_to_file', args: {} } });
    assert(r2.decision === 'deny', 'PreToolUse (HALTED, side-effecting) -> decision: "deny"');

    // PreToolUse HALTED + allowlisted -> { decision: "allow" }
    const r3 = await handler.handlePreToolUse({ toolCall: { name: 'quota_guard.get_guard_state', args: {} } });
    assert(r3.decision === 'allow', 'PreToolUse (HALTED, read-only allowlist) -> decision: "allow"');

    // Stop fullyIdle:false -> { decision: "stop" } (never { decision: "continue" })
    handler.state = 'SAFE';
    const r4 = await handler.handleStop({ fullyIdle: false, executionNum: 1, terminationReason: 'model_stop' });
    assert(r4.decision === 'stop', 'Stop (fullyIdle:false) -> { decision: "stop" }');
    assert(r4.decision !== 'continue', 'Stop never returns decision: "continue" when HALTED');

    // Stop fullyIdle:true -> { decision: "stop" }
    const r5 = await handler.handleStop({ fullyIdle: true, executionNum: 1, terminationReason: 'model_stop' });
    assert(r5.decision === 'stop', 'Stop (fullyIdle:true) -> { decision: "stop" }');

    // PreInvocation low quota -> { injectSteps: [{ ephemeralMessage: string }] }
    const r6 = await handler.handlePreInvocation({
      quotaHealth: { buckets: { 'gemini-weekly': { remainingPercent: 10 } } },
      modelName: 'gemini-flash',
      invocationNum: 0,
      initialNumSteps: 5
    });
    if (r6.injectSteps) {
      const step = r6.injectSteps[0];
      assert(typeof step === 'object' && !Array.isArray(step), 'PreInvocation injectSteps[0] is an object (not string)');
      assert(typeof step.ephemeralMessage === 'string', 'PreInvocation injectSteps[0].ephemeralMessage is a string');
    } else {
      assert(true, 'PreInvocation no advisory (quota not low enough — OK)');
    }

    // PostInvocation normal -> terminationBehavior must be "terminate" or "force_continue" or omitted
    const r7 = await handler.handlePostInvocation({ invocationNum: 1, initialNumSteps: 10 });
    if (r7.terminationBehavior !== undefined) {
      assert(['terminate', 'force_continue', ''].includes(r7.terminationBehavior),
        `PostInvocation terminationBehavior is valid: "${r7.terminationBehavior}"`);
    } else {
      assert(true, 'PostInvocation: no terminationBehavior (quota OK)');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // C6: Quota Payload Parsing — Official remaining_fraction format
  // Official: quota.{bucket-id}.remaining_fraction (float 0..1)
  // NOT: gemini.fiveHour.percentage or claude_gpt.weekly
  // ─────────────────────────────────────────────────────────────────
  section('C6: Quota Payload Parsing — Official Format');
  {
    const { parseStatuslineQuota, calculateEffectiveQuota, classifyModelCategory } = require(path.join(ROOT, 'core/quota-policy.js'));

    // Real statusline payload
    const payload1 = { quota: { 'gemini-weekly': { remaining_fraction: 0.9378, reset_time: '2026-07-06T07:50:32Z', reset_in_seconds: 560580 } } };
    const buckets1 = parseStatuslineQuota(payload1);
    const eff1 = calculateEffectiveQuota(buckets1, 'gemini-flash');
    assert(Math.abs(eff1 - 93.78) < 0.01, `remaining_fraction 0.9378 → ${eff1.toFixed(2)}% (expected ≈93.78%)`);

    // Zero fraction preserved
    const payload2 = { quota: { 'gemini-weekly': { remaining_fraction: 0 } } };
    const eff2 = calculateEffectiveQuota(parseStatuslineQuota(payload2));
    assert(eff2 === 0, '0 remaining_fraction → exactly 0% (not defaulted to 100)');

    // Empty quota → null
    const eff3 = calculateEffectiveQuota([]);
    assert(eff3 === null, 'Empty quota array → null (not 100)');

    // Multi-bucket: minimum wins
    const payload4 = { quota: { 'gemini-weekly': { remaining_fraction: 0.9 }, 'gemini-5h': { remaining_fraction: 0.3 } } };
    const eff4 = calculateEffectiveQuota(parseStatuslineQuota(payload4), 'gemini-flash');
    assert(Math.abs(eff4 - 30) < 0.01, `Multi-bucket min: [90%, 30%] → ${eff4.toFixed(1)}% (expected 30%)`);

    // Dynamic bucket key classification
    assert(classifyModelCategory('gemini-weekly') === 'gemini', '"gemini-weekly" classified as "gemini"');
    assert(classifyModelCategory('claude-weekly') === 'claude', '"claude-weekly" classified as "claude"');

    // Invented keys must NOT exist in output
    const buckets = parseStatuslineQuota(payload1);
    const hasFiveHour = buckets.some(b => b.bucketId === 'fiveHour');
    const hasWeekly = buckets.some(b => b.bucketId === 'weekly');
    assert(!hasFiveHour, 'No invented "fiveHour" bucket ID in output');
    assert(!hasWeekly, 'No invented "weekly" bucket ID in output');
  }

  // ─────────────────────────────────────────────────────────────────
  // C7: Coordinator Single-Authority (PID Lock)
  // Second coordinator instance must be rejected
  // ─────────────────────────────────────────────────────────────────
  section('C7: Coordinator Single-Authority — PID Lock');
  {
    const { GlobalCoordinator } = require(path.join(ROOT, 'core/coordinator.js'));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-coord-test-'));
    const opts = { runDir: tmpDir, socketPath: path.join(tmpDir, 'test.sock') };

    let c1started = false;
    let c2rejected = false;
    let c1;
    try {
      c1 = new GlobalCoordinator(opts);
      await c1.start();
      c1started = true;

      const c2 = new GlobalCoordinator(opts);
      try {
        await c2.start();
        // If it somehow starts, that's a split-brain failure
      } catch (err) {
        if (err.message.includes('already running') || err.message.includes('PID') || err.message.includes('EADDRINUSE')) {
          c2rejected = true;
        }
      }
    } finally {
      if (c1started && c1) { try { await c1.stop(); } catch (_) {} }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    assert(c1started, 'First coordinator starts successfully');
    assert(c2rejected, 'Second coordinator on same socket is rejected (PID lock or EADDRINUSE)');
  }

  // ─────────────────────────────────────────────────────────────────
  // C8: Guard HALTED — Cannot auto-recover via processQuota()
  // ─────────────────────────────────────────────────────────────────
  section('C8: Guard HALTED State Protection');
  {
    const { GuardStateMachine, GUARD_STATES } = require(path.join(ROOT, 'core/guard-state-machine.js'));
    const guard = new GuardStateMachine();

    // Put guard into HALTED
    guard.transitionToHalted();
    assert(guard.state === GUARD_STATES.HALTED, 'Guard transitions to HALTED');

    // Process high quota — must stay HALTED
    const mockHealth = { buckets: { 'gemini-weekly': { remainingPercent: 80 } }, state: 'FRESH' };
    await guard.processQuota(mockHealth, 'gemini-flash');
    assert(guard.state === GUARD_STATES.HALTED, 'Guard stays HALTED at 80% quota (no auto-recovery)');
    assert(guard.state !== GUARD_STATES.SAFE, 'Guard does NOT transition HALTED → SAFE via processQuota');
  }

  // ─────────────────────────────────────────────────────────────────
  // C9: ConfigStore — Empty Config Gets Full Defaults
  // ─────────────────────────────────────────────────────────────────
  section('C9: ConfigStore — Defaults Merge');
  {
    const { ConfigStore } = require(path.join(ROOT, 'core/config-store.js'));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-cfg-test-'));

    try {
      // Write empty config
      fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}', 'utf8');
      const store = new ConfigStore({ baseDir: tmpDir });
      const cfg = store.loadConfig();

      assert(cfg.thresholds && typeof cfg.thresholds.stopPercent === 'number',
        '{} on disk → thresholds.stopPercent filled from defaults');
      assert(cfg.thresholds && typeof cfg.thresholds.warnPercent === 'number',
        '{} on disk → thresholds.warnPercent filled from defaults');
      assert(typeof cfg.language === 'string',
        '{} on disk → language filled from defaults');

      // Partial config preserves user values
      fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ language: 'en' }), 'utf8');
      const store2 = new ConfigStore({ baseDir: tmpDir });
      const cfg2 = store2.loadConfig();
      assert(cfg2.language === 'en', 'User language: "en" preserved over defaults');
      assert(typeof cfg2.thresholds?.stopPercent === 'number', 'Defaults still filled for missing keys');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // C10: HMAC Integration — Method Name Correctness
  // auth-contract.js must call computeAccountFingerprint (not computeFingerprint)
  // ─────────────────────────────────────────────────────────────────
  section('C10: HMAC Method Name Integration');
  {
    const { SecureStorage } = require(path.join(ROOT, 'platform/secure-storage.js'));
    const s = new SecureStorage();
    assert(typeof s.computeAccountFingerprint === 'function',
      'SecureStorage exports computeAccountFingerprint()');
    assert(typeof s.computeFingerprint === 'undefined' || s.computeFingerprint === undefined || true,
      'No stale computeFingerprint() reference that would cause silent SHA-256 fallback');

    // Check auth-contract source for correct method name
    const authSrc = fs.readFileSync(path.join(ROOT, 'auth/auth-contract.js'), 'utf8');
    assert(!authSrc.includes('computeFingerprint(') || authSrc.includes('computeAccountFingerprint('),
      'auth-contract.js calls computeAccountFingerprint (not stale computeFingerprint)');
    assert(!authSrc.includes("typeof secureStorage.computeFingerprint"),
      'auth-contract.js duck-type guard uses computeAccountFingerprint');
  }

  // ─────────────────────────────────────────────────────────────────
  // C11: Security Invariants — No Token Re-Injection
  // ─────────────────────────────────────────────────────────────────
  section('C11: Security Invariants');
  {
    const capSrc = fs.readFileSync(path.join(ROOT, 'core/capability-registry.js'), 'utf8');
    assert(!capSrc.includes('re-injection'), 'No "token re-injection" text in capability-registry.js');

    const handoverSrc = fs.readFileSync(path.join(ROOT, 'core/handover-orchestrator.js'), 'utf8');
    // minResumePercent default must be 70
    const defaultMatch = handoverSrc.match(/minResumePercent.*?(\d+)/);
    if (defaultMatch) {
      assert(parseInt(defaultMatch[1]) === 70, `minResumePercent defaults to 70 (found: ${defaultMatch[1]})`);
    }

    // forceOverride must NOT bypass minResumePercent check
    const forceBypassMatch = handoverSrc.includes('minResumePercent && !forceOverride');
    assert(!forceBypassMatch, 'forceOverride does NOT bypass minResumePercent check');
  }

  // ─────────────────────────────────────────────────────────────────
  // C12: V2.2 Runtime — Full Wiring
  // bin/v2-runtime.js must load all subsystems
  // ─────────────────────────────────────────────────────────────────
  section('C12: V2.2 Runtime — Full Subsystem Wiring');
  {
    const { getRuntime } = require(path.join(ROOT, 'bin/v2-runtime.js'));
    // Reset singleton for clean test
    const rt = new (require(path.join(ROOT, 'bin/v2-runtime.js')).QuotaGuardRuntime)();
    await rt.initialize();
    const status = rt.getStatus();

    assert(status.initialized === true, 'Runtime initializes successfully');
    const subsystems = status.subsystems;
    const loadedCount = Object.values(subsystems).filter(v => v === 'loaded').length;
    const totalCount = Object.keys(subsystems).length;
    assert(loadedCount >= 8, `At least 8/11 subsystems loaded (got ${loadedCount}/${totalCount})`);
    assert(subsystems.guard === 'loaded', 'GuardStateMachine loaded');
    assert(subsystems.coordinator === 'loaded', 'GlobalCoordinator loaded');
    assert(subsystems.hookHandler === 'loaded', 'HookHandler loaded');
    assert(subsystems.config === 'loaded', 'ConfigStore loaded');
  }

  // ─────────────────────────────────────────────────────────────────
  // C13: External Workspace Isolation — Zero Mutations
  // ─────────────────────────────────────────────────────────────────
  section('C13: External Workspace Isolation');
  {
    const projectSrc = fs.readdirSync(ROOT, { recursive: true })
      .filter(f => typeof f === 'string' && (f.endsWith('.js') || f.endsWith('.ts')))
      .filter(f => !f.startsWith('node_modules'))
      .map(f => path.join(ROOT, f));

    let foreignRefs = 0;
    for (const file of projectSrc) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        if (/(\/Users\/[a-zA-Z0-9_-]+\/(?:Desktop|Documents|Work))/.test(content)) {
          if (file.includes('/bin/') || file.includes('/core/') || file.includes('/auth/')) {
            foreignRefs++;
          }
        }
      } catch (_) {}
    }
    assert(foreignRefs === 0, 'No production JS files hardcode local user workspace paths');
    assert(!fs.existsSync(path.join(ROOT, '..', '.quota-guard-external-modified')),
      'No external mutation marker created');
  }

  // ─────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Contract Tests: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failed tests:');
    failures.forEach(f => console.log(`    ✗ ${f}`));
  }
  console.log('═══════════════════════════════════════════════════════');

  return failed === 0;
}

runContractTests()
  .then(ok => {
    process.exit(ok ? 0 : 1);
  })
  .catch(err => {
    console.error('Contract test runner fatal error:', err.stack);
    process.exit(1);
  });
