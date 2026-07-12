/**
 * Typed ValidationEngine — argv spawn, shell:false, path containment.
 * NES-5.2
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

import type { ValidationCommand, ValidationRun } from '../../contracts/engineering-task';
import { ERR_CODES } from '../../contracts/engineering-task';
import { newNamespacedId, nowIso, sha256Hex } from './ids';

export function validateValidationCommand(
  cmd: Omit<ValidationCommand, 'validationId'> & { validationId?: string },
  workspaceRoot: string,
): { ok: true; command: ValidationCommand } | { ok: false; code: string; message: string } {
  if ((cmd as { shell?: boolean }).shell === true) {
    return {
      ok: false,
      code: ERR_CODES.ERR_VALIDATION_SHELL_FORBIDDEN,
      message: 'shell:true is forbidden in v0.1.2',
    };
  }

  const cwd = path.resolve(cmd.cwd);
  const root = path.resolve(workspaceRoot);
  if (cwd !== root && !cwd.startsWith(root + path.sep)) {
    return {
      ok: false,
      code: ERR_CODES.ERR_TRUST_DENIED,
      message: 'validation cwd outside workspace',
    };
  }

  if (!cmd.executable || typeof cmd.executable !== 'string') {
    return {
      ok: false,
      code: ERR_CODES.ERR_INVARIANT_VIOLATION,
      message: 'executable required',
    };
  }

  if (!Array.isArray(cmd.args) || cmd.args.some((a) => typeof a !== 'string')) {
    return {
      ok: false,
      code: ERR_CODES.ERR_INVARIANT_VIOLATION,
      message: 'args must be string array',
    };
  }

  // Reject shell metacharacters in executable path as fail-closed parsing
  if (/[;&|`$]/.test(cmd.executable)) {
    return {
      ok: false,
      code: ERR_CODES.ERR_VALIDATION_SHELL_FORBIDDEN,
      message: 'executable contains shell metacharacters',
    };
  }

  return {
    ok: true,
    command: {
      validationId: cmd.validationId ?? newNamespacedId('validation'),
      executable: cmd.executable,
      args: cmd.args,
      cwd,
      timeoutMs: cmd.timeoutMs,
      shell: false,
      linkedReqIds: cmd.linkedReqIds ?? [],
      linkedTaskIds: cmd.linkedTaskIds ?? [],
      linkedAcIds: cmd.linkedAcIds ?? [],
    },
  };
}

export async function executeValidation(input: {
  command: ValidationCommand;
  engineeringTaskId: string;
  validationPlanId: string;
  headSha: string;
  diffHash: string;
  policyHash: string;
  workspaceRoot: string;
}): Promise<ValidationRun> {
  const checked = validateValidationCommand(input.command, input.workspaceRoot);
  if (!checked.ok) {
    return {
      validationRunId: newNamespacedId('validation'),
      validationPlanId: input.validationPlanId,
      validationId: input.command.validationId,
      engineeringTaskId: input.engineeringTaskId,
      relatedTaskIds: input.command.linkedTaskIds,
      relatedReqIds: input.command.linkedReqIds,
      executable: input.command.executable,
      args: input.command.args,
      cwd: input.command.cwd,
      startedAt: nowIso(),
      completedAt: nowIso(),
      exitCode: null,
      timedOut: false,
      cancelled: false,
      outputSummary: checked.message,
      headSha: input.headSha,
      diffHash: input.diffHash,
      policyHash: input.policyHash,
      passed: false,
    };
  }

  const cmd = checked.command;
  const startedAt = nowIso();
  const startedMs = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(cmd.executable, cmd.args, {
      cwd: cmd.cwd,
      shell: false,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
      },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref?.();
    }, cmd.timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += String(d).slice(0, 8000);
    });
    child.stderr?.on('data', (d) => {
      stderr += String(d).slice(0, 8000);
    });

    const finish = (exitCode: number | null, cancelled: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const outputSummary = sha256Hex(stdout + stderr).slice(0, 16) +
        ` exit=${exitCode} out=${stdout.slice(0, 200)}`;
      resolve({
        validationRunId: newNamespacedId('validation'),
        validationPlanId: input.validationPlanId,
        validationId: cmd.validationId,
        engineeringTaskId: input.engineeringTaskId,
        relatedTaskIds: cmd.linkedTaskIds,
        relatedReqIds: cmd.linkedReqIds,
        executable: cmd.executable,
        args: cmd.args,
        cwd: cmd.cwd,
        startedAt,
        completedAt: nowIso(),
        exitCode,
        timedOut,
        cancelled,
        outputSummary,
        headSha: input.headSha,
        diffHash: input.diffHash,
        policyHash: input.policyHash,
        passed: !timedOut && !cancelled && exitCode === 0,
      });
      void startedMs;
    };

    child.on('error', (err) => {
      stdout += String(err.message);
      finish(null, false);
    });
    child.on('close', (code) => {
      finish(code, false);
    });
  });
}

export function validationRunUsableForReady(
  run: ValidationRun,
  anchors: { headSha: string; diffHash: string; policyHash: string },
): boolean {
  if (!run.passed) return false;
  if (run.timedOut || run.cancelled) return false;
  if (run.headSha !== anchors.headSha) return false;
  if (run.diffHash !== anchors.diffHash) return false;
  if (run.policyHash !== anchors.policyHash) return false;
  return true;
}
