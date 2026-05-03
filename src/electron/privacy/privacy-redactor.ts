import crypto from "node:crypto";

import type { PrivacyFirewallOptions, PrivacyLabel, PrivacySpan } from "./privacy-types";

const TYPED_PLACEHOLDERS: Record<PrivacyLabel, string> = {
  secret: "[SECRET]",
  api_key: "[SECRET_API_KEY]",
  auth_token: "[SECRET_AUTH_TOKEN]",
  session_cookie: "[SECRET_SESSION_COOKIE]",
  database_uri: "[SECRET_DATABASE_URI]",
  cloud_credential: "[SECRET_CLOUD_CREDENTIAL]",
  repo_secret: "[SECRET_REPO_SECRET]",
  prompt_sensitive: "[PROMPT_SENSITIVE]",
  private_file_path: "[PRIVATE_FILE_PATH]",
  internal_url: "[INTERNAL_URL]",
  workspace_identity: "[WORKSPACE_IDENTITY]",
  customer_data: "[CUSTOMER_DATA]",
  stacktrace_sensitive: "[STACKTRACE_SENSITIVE]",
  private_email: "[PRIVATE_EMAIL]",
  private_phone: "[PRIVATE_PHONE]",
  account_number: "[ACCOUNT_NUMBER]",
  payment_token: "[PAYMENT_TOKEN]",
  personal_document_id: "[PERSONAL_DOCUMENT_ID]",
  private_url: "[PRIVATE_URL]",
  private_person: "[PRIVATE_PERSON]",
  private_address: "[PRIVATE_ADDRESS]",
  private_date: "[PRIVATE_DATE]",
};

export function hashSensitiveText(label: PrivacyLabel, text: string, workspaceId = "global") {
  return crypto.createHash("sha256").update(`${label}:${text}:${workspaceId}`).digest("hex");
}

export function replacementForSpan(
  span: Pick<PrivacySpan, "label" | "hash">,
  style: PrivacyFirewallOptions["placeholderStyle"],
) {
  if (style === "simple") {
    return "[SECRET]";
  }

  if (style === "stable") {
    return `[SECRET:${span.label}:${span.hash.slice(0, 8)}]`;
  }

  return TYPED_PLACEHOLDERS[span.label] ?? "[SECRET]";
}

export function redactText(text: string, spans: PrivacySpan[]) {
  let output = "";
  let cursor = 0;

  for (const span of spans) {
    if (span.start < cursor) {
      continue;
    }

    output += text.slice(cursor, span.start);
    output += span.replacement;
    cursor = span.end;
  }

  return output + text.slice(cursor);
}
