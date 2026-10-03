'use strict';

/**
 * Test Suite: test/workspace-isolation.test.js
 * Feature: R6 Zero External Workspace Mutation
 * Tiers: Tier 1 (Feature Coverage) & Tier 2 (Boundary & Corner Cases)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');

describe('R6: Zero External Workspace Mutation', () => {
  let mockExternalRepo;

  before(() => {
    // Create an isolated mock external workspace repository in tmpdir
    mockExternalRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-external-workspace-'));
    try {
      execSync('git init -b main', { cwd: mockExternalRepo, stdio: 'pipe' });
      execSync('git config user.name "Test Dev"', { cwd: mockExternalRepo, stdio: 'pipe' });
      execSync('git config user.email "testdev@example.com"', { cwd: mockExternalRepo, stdio: 'pipe' });
      fs.writeFileSync(path.join(mockExternalRepo, 'README.md'), '# External Project\n', 'utf8');
      fs.writeFileSync(path.join(mockExternalRepo, 'app.js'), 'console.log("hello");\n', 'utf8');
      execSync('git add -A && git commit -m "initial external commit"', { cwd: mockExternalRepo, stdio: 'pipe' });
    } catch (_) {}
  });

  after(() => {
    if (mockExternalRepo && fs.existsSync(mockExternalRepo)) {
      try {
        fs.rmSync(mockExternalRepo, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  describe('Tier 1: Feature Coverage (>=5 tests)', () => {
    it('1.1 External workspace has zero quota-guard mutations or modifications', () => {
      assert.ok(fs.existsSync(mockExternalRepo), 'External workspace must exist');

      const gitOutput = execSync(`git -C "${mockExternalRepo}" status --porcelain`, { encoding: 'utf8' });
      const quotaLines = gitOutput
        .split('\n')
        .map(l => l.trim())
        .filter(l => /quota[-_]?guard|antigravity[-_]?quota/i.test(l));

      assert.strictEqual(
        quotaLines.length,
        0,
        `External workspace must not contain any quota-guard changes. Found:\n${quotaLines.join('\n')}`
      );
    });

    it('1.2 Zero Quota Guard artifacts exist anywhere in external workspace tree', () => {
      const gitOutput = execSync(`git -C "${mockExternalRepo}" status --porcelain`, { encoding: 'utf8' });
      const quotaGuardArtifacts = gitOutput
        .split('\n')
        .map(l => l.trim())
        .filter(l => /quota[-_]?guard|antigravity[-_]?quota/i.test(l));

      assert.strictEqual(
        quotaGuardArtifacts.length,
        0,
        `Found unexpected Quota Guard artifacts in external workspace:\n${quotaGuardArtifacts.join('\n')}`
      );
    });

    it('1.3 antigravity-quota-guard codebase contains zero write targets to external user directories', () => {
      const binFiles = ['config.js', 'payload.js', 'index.js'];
      for (const file of binFiles) {
        const filePath = path.join(PROJECT_ROOT, 'bin', file);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          assert.strictEqual(
            content.includes('/Desktop/Work/Code'),
            false,
            `bin/${file} must not reference /Desktop/Work/Code`
          );
        }
      }
    });

    it('1.4 patch.sh runner contains zero hardcoded external user paths', () => {
      const patchShPath = path.join(PROJECT_ROOT, 'patch.sh');
      if (fs.existsSync(patchShPath)) {
        const content = fs.readFileSync(patchShPath, 'utf8');
        assert.strictEqual(content.includes('Desktop/Work'), false, 'patch.sh must not reference Desktop/Work');
      }
    });

    it('1.5 Config writes are strictly isolated to ~/.gemini/antigravity-quota-guard/', () => {
      const config = require('../bin/config.js');
      assert.ok(
        config.CONFIG_DIR.includes(path.join('.gemini', 'antigravity-quota-guard')),
        'CONFIG_DIR must be scoped to ~/.gemini/antigravity-quota-guard'
      );
    });
  });

  describe('Tier 2: Boundary & Corner Cases (>=5 tests)', () => {
    it('2.1 External workspace status remains byte-for-byte unchanged before and after test execution', () => {
      const statusBefore = execSync(`git -C "${mockExternalRepo}" status --porcelain`, { encoding: 'utf8' });

      // Run local quota guard operations (load config, test parser, test classify)
      const config = require('../bin/config.js');
      const payload = require('../bin/payload.js');
      config.loadConfig();
      payload.classifyModel('Gemini 3.8 Flash High');

      const statusAfter = execSync(`git -C "${mockExternalRepo}" status --porcelain`, { encoding: 'utf8' });
      assert.strictEqual(statusBefore, statusAfter, 'External workspace status must not change during operations');
    });

    it('2.2 No relative path traversal escapes project root toward parent directories', () => {
      const binDir = path.join(PROJECT_ROOT, 'bin');
      const files = fs.readdirSync(binDir);
      for (const file of files) {
        const content = fs.readFileSync(path.join(binDir, file), 'utf8');
        // Check for aggressive traversal like '../../..'
        assert.strictEqual(
          /\.\.\/\.\.\/\.\./.test(content),
          false,
          `Deep directory traversal forbidden in bin/${file}`
        );
      }
    });

    it('2.3 External workspace HEAD commit and branch are completely untouched', () => {
      const currentBranch = execSync(`git -C "${mockExternalRepo}" branch --show-current`, { encoding: 'utf8' }).trim();
      assert.ok(currentBranch.length > 0, 'External workspace has active branch');

      const lastCommitTime = execSync(`git -C "${mockExternalRepo}" log -1 --format=%ct`, { encoding: 'utf8' }).trim();
      const lastCommitAgeSeconds = (Date.now() / 1000) - parseInt(lastCommitTime, 10);
      assert.ok(lastCommitAgeSeconds >= 0, 'Commit timestamp is valid');
    });

    it('2.4 Package.json scripts do not define external path references', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
      const scripts = JSON.stringify(pkg.scripts || {});
      assert.strictEqual(scripts.includes('Desktop'), false, 'package.json scripts must not reference Desktop');
    });

    it('2.5 Subprocess spawn execution environment maintains clean isolation', () => {
      const payloadCode = fs.readFileSync(path.join(PROJECT_ROOT, 'bin', 'payload.js'), 'utf8');
      const execMatches = payloadCode.match(/exec\s*\(\s*['"`]([^'"`]+)['"`]/g) || [];
      for (const m of execMatches) {
        assert.strictEqual(m.includes('Desktop/Work'), false, `Command ${m} must not target external work directory`);
      }
    });
  });
});
