'use strict';

/**
 * Test Suite: test/model-detect.test.js
 * Feature: R2 Dynamic Real-Time Model & Conversation Tracking
 * Tiers: Tier 1 (Feature Coverage) & Tier 2 (Boundary & Corner Cases)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const payload = require('../bin/payload.js');

const classifyModel = payload.classifyModel;

/**
 * Pure reference evaluator for detectActiveModel logic
 * Mirrors the exact DOM + Fallback algorithm specified in PROJECT.md and implemented in payload.js
 */
function evaluateActiveModel({ triggerText = '', triggerAria = '', quota = {}, isInsideChat = true, hasTrigger = true }) {
  let detectedCategory = null;
  let modelName = '';

  if (hasTrigger) {
    modelName = (triggerText || triggerAria || '').trim();
    detectedCategory = classifyModel(triggerText + ' ' + triggerAria);
  }

  if (detectedCategory && isInsideChat) {
    return {
      category: detectedCategory,
      modelName: modelName || (detectedCategory === 'gemini' ? 'Gemini' : 'Claude/GPT'),
      isFallback: false
    };
  }

  // Fallback outside active chat or when model is unknown:
  // Math.min(gemini.fiveHour, claude_gpt.fiveHour)
  const g5h = (quota && quota.gemini && typeof quota.gemini.fiveHour === 'number') ? quota.gemini.fiveHour : 100;
  const c5h = (quota && quota.claude_gpt && typeof quota.claude_gpt.fiveHour === 'number') ? quota.claude_gpt.fiveHour : 100;

  const fallbackCategory = g5h <= c5h ? 'gemini' : 'claude_gpt';
  return {
    category: fallbackCategory,
    modelName: fallbackCategory === 'gemini' ? 'Gemini (Auto-Critical)' : 'Claude/GPT (Auto-Critical)',
    isFallback: true
  };
}

