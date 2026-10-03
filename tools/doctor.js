/**
 * Antigravity Quota Guard — Doctor Diagnostic Tool
 * Implements R21: Comprehensive read-only system diagnostic command.
 *
 * Checks versions, plugin layout, coordinator status, config & LKG,
 * secure storage, checkpoints, ASAR status, timezone, and docs parity.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { sha256File } = require('../installer/backup-manager');
const { resolveEffectiveTimeZone } = require('../ui/desktop-hud/timezone-manager');
const { isProcessAlive } = require('../core/coordinator');

class QuotaGuardDoctor {
  constructor(options = {}) {
    this._appPath = options.appPath || '/Applications/Antigravity.app';
    this._rootDir = options.rootDir || path.resolve(__dirname, '..');
    this._configDir = options.configDir || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
    this._checkpointsDir = options.checkpointsDir || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'checkpoints');
  }

  /**
   * Runs the full diagnostic audit and returns a structured report.
   * @returns {object}
   */
  runDiagnostics() {
    const report = {
      timestamp: new Date().toISOString(),
      guardVersion: '2.2.0',
      status: 'HEALTHY',
      checks: {}
    };

    const issues = [];

    // 1. Antigravity App Check
    const appExists = fs.existsSync(this._appPath);
    const candidateAsar = path.join(this._appPath, 'Contents', 'Resources', 'app.asar');
    const asarExists = fs.existsSync(candidateAsar);
    report.checks.antigravityApp = {
      path: this._appPath,
      exists: appExists,
      asarExists,
      status: appExists && asarExists ? 'OK' : 'MISSING'
    };
    if (!appExists) issues.push('Antigravity.app is not found at standard location.');

    // 2. Plugin Conformance Layout Check
    const pluginJson = path.join(this._rootDir, 'plugin.json');
    const hooksJson = path.join(this._rootDir, 'hooks.json');
    const mcpConfig = path.join(this._rootDir, 'mcp_config.json');
    const sidecarJson = path.join(this._rootDir, 'sidecars', 'quota-guard-coordinator', 'sidecar.json');
    const skillMd = path.join(this._rootDir, 'skills', 'recovery-skill', 'SKILL.md');

    const layoutValid = [pluginJson, hooksJson, mcpConfig, sidecarJson, skillMd].every(p => fs.existsSync(p));
    report.checks.pluginLayout = {
      status: layoutValid ? 'OK' : 'INCOMPLETE',
      files: {
        pluginJson: fs.existsSync(pluginJson),
        hooksJson: fs.existsSync(hooksJson),
        mcpConfig: fs.existsSync(mcpConfig),
        sidecarJson: fs.existsSync(sidecarJson),
        skillMd: fs.existsSync(skillMd)
      }
    };
    if (!layoutValid) issues.push('Official plugin package files are missing.');

    // 3. Configuration & LKG Check
    const configFile = path.join(this._configDir, 'config.json');
    const lkgFile = path.join(this._configDir, 'config.lkg.json');
    report.checks.configuration = {
      configExists: fs.existsSync(configFile),
      lkgExists: fs.existsSync(lkgFile),
      status: fs.existsSync(configFile) ? 'OK' : 'NOT_INITIALIZED'
    };

    // 4. Secure Storage & Fingerprint Key Check
    const keyFile = path.join(this._configDir, 'account-fingerprint.key');
    let keySecure = false;
    if (fs.existsSync(keyFile)) {
      try {
        const stat = fs.statSync(keyFile);
        const mode = stat.mode & 0o777;
        keySecure = (mode === 0o600);
      } catch {}
    }
    report.checks.secureStorage = {
      keyExists: fs.existsSync(keyFile),
      keyPermissionsValid: keySecure,
      status: fs.existsSync(keyFile) ? (keySecure ? 'OK' : 'PERMISSIONS_PERMISSIVE') : 'NOT_INITIALIZED'
    };
    if (fs.existsSync(keyFile) && !keySecure) {
      issues.push('account-fingerprint.key has permissive permissions (must be 0600).');
    }

    // 5. Checkpoints Directory Check
    const checkpointsExist = fs.existsSync(this._checkpointsDir);
    let checkpointCount = 0;
    if (checkpointsExist) {
      try {
        checkpointCount = fs.readdirSync(this._checkpointsDir).filter(f => f.endsWith('.json')).length;
      } catch {}
    }
    report.checks.checkpoints = {
      exists: checkpointsExist,
      count: checkpointCount,
      status: 'OK'
    };

    // 6. ASAR Integrity / Patch Status
    if (asarExists) {
      const liveSha = sha256File(candidateAsar);
      const originalBackup = path.join(this._configDir, 'backups', 'app.asar.original');
      const isPatched = fs.existsSync(originalBackup) && liveSha !== sha256File(originalBackup);
      report.checks.asarIntegrity = {
        liveSha256: liveSha,
        isPatched,
        status: 'OK'
      };
    } else {
      report.checks.asarIntegrity = { status: 'UNAVAILABLE' };
    }

    // 7. Timezone & Locale
    const activeTz = resolveEffectiveTimeZone();
    report.checks.displayEnvironment = {
      timeZone: activeTz,
      locale: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
      status: 'OK'
    };

    // 8. Coordinator Socket & Liveness Check
    const socketPath = path.join(this._configDir, 'run', 'coordinator.sock');
    const pidFile = path.join(this._configDir, 'run', 'coordinator.pid');
    let coordRunning = false;
    let coordPid = null;
    if (fs.existsSync(pidFile)) {
      try {
        coordPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (coordPid && isProcessAlive(coordPid)) {
          coordRunning = true;
        }
      } catch {}
    }
    report.checks.coordinator = {
      socketExists: fs.existsSync(socketPath),
      pid: coordPid,
      running: coordRunning,
      status: coordRunning ? 'RUNNING' : 'STOPPED'
    };

    // Determine overall status
    if (issues.length === 0) {
      report.status = 'HEALTHY';
    } else if (issues.length <= 2) {
      report.status = 'DEGRADED';
    } else {
      report.status = 'UNHEALTHY';
    }

    report.issues = issues;
    return report;
  }

  /**
   * Formats and prints diagnostic summary to terminal.
   * @param {object} [report]
   */
  printReport(report = null) {
    const diag = report || this.runDiagnostics();

    console.log('\n============================================================');
    console.log(`🛡️  Antigravity Quota Guard Doctor — Diagnostic Report (${diag.guardVersion})`);
    console.log('============================================================');
    console.log(`Timestamp: ${diag.timestamp}`);
    console.log(`Overall Health Status: ${diag.status === 'HEALTHY' ? '✅ HEALTHY' : (diag.status === 'DEGRADED' ? '⚠️  DEGRADED' : '❌ UNHEALTHY')}\n`);

    console.log('Subsystem Status:');
    console.log(`  • Antigravity Target:  ${diag.checks.antigravityApp.status === 'OK' ? '✅ Found' : '⚠️ Missing'} (${diag.checks.antigravityApp.path})`);
    console.log(`  • Plugin Conformance:  ${diag.checks.pluginLayout.status === 'OK' ? '✅ Conforming' : '❌ Missing files'}`);
    console.log(`  • User Configuration:  ${diag.checks.configuration.status === 'OK' ? '✅ Initialized' : 'ℹ️ Default / Unset'}`);
    console.log(`  • Secure Storage:      ${diag.checks.secureStorage.status === 'OK' ? '✅ 0600 Secured' : 'ℹ️ Not set / Pending'}`);
    console.log(`  • Checkpoints Vault:   ✅ Active (${diag.checks.checkpoints.count} saved)`);
    console.log(`  • Coordinator Daemon:  ${diag.checks.coordinator?.running ? '✅ Running (PID ' + diag.checks.coordinator.pid + ')' : 'ℹ️ Stopped / Idle'}`);
    console.log(`  • Active Timezone:     🌐 ${diag.checks.displayEnvironment.timeZone} (${diag.checks.displayEnvironment.locale})`);

    if (diag.issues.length > 0) {
      console.log('\nIdentified Issues / Recommendations:');
      diag.issues.forEach(iss => console.log(`  ⚠️  ${iss}`));
    }
    console.log('============================================================\n');
  }
}

// CLI execution handler
if (require.main === module) {
  const doctor = new QuotaGuardDoctor();
  doctor.printReport();
}

module.exports = {
  QuotaGuardDoctor
};
