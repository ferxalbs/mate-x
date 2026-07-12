/**
 * Intent compiler — seed → draft Specification → freeze checklist.
 * NES-2.2. Prompt alone never becomes specified.
 */

import type {
  QualityChecklistItem,
  SpecificationDocument,
} from '../../contracts/engineering-task';
import { formatDisplayId } from '../../contracts/engineering-task';
import { newNamespacedId, nowIso, sha256Hex } from './ids';

export function buildQualityChecklist(spec: {
  objective: string;
  inScope: string[];
  nonGoals: string[];
  functionalRequirements: { statement: string }[];
  acceptanceScenarios: { statement: string }[];
  unresolvedQuestions: { critical: boolean }[];
  verifyOnly: boolean;
}): { passed: boolean; items: QualityChecklistItem[] } {
  const items: QualityChecklistItem[] = [
    {
      id: 'obj',
      label: 'Objective is non-empty and specific',
      passed: spec.objective.trim().length >= 8,
      required: true,
    },
    {
      id: 'scope',
      label: 'In-scope items listed',
      passed: spec.verifyOnly || spec.inScope.length > 0,
      required: !spec.verifyOnly,
    },
    {
      id: 'nongoals',
      label: 'Non-goals listed (or verify-only)',
      passed: spec.verifyOnly || spec.nonGoals.length > 0,
      required: !spec.verifyOnly,
    },
    {
      id: 'reqs',
      label: 'At least one functional requirement',
      passed: spec.verifyOnly || spec.functionalRequirements.length > 0,
      required: !spec.verifyOnly,
    },
    {
      id: 'ac',
      label: 'At least one acceptance criterion',
      passed: spec.verifyOnly || spec.acceptanceScenarios.length > 0,
      required: !spec.verifyOnly,
    },
    {
      id: 'critical-q',
      label: 'No unresolved critical questions',
      passed: !spec.unresolvedQuestions.some((q) => q.critical),
      required: true,
    },
  ];
  const passed = items.every((i) => !i.required || i.passed);
  return { passed, items };
}

export function draftSpecificationFromSeed(input: {
  objectiveSeed: string;
  verifyOnly?: boolean;
  version?: number;
}): SpecificationDocument {
  const objective = input.objectiveSeed.trim();
  const verifyOnly = Boolean(input.verifyOnly);
  const version = input.version ?? 1;

  const functionalRequirements = verifyOnly
    ? []
    : [
        {
          reqId: formatDisplayId('REQ', 1),
          statement: `System satisfies: ${objective.slice(0, 200)}`,
          priority: 'P0' as const,
          status: 'draft' as const,
        },
      ];

  const acceptanceScenarios = verifyOnly
    ? [
        {
          acId: formatDisplayId('AC', 1),
          statement: 'Verification commands pass on current workspace anchors',
          verificationMethod: 'test' as const,
          linkedReqIds: [] as string[],
        },
      ]
    : [
        {
          acId: formatDisplayId('AC', 1),
          statement: 'Acceptance: objective is met with validation evidence',
          verificationMethod: 'test' as const,
          linkedReqIds: [formatDisplayId('REQ', 1)],
        },
      ];

  const base = {
    objective,
    inScope: verifyOnly ? ['Verification of current changes'] : ['Implement objective'],
    nonGoals: verifyOnly ? ['Feature expansion beyond verification'] : ['Unrelated refactors'],
    functionalRequirements,
    acceptanceScenarios,
    unresolvedQuestions: [] as Array<{ id: string; question: string; critical: boolean }>,
    verifyOnly,
  };

  const qualityChecklist = buildQualityChecklist(base);
  const doc: SpecificationDocument = {
    specificationId: newNamespacedId('specification'),
    version,
    objective,
    problemStatement: objective,
    actors: [{ id: 'user', name: 'Engineer', role: 'requester' }],
    currentBehavior: '',
    desiredBehavior: objective,
    userValue: '',
    inScope: base.inScope,
    nonGoals: base.nonGoals,
    functionalRequirements,
    nonFunctionalRequirements: [],
    acceptanceScenarios,
    edgeCases: [],
    assumptions: [],
    dependencies: [],
    constraints: [],
    successCriteria: verifyOnly
      ? []
      : [
          {
            scId: formatDisplayId('SC', 1),
            statement: 'Objective complete with proof',
            measurable: true,
          },
        ],
    unresolvedQuestions: base.unresolvedQuestions,
    qualityChecklist,
    clarificationDecisions: [],
    approvalIdentity: null,
    verifyOnly,
    contentHash: '',
    createdAt: nowIso(),
    frozenAt: null,
  };
  doc.contentHash = hashSpecification(doc);
  return doc;
}

export function hashSpecification(doc: SpecificationDocument): string {
  const { contentHash: _c, ...rest } = doc;
  void _c;
  return sha256Hex(JSON.stringify(rest));
}

export function freezeSpecification(
  draft: SpecificationDocument,
  approvalIdentity: string,
): { ok: true; spec: SpecificationDocument } | { ok: false; reason: string } {
  const qualityChecklist = buildQualityChecklist(draft);
  if (!qualityChecklist.passed) {
    return { ok: false, reason: 'quality checklist failed' };
  }
  if (draft.unresolvedQuestions.some((q) => q.critical)) {
    return { ok: false, reason: 'critical questions open' };
  }
  const frozen: SpecificationDocument = {
    ...draft,
    functionalRequirements: draft.functionalRequirements.map((r) =>
      r.status === 'draft' ? { ...r, status: 'active' as const } : r,
    ),
    qualityChecklist,
    approvalIdentity,
    frozenAt: nowIso(),
  };
  frozen.contentHash = hashSpecification(frozen);
  return { ok: true, spec: frozen };
}
