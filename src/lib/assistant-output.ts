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
        !/\b(system prompt|workspace trust contract|behavior mode policy|internal policy|policy evaluation|hidden reasoning|chain[- ]of[- ]thought)\b/i.test(
          paragraph,
        ),
    )
    .join("\n\n")
    .trim();
}
