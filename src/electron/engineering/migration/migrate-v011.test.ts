import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { EngineeringCommandBus } from '../command-bus';
import { LibSqlEngineeringRepository } from '../repository';
import { evaluateGitGate } from '../git-gate';
import { ensureDefaultPolicyPack } from '../policy-pack';
import { decodeLegacyFactoryToMigrationInput } from './legacy-factory-decoder';
import { loadV011Fixture, runV011Migration } from './migrate-v011';

const dirs: string[] = [];
after(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const FIXTURE = {
  version: '0.1.1' as const,
  workspace: {
    id: 'ws_legacy',
    path: '/tmp/legacy-ws',
    name: 'legacy',
    branch: 'main',
  },
  settings: {
    theme: 'dark',
    privacyMode: 'strict',
    unrelatedSetting: true,
  },
  legacyFactoryRuns: [
    {
      id: 'factory_legacy_1',
      mode: 'factory',
      prompt: 'Migrate me to EngineeringTask',
      access: 'approval',
      stages: [
        {
          id: 'repo_context',
          label: 'Repo context',
          status: 'completed',
          summary: 'historical',
        },
      ],
      ratchetSuggestions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  messages: [
    {
      id: 'm1',
      role: 'assistant',
      content: 'old',
      factoryRun: {
        id: 'factory_from_msg',
        mode: 'ship',
        prompt: 'From message embed',
        access: 'approval',
        stages: [],
        ratchetSuggestions: [],
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    },
  ],
};

describe('Full v0.1.1 migration fixture [CLOSURE migration]', () => {
  it('produces canonical EngineeringTask, idempotent on second run', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mate-x-mig-'));
    dirs.push(dir);
    const dbPath = path.join(dir, 'mate-x.db');
    const repo = LibSqlEngineeringRepository.open(dbPath);
    const bus = new EngineeringCommandBus(repo);

    // No EngineeringTask records initially
    assert.equal(repo.listTasks('ws_legacy').length, 0);

    const first = runV011Migration({
      repo,
      bus,
      fixture: FIXTURE,
      userDataDir: dir,
    });
    assert.equal(first.skippedDuplicate, false);
    assert.ok(first.tasksCreated >= 1);
    assert.ok(first.engineeringTaskIds.length >= 1);
    assert.equal(first.settingsPreserved, true);
    assert.ok(first.archivePath);

    const tasks = repo.listTasks('ws_legacy');
    assert.ok(tasks.length >= 1);
    const policy = ensureDefaultPolicyPack(repo);

    // GitGate blocked until fresh canonical proof
    const gate = evaluateGitGate({
      repo,
      proofHandle: null,
      current: {
        workspaceId: 'ws_legacy',
        headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        diffHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        policyHash: policy.policyHash,
      },
    });
    assert.equal(gate.allowed, false);

    // Second startup — no duplicate
    const second = runV011Migration({
      repo,
      bus,
      fixture: FIXTURE,
      userDataDir: dir,
    });
    assert.equal(second.skippedDuplicate, true);
    assert.equal(second.tasksCreated, 0);
    assert.equal(repo.listTasks('ws_legacy').length, tasks.length);

    // Archive immutable
    const archive = JSON.parse(readFileSync(first.archivePath!, 'utf8')) as {
      immutable: boolean;
      settings: { unrelatedSetting: boolean };
    };
    assert.equal(archive.immutable, true);
    assert.equal(archive.settings.unrelatedSetting, true);

    // Readiness must not derive from legacy stage "completed"
    for (const t of tasks) {
      assert.notEqual(t.readiness, 'Ready');
    }
  });

  it('malformed legacy records fail safely', () => {
    assert.equal(
      decodeLegacyFactoryToMigrationInput({
        workspaceId: 'ws',
        factoryRun: { not: 'a factory' },
      }),
      null,
    );
    assert.equal(
      decodeLegacyFactoryToMigrationInput({
        workspaceId: 'ws',
        factoryRun: {
          id: 'x',
          mode: 'factory',
          prompt: '   ',
          access: 'approval',
          stages: [],
          ratchetSuggestions: [],
          createdAt: 't',
        },
      }),
      null,
    );
  });

  it('fixture file loader accepts representative v0.1.1 payload', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mate-x-fix-'));
    dirs.push(dir);
    const fixturePath = path.join(dir, 'v0.1.1-fixture.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(fixturePath, JSON.stringify(FIXTURE), 'utf8');
    const loaded = loadV011Fixture(fixturePath);
    assert.equal(loaded.version, '0.1.1');
    assert.ok(loaded.legacyFactoryRuns?.length);
    assert.ok(loaded.settings?.unrelatedSetting);
  });
});
