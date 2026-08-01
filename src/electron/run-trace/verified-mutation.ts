import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { resolveWorkspacePathSecure } from "../tools/tool-utils";
import {
  verifyFileStructure,
  type StructuralVerification,
} from "../tools/structural-verifier";
import { getActiveAgentExecutionSession } from "./agent-execution-session";
import {
  deleteMutationRecoveryRecord,
  storeMutationRecoveryRecord,
  updateMutationRecoveryRecord,
} from "./mutation-recovery-vault";
import type { MutationRecoveryRecord } from "./mutation-recovery-vault";

type MutationResult =
  | {
      ok: true;
      mutationId: string;
      beforeHash: string;
      afterHash: string;
      verification: StructuralVerification;
      relativePath: string;
    }
  | {
      ok: false;
      mutationId: string;
      code: "CONFLICT" | "VERIFICATION_FAILURE" | "RECOVERY_CONFLICT";
      reason: string;
      reverted: boolean;
      relativePath: string;
    };

const pathLeases = new Map<string, Promise<void>>();

export async function writeVerifiedMutation(input: {
  workspacePath: string;
  targetFile: string;
  beforeExists: boolean;
  beforeContent: string;
  beforeMode: number | null;
  finalContent: string;
  runId?: string;
}): Promise<MutationResult> {
  return withPathLease(input.targetFile, async () => {
    const targetFile = await resolveWorkspacePathSecure(
      input.workspacePath,
      relative(input.workspacePath, input.targetFile),
    );
    const relativePath = relative(input.workspacePath, targetFile);
    const beforeHash = sha256(input.beforeContent);
    const current = await readCurrent(targetFile);
    if (
      current.exists !== input.beforeExists ||
      (current.exists && sha256(current.content) !== beforeHash)
    ) {
      return {
        ok: false,
        mutationId: `mutation-${randomUUID()}`,
        code: "CONFLICT",
        reason: "File changed after it was read. No file was changed.",
        reverted: false,
        relativePath,
      };
    }

    const mutationId = `mutation-${randomUUID()}`;
    const session = getActiveAgentExecutionSession(input.runId);
    const spanId = sha256(`${input.runId ?? "local"}:${mutationId}`).slice(0, 16);
    session?.record({
      kind: "mutation.prepared",
      phase: "execution",
      visibility: "local_diagnostic",
      spanId,
      payload: {
        relativePath,
        beforeHash,
        verifier: "pending",
      },
    });
    const vaultPath = await storeMutationRecoveryRecord({
      version: 1,
      mutationId,
      runId: input.runId ?? "local",
      workspacePath: input.workspacePath,
      relativePath,
      beforeExists: input.beforeExists,
      beforeContent: input.beforeContent,
      beforeMode: input.beforeMode,
      beforeHash,
      afterHash: null,
      state: "prepared",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    });

    if (!input.beforeExists) {
      await mkdir(dirname(targetFile), { recursive: true });
    }
    await atomicWriteFile(
      input.workspacePath,
      targetFile,
      input.finalContent,
      input.beforeMode,
    );
    const written = await readFile(targetFile, "utf8");
    const afterHash = sha256(written);
    await updateMutationRecoveryRecord(vaultPath, {
      afterHash,
      state: "written",
    });

    const verification =
      written === input.finalContent
        ? verifyFileStructure(targetFile, written)
        : {
            status: "failed" as const,
            verifier: "write-integrity",
            reason: "File content after rename did not match the planned mutation.",
          };

    if (verification.status === "failed") {
      const latest = await readCurrent(targetFile);
      if (!latest.exists || sha256(latest.content) !== afterHash) {
        session?.record({
          kind: "recovery.conflict",
          phase: "recovery",
          visibility: "local_diagnostic",
          spanId,
          payload: {
            relativePath,
            beforeHash,
            afterHash,
            verifier: verification.verifier,
            code: "RECOVERY_COMPARE_AND_SWAP_CONFLICT",
          },
        });
        return {
          ok: false,
          mutationId,
          code: "RECOVERY_CONFLICT",
          reason: `${verification.reason} Recovery stopped because the file changed again.`,
          reverted: false,
          relativePath,
        };
      }

      if (input.beforeExists) {
        await atomicWriteFile(
          input.workspacePath,
          targetFile,
          input.beforeContent,
          input.beforeMode,
        );
      } else {
        await rm(targetFile, { force: true });
      }
      session?.record({
        kind: "mutation.reverted",
        phase: "recovery",
        visibility: "local_diagnostic",
        spanId,
        payload: {
          relativePath,
          beforeHash,
          afterHash,
          verifier: verification.verifier,
          code: "STRUCTURAL_POSTCONDITION_FAILED",
        },
      });
      await deleteMutationRecoveryRecord(vaultPath);
      return {
        ok: false,
        mutationId,
        code: "VERIFICATION_FAILURE",
        reason: `${verification.reason} The invalid edit was reverted.`,
        reverted: true,
        relativePath,
      };
    }

    session?.record({
      kind: "mutation.committed",
      phase: "execution",
      visibility: "local_diagnostic",
      spanId,
      payload: {
        relativePath,
        beforeHash,
        afterHash,
        verifier: verification.verifier,
      },
    });
    await updateMutationRecoveryRecord(vaultPath, {
      afterHash,
      state: "committed",
    });
    return {
      ok: true,
      mutationId,
      beforeHash,
      afterHash,
      verification,
      relativePath,
    };
  });
}

