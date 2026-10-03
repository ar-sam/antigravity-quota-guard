'use strict';

/**
 * Test Suite: test/snapshot.test.js
 * Feature: R1 6-Phase Durable Snapshot Engine & Handover Pipeline
 * Tiers: Tier 1 (Feature Coverage) & Tier 2 (Boundary & Corner Cases)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const snapshot = require('../bin/snapshot.js');

const {
  createSnapshot,
  extractConversationMetadata,
  extractTranscriptMessages,
  scanActiveArtifacts,
  generateHandoffMarkdown,
  saveCheckpointAtomic,
  pruneCheckpoints,
  verifyChecksum,
  readConversationTitle,
  listCheckpoints,
  readCheckpointHandoff,
  classifyModel,
  normalizeQuotaMetrics,
  DEFAULT_CHECKPOINTS_DIR,
  CHECKPOINTS_DIR,
  MAX_CHECKPOINTS,
  MAX_MSG_CHARS,
  TRANSCRIPT_CHUNK_SIZE
} = snapshot;

// Test sandbox root
let testSandboxDir;

function createTestSandbox() {
  testSandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-snapshot-test-'));
  return testSandboxDir;
}

function cleanupTestSandbox() {
  if (testSandboxDir && fs.existsSync(testSandboxDir)) {
    try {
      fs.rmSync(testSandboxDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

describe('R1: Durable Snapshot Engine & Handover Pipeline', () => {

  beforeEach(() => {
    createTestSandbox();
  });

  afterEach(() => {
    cleanupTestSandbox();
  });

  describe('Tier 1: Feature Coverage (>=5 tests)', () => {

    it('1.1 Module exports all required functions, aliases, and constants', () => {
      // Primary API
      assert.strictEqual(typeof createSnapshot, 'function', 'createSnapshot must be exported');
      assert.strictEqual(typeof extractConversationMetadata, 'function', 'extractConversationMetadata must be exported');
      assert.strictEqual(typeof extractTranscriptMessages, 'function', 'extractTranscriptMessages must be exported');
      assert.strictEqual(typeof scanActiveArtifacts, 'function', 'scanActiveArtifacts must be exported');
      assert.strictEqual(typeof generateHandoffMarkdown, 'function', 'generateHandoffMarkdown must be exported');
      assert.strictEqual(typeof saveCheckpointAtomic, 'function', 'saveCheckpointAtomic must be exported');
      assert.strictEqual(typeof pruneCheckpoints, 'function', 'pruneCheckpoints must be exported');
      assert.strictEqual(typeof verifyChecksum, 'function', 'verifyChecksum must be exported');

      // Helper aliases
      assert.strictEqual(typeof readConversationTitle, 'function', 'readConversationTitle alias must be exported');
      assert.strictEqual(typeof listCheckpoints, 'function', 'listCheckpoints must be exported');
      assert.strictEqual(typeof readCheckpointHandoff, 'function', 'readCheckpointHandoff must be exported');
      assert.strictEqual(typeof classifyModel, 'function', 'classifyModel must be exported');
      assert.strictEqual(typeof normalizeQuotaMetrics, 'function', 'normalizeQuotaMetrics must be exported');

      // Constants
      assert.strictEqual(MAX_CHECKPOINTS, 10, 'MAX_CHECKPOINTS must be 10');
      assert.strictEqual(MAX_MSG_CHARS, 2000, 'MAX_MSG_CHARS must be 2000');
      assert.ok(TRANSCRIPT_CHUNK_SIZE >= 4096, 'TRANSCRIPT_CHUNK_SIZE must be >= 4KB');
      assert.ok(typeof CHECKPOINTS_DIR === 'string', 'CHECKPOINTS_DIR must be a string path');
    });

    it('1.2 Phase 1: Model classification and quota normalization logic', () => {
      // Gemini variants
      assert.strictEqual(classifyModel('Gemini 3.5 Pro'), 'gemini');
      assert.strictEqual(classifyModel('Gemini 3.8 Flash High'), 'gemini');
      assert.strictEqual(classifyModel('gemini-1.5-pro'), 'gemini');

      // Claude / GPT variants
      assert.strictEqual(classifyModel('Claude 3.7 Sonnet (Thinking)'), 'claude_gpt');
      assert.strictEqual(classifyModel('Claude 3.5 Haiku'), 'claude_gpt');
      assert.strictEqual(classifyModel('GPT-4o'), 'claude_gpt');
      assert.strictEqual(classifyModel('o1-mini'), 'claude_gpt');

      // Fallback
      assert.strictEqual(classifyModel('Custom Local Model'), 'unknown');
      assert.strictEqual(classifyModel(null), 'unknown');
      assert.strictEqual(classifyModel(''), 'unknown');

      // Quota normalization with nested structures
      const normalizedNested = normalizeQuotaMetrics({
        account_email: 'tester@example.com',
        gemini: { fiveHour: 12, weekly: 85, resetTimeFiveHour: '2026-10-01T21:00:00Z' },
        claude_gpt: { fiveHour: 100, weekly: 100, resetTimeFiveHour: null }
      });

      assert.strictEqual(normalizedNested.gemini_5h, 12);
      assert.strictEqual(normalizedNested.gemini_weekly, 85);
      assert.strictEqual(normalizedNested.claude_5h, 100);
      assert.strictEqual(normalizedNested.gemini_reset, '2026-10-01T21:00:00Z');
      assert.strictEqual(normalizedNested.account_email, 'tester@example.com');

      // Quota normalization with flat keys
      const normalizedFlat = normalizeQuotaMetrics({
        gemini_5h: 15,
        gemini_weekly: 70,
        claude_5h: 90,
        claude_weekly: 95,
        account: 'flat@example.com'
      });
      assert.strictEqual(normalizedFlat.gemini_5h, 15);
      assert.strictEqual(normalizedFlat.claude_5h, 90);
      assert.strictEqual(normalizedFlat.account_email, 'flat@example.com');
    });

    it('1.3 Phase 1: SQLite database title resolution with mock database and fallback', () => {
      const mockDbPath = path.join(testSandboxDir, 'mock_summaries.db');

      // Create a test sqlite database if node:sqlite is available
      let sqliteTested = false;
      try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(mockDbPath);
        db.exec(`
          CREATE TABLE conversation_summaries (
            conversation_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            last_modified_time TEXT
          );
          INSERT INTO conversation_summaries (conversation_id, title, last_modified_time)
          VALUES ('uuid-mock-1', 'Snapshot Architecture Refactor', '2026-10-01T18:00:00Z');
        `);
        db.close();
        sqliteTested = true;
      } catch (_) {
        // Fallback test without node:sqlite
      }

      if (sqliteTested) {
        const title = readConversationTitle('uuid-mock-1', mockDbPath);
        assert.strictEqual(title, 'Snapshot Architecture Refactor');

        const metadata = extractConversationMetadata('uuid-mock-1', {
          dbPath: mockDbPath,
          activeModel: 'Gemini 3.5 Pro',
          accountEmail: 'user@example.com'
        });

        assert.strictEqual(metadata.conversation_id, 'uuid-mock-1');
        assert.strictEqual(metadata.title, 'Snapshot Architecture Refactor');
        assert.strictEqual(metadata.active_model.name, 'Gemini 3.5 Pro');
        assert.strictEqual(metadata.active_model.category, 'gemini');
      }

      // Fallback for non-existent conversation ID in DB or missing DB
      const fallbackTitle = readConversationTitle('non-existent-id', mockDbPath);
      assert.strictEqual(fallbackTitle, 'Untitled Conversation');

      const nonExistentDbTitle = readConversationTitle('any-id', path.join(testSandboxDir, 'missing.db'));
      assert.strictEqual(nonExistentDbTitle, 'Untitled Conversation');
    });

    it('1.4 Phase 2: Reverse chunk transcript extraction of exactly the last 5 dialogue messages', () => {
      const convId = 'uuid-trans-1';
      const transcriptDir = path.join(testSandboxDir, 'brain', convId, '.system_generated', 'logs');
      fs.mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = path.join(transcriptDir, 'transcript.jsonl');

      // Create 8 steps: 1 system, 7 user/model turns
      const lines = [
        JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: 'Init system' }),
        JSON.stringify({ step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Turn 1 User message' }),
        JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Turn 2 Assistant response' }),
        JSON.stringify({ step_index: 3, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Turn 3 User message' }),
        JSON.stringify({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Turn 4 Assistant response' }),
        JSON.stringify({ step_index: 5, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Turn 5 User message' }),
        JSON.stringify({ step_index: 6, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Turn 6 Assistant response' }),
        JSON.stringify({ step_index: 7, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Turn 7 Final user query' })
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf8');

      const extracted = extractTranscriptMessages(convId, 5, {
        brainDir: path.join(testSandboxDir, 'brain'),
        chunkSize: 1024
      });

      assert.strictEqual(extracted.length, 5, 'Must extract exactly 5 messages');
      // Last 5 should be turns 3, 4, 5, 6, 7
      assert.strictEqual(extracted[0].content, 'Turn 3 User message');
      assert.strictEqual(extracted[0].role, 'user');
      assert.strictEqual(extracted[1].content, 'Turn 4 Assistant response');
      assert.strictEqual(extracted[1].role, 'assistant');
      assert.strictEqual(extracted[2].content, 'Turn 5 User message');
      assert.strictEqual(extracted[3].content, 'Turn 6 Assistant response');
      assert.strictEqual(extracted[4].content, 'Turn 7 Final user query');
      assert.strictEqual(extracted[4].role, 'user');
    });

    it('1.5 Phase 2: Strict 2,000-character truncation invariant per message', () => {
      const convId = 'uuid-trunc-1';
      const transcriptDir = path.join(testSandboxDir, 'brain', convId, '.system_generated', 'logs');
      fs.mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = path.join(transcriptDir, 'transcript.jsonl');

      // Create a huge message of 4,000 characters
      const hugeContent = 'A'.repeat(4000);
      const normalContent = 'Short reply from model';

      const lines = [
        JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: hugeContent }),
        JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: normalContent })
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf8');

      const extracted = extractTranscriptMessages(convId, 5, {
        brainDir: path.join(testSandboxDir, 'brain'),
        maxChars: 2000
      });

      assert.strictEqual(extracted.length, 2);
      const truncatedUserMsg = extracted[0];
      assert.ok(
        truncatedUserMsg.content.length <= 2000,
        `Message length (${truncatedUserMsg.content.length}) must strictly satisfy <= 2000 chars invariant`
      );
      assert.strictEqual(truncatedUserMsg.content.slice(0, 50), 'A'.repeat(50));
      assert.strictEqual(extracted[1].content, normalContent);
    });

    it('1.6 Phase 3: Artifact inventory scanning mock brain folder for *.md and ignoring non-md & metadata sidecars', () => {
      const convId = 'uuid-artifacts-1';
      const brainConvDir = path.join(testSandboxDir, 'brain', convId);
      fs.mkdirSync(brainConvDir, { recursive: true });

      // Valid Markdown artifacts
      fs.writeFileSync(path.join(brainConvDir, 'design_spec.md'), '# Design Specification\nContent...', 'utf8');
      fs.writeFileSync(path.join(brainConvDir, 'testing_notes.md'), '# Test Plan\nDetails...', 'utf8');

      // Excluded: metadata sidecars (*.metadata.json)
      fs.writeFileSync(path.join(brainConvDir, 'design_spec.md.metadata.json'), '{"meta": true}', 'utf8');

      // Excluded: non-markdown files
      fs.writeFileSync(path.join(brainConvDir, 'data.json'), '{"data": 123}', 'utf8');
      fs.writeFileSync(path.join(brainConvDir, 'diagram.png'), 'fake-image-bytes', 'utf8');
      fs.writeFileSync(path.join(brainConvDir, 'notes.txt'), 'plain text notes', 'utf8');

      // Excluded: internal and scratch directories
      fs.mkdirSync(path.join(brainConvDir, '.system_generated'), { recursive: true });
      fs.writeFileSync(path.join(brainConvDir, '.system_generated', 'internal.md'), 'internal hidden', 'utf8');

      fs.mkdirSync(path.join(brainConvDir, '.user_uploaded'), { recursive: true });
      fs.writeFileSync(path.join(brainConvDir, '.user_uploaded', 'uploaded.md'), 'uploaded hidden', 'utf8');

      fs.mkdirSync(path.join(brainConvDir, 'scratch'), { recursive: true });
      fs.writeFileSync(path.join(brainConvDir, 'scratch', 'scratchpad.md'), 'scratchpad hidden', 'utf8');

      const artifacts = scanActiveArtifacts(convId, {
        brainDir: path.join(testSandboxDir, 'brain')
      });

      // Must find exactly 2 active markdown artifacts
      assert.strictEqual(artifacts.length, 2, 'Must discover exactly 2 markdown artifacts');
      const names = artifacts.map(a => a.name).sort();
      assert.deepStrictEqual(names, ['design_spec.md', 'testing_notes.md']);

      for (const a of artifacts) {
        assert.ok(typeof a.name === 'string');
        assert.ok(typeof a.path === 'string');
        assert.ok(typeof a.relative_path === 'string');
        assert.ok(typeof a.size_bytes === 'number' && a.size_bytes > 0);
        assert.ok(typeof a.modified === 'string');
      }
    });

    it('1.7 Phase 4: Markdown handoff document generation containing all required sections and resume instructions', () => {
      const mockMeta = {
        conversation_id: 'conv-handoff-xyz',
        title: 'Authentication Module Hardening',
        active_model: { name: 'Claude 3.7 Sonnet', category: 'claude_gpt' },
        account_email: 'dev@company.com',
        created_at: '2026-10-01T20:00:00.000Z',
        quota_at_pause: {
          gemini_5h: 80,
          gemini_weekly: 90,
          claude_5h: 12,
          claude_weekly: 40,
          gemini_reset: '2026-10-01T22:00:00Z',
          claude_reset: '2026-10-01T21:15:00Z'
        }
      };

      const mockArtifacts = [
        { name: 'auth_spec.md', relative_path: 'auth_spec.md', size_bytes: 4096, modified: '2026-10-01T19:50:00.000Z' }
      ];

      const mockMessages = [
        { role: 'user', content: 'Please review the JWT rotation logic.', timestamp: '2026-10-01T19:52:00Z' },
        { role: 'assistant', content: 'I have analyzed the token store and found two issues.', timestamp: '2026-10-01T19:55:00Z' }
      ];

      const md = generateHandoffMarkdown({
        metadata: mockMeta,
        quotaMetrics: mockMeta.quota_at_pause,
        artifacts: mockArtifacts,
        transcript: mockMessages
      });

      assert.strictEqual(typeof md, 'string');
      // Document title
      assert.ok(md.includes('# 📋 Conversation Recovery Document (Quota Guard Checkpoint)'));
      // Session Metadata
      assert.ok(md.includes('## Session Metadata'));
      assert.ok(md.includes('conv-handoff-xyz'));
      assert.ok(md.includes('Authentication Module Hardening'));
      assert.ok(md.includes('Claude 3.7 Sonnet (claude_gpt)'));
      assert.ok(md.includes('dev@company.com'));

      // Quota Table
      assert.ok(md.includes('## Quota Status at Pause'));
      assert.ok(md.includes('Gemini Models'));
      assert.ok(md.includes('Claude / GPT Models'));
      assert.ok(md.includes('12%'));
      assert.ok(md.includes('80%'));

      // Artifacts Inventory
      assert.ok(md.includes('## Active Artifacts Inventory'));
      assert.ok(md.includes('auth_spec.md'));
      assert.ok(md.includes('4.0 KB'));

      // Recent Transcript
      assert.ok(md.includes('## Recent Conversation Transcript'));
      assert.ok(md.includes('Please review the JWT rotation logic.'));
      assert.ok(md.includes('I have analyzed the token store'));

      // Resume Instructions
      assert.ok(md.includes('## Resume Instructions for Successor Agent'));
      assert.ok(md.includes('Context Recovery'));
      assert.ok(md.includes('Artifact Verification'));
      assert.ok(md.includes('Execution Continuity'));
      assert.ok(md.includes('Account & Quota Status'));
    });

    it('1.8 Phase 5: Atomic serialization writes without leaving orphan .tmp files', () => {
      const targetPath = path.join(testSandboxDir, 'checkpoints', 'test_checkpoint.json');
      const testContent = JSON.stringify({ version: '1.0.0', status: 'ok' }, null, 2);

      const writtenPath = saveCheckpointAtomic(targetPath, testContent);
      assert.strictEqual(writtenPath, targetPath);
      assert.ok(fs.existsSync(targetPath), 'Target checkpoint file must exist');
      assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), testContent);

      // Verify no temporary files remain in folder
      const dirEntries = fs.readdirSync(path.dirname(targetPath));
      const tmpFiles = dirEntries.filter(f => f.endsWith('.tmp'));
      assert.strictEqual(tmpFiles.length, 0, 'No .tmp files must remain after atomic write');
    });

    it('1.9 Phase 5: Strict auto-pruning to max 10 checkpoints retains exactly the 10 newest files', () => {
      const checkpointsDir = path.join(testSandboxDir, 'pruning_test_dir');
      fs.mkdirSync(checkpointsDir, { recursive: true });

      // Create 13 checkpoint pairs (01 through 13)
      for (let i = 1; i <= 13; i++) {
        const numStr = String(i).padStart(2, '0');
        const filename = `checkpoint-2026-10-01T${numStr}-00-00-000Z-test`;
        fs.writeFileSync(path.join(checkpointsDir, `${filename}.json`), JSON.stringify({ id: i }), 'utf8');
        fs.writeFileSync(path.join(checkpointsDir, `${filename}.md`), `# Checkpoint ${i}`, 'utf8');
      }

      // Check baseline count is 13 json + 13 md = 26 files
      let entries = fs.readdirSync(checkpointsDir);
      assert.strictEqual(entries.filter(f => f.endsWith('.json')).length, 13);
      assert.strictEqual(entries.filter(f => f.endsWith('.md')).length, 13);

      // Prune to 10 max
      const deleted = pruneCheckpoints(checkpointsDir, 10);
      assert.ok(deleted.length >= 6, 'Should delete at least 6 files (3 json + 3 md)');

      entries = fs.readdirSync(checkpointsDir);
      const remainingJson = entries.filter(f => f.endsWith('.json')).sort();
      const remainingMd = entries.filter(f => f.endsWith('.md')).sort();

      // Exactly 10 checkpoints must remain
      assert.strictEqual(remainingJson.length, 10, 'Must have exactly 10 remaining .json checkpoints');
      assert.strictEqual(remainingMd.length, 10, 'Must have exactly 10 remaining .md checkpoints');

      // The 3 oldest (01, 02, 03) must be deleted
      assert.ok(!remainingJson.some(f => f.includes('T01-')), 'Checkpoint 01 must be pruned');
      assert.ok(!remainingJson.some(f => f.includes('T02-')), 'Checkpoint 02 must be pruned');
      assert.ok(!remainingJson.some(f => f.includes('T03-')), 'Checkpoint 03 must be pruned');

      // The 10 newest (04 through 13) must remain
      assert.ok(remainingJson.some(f => f.includes('T04-')), 'Checkpoint 04 must be retained');
      assert.ok(remainingJson.some(f => f.includes('T13-')), 'Checkpoint 13 must be retained');
    });

    it('1.10 Phase 6: SHA-256 cryptographic verification and disk read-back integrity', () => {
      const checkpointObj = {
        version: '1.0.0',
        conversation_id: 'verify-uuid-1',
        title: 'Cryptographic Checkpoint Test',
        created_at: new Date().toISOString(),
        messages: [{ role: 'user', content: 'test message' }]
      };

      // Compute digest of pre-hash object
      const preHash = JSON.stringify(checkpointObj, null, 2);
      const expectedDigest = crypto.createHash('sha256').update(preHash).digest('hex');
      assert.strictEqual(expectedDigest.length, 64, 'SHA-256 digest must be 64 characters');

      // Add integrity_sha256 property to object
      checkpointObj.integrity_sha256 = expectedDigest;

      const checkpointPath = path.join(testSandboxDir, 'verified_checkpoint.json');
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpointObj, null, 2), 'utf8');

      // Verification on unmodified file must pass
      const isValid = verifyChecksum(checkpointPath);
      assert.strictEqual(isValid, true, 'Unmodified file must pass SHA-256 verification');

      // Verification by providing expected digest explicitly
      const isValidExplicit = verifyChecksum(checkpointPath, expectedDigest);
      assert.strictEqual(isValidExplicit, true);

      // Tamper detection: modify a property on disk
      const diskContent = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
      diskContent.title = 'TAMPERED TITLE';
      fs.writeFileSync(checkpointPath, JSON.stringify(diskContent, null, 2), 'utf8');

      const isTamperedValid = verifyChecksum(checkpointPath);
      assert.strictEqual(isTamperedValid, false, 'Tampered file must fail SHA-256 verification');
    });

    it('1.11 End-to-End createSnapshot pipeline with real progress callback advancing to 100%', async () => {
      const convId = 'e2e-conv-123';
      const brainDir = path.join(testSandboxDir, 'brain');
      const checkpointsDir = path.join(testSandboxDir, 'checkpoints');

      // Setup mock brain with transcript and artifact
      const transcriptDir = path.join(brainDir, convId, '.system_generated', 'logs');
      fs.mkdirSync(transcriptDir, { recursive: true });
      fs.writeFileSync(
        path.join(transcriptDir, 'transcript.jsonl'),
        JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'E2E Start Task' }) + '\n' +
        JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'E2E Done Task' }) + '\n'
      );
      fs.writeFileSync(path.join(brainDir, convId, 'summary.md'), '# Execution Summary\nDone.', 'utf8');

      const progressSteps = [];
      const onProgress = (payload) => {
        progressSteps.push(payload);
      };

      const result = await createSnapshot({
        conversationId: convId,
        activeModel: 'Gemini 3.5 Pro',
        quotaMetrics: {
          account_email: 'tester@gemini.com',
          gemini: { fiveHour: 12, weekly: 75, resetTimeFiveHour: '2026-10-01T21:00:00Z' },
          claude_gpt: { fiveHour: 100, weekly: 100, resetTimeFiveHour: null }
        },
        brainDir,
        checkpointsDir,
        onProgress
      });

      assert.strictEqual(result.success, true, 'createSnapshot must report success: true');
      assert.ok(result.checkpointPath, 'Result must contain checkpointPath');
      assert.ok(result.markdownPath, 'Result must contain markdownPath');
      assert.ok(result.digest, 'Result must contain digest');
      assert.strictEqual(result.digest.length, 64, 'Digest must be 64-character SHA-256 hex');

      // Verify files actually exist on disk
      assert.ok(fs.existsSync(result.checkpointPath), 'JSON checkpoint must exist on disk');
      assert.ok(fs.existsSync(result.markdownPath), 'Markdown handoff must exist on disk');

      // Verify progress callback sequence
      assert.ok(progressSteps.length >= 6, 'Must emit at least 6 progress events');
      const phases = progressSteps.map(p => p.phase);
      assert.deepStrictEqual(phases.slice(0, 6), [1, 2, 3, 4, 5, 6], 'Must report phases 1 through 6 in order');

      const percentages = progressSteps.map(p => p.percent);
      assert.strictEqual(percentages[0], 15, 'Phase 1 must be 15%');
      assert.strictEqual(percentages[percentages.length - 1], 100, 'Phase 6 must be 100%');

      // Verify percentages are non-decreasing
      for (let i = 1; i < percentages.length; i++) {
        assert.ok(percentages[i] >= percentages[i - 1], `Percentage at step ${i} (${percentages[i]}) must be >= step ${i-1} (${percentages[i-1]})`);
      }

      // Phase 4 must provide the generated markdown
      const phase4Event = progressSteps.find(p => p.phase === 4);
      assert.ok(phase4Event && typeof phase4Event.markdown === 'string', 'Phase 4 event must include markdown companion');
      assert.ok(phase4Event.markdown.includes('Conversation Recovery Document'));

      // Checkpoint JSON verification
      const savedJson = JSON.parse(fs.readFileSync(result.checkpointPath, 'utf8'));
      assert.strictEqual(savedJson.conversation_id, convId);
      assert.strictEqual(savedJson.active_model.name, 'Gemini 3.5 Pro');
      assert.strictEqual(savedJson.active_model.category, 'gemini');
      assert.strictEqual(savedJson.account_email, 'tester@gemini.com');
      assert.strictEqual(savedJson.artifacts.length, 1);
      assert.strictEqual(savedJson.artifacts[0].name, 'summary.md');
      assert.strictEqual(savedJson.transcript.length, 2);
    });

  });

  describe('Tier 2: Boundary & Corner Cases (>=5 tests)', () => {

    it('2.1 Missing or inaccessible transcript.jsonl returns empty message array without throw', () => {
      const missingConvId = 'uuid-no-transcript';
      const extracted = extractTranscriptMessages(missingConvId, 5, {
        brainDir: path.join(testSandboxDir, 'brain')
      });
      assert.deepStrictEqual(extracted, [], 'Missing transcript must gracefully return empty array');

      // Empty file
      const emptyTranscriptDir = path.join(testSandboxDir, 'brain', 'empty-conv', '.system_generated', 'logs');
      fs.mkdirSync(emptyTranscriptDir, { recursive: true });
      fs.writeFileSync(path.join(emptyTranscriptDir, 'transcript.jsonl'), '', 'utf8');

      const emptyExtracted = extractTranscriptMessages('empty-conv', 5, {
        brainDir: path.join(testSandboxDir, 'brain')
      });
      assert.deepStrictEqual(emptyExtracted, [], 'Empty transcript file must return empty array');
    });

    it('2.2 Transcript with fewer than 5 messages returns all available messages', () => {
      const convId = 'uuid-few-msgs';
      const transcriptDir = path.join(testSandboxDir, 'brain', convId, '.system_generated', 'logs');
      fs.mkdirSync(transcriptDir, { recursive: true });
      const transcriptPath = path.join(transcriptDir, 'transcript.jsonl');

      // Only 2 dialogue messages
      const lines = [
        JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Message 1' }),
        JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Message 2' })
      ];
      fs.writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf8');

      const extracted = extractTranscriptMessages(convId, 5, {
        brainDir: path.join(testSandboxDir, 'brain')
      });

      assert.strictEqual(extracted.length, 2, 'Should return all 2 available messages without error');
      assert.strictEqual(extracted[0].content, 'Message 1');
      assert.strictEqual(extracted[1].content, 'Message 2');
    });

    it('2.3 Brain directory with zero markdown files returns empty array and handoff has fallback text', () => {
      const convId = 'uuid-no-md';
      const brainConvDir = path.join(testSandboxDir, 'brain', convId);
      fs.mkdirSync(brainConvDir, { recursive: true });
      fs.writeFileSync(path.join(brainConvDir, 'image.jpg'), 'image', 'utf8');

      const artifacts = scanActiveArtifacts(convId, {
        brainDir: path.join(testSandboxDir, 'brain')
      });
      assert.deepStrictEqual(artifacts, [], 'Must return empty array when no .md artifacts exist');

      const md = generateHandoffMarkdown({
        metadata: { conversation_id: convId, title: 'No Artifacts Test' },
        artifacts: []
      });
      assert.ok(md.includes('No active markdown artifacts found'));
    });

    it('2.4 pruneCheckpoints with <= 10 checkpoints deletes nothing', () => {
      const dir = path.join(testSandboxDir, 'small_prune_test');
      fs.mkdirSync(dir, { recursive: true });

      // Create 6 checkpoints
      for (let i = 1; i <= 6; i++) {
        fs.writeFileSync(path.join(dir, `checkpoint-2026-10-01T0${i}-00-00-000Z.json`), '{}');
        fs.writeFileSync(path.join(dir, `checkpoint-2026-10-01T0${i}-00-00-000Z.md`), '# test');
      }

      const deleted = pruneCheckpoints(dir, 10);
      assert.strictEqual(deleted.length, 0, 'No checkpoints should be deleted when count <= 10');
      assert.strictEqual(fs.readdirSync(dir).length, 12);
    });

    it('2.5 pruneCheckpoints preserves non-checkpoint files in checkpoints directory', () => {
      const dir = path.join(testSandboxDir, 'preserve_files_test');
      fs.mkdirSync(dir, { recursive: true });

      // Create 12 checkpoints
      for (let i = 1; i <= 12; i++) {
        const numStr = String(i).padStart(2, '0');
        fs.writeFileSync(path.join(dir, `checkpoint-2026-10-01T${numStr}-00-00-000Z.json`), '{}');
        fs.writeFileSync(path.join(dir, `checkpoint-2026-10-01T${numStr}-00-00-000Z.md`), '# md');
      }

      // Add special non-checkpoint files
      fs.writeFileSync(path.join(dir, 'README.txt'), 'Important user notes');
      fs.writeFileSync(path.join(dir, 'custom_log.log'), 'Logs');

      pruneCheckpoints(dir, 10);

      // Non-checkpoint files must remain untouched
      assert.ok(fs.existsSync(path.join(dir, 'README.txt')), 'README.txt must be preserved');
      assert.ok(fs.existsSync(path.join(dir, 'custom_log.log')), 'custom_log.log must be preserved');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'README.txt'), 'utf8'), 'Important user notes');
    });

    it('2.6 listCheckpoints and readCheckpointHandoff discover and parse stored files', () => {
      const dir = path.join(testSandboxDir, 'list_test_dir');
      fs.mkdirSync(dir, { recursive: true });

      const cpData1 = {
        version: '1.0.0',
        conversation_id: 'conv-1',
        title: 'Task 1 Setup',
        active_model: { name: 'Gemini 3.5 Pro' },
        account_email: 'acc1@example.com',
        created_at: '2026-10-01T10:00:00Z',
        integrity_sha256: 'abc'
      };
      const cpData2 = {
        version: '1.0.0',
        conversation_id: 'conv-2',
        title: 'Task 2 Hardening',
        active_model: { name: 'Claude 3.7 Sonnet' },
        account_email: 'acc2@example.com',
        created_at: '2026-10-01T12:00:00Z',
        integrity_sha256: 'def'
      };

      fs.writeFileSync(path.join(dir, 'checkpoint-2026-10-01T10-00-00-000Z.json'), JSON.stringify(cpData1));
      fs.writeFileSync(path.join(dir, 'checkpoint-2026-10-01T10-00-00-000Z.md'), '# Handoff 1');
      fs.writeFileSync(path.join(dir, 'checkpoint-2026-10-01T12-00-00-000Z.json'), JSON.stringify(cpData2));
      fs.writeFileSync(path.join(dir, 'checkpoint-2026-10-01T12-00-00-000Z.md'), '# Handoff 2 Content');

      const listed = listCheckpoints(dir);
      assert.strictEqual(listed.length, 2, 'Must list 2 checkpoints');

      // Newest first (12:00:00 before 10:00:00)
      assert.strictEqual(listed[0].title, 'Task 2 Hardening');
      assert.strictEqual(listed[0].account, 'acc2@example.com');
      assert.strictEqual(listed[1].title, 'Task 1 Setup');

      // readCheckpointHandoff
      const handoffContent = readCheckpointHandoff('checkpoint-2026-10-01T12-00-00-000Z.json', dir);
      assert.strictEqual(handoffContent, '# Handoff 2 Content');
    });

    it('2.7 createSnapshot creates custom checkpointsDir recursively if it does not exist', async () => {
      const nestedDir = path.join(testSandboxDir, 'deeply', 'nested', 'checkpoints');
      assert.ok(!fs.existsSync(nestedDir), 'Directory should not exist initially');

      const res = await createSnapshot({
        conversationId: 'recursive-dir-test',
        checkpointsDir: nestedDir
      });

      assert.strictEqual(res.success, true);
      assert.ok(fs.existsSync(nestedDir), 'Directory must have been created recursively');
      assert.ok(fs.existsSync(res.checkpointPath));
    });

  });

});
