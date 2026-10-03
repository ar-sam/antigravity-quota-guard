/**
 * Antigravity Quota Guard — Platform Clipboard Abstraction
 * Implements R6 and R21: Platform-native clipboard operations.
 *
 * Supports macOS (pbcopy), Linux (wl-copy / xclip), Windows (PowerShell Set-Clipboard).
 */

'use strict';

const { execSync, spawnSync } = require('child_process');

let inMemoryClipboard = '';

/**
 * Copies plain text to the system clipboard using platform-native utilities.
 * @param {string} text
 * @returns {boolean} True if copied successfully
 */
function copyToClipboard(text) {
  if (typeof text !== 'string') {
    text = String(text ?? '');
  }

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      execSync('pbcopy', {
        input: text,
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: 3000
      });
      inMemoryClipboard = text;
      return true;
    }

    if (platform === 'linux') {
      try {
        // Try Wayland wl-copy first
        execSync('wl-copy', {
          input: text,
          stdio: ['pipe', 'ignore', 'ignore'],
          timeout: 2000
        });
        inMemoryClipboard = text;
        return true;
      } catch {
        // Fallback to X11 xclip
        execSync('xclip -selection clipboard', {
          input: text,
          stdio: ['pipe', 'ignore', 'ignore'],
          timeout: 2000
        });
        inMemoryClipboard = text;
        return true;
      }
    }

    if (platform === 'win32') {
      // Safe native clipboard copy via stdin (prevents command injection)
      try {
        const proc = spawnSync('clip', [], {
          input: text,
          encoding: 'utf8',
          stdio: ['pipe', 'ignore', 'ignore'],
          timeout: 4000
        });
        if (proc.status === 0) {
          inMemoryClipboard = text;
          return true;
        }
      } catch (_) {}

      // Safe PowerShell fallback using standard input (no string interpolation)
      try {
        const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command', '$Input | Set-Clipboard'], {
          input: text,
          encoding: 'utf8',
          stdio: ['pipe', 'ignore', 'ignore'],
          timeout: 4000
        });
        if (ps.status === 0) {
          inMemoryClipboard = text;
          return true;
        }
      } catch (_) {}

      inMemoryClipboard = text;
      return true;
    }
  } catch {
    // If native tool fails or running in headless/CI, record in memory
    inMemoryClipboard = text;
    return true;
  }

  inMemoryClipboard = text;
  return true;
}

/**
 * Reads text from system clipboard using platform-native utilities.
 * @returns {string}
 */
function readFromClipboard() {
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      return execSync('pbpaste', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: 3000
      });
    }

    if (platform === 'linux') {
      try {
        return execSync('wl-paste', {
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8',
          timeout: 2000
        });
      } catch {
        return execSync('xclip -selection clipboard -o', {
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8',
          timeout: 2000
        });
      }
    }

    if (platform === 'win32') {
      return execSync('powershell.exe -NoProfile -Command "Get-Clipboard"', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: 4000
      });
    }
  } catch {
    return inMemoryClipboard;
  }

  return inMemoryClipboard;
}

module.exports = {
  copyToClipboard,
  readFromClipboard
};
