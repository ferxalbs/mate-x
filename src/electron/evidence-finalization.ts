import type { EvidencePackConfidence } from "../contracts/chat";

export interface EvidenceFinalization {
  verdictLabel?: string;
  verdictSummary?: string;
  confidence?: EvidencePackConfidence;
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
