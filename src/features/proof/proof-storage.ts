import type { ProofCapsule } from "../../../packages/proof-core/src";

export type ProofStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "session_required" | "workspace_required" | "not_found"; message: string };

export interface ProofStorageAdapter {
  saveCapsule(capsule: ProofCapsule): Promise<ProofStorageResult<ProofCapsule>>;
  listCapsules(workspaceId: string): Promise<ProofStorageResult<ProofCapsule[]>>;
  getCapsule(workspaceId: string, capsuleId: string): Promise<ProofStorageResult<ProofCapsule>>;
}

export const serverProofStorageAdapter: ProofStorageAdapter = {
  async saveCapsule(capsule) {
    if (!capsule.createdByUserId) return fail("session_required", "MaTE X session required.");
    if (!capsule.workspaceId) return fail("workspace_required", "Workspace required.");
    const result = await window.mate.proof.saveCapsule(capsule);
    return result.ok && result.value ? { ok: true, value: result.value } : fail("not_found", result.message ?? "Could not save Proof Capsule.");
  },
  async listCapsules(workspaceId) {
    if (!workspaceId) return fail("workspace_required", "Workspace required.");
    const result = await window.mate.proof.listCapsules(workspaceId);
    return result.ok && result.value ? { ok: true, value: result.value } : fail("not_found", result.message ?? "Could not list Proof Capsules.");
  },
  async getCapsule(workspaceId, capsuleId) {
    const result = await window.mate.proof.getCapsule(workspaceId, capsuleId);
    return result.ok && result.value ? { ok: true, value: result.value } : fail("not_found", result.message ?? "Proof Capsule not found.");
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
