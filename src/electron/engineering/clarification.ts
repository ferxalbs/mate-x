/**
 * Clarification engine — DecisionQueue, max questions, atomic answers.
 * NES-2.3
 */

import type {
  ActorRef,
  DecisionQueueItem,
  SpecificationDocument,
} from '../../contracts/engineering-task';
import { newNamespacedId, nowIso } from './ids';

export const MAX_CLARIFICATION_QUESTIONS = 5;

export function scorePriority(item: Pick<DecisionQueueItem, 'impact' | 'uncertainty'>): number {
  return item.impact * item.uncertainty;
}

export function sortDecisionQueue(items: DecisionQueueItem[]): DecisionQueueItem[] {
  return [...items].sort((a, b) => scorePriority(b) - scorePriority(a));
}

export function buildInitialDecisionQueue(spec: SpecificationDocument): DecisionQueueItem[] {
  const items: DecisionQueueItem[] = [];
  for (const q of spec.unresolvedQuestions) {
    items.push({
      decisionId: newNamespacedId('decision'),
      taxonomy: 'requirement',
      question: q.question,
      impact: q.critical ? 5 : 3,
      uncertainty: q.critical ? 4 : 2,
      options: [
        { optionId: 'yes', label: 'Yes / accept' },
        { optionId: 'no', label: 'No / reject' },
        { optionId: 'custom', label: 'Custom' },
      ],
      required: q.critical,
      status: 'open',
    });
  }
  return sortDecisionQueue(items).slice(0, MAX_CLARIFICATION_QUESTIONS);
}

export function answerDecision(input: {
  items: DecisionQueueItem[];
  decisionId: string;
  chosenOptionId?: string;
  customValue?: string;
  skipWithAck?: boolean;
  actor: ActorRef;
  spec: SpecificationDocument;
}):
  | {
      ok: true;
      items: DecisionQueueItem[];
      spec: SpecificationDocument;
    }
  | { ok: false; reason: string } {
  const item = input.items.find((d) => d.decisionId === input.decisionId);
  if (!item) return { ok: false, reason: 'decision not found' };
  if (item.status !== 'open') return { ok: false, reason: 'decision not open' };

  if (input.skipWithAck) {
    if (item.required && item.impact >= 4 && !input.customValue && !input.chosenOptionId) {
      // high-impact skip requires explicit ack via skipWithAck true + note in customValue
      if (!input.customValue?.trim()) {
        return { ok: false, reason: 'high-impact skip requires acknowledgment text' };
      }
    }
    const nextItems = input.items.map((d) =>
      d.decisionId === input.decisionId
        ? {
            ...d,
            status: 'skipped' as const,
            answer: {
              customValue: input.customValue,
              answeredAt: nowIso(),
              actor: input.actor,
            },
          }
        : d,
    );
    // Remove matching critical question from spec in same transaction
    const nextSpec: SpecificationDocument = {
      ...input.spec,
      unresolvedQuestions: input.spec.unresolvedQuestions.filter(
        (q) => q.question !== item.question,
      ),
      clarificationDecisions: [
        ...input.spec.clarificationDecisions,
        input.decisionId,
      ],
    };
    return { ok: true, items: nextItems, spec: nextSpec };
  }

  if (!input.chosenOptionId && !input.customValue?.trim()) {
    return { ok: false, reason: 'answer required' };
  }

  const nextItems = input.items.map((d) =>
    d.decisionId === input.decisionId
      ? {
          ...d,
          status: 'answered' as const,
          answer: {
            chosenOptionId: input.chosenOptionId,
            customValue: input.customValue,
            answeredAt: nowIso(),
            actor: input.actor,
          },
        }
      : d,
  );

  // Atomic spec patch: drop resolved question; record decision
  const answerText =
    input.customValue?.trim() ||
    item.options.find((o) => o.optionId === input.chosenOptionId)?.label ||
    '';

  const nextSpec: SpecificationDocument = {
    ...input.spec,
    unresolvedQuestions: input.spec.unresolvedQuestions.filter(
      (q) => q.question !== item.question,
    ),
    assumptions: answerText
      ? [
          ...input.spec.assumptions.filter((a) => a.statement !== item.question),
          {
            id: `asm-${input.decisionId}`,
            statement: `${item.question} → ${answerText}`,
          },
        ]
      : input.spec.assumptions,
    clarificationDecisions: [
      ...input.spec.clarificationDecisions,
      input.decisionId,
    ],
  };

  return { ok: true, items: nextItems, spec: nextSpec };
}

export function openCriticalCount(items: DecisionQueueItem[]): number {
  return items.filter((d) => d.status === 'open' && d.required).length;
}