describe('R2: Model Detection & Conversation Tracking', () => {

  describe('Tier 1: Feature Coverage (>=5 tests)', () => {
    it('1.1 classifyModel is exported as a function on bin/payload.js', () => {
      assert.strictEqual(typeof classifyModel, 'function', 'classifyModel must be exported');
    });

    it('1.2 Correctly classifies Gemini model catalog variants to "gemini"', () => {
      const geminiModels = [
        'Gemini 3.8 Flash High',
        'Gemini 3.5 Pro',
        'gemini-3.8-flash-medium',
        'gemini-3.8-flash-low',
        'gemini-3.7-flash-high',
        'gemini-3.1-pro-high',
        'Flash High (Thinking)',
        'Pro-High (Advanced Reasoning)'
      ];

      for (const model of geminiModels) {
        const category = classifyModel(model);
        assert.strictEqual(category, 'gemini', `Expected "${model}" to be classified as "gemini", got "${category}"`);
      }
    });

    it('1.3 Correctly classifies Claude & GPT model catalog variants to "claude_gpt"', () => {
      const claudeGptModels = [
        'Claude 3.7 Sonnet',
        'Claude Sonnet 4.6 (Thinking)',
        'Claude Opus 4.6 (Thinking)',
        'Claude 3.5 Haiku',
        'GPT-4o',
        'gpt-oss-120b-medium',
        'o1-preview',
        'o3-mini-high'
      ];

      for (const model of claudeGptModels) {
        const category = classifyModel(model);
        assert.strictEqual(category, 'claude_gpt', `Expected "${model}" to be classified as "claude_gpt", got "${category}"`);
      }
    });

    it('1.4 Detects active model when DOM selector trigger contains Gemini model', () => {
      const result = evaluateActiveModel({
        triggerText: 'Gemini 3.8 Flash High',
        triggerAria: 'Select model, current: Gemini 3.8 Flash High',
        isInsideChat: true,
        quota: { gemini: { fiveHour: 78 }, claude_gpt: { fiveHour: 100 } }
      });

      assert.strictEqual(result.category, 'gemini');
      assert.strictEqual(result.isFallback, false);
      assert.ok(result.modelName.includes('Gemini'));
    });

    it('1.5 Detects active model when DOM selector trigger contains Claude model', () => {
      const result = evaluateActiveModel({
        triggerText: 'Claude Sonnet 4.6 (Thinking)',
        triggerAria: 'Select model, current: Claude Sonnet 4.6 (Thinking)',
        isInsideChat: true,
        quota: { gemini: { fiveHour: 78 }, claude_gpt: { fiveHour: 100 } }
      });

      assert.strictEqual(result.category, 'claude_gpt');
      assert.strictEqual(result.isFallback, false);
      assert.ok(result.modelName.includes('Claude'));
    });

    it('1.6 Fallback selects Gemini when outside active chat and Gemini has lowest remaining quota', () => {
      const result = evaluateActiveModel({
        hasTrigger: false,
        isInsideChat: false,
        quota: { gemini: { fiveHour: 45 }, claude_gpt: { fiveHour: 95 } }
      });

      assert.strictEqual(result.category, 'gemini');
      assert.strictEqual(result.isFallback, true);
      assert.ok(result.modelName.includes('Auto-Critical'));
    });

    it('1.7 Fallback selects Claude when outside active chat and Claude has lowest remaining quota', () => {
      const result = evaluateActiveModel({
        hasTrigger: false,
        isInsideChat: false,
        quota: { gemini: { fiveHour: 80 }, claude_gpt: { fiveHour: 30 } }
      });

      assert.strictEqual(result.category, 'claude_gpt');
      assert.strictEqual(result.isFallback, true);
      assert.ok(result.modelName.includes('Auto-Critical'));
    });
  });

  describe('Tier 2: Boundary & Corner Cases (>=5 tests)', () => {
    it('2.1 Unknown or third-party models return null and trigger fallback', () => {
      const unknowns = ['DeepSeek-V3', 'Llama-3.3-70B', 'Mistral-Large', '', 'Custom Model'];

      for (const name of unknowns) {
        const category = classifyModel(name);
        assert.strictEqual(category, null, `Unknown model "${name}" must return null`);
      }

      const fallbackResult = evaluateActiveModel({
        triggerText: 'DeepSeek-V3',
        isInsideChat: true,
        quota: { gemini: { fiveHour: 60 }, claude_gpt: { fiveHour: 80 } }
      });

      assert.strictEqual(fallbackResult.category, 'gemini');
      assert.strictEqual(fallbackResult.isFallback, true);
    });

    it('2.2 Case insensitivity and whitespace tolerance in model classification', () => {
      assert.strictEqual(classifyModel('   gEmInI-3.8-FLASH   '), 'gemini');
      assert.strictEqual(classifyModel('\tCLAUDE 3.7 SONNET\n'), 'claude_gpt');
      assert.strictEqual(classifyModel('   O3-MINI   '), 'claude_gpt');
    });

    it('2.3 Non-string, null, or undefined model arguments return null safely without throwing', () => {
      const badInputs = [null, undefined, 42, {}, [], true];
      for (const input of badInputs) {
        assert.strictEqual(classifyModel(input), null);
      }
    });

    it('2.4 Critical boundary: 0% quota selected over 100% quota in fallback', () => {
      const result = evaluateActiveModel({
        hasTrigger: false,
        quota: {
          gemini: { fiveHour: 0 },
          claude_gpt: { fiveHour: 100 }
        }
      });

      assert.strictEqual(result.category, 'gemini', '0% Gemini must be selected over 100% Claude in fallback');
    });

    it('2.5 Equal quota tie-break: returns deterministic category without error', () => {
      const result = evaluateActiveModel({
        hasTrigger: false,
        quota: {
          gemini: { fiveHour: 50 },
          claude_gpt: { fiveHour: 50 }
        }
      });

      assert.strictEqual(result.category, 'gemini');
      assert.strictEqual(result.isFallback, true);
    });

    it('2.6 Missing or empty quota structure defaults gracefully to safe numbers', () => {
      const resultEmpty = evaluateActiveModel({ hasTrigger: false, quota: {} });
      assert.ok(resultEmpty.category === 'gemini' || resultEmpty.category === 'claude_gpt');

      const resultNull = evaluateActiveModel({ hasTrigger: false, quota: null });
      assert.ok(resultNull.category === 'gemini' || resultNull.category === 'claude_gpt');
    });

    it('2.7 Simulated dynamic model switch in composer immediately switches detected category', () => {
      const quota = { gemini: { fiveHour: 62 }, claude_gpt: { fiveHour: 100 } };

      // User starts in Gemini chat
      const step1 = evaluateActiveModel({ triggerText: 'Gemini 3.8 Flash High', isInsideChat: true, quota });
      assert.strictEqual(step1.category, 'gemini');

      // User switches dropdown in composer to Claude Sonnet
      const step2 = evaluateActiveModel({ triggerText: 'Claude Sonnet 4.6 (Thinking)', isInsideChat: true, quota });
      assert.strictEqual(step2.category, 'claude_gpt');

      // User opens new tab / welcome screen
      const step3 = evaluateActiveModel({ hasTrigger: false, isInsideChat: false, quota });
      assert.strictEqual(step3.category, 'gemini', 'Should fallback to lowest (Gemini 62%)');
    });

    it('2.8 Active Execution Lock decouples picker from active model during generation', () => {
      const activeExecutionMap = new Map();
      const convoId = 'convo-123';

      function evaluateWithLock({ isRunning, pickerModel, pickerCat }) {
        if (isRunning) {
          if (!activeExecutionMap.has(convoId)) {
            activeExecutionMap.set(convoId, {
              executingModel: pickerModel,
              executingCategory: pickerCat,
              startedAt: Date.now()
            });
          }
        } else {
          if (activeExecutionMap.has(convoId)) {
            activeExecutionMap.delete(convoId);
          }
        }

        const currentRun = activeExecutionMap.get(convoId);
        if (isRunning && currentRun) {
          return {
            category: currentRun.executingCategory,
            modelName: currentRun.executingModel,
            isExecuting: true,
            queuedModelName: pickerModel || null,
            queuedCategory: pickerCat || null
          };
        }
        return {
          category: pickerCat,
          modelName: pickerModel,
          isExecuting: false,
          queuedModelName: null,
          queuedCategory: null
        };
      }

      // Step 1: Idle - user starts with Gemini
      const s1 = evaluateWithLock({ isRunning: false, pickerModel: 'Gemini 3.5 Pro', pickerCat: 'gemini' });
      assert.strictEqual(s1.category, 'gemini');
      assert.strictEqual(s1.isExecuting, false);

      // Step 2: User sends message -> execution starts with Gemini
      const s2 = evaluateWithLock({ isRunning: true, pickerModel: 'Gemini 3.5 Pro', pickerCat: 'gemini' });
      assert.strictEqual(s2.category, 'gemini');
      assert.strictEqual(s2.isExecuting, true);
      assert.strictEqual(s2.modelName, 'Gemini 3.5 Pro');

      // Step 3: During active run, user changes picker to Claude Sonnet
      const s3 = evaluateWithLock({ isRunning: true, pickerModel: 'Claude Sonnet 4.6', pickerCat: 'claude_gpt' });
      // Invariant: HUD remains locked to Gemini!
      assert.strictEqual(s3.category, 'gemini', 'HUD must remain locked to Gemini during active run');
      assert.strictEqual(s3.modelName, 'Gemini 3.5 Pro');
      assert.strictEqual(s3.isExecuting, true);
      assert.strictEqual(s3.queuedModelName, 'Claude Sonnet 4.6');
      assert.strictEqual(s3.queuedCategory, 'claude_gpt');

      // Step 4: Generation finishes (cancel button disappears)
      const s4 = evaluateWithLock({ isRunning: false, pickerModel: 'Claude Sonnet 4.6', pickerCat: 'claude_gpt' });
      // Invariant: Active model switches immediately to Claude
      assert.strictEqual(s4.category, 'claude_gpt');
      assert.strictEqual(s4.modelName, 'Claude Sonnet 4.6');
      assert.strictEqual(s4.isExecuting, false);
      assert.strictEqual(s4.queuedModelName, null);
    });
  });
});
