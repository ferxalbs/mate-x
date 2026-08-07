export type SecretRedactionKind =
  | "token"
  | "api_key"
  | "password"
  | "authorization"
  | "private_key"
  | "credential";

export interface SecretRedactionFinding {
  kind: SecretRedactionKind;
  path: string;
}

export interface SecretRedactionResult<T> {
  payload: T;
  redacted: boolean;
  findings: SecretRedactionFinding[];
}

export const REDACTED_SECRET = "[REDACTED_SECRET]";

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth(?:orization)?|bearer|cookie|password|passwd|secret|credential|private[_-]?key|client[_-]?secret)/i;

const TEXT_PATTERNS: Array<{
  kind: SecretRedactionKind;
  pattern: RegExp;
  replacement: string;
}> = [
  {
    kind: "private_key",
    pattern: /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g,
    replacement: REDACTED_SECRET,
  },
  {
    kind: "authorization",
    pattern: /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: REDACTED_SECRET,
  },
  {
    kind: "token",
    pattern: /\b(?:gh[pousr]|github_pat|glpat|xox[baprs]-|AKIA|sk_(?:live|test)_|rk_(?:live|test)_|pk_(?:live|test)_)[A-Za-z0-9_./+=-]{8,}\b/g,
    replacement: REDACTED_SECRET,
  },
  {
    kind: "token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: REDACTED_SECRET,
  },
  {
    kind: "credential",
    pattern: /((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|authorization|cookie|client[_-]?secret)["']?\s*[:=]\s*["']))[^"'\r\n]*/gi,
    replacement: `$1${REDACTED_SECRET}`,
  },
  {
    kind: "credential",
    pattern: /((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|authorization|cookie|client[_-]?secret)["']?\s*[:=]\s*["']?))[^\s"',;}\]]+/gi,
    replacement: `$1${REDACTED_SECRET}`,
  },
  {
    kind: "credential",
    pattern: /((?:--)?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|cookie|client[_-]?secret)(?:=|\s+))[\S]+/gi,
    replacement: `$1${REDACTED_SECRET}`,
  },
];

/** Redacts secrets from a free-form string without returning secret values. */
export function redactSensitiveText(value: string): string {
  return TEXT_PATTERNS.reduce(
    (current, { pattern, replacement }) => current.replace(pattern, replacement),
    value,
  );
}

/**
 * Redacts JSON-like payloads recursively. Key-typed values are redacted even
 * when they do not match a provider-specific token format; this is the final
 * persistence boundary for tool args, events, evidence, and sessions.
 */
export function redactSecretPayload<T>(payload: T): T {
  return redactSecretPayloadWithReport(payload).payload;
}

export function redactSecretPayloadWithReport<T>(payload: T): SecretRedactionResult<T> {
  const findings: SecretRedactionFinding[] = [];
  const seen = new WeakMap<object, unknown>();
  const redactedPayload = redactUnknown(payload, "", findings, seen) as T;
  return {
    payload: redactedPayload,
    redacted: findings.length > 0,
    findings,
  };
}

function redactUnknown(
  value: unknown,
  path: string,
  findings: SecretRedactionFinding[],
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === "string") {
    const redacted = redactSensitiveText(value);
    if (redacted !== value) {
      findings.push({ kind: "token", path: path || "$" });
    }
    return redacted;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    value.forEach((item, index) => {
      output.push(redactUnknown(item, `${path}[${index}]`, findings, seen));
    });
    return output;
  }

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, item] of Object.entries(value)) {
    const itemPath = path ? `${path}.${key}` : key;
    if (
      SECRET_KEY_PATTERN.test(key) &&
      (!isObjectLike(item) || Buffer.isBuffer(item) || item instanceof Uint8Array)
    ) {
      if (item !== null && item !== undefined) {
        findings.push({ kind: kindForKey(key), path: itemPath });
        output[key] = REDACTED_SECRET;
      } else {
        output[key] = item;
      }
      continue;
    }
    output[key] = redactUnknown(item, itemPath, findings, seen);
  }
  return output;
}

function isObjectLike(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function kindForKey(key: string): SecretRedactionKind {
  const normalized = key.toLowerCase();
  if (normalized.includes("password") || normalized.includes("passwd")) return "password";
  if (normalized.includes("authorization") || normalized === "auth" || normalized.includes("cookie")) {
    return "authorization";
  }
  if (normalized.includes("api") && normalized.includes("key")) return "api_key";
  if (normalized.includes("private") && normalized.includes("key")) return "private_key";
  if (normalized.includes("credential") || normalized.includes("secret")) return "credential";
  return "token";
}
