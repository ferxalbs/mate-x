import type {
  ProofCapsule,
  ProofChangedFile,
  ProofClaim,
  ProofCommandEvidence,
  ProofFinding,
  ProofInput,
  ProofRisk,
  ProofSecretFinding,
  ProofVerdict,
} from './types';

const lockfilePattern = /(^|\/)(bun\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|go\.sum)$/i;
const dependencyManifestPattern = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|requirements.*\.txt|Gemfile|go\.mod|pom\.xml|build\.gradle|composer\.json)$/i;
const workflowPattern = /^\.github\/workflows\/.+\.ya?ml$/i;
const authPattern = /(^|\/)(auth|session|security|permissions?|oauth|jwt|crypto|password|login|signin|token)(\/|\.|-|_)?/i;
const configPattern = /(^|\/)(\.env|env\.|config|settings|secrets?|credentials?|\.npmrc|\.pypirc|docker-compose|Dockerfile)(\/|\.|-|_)?/i;
const migrationPattern = /(^|\/)(migrations?|schema|prisma)(\/|\.|-|_)?/i;
const paymentPattern = /(^|\/)(payment|billing|stripe|checkout|invoice|subscription)(\/|\.|-|_)?/i;
const infraPattern = /(^|\/)(infra|deploy|terraform|pulumi|k8s|helm|vercel|netlify|cloudflare|docker|compose|serverless)(\/|\.|-|_)?/i;
const testPattern = /(^|\/)(__tests__|tests?|specs?)(\/|$)|(\.test|\.spec)\.[cm]?[tj]sx?$/i;
const testClaimPattern = /(test|typecheck|lint|ci|build).{0,40}(pass|passed|green|success|ok|clean)/i;
const commandEvidencePattern = /\b(bun|npm|pnpm|yarn|cargo|go|pytest|vitest|jest|tsc|eslint|make)\b[^\n]*(test|typecheck|lint|build|check|ci)/i;
const secretPattern = /\b(ghp|github_pat|sk_live|sk_test|xox[baprs]|AKIA|ASIA)[A-Za-z0-9_=-]{12,}\b|(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?([A-Za-z0-9_./+=-]{16,})/gi;

function riskRank(risk: ProofRisk) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[risk];
}

function maxRisk(risks: ProofRisk[]): ProofRisk {
  return risks.reduce((max, risk) => (riskRank(risk) > riskRank(max) ? risk : max), 'low' as ProofRisk);
}

function finding(path: string, reason: string, severity: ProofRisk): ProofFinding {
  return { path, reason, severity };
}

function compactSha(value?: string) {
  return value ? value.slice(0, 12) : undefined;
}

function makeId(input: ProofInput, createdAt: string) {
  const repo = input.repo ? `${input.repo.owner}-${input.repo.name}` : input.sourceType;
  const pr = input.prNumber ? `pr-${input.prNumber}` : 'manual';
  return `${repo}-${pr}-${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`.toLowerCase();
}

export function redactSecretPreview(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '[redacted]';
  return `${trimmed.slice(0, 4)}...[redacted]...${trimmed.slice(-4)}`;
}

export function detectSecretLikeStrings(files: ProofChangedFile[], extraText = ''): ProofSecretFinding[] {
  const findings: ProofSecretFinding[] = [];
  const scan = (text: string, path?: string) => {
    for (const match of text.matchAll(secretPattern)) {
      const raw = match[1] ?? match[0];
      findings.push({
        path,
        kind: 'secret-like-string',
        redactedPreview: redactSecretPreview(raw),
        severity: 'critical',
      });
    }
  };

  for (const file of files) scan(file.patch ?? '', file.path);
  scan(extraText);
  return findings;
}

