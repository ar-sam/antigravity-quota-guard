#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec, spawnSync, spawn } = require('child_process');
const asar = require('@electron/asar');
const pc = require('picocolors');
const prompts = require('prompts');

const {
  loadConfig,
  saveConfig,
  resetConfig,
  THEME_PRESETS,
  SOUND_PRESETS,
  VALID_HUD_SCOPES,
  CONFIG_FILE
} = require('./config');
const { getLatestQuotaData } = require('./payload');
const {
  readCheckpointHandoff,
  DEFAULT_CHECKPOINTS_DIR: SNAPSHOT_CHECKPOINTS_DIR
} = require('./snapshot');

const {
  provisionHybrid,
  deprovisionHybrid,
  deployOfficialPlugin,
  registerMcpServer,
  configureStatuslineMultiplexer
} = require('../installer/provisioner');
const { AsarPatcher } = require('../installer/asar-patcher');
const { PreflightChecker } = require('../installer/preflight-checker');
const { BackupManager } = require('../installer/backup-manager');
const { QuotaGuardDoctor } = require('../tools/doctor');

const DEFAULT_CHECKPOINTS_DIR = SNAPSHOT_CHECKPOINTS_DIR || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'checkpoints');

// Locate Antigravity app.asar across operating systems
function getAsarPath() {
  const platform = process.platform;
  if (platform === 'darwin') {
    return '/Applications/Antigravity.app/Contents/Resources/app.asar';
  } else if (platform === 'linux') {
    const candidates = [
      '/opt/Antigravity/resources/app.asar',
      path.join(os.homedir(), '.local/share/antigravity/resources/app.asar')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0];
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app.asar');
  }
  return null;
}

// Check if Antigravity process is running
function isAntigravityRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      return /antigravity/i.test(out);
    } else {
      const out = execSync('pgrep -il antigravity || true', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      return out.trim().length > 0;
    }
  } catch (_) {
    return false;
  }
}

// Check if app.asar is already patched
function isAsarPatched(asarPath) {
  try {
    if (!asarPath || !fs.existsSync(asarPath)) return false;
    asar.uncacheAll();
    const content = asar.extractFile(asarPath, 'dist/utils.js').toString('utf8');
    return content.includes('ANTIGRAVITY QUOTA GUARD') || content.includes('__QUOTA_GUARD_V2_2_HYBRID__');
  } catch (_) {
    return false;
  }
}

// Install / Apply Hybrid Patch
async function installPatch() {
  console.log(pc.cyan('\n=== [Antigravity Quota Guard] V2.2 Hybrid Runtime Installation ===\n'));

  const asarPath = getAsarPath();
  if (!asarPath || !fs.existsSync(asarPath)) {
    console.error(pc.red(`Error: Antigravity app.asar not found at: ${asarPath}`));
    console.log(pc.yellow('Please ensure Antigravity Desktop is installed.'));
    return;
  }

  if (isAntigravityRunning()) {
    console.log(pc.yellow('⚠️  Antigravity is currently running.'));
    const ans = await prompts({
      type: 'confirm',
      name: 'continue',
      message: 'Please quit Antigravity (Cmd+Q) before applying the patch. Have you closed it?',
      initial: true
    });
    if (!ans || !ans.continue) {
      console.log(pc.dim('Installation aborted.'));
      return;
    }
  }

  const repoRoot = path.resolve(__dirname, '..');
  console.log(pc.blue('🔍 Running preflight checks (disk space, permissions, processes)...'));
  const preflight = new PreflightChecker();
  const preflightRes = preflight.runPreflight({ asarPath, ignoreRunningProcess: true });
  if (!preflightRes.passed) {
    const failed = preflightRes.checks.filter(c => !c.passed).map(c => c.name).join(', ');
    console.error(pc.red(`❌ Preflight check failed: ${failed}`));
    return;
  }
  console.log(pc.green('✔ Preflight checks passed.'));

  console.log(pc.blue('📦 Deploying official plugin to ~/.gemini/antigravity/plugins/...'));
  console.log(pc.blue('🔌 Registering diagnostic MCP server in ~/.gemini/antigravity/mcp_config.json...'));
  console.log(pc.blue('⚡ Configuring CLI statusline multiplexer...'));
  console.log(pc.blue('🔨 Applying transactional ASAR patch with exact-diff verification...'));

  try {
    const result = await provisionHybrid({
      repoRoot,
      asarPath,
      ignoreRunningProcess: true
    });

    console.log(pc.green('\n✅ V2.2 Hybrid Runtime successfully installed!'));
    console.log(pc.green(`✔ Official Plugin: ${result.pluginResult.pluginDir} (${result.pluginResult.filesCopied} files copied)`));
    console.log(pc.green(`✔ Diagnostic MCP:  ${result.mcpResult.configPath}`));
    console.log(pc.green(`✔ Statusline Feed: ${result.statuslineResult.adapterPath}`));
    if (result.patchResult) {
      console.log(pc.green(`✔ Desktop HUD:     Patched cleanly (SHA: ${result.patchResult.patchedSha256.slice(0, 12)}...)`));
    }

    // Offer symlink for global CLI command
    const localBin = path.join(os.homedir(), '.local', 'bin');
    const symlinkTarget = path.join(localBin, 'quota-guard');
    if (!fs.existsSync(symlinkTarget)) {
      if (!fs.existsSync(localBin)) fs.mkdirSync(localBin, { recursive: true });
      try {
        fs.symlinkSync(path.join(__dirname, 'index.js'), symlinkTarget);
        console.log(pc.green(`🔗 Global terminal command created: ${symlinkTarget}`));
      } catch (_) {}
    }

    // Initialize config if needed
    loadConfig();
    try {
      const { ConfigStore } = require('../core/config-store');
      const store = new ConfigStore();
      store.loadConfig();
    } catch (_) {}

    console.log(pc.cyan('\n✨ Installation Complete!'));
    console.log(pc.white('You can now launch Antigravity Desktop to see the live Titlebar HUD.'));
    console.log(pc.dim(`Configuration file: ${CONFIG_FILE}\n`));
  } catch (err) {
    console.error(pc.red('❌ Installation failed:'), err.message);
  }
}

