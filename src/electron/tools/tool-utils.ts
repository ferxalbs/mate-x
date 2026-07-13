import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const DEFAULT_MAX_OUTPUT_CHARS = 12_000;

/**
 * Returns true when `absoluteTarget` is the root itself or a path strictly
 * inside it. Rejects parent traversal and cross-drive absolute relatives.
 */
export function isPathInsideRoot(rootPath: string, absoluteTarget: string): boolean {
  const rel = relative(rootPath, absoluteTarget);
  if (rel === "") {
    return true;
  }
  // On Windows, relative() returns an absolute path when roots are on different drives.
  if (isAbsolute(rel)) {
    return false;
  }
  // Only treat true parent segments as escapes (not filenames like "..config").
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

/** @deprecated Prefer isPathInsideRoot; kept as a readable alias for tools. */
export function isInsideWorkspace(workspacePath: string, targetPath: string): boolean {
  return isPathInsideRoot(workspacePath, targetPath);
}

export function resolveWorkspacePath(
  workspacePath: string,
  inputPath: unknown,
  fallbackPath = ".",
): string {
  const candidate =
    typeof inputPath === "string" && inputPath.trim().length > 0
      ? inputPath.trim()
      : fallbackPath;

  if (candidate.includes("\0")) {
    throw new Error("Invalid path.");
  }

  const absoluteTarget = resolve(workspacePath, candidate);
  if (!isPathInsideRoot(workspacePath, absoluteTarget)) {
    throw new Error("Path must remain within the active workspace.");
  }

  return absoluteTarget;
}

export function limitTextOutput(
  text: string,
  maxChars = DEFAULT_MAX_OUTPUT_CHARS,
): string {
  if (text.length <= maxChars) {
    return text;
  }

  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n... (truncated ${omitted} characters)`;
}

export async function readUtf8FileSafe(
  workspacePath: string,
  inputPath: unknown,
): Promise<{ resolvedPath: string; content: string }> {
  const resolvedPath = resolveWorkspacePath(workspacePath, inputPath);
  const content = await readFile(resolvedPath, "utf8");
  return { resolvedPath, content };
}

export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}
