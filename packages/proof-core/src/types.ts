export type ProofVerdict = 'passed' | 'risky' | 'blocked' | 'incomplete' | 'failed';
export type ProofRisk = 'low' | 'medium' | 'high' | 'critical';
export type ProofSourceType = 'github-pr' | 'manual' | 'demo';
export type ProofVisibility = 'workspace' | 'private' | 'public-demo';
export type ProofValidationStatus = 'not_run' | 'passed' | 'failed' | 'missing_evidence';

export interface ProofRepoRef {
  owner: string;
  name: string;
}

export interface ProofChangedFile {
  path: string;
  additions?: number;
  deletions?: number;
  status?: string;
  patch?: string;
}

export interface ProofFinding {
  path?: string;
  reason: string;
  severity: ProofRisk;
}

export interface ProofSecretFinding {
  path?: string;
  kind: string;
  redactedPreview: string;
  severity: 'critical';
}

export interface ProofClaim {
  text: string;
  type: 'test-claim' | 'general-claim';
  supported: boolean;
}

export interface ProofCommandEvidence {
  command?: string;
  text: string;
  passed?: boolean;
}

export interface ProofInput {
  sourceType: ProofSourceType;
  workspaceId?: string;
  projectId?: string;
  repositoryId?: string;
  createdByUserId?: string;
  visibility?: ProofVisibility;
  planSnapshot?: ProofPlanSnapshot;
  sourceIntegration?: ProofSourceIntegration;
  sourceAgent?: ProofSourceAgent;
  runArtifactId?: string;
  evidencePackId?: string;
  privacyPreflightResult?: ProofPrivacyPreflightResult;
  validationStatus?: ProofValidationStatus;
  repo?: ProofRepoRef;
  prNumber?: number;
  prTitle?: string;
  headSha?: string;
  baseSha?: string;
  changedFiles: ProofChangedFile[];
  transcript?: string;
  ciOutput?: string;
  manualNotes?: string;
  fetchError?: string;
}

export interface ProofPlanSnapshot {
  planId: string;
  proofModeEnabled: boolean;
  privateCapsules: boolean;
  monthlyLimit: number;
  githubChecksEnabled: boolean;
}

export interface ProofSourceIntegration {
  provider: 'github' | 'git-local' | 'manual' | 'demo';
  mode: 'matex-server' | 'matex-local' | 'github-app' | 'demo-local' | 'manual';
  installationState: 'connected' | 'not_configured' | 'local_only' | 'not_required';
}

export interface ProofSourceAgent {
  name: string;
  runId?: string;
}

export interface ProofPrivacyPreflightResult {
  status: 'passed' | 'redacted' | 'blocked';
  redactedCount: number;
}

export interface ProofAuditEvent {
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

export interface ProofCapsule {
  id: string;
  createdAt: string;
  workspaceId: string;
  projectId: string;
  repositoryId: string;
  createdByUserId: string;
  visibility: ProofVisibility;
  planSnapshot: ProofPlanSnapshot;
  sourceIntegration: ProofSourceIntegration;
  sourceAgent?: ProofSourceAgent;
  runArtifactId?: string;
  evidencePackId?: string;
  privacyPreflightResult: ProofPrivacyPreflightResult;
  validationStatus: ProofValidationStatus;
  sourceType: ProofSourceType;
  repo?: ProofRepoRef;
  prNumber?: number;
  prTitle?: string;
  headSha?: string;
  baseSha?: string;
  changedFiles: ProofChangedFile[];
  additions?: number;
  deletions?: number;
  detectedSensitiveFiles: ProofFinding[];
  detectedRiskyPaths: ProofFinding[];
  detectedDependencyChanges: ProofFinding[];
  detectedWorkflowChanges: ProofFinding[];
  detectedSecretLikeStrings: ProofSecretFinding[];
  pastedAgentClaims: ProofClaim[];
  pastedCommandTestEvidence: ProofCommandEvidence[];
  finalVerdict: ProofVerdict;
  riskLevel: ProofRisk;
  evidenceSummary: string[];
  missingEvidence: string[];
  redactions: ProofSecretFinding[];
  auditTrail: ProofAuditEvent[];
  recommendedNextAction: string;
  fetchError?: string;
}
