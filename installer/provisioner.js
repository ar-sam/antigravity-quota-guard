/**
 * Antigravity Quota Guard — Hybrid Runtime Provisioner
 * Coordinates the full installation and deprovisioning lifecycle:
 * 1. Official standalone plugin deployment to ~/.gemini/antigravity/plugins/
 * 2. Diagnostic MCP server registration in ~/.gemini/antigravity/mcp_config.json
 * 3. CLI statusline feed multiplexer registration
 * 4. Transactional ASAR patching for Desktop HUD via AsarPatcher
 * 5. Complete, byte-identical deprovisioning and rollback
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { AsarPatcher } = require('./asar-patcher');
const { BackupManager } = require('./backup-manager');
const { PreflightChecker } = require('./preflight-checker');

const DEFAULT_PLUGIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'plugins', 'antigravity-quota-guard');
const DEFAULT_MCP_CONFIG = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');

/**
 * Recursively copies a directory from src to dest.
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

/**
 * Deploys the official standalone plugin to ~/.gemini/antigravity/plugins/antigravity-quota-guard/
 * @param {object} [options]
 * @returns {{ success: boolean, pluginDir: string, filesCopied: number }}
 */
function deployOfficialPlugin(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  const destDir = options.destDir || DEFAULT_PLUGIN_DIR;

  fs.mkdirSync(destDir, { recursive: true, mode: 0o755 });
  let filesCopied = 0;

  // Root manifest files
  const manifestFiles = ['plugin.json', 'hooks.json', 'mcp_config.json', 'package.json'];
  for (const f of manifestFiles) {
    const src = path.join(repoRoot, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, f));
      filesCopied++;
    }
  }

  // Subsystem directories
  const directories = [
    'hooks',
    'sidecars',
    'skills',
    'mcp',
    'core',
    'auth',
    'providers',
    'platform',
    'integrations',
    'ui',
    'bin'
  ];

  for (const d of directories) {
    const src = path.join(repoRoot, d);
    const dest = path.join(destDir, d);
    filesCopied += copyDirSync(src, dest);
  }

  // Ensure all hook shell scripts have execution permission
  const hooksDir = path.join(destDir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    const scripts = fs.readdirSync(hooksDir).filter(f => f.endsWith('.sh'));
    for (const s of scripts) {
      try {
        fs.chmodSync(path.join(hooksDir, s), 0o755);
      } catch (_) {}
    }
  }

  // Ensure sidecar entry scripts have execution permission
  const sidecarEntry = path.join(destDir, 'sidecars', 'quota-guard-coordinator', 'coordinator-entry.js');
  if (fs.existsSync(sidecarEntry)) {
    try {
      fs.chmodSync(sidecarEntry, 0o755);
    } catch (_) {}
  }

  return {
    success: true,
    pluginDir: destDir,
    filesCopied
  };
}

/**
 * Removes the official standalone plugin.
 * @param {object} [options]
 * @returns {{ success: boolean, removed: boolean }}
 */
function removeOfficialPlugin(options = {}) {
  const destDir = options.destDir || DEFAULT_PLUGIN_DIR;
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
    return { success: true, removed: true };
  }
  return { success: true, removed: false };
}

/**
 * Registers the read-only diagnostic MCP server in Antigravity's mcp_config.json.
 * @param {object} [options]
 * @returns {{ success: boolean, configPath: string }}
 */
function registerMcpServer(options = {}) {
  const mcpConfigPath = options.mcpConfigPath || DEFAULT_MCP_CONFIG;
  const pluginDir = options.pluginDir || DEFAULT_PLUGIN_DIR;
  const serverPath = path.join(pluginDir, 'mcp', 'read-only-server.js');

  const parentDir = path.dirname(mcpConfigPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  }

  let config = { mcpServers: {} };
  if (fs.existsSync(mcpConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        config.mcpServers = {};
      }
    } catch (_) {
      config = { mcpServers: {} };
    }
  }

  config.mcpServers.quota_guard = {
    command: 'node',
    args: [serverPath]
  };

  const tmpPath = `${mcpConfigPath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, mcpConfigPath);

  return {
    success: true,
    configPath: mcpConfigPath
  };
}

/**
 * Unregisters the quota_guard MCP server from mcp_config.json.
 * @param {object} [options]
 * @returns {{ success: boolean, unregistered: boolean }}
 */
function unregisterMcpServer(options = {}) {
  const mcpConfigPath = options.mcpConfigPath || DEFAULT_MCP_CONFIG;
  if (!fs.existsSync(mcpConfigPath)) {
    return { success: true, unregistered: false };
  }

  try {
    const raw = fs.readFileSync(mcpConfigPath, 'utf8');
    const config = JSON.parse(raw);
    if (config.mcpServers && config.mcpServers.quota_guard) {
      delete config.mcpServers.quota_guard;
      const tmpPath = `${mcpConfigPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      fs.renameSync(tmpPath, mcpConfigPath);
      return { success: true, unregistered: true };
    }
  } catch (_) {}

  return { success: true, unregistered: false };
}

