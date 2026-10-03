'use strict';

/**
 * Antigravity Quota Guard — LaunchAgent Daemon Manager
 * Manages the background coordinator daemon as a macOS LaunchAgent.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DAEMON_LABEL = 'com.antigravity.quotaguard.coordinator';

function getLaunchAgentDir() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function getPlistPath() {
  return path.join(getLaunchAgentDir(), `${DAEMON_LABEL}.plist`);
}

function getSystemdUserDir() {
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

function getSystemdServicePath() {
  return path.join(getSystemdUserDir(), 'antigravity-quota-guard.service');
}

class DaemonManager {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.label = options.label || DAEMON_LABEL;
    this.plistPath = options.plistPath || getPlistPath();
    this.servicePath = options.servicePath || getSystemdServicePath();
    this.entrypointPath = options.entrypointPath || path.resolve(__dirname, '../sidecars/quota-guard-coordinator/coordinator-entry.js');
    this.nodePath = options.nodePath || process.execPath;
  }

  generatePlistXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${this.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${this.nodePath}</string>
    <string>${this.entrypointPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>
`;
  }

  generateSystemdService() {
    return `[Unit]
Description=Antigravity Quota Guard Coordinator Daemon
After=network.target

[Service]
Type=simple
ExecStart=${this.nodePath} ${this.entrypointPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
  }

  isConfigured() {
    if (this.platform === 'darwin') {
      return fs.existsSync(this.plistPath);
    }
    if (this.platform === 'linux') {
      return fs.existsSync(this.servicePath);
    }
    return false;
  }

  installDaemon() {
    if (this.platform === 'darwin') {
      const dir = path.dirname(this.plistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      }
      const xml = this.generatePlistXml();
      fs.writeFileSync(this.plistPath, xml, { mode: 0o644 });
      return true;
    }

    if (this.platform === 'linux') {
      const dir = path.dirname(this.servicePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      }
      const unit = this.generateSystemdService();
      fs.writeFileSync(this.servicePath, unit, { mode: 0o644 });
      return true;
    }

    return false;
  }

  uninstallDaemon() {
    if (this.platform === 'darwin' && fs.existsSync(this.plistPath)) {
      fs.unlinkSync(this.plistPath);
      return true;
    }

    if (this.platform === 'linux' && fs.existsSync(this.servicePath)) {
      fs.unlinkSync(this.servicePath);
      return true;
    }

    return false;
  }
}

module.exports = {
  DAEMON_LABEL,
  DaemonManager,
  getPlistPath,
  getSystemdServicePath
};
