'use strict';

/**
 * Test Suite: test/parser.test.js
 * Feature: R1 Independent Dual-Bucket Usage Parsing
 * Tiers: Tier 1 (Feature Coverage) & Tier 2 (Boundary & Corner Cases)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const payload = require('../bin/payload.js');

// Resolve parser function from bin/payload.js
const parseUsage = payload.parseUsageStdout || payload.parseQuotaUsage || payload.parseUsageOutput || payload.parseAgyUsage;

// Canonical sample output from agy -p "/usage" (Empirical fixture matching Acceptance Criteria)
const CANONICAL_AGY_FIXTURE = `
Quota:
Gemini Models          Weekly Limit Remaining     85%   2026-10-07T04:20:00Z
Gemini Models          Five Hour Limit Remaining  78%   2026-10-01T15:00:55Z
Claude and GPT models  Weekly Limit Remaining     100%  2026-10-06T17:19:09Z
Claude and GPT models  Five Hour Limit Remaining  100%  2026-10-01T16:55:43Z
`;

describe('R1: Dual-Bucket Usage Parser', () => {

  describe('Tier 1: Feature Coverage (>=5 tests)', () => {
    it('1.1 Parser function export is defined on bin/payload.js', () => {
      assert.strictEqual(typeof parseUsage, 'function', 'bin/payload.js must export parseUsageStdout or equivalent');
    });

    it('1.2 Solves 100% lock bug: Gemini 5-hour is 78% and Claude/GPT 5-hour is 100% without collision', () => {
      const parsed = parseUsage(CANONICAL_AGY_FIXTURE);

      assert.ok(parsed, 'Parser returned a result');
      assert.ok(parsed.gemini, 'Parsed object has gemini bucket');
      assert.ok(parsed.claude_gpt, 'Parsed object has claude_gpt bucket');

      // Key acceptance criterion
      assert.strictEqual(parsed.gemini.fiveHour, 78, 'Gemini fiveHour must be 78');
      assert.strictEqual(parsed.claude_gpt.fiveHour, 100, 'Claude/GPT fiveHour must be 100');
      assert.notStrictEqual(parsed.gemini.fiveHour, parsed.claude_gpt.fiveHour, 'Gemini fiveHour must not be overwritten by Claude/GPT');
    });

    it('1.3 Correctly extracts weekly limits for both buckets independently', () => {
      const parsed = parseUsage(CANONICAL_AGY_FIXTURE);

      assert.strictEqual(parsed.gemini.weekly, 85, 'Gemini weekly limit must be 85');
      assert.strictEqual(parsed.claude_gpt.weekly, 100, 'Claude/GPT weekly limit must be 100');
    });

    it('1.4 Correctly extracts ISO-8601 reset timestamps for five-hour and weekly limits', () => {
      const parsed = parseUsage(CANONICAL_AGY_FIXTURE);

      const gReset5h = parsed.gemini.resetTimeFiveHour || parsed.gemini.resetTime;
      const gResetWk = parsed.gemini.resetTimeWeekly || parsed.gemini.weeklyResetTime;
      const cReset5h = parsed.claude_gpt.resetTimeFiveHour || parsed.claude_gpt.resetTime;
      const cResetWk = parsed.claude_gpt.resetTimeWeekly || parsed.claude_gpt.weeklyResetTime;

      assert.strictEqual(gReset5h, '2026-10-01T15:00:55Z');
      assert.strictEqual(gResetWk, '2026-10-07T04:20:00Z');
      assert.strictEqual(cReset5h, '2026-10-01T16:55:43Z');
      assert.strictEqual(cResetWk, '2026-10-06T17:19:09Z');
    });

    it('1.5 Inverted bucket order: Claude first then Gemini correctly populates both buckets', () => {
      const invertedFixture = `
Quota:
Claude and GPT models  Five Hour Limit Remaining  92%   2026-10-01T18:00:00Z
Claude and GPT models  Weekly Limit Remaining     95%   2026-10-08T00:00:00Z
Gemini Models          Five Hour Limit Remaining  45%   2026-10-01T14:30:00Z
Gemini Models          Weekly Limit Remaining     60%   2026-10-07T12:00:00Z
`;
      const parsed = parseUsage(invertedFixture);

      assert.strictEqual(parsed.claude_gpt.fiveHour, 92, 'Claude fiveHour correctly parsed when first');
      assert.strictEqual(parsed.claude_gpt.weekly, 95, 'Claude weekly correctly parsed when first');
      assert.strictEqual(parsed.gemini.fiveHour, 45, 'Gemini fiveHour correctly parsed when second');
      assert.strictEqual(parsed.gemini.weekly, 60, 'Gemini weekly correctly parsed when second');
    });

    it('1.6 Header syntax variants: handles "Claude & GPT models" and case insensitivity', () => {
      const variantFixture = `
quota:
gemini models          five hour limit remaining  55%   2026-10-01T15:10:00Z
claude & gpt models    five hour limit remaining  88%   2026-10-01T16:20:00Z
`;
      const parsed = parseUsage(variantFixture);

      assert.strictEqual(parsed.gemini.fiveHour, 55);
      assert.strictEqual(parsed.claude_gpt.fiveHour, 88);
    });
  });

  describe('Tier 2: Boundary & Corner Cases (>=5 tests)', () => {
    it('2.1 Empty, whitespace, null, and non-string inputs return safe bucket structure without throwing', () => {
      const inputs = ['', '   \n\n\t  ', null, undefined, 123, {}, []];

      for (const input of inputs) {
        const parsed = parseUsage(input);
        assert.ok(parsed, `Parser must return an object for input: ${JSON.stringify(input)}`);
        assert.ok(parsed.gemini, 'Returned object must have gemini property');
        assert.ok(parsed.claude_gpt, 'Returned object must have claude_gpt property');
        assert.strictEqual(parsed.gemini.fiveHour, null, 'Unmatched fiveHour must be null');
        assert.strictEqual(parsed.gemini.weekly, null, 'Unmatched weekly must be null');
      }
    });

    it('2.2 Zero percentage values (0%) are preserved as integer 0, not falsy null', () => {
      const zeroFixture = `
Quota:
Gemini Models          Five Hour Limit Remaining  0%   2026-10-01T15:00:55Z
Gemini Models          Weekly Limit Remaining     0%   2026-10-07T04:20:00Z
Claude and GPT models  Five Hour Limit Remaining  0%   2026-10-01T16:55:43Z
Claude and GPT models  Weekly Limit Remaining     0%   2026-10-06T17:19:09Z
`;
      const parsed = parseUsage(zeroFixture);

      assert.strictEqual(parsed.gemini.fiveHour, 0, 'Gemini fiveHour must be numeric 0, not null');
      assert.strictEqual(parsed.gemini.weekly, 0, 'Gemini weekly must be numeric 0, not null');
      assert.strictEqual(parsed.claude_gpt.fiveHour, 0, 'Claude fiveHour must be numeric 0, not null');
      assert.strictEqual(parsed.claude_gpt.weekly, 0, 'Claude weekly must be numeric 0, not null');
    });

    it('2.3 100% saturated quota across all metrics is parsed accurately', () => {
      const fullFixture = `
Quota:
Gemini Models          Five Hour Limit Remaining  100%   2026-10-01T15:00:55Z
Gemini Models          Weekly Limit Remaining     100%   2026-10-07T04:20:00Z
Claude and GPT models  Five Hour Limit Remaining  100%   2026-10-01T16:55:43Z
Claude and GPT models  Weekly Limit Remaining     100%   2026-10-06T17:19:09Z
`;
      const parsed = parseUsage(fullFixture);

      assert.strictEqual(parsed.gemini.fiveHour, 100);
      assert.strictEqual(parsed.gemini.weekly, 100);
      assert.strictEqual(parsed.claude_gpt.fiveHour, 100);
      assert.strictEqual(parsed.claude_gpt.weekly, 100);
    });

    it('2.4 Malformed and noisy terminal output with ANSI colors, debug logs, and partial lines', () => {
      const noisyFixture = `
\u001b[32m[INFO] Querying Antigravity Quota\u001b[0m
Connecting to agy daemon on 127.0.0.1...
Quota:
\u001b[1mGemini Models\u001b[0m          Five Hour Limit Remaining  64%   2026-10-01T19:00:00Z
Warning: Token refresh pending in background
Claude and GPT models  Five Hour Limit Remaining  99%   2026-10-01T20:00:00Z
[DEBUG] Socket closed cleanly
`;
      const parsed = parseUsage(noisyFixture);

      assert.strictEqual(parsed.gemini.fiveHour, 64, 'Must parse Gemini line despite ANSI color codes');
      assert.strictEqual(parsed.claude_gpt.fiveHour, 99, 'Must parse Claude line despite intervening warning line');
    });

    it('2.5 Missing reset timestamps do not crash parser and leave resetTime fields null', () => {
      const noTimestampFixture = `
Quota:
Gemini Models          Five Hour Limit Remaining  50%
Gemini Models          Weekly Limit Remaining     70%
Claude and GPT models  Five Hour Limit Remaining  80%
`;
      const parsed = parseUsage(noTimestampFixture);

      assert.strictEqual(parsed.gemini.fiveHour, 50);
      assert.strictEqual(parsed.gemini.weekly, 70);
      assert.strictEqual(parsed.claude_gpt.fiveHour, 80);
      assert.strictEqual(parsed.gemini.resetTimeFiveHour, null);
      assert.strictEqual(parsed.gemini.resetTimeWeekly, null);
    });

    it('2.6 Irrelevant sections (e.g. unknown third-party buckets) do not corrupt Gemini or Claude data', () => {
      const unknownSectionsFixture = `
Quota:
DeepSeek Models        Five Hour Limit Remaining  25%   2026-10-01T12:00:00Z
Gemini Models          Five Hour Limit Remaining  72%   2026-10-01T15:00:00Z
OpenAI Legacy Models   Weekly Limit Remaining     10%   2026-10-05T00:00:00Z
Claude and GPT models  Five Hour Limit Remaining  84%   2026-10-01T16:00:00Z
`;
      const parsed = parseUsage(unknownSectionsFixture);

      assert.strictEqual(parsed.gemini.fiveHour, 72);
      assert.strictEqual(parsed.claude_gpt.fiveHour, 84);
    });

    it('2.7 Whitespace irregularities: tab stops, multiple spaces, and trailing whitespace', () => {
      const whitespaceFixture = "Quota:\n\tGemini Models \t   Five Hour Limit Remaining   \t 33% \t 2026-10-01T15:00:00Z  \n   Claude and GPT models \t Five Hour Limit Remaining \t 77% \t 2026-10-01T16:00:00Z \n";
      const parsed = parseUsage(whitespaceFixture);

      assert.strictEqual(parsed.gemini.fiveHour, 33);
      assert.strictEqual(parsed.claude_gpt.fiveHour, 77);
    });

    it('2.8 Connect-RPC Parser extracts dual-bucket, account email, and timestamps from RPC responses', () => {
      const mockSummary = {
        response: {
          groups: [
            {
              displayName: 'Gemini Models',
              buckets: [
                { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.442, resetTime: '2026-10-02T18:50:44Z' },
                { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.752, resetTime: '2026-10-01T17:55:23Z' }
              ]
            },
            {
              displayName: 'Claude and GPT models',
              buckets: [
                { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.999, resetTime: '2026-10-06T17:00:39Z' },
                { bucketId: '3p-5h', window: '5h', remainingFraction: 0.998, resetTime: '2026-10-01T17:32:58Z' }
              ]
            }
          ]
        }
      };

      const mockStatus = {
        userStatus: {
          email: 'developer@example.com',
          name: 'Developer',
          userTier: { name: 'Pro Tier' }
        }
      };

      const parsed = payload.parseRpcQuotaData(mockSummary, mockStatus);
      assert.strictEqual(parsed.account_email, 'developer@example.com');
      assert.strictEqual(parsed.user_tier, 'Pro Tier');
      assert.strictEqual(parsed.gemini.fiveHour, 75.2);
      assert.strictEqual(parsed.gemini.weekly, 44.2);
      assert.strictEqual(parsed.claude_gpt.fiveHour, 99.8);
      assert.strictEqual(parsed.claude_gpt.weekly, 99.9);
      assert.strictEqual(parsed.gemini.resetTimeFiveHour, '2026-10-01T17:55:23Z');
      assert.strictEqual(parsed.gemini.resetTimeWeekly, '2026-10-02T18:50:44Z');
    });
  });
});