// Uninstall / Revert Hybrid Patch
async function uninstallPatch() {
  console.log(pc.cyan('\n=== [Antigravity Quota Guard] Uninstallation ===\n'));

  const asarPath = getAsarPath();

  if (isAntigravityRunning()) {
    console.log(pc.yellow('⚠️  Antigravity is currently running.'));
    const ans = await prompts({
      type: 'confirm',
      name: 'continue',
      message: 'Please quit Antigravity (Cmd+Q) before uninstalling. Have you closed it?',
      initial: true
    });
    if (!ans || !ans.continue) {
      console.log(pc.dim('Uninstallation aborted.'));
      return;
    }
  }

  console.log(pc.blue('🔄 Restoring factory binary & deprovisioning hybrid runtime...'));
  try {
    const res = deprovisionHybrid({ asarPath });
    if (res.asarRestored) {
      console.log(pc.green('✅ Factory binary restored cleanly from backup!'));
    } else {
      console.log(pc.yellow('ℹ️  No previous backup found or ASAR not modified.'));
    }
    if (res.mcpResult.unregistered) {
      console.log(pc.green('✅ Diagnostic MCP server unregistered.'));
    }
    if (res.pluginResult.removed) {
      console.log(pc.green('✅ Official plugin removed from ~/.gemini/antigravity/plugins/.'));
    }
  } catch (err) {
    console.error(pc.red('❌ Uninstallation encountered an issue:'), err.message);
  }

  // Remove symlink if exists
  const symlinkTarget = path.join(os.homedir(), '.local', 'bin', 'quota-guard');
  if (fs.existsSync(symlinkTarget)) {
    try {
      fs.unlinkSync(symlinkTarget);
      console.log(pc.dim('Removed global shortcut link.'));
    } catch (_) {}
  }

  console.log(pc.cyan('\n🛡️  Work & Safety Notice:'));
  console.log(pc.green('✔  Your conversation checkpoints in ~/.gemini/antigravity-quota-guard/checkpoints/ remain 100% PRESERVED.'));
  console.log(pc.green(`✔  Your preferences in ${CONFIG_FILE} remain PRESERVED.\n`));
}

// Update Hybrid Runtime In-Place (R5 Seamless CLI Update Engine)
async function updatePatch(customAsarPath) {
  console.log(pc.cyan('\n=== [Antigravity Quota Guard] Update Engine ===\n'));

  const asarPath = customAsarPath || getAsarPath();
  if (!asarPath || !fs.existsSync(asarPath)) {
    console.error(pc.red(`Error: Antigravity app.asar not found at: ${asarPath}`));
    console.log(pc.yellow('Please ensure Antigravity Desktop is installed.'));
    return;
  }

  // 1. Antigravity running check
  if (isAntigravityRunning()) {
    console.log(pc.yellow('⚠️  Antigravity is currently running.'));
    const ans = await prompts({
      type: 'confirm',
      name: 'continue',
      message: 'Please quit Antigravity (Cmd+Q) before updating the patch. Have you closed it?',
      initial: true
    });
    if (ans && ans.continue === false) {
      console.log(pc.dim('Update aborted.'));
      return;
    }
  }

  // 2. Remote git update (optional git pull --ff-only)
  const repoDir = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    try {
      console.log(pc.blue('📡 Checking for remote repository updates...'));
      let shouldPull = false;
      if (process.stdin.isTTY) {
        const gitAns = await prompts({
          type: 'confirm',
          name: 'pull',
          message: 'Would you like to check and pull remote updates via git pull?',
          initial: true
        });
        shouldPull = !!(gitAns && gitAns.pull);
      }
      if (shouldPull) {
        console.log(pc.dim('Running git pull --ff-only...'));
        try {
          execSync('git pull --ff-only', { cwd: repoDir, stdio: 'inherit' });
          console.log(pc.green('✅ Git repository updated successfully.'));
        } catch (pullErr) {
          console.log(pc.yellow(`⚠️  Git pull failed or offline (${pullErr.message}). Continuing with local payload...`));
        }
      }
    } catch (_) {}
  }

  // 3. In-place hybrid update
  console.log(pc.blue('🔄 Applying in-place hybrid runtime update...'));
  try {
    const result = await provisionHybrid({
      repoRoot: repoDir,
      asarPath,
      ignoreRunningProcess: true
    });

    console.log(pc.green('\n✅ Quota Guard V2.2 Hybrid Runtime successfully updated!'));
    console.log(pc.green(`✔ Official Plugin refreshed: ${result.pluginResult.pluginDir}`));
    console.log(pc.green(`✔ MCP Server verified: ${result.mcpResult.configPath}`));
    console.log(pc.green(`✔ Statusline Feed verified: ${result.statuslineResult.adapterPath}`));
    if (result.patchResult) {
      console.log(pc.green(`✔ Desktop HUD repacked cleanly (SHA: ${result.patchResult.patchedSha256.slice(0, 12)}...)`));
    }
    console.log(pc.white('\nRestart Antigravity Desktop to load the latest hybrid runtime.'));
  } catch (err) {
    console.error(pc.red('❌ Update failed:'), err.message);
  }
}

