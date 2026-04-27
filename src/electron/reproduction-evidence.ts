import type {
  EvidencePackReproduction,
  EvidencePackReproductionStatus,
  EvidencePackReproductionType,
} from "../contracts/chat";

const TYPE_ALIASES: Array<[RegExp, EvidencePackReproductionType]> = [
  [/\bunit(?:\s|-)?test\b/i, "unit_test"],
  [/\bintegration(?:\s|-)?test\b/i, "integration_test"],
  [/\bminimal(?:\s|-)?script\b/i, "minimal_script"],
  [/\bhttp(?:\s|-)?request\b/i, "http_request"],
  [/\bbrowser(?:\s|-)?scenario\b/i, "browser_scenario"],
  [/\bvalidation(?:\s|-)?run\b/i, "validation_run"],
  [/\bstatic(?:\s|-)?proof\b/i, "static_proof"],
];

const STATUS_ALIASES: Array<[RegExp, EvidencePackReproductionStatus]> = [
  [/\bcreated\b/i, "created"],
  [/\bexisting|existed\b/i, "existing"],
  [/\bdescribed|confirmed\b/i, "described"],
  [/\bblocked|cannot|unavailable\b/i, "blocked"],
  [/\bnot(?:\s|-)?applicable|n\/a\b/i, "not_applicable"],
];

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseSection(content: string, heading: string) {
  const nextHeadings = [
    "Objective",
    "Stages",
    "Checks",
    "Success criteria",
    "Stop conditions",
    "Final evidence",
    "Verdict",
    "Verdict summary",
    "Confidence",
    "Warnings",
    "Unresolved risks",
    "Final recommendation",
    "Recommendation",
  ].join("|");
  const pattern = new RegExp(
    `${heading}\\s*:\\s*([\\s\\S]*?)(?:\\n\\s*(?:${nextHeadings})\\s*:|$)`,
    "gi",
  );
  return Array.from(content.matchAll(pattern)).at(-1)?.[1]?.trim() ?? "";
}

function parseField(section: string, name: string) {
  const match = section.match(
    new RegExp(
      `^\\s*(?:[-*•]\\s*)?(?:[*_]{1,3})?${name}(?:[*_]{1,3})?\\s*:\\s*([^\\n]+)$`,
      "im",
    ),
  );
  return match
    ? clean(match[1].replace(/^[*_]+\s*/, "").replace(/\s*[*_]+$/g, ""))
    : undefined;
}

function parseBoolean(value?: string) {
  if (!value) return undefined;
  if (/\b(true|yes|existing|existed)\b/i.test(value)) return true;
  if (/\b(false|no|created|new)\b/i.test(value)) return false;
  return undefined;
}

function parseOutcome(value?: string) {
  if (!value) return undefined;
  if (/\b(pass|passed|success|ok)\b/i.test(value)) return "passed" as const;
  if (/\b(fail|failed|error|reproduced)\b/i.test(value)) return "failed" as const;
  if (/\b(block|blocked|cannot|unavailable)\b/i.test(value)) return "blocked" as const;
  if (/\b(not(?:\s|-|_)?applicable|n\/a)\b/i.test(value)) {
    return "not_applicable" as const;
  }
  return "unknown" as const;
}

function parseType(value: string): EvidencePackReproductionType {
  return TYPE_ALIASES.find(([pattern]) => pattern.test(value))?.[1] ?? "static_proof";
}

function parseStatus(value: string): EvidencePackReproductionStatus {
  return STATUS_ALIASES.find(([pattern]) => pattern.test(value))?.[1] ?? "unknown";
}

export function extractReproductionEvidence(
  content: string,
): EvidencePackReproduction | undefined {
  const section = parseSection(content, "Reproduction");
  if (!section) return undefined;

  const typeText = parseField(section, "Type");
  const statusText = parseField(section, "Status");
  const summary = parseField(section, "Summary") ?? clean(section.split("\n")[0] ?? "");

  return {
    type: typeText ? parseType(typeText) : "static_proof",
    status: statusText ? parseStatus(statusText) : "unknown",
    existedBeforePatch: parseBoolean(parseField(section, "Existed before patch")),
    prePatchOutcome: parseOutcome(parseField(section, "Pre-patch outcome")),
    postPatchOutcome: parseOutcome(parseField(section, "Post-patch outcome")),
    location: parseField(section, "Location"),
    command: parseField(section, "Command"),
    summary: summary || undefined,
  };
}
