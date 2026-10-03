/**
 * Antigravity Quota Guard — Desktop HUD Renderer
 * Renders the non-blocking floating warning panel and 42px status pill.
 *
 * Implements R6, R24, and R27 from architecture specification:
 * - Floating panel anchored to bottom-right (bottom: 20px; right: 20px; width: 420px).
 * - RTL layout support with IRANYekanX Persian typography.
 * - Compact relative time in badge, detailed local time in panel.
 * - Ephemeral UNMONITORED_BYPASS_ACTIVE button when quota is UNAVAILABLE.
 * - Autonomy posture detection display.
 * - One-Click Handoff Copy button and Settings lock.
 */

'use strict';

const { toPersianDigits, formatRelativeResetTime, formatLocalClockTime } = require('./timezone-manager');

/**
 * Generates the CSS stylesheet for the floating HUD panel and status pill.
 * @param {object} [options]
 * @param {boolean} [options.isRtl=true]
 * @returns {string} CSS styles
 */
function generateHudCss(options = {}) {
  const isRtl = options.isRtl !== false;

  return `
/* Antigravity Quota Guard V2.2 HUD Styles */
#qg-hud-root {
  position: fixed;
  bottom: 20px;
  ${isRtl ? 'left: 20px; right: auto;' : 'right: 20px; left: auto;'}
  z-index: 999999;
  font-family: ${isRtl ? "'IRANYekanX', -apple-system, BlinkMacSystemFont, sans-serif" : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"};
  direction: ${isRtl ? 'rtl' : 'ltr'};
  user-select: none;
  font-size: 13px;
  color: #e0e0e0;
}

#qg-status-pill {
  height: 42px;
  background: rgba(24, 24, 27, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 21px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s;
}

#qg-status-pill:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.25);
}

.qg-quota-badge {
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 12px;
}

.qg-badge-safe { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
.qg-badge-warn { background: rgba(234, 179, 8, 0.2); color: #facc15; }
.qg-badge-stabilize { background: rgba(249, 115, 22, 0.2); color: #fb923c; }
.qg-badge-halt { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.qg-badge-unknown { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; }

#qg-floating-panel {
  width: 420px;
  background: rgba(20, 20, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(16px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.qg-panel-header {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.qg-panel-title {
  font-weight: 600;
  font-size: 14px;
}

.qg-panel-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.qg-progress-container {
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.qg-progress-bar {
  height: 100%;
  background: #3b82f6;
  width: 0%;
  transition: width 0.3s ease;
}

.qg-action-button {
  padding: 8px 14px;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.qg-btn-primary { background: #2563eb; color: #fff; }
.qg-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.qg-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.qg-btn-success { background: #16a34a; color: #fff; }
.qg-btn-success:hover:not(:disabled) { background: #15803d; }

.qg-btn-secondary { background: rgba(255, 255, 255, 0.1); color: #e0e0e0; }
.qg-btn-secondary:hover { background: rgba(255, 255, 255, 0.16); }
`;
}

/**
 * Renders the complete HTML string for the HUD panel.
 * @param {object} state
 * @param {object} [config]
 * @param {object} [options]
 * @returns {string} HTML
 */