// Show Status & Telemetry
function showStatus() {
  console.log(pc.cyan('\n=== [Antigravity Quota Guard] Status Report ===\n'));

  const asarPath = getAsarPath();
  const patched = isAsarPatched(asarPath);
  const running = isAntigravityRunning();
  const cfg = loadConfig();

  console.log(`• Antigravity Process : ${running ? pc.green('Running') : pc.dim('Stopped')}`);
  console.log(`• Patch Status        : ${patched ? pc.green('Installed & Active') : pc.yellow('Not Installed')}`);
  console.log(`• Backup Available    : ${fs.existsSync(asarPath + '.bak') ? pc.green('Yes') : pc.dim('No')}`);
  console.log(`• Binary Location     : ${pc.dim(asarPath || 'unknown')}`);
  console.log(`• Config Location     : ${pc.dim(CONFIG_FILE)}`);

  const coordinatorStatePath = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'runtime-state.json');
  let coordinatorState = null;
  if (fs.existsSync(coordinatorStatePath)) {
    try { coordinatorState = JSON.parse(fs.readFileSync(coordinatorStatePath, 'utf8')); } catch (_) {}
  }
  if (coordinatorState) {
    console.log(`• Quota Coordinator   : ${pc.green('Active')} (Guard: ${coordinatorState.guardState || 'SAFE'}, Health: ${coordinatorState.healthState || 'UNKNOWN'})`);
  }

  console.log(pc.cyan('\n--- Active Thresholds & Settings ---'));
  console.log(`• Language            : ${cfg.language.toUpperCase()}`);
  console.log(`• Titlebar HUD Scope  : ${pc.bold(cfg.visuals?.hudScope || 'fiveHour')}`);
  console.log(`• Stop Threshold      : ${pc.red(cfg.thresholds.stopPercent + '%')} (Turn boundary account switch)`);
  console.log(`• Checkpoint Threshold: ${pc.yellow(cfg.thresholds.checkpointPercent + '%')}`);
  console.log(`• Warn Threshold      : ${pc.yellow(cfg.thresholds.warnPercent + '%')}`);
  console.log(`• Min Resume Quota    : ${pc.green(cfg.thresholds.minResumePercent + '%')}`);
  console.log(`• Chime Audio Alert   : ${cfg.audio.soundEnabled ? pc.green(`Enabled (${cfg.audio.soundName})`) : pc.dim('Disabled')}`);
  console.log(`• Theme Preset        : ${cfg.visuals.themePreset}`);

  console.log(pc.cyan('\n--- Live Quota Telemetry (Dual-Bucket Isolation) ---'));
  console.log(pc.dim('Querying live quota status (agy / runtime cache)...'));

  return new Promise((resolve) => {
    getLatestQuotaData((err, q) => {
      if (err || !q) {
        console.log(pc.yellow('Could not fetch quota details right now.'));
      } else {
        console.log(`• Account Email       : ${pc.bold(q.account_email || 'Google Account')}`);

        const gemini = q.gemini || {
          fiveHour: typeof q.remaining_percent === 'number' ? q.remaining_percent : null,
          weekly: typeof q.weekly_percent === 'number' ? q.weekly_percent : null,
          resetTimeFiveHour: q.reset_time || null,
          resetTimeWeekly: null
        };

        const claude = q.claude_gpt || {
          fiveHour: null,
          weekly: null,
          resetTimeFiveHour: null,
          resetTimeWeekly: null
        };

        const formatPct = (pct) => {
          if (pct === null || pct === undefined) return pc.dim('N/A');
          if (pct <= cfg.thresholds.stopPercent) return pc.red(pc.bold(`${pct}%`));
          if (pct <= cfg.thresholds.warnPercent) return pc.yellow(pc.bold(`${pct}%`));
          return pc.green(pc.bold(`${pct}%`));
        };

        console.log(pc.cyan('\n  🤖 Gemini Models'));
        console.log(`  • 5-Hour Limit Remaining : ${formatPct(gemini.fiveHour)}`);
        console.log(`  • Weekly Limit Remaining : ${formatPct(gemini.weekly)}`);
        console.log(`  • 5-Hour Reset Timestamp : ${gemini.resetTimeFiveHour ? pc.bold(gemini.resetTimeFiveHour) : pc.dim('N/A')}`);
        if (gemini.resetTimeWeekly) {
          console.log(`  • Weekly Reset Timestamp : ${pc.bold(gemini.resetTimeWeekly)}`);
        }

        console.log(pc.cyan('\n  🧠 Claude and GPT models'));
        console.log(`  • 5-Hour Limit Remaining : ${formatPct(claude.fiveHour)}`);
        console.log(`  • Weekly Limit Remaining : ${formatPct(claude.weekly)}`);
        console.log(`  • 5-Hour Reset Timestamp : ${claude.resetTimeFiveHour ? pc.bold(claude.resetTimeFiveHour) : pc.dim('N/A')}`);
        if (claude.resetTimeWeekly) {
          console.log(`  • Weekly Reset Timestamp : ${pc.bold(claude.resetTimeWeekly)}`);
        }
      }
      console.log('');
      resolve();
    });
  });
}

