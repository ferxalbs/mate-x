import { app, safeStorage } from "electron";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface MutationRecoveryRecord {
  version: 1;
  mutationId: string;
  runId: string;
  workspacePath: string;
  relativePath: string;
  beforeExists: boolean;
  beforeContent: string;
  beforeMode: number | null;
  beforeHash: string;
  afterHash: string | null;
  state: "prepared" | "written" | "committed";
  createdAt: string;
  expiresAt: string;
}

export async function storeMutationRecoveryRecord(
  record: MutationRecoveryRecord,
): Promise<string> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure local storage is unavailable; mutation was not started.");
  }
  const directory = mutationVaultDirectory(record.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `${safeFilePart(record.mutationId)}.bin`);
  const temporary = `${target}.tmp`;
  const encrypted = safeStorage.encryptString(JSON.stringify(record));
  await writeFile(temporary, encrypted, { mode: 0o600 });
  await rename(temporary, target);
  return target;
}

export async function updateMutationRecoveryRecord(
  vaultPath: string,
  update: Pick<MutationRecoveryRecord, "afterHash" | "state">,
): Promise<void> {
  const record = await readMutationRecoveryRecord(vaultPath);
  await storeMutationRecoveryRecord({ ...record, ...update });
}

export async function readMutationRecoveryRecord(
  vaultPath: string,
): Promise<MutationRecoveryRecord> {
  const encrypted = await readFile(vaultPath);
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure local storage is unavailable.");
  }
  return JSON.parse(
    safeStorage.decryptString(encrypted),
  ) as MutationRecoveryRecord;
}

export async function deleteMutationRecoveryRecord(vaultPath: string): Promise<void> {
  await rm(vaultPath, { force: true });
  await rm(dirname(vaultPath), { recursive: false }).catch(() => undefined);
}

export function mutationVaultRoot(): string {
  return join(app.getPath("userData"), "mutation-recovery");
}

export async function listMutationRecoveryRecordPaths(): Promise<string[]> {
  const root = mutationVaultRoot();
  let runDirectories: string[];
  try {
    runDirectories = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const paths: string[] = [];
  for (const directory of runDirectories) {
    const absoluteDirectory = join(root, directory);
    let files: string[];
    try {
      files = await readdir(absoluteDirectory);
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith(".bin")) paths.push(join(absoluteDirectory, file));
    }
  }
  return paths;
}

function mutationVaultDirectory(runId: string): string {
  return join(mutationVaultRoot(), safeFilePart(runId));
}

function safeFilePart(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 180);
}
