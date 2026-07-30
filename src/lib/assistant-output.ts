/**
 * Final user-content boundary shared by the provider runtime and persistence.
 * Provider control channels and leaked policy scratchpads are never chat data.
 */
export function sanitizeAssistantOutput(value: string): string {
  const finalMarker =
    /<\|channel\|>\s*final(?:<\|message\|>)?|<channel>\s*final\s*<\/channel>/gi;
  const matches = [...value.matchAll(finalMarker)];
  const finalOnly =
    matches.length > 0
      ? value.slice((matches.at(-1)?.index ?? 0) + (matches.at(-1)?.[0].length ?? 0))
      : value;

  return finalOnly
    .replace(
      /<\|channel\|>\s*(?:analysis|reasoning|thinking|thought|internal)(?:<\|message\|>)?[\s\S]*?(?=<\|channel\|>|<\|end\|>|$)/gi,
      "",
    )
    .replace(/<\|(?:start|end|message|channel|constrain|return|recipient)\|>/gi, "")
    .replace(/<\/?\s*channel\s*>/gi, "")
    .split(/\n{2,}/)
    .filter(
      (paragraph) =>
        !isSerializedToolCall(paragraph) &&
        !/\b(system prompt|workspace trust contract|behavior mode policy|internal policy|policy evaluation|hidden reasoning|chain[- ]of[- ]thought)\b/i.test(
          paragraph,
        ),
    )
    .join("\n\n")
    .trim();
}

/** Public progress may describe scope, but never exposes absolute local paths. */
export function sanitizePublicProgress(value: string): string {
  return sanitizeAssistantOutput(value)
    .replace(
      /(?:\/(?:Users|home|var|private|tmp)\/[^\s`'")\]}>,;:]+|[A-Za-z]:\\[^\s`'")\]}>,;:]+)/g,
      "[relevant file]",
    )
    .trim();
}

function isSerializedToolCall(paragraph: string): boolean {
  const candidate = paragraph.trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return false;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    return (
      (typeof record.call === "string" || typeof record.tool === "string") &&
      Object.keys(record).length > 1
    );
  } catch {
    return false;
  }
}