// Interactive Terminal Settings Editor
async function configureSettings() {
  console.log(pc.cyan('\n=== [Antigravity Quota Guard] Configuration Editor ===\n'));

  const cfg = loadConfig();

  const choice = await prompts({
    type: 'select',
    name: 'action',
    message: 'What would you like to configure?',
    choices: [
      { title: `Titlebar HUD Metric Scope (Current: ${cfg.visuals?.hudScope || 'fiveHour'})`, value: 'hudScope' },
      { title: `Threshold Percentages (Stop: ${cfg.thresholds.stopPercent}%, Warn: ${cfg.thresholds.warnPercent}%)`, value: 'thresholds' },
      { title: `Audio & Alerts (Sound: ${cfg.audio.soundEnabled ? cfg.audio.soundName : 'Off'})`, value: 'audio' },
      { title: `Theme & Colors (Current: ${cfg.visuals.themePreset})`, value: 'theme' },
      { title: `Language (Current: ${cfg.language.toUpperCase()})`, value: 'language' },
      { title: '🔄 Reset All Settings to Factory Defaults', value: 'reset' },
      { title: '← Back / Exit', value: 'exit' }
    ]
  });

  if (choice.action === 'hudScope') {
    const res = await prompts({
      type: 'select',
      name: 'scope',
      message: 'Select Titlebar HUD Metric Scope:',
      choices: [
        { title: '5-Hour Limit Only (Default)', value: 'fiveHour' },
        { title: 'Weekly Limit Only', value: 'weekly' },
        { title: 'Both 5-Hour and Weekly Side-by-Side', value: 'both' }
      ],
      initial: cfg.visuals?.hudScope === 'weekly' ? 1 : (cfg.visuals?.hudScope === 'both' ? 2 : 0)
    });
    if (res.scope) {
      if (!cfg.visuals || typeof cfg.visuals !== 'object') cfg.visuals = {};
      cfg.visuals.hudScope = res.scope;
      saveConfig(cfg);
      console.log(pc.green(`✅ Titlebar HUD Metric Scope set to ${res.scope}!`));
    }
  } else if (choice.action === 'thresholds') {
    const res = await prompts([
      {
        type: 'number',
        name: 'warn',
        message: 'Warning Threshold % (5 - 50):',
        initial: cfg.thresholds.warnPercent,
        validate: v => v >= 5 && v <= 50 ? true : 'Must be between 5 and 50'
      },
      {
        type: 'number',
        name: 'stop',
        message: 'Hard Stop Threshold % for Account Switching (5 - 25):',
        initial: cfg.thresholds.stopPercent,
        validate: v => v >= 5 && v <= 25 ? true : 'Must be between 5 and 25'
      },
      {
        type: 'number',
        name: 'resume',
        message: 'Minimum Quota % Required to Resume Work (40 - 95):',
        initial: cfg.thresholds.minResumePercent,
        validate: v => v >= 40 && v <= 95 ? true : 'Must be between 40 and 95'
      }
    ]);
    if (res.warn && res.stop) {
      cfg.thresholds.warnPercent = res.warn;
      cfg.thresholds.stopPercent = res.stop;
      cfg.thresholds.minResumePercent = res.resume;
      saveConfig(cfg);
      console.log(pc.green('✅ Thresholds updated successfully!'));
    }
  } else if (choice.action === 'audio') {
    const res = await prompts([
      {
        type: 'confirm',
        name: 'enabled',
        message: 'Enable chime alert when pausing for account switch?',
        initial: cfg.audio.soundEnabled
      },
      {
        type: 'select',
        name: 'sound',
        message: 'Select sound chime:',
        choices: Object.keys(SOUND_PRESETS).map(s => ({ title: s, value: s })),
        initial: 0
      }
    ]);
    cfg.audio.soundEnabled = res.enabled;
    if (res.sound) cfg.audio.soundName = res.sound;
    saveConfig(cfg);
    console.log(pc.green('✅ Audio settings updated!'));
  } else if (choice.action === 'theme') {
    const res = await prompts({
      type: 'select',
      name: 'preset',
      message: 'Select Theme Preset:',
      choices: [
        { title: 'Clinical (Warm Neutral & Teal/Amber/Rose)', value: 'clinical' },
        { title: 'Standard (Emerald Green / Amber / Crimson)', value: 'standard' },
        { title: 'Vibrant (Cyan / Orange / Neon Pink)', value: 'vibrant' }
      ]
    });
    if (res.preset) {
      cfg.visuals.themePreset = res.preset;
      cfg.visuals.colors = { ...THEME_PRESETS[res.preset] };
      saveConfig(cfg);
      console.log(pc.green(`✅ Theme set to ${res.preset}!`));
    }
  } else if (choice.action === 'language') {
    const res = await prompts({
      type: 'select',
      name: 'lang',
      message: 'Select Interface Language:',
      choices: [
        { title: 'فارسی (Persian - RTL)', value: 'fa' },
        { title: 'English (LTR)', value: 'en' }
      ]
    });
    if (res.lang) {
      cfg.language = res.lang;
      saveConfig(cfg);
      console.log(pc.green(`✅ Language updated to ${res.lang}!`));
    }
  } else if (choice.action === 'reset') {
    resetConfig();
    console.log(pc.green('✅ Settings reset to factory defaults!'));
  }
}

