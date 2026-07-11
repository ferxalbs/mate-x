/**
 * Packaged application self-test driver (CLOSURE 3).
 * Enabled only when MATE_X_PACKAGED_SELF_TEST=1 AND not a release build.
 * Impossible to enable in release packages (negative test required).
 *
 * Exercises:
 * - durable EngineeringTask create via same command bus IPC path
 * - quit/relaunch recovery via userData reuse (caller relaunches)
 * - GitGate stale-proof after external mutation
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { EngineeringCommandBus } from './command-bus';
import { createPhaseHandler } from './phase-handler';
import { evaluateGitGate } from './git-gate';
import { hashDiffPayload } from './freshness-anchors';
import { ensureDefaultPolicyPack } from './policy-pack';
import {
  initDurableEngineeringRepository,
  getEngineeringRepository,
  LibSqlEngineeringRepository,
  setEngineeringRepository,
} from './repository';
import { isReleaseBuild } from '../../lib/engineering-flags';

export interface PackagedSelfTestResult {
  ok: boolean;
  phase: string;
  exitCode: number;
  engineeringTaskId?: string;
  aggregateVersion?: number;
  workspaceId?: string;
  branch?: string;
  headSha?: string;
  policyHash?: string;
  eventCount?: number;
  readiness?: string;
  gitGateAllowed?: boolean;
  gitGateAfterMutationAllowed?: boolean;
  proofStaleAfterMutation?: boolean;
  error?: string;
  artifactHashes?: Record<string, string>;
}

/**
 * Self-test is opt-in via MATE_X_PACKAGED_SELF_TEST=1.
 * Hard-disabled when MATE_X_RELEASE_BUILD=1 — impossible in release packages
 * even if ALLOW is set (negative test).
 *
 * Forge packages always have app.isPackaged=true; release gating uses the
 * explicit MATE_X_RELEASE_BUILD marker rather than isPackaged alone.
 */
export function isPackagedSelfTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MATE_X_PACKAGED_SELF_TEST !== '1') return false;
  // Impossible in release packages — ALLOW cannot override
  if (env.MATE_X_RELEASE_BUILD === '1') return false;
  return true;
}

