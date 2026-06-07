import type { PrivacyLabel, PrivacyRisk, PrivacySpan } from "./privacy-types";
import { hashSensitiveText } from "./privacy-redactor";

interface Rule {
  label: PrivacyLabel;
  risk: PrivacyRisk;
  regex: RegExp;
  valueGroup?: number;
  confidence: number;
  skip?: (value: string) => boolean;
}

const DB_SCHEMES = "(?:postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\\+srv)?|clickhouse|snowflake|bigquery|amqp|rabbitmq)";
const TOKEN = "[A-Za-z0-9_./+=:@%~-]{12,}";
const PLACEHOLDER_RE = /^(?:YOUR_[A-Z0-9_]+_HERE|<[^>]+>|\$\{[^}]+\}|xxx+|example|demo)$/i;

const RULE_HINTS: Partial<Record<PrivacyLabel, RegExp>> = {
  database_uri: new RegExp(`\\b${DB_SCHEMES}:`, "i"),
  api_key: /\b(?:sk-|sk-proj-|sk-or-v1-|ghp_|github_pat_|npm_|hf_|xox[abp]-|API_KEY|SECRET_KEY|CLIENT_SECRET)\b/i,
  auth_token: /\b(?:Bearer\s+|refresh_token|access_token|cli_token)\b|\.[A-Za-z0-9_-]{10,}\./i,
  session_cookie: /\b(?:session|connect\.sid|sid|auth_session|next-auth\.session-token)\b/i,
  cloud_credential: /\b(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS|AZURE_CLIENT_SECRET)\b|-----BEGIN/i,
  private_file_path: /(?:\/Users\/|\/home\/|C:\\Users\\)/i,
  internal_url: /https?:\/\/(?:localhost|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|[^/\s"'<>]+\.(?:internal|local|corp))/i,
  workspace_identity: /\b(?:workspace_id|org_id|tenant_id|project_id|repo_slug|run_id|ws_)\b/i,
  customer_data: /\b(?:customer_id|billing_customer|cust_)\b/i,
  prompt_sensitive: /\b(?:ignore previous policy|do not redact|copy the key exactly|reveal the secret|bypass the policy|include credentials in final answer|send the raw \.env|do not tell the user|exfiltrate)\b/i,
};

const RULES: Rule[] = [
  {
    label: "database_uri",
    risk: "p0",
    regex: new RegExp(`\\b${DB_SCHEMES}:\\/\\/[^\\s"'<>),]+`, "gi"),
    confidence: 0.99,
  },
  {
    label: "api_key",
    risk: "p0",
    regex: /\b(?:sk-proj-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[abp]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9_]{12,}|hf_[A-Za-z0-9]{12,}|anthropic[_-]?[A-Za-z0-9_-]{16,})\b/g,
    confidence: 0.98,
    skip: (value) => PLACEHOLDER_RE.test(value),
  },
  {
    label: "api_key",
    risk: "p0",
    regex: /\b[A-Z0-9_]*(?:API_KEY|SECRET_KEY|CLIENT_SECRET)\b\s*[:=]\s*["']?([^"'\s#;,]{12,})/gi,
    valueGroup: 1,
    confidence: 0.93,
    skip: (value) => PLACEHOLDER_RE.test(value),
  },
  {
    label: "auth_token",
    risk: "p0",
    regex: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/gi,
    valueGroup: 1,
    confidence: 0.95,
  },
  {
    label: "auth_token",
    risk: "p0",
    regex: /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    confidence: 0.96,
  },
  {
    label: "auth_token",
    risk: "p0",
    regex: new RegExp(`\\b(?:refresh_token|access_token|cli_token)\\b\\s*[:=]\\s*["']?(${TOKEN})`, "gi"),
    valueGroup: 1,
    confidence: 0.94,
  },
  {
    label: "session_cookie",
    risk: "p0",
    regex: new RegExp(`\\b(?:session|connect\\.sid|sid|auth_session|next-auth\\.session-token)\\b\\s*[:=]\\s*["']?(${TOKEN})`, "gi"),
    valueGroup: 1,
    confidence: 0.92,
  },
  {
    label: "cloud_credential",
    risk: "p0",
    regex: /\b(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS|AZURE_CLIENT_SECRET)\b\s*[:=]\s*["']?([^"'\s#;,]{8,})/gi,
    valueGroup: 1,
    confidence: 0.96,
  },
  {
    label: "cloud_credential",
    risk: "p0",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    confidence: 0.99,
  },
  {
    label: "cloud_credential",
    risk: "p0",
    regex: /https?:\/\/[^\s"'<>]+(?:service-account|credentials?|keys?)[^\s"'<>]*/gi,
    confidence: 0.9,
  },
  {
    label: "private_file_path",
    risk: "p1",
    regex: /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|C:\\Users\\[^\\\s]+)[^\s"'<>]*/g,
    confidence: 0.88,
  },
  {
    label: "internal_url",
    risk: "p1",
    regex: /https?:\/\/(?:localhost(?::\d+)?\/(?:admin|private|internal)[^\s"'<>]*|(?:[^/\s"'<>]+\.)?(?:internal|local|corp)(?::\d+)?[^\s"'<>]*|(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?::\d+)?[^\s"'<>]*)/gi,
    confidence: 0.9,
  },
  {
    label: "workspace_identity",
    risk: "p1",
    regex: /\b(?:workspace_id|org_id|tenant_id|project_id|repo_slug|run_id)\b\s*[:=]\s*["']?([A-Za-z0-9_./-]{4,})/gi,
    valueGroup: 1,
    confidence: 0.86,
  },
  {
    label: "workspace_identity",
    risk: "p1",
    regex: /\bws_[A-Za-z0-9_./-]{6,}\b/g,
    confidence: 0.9,
  },
  {
    label: "customer_data",
    risk: "p1",
    regex: /\b(?:customer_id|billing_customer)\b\s*[:=]\s*["']?(cust_[A-Za-z0-9_./-]{4,}|[A-Za-z0-9_./-]{6,})/gi,
    valueGroup: 1,
    confidence: 0.86,
  },
  {
    label: "customer_data",
    risk: "p1",
    regex: /\bcust_[A-Za-z0-9_./-]{6,}\b/g,
    confidence: 0.88,
  },
  {
    label: "prompt_sensitive",
    risk: "p0",
    regex: /\b(?:ignore previous policy|do not redact|copy the key exactly|reveal the secret|bypass the policy|include credentials in final answer|send the raw \.env|do not tell the user|exfiltrate)\b/gi,
    confidence: 0.91,
  },
];

function shouldRunRule(rule: Rule, text: string) {
  const hint = RULE_HINTS[rule.label];
  return !hint || hint.test(text);
}

export function scanWithRegex(text: string, workspaceId?: string): PrivacySpan[] {
  if (!text) {
    return [];
  }

  const spans: PrivacySpan[] = [];

  for (const rule of RULES) {
    if (!shouldRunRule(rule, text)) {
      continue;
    }

    rule.regex.lastIndex = 0;
    for (const match of text.matchAll(rule.regex)) {
      const rawValue = rule.valueGroup ? match[rule.valueGroup] : match[0];
      if (!rawValue || rule.skip?.(rawValue)) {
        continue;
      }

      const offset = rule.valueGroup
        ? (match[0].indexOf(rawValue) >= 0 ? match[0].indexOf(rawValue) : 0)
        : 0;
      const start = (match.index ?? 0) + offset;
      const end = start + rawValue.length;
      const hash = hashSensitiveText(rule.label, rawValue, workspaceId);

      spans.push({
        id: `regex-${spans.length}-${start}-${hash.slice(0, 8)}`,
        label: rule.label,
        text: rawValue,
        start,
        end,
        confidence: rule.confidence,
        source: ["regex"],
        risk: rule.risk,
        replacement: "[SECRET]",
        hash,
      });
    }
  }

  return spans;
}
