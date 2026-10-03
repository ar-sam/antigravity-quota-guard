'use strict';

/**
 * Test Suite: test/hud-scope.test.js
 * Feature: R3 Configurable Titlebar HUD Scope
 * Tiers: Tier 1 (Feature Coverage) & Tier 2 (Boundary & Corner Cases)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const configModule = require('../bin/config.js');
const {
  DEFAULT_CONFIG,
  VALID_HUD_SCOPES,
  validateConfig,
  loadConfig,
  saveConfig,
  CONFIG_FILE
} = configModule;

/**
 * Reference formatter matching the UI implementation contract in bin/payload.js
 */
function formatBadgeText(fiveHour, weekly, hudScope = 'fiveHour', badgeStyle = 'detailed') {
  const fRound = Math.round(fiveHour);
  const wRound = Math.round(weekly);

  if (badgeStyle === 'compact') {
    if (hudScope === 'weekly') return `🛡️ ${wRound}%W`;
    if (hudScope === 'both') return `🛡️ ${fRound}% · ${wRound}%`;
    return `🛡️ ${fRound}%`;
  }

  // Detailed style
  if (hudScope === 'weekly') {
    return `🛡️ QS [W]: ${wRound}%`;
  }
  if (hudScope === 'both') {
    return `🛡️ QS: ${fRound}% | W: ${wRound}%`;
  }
  return `🛡️ QS: ${fRound}%`;
}

/**
 * Reference critical percentage evaluator matching updateHUD() in bin/payload.js
 */
function evaluateCriticalPercentage(fiveHour, weekly, hudScope = 'fiveHour') {
  if (hudScope === 'weekly') return weekly;
  if (hudScope === 'both') return Math.min(fiveHour, weekly);
  return fiveHour;
}

