import type { PrivacyFirewallOptions, PrivacyLabel, PrivacySpan } from "./privacy-types";
import { hashSensitiveText, replacementForSpan } from "./privacy-redactor";

const SPECIFICITY: Record<PrivacyLabel, number> = {
  database_uri: 100,
  cloud_credential: 95,
  api_key: 90,
  auth_token: 88,
  session_cookie: 86,
  repo_secret: 82,
  internal_url: 80,
  private_url: 70,
  private_file_path: 65,
  workspace_identity: 62,
  customer_data: 60,
  prompt_sensitive: 58,
  payment_token: 55,
  account_number: 52,
  personal_document_id: 50,
  private_email: 45,
  private_phone: 44,
  private_person: 35,
  private_address: 34,
  private_date: 33,
  stacktrace_sensitive: 30,
  secret: 1,
};

const DB_URI_RE = /\b(?:postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?|clickhouse|snowflake|bigquery|amqp|rabbitmq):\/\/[^\s"'<>),]+/gi;

function overlaps(a: PrivacySpan, b: PrivacySpan) {
  return a.start < b.end && b.start < a.end;
}

function betterSpan(a: PrivacySpan, b: PrivacySpan) {
  const aScore = (a.end - a.start) + SPECIFICITY[a.label] * 10 + a.confidence;
  const bScore = (b.end - b.start) + SPECIFICITY[b.label] * 10 + b.confidence;
  return aScore >= bScore ? a : b;
}

export function postprocessPrivacySpans(
  text: string,
  spans: PrivacySpan[],
  options: PrivacyFirewallOptions,
  workspaceId?: string,
) {
  const expanded = spans.map((span) => ({ ...span, source: [...span.source] }));

  for (const match of text.matchAll(DB_URI_RE)) {
    const uri = match[0];
    const start = match.index ?? 0;
    const end = start + uri.length;
    const hash = hashSensitiveText("database_uri", uri, workspaceId);
    expanded.push({
      id: `post-db-${start}-${hash.slice(0, 8)}`,
      label: "database_uri",
      text: uri,
      start,
      end,
      confidence: 0.99,
      source: ["postprocessor"],
      risk: "p0",
      replacement: "[SECRET]",
      hash,
    });
  }

  const sorted = expanded
    .filter((span) => span.start >= 0 && span.end > span.start && span.end <= text.length)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const resolved: PrivacySpan[] = [];
  for (const span of sorted) {
    const previous = resolved[resolved.length - 1];
    if (!previous || !overlaps(previous, span)) {
      resolved.push(span);
      continue;
    }

    resolved[resolved.length - 1] = betterSpan(previous, span);
  }

  const merged: PrivacySpan[] = [];
  for (const span of resolved) {
    const previous = merged[merged.length - 1];
    const gap = previous ? text.slice(previous.end, span.start) : "";
    if (
      previous &&
      previous.label === span.label &&
      span.start >= previous.end &&
      gap.length <= 3 &&
      /^[\s._:-]*$/.test(gap)
    ) {
      const mergedText = text.slice(previous.start, span.end);
      const hash = hashSensitiveText(previous.label, mergedText, workspaceId);
      merged[merged.length - 1] = {
        ...previous,
        end: span.end,
        text: mergedText,
        confidence: Math.max(previous.confidence, span.confidence),
        source: Array.from(new Set([...previous.source, ...span.source, "postprocessor"])),
        hash,
      };
      continue;
    }
    merged.push(span);
  }

  return merged.map((span) => {
    const label = DB_URI_RE.test(span.text) ? "database_uri" : span.label;
    DB_URI_RE.lastIndex = 0;
    const normalized = { ...span, label };
    return {
      ...normalized,
      replacement: replacementForSpan(normalized, options.placeholderStyle),
    };
  });
}
