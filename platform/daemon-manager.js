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

class DaemonManager {
  constructor(options = {}) {
    this.label = options.label || DAEMON_LABEL;
    this.plistPath = options.plistPath || getPlistPath();
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

  isConfigured() {
    return fs.existsSync(this.plistPath);
  }

  installDaemon() {
    const dir = path.dirname(this.plistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    const xml = this.generatePlistXml();
    fs.writeFileSync(this.plistPath, xml, { mode: 0o644 });
    return true;
  }

  uninstallDaemon() {
    if (fs.existsSync(this.plistPath)) {
      fs.unlinkSync(this.plistPath);
      return true;
    }
    return false;
  }
}

module.exports = {
  DAEMON_LABEL,
  DaemonManager,
  getPlistPath
};