// Bundle Quota Guard payload and snapshot into an existing ASAR package
async function patchAsar(asarPath, options = {}) {
  if (!asarPath || !fs.existsSync(asarPath)) {
    throw new Error(`Target asar does not exist: ${asarPath}`);
  }

  const patcher = new AsarPatcher({
    asarPath,
    backupManager: options.backupManager || new BackupManager(options),
    preflightChecker: options.preflightChecker || new PreflightChecker(options)
  });

  const res = await patcher.patch({
    dryRun: options.dryRun || false,
    ignoreRunningProcess: options.ignoreRunningProcess ?? true,
    force: options.force ?? false,
    modifierFn: options.modifierFn || (async (stagedDir) => {
      const utilsPath = path.join(stagedDir, 'dist', 'utils.js');
      if (!fs.existsSync(utilsPath)) {
        throw new Error(`dist/utils.js not found in extracted asar: ${utilsPath}`);
      }

      const payloadSrc = options.payloadSrc || path.join(__dirname, 'payload.js');
      const payloadDest = path.join(stagedDir, 'dist', 'quota-guard-payload.js');
      if (fs.existsSync(payloadSrc)) {
        fs.copyFileSync(payloadSrc, payloadDest);
      }

      const snapshotSrc = options.snapshotSrc || path.join(__dirname, 'snapshot.js');
      const snapshotDest = path.join(stagedDir, 'dist', 'quota-guard-snapshot.js');
      if (fs.existsSync(snapshotSrc)) {
        fs.copyFileSync(snapshotSrc, snapshotDest);
      }

      let utilsContent = fs.readFileSync(utilsPath, 'utf8');
      const startTag = '/* === ANTIGRAVITY QUOTA GUARD START === */';
      const endTag = '/* === ANTIGRAVITY QUOTA GUARD END === */';

      if (utilsContent.includes(startTag)) {
        const before = utilsContent.substring(0, utilsContent.indexOf(startTag));
        const after = utilsContent.substring(utilsContent.indexOf(endTag) + endTag.length);
        utilsContent = before + after;
      }

      const injection = `\n${startTag}\ntry {\n  const _qgPayload = require('./quota-guard-payload.js');\n  if (_qgPayload && typeof _qgPayload.initMainProcessHooks === 'function') {\n    _qgPayload.initMainProcessHooks();\n  }\n} catch (_qgErr) {\n  console.error('[QuotaGuard] Startup error:', _qgErr);\n}\n${endTag}\n`;

      utilsContent += injection;
      fs.writeFileSync(utilsPath, utilsContent, 'utf8');
    })
  });

  return { success: true, asarPath, patchResult: res };
}

// Discover and list all checkpoints in directory sorted descending by ISO timestamp
function listCheckpoints(checkpointsDir = DEFAULT_CHECKPOINTS_DIR) {
  let resolvedDir = checkpointsDir;
  if (resolvedDir && resolvedDir.startsWith('~/')) {
    resolvedDir = path.join(os.homedir(), resolvedDir.slice(2));
  }

  if (!fs.existsSync(resolvedDir)) {
    try {
      fs.mkdirSync(resolvedDir, { recursive: true });
    } catch (_) {}
    return [];
  }

  let files = [];
  try {
    files = fs.readdirSync(resolvedDir)
      .filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'));
  } catch (_) {
    return [];
  }

  const results = [];
  for (const file of files) {
    const fullPath = path.join(resolvedDir, file);
    const mdFilename = file.replace(/\.json$/, '.md');
    const mdPath = path.join(resolvedDir, mdFilename);

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const data = JSON.parse(content);

      results.push({
        filename: file,
        path: fullPath,
        markdownFilename: mdFilename,
        markdownPath: mdPath,
        conversation_id: data.conversation_id || data.conversationId || 'unknown',
        title: data.title || 'Untitled Conversation',
        model: (data.active_model && data.active_model.name) || data.modelName || data.model || 'unknown',
        created_at: data.created_at || data.timestamp || 'unknown',
        account: data.account_email || data.account || 'unknown',
        integrity_sha256: data.integrity_sha256 || null,
        data
      });
    } catch (_) {
      results.push({
        filename: file,
        path: fullPath,
        markdownFilename: mdFilename,
        markdownPath: mdPath,
        conversation_id: 'unknown',
        title: `[Corrupted Checkpoint: ${file}]`,
        model: 'unknown',
        created_at: 'unknown',
        account: 'unknown',
        integrity_sha256: null,
        isCorrupted: true
      });
    }
  }

  // Sort descending by ISO timestamp or filename
  results.sort((a, b) => {
    const timeA = a.created_at && a.created_at !== 'unknown' ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at && b.created_at !== 'unknown' ? new Date(b.created_at).getTime() : 0;
    if (timeA && timeB && timeA !== timeB) {
      return timeB - timeA;
    }
    return b.filename.localeCompare(a.filename);
  });

  return results;
}

// Display formatted terminal table of checkpoints
function displayCheckpointsTable(checkpoints, checkpointsDir = DEFAULT_CHECKPOINTS_DIR) {
  console.log(pc.cyan('\n=== [Antigravity Quota Guard] Saved Checkpoints ===\n'));
  console.log(pc.dim(`Directory: ${checkpointsDir}`));

  if (!checkpoints || checkpoints.length === 0) {
    console.log(pc.yellow('\nℹ️  No saved checkpoints found.'));
    console.log(pc.dim('Checkpoints are automatically created when AI quota reaches safety thresholds.\n'));
    return;
  }

  console.log(pc.dim(`Total: ${checkpoints.length} saved checkpoint(s)\n`));

  checkpoints.forEach((cpItem, index) => {
    const num = pc.cyan(pc.bold(`[${index + 1}]`));
    const title = pc.bold(cpItem.title);
    const ts = pc.white(cpItem.created_at || 'unknown');
    console.log(`${num} ${ts} | ${title}`);
    console.log(`    • Model: ${pc.yellow(cpItem.model)} | Account: ${pc.green(cpItem.account)}`);
    console.log(`    • Files: JSON: ${pc.dim(cpItem.filename)} | MD: ${pc.dim(cpItem.markdownFilename)}`);
    if (cpItem.isCorrupted) {
      console.log(`    ${pc.red('⚠️  Notice: Checkpoint file contains invalid or corrupted JSON.')}`);
    }
    console.log('');
  });
}