/**
 * Configures the statusline multiplexer in Quota Guard's config store.
 * @param {object} [options]
 * @returns {{ success: boolean, adapterPath: string }}
 */
function configureStatuslineMultiplexer(options = {}) {
  const pluginDir = options.pluginDir || DEFAULT_PLUGIN_DIR;
  const adapterPath = path.join(pluginDir, 'providers', 'cli-statusline-feed-adapter.js');

  const configDir = options.configDir || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
  const configFile = path.join(configDir, 'config.json');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  let cfg = {};
  if (fs.existsSync(configFile)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (_) {}
  }

  if (!cfg.statusline) cfg.statusline = {};
  cfg.statusline.multiplexerActive = true;
  cfg.statusline.adapterPath = adapterPath;

  const tmpCfg = `${configFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpCfg, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmpCfg, configFile);

  return {
    success: true,
    adapterPath
  };
}

/**
 * Restores statusline configuration upon uninstallation.
 * @param {object} [options]
 * @returns {{ success: boolean }}
 */
function restoreStatuslineConfig(options = {}) {
  const configDir = options.configDir || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
  const configFile = path.join(configDir, 'config.json');

  if (fs.existsSync(configFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (cfg.statusline) {
        cfg.statusline.multiplexerActive = false;
        const tmpCfg = `${configFile}.tmp.${Date.now()}`;
        fs.writeFileSync(tmpCfg, JSON.stringify(cfg, null, 2), { mode: 0o600 });
        fs.renameSync(tmpCfg, configFile);
      }
    } catch (_) {}
  }

  return { success: true };
}

/**
 * Complete hybrid provisioning pipeline.
 * @param {object} options
 * @param {string} options.asarPath - Path to Antigravity app.asar
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<object>}
 */
async function provisionHybrid(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  const asarPath = options.asarPath;
  const dryRun = options.dryRun === true;

  // 1. Deploy official plugin files
  const pluginResult = deployOfficialPlugin({
    repoRoot,
    destDir: options.pluginDir
  });

  // 2. Register diagnostic MCP server
  const mcpResult = registerMcpServer({
    pluginDir: pluginResult.pluginDir,
    mcpConfigPath: options.mcpConfigPath
  });

  // 3. Configure statusline multiplexer
  const statuslineResult = configureStatuslineMultiplexer({
    pluginDir: pluginResult.pluginDir,
    configDir: options.configDir
  });

  // 4. Transactional ASAR patch for Desktop HUD
  let patchResult = null;
  if (asarPath && fs.existsSync(asarPath)) {
    const patcher = new AsarPatcher({
      asarPath,
      backupManager: new BackupManager(options),
      preflightChecker: new PreflightChecker(options)
    });

    patchResult = await patcher.patch({
      dryRun,
      ignoreRunningProcess: options.ignoreRunningProcess ?? dryRun,
      modifierFn: async (stagedDir) => {
        // Inject HUD payload and main process hooks
        const utilsPath = path.join(stagedDir, 'dist', 'utils.js');
        if (!fs.existsSync(utilsPath)) {
          throw new Error(`dist/utils.js not found in extracted ASAR: ${utilsPath}`);
        }

        const payloadSrc = path.join(repoRoot, 'bin', 'payload.js');
        const payloadDest = path.join(stagedDir, 'dist', 'quota-guard-payload.js');
        fs.copyFileSync(payloadSrc, payloadDest);

        const snapshotSrc = path.join(repoRoot, 'bin', 'snapshot.js');
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
      }
    });
  }

  return {
    success: true,
    pluginResult,
    mcpResult,
    statuslineResult,
    patchResult
  };
}

/**
 * Reverts all hybrid provisioning (restores ASAR, unregisters MCP, restores statusline, removes plugin).
 * @param {object} options
 * @param {string} options.asarPath
 * @returns {object}
 */
function deprovisionHybrid(options = {}) {
  const asarPath = options.asarPath;

  // 1. Rollback ASAR if backup exists
  let asarRestored = false;
  if (asarPath && fs.existsSync(asarPath)) {
    const backupPath = asarPath + '.bak';
    const bm = new BackupManager(options);
    try {
      const res = bm.restoreBackup(asarPath);
      asarRestored = res.restored;
    } catch (_) {
      // Fallback to legacy .bak if present
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, asarPath);
        asarRestored = true;
      }
    }
  }

  // 2. Unregister MCP server
  const mcpResult = unregisterMcpServer(options);

  // 3. Restore statusline config
  const statuslineResult = restoreStatuslineConfig(options);

  // 4. Remove official plugin
  const pluginResult = removeOfficialPlugin(options);

  return {
    success: true,
    asarRestored,
    mcpResult,
    statuslineResult,
    pluginResult
  };
}

module.exports = {
  DEFAULT_PLUGIN_DIR,
  DEFAULT_MCP_CONFIG,
  deployOfficialPlugin,
  removeOfficialPlugin,
  registerMcpServer,
  unregisterMcpServer,
  configureStatuslineMultiplexer,
  restoreStatuslineConfig,
  provisionHybrid,
  deprovisionHybrid
};
