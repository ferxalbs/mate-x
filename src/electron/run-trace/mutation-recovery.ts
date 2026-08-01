import {
  deleteMutationRecoveryRecord,
  listMutationRecoveryRecordPaths,
  readMutationRecoveryRecord,
} from "./mutation-recovery-vault";
import { reconcileVerifiedMutation } from "./verified-mutation";

export interface MutationRecoverySummary {
  inspected: number;
  reverted: number;
  noEffect: number;
  expired: number;
  conflicts: Array<{ mutationId: string; relativePath: string }>;
  failed: number;
}

export async function reconcileMutationRecoveryVault(
  now = new Date(),
): Promise<MutationRecoverySummary> {
  const summary: MutationRecoverySummary = {
    inspected: 0,
    reverted: 0,
    noEffect: 0,
    expired: 0,
    conflicts: [],
    failed: 0,
  };
  const paths = await listMutationRecoveryRecordPaths();
  for (const vaultPath of paths) {
    summary.inspected++;
    try {
      const record = await readMutationRecoveryRecord(vaultPath);
      if (record.state === "committed") {
        if (record.expiresAt <= now.toISOString()) {
          await deleteMutationRecoveryRecord(vaultPath);
          summary.expired++;
        }
        continue;
      }
      const result = await reconcileVerifiedMutation(record);
      if (result === "reverted") {
        await deleteMutationRecoveryRecord(vaultPath);
        summary.reverted++;
      } else if (result === "no_effect") {
        await deleteMutationRecoveryRecord(vaultPath);
        summary.noEffect++;
      } else if (result === "conflict") {
        summary.conflicts.push({
          mutationId: record.mutationId,
          relativePath: record.relativePath,
        });
      }
    } catch (error) {
      summary.failed++;
      console.warn(
        "Mutation recovery record could not be reconciled safely:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return summary;
}