// Copy latest companion Markdown directly to system clipboard via pbcopy on macOS with fallbacks
function copyLatestHandoffToClipboard(checkpoints, checkpointsDir = DEFAULT_CHECKPOINTS_DIR, selectedIndex = 0) {
  if (!checkpoints || checkpoints.length === 0) {
    console.log(pc.yellow('⚠️  No checkpoints found to copy.'));
    return { success: false, reason: 'no_checkpoints' };
  }

  const target = checkpoints[selectedIndex] || checkpoints[0];
  let mdContent = '';
  const mdPath = target.markdownPath || path.join(checkpointsDir, target.markdownFilename || target.filename.replace(/\.json$/, '.md'));

  if (fs.existsSync(mdPath)) {
    try {
      mdContent = fs.readFileSync(mdPath, 'utf8');
    } catch (_) {}
  }

  if (!mdContent && typeof readCheckpointHandoff === 'function') {
    try {
      mdContent = readCheckpointHandoff(target.filename, checkpointsDir);
    } catch (_) {}
  }

  if (!mdContent && target.data) {
    mdContent = target.data.handoff_markdown || target.data.handoff_document || '';
  }

  if (!mdContent) {
    mdContent = [
      `# Recovery Handoff Document`,
      ``,
      `## Metadata`,
      `- **Title**: ${target.title}`,
      `- **Model**: ${target.model}`,
      `- **Account**: ${target.account}`,
      `- **Timestamp**: ${target.created_at}`,
      `- **Conversation ID**: ${target.conversation_id}`,
      ``,
      `## Instructions`,
      `Resume session using state recorded in ${target.filename}.`
    ].join('\n');
  }

  let copied = false;
  if (process.platform === 'darwin') {
    try {
      const proc = spawnSync('pbcopy', { input: mdContent, encoding: 'utf8' });
      if (proc.status === 0) {
        copied = true;
      } else {
        const procFallback = spawnSync('/usr/bin/pbcopy', { input: mdContent, encoding: 'utf8' });
        if (procFallback.status === 0) copied = true;
      }
    } catch (_) {
      try {
        const procFallback = spawnSync('/usr/bin/pbcopy', { input: mdContent, encoding: 'utf8' });
        if (procFallback.status === 0) copied = true;
      } catch (_) {}
    }
  } else if (process.platform === 'linux') {
    try {
      const proc = spawnSync('xclip', ['-selection', 'clipboard'], { input: mdContent, encoding: 'utf8' });
      if (proc.status === 0) copied = true;
      else {
        const procWl = spawnSync('wl-copy', { input: mdContent, encoding: 'utf8' });
        if (procWl.status === 0) copied = true;
      }
    } catch (_) {}
  } else if (process.platform === 'win32') {
    try {
      const proc = spawnSync('clip', { input: mdContent, encoding: 'utf8' });
      if (proc.status === 0) copied = true;
    } catch (_) {}
  }

  if (copied) {
    console.log(pc.green('✅ Latest handoff recovery document copied to clipboard!'));
    console.log(pc.dim('Ready to paste into successor agent prompt.\n'));
  } else {
    console.log(pc.yellow('Notice: Automatic clipboard copy is macOS-specific or utility not available.'));
    console.log(pc.dim('Document preview:\n' + mdContent.substring(0, 300) + '...\n'));
  }

  return { success: true, copied, content: mdContent, filename: target.markdownFilename };
}

// Format and display handoff document in terminal using picocolors for headers, codeblocks, and divider lines
function viewHandoffTerminal(checkpoints, checkpointsDir = DEFAULT_CHECKPOINTS_DIR, selectedIndex = 0) {
  if (!checkpoints || checkpoints.length === 0) {
    console.log(pc.yellow('⚠️  No checkpoints found to view.'));
    return { success: false, reason: 'no_checkpoints' };
  }

  const cpItem = checkpoints[selectedIndex] || checkpoints[0];
  let mdContent = '';
  const mdPath = cpItem.markdownPath || path.join(checkpointsDir, cpItem.markdownFilename || cpItem.filename.replace(/\.json$/, '.md'));

  if (fs.existsSync(mdPath)) {
    try {
      mdContent = fs.readFileSync(mdPath, 'utf8');
    } catch (_) {}
  }

  if (!mdContent && typeof readCheckpointHandoff === 'function') {
    try {
      mdContent = readCheckpointHandoff(cpItem.filename, checkpointsDir);
    } catch (_) {}
  }

  if (!mdContent && cpItem.data) {
    mdContent = cpItem.data.handoff_markdown || cpItem.data.handoff_document || '';
  }

  if (!mdContent) {
    console.log(pc.yellow(`⚠️  Companion markdown not found for ${cpItem.filename}`));
    return { success: false, reason: 'file_not_found' };
  }

  console.log('\n' + pc.cyan('='.repeat(72)));
  console.log(pc.cyan(pc.bold(`  📖 Handoff Document: ${cpItem.markdownFilename || cpItem.filename}`)));
  console.log(pc.cyan('='.repeat(72)) + '\n');

  const lines = mdContent.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      console.log(pc.dim(line));
    } else if (inCodeBlock) {
      console.log(pc.green(line));
    } else if (line.startsWith('# ')) {
      console.log(pc.cyan(pc.bold(line)));
    } else if (line.startsWith('## ')) {
      console.log(pc.yellow(pc.bold(line)));
    } else if (line.startsWith('### ')) {
      console.log(pc.white(pc.bold(line)));
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      console.log(pc.blue('• ') + line.slice(2));
    } else if (line.startsWith('> ')) {
      console.log(pc.dim(line));
    } else {
      console.log(line);
    }
  }

  console.log('\n' + pc.cyan('='.repeat(72)) + '\n');
  return { success: true, content: mdContent };
}

