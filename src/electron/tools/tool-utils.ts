import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

/**
 * Canonical workspace-boundary resolution. Existing symlinks are resolved and
 * non-existing targets are authorized through their nearest existing ancestor.
 */
export async function resolveWorkspacePathSecure(
  workspacePath: string,
  inputPath: unknown,
  fallbackPath = ".",
): Promise<string> {
  const { canonicalWorkspace, target } = await resolveCanonicalWorkspaceTarget(
    workspacePath,
    inputPath,
    fallbackPath,
  );
  const canonicalTarget = await resolveExistingPathOrAncestor(
    canonicalWorkspace,
    target,
  );
  return canonicalTarget ?? target;
}

/**
 * Resolves a path for a read and returns the canonical path that will be read.
 * A symlink is allowed only when its final target remains inside the active
 * workspace. This is the shared read boundary for filesystem tools.
 */
export async function resolveWorkspacePathForRead(
  workspacePath: string,
  inputPath: unknown,
  fallbackPath = ".",
): Promise<string> {
  const resolved = await resolveWorkspacePathSecure(
    workspacePath,
    inputPath,
    fallbackPath,
  );
  const canonicalWorkspace = await realpath(workspacePath);
  const canonicalTarget = await realpath(resolved);
  if (!isPathInsideRoot(canonicalWorkspace, canonicalTarget)) {
    throw new Error("Path resolves outside the active workspace.");
  }
  return canonicalTarget;
}

/**
 * Resolves a path for mutation. Any symlink in the target path is rejected,
 * including a symlink at the final file. This prevents a checked path from
 * being redirected during a write through an in-workspace link.
 */
export async function resolveWorkspacePathForWrite(
  workspacePath: string,
  inputPath: unknown,
  fallbackPath = ".",
): Promise<string> {
  const { canonicalWorkspace, target } = await resolveCanonicalWorkspaceTarget(
    workspacePath,
    inputPath,
    fallbackPath,
  );
  if (!isPathInsideRoot(canonicalWorkspace, target)) {
    throw new Error("Path must remain within the active workspace.");
  }
  await assertNoSymlinkComponents(canonicalWorkspace, target);
  return target;
}

/**
 * Revalidates an already-resolved mutation target immediately before a write.
 * Callers should use the returned canonical path for the actual filesystem
 * operation, not the path they validated earlier.
 */
export async function assertWorkspacePathForWrite(
  workspacePath: string,
  targetPath: string,
): Promise<string> {
  return resolveWorkspacePathForWrite(workspacePath, targetPath);
}

/**
 * Atomic workspace write with a second canonical/symlink check immediately
 * before rename. Temporary files are created exclusively in the validated
 * target directory and are removed on every failure path.
 */
export async function writeWorkspaceFileSecure(
  workspacePath: string,
  inputPath: unknown,
  content: string | Uint8Array,
  options: { mode?: number | null; createDirectories?: boolean } = {},
): Promise<string> {
  let target = await resolveWorkspacePathForWrite(workspacePath, inputPath);
  const targetDirectory = dirname(target);
  if (options.createDirectories) {
    await mkdir(targetDirectory, { recursive: true });
    target = await resolveWorkspacePathForWrite(workspacePath, target);
  }

  const existing = await lstat(target).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (existing?.isSymbolicLink()) {
    throw new Error("Refusing to write through a symbolic link.");
  }

  const mode = options.mode ?? (existing ? existing.mode & 0o777 : 0o600);
  const tempFile = join(
    targetDirectory,
    `.${target.split(sep).pop() ?? "workspace"}.matex-${process.pid}-${Date.now()}-${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    // Revalidate the directory and target after any directory creation and
    // immediately before opening the temporary file.
    target = await resolveWorkspacePathForWrite(workspacePath, target);
    handle = await open(tempFile, "wx", mode);
    if (typeof content === "string") {
      await handle.writeFile(content, "utf8");
    } else {
      await handle.writeFile(content);
    }
    await handle.sync();
    await handle.close();
    handle = null;
    if (options.mode !== null) await chmod(tempFile, mode);

    // This is the TOCTOU guard for the commit point. A symlinked directory or
    // target introduced after the initial validation causes the write to fail.
    target = await resolveWorkspacePathForWrite(workspacePath, target);
    await rename(tempFile, target);
    return target;
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
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
  const resolvedPath = await resolveWorkspacePathForRead(workspacePath, inputPath);
  const content = await readFile(resolvedPath, "utf8");
  return { resolvedPath, content };
}

async function resolveCanonicalWorkspaceTarget(
  workspacePath: string,
  inputPath: unknown,
  fallbackPath: string,
): Promise<{ canonicalWorkspace: string; target: string }> {
  const canonicalWorkspace = await realpath(workspacePath);
  const candidate =
    typeof inputPath === "string" && inputPath.trim().length > 0
      ? inputPath.trim()
      : fallbackPath;
  if (candidate.includes("\0")) throw new Error("Invalid path.");
  const candidateAbsolute = resolve(candidate);
  // A workspace selected through /var vs /private/var (or an equivalent
  // mount alias) must still be able to revalidate its own canonical target.
  // Relative paths continue through the lexical resolver for traversal checks.
  const lexicalTarget =
    isAbsolute(candidate) && isPathInsideRoot(canonicalWorkspace, candidateAbsolute)
      ? candidateAbsolute
      : resolveWorkspacePath(workspacePath, candidate, fallbackPath);
  const relativeToWorkspace = relative(workspacePath, lexicalTarget);
  const target = isPathInsideRoot(workspacePath, lexicalTarget)
    ? resolve(canonicalWorkspace, relativeToWorkspace)
    : lexicalTarget;

  if (!isPathInsideRoot(canonicalWorkspace, target)) {
    throw new Error("Path resolves outside the active workspace.");
  }
  return { canonicalWorkspace, target };
}

async function resolveExistingPathOrAncestor(
  canonicalWorkspace: string,
  target: string,
): Promise<string | null> {
  try {
    const canonicalTarget = await realpath(target);
    if (!isPathInsideRoot(canonicalWorkspace, canonicalTarget)) {
      throw new Error("Path resolves outside the active workspace.");
    }
    return canonicalTarget;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let existingAncestor = target;
  while (true) {
    try {
      await lstat(existingAncestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new Error("Unable to resolve a safe workspace ancestor.", {
          cause: error,
        });
      }
      existingAncestor = parent;
    }
  }

  const canonicalAncestor = await realpath(existingAncestor);
  if (!isPathInsideRoot(canonicalWorkspace, canonicalAncestor)) {
    throw new Error("Path resolves outside the active workspace.");
  }
  return null;
}

async function assertNoSymlinkComponents(
  canonicalWorkspace: string,
  target: string,
): Promise<void> {
  const relativeTarget = relative(canonicalWorkspace, target);
  if (!isPathInsideRoot(canonicalWorkspace, target)) {
    throw new Error("Path must remain within the active workspace.");
  }

  let current = canonicalWorkspace;
  for (const component of relativeTarget.split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("Refusing to traverse a symbolic link for a write.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
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
