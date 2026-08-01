import { extname } from "node:path";

export type StructuralVerification =
  | { status: "passed"; verifier: string }
  | { status: "pending"; verifier: "generic"; reason: string }
  | { status: "failed"; verifier: string; reason: string };

const SCRIPT_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

export function verifyFileStructure(
  filePath: string,
  content: string,
): StructuralVerification {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".json" || extension === ".jsonc") {
    if (extension === ".jsonc") {
      return {
        status: "pending",
        verifier: "generic",
        reason: "JSONC requires a repository validator.",
      };
    }
    try {
      JSON.parse(stripBom(content));
      return { status: "passed", verifier: "json.parse" };
    } catch (error) {
      return {
        status: "failed",
        verifier: "json.parse",
        reason: error instanceof Error ? error.message : "Invalid JSON.",
      };
    }
  }

  if (SCRIPT_EXTENSIONS.has(extension)) {
    const delimiterError = findUnbalancedScriptDelimiter(content);
    return delimiterError
      ? {
          status: "failed",
          verifier: "script-delimiter-parser",
          reason: delimiterError,
        }
      : { status: "passed", verifier: "script-delimiter-parser" };
  }

  return {
    status: "pending",
    verifier: "generic",
    reason: "No local structural verifier is registered for this file type.",
  };
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function findUnbalancedScriptDelimiter(content: string): string | null {
  const stack: Array<{ token: string; line: number }> = [];
  const pairs: Record<string, string> = { "}": "{", "]": "[", ")": "(" };
  let state:
    | "code"
    | "single_quote"
    | "double_quote"
    | "template"
    | "line_comment"
    | "block_comment" = "code";
  let escaped = false;
  let line = 1;

  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "\n") {
      line++;
      if (state === "line_comment") state = "code";
    }

    if (state === "line_comment") continue;
    if (state === "block_comment") {
      if (char === "*" && next === "/") {
        state = "code";
        index++;
      }
      continue;
    }
    if (state !== "code") {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (
        (state === "single_quote" && char === "'") ||
        (state === "double_quote" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      state = "line_comment";
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block_comment";
      index++;
      continue;
    }
    if (char === "'") {
      state = "single_quote";
      continue;
    }
    if (char === '"') {
      state = "double_quote";
      continue;
    }
    if (char === "`") {
      state = "template";
      continue;
    }

    if (char === "{" || char === "[" || char === "(") {
      stack.push({ token: char, line });
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      const opening = stack.pop();
      if (!opening || opening.token !== pairs[char]) {
        return `Unexpected "${char}" at line ${line}.`;
      }
    }
  }

  if (
    state === "single_quote" ||
    state === "double_quote" ||
    state === "template" ||
    state === "block_comment"
  ) {
    return `Unterminated ${state.replaceAll("_", " ")} at end of file.`;
  }
  const opening = stack.at(-1);
  return opening
    ? `Unclosed "${opening.token}" opened at line ${opening.line}.`
    : null;
}

