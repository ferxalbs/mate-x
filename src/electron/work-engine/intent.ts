import type { WorkIntent } from './types';

const MUTATION_VERB = '(?:fix|patch|update|implement|change|add|remove|edit|modify|repair|migrate)';
const GLOBAL_READ_ONLY_RE = new RegExp(
  [
    `\\b(?:do\\s+not|don't|never)\\s+(?:\\w+\\s+){0,2}${MUTATION_VERB}(?=\\s+(?:anything|(?:the\\s+)?(?:repository|workspace|codebase)|(?:any\\s+)?(?:files?|code))\\b|[.!?]\\s*$)`,
    '\\bwithout\\s+(?:making\\s+)?(?:any\\s+)?(?:changes?|edits?|modifications?)\\b',
    '\\bno\\s+(?:(?:workspace|repository|file|code)\\s+)?(?:changes?|edits?|modifications?)\\b',
    '\\bread[- ]only\\b',
  ].join('|'),
  'i',
);
const IMPERATIVE_MUTATION_RE = new RegExp(
  [
    `(?:^|[.!?]\\s+|\\n\\s*)(?:please\\s+|kindly\\s+)?${MUTATION_VERB}\\b`,
    `\\b(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?${MUTATION_VERB}\\b`,
    `\\b(?:i\\s+(?:need|want)\\s+you\\s+to|go\\s+ahead\\s+and)\\s+${MUTATION_VERB}\\b`,
    `\\b(?:review|inspect|find|identify|diagnose)\\b[^.!?\\n]{0,80}\\band\\s+(?:then\\s+)?${MUTATION_VERB}\\b`,
  ].join('|'),
  'i',
);
const VALIDATE_RE = /\b(tests?|typecheck|lint|build|validate|verify|check)\b|run\b.*\bsuite\b/i;
const REVIEW_CHANGES_RE = /\b(review\s+(current\s+)?changes|current\s+changes|git\s+diff|diff\s+review)\b/i;
const SECURITY_RE = /\b(security|vuln|vulnerable|vulnerability|exploit|risk|threat|auth|secret|injection|xss|ssrf|rce)\b/i;
const TRACE_RE = /\b(trace|source|sink|flow|path)\b/i;
const EVIDENCE_RE = /\b(evidence|report|proof|pack|attestation|runbook)\b/i;
const INSPECT_RE = /\b(what|why|how|where|explain|inspect|show|describe|identify|review|propose|recommend|migration)\b/i;

export function classifyWorkIntent(prompt: string): WorkIntent {
  const text = prompt.trim();
  if (!text) return 'unknown';

  if (GLOBAL_READ_ONLY_RE.test(text)) return 'inspect';
  if (IMPERATIVE_MUTATION_RE.test(text)) return 'patch';
  if (REVIEW_CHANGES_RE.test(text)) return 'review_changes';
  if (SECURITY_RE.test(text)) return 'security_review';
  if (TRACE_RE.test(text)) return 'trace_issue';
  if (VALIDATE_RE.test(text)) return 'validate';
  if (EVIDENCE_RE.test(text)) return 'generate_evidence';
  if (INSPECT_RE.test(text)) return 'inspect';

  return 'answer';
}
