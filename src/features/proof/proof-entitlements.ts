export interface ProofEntitlement {
  proofMode: {
    enabled: boolean;
  };
  proofCapsules: {
    private: boolean;
    monthlyLimit: number;
  };
  githubChecks: {
    enabled: boolean;
  };
}

export const LOCAL_ALPHA_PROOF_ENTITLEMENT: ProofEntitlement = {
  proofMode: { enabled: true },
  proofCapsules: { private: false, monthlyLimit: 25 },
  githubChecks: { enabled: false },
};

export function getProofEntitlementForWorkspace(workspaceId: string | null): ProofEntitlement {
  if (!workspaceId) {
    return {
      proofMode: { enabled: false },
      proofCapsules: { private: false, monthlyLimit: 0 },
      githubChecks: { enabled: false },
    };
  }

  return LOCAL_ALPHA_PROOF_ENTITLEMENT;
}
