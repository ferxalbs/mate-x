/**
 * Plan compiler — TechnicalApproach with REQ-linked decisions.
 * NES-3.1
 */

import type {
  ResearchDecision,
  SpecificationDocument,
  TechnicalApproachDocument,
} from '../../contracts/engineering-task';
import { newNamespacedId, sha256Hex } from './ids';

export function compileTechnicalApproach(
  spec: SpecificationDocument,
  version = 1,
):
  | { ok: true; approach: TechnicalApproachDocument }
  | { ok: false; reason: string } {
  if (!spec.frozenAt) {
    return { ok: false, reason: 'specification not frozen' };
  }

  const decisions: ResearchDecision[] = spec.functionalRequirements
    .filter((r) => r.status === 'active')
    .map((r, i) => ({
      researchId: `rd_${i + 1}`,
      statement: `Implement ${r.reqId}`,
      rationale: r.statement,
      rejectedAlternatives: [],
      linkedReqIds: [r.reqId],
      kind: 'product_linked' as const,
    }));

  if (!spec.verifyOnly && decisions.some((d) => d.linkedReqIds.length === 0)) {
    return { ok: false, reason: 'decision without linked REQs' };
  }

  if (!spec.verifyOnly && decisions.length === 0 && spec.functionalRequirements.length > 0) {
    return { ok: false, reason: 'no research decisions' };
  }

  if (spec.verifyOnly && decisions.length === 0) {
    decisions.push({
      researchId: 'rd_verify',
      statement: 'Run verification approach for current workspace changes',
      rationale: spec.objective,
      rejectedAlternatives: [],
      linkedReqIds: [],
      kind: 'platform',
    });
  }

  const approach: TechnicalApproachDocument = {
    approachId: newNamespacedId('approach'),
    version,
    specificationVersion: spec.version,
    researchNotes: [{ id: 'n1', text: 'Deterministic skeleton plan (v0.1.2)' }],
    decisions,
    affectedSurfaces: ['src'],
    interfaces: [],
    dataModel: [],
    stateChanges: [],
    migrations: [],
    rollout: 'local desktop',
    rollback: 'revert commits under Ship Proof gate',
    observability: 'ledger events',
    validationStrategy: ['typed validation plan', 'coverage convergence'],
    contentHash: '',
  };
  approach.contentHash = sha256Hex(JSON.stringify({ ...approach, contentHash: '' }));
  return { ok: true, approach };
}