export function detectRiskyPaths(files: ProofChangedFile[]) {
  const detectedSensitiveFiles: ProofFinding[] = [];
  const detectedRiskyPaths: ProofFinding[] = [];
  const detectedDependencyChanges: ProofFinding[] = [];
  const detectedWorkflowChanges: ProofFinding[] = [];

  for (const file of files) {
    const path = file.path;
    if (workflowPattern.test(path)) detectedWorkflowChanges.push(finding(path, 'GitHub Actions workflow changed', 'high'));
    if (lockfilePattern.test(path)) detectedDependencyChanges.push(finding(path, 'Package manager lockfile changed', 'medium'));
    if (dependencyManifestPattern.test(path)) detectedDependencyChanges.push(finding(path, 'Dependency manifest changed', 'medium'));
    if (authPattern.test(path)) detectedSensitiveFiles.push(finding(path, 'Auth/session/security surface changed', 'high'));
    if (configPattern.test(path)) detectedSensitiveFiles.push(finding(path, 'Environment or configuration surface changed', 'high'));
    if (migrationPattern.test(path)) detectedRiskyPaths.push(finding(path, 'Database migration or schema surface changed', 'high'));
    if (paymentPattern.test(path)) detectedRiskyPaths.push(finding(path, 'Payment or billing surface changed', 'critical'));
    if (infraPattern.test(path)) detectedRiskyPaths.push(finding(path, 'Infrastructure or deployment surface changed', 'high'));
    if (file.status === 'removed' && testPattern.test(path)) detectedRiskyPaths.push(finding(path, 'Test file deleted', 'high'));
  }

  const churn = files.reduce((sum, file) => sum + (file.additions ?? 0) + (file.deletions ?? 0), 0);
  if (churn >= 800) {
    detectedRiskyPaths.push({ reason: `Large file churn detected (${churn} changed lines)`, severity: 'medium' });
  }

  return { detectedSensitiveFiles, detectedRiskyPaths, detectedDependencyChanges, detectedWorkflowChanges };
}

export function extractAgentClaims(text = ''): ProofClaim[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => testClaimPattern.test(line))
    .map((text) => ({ text, type: 'test-claim', supported: false }));
}

export function extractCommandEvidence(text = ''): ProofCommandEvidence[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => commandEvidencePattern.test(line))
    .map((text) => ({
      text,
      command: text.match(commandEvidencePattern)?.[0],
      passed: !/(fail|failed|error|exit code [1-9])/i.test(text),
    }));
}

function verdictFor(risk: ProofRisk, missingEvidence: string[], hasFetchError: boolean): ProofVerdict {
  if (hasFetchError) return 'incomplete';
  if (risk === 'critical') return 'blocked';
  if (missingEvidence.length > 0) return risk === 'low' ? 'incomplete' : 'risky';
  if (risk === 'high') return 'risky';
  return 'passed';
}

function nextAction(verdict: ProofVerdict) {
  if (verdict === 'passed') return 'Safe to merge after normal reviewer approval.';
  if (verdict === 'blocked') return 'Do not merge. Review critical findings and add verifiable command evidence.';
  if (verdict === 'failed') return 'Fix failing evidence, regenerate proof, then retry review.';
  if (verdict === 'incomplete') return 'Add PR diff and command output, then regenerate proof.';
  return 'Require human review for risky surfaces and attach command evidence before merge.';
}

