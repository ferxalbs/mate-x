import type { WorkIntent } from "./types";

const PATCH_RE = /\b(fix|patch|update|implement|change|add|remove|edit|modify|repair)\b/i;
const VALIDATE_RE = /\b(tests?|typecheck|lint|build|validate|verify|check)\b|run\b.*\bsuite\b/i;
const REVIEW_CHANGES_RE = /\b(review\s+(current\s+)?changes|current\s+changes|git\s+diff|diff\s+review)\b/i;
const SECURITY_RE = /\b(security|vuln|vulnerable|vulnerability|exploit|risk|threat|auth|secret|injection|xss|ssrf|rce)\b/i;
const TRACE_RE = /\b(trace|source|sink|flow|path)\b/i;
const EVIDENCE_RE = /\b(evidence|report|proof|pack|attestation|runbook)\b/i;
const INSPECT_RE = /\b(what|why|how|where|explain|inspect|show|describe)\b/i;

export function classifyWorkIntent(prompt: string): WorkIntent {
  const text = prompt.trim();
  if (!text) return "unknown";

  if (REVIEW_CHANGES_RE.test(text)) return "review_changes";
  if (SECURITY_RE.test(text)) return "security_review";
  if (TRACE_RE.test(text)) return "trace_issue";
  if (PATCH_RE.test(text)) return "patch";
  if (VALIDATE_RE.test(text)) return "validate";
  if (EVIDENCE_RE.test(text)) return "generate_evidence";
  if (INSPECT_RE.test(text)) return "inspect";

  return "answer";
}
