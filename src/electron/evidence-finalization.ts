import type { EvidencePackConfidence } from "../contracts/chat";

export interface EvidenceFinalization {
  verdictLabel?: string;
  verdictSummary?: string;
  confidence?: EvidencePackConfidence;
  stages?: Array<{
    id: string;
    name: string;
    status: "completed" | "failed" | "blocked" | "unknown";
    summary?: string;
  }>;
  checks?: Array<{
    name: string;
    status: "passed" | "failed" | "unknown";
    summary?: string;
  }>;
  stopConditionTriggered?: string;
  warnings?: string[];
  unresolvedRisks?: string[];
  recommendation?: string;
}

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseBulletLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s+/, "").trim())
    .map(cleanLine)
    .filter(Boolean);
}

function parseSection(content: string, heading: string) {
  const pattern = new RegExp(
    `${heading}\\s*:\\s*([\\s\\S]*?)(?:\\n\\s*[A-Z][^:\\n]{1,40}:|$)`,
    "i",
  );
  const match = content.match(pattern);
  if (!match) {
    return "";
  }

  return match[1].trim();
}

function normalizeStageId(name: string) {
  return cleanLine(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseLabeledStatusLine(value: string) {
  const match = value.match(/^\s*[-*•]?\s*([^:]+?)\s*:\s*([^\n]+)$/);
  if (!match) {
    return null;
  }

  return {
    name: cleanLine(match[1]),
    detail: cleanLine(match[2]),
  };
}

function parseStageStatus(detail: string): "completed" | "failed" | "blocked" | "unknown" {
  const normalized = detail.toLowerCase();
  if (/\b(pass|passed|ok|complete|completed|done|success)\b/.test(normalized)) {
    return "completed";
  }
  if (/\b(fail|failed|error|regression)\b/.test(normalized)) {
    return "failed";
  }
  if (/\b(block|blocked|cannot|denied|restricted)\b/.test(normalized)) {
    return "blocked";
  }
  return "unknown";
}

function parseCheckStatus(detail: string): "passed" | "failed" | "unknown" {
  const normalized = detail.toLowerCase();
  if (/\b(pass|passed|ok|satisfied|met)\b/.test(normalized)) {
    return "passed";
  }
  if (/\b(fail|failed|not met|missing|unsatisfied)\b/.test(normalized)) {
    return "failed";
  }
  return "unknown";
}

function parseConfidence(content: string): EvidencePackConfidence | undefined {
  const match = content.match(/\bconfidence\s*:\s*(low|medium|high)\b/i);
  if (!match) {
    return undefined;
  }

  const normalized = match[1].toLowerCase();
  return normalized === "low" || normalized === "medium" || normalized === "high"
    ? normalized
    : undefined;
}

export function extractEvidenceFinalization(content: string): EvidenceFinalization {
  const result: EvidenceFinalization = {};

  const verdictLabelMatch = content.match(/\bverdict\s*:\s*([^\n]+)/i);
  if (verdictLabelMatch) {
    result.verdictLabel = cleanLine(verdictLabelMatch[1]);
  }

  const verdictSummarySection = parseSection(content, "Verdict summary");
  if (verdictSummarySection) {
    result.verdictSummary = cleanLine(verdictSummarySection.split("\n")[0] ?? "");
  }

  result.confidence = parseConfidence(content);

  const stagesSection = parseSection(content, "Stages");
  if (stagesSection) {
    result.stages = stagesSection
      .split("\n")
      .map((line) => parseLabeledStatusLine(line))
      .filter((line): line is { name: string; detail: string } => line !== null)
      .map((line) => ({
        id: normalizeStageId(line.name),
        name: line.name,
        status: parseStageStatus(line.detail),
        summary: line.detail,
      }))
      .slice(0, 8);
  }

  const checksSection = parseSection(content, "Checks");
  if (checksSection) {
    result.checks = checksSection
      .split("\n")
      .map((line) => parseLabeledStatusLine(line))
      .filter((line): line is { name: string; detail: string } => line !== null)
      .map((line) => ({
        name: line.name,
        status: parseCheckStatus(line.detail),
        summary: line.detail,
      }))
      .slice(0, 12);
  }

  const stopConditionsSection = parseSection(content, "Stop conditions");
  if (stopConditionsSection) {
    const stopLines = parseBulletLines(stopConditionsSection);
    const triggered = stopLines.find((line) =>
      /\b(triggered|true|yes|hit|active)\b/i.test(line),
    );
    if (triggered) {
      result.stopConditionTriggered = triggered;
    }
  }

  const warningsSection = parseSection(content, "Warnings");
  if (warningsSection) {
    result.warnings = parseBulletLines(warningsSection).slice(0, 6);
  }

  const risksSection = parseSection(content, "Unresolved risks");
  if (risksSection) {
    result.unresolvedRisks = parseBulletLines(risksSection).slice(0, 6);
  }

  const recommendationSection =
    parseSection(content, "Final recommendation") ||
    parseSection(content, "Recommendation");
  if (recommendationSection) {
    result.recommendation = cleanLine(recommendationSection.split("\n")[0] ?? "");
  }

  return result;
}
