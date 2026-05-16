export interface SecurityClaim {
  wording: string;
  source?: string;
  path?: string;
  sink?: string;
  mitigation?: string;
  exploitability?: string;
  evidence?: string;
}

export function canConfirmVulnerability(claim: SecurityClaim) {
  return Boolean(
    claim.source &&
      claim.path &&
      claim.sink &&
      claim.mitigation &&
      claim.exploitability &&
      claim.evidence,
  );
}

export function normalizeSecurityWording(claim: SecurityClaim) {
  if (canConfirmVulnerability(claim)) {
    return claim.wording;
  }

  return claim.wording
    .replace(/\bconfirmed\s+vulnerability\b/gi, "candidate issue")
    .replace(/\bvulnerability\b/gi, "candidate")
    .replace(/\bexploit\b/gi, "potential exploit path");
}

export function buildSecurityProofRules() {
  return [
    "Before proof, use: candidate, suspicious surface, needs validation, potential issue.",
    "Confirmed vulnerability wording requires source, transform/path, sink, weak/missing mitigation, exploitability condition, and affected file/line evidence.",
    "Use attack_surface_scan, candidate_revalidator, security_path_trace, evidence_pack, and sandbox_run when needed.",
  ];
}