export function generateProofCapsule(input: ProofInput, now = new Date()): ProofCapsule {
  const createdAt = now.toISOString();
  const changedFiles = input.changedFiles.map((file) => ({ ...file, patch: file.patch ? file.patch.replace(secretPattern, '[redacted-secret]') : undefined }));
  const totals = changedFiles.reduce(
    (sum, file) => ({ additions: sum.additions + (file.additions ?? 0), deletions: sum.deletions + (file.deletions ?? 0) }),
    { additions: 0, deletions: 0 },
  );
  const textEvidence = [input.transcript, input.ciOutput, input.manualNotes].filter(Boolean).join('\n');
  const pathFindings = detectRiskyPaths(changedFiles);
  const secretFindings = detectSecretLikeStrings(input.changedFiles, textEvidence);
  const commandEvidence = extractCommandEvidence([input.ciOutput, input.manualNotes].filter(Boolean).join('\n'));
  const claims = extractAgentClaims(input.transcript);
  const hasTestEvidence = commandEvidence.some((evidence) => evidence.passed !== false);

  for (const claim of claims) claim.supported = hasTestEvidence;

  const missingEvidence: string[] = [];
  if (!hasTestEvidence) missingEvidence.push('No pasted command/test evidence.');
  if (claims.some((claim) => !claim.supported)) missingEvidence.push('Agent claims tests passed, but no command evidence was pasted.');
  if (input.fetchError) missingEvidence.push('GitHub PR data could not be fetched; manual diff/log evidence required.');

  const risks = [
    ...pathFindings.detectedSensitiveFiles,
    ...pathFindings.detectedRiskyPaths,
    ...pathFindings.detectedDependencyChanges,
    ...pathFindings.detectedWorkflowChanges,
    ...secretFindings,
  ].map((item) => item.severity);
  const riskLevel = maxRisk(risks.length > 0 ? risks : ['low']);
  const finalVerdict = verdictFor(riskLevel, missingEvidence, Boolean(input.fetchError));
  const evidenceSummary = [
    `${changedFiles.length} changed files analyzed.`,
    totals.additions || totals.deletions ? `${totals.additions} additions and ${totals.deletions} deletions reported.` : 'Line churn unavailable.',
    hasTestEvidence ? 'Command/test evidence pasted.' : 'No command/test evidence pasted.',
    input.headSha ? `Head ${compactSha(input.headSha)}.` : 'Head SHA unavailable.',
  ];

  return {
    id: makeId(input, createdAt),
    createdAt,
    workspaceId: input.workspaceId ?? 'demo-workspace',
    projectId: input.projectId ?? input.workspaceId ?? 'demo-project',
    repositoryId: input.repositoryId ?? (input.repo ? `${input.repo.owner}/${input.repo.name}` : 'manual-repository'),
    createdByUserId: input.createdByUserId ?? 'local-demo-user',
    visibility: input.visibility ?? (input.sourceType === 'demo' ? 'public-demo' : 'workspace'),
    planSnapshot: input.planSnapshot ?? {
      planId: 'local',
      proofModeEnabled: true,
      privateCapsules: false,
      monthlyLimit: 25,
      githubChecksEnabled: false,
    },
    sourceIntegration: input.sourceIntegration ?? {
      provider: input.sourceType === 'github-pr' ? 'github' : input.sourceType,
      mode: input.sourceType === 'demo' ? 'demo-local' : 'manual',
      installationState: input.sourceType === 'demo' ? 'not_required' : 'not_configured',
    },
    sourceAgent: input.sourceAgent,
    runArtifactId: input.runArtifactId,
    evidencePackId: input.evidencePackId,
    privacyPreflightResult: input.privacyPreflightResult ?? {
      status: secretFindings.length > 0 ? 'redacted' : 'passed',
      redactedCount: secretFindings.length,
    },
    validationStatus: input.validationStatus ?? (hasTestEvidence ? 'passed' : 'missing_evidence'),
    sourceType: input.sourceType,
    repo: input.repo,
    prNumber: input.prNumber,
    prTitle: input.prTitle,
    headSha: input.headSha,
    baseSha: input.baseSha,
    changedFiles,
    additions: totals.additions || undefined,
    deletions: totals.deletions || undefined,
    ...pathFindings,
    detectedSecretLikeStrings: secretFindings,
    pastedAgentClaims: claims,
    pastedCommandTestEvidence: commandEvidence,
    finalVerdict,
    riskLevel,
    evidenceSummary,
    missingEvidence,
    redactions: secretFindings,
    auditTrail: [
      {
        at: createdAt,
        actor: input.createdByUserId ?? 'local-demo-user',
        action: 'proof.capsule.generated',
        detail: input.sourceType,
      },
    ],
    recommendedNextAction: nextAction(finalVerdict),
    fetchError: input.fetchError,
  };
}
