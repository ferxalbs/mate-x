import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

import type { ProofCapsule } from "../../packages/proof-core/src";

export type ProofStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "workspace_required" | "not_found" | "error"; message: string };

interface ProofStoreFile {
  capsulesByWorkspace: Record<string, ProofCapsule[]>;
}

export async function saveProofCapsule(capsule: ProofCapsule): Promise<ProofStoreResult<ProofCapsule>> {
  if (!capsule.workspaceId) return fail("workspace_required", "Workspace required.");
  const store = await readStore();
  const current = store.capsulesByWorkspace[capsule.workspaceId] ?? [];
  store.capsulesByWorkspace[capsule.workspaceId] = [capsule, ...current.filter((item) => item.id !== capsule.id)];
  await writeStore(store);
  return { ok: true, value: capsule };
}

export async function listProofCapsules(workspaceId: string): Promise<ProofStoreResult<ProofCapsule[]>> {
  if (!workspaceId) return fail("workspace_required", "Workspace required.");
  const store = await readStore();
  return { ok: true, value: store.capsulesByWorkspace[workspaceId] ?? [] };
}

export async function getProofCapsule(workspaceId: string, capsuleId: string): Promise<ProofStoreResult<ProofCapsule>> {
  const store = await readStore();
  const capsule = (store.capsulesByWorkspace[workspaceId] ?? []).find((item) => item.id === capsuleId);
  return capsule ? { ok: true, value: capsule } : fail("not_found", "Proof Capsule not found.");
}

async function readStore(): Promise<ProofStoreFile> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProofStoreFile>;
    return { capsulesByWorkspace: parsed.capsulesByWorkspace ?? {} };
  } catch {
    return { capsulesByWorkspace: {} };
  }
}

async function writeStore(store: ProofStoreFile) {
  const file = storePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2), "utf8");
}

function storePath() {
  return join(app.getPath("userData"), "matex-proof-capsules.json");
}

function fail<T>(reason: Exclude<ProofStoreResult<T>, { ok: true }>["reason"], message: string): ProofStoreResult<T> {
  return { ok: false, reason, message };
}