export async function reconcileVerifiedMutation(
  record: MutationRecoveryRecord,
): Promise<"no_effect" | "reverted" | "conflict" | "committed"> {
  const targetFile = await resolveWorkspacePathSecure(
    record.workspacePath,
    record.relativePath,
  );
  const current = await readCurrent(targetFile);
  const currentHash = current.exists ? sha256(current.content) : sha256("");

  if (record.state === "committed") return "committed";
  if (record.state === "prepared" && record.afterHash === null) {
    const stillAtBefore =
      current.exists === record.beforeExists &&
      (!current.exists || currentHash === record.beforeHash);
    return stillAtBefore ? "no_effect" : "conflict";
  }
  if (!record.afterHash || !current.exists || currentHash !== record.afterHash) {
    return "conflict";
  }

  if (record.beforeExists) {
    await atomicWriteFile(
      record.workspacePath,
      targetFile,
      record.beforeContent,
      record.beforeMode,
    );
  } else {
    await rm(targetFile, { force: true });
  }
  return "reverted";
}

async function withPathLease<T>(
  targetFile: string,
  operation: () => Promise<T>,
): Promise<T> {
  const prior = pathLeases.get(targetFile) ?? Promise.resolve();
  let release!: () => void;
  const lease = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prior.then(() => lease);
  pathLeases.set(targetFile, queued);
  await prior;
  try {
    return await operation();
  } finally {
    release();
    if (pathLeases.get(targetFile) === queued) pathLeases.delete(targetFile);
  }
}

async function readCurrent(
  targetFile: string,
): Promise<{ exists: true; content: string } | { exists: false; content: "" }> {
  try {
    return { exists: true, content: await readFile(targetFile, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, content: "" };
    }
    throw error;
  }
}

async function atomicWriteFile(
  workspacePath: string,
  targetFile: string,
  content: string,
  mode: number | null,
): Promise<void> {
  const targetDirectory = dirname(targetFile);
  const tempFile = join(
    targetDirectory,
    `.${basename(targetFile)}.matex-${process.pid}-${Date.now()}-${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempFile, "wx", mode ?? 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    if (mode !== null) await chmod(tempFile, mode);
    await resolveWorkspacePathSecure(
      workspacePath,
      relative(workspacePath, targetFile),
    );
    await rename(tempFile, targetFile);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
