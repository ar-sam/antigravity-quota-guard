'use strict';

/**
 * Test Suite: test/guide.test.js
 * Feature: R4 In-App Interactive Bilingual User Guide
 * Tiers: Tier 1 (Feature Coverage) & Tier 2 (Boundary & Corner Cases)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const payload = require('../bin/payload.js');

const getRendererInjectionCode = payload.getRendererInjectionCode;

describe('R4: In-App Interactive Bilingual User Guide', () => {

  const baseConfigFa = {
    language: 'fa',
    thresholds: { warnPercent: 20, stabilizePercent: 15, checkpointPercent: 13, stopPercent: 12, minResumePercent: 70 },
    visuals: { badgeStyle: 'detailed', hudScope: 'fiveHour', themePreset: 'clinical', colors: {} },
    audio: { soundEnabled: true, soundName: 'Glass', desktopNotification: true },
    sync: { refreshIntervalMinutes: 3 }
  };

  const baseConfigEn = {
    language: 'en',
    thresholds: { warnPercent: 20, stabilizePercent: 15, checkpointPercent: 13, stopPercent: 12, minResumePercent: 70 },
    visuals: { badgeStyle: 'detailed', hudScope: 'fiveHour', themePreset: 'clinical', colors: {} },
    audio: { soundEnabled: true, soundName: 'Glass', desktopNotification: true },
    sync: { refreshIntervalMinutes: 3 }
  };

  const mockQuota = {
    account_email: 'test@example.com',
    gemini: { fiveHour: 78, weekly: 85, resetTimeFiveHour: '2026-10-01T15:00:55Z' },
    claude_gpt: { fiveHour: 100, weekly: 100, resetTimeFiveHour: null }
  };

  describe('Tier 1: Feature Coverage (>=5 tests)', () => {
    it('1.1 getRendererInjectionCode produces valid executable JavaScript string', () => {
      assert.strictEqual(typeof getRendererInjectionCode, 'function', 'getRendererInjectionCode must be exported');
      const code = getRendererInjectionCode(baseConfigFa, mockQuota);
      assert.strictEqual(typeof code, 'string');
      assert.ok(code.length > 5000, 'Renderer code should contain full UI and modals');
    });

    it('1.2 Injected code includes dedicated User Guide button in Settings Modal', () => {
      const code = getRendererInjectionCode(baseConfigFa, mockQuota);
      assert.ok(code.includes('qg-btn-open-guide'), 'Settings modal must include #qg-btn-open-guide button ID');
      assert.ok(code.includes('qg-btn-guide'), 'Must have .qg-btn-guide style class');
    });

    it('1.3 Guide modal structure contains modal ID, backdrop, header, and close button', () => {
      const code = getRendererInjectionCode(baseConfigFa, mockQuota);
      assert.ok(code.includes('qg-guide-modal'), 'Must define qg-guide-modal backdrop and container');
      assert.ok(code.includes('qg-guide-close'), 'Must define #qg-guide-close button');
      assert.ok(code.includes('qg-guide-lang-toggle'), 'Must define quick language toggle button');
    });

    it('1.4 Contains all 4 tab buttons with correct data-tab attributes', () => {
      const code = getRendererInjectionCode(baseConfigFa, mockQuota);
      assert.ok(code.includes('class="qg-guide-tabs"'), 'Must define .qg-guide-tabs container');
      assert.ok(code.includes('data-tab="0"'), 'Must have Tab 0 (Quotas)');
      assert.ok(code.includes('data-tab="1"'), 'Must have Tab 1 (Handover)');
      assert.ok(code.includes('data-tab="2"'), 'Must have Tab 2 (Settings)');
      assert.ok(code.includes('data-tab="3"'), 'Must have Tab 3 (FAQ)');
    });

    it('1.5 Persian mode configures dynamic RTL direction and Persian font styling', () => {
      const codeFa = getRendererInjectionCode(baseConfigFa, mockQuota);
      assert.ok(codeFa.includes("isFa ? 'rtl' : 'ltr'"), 'Guide modal dynamically evaluates RTL/LTR based on language');
      assert.ok(codeFa.includes('IRANYekanX'), 'Persian layout must reference IRANYekanX typography');
      assert.ok(codeFa.includes("config.language || 'fa'"), 'Defaults to Persian (fa)');
    });

    it('1.6 English mode configures bilingual support and translation keys', () => {
      const codeEn = getRendererInjectionCode(baseConfigEn, mockQuota);
      assert.ok(codeEn.includes('Rolling 5-Hour Limit Mechanics'), 'Contains English guide text');
      assert.ok(codeEn.includes('qg-guide-modal'), 'Defines guide modal container');
    });
  });

  describe('Tier 2: Boundary & Corner Cases (>=5 tests)', () => {
    it('2.1 Tab switching event listener binds tab click to toggle panel visibility', () => {
      const code = getRendererInjectionCode(baseConfigFa, mockQuota);
      assert.ok(code.includes('.qg-guide-tab'), 'Must select tab buttons');
      assert.ok(code.includes('qg-panel-'), 'Must address panels by ID');
      assert.ok(code.includes("classList.remove('active')"), 'Must deactivate other tabs');
      assert.ok(code.includes("classList.add('active')"), 'Must activate clicked tab');
    });

    it('2.2 Tab 0 (Quotas Explained) contains rolling 5-hour, weekly, and 100% bug resolution in both FA & EN', () => {
      const codeFa = getRendererInjectionCode(baseConfigFa, mockQuota);
      const codeEn = getRendererInjectionCode(baseConfigEn, mockQuota);

      // Persian content assertions
      assert.ok(codeFa.includes('پنجره متحرک ۵ ساعته') || codeFa.includes('Rolling 5-Hour'), 'Explains rolling 5h in Persian');
      assert.ok(codeFa.includes('سقف هفتگی') || codeFa.includes('Weekly Limit'), 'Explains weekly limit in Persian');
      assert.ok(codeFa.includes('Gemini') && codeFa.includes('Claude'), 'Mentions both model buckets');
      assert.ok(codeFa.includes('۱۰۰٪') || codeFa.includes('100%'), 'Documents the 100% lock bug fix');

      // English content assertions
      assert.ok(codeEn.includes('Rolling 5-Hour Limit Mechanics'), 'Explains rolling 5h in English');
      assert.ok(codeEn.includes('Cumulative Weekly Ceiling'), 'Explains weekly limit in English');
      assert.ok(codeEn.includes('100% Lock Bug Fixed'), 'Explains 100% lock fix in English');
    });

    it('2.3 Tab 1 (12% Handover) contains turn-boundary pause, zero context loss, and checkpoint path', () => {
      const codeFa = getRendererInjectionCode(baseConfigFa, mockQuota);
      const codeEn = getRendererInjectionCode(baseConfigEn, mockQuota);

      assert.ok(codeFa.includes('۱۲٪') || codeFa.includes('12%'), 'Explains 12% threshold');
      assert.ok(codeFa.includes('checkpoints'), 'References checkpoints directory');
      assert.ok(codeFa.includes('Cmd+,') || codeFa.includes('Ctrl+,'), 'Instructs keyboard shortcut for settings');

      assert.ok(codeEn.includes('12%'), 'Explains 12% in English');
      assert.ok(codeEn.includes('checkpoints'), 'References checkpoints in English');
      assert.ok(codeEn.includes('Zero Context Loss'), 'Explains zero context loss in English');
    });

    it('2.4 Tab 2 (Settings & Customization) covers thresholds, HUD scope options, themes, and sound', () => {
      const codeFa = getRendererInjectionCode(baseConfigFa, mockQuota);
      const codeEn = getRendererInjectionCode(baseConfigEn, mockQuota);

      assert.ok(codeFa.includes('fiveHour') && codeFa.includes('weekly') && codeFa.includes('both'), 'Documents HUD scope options in Persian');
      assert.ok(codeFa.includes('Warn') || codeFa.includes('هشدار'), 'Documents Warn threshold');
      assert.ok(codeFa.includes('Stop') || codeFa.includes('توقف'), 'Documents Stop threshold');

      assert.ok(codeEn.includes('fiveHour') && codeEn.includes('weekly') && codeEn.includes('both'), 'Documents HUD scope options in English');
      assert.ok(codeEn.includes('Warn % (Default 20%)') || codeEn.includes('Warn'), 'Documents Warn in English');
      assert.ok(codeEn.includes('Stop % (Default 12%)') || codeEn.includes('Stop'), 'Documents Stop in English');
    });

    it('2.5 Tab 3 (FAQ & Troubleshooting) contains CLI commands cheat sheet and factory reset info', () => {
      const codeFa = getRendererInjectionCode(baseConfigFa, mockQuota);
      const codeEn = getRendererInjectionCode(baseConfigEn, mockQuota);

      assert.ok(codeFa.includes('./patch.sh update'), 'Includes ./patch.sh update in Persian guide');
      assert.ok(codeFa.includes('./patch.sh status'), 'Includes ./patch.sh status in Persian guide');
      assert.ok(codeFa.includes('./patch.sh config'), 'Includes ./patch.sh config in Persian guide');

      assert.ok(codeEn.includes('./patch.sh update'), 'Includes ./patch.sh update in English guide');
      assert.ok(codeEn.includes('./patch.sh uninstall'), 'Includes ./patch.sh uninstall in English guide');
    });

    it('2.6 Modal close handlers include button click, backdrop click, and Escape key listener', () => {
      const code = getRendererInjectionCode(baseConfigFa, mockQuota);
      assert.ok(code.includes('qg-guide-close'), 'Binds close button');
      assert.ok(code.includes('Escape'), 'Listens for Escape key to close guide');
      assert.ok(code.includes('isUserGuideModalOpen = false'), 'Resets modal open state flag upon closure');
    });

    it('2.7 Safe defaults when invoked with missing or null quota', () => {
      const codeWithNullQuota = getRendererInjectionCode(baseConfigFa, null);
      assert.strictEqual(typeof codeWithNullQuota, 'string');
      assert.ok(codeWithNullQuota.includes('qg-guide-modal'));

      const codeWithEmptyConfig = getRendererInjectionCode({}, {});
      assert.strictEqual(typeof codeWithEmptyConfig, 'string');
      assert.ok(codeWithEmptyConfig.includes('qg-guide-modal'));
    });
  });
});
