/**
 * Phase 6 Test Suite: Multi-Folder Continuity, Capability Registry, Simulation Lab & Handover Orchestration
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const {
  createWorkspaceEntry,
  createWorkspaceCapsule,
  verifyWorkspaceDivergence,
  resolveContextWindowPressure
} = require('../core/continuity-guard');

const {
  CapabilityRegistry,
  OPERATING_MODES,
  CAPABILITY_SOURCES,
  CAPABILITY_STABILITY
} = require('../core/capability-registry');

const {
  SimulationLab,
  SIMULATION_SCENARIOS
} = require('../core/simulation-lab');

const {
  IDENTITY_KINDS,
  AUTH_STRATEGIES,
  createTaggedIdentity,
  areIdentitiesEqual
} = require('../auth/auth-contract');

const { resolveAuthStrategy } = require('../auth/auth-resolver');
const { getSettingsGuidance, getAssistedNavigationPayload } = require('../auth/settings-assist-adapter');
const { getResumeCommand, getCliGuidance } = require('../auth/cli-session-adapter');
const { ApiKeyProfileAdapter } = require('../auth/api-key-profile-adapter');
const { ExperimentalUiAdapter } = require('../auth/experimental-ui-adapter');
const { HandoverOrchestrator, HANDOVER_STATES } = require('../core/handover-orchestrator');

test('Phase 6: Multi-Folder Continuity, Capability Registry, Simulation Lab & Handover', async (t) => {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-phase6-test-'));

  t.after(() => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('6.1 Continuity Guard: Workspace Capsule & Non-Git VCS Invariant', () => {
    // 1. Non-git directory
    const nonGitDir = path.join(sandboxDir, 'local-folder');
    fs.mkdirSync(nonGitDir);
    fs.writeFileSync(path.join(nonGitDir, 'test.txt'), 'hello');

    const localEntry = createWorkspaceEntry(nonGitDir);
    assert.equal(localEntry.kind, 'local');
    assert.equal(localEntry.vcsType, null, 'Non-git folder must strictly record vcsType: null');
    assert.equal(localEntry.branch, null);
    assert.ok(localEntry.dirtyFingerprint, 'Local folder should have a dirty fingerprint based on mtimes');

    // 2. Git directory
    const gitDir = path.join(sandboxDir, 'git-repo');
    fs.mkdirSync(gitDir);
    execSync('git init -b main', { cwd: gitDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: gitDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: gitDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'version 1');
    execSync('git add file.txt && git commit -m "initial"', { cwd: gitDir, stdio: 'ignore' });

    const gitEntry = createWorkspaceEntry(gitDir);
    assert.equal(gitEntry.kind, 'git');
    assert.equal(gitEntry.vcsType, 'git');
    assert.equal(gitEntry.branch, 'main');
    assert.ok(gitEntry.headSha.length >= 40);
    assert.equal(gitEntry.isDirty, false);

    // 3. Capsule creation
    const capsule1 = createWorkspaceCapsule([nonGitDir, gitDir], {
      telemetry: { context_window: { used: 4000, total: 32000 } }
    });
    assert.equal(capsule1.workspaceEntries.length, 2);
    assert.equal(capsule1.contextPressure.status, 'AVAILABLE');
    assert.equal(capsule1.contextPressure.percent, 13);

    // 4. Missing telemetry invariant
    const missingCw = resolveContextWindowPressure(null);
    assert.equal(missingCw, 'UNAVAILABLE', 'Must return UNAVAILABLE rather than fabricated numbers');

    // 5. Workspace divergence detection
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'version 2 (dirty)');
    const capsule2 = createWorkspaceCapsule([nonGitDir, gitDir]);
    const divergence = verifyWorkspaceDivergence(capsule1, capsule2);

    assert.equal(divergence.diverged, true);
    assert.equal(divergence.state, 'WORKSPACE_DIVERGED');
    assert.ok(divergence.reasons.some(r => r.includes('dirty state changed')));
  });

  await t.test('6.2 Capability Registry: 3 Modes, Granular God Toggles & Version Probing', () => {
    const reg = new CapabilityRegistry();

    // Standard mode allows only official
    const stdList = reg.listCapabilities(OPERATING_MODES.STANDARD);
    assert.ok(stdList.every(c => c.source === CAPABILITY_SOURCES.OFFICIAL));

    // God mode master activation requires user confirmation
    assert.throws(() => {
      reg.setGodMode(true, { confirmedByUser: false });
    }, /explicit user confirmation/);

    reg.setGodMode(true, { confirmedByUser: true, lifetime: 'persistent' });
    assert.equal(reg.getGodModeStatus().active, true);

    // Granular toggle: Experimental UI automation is denied if sub-toggle is false
    const deniedUi = reg.isCapabilityAllowed('ACCOUNT_UI_AUTOMATION_EXPERIMENTAL', OPERATING_MODES.GOD, {
      expert: { mode: 'god' },
      auth: { allowExperimentalUiAutomation: false }
    });
    assert.equal(deniedUi.allowed, false);

    // Permitted when sub-toggle is true
    const allowedUi = reg.isCapabilityAllowed('ACCOUNT_UI_AUTOMATION_EXPERIMENTAL', OPERATING_MODES.GOD, {
      expert: { mode: 'god' },
      auth: { allowExperimentalUiAutomation: true }
    });
    assert.equal(allowedUi.allowed, true);

    // Version probing: flags capabilities exceeding maxVersion as BROKEN_BY_VERSION without crashing
    const probe = reg.probeCapabilities('3.0.0');
    assert.ok(probe.brokenCapabilities.includes('SETTINGS_AUTO_OPEN_REVERSE_ENGINEERED'));
    const brokenCap = reg.getCapability('SETTINGS_AUTO_OPEN_REVERSE_ENGINEERED');
    assert.equal(brokenCap.stability, CAPABILITY_STABILITY.BROKEN_BY_VERSION);
  });

  await t.test('6.3 Simulation Lab: Synthetic Failure Injection & Shadow Mode', async () => {
    const sim = new SimulationLab();
    assert.equal(sim.listSupportedScenarios().length, 9);

    // Run Quota Exhaustion simulation
    const qe = await sim.runSimulation(SIMULATION_SCENARIOS.QUOTA_EXHAUSTION);
    assert.equal(qe.passed, true);
    assert.ok(qe.history.some(h => h.quota === 13 && h.state === 'CHECKPOINT'));
    assert.ok(qe.history.some(h => h.quota === 11 && h.state === 'HALT_PENDING'));

    // Run Missing Quota simulation
    const mq = await sim.runSimulation(SIMULATION_SCENARIOS.MISSING_QUOTA);
    assert.equal(mq.passed, true);
    assert.equal(mq.finalState, 'UNKNOWN_BLOCKED');

    // Shadow Mode evaluation — use official bucket format
    const shadow = sim.evaluateShadowMode({
      model: 'gemini-2.5-pro',
      // Official format: dynamic bucket keys with remaining_fraction
      buckets: { 'gemini-weekly': { remainingPercent: 11, remainingFraction: 0.11, resetTime: '2026-10-02T18:00:00Z', category: 'gemini' } }
    }, 'SAFE', { thresholds: { stopPercent: 12 } });

    assert.equal(shadow.shadowMode, true);
    assert.ok(shadow.evaluatedActions.some(a => a.type === 'WOULD_HALT'));
  });

  await t.test('6.4 Tagged Account Identity & Strategy Resolution', () => {
    // Tagged identity contract
    const id1 = createTaggedIdentity(IDENTITY_KINDS.GOOGLE_ACCOUNT, 'user@example.com');
    const id2 = createTaggedIdentity(IDENTITY_KINDS.GOOGLE_ACCOUNT, 'USER@EXAMPLE.COM');
    const id3 = createTaggedIdentity(IDENTITY_KINDS.GOOGLE_ACCOUNT, 'other@example.com');
    const keyProfile = createTaggedIdentity(IDENTITY_KINDS.GEMINI_API_KEY_PROFILE, 'profile-work');

    assert.equal(areIdentitiesEqual(id1, id2), true, 'Identities with same normalized email must match');
    assert.equal(areIdentitiesEqual(id1, id3), false, 'Identities with different emails must not match');
    assert.equal(areIdentitiesEqual(id1, keyProfile), false, 'Different identity kinds must not match');

    // Strategy resolution
    const desktopRes = resolveAuthStrategy({ surface: 'desktop', mode: 'standard' });
    assert.equal(desktopRes.strategy, AUTH_STRATEGIES.DESKTOP_SETTINGS_ASSIST);

    const cliRes = resolveAuthStrategy({ surface: 'cli', mode: 'standard' });
    assert.equal(cliRes.strategy, AUTH_STRATEGIES.CLI_SESSION);

    // Exact resume semantics
    assert.equal(getResumeCommand('conv-12345'), 'agy --conversation conv-12345');
    assert.equal(getResumeCommand(null), 'agy -c');
  });

  await t.test('6.5 API Key Profile Adapter: Exclusive Transaction Lock', () => {
    const fakeSettingsPath = path.join(sandboxDir, 'cli-settings.json');
    fs.writeFileSync(fakeSettingsPath, JSON.stringify({ modelProvider: 'google-login' }));

    const adapter = new ApiKeyProfileAdapter({ settingsPath: fakeSettingsPath });

    // Acquire exclusive lease
    const lease = adapter.acquireProfileLock('profile-test');
    assert.equal(lease.originalProvider, 'google-login');

    const updated = JSON.parse(fs.readFileSync(fakeSettingsPath, 'utf8'));
    assert.equal(updated.modelProvider, 'gemini');

    // Rejection on concurrent attempt
    assert.throws(() => {
      adapter.acquireProfileLock('profile-conflict');
    }, (err) => err.code === 'EXCLUSIVE_TRANSACTION_LOCK_ERROR');

    // Release lock restores original setting
    adapter.releaseProfileLock('profile-test');
    const restored = JSON.parse(fs.readFileSync(fakeSettingsPath, 'utf8'));
    assert.equal(restored.modelProvider, 'google-login');
  });

  await t.test('6.6 Handover Orchestrator: Idle Verification & Resume Flow', () => {
    const idA = createTaggedIdentity(IDENTITY_KINDS.GOOGLE_ACCOUNT, 'userA@example.com');
    const idB = createTaggedIdentity(IDENTITY_KINDS.GOOGLE_ACCOUNT, 'userB@example.com');

    const orchestrator = new HandoverOrchestrator({
      initialAccountIdentity: idA,
      initialConversationId: 'conv-abc-999',
      config: { thresholds: { stopPercent: 12, checkpointPercent: 13, minResumePercent: 30 } }
    });

    assert.equal(orchestrator.getState(), HANDOVER_STATES.MONITORING);

    // Quota drops to 13% -> PRECHECKPOINTED
    const cpRes = orchestrator.processQuotaUpdate(13);
    assert.equal(cpRes.state, HANDOVER_STATES.PRECHECKPOINTED);
    assert.equal(cpRes.action, 'TRIGGER_SILENT_CHECKPOINT');

    // Quota drops to 12% -> HALT_REQUESTED
    const haltRes = orchestrator.processQuotaUpdate(12);
    assert.equal(haltRes.state, HANDOVER_STATES.HALT_REQUESTED);

    // PostInvocation concludes turn cleanly
    const postRes = orchestrator.handlePostInvocationHalt();
    assert.equal(postRes.terminationBehavior, 'terminate');
    assert.equal(orchestrator.getState(), HANDOVER_STATES.HALTED);

    // Stop hook with fullyIdle: false enters HALTED_BACKGROUND_ACTIVE and NEVER returns continue
    const stopRes = orchestrator.handleStopEvent({ fullyIdle: false });
    assert.equal(stopRes.state, HANDOVER_STATES.HALTED_BACKGROUND_ACTIVE);
    assert.equal(stopRes.decision, 'stop');

    // User confirms background activity stopped
    orchestrator.confirmBackgroundActivityStopped();
    assert.equal(orchestrator.getState(), HANDOVER_STATES.ACCOUNT_SWITCH_REQUIRED);

    // Rejects identical account switch
    orchestrator.beginAccountSwitch('DESKTOP_SETTINGS_ASSIST');
    const sameAccRes = orchestrator.verifyAccountAndQuota(idA, 80);
    assert.equal(sameAccRes.ready, false);

    // Rejects insufficient quota on new account
    const lowQuotaRes = orchestrator.verifyAccountAndQuota(idB, 25);
    assert.equal(lowQuotaRes.ready, false);

    // Approves new account with sufficient quota
    const successRes = orchestrator.verifyAccountAndQuota(idB, 65);
    assert.equal(successRes.ready, true);
    assert.equal(orchestrator.getState(), HANDOVER_STATES.READY_TO_RESUME);

    // Resumes execution with exact conversation
    const resumeRes = orchestrator.executeResume();
    assert.equal(resumeRes.resumed, true);
    assert.equal(resumeRes.resumeCommand, 'agy --conversation conv-abc-999');
    assert.equal(orchestrator.getState(), HANDOVER_STATES.ACTIVE);
  });
});