// Open checkpoints folder in macOS Finder via child_process.spawn('open', [dir]) with platform fallbacks
function openCheckpointsFolder(checkpointsDir = DEFAULT_CHECKPOINTS_DIR) {
  let resolvedDir = checkpointsDir;
  if (resolvedDir && resolvedDir.startsWith('~/')) {
    resolvedDir = path.join(os.homedir(), resolvedDir.slice(2));
  }

  if (!fs.existsSync(resolvedDir)) {
    try {
      fs.mkdirSync(resolvedDir, { recursive: true });
    } catch (_) {}
  }

  let opened = false;
  try {
    if (process.platform === 'darwin') {
      spawn('open', [resolvedDir], { detached: true, stdio: 'ignore' });
      opened = true;
    } else if (process.platform === 'win32') {
      spawn('explorer.exe', [resolvedDir], { detached: true, stdio: 'ignore' });
      opened = true;
    } else {
      spawn('xdg-open', [resolvedDir], { detached: true, stdio: 'ignore' });
      opened = true;
    }
  } catch (_) {}

  if (opened) {
    console.log(pc.green('📂 Opened checkpoints folder in Finder: ') + pc.dim(resolvedDir) + '\n');
  } else {
    console.log(pc.yellow('Could not launch file explorer automatically. Folder: ') + pc.dim(resolvedDir) + '\n');
  }

  return { success: opened, dir: resolvedDir };
}

// Manage and resume saved checkpoints interactively or via flags
async function manageCheckpoints(options = {}) {
  const args = process.argv.slice(2);

  // Check for flags in args or options
  const hasList = !!(options.action === 'list' || options.list || args.includes('--list') || args.includes('-l'));
  const hasCopy = !!(options.action === 'copy' || options.copy || args.includes('--copy') || args.includes('-c'));
  const hasView = !!(options.action === 'view' || options.view || args.includes('--view') || args.includes('-v'));
  const hasOpen = !!(options.action === 'open' || options.open || args.includes('--open') || args.includes('-o'));

  let customDir = options.checkpointsDir || null;
  if (!customDir) {
    const dirIdx = args.findIndex(a => a === '--dir' || a === '--checkpoints-dir');
    if (dirIdx !== -1 && args[dirIdx + 1]) {
      customDir = args[dirIdx + 1];
    }
  }
  if (customDir && customDir.startsWith('~/')) {
    customDir = path.join(os.homedir(), customDir.slice(2));
  }

  let selectedIndex = 0;
  const idxArg = args.findIndex(a => a === '--index' || a === '-i');
  if (idxArg !== -1 && args[idxArg + 1]) {
    const parsed = parseInt(args[idxArg + 1], 10);
    if (!isNaN(parsed) && parsed >= 1) {
      selectedIndex = parsed - 1;
    }
  }
  if (typeof options.index === 'number') {
    selectedIndex = options.index >= 1 ? options.index - 1 : options.index;
  }

  const checkpointsDir = customDir || DEFAULT_CHECKPOINTS_DIR;
  const checkpoints = listCheckpoints(checkpointsDir);

  if (options.file || args.includes('--file')) {
    const targetFile = options.file || args[args.indexOf('--file') + 1];
    if (targetFile) {
      const foundIdx = checkpoints.findIndex(c => c.filename === targetFile || c.markdownFilename === targetFile);
      if (foundIdx !== -1) {
        selectedIndex = foundIdx;
      }
    }
  }

  // Handle explicit non-interactive flags
  if (hasCopy) {
    return copyLatestHandoffToClipboard(checkpoints, checkpointsDir, selectedIndex);
  }
  if (hasView) {
    return viewHandoffTerminal(checkpoints, checkpointsDir, selectedIndex);
  }
  if (hasOpen) {
    return openCheckpointsFolder(checkpointsDir);
  }
  if (hasList) {
    displayCheckpointsTable(checkpoints, checkpointsDir);
    return checkpoints;
  }

  // Check if interactive
  const isInteractive = options.interactive !== undefined
    ? options.interactive
    : (process.stdin.isTTY && !process.env.CI);

  displayCheckpointsTable(checkpoints, checkpointsDir);

  if (!isInteractive) {
    return checkpoints;
  }

  if (checkpoints.length === 0) {
    return checkpoints;
  }

  const response = await prompts({
    type: 'select',
    name: 'action',
    message: 'Checkpoint action:',
    choices: [
      { title: '📋 Copy latest handoff document to clipboard (pbcopy)', value: 'copy' },
      { title: '📖 View handoff document in terminal', value: 'view' },
      { title: '📂 Open checkpoints directory in Finder', value: 'open' },
      { title: '← Back / Exit', value: 'exit' }
    ]
  });

  if (!response || !response.action || response.action === 'exit') {
    return checkpoints;
  }

  switch (response.action) {
    case 'copy':
      copyLatestHandoffToClipboard(checkpoints, checkpointsDir, selectedIndex);
      break;
    case 'view':
      if (checkpoints.length > 1) {
        const sel = await prompts({
          type: 'select',
          name: 'index',
          message: 'Select checkpoint to view:',
          choices: checkpoints.map((c, i) => ({
            title: `[${i + 1}] ${c.created_at} — ${c.title} (${c.model})`,
            value: i
          }))
        });
        if (sel && typeof sel.index === 'number') {
          viewHandoffTerminal(checkpoints, checkpointsDir, sel.index);
        }
      } else {
        viewHandoffTerminal(checkpoints, checkpointsDir, 0);
      }
      break;
    case 'open':
      openCheckpointsFolder(checkpointsDir);
      break;
  }

  return checkpoints;
}

