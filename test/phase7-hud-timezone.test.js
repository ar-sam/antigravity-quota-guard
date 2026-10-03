/**
 * Phase 7 Test Suite: Desktop HUD Presentation Adapter, Timezone Engine & Invariants
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  TimezoneManager,
  toPersianDigits,
  resolveEffectiveTimeZone,
  formatRelativeResetTime,
  formatLocalClockTime
} = require('../ui/desktop-hud/timezone-manager');

const {
  HudMainBridge,
  FORBIDDEN_WINDOW_PATTERNS
} = require('../ui/desktop-hud/hud-main-bridge');

const {
  generateHudCss,
  renderHudSnapshot
} = require('../ui/desktop-hud/hud-renderer');

test('Phase 7: Desktop HUD Presentation Adapter & Timezone Engine', async (t) => {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-phase7-test-'));

  t.after(() => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('7.1 Timezone Invariant & Dynamic User-Local Presentation', () => {
    // 1. Persian digit conversion
    assert.equal(toPersianDigits('2h 14m 2026'), '۲h ۱۴m ۲۰۲۶');
    assert.equal(toPersianDigits(100), '۱۰۰');
    assert.equal(toPersianDigits(0), '۰');

    // 2. Fixed vs System mode resolution
    const systemTz = resolveEffectiveTimeZone({ display: { timeZoneMode: 'system' } });
    assert.ok(typeof systemTz === 'string' && systemTz.length > 0);

    const fixedTz = resolveEffectiveTimeZone({
      display: { timeZoneMode: 'fixed', fixedTimeZone: 'America/New_York' }
    });
    assert.equal(fixedTz, 'America/New_York');

    // Fallback on invalid fixed timezone
    const invalidFixed = resolveEffectiveTimeZone({
      display: { timeZoneMode: 'fixed', fixedTimeZone: 'Invalid/Non_Existent' }
    });
    assert.equal(invalidFixed, systemTz);

    // 3. Separation of Language/Locale from Timezone Invariant:
    // Persian language (fa) MUST NOT force Asia/Tehran. A user in New York gets Persian UI in America/New_York.
    const testEpoch = new Date('2026-10-02T16:00:00.000Z').getTime(); // 12:00 PM EDT
    const clockFaNy = formatLocalClockTime(testEpoch, 'America/New_York', 'fa');
    assert.ok(clockFaNy.includes('America/New_York'));
    assert.ok(clockFaNy.includes('۱۲:۰۰'));

    // 4. Compact relative reset time formatting
    const now = Date.now();
    const futureEpoch = now + (2 * 3600 * 1000) + (14 * 60 * 1000); // 2h 14m
    const relEn = formatRelativeResetTime(futureEpoch, 'en', now);
    assert.equal(relEn, '2h 14m');

    const relFa = formatRelativeResetTime(futureEpoch, 'fa', now);
    assert.equal(relFa, '۲ساعت و ۱۴دقیقه');

    // Past time yields "now" / "اکنون"
    assert.equal(formatRelativeResetTime(now - 1000, 'en', now), 'now');
    assert.equal(formatRelativeResetTime(now - 1000, 'fa', now), 'اکنون');

    // 5. Timezone change event emission
    const tzManager = new TimezoneManager({ display: { timeZoneMode: 'fixed', fixedTimeZone: 'UTC' } });
    assert.equal(tzManager.getTimeZone(), 'UTC');

    let eventFired = false;
    tzManager.on('DISPLAY_TIMEZONE_CHANGED', (evt) => {
      eventFired = true;
      assert.equal(evt.previous, 'UTC');
      assert.equal(evt.current, 'Asia/Tehran');
    });

    tzManager.updateConfig({ display: { timeZoneMode: 'fixed', fixedTimeZone: 'Asia/Tehran' } });
    assert.equal(eventFired, true);
    assert.equal(tzManager.getTimeZone(), 'Asia/Tehran');
  });

  await t.test('7.2 HUD Main Process Bridge: Window Allowlist & IPC Isolation', async () => {
    // Pass statePath explicitly so the bridge reads from the test sandbox (not the real ~/.gemini path)
    const stateFile = path.join(sandboxDir, 'runtime-state.json');
    const bridge = new HudMainBridge({ runDir: sandboxDir, statePath: stateFile });

    // 1. Forbidden window evaluation (Auth, OAuth, DevTools)
    const oauthWindow = { url: 'https://accounts.google.com/o/oauth2/auth', title: 'Sign In with Google' };
    const devtoolsWindow = { url: 'chrome-devtools://devtools/bundled/devtools_app.html', title: 'Developer Tools' };
    const normalWindow = { url: 'file:///app/main.html', title: 'Antigravity Workspace' };

    assert.equal(bridge.isWindowAllowed(oauthWindow), false, 'Must reject OAuth window');
    assert.equal(bridge.isWindowAllowed(devtoolsWindow), false, 'Must reject DevTools window');
    assert.equal(bridge.isWindowAllowed(normalWindow), true, 'Must allow standard editor window');

    // 2. Unauthorized IPC rejection
    await assert.rejects(async () => {
      await bridge.handleIpcMessage('GET_RUNTIME_STATE', null, 999);
    }, (err) => err.code === 'UNAUTHORIZED_WINDOW_IPC');

    // 3. Authorized IPC handling
    bridge.registerAllowedWindow(101);

    // Mock runtime-state.json with private fields to verify sanitization
    fs.writeFileSync(stateFile, JSON.stringify({
      revision: 4,
      guardState: 'SAFE',
      effectiveQuota: 85,
      rawEmail: 'secret@example.com',
      apiKey: 'secret_api_key_12345',
      transcript: 'confidential conversation'
    }));

    const sanitizedState = await bridge.handleIpcMessage('GET_RUNTIME_STATE', null, 101);
    assert.equal(sanitizedState.revision, 4);
    assert.equal(sanitizedState.effectiveQuota, 85);
    assert.equal(sanitizedState.rawEmail, undefined, 'Must strip rawEmail');
    assert.equal(sanitizedState.apiKey, undefined, 'Must strip apiKey');
    assert.equal(sanitizedState.transcript, undefined, 'Must strip transcript');
  });

  await t.test('7.3 HUD Renderer: Floating Panel, 42px Status Pill & Persian Typography', () => {
    // 1. CSS Generation
    const cssRtl = generateHudCss({ isRtl: true });
    assert.ok(cssRtl.includes('direction: rtl;'));
    assert.ok(cssRtl.includes("'IRANYekanX'"));
    assert.ok(cssRtl.includes('height: 42px;'));

    const cssLtr = generateHudCss({ isRtl: false });
    assert.ok(cssLtr.includes('direction: ltr;'));

    // 2. Safe State Pill Rendering
    const safeHtml = renderHudSnapshot({
      effectiveQuota: 95,
      guardState: 'SAFE',
      modelName: 'Gemini 2.5 Pro',
      resetEpoch: Date.now() + 3600000
    }, {}, { locale: 'fa', timeZone: 'Asia/Tehran' });

    assert.ok(safeHtml.includes('۹۵%'), 'Must format with Persian numerals in fa locale');
    assert.ok(safeHtml.includes('Gemini 2.5 Pro'));
    assert.ok(safeHtml.includes('qg-status-pill'));
    assert.ok(safeHtml.includes('display: none;'), 'Panel must be hidden when SAFE');

    // 3. Halted State Floating Panel Rendering
    const haltedHtml = renderHudSnapshot({
      effectiveQuota: 11,
      guardState: 'HALTED',
      snapshotProgress: 100,
      modelName: 'Claude 3.7 Sonnet',
      resetEpoch: Date.now() + 7200000
    }, {}, { locale: 'fa', timeZone: 'Asia/Tehran' });

    assert.ok(haltedHtml.includes('display: flex;'), 'Panel must be displayed when HALTED');
    assert.ok(haltedHtml.includes('۱۱%'));
    assert.ok(haltedHtml.includes('HALTED'));
    assert.ok(haltedHtml.includes('کپی سند بازیابی'));
    assert.ok(haltedHtml.includes('تنظیمات حساب'));

    // 4. Missing Quota Unmonitored Bypass Button
    const unknownHtml = renderHudSnapshot({
      effectiveQuota: null,
      guardState: 'SAFE',
      modelName: 'Gemini'
    }, {}, { locale: 'fa' });

    assert.ok(unknownHtml.includes('--%'));
    assert.ok(unknownHtml.includes('ادامه موقت بدون سهمیه'));
  });
});
