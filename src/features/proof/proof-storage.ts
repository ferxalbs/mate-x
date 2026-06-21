import type { ProofCapsule } from "../../../packages/proof-core/src";

export type ProofStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "session_required" | "workspace_required" | "not_found"; message: string };

export interface ProofStorageAdapter {
  saveCapsule(capsule: ProofCapsule): Promise<ProofStorageResult<ProofCapsule>>;
  listCapsules(workspaceId: string): Promise<ProofStorageResult<ProofCapsule[]>>;
  getCapsule(workspaceId: string, capsuleId: string): Promise<ProofStorageResult<ProofCapsule>>;
}

const capsulesByWorkspace = new Map<string, ProofCapsule[]>();

export const serverProofStorageAdapter: ProofStorageAdapter = {
  async saveCapsule(capsule) {
    if (!capsule.createdByUserId) return fail("session_required", "MaTE X session required.");
    if (!capsule.workspaceId) return fail("workspace_required", "Workspace required.");

    const current = capsulesByWorkspace.get(capsule.workspaceId) ?? [];
    const next = [capsule, ...current.filter((item) => item.id !== capsule.id)];
    capsulesByWorkspace.set(capsule.workspaceId, next);
    return { ok: true, value: capsule };
  },
  async listCapsules(workspaceId) {
    if (!workspaceId) return fail("workspace_required", "Workspace required.");
    return { ok: true, value: capsulesByWorkspace.get(workspaceId) ?? [] };
  },
  async getCapsule(workspaceId, capsuleId) {
    const capsule = (capsulesByWorkspace.get(workspaceId) ?? []).find((item) => item.id === capsuleId);
    return capsule ? { ok: true, value: capsule } : fail("not_found", "Proof Capsule not found.");
  },
};

export const demoLocalProofStorageAdapter: ProofStorageAdapter = {
  async saveCapsule(capsule) {
    window.localStorage.setItem(`matex-proof-demo:${capsule.id}`, JSON.stringify(capsule));
    return { ok: true, value: capsule };
  },
  async listCapsules() {
    return { ok: true, value: [] };
  },
  async getCapsule(_workspaceId, capsuleId) {
    const raw = window.localStorage.getItem(`matex-proof-demo:${capsuleId}`);
    return raw ? { ok: true, value: JSON.parse(raw) as ProofCapsule } : fail("not_found", "Demo capsule not found.");
  },
};

function fail<T>(reason: Exclude<ProofStorageResult<T>, { ok: true }>["reason"], message: string): ProofStorageResult<T> {
  return { ok: false, reason, message };
}
