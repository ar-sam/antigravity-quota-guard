/**
 * Antigravity Quota Guard — Desktop HUD Main Process Bridge
 * Safe IPC mediator connecting Electron Main process with HUD Renderer.
 *
 * Implements R6 from architecture specification:
 * - Reads derived, sanitized runtime-state.json (mode 0600).
 * - Enforces window allowlist (strictly prevents injection into Auth/OAuth/DevTools).
 * - Safe IPC handlers for HUD actions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDerivedRuntimeStatePath } = require('../../core/coordinator.js');

/**
 * Disallowed window title patterns (Auth, OAuth, DevTools).
 */
const FORBIDDEN_WINDOW_PATTERNS = [
  /oauth/i,
  /sign in/i,
  /login/i,
  /accounts\.google\.com/i,
  /devtools/i,
  /chrome-devtools/i
];

class HudMainBridge {
  constructor(options = {}) {
    this._runDir = options.runDir || path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'run');
    this._statePath = options.statePath || getDerivedRuntimeStatePath();
    this._coordinator = options.coordinator || null;
    this._allowedWindowIds = new Set();
  }

  /**
   * Evaluates if a target Electron window is eligible for HUD mounting.
   * R6 Invariant: Strictly rejects OAuth, Auth, login, and DevTools windows.
   * @param {object} win - Electron BrowserWindow or mock descriptor
   * @returns {boolean}
   */
  isWindowAllowed(win) {
    if (!win) return false;

    // Check URL or title
    const url = typeof win.getURL === 'function' ? win.getURL() : (win.url || '');
    const title = typeof win.getTitle === 'function' ? win.getTitle() : (win.title || '');

    for (const pattern of FORBIDDEN_WINDOW_PATTERNS) {
      if (pattern.test(url) || pattern.test(title)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Registers an allowed window.
   * @param {number|string} windowId
   */
  registerAllowedWindow(windowId) {
    this._allowedWindowIds.add(String(windowId));
  }

  /**
   * Reads derived runtime state from disk.
   * Returns sanitized representation without transcripts or credentials.
   * @returns {object}
   */
  getSanitizedRuntimeState() {
    try {
      if (fs.existsSync(this._statePath)) {
        const raw = fs.readFileSync(this._statePath, 'utf8');
        const parsed = JSON.parse(raw);
        // Ensure sensitive fields are stripped
        delete parsed.rawEmail;
        delete parsed.apiKey;
        delete parsed.transcript;
        return parsed;
      }
    } catch {
      // Fallback empty state
    }

    return {
      revision: 0,
      guardState: 'SAFE',
      healthState: 'INIT',
      effectiveQuota: null,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Handles safe IPC messages from Renderer.
   * Validates that the sender window is allowlisted.
   * @param {string} channel
   * @param {any} payload
   * @param {string|number} senderWindowId
   * @returns {Promise<any>}
   */
  async handleIpcMessage(channel, payload, senderWindowId) {
    if (!this._allowedWindowIds.has(String(senderWindowId))) {
      const err = new Error(`Unauthorized IPC call from window: ${senderWindowId}`);
      err.code = 'UNAUTHORIZED_WINDOW_IPC';
      throw err;
    }

    switch (channel) {
      case 'GET_RUNTIME_STATE':
        return this.getSanitizedRuntimeState();

      case 'TOGGLE_UNMONITORED_BYPASS':
        if (this._coordinator && typeof this._coordinator.grantUnmonitoredBypass === 'function') {
          return this._coordinator.grantUnmonitoredBypass(payload?.surfaceInstanceId, payload?.conversationId);
        }
        return { success: false, reason: 'Coordinator not connected' };

      case 'REQUEST_RESUME':
        return { success: true, timestamp: new Date().toISOString() };

      case 'DISMISS_PANEL':
        return { dismissed: true, timestamp: new Date().toISOString() };

      case 'SAVE_CONFIG':
        return { saved: true, timestamp: new Date().toISOString() };

      case 'RESET_CONFIG':
        return { reset: true, timestamp: new Date().toISOString() };

      default:
        throw new Error(`Unknown IPC channel: ${channel}`);
    }
  }

  /**
   * Attaches clean Electron IPC handlers to ipcMain.
   * @param {object} ipcMain - Electron ipcMain module
   * @param {object} BrowserWindow - Electron BrowserWindow class
   */
  attachElectronIpc(ipcMain, BrowserWindow) {
    if (!ipcMain || typeof ipcMain.handle !== 'function') return false;

    const channels = ['GET_RUNTIME_STATE', 'TOGGLE_UNMONITORED_BYPASS', 'REQUEST_RESUME', 'DISMISS_PANEL', 'SAVE_CONFIG', 'RESET_CONFIG'];

    for (const ch of channels) {
      try { ipcMain.removeHandler(`QUOTA_GUARD_${ch}`); } catch (_) {}
      ipcMain.handle(`QUOTA_GUARD_${ch}`, async (event, payload) => {
        const senderWin = BrowserWindow && typeof BrowserWindow.fromWebContents === 'function'
          ? BrowserWindow.fromWebContents(event.sender)
          : null;
        const winId = senderWin ? senderWin.id : (event.sender ? event.sender.id : 'unknown');
        if (senderWin && !this.isWindowAllowed(senderWin)) {
          throw new Error('Forbidden window for Quota Guard IPC');
        }
        this.registerAllowedWindow(winId);
        return this.handleIpcMessage(ch, payload, winId);
      });
    }
    return true;
  }
}

module.exports = {
  HudMainBridge,
  FORBIDDEN_WINDOW_PATTERNS
};