// Main Interactive CLI Menu
async function showInteractiveMenu() {
  console.log(pc.cyan(`
   ╔════════════════════════════════════════════════════════╗
   ║          🛡️  ANTIGRAVITY QUOTA GUARD CLI              ║
   ║    Native HUD • Multi-Account Handover • Zero Loss    ║
   ╚════════════════════════════════════════════════════════╝
  `));

  const asarPath = getAsarPath();
  const patched = isAsarPatched(asarPath);
  console.log(pc.dim(`Status: ${patched ? pc.green('● ACTIVE (Patched)') : pc.yellow('○ NOT PATCHED')}\n`));

  const response = await prompts({
    type: 'select',
    name: 'action',
    message: 'Select an operation:',
    choices: [
      { title: patched ? '🔄 Update / Refresh Quota Guard Patch' : '🛡️  Install / Apply Quota Guard Patch', value: patched ? 'update' : 'install' },
      { title: '↩️  Uninstall / Revert to Factory State', value: 'uninstall' },
      { title: '📋 Resume / View Checkpoints', value: 'resume' },
      { title: '🩺 Doctor Diagnostics (Subsystem Audit)', value: 'doctor' },
      { title: '⚙️  Configure Settings (Thresholds, Colors, Sound)', value: 'config' },
      { title: '📊 View Status & Live Quota Health', value: 'status' },
      { title: '🚪 Exit', value: 'exit' }
    ]
  });

  switch (response.action) {
    case 'install':
      await installPatch();
      break;
    case 'update':
      await updatePatch();
      break;
    case 'uninstall':
      await uninstallPatch();
      break;
    case 'resume':
      await manageCheckpoints();
      break;
    case 'doctor':
      new QuotaGuardDoctor().printReport();
      break;
    case 'config':
      await configureSettings();
      break;
    case 'status':
      await showStatus();
      break;
    default:
      console.log(pc.dim('Goodbye!'));
      break;
  }
}

// CLI Argument Dispatcher
async function main() {
  const args = process.argv.slice(2);

  // V2.2 runtime commands — route to new subsystem
  const v2Commands = ['coordinator', 'v2-status', 'doctor-v2'];
  if (v2Commands.includes(args[0])) {
    const { getRuntime } = require('./v2-runtime.js');
    const runtime = getRuntime();
    if (args[0] === 'coordinator') {
      runtime.startCoordinator().then(coord => {
        console.log('Coordinator running on:', coord.socketPath);
        process.on('SIGINT', () => coord.stop().then(() => process.exit(0)));
      }).catch(err => {
        console.error('Coordinator error:', err.message);
        process.exit(1);
      });
    } else if (args[0] === 'v2-status') {
      runtime.initialize().then(() => {
        const s = runtime.getStatus();
        console.log(JSON.stringify(s, null, 2));
      }).catch(err => { console.error(err.message); process.exit(1); });
    }
    return; // Don't fall through to V1 handling
  }

  const arg = args[0] ? args[0].toLowerCase() : null;

  if (arg === 'install' || arg === 'apply') {
    await installPatch();
  } else if (arg === 'update' || arg === 'upgrade') {
    await updatePatch();
  } else if (arg === 'uninstall' || arg === 'restore' || arg === 'revert') {
    await uninstallPatch();
  } else if (arg === 'doctor') {
    const doctor = new QuotaGuardDoctor();
    doctor.printReport();
  } else if (arg === 'status') {
    await showStatus();
  } else if (arg === 'config' || arg === 'settings') {
    await configureSettings();
  } else if (arg === 'resume' || arg === 'checkpoints') {
    await manageCheckpoints();
  } else if (args.includes('--list') || args.includes('--copy') || args.includes('--view') || args.includes('--open')) {
    await manageCheckpoints();
  } else {
    await showInteractiveMenu();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(pc.red('Fatal error:'), err);
    process.exit(1);
  });
}

module.exports = {
  getAsarPath,
  isAntigravityRunning,
  isAsarPatched,
  installPatch,
  updatePatch,
  uninstallPatch,
  patchAsar,
  showStatus,
  configureSettings,
  showInteractiveMenu,
  listCheckpoints,
  displayCheckpointsTable,
  copyLatestHandoffToClipboard,
  viewHandoffTerminal,
  openCheckpointsFolder,
  manageCheckpoints,
  DEFAULT_CHECKPOINTS_DIR,
  CHECKPOINTS_DIR: DEFAULT_CHECKPOINTS_DIR,
  main
};