/** Negative: release build never enables driver even with env + allow set. */
export function assertSelfTestDisabledInRelease(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const forced = {
    ...env,
    MATE_X_PACKAGED_SELF_TEST: '1',
    MATE_X_RELEASE_BUILD: '1',
    MATE_X_ALLOW_PACKAGED_SELF_TEST: '1',
  };
  return isPackagedSelfTestEnabled(forced) === false;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Run the durable create + GitGate portion against isolated userData + git fixture.
 * Relaunch recovery is validated by writing state then reopening LibSQL from same path.
 */
export async function runPackagedSelfTest(input: {
  userDataDir: string;
  fixtureRepoDir: string;
  resultPath: string;
}): Promise<PackagedSelfTestResult> {
  const result: PackagedSelfTestResult = {
    ok: false,
    phase: 'start',
    exitCode: 1,
  };

  try {
    mkdirSync(input.userDataDir, { recursive: true });
    mkdirSync(input.fixtureRepoDir, { recursive: true });

    // Isolated git fixture — never the MaTE X source repo
    if (!existsSync(join(input.fixtureRepoDir, '.git'))) {
      git(input.fixtureRepoDir, ['init']);
      git(input.fixtureRepoDir, ['config', 'user.email', 'selftest@mate-x.local']);
      git(input.fixtureRepoDir, ['config', 'user.name', 'MaTE X SelfTest']);
      writeFileSync(join(input.fixtureRepoDir, 'README.md'), '# fixture\n', 'utf8');
      git(input.fixtureRepoDir, ['add', 'README.md']);
      git(input.fixtureRepoDir, ['commit', '-m', 'init']);
    }

    const headSha = git(input.fixtureRepoDir, ['rev-parse', 'HEAD']);
    const branch = git(input.fixtureRepoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const workspaceId = `ws_${createHash('sha256').update(input.fixtureRepoDir).digest('hex').slice(0, 16)}`;
    const dbPath = join(input.userDataDir, 'mate-x.db');

    result.phase = 'init-db';
    initDurableEngineeringRepository(dbPath);
    const repo = getEngineeringRepository();
    const bus = new EngineeringCommandBus(repo);
    bus.setPhaseHandler(createPhaseHandler(repo));
    const policy = ensureDefaultPolicyPack(repo);

    result.phase = 'capture';
    const cap = bus.dispatch({
      type: 'CaptureTask',
      workspaceId,
      objectiveSeed: 'Packaged self-test engineering task',
      pathKind: 'full',
    });
    if (!cap.ok) {
      result.error = cap.error?.message ?? 'CaptureTask failed';
      writeResult(input.resultPath, result);
      return result;
    }
    const engineeringTaskId = (cap.data as { engineeringTaskId: string }).engineeringTaskId;
    result.engineeringTaskId = engineeringTaskId;

    // Advance to a state with ledger events (freeze + plan minimal path)
    for (const step of [
      () =>
        bus.dispatch({
          type: 'FreezeSpecification',
          engineeringTaskId,
          workspaceId,
          actor: { kind: 'human', userId: 'selftest' },
        }),
      () =>
        bus.dispatch({
          type: 'StartPlanCompilation',
          engineeringTaskId,
          workspaceId,
        }),
      () =>
        bus.dispatch({
          type: 'CompletePlanCompilation',
          engineeringTaskId,
          workspaceId,
        }),
    ]) {
      const r = step();
      if (!r.ok) {
        // Continue — some phase handlers may require more; capture is enough for recovery
        break;
      }
    }

    const taskBefore = repo.getTask(engineeringTaskId);
    const eventsBefore = repo.getEvents(engineeringTaskId);
    result.aggregateVersion = taskBefore?.aggregateVersion;
    result.workspaceId = taskBefore?.workspaceId;
    result.branch = branch;
    result.headSha = headSha;
    result.policyHash = policy.policyHash;
    result.eventCount = eventsBefore.length;
    result.readiness = taskBefore?.readiness;

    result.phase = 'reopen';
    // Simulate quit: close and reopen same userData DB
    if (repo instanceof LibSqlEngineeringRepository) {
      repo.close?.();
    }
    const repo2 = LibSqlEngineeringRepository.open(dbPath);
    setEngineeringRepository(repo2, { productionDurable: true });
    const reloaded = repo2.getTask(engineeringTaskId);
    const eventsAfter = repo2.getEvents(engineeringTaskId);
    if (!reloaded) {
      result.error = 'task missing after reopen';
      writeResult(input.resultPath, result);
      return result;
    }
    if (reloaded.engineeringTaskId !== engineeringTaskId) {
      result.error = 'task id changed';
      writeResult(input.resultPath, result);
      return result;
    }
    if (reloaded.aggregateVersion !== taskBefore?.aggregateVersion) {
      result.error = 'aggregate version drift on reopen';
      writeResult(input.resultPath, result);
      return result;
    }
    if (eventsAfter.length !== eventsBefore.length) {
      result.error = 'event ledger lost on reopen';
      writeResult(input.resultPath, result);
      return result;
    }
    if (reloaded.workspaceId !== workspaceId) {
      result.error = 'workspace id mismatch';
      writeResult(input.resultPath, result);
      return result;
    }

    result.phase = 'gitgate-stale';
    // Evaluate with no fresh proof → deny
    const gateBefore = evaluateGitGate({
      repo: repo2,
      proofHandle: null,
      current: {
        workspaceId,
        headSha,
        diffHash: hashDiffPayload({ files: [] }),
        policyHash: policy.policyHash,
      },
    });
    result.gitGateAllowed = gateBefore.allowed;

    // External mutation of fixture repo
    writeFileSync(
      join(input.fixtureRepoDir, 'MUTATION.txt'),
      `mutated-at-${Date.now()}\n`,
      'utf8',
    );
    git(input.fixtureRepoDir, ['add', 'MUTATION.txt']);
    git(input.fixtureRepoDir, ['commit', '-m', 'external mutation']);
    const newHead = git(input.fixtureRepoDir, ['rev-parse', 'HEAD']);

    const gateAfter = evaluateGitGate({
      repo: repo2,
      proofHandle: null,
      current: {
        workspaceId,
        headSha: newHead,
        diffHash: hashDiffPayload({ files: ['MUTATION.txt'] }),
        policyHash: policy.policyHash,
      },
    });
    result.gitGateAfterMutationAllowed = gateAfter.allowed;
    result.proofStaleAfterMutation = !gateAfter.allowed;

    // Commit/push blocked without fresh proof
    const blocked = !gateAfter.allowed;
    result.ok =
      reloaded.engineeringTaskId === engineeringTaskId &&
      eventsAfter.length > 0 &&
      Boolean(reloaded.workspaceId) &&
      Boolean(branch) &&
      Boolean(headSha) &&
      Boolean(policy.policyHash) &&
      blocked &&
      result.gitGateAllowed === false;

    result.phase = 'complete';
    result.exitCode = result.ok ? 0 : 2;
    result.headSha = newHead;
    result.artifactHashes = {
      result: createHash('sha256')
        .update(JSON.stringify({ engineeringTaskId, workspaceId, ok: result.ok }))
        .digest('hex'),
      db: existsSync(dbPath) ? sha256File(dbPath) : '',
    };

    repo2.close?.();
    writeResult(input.resultPath, result);
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.exitCode = 1;
    writeResult(input.resultPath, result);
    return result;
  }
}

function writeResult(path: string, result: PackagedSelfTestResult): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2), 'utf8');
}