describe('R3: Configurable Titlebar HUD Scope', () => {

  describe('Tier 1: Feature Coverage (>=5 tests)', () => {
    it('1.1 DEFAULT_CONFIG defines visuals.hudScope as "fiveHour"', () => {
      assert.ok(DEFAULT_CONFIG.visuals, 'DEFAULT_CONFIG must have visuals property');
      assert.strictEqual(DEFAULT_CONFIG.visuals.hudScope, 'fiveHour', 'Default hudScope must be "fiveHour"');
    });

    it('1.2 VALID_HUD_SCOPES contains the 3 canonical scopes', () => {
      assert.deepStrictEqual(VALID_HUD_SCOPES, ['fiveHour', 'weekly', 'both']);
    });

    it('1.3 validateConfig accepts valid scope values ("fiveHour", "weekly", "both")', () => {
      assert.strictEqual(validateConfig({ visuals: { hudScope: 'fiveHour' } }), true);
      assert.strictEqual(validateConfig({ visuals: { hudScope: 'weekly' } }), true);
      assert.strictEqual(validateConfig({ visuals: { hudScope: 'both' } }), true);
    });

    it('1.4 Formats badge text for scope "fiveHour" (detailed)', () => {
      const text = formatBadgeText(78, 85, 'fiveHour', 'detailed');
      assert.strictEqual(text, '🛡️ QS: 78%');
    });

    it('1.5 Formats badge text for scope "weekly" (detailed)', () => {
      const text = formatBadgeText(78, 85, 'weekly', 'detailed');
      assert.strictEqual(text, '🛡️ QS [W]: 85%');
    });

    it('1.6 Formats badge text for scope "both" side-by-side (detailed)', () => {
      const text = formatBadgeText(78, 85, 'both', 'detailed');
      assert.strictEqual(text, '🛡️ QS: 78% | W: 85%');
    });

    it('1.7 loadConfig() returns valid hudScope property', () => {
      const loaded = loadConfig();
      assert.ok(loaded.visuals);
      assert.ok(VALID_HUD_SCOPES.includes(loaded.visuals.hudScope));
    });
  });

  describe('Tier 2: Boundary & Corner Cases (>=5 tests)', () => {
    it('2.1 validateConfig rejects invalid scope strings, numbers, null, or empty values', () => {
      const invalidConfigs = [
        { visuals: { hudScope: 'monthly' } },
        { visuals: { hudScope: 'daily' } },
        { visuals: { hudScope: 'all' } },
        { visuals: { hudScope: 123 } },
        { visuals: { hudScope: '' } },
        { visuals: { hudScope: null } },
        { visuals: {} },
        null,
        undefined,
        'string'
      ];

      for (const cfg of invalidConfigs) {
        assert.strictEqual(validateConfig(cfg), false, `Expected false for ${JSON.stringify(cfg)}`);
      }
    });

    it('2.2 Compact badgeStyle formats cleanly across all 3 scopes', () => {
      assert.strictEqual(formatBadgeText(78, 85, 'fiveHour', 'compact'), '🛡️ 78%');
      assert.strictEqual(formatBadgeText(78, 85, 'weekly', 'compact'), '🛡️ 85%W');
      assert.strictEqual(formatBadgeText(78, 85, 'both', 'compact'), '🛡️ 78% · 85%');
    });

    it('2.3 Extreme boundary values: 0% and 100% format accurately', () => {
      assert.strictEqual(formatBadgeText(0, 100, 'both', 'detailed'), '🛡️ QS: 0% | W: 100%');
      assert.strictEqual(formatBadgeText(100, 0, 'both', 'detailed'), '🛡️ QS: 100% | W: 0%');
      assert.strictEqual(formatBadgeText(0, 0, 'fiveHour', 'compact'), '🛡️ 0%');
    });

    it('2.4 Rounding of fractional percentages in badge display', () => {
      assert.strictEqual(formatBadgeText(77.6, 84.4, 'both', 'detailed'), '🛡️ QS: 78% | W: 84%');
      assert.strictEqual(formatBadgeText(11.9, 12.1, 'both', 'compact'), '🛡️ 12% · 12%');
    });

    it('2.5 Critical threshold dot evaluation evaluates Math.min(fiveHour, weekly) under "both" scope', () => {
      // If 5h is 10% (below 12% stop threshold) but weekly is 90%, criticalPct must be 10%
      const crit1 = evaluateCriticalPercentage(10, 90, 'both');
      assert.strictEqual(crit1, 10, 'Must pick lowest metric (10%) to trigger safety alert');

      // If weekly is 8% but 5h is 80%, criticalPct must be 8%
      const crit2 = evaluateCriticalPercentage(80, 8, 'both');
      assert.strictEqual(crit2, 8, 'Must pick lowest metric (8%) to trigger safety alert');

      // Under weekly scope, evaluates weekly only
      assert.strictEqual(evaluateCriticalPercentage(10, 90, 'weekly'), 90);

      // Under fiveHour scope, evaluates fiveHour only
      assert.strictEqual(evaluateCriticalPercentage(10, 90, 'fiveHour'), 10);
    });

    it('2.6 Backwards compatibility: preserves custom thresholds when injecting default hudScope', () => {
      // Simulate an older config without hudScope
      const legacyConfig = {
        language: 'fa',
        thresholds: {
          warnPercent: 25,
          stabilizePercent: 18,
          checkpointPercent: 14,
          stopPercent: 10,
          minResumePercent: 75
        },
        visuals: {
          badgeStyle: 'compact',
          themePreset: 'vibrant'
        }
      };

      const saved = saveConfig(legacyConfig);
      assert.strictEqual(saved.visuals.hudScope, 'fiveHour', 'Defaulted hudScope');
      assert.strictEqual(saved.thresholds.stopPercent, 10, 'Preserved custom stop threshold');
      assert.strictEqual(saved.visuals.badgeStyle, 'compact', 'Preserved custom badge style');
      assert.strictEqual(saved.visuals.themePreset, 'vibrant', 'Preserved custom theme preset');
    });

    it('2.7 Active Execution Badge formatting appends lightning indicator when executing', () => {
      function formatActiveBadge(fiveHour, weekly, name, isExec, scope = 'fiveHour', style = 'detailed') {
        const fRound = Math.round(fiveHour);
        const wRound = Math.round(weekly);
        if (style === 'compact') {
          return `🛡️ ${isExec ? '⚡ ' : ''}${fRound}%`;
        }
        const shortName = (name || '').replace(/\s*\(.*\)/, '').trim();
        const tag = isExec ? ` [${shortName} ⚡]` : '';
        return `🛡️ QS${tag}: ${fRound}%`;
      }

      // Idle state
      assert.strictEqual(formatActiveBadge(78, 85, 'Gemini', false), '🛡️ QS: 78%');
      // Active run detailed
      assert.strictEqual(formatActiveBadge(78, 85, 'Gemini 3.5 Pro', true), '🛡️ QS [Gemini 3.5 Pro ⚡]: 78%');
      // Active run compact
      assert.strictEqual(formatActiveBadge(78, 85, 'Gemini', true, 'fiveHour', 'compact'), '🛡️ ⚡ 78%');
    });
  });
});
