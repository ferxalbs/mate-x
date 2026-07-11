/**
 * PolicyPack v0 — versioned structured rules + hash.
 * NES-2.1
 */

import type { PolicyPack, PolicyRule } from '../../contracts/engineering-task';
import { newNamespacedId, nowIso, sha256Hex } from './ids';
import type { EngineeringRepository } from './repository';

export const DEFAULT_POLICY_PACK_VERSION = '0';

export function defaultPolicyRules(): PolicyRule[] {
  return [
    {
      ruleId: 'MUST-no-prompt-as-spec',
      severity: 'MUST',
      statement: 'Raw user prompt is never an approved specification',
      category: 'intent',
    },
    {
      ruleId: 'MUST-validation-before-ready',
      severity: 'MUST',
      statement: 'Ready requires validation evidence on current anchors',
      category: 'validation',
    },
    {
      ruleId: 'MUST-proof-before-git',
      severity: 'MUST',
      statement: 'Git write operations require a fresh Ship Proof handle',
      category: 'git',
    },
    {
      ruleId: 'MUST-serial-mutation',
      severity: 'MUST',
      statement: 'Only one mutating execution per workspace in v0.1.2',
      category: 'execution',
    },
    {
      ruleId: 'SHOULD-link-req-to-tasks',
      severity: 'SHOULD',
      statement: 'Every active requirement should map to at least one task',
      category: 'traceability',
    },
    {
      ruleId: 'MAY-model-assist',
      severity: 'MAY',
      statement: 'Model assist may draft specs and plans; never authorizes gates',
      category: 'agent',
    },
  ];
}

export function computePolicyHash(rules: PolicyRule[], version: string): string {
  return sha256Hex(JSON.stringify({ version, rules }));
}

export function createDefaultPolicyPack(): PolicyPack {
  const rules = defaultPolicyRules();
  const version = DEFAULT_POLICY_PACK_VERSION;
  return {
    policyPackId: newNamespacedId('policyPack'),
    version,
    policyHash: computePolicyHash(rules, version),
    rules,
    source: 'default',
    createdAt: nowIso(),
  };
}

export function ensureDefaultPolicyPack(repo: EngineeringRepository): PolicyPack {
  const existing = repo.getPolicyPack('pol_default_v0', DEFAULT_POLICY_PACK_VERSION);
  if (existing) return existing;

  const pack = createDefaultPolicyPack();
  const stable: PolicyPack = {
    ...pack,
    policyPackId: 'pol_default_v0',
    policyHash: computePolicyHash(pack.rules, pack.version),
  };
  repo.savePolicyPack(stable);
  return stable;
}

export function importPolicyProposalFromMarkdown(
  markdown: string,
  prior: PolicyPack | null,
): { proposal: PolicyPack; requiresDecision: true } {
  const rules = [...(prior?.rules ?? defaultPolicyRules())];
  // Markdown is untrusted proposal only — extract MUST/SHOULD lines as candidates
  for (const line of markdown.split('\n')) {
    const m = /^\s*[-*]\s*(MUST|SHOULD|MAY)\s*[:—-]\s*(.+)$/i.exec(line);
    if (!m) continue;
    const severity = m[1]!.toUpperCase() as PolicyRule['severity'];
    rules.push({
      ruleId: `import-${sha256Hex(m[2]!).slice(0, 8)}`,
      severity,
      statement: m[2]!.trim(),
      category: 'imported',
    });
  }
  const version = String(Number(prior?.version ?? '0') + 1);
  const proposal: PolicyPack = {
    policyPackId: prior?.policyPackId ?? newNamespacedId('policyPack'),
    version,
    policyHash: computePolicyHash(rules, version),
    rules,
    source: 'import',
    createdAt: nowIso(),
  };
  return { proposal, requiresDecision: true };
}

export function applyPolicyAmendment(
  repo: EngineeringRepository,
  pack: PolicyPack,
  decisionId: string,
): PolicyPack {
  if (!decisionId) {
    throw new Error('Policy amendment requires Decision id');
  }
  repo.savePolicyPack(pack);
  return pack;
}

export function evaluateMustBlocks(
  pack: PolicyPack,
  context: { phase: string },
): { blocked: boolean; violated: PolicyRule[] } {
  void context;
  // v0: structural MUST rules are enforced by control plane code paths,
  // not by interpreting free-text rule statements as executable law.
  return { blocked: false, violated: [] };
}