function renderHudSnapshot(state = {}, config = {}, options = {}) {
  const locale = options.locale || 'fa';
  const isRtl = locale === 'fa';
  const effectiveQuota = state.effectiveQuota ?? null;
  const guardState = state.guardState || 'SAFE';
  const isHalted = guardState === 'HALTED' || guardState === 'HALTED_BACKGROUND_ACTIVE';
  const isPreCheckpointed = guardState === 'CHECKPOINT' || guardState === 'HALT_PENDING';
  const timeZone = options.timeZone || 'UTC';
  const resetEpoch = state.resetEpoch || null;

  // Formatting strings
  const quotaText = effectiveQuota !== null
    ? `${isRtl ? toPersianDigits(effectiveQuota) : effectiveQuota}%`
    : '--%';

  const relativeTime = formatRelativeResetTime(resetEpoch, locale);
  const localClock = formatLocalClockTime(resetEpoch, timeZone, locale);

  let badgeClass = 'qg-badge-safe';
  if (guardState === 'WARN') badgeClass = 'qg-badge-warn';
  if (guardState === 'STABILIZE' || guardState === 'CHECKPOINT') badgeClass = 'qg-badge-stabilize';
  if (isHalted || guardState === 'HALT_PENDING') badgeClass = 'qg-badge-halt';
  if (effectiveQuota === null) badgeClass = 'qg-badge-unknown';

  const titleText = isRtl ? 'سامانه محافظ سهمیه هوشمند' : 'Antigravity Quota Guard';
  const statusLabel = isRtl ? `سهمیه باقی‌مانده: ${quotaText}` : `Quota: ${quotaText}`;
  const resetLabel = isRtl ? `زمان بازنشانی: ${localClock} (${relativeTime})` : `Reset: ${localClock} (${relativeTime})`;

  // Progress info for checkpoints
  const snapshotProgress = state.snapshotProgress ?? (isHalted ? 100 : 0);
  const isSnapshotComplete = snapshotProgress >= 100;

  return `
<div id="qg-hud-root">
  <!-- 42px Compact Status Pill -->
  <div id="qg-status-pill">
    <span class="qg-quota-badge ${badgeClass}">${quotaText}</span>
    <span style="font-size: 12px; opacity: 0.85;">${relativeTime}</span>
    <span style="font-size: 11px; opacity: 0.6;">${state.modelName || 'Gemini'}</span>
  </div>

  <!-- Detailed Floating Warning Panel (When Warning or Halted) -->
  <div id="qg-floating-panel" style="${isHalted || isPreCheckpointed ? 'display: flex;' : 'display: none;'} margin-top: 10px;">
    <div class="qg-panel-header">
      <span class="qg-panel-title">🛡️ ${titleText}</span>
      <button class="qg-btn-secondary" style="padding: 2px 8px; border-radius: 4px; font-size: 11px;" id="qg-btn-minimize">▬</button>
    </div>

    <div class="qg-panel-body">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600;">${statusLabel}</span>
        <span class="qg-quota-badge ${badgeClass}">${guardState}</span>
      </div>

      <div style="font-size: 12px; opacity: 0.75;">${resetLabel}</div>

      <!-- Snapshot Progress Bar -->
      <div class="qg-progress-container">
        <div class="qg-progress-bar" style="width: ${snapshotProgress}%;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; opacity: 0.65;">
        <span>${isRtl ? 'تهیه سند بازیابی:' : 'Snapshot Recovery:'}</span>
        <span>${snapshotProgress}%</span>
      </div>

      <!-- Actions -->
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button class="qg-action-button qg-btn-secondary" id="qg-btn-copy" ${!isSnapshotComplete ? 'disabled' : ''}>
          📋 ${isRtl ? 'کپی سند بازیابی' : 'Copy Recovery Doc'}
        </button>

        <button class="qg-action-button qg-btn-primary" id="qg-btn-settings" ${!isSnapshotComplete && !state.snapshotFailed ? 'disabled' : ''}>
          ⚙️ ${isRtl ? 'تنظیمات حساب' : 'Account Settings'}
        </button>
      </div>

      ${effectiveQuota === null ? `
      <!-- Ephemeral Session Unmonitored Bypass -->
      <button class="qg-action-button qg-btn-secondary" id="qg-btn-bypass" style="margin-top: 4px; border: 1px dashed rgba(255,255,255,0.2);">
        ⚠️ ${isRtl ? 'ادامه موقت بدون سهمیه (جلسه جاری)' : 'Temporary Unmonitored Session Bypass'}
      </button>` : ''}
    </div>
  </div>
</div>
`;
}

/**
 * Plays a gentle, non-blocking chime using the Web Audio API.
 * Synthesizes a harmonic dual-tone chime (D5: 587.33Hz, A5: 880.00Hz)
 * without requiring external audio files or OS-specific player binaries.
 */
function playWebAudioChime() {
  try {
    const AudioContextClass = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    if (!AudioContextClass) return false;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Tone 1: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Tone 2: 880.00 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.12);
    gain2.gain.setValueAtTime(0.12, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.65);

    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  generateHudCss,
  renderHudSnapshot,
  playWebAudioChime
};
