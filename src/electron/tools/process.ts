import { execFile, spawn, type ExecFileOptions } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SAFE_TOOL_ENV_KEYS = [
  'APPDATA',
  'BUN_INSTALL',
  'HOME',
  'LOCALAPPDATA',
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'USERPROFILE',
  'windir',
] as const;

export function buildToolProcessEnv(
  overrides: Record<string, string | undefined> = {},
) {
  const env: NodeJS.ProcessEnv = {};

  for (const key of SAFE_TOOL_ENV_KEYS) {
    const value = process.env[key];
    if (value) {
      env[key] = key === 'PATH' || key === 'Path'
        ? sanitizeToolPath(value)
        : value;
    }
  }

  const resolvedEnv = {
    ...env,
    ...overrides,
  };
  if (resolvedEnv.PATH) {
    resolvedEnv.PATH = sanitizeToolPath(resolvedEnv.PATH);
  }
  if (resolvedEnv.Path) {
    resolvedEnv.Path = sanitizeToolPath(resolvedEnv.Path);
  }
  return resolvedEnv;
}

export type ToolPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export interface ResolvedToolCommand {
  executable: string;
  args: string[];
  packageManager?: ToolPackageManager;
}

function isNodeModulesBinEntry(entry: string) {
  const normalized = entry.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).slice(-2).join('/') === 'node_modules/.bin';
}

function sanitizeToolPath(value: string) {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return value
    .split(delimiter)
    .filter((entry) => entry && !isNodeModulesBinEntry(entry))
    .join(delimiter);
}

function pathEnvEntries(env: NodeJS.ProcessEnv) {
  return (env.PATH ?? env.Path ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .filter(Boolean);
}

function executableNames(command: string) {
  if (process.platform !== 'win32') {
    return [command];
  }

  if (/\.(exe|cmd|bat)$/i.test(command)) {
    return [command];
  }

  const extensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
}

async function isExecutableFile(path: string) {
  try {
    await access(path, constants.X_OK);
    const pathStat = await stat(path);
    return pathStat.isFile();
  } catch {
    return false;
  }
}

async function lookupExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  skipNodeModulesBin = false,
) {
  if (command.includes('/') || command.includes('\\')) {
    return await isExecutableFile(command) ? command : undefined;
  }

  for (const entry of pathEnvEntries(env)) {
    if (skipNodeModulesBin && isNodeModulesBinEntry(entry)) {
      continue;
    }

    for (const executableName of executableNames(command)) {
      const candidate = join(entry, executableName);
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

async function lookupBunExecutableOnPath(env: NodeJS.ProcessEnv) {
  for (const entry of pathEnvEntries(env)) {
    if (isNodeModulesBinEntry(entry)) {
      continue;
    }

    const candidate = join(
      entry,
      process.platform === 'win32' ? 'bun.exe' : 'bun',
    );
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function packageManagerForCommand(command: string): ToolPackageManager | undefined {
  const name = basename(command).replace(/\.(cmd|exe|bat)$/i, '').toLowerCase();
  if (name === 'bun' || name === 'bunx') return 'bun';
  if (name === 'npm') return 'npm';
  if (name === 'pnpm') return 'pnpm';
  if (name === 'yarn') return 'yarn';
  return undefined;
}

function isBunProcessPath(path: string | undefined) {
  return path ? basename(path).toLowerCase().startsWith('bun') : false;
}

export function normalizePackageManagerInvocation(input: {
  cmd: string;
  args: readonly string[];
}) {
  const name = basename(input.cmd).replace(/\.(cmd|exe|bat)$/i, '').toLowerCase();
  if (name === 'bunx') {
    return {
      cmd: 'bun',
      args: ['x', ...input.args],
    };
  }

  return {
    cmd: input.cmd,
    args: [...input.args],
  };
}

export async function resolveToolCommand(input: {
  cmd: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
}): Promise<ResolvedToolCommand> {
  const env = input.env ?? process.env;
  const normalized = normalizePackageManagerInvocation(input);
  const packageManager = packageManagerForCommand(normalized.cmd);

  if (packageManager === 'bun') {
    const bunInstallCandidate = env.BUN_INSTALL
      ? join(
          env.BUN_INSTALL,
          'bin',
          process.platform === 'win32' ? 'bun.exe' : 'bun',
        )
      : undefined;
    if (bunInstallCandidate && await isExecutableFile(bunInstallCandidate)) {
      return { executable: bunInstallCandidate, args: normalized.args, packageManager };
    }

    const pathCandidate = await lookupBunExecutableOnPath(env);
    if (pathCandidate) {
      return { executable: pathCandidate, args: normalized.args, packageManager };
    }

    if (isBunProcessPath(process.execPath) && await isExecutableFile(process.execPath)) {
      return { executable: process.execPath, args: normalized.args, packageManager };
    }
  }

  const lookupCommand = packageManager && (normalized.cmd.includes('/') || normalized.cmd.includes('\\'))
    ? packageManager
    : normalized.cmd;
  const executable = await lookupExecutableOnPath(
    lookupCommand,
    env,
    Boolean(packageManager),
  );
  return {
    executable: executable ?? lookupCommand,
    args: normalized.args,
    packageManager,
  };
}

export async function resolveToolExecutable(input: {
  cmd: string;
  env?: NodeJS.ProcessEnv;
}) {
  const resolved = await resolveToolCommand({
    cmd: input.cmd,
    args: [],
    env: input.env,
  });
  return {
    executable: resolved.executable,
    packageManager: resolved.packageManager,
  };
}

export function parseDirectCommand(command: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;
  let tokenStarted = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      tokenStarted = true;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      tokenStarted = true;
      continue;
    }

    if ((char === "'" || char === "\"") && !quote) {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (char === quote) {
      quote = null;
      tokenStarted = true;
      continue;
    }

    if (!quote && /[|&;<>`$\r\n]/.test(char)) {
      throw new Error(
        "Shell operators are not supported. Provide a direct command and arguments only.",
      );
    }

    if (!quote && /\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote) {
    throw new Error("Unclosed quote in command.");
  }

  if (tokenStarted) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    throw new Error("Command is required.");
  }

  return {
    cmd: tokens[0],
    cmdArgs: tokens.slice(1),
  };
}

export function killProcessTree(childPid: number | undefined) {
  if (typeof childPid !== "number") {
    return;
  }

  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(childPid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
      return;
    }

    process.kill(-childPid, "SIGKILL");
  } catch {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Process already exited or platform refused signal.
    }
  }
}

export type AbortableExecFileResult = {
  stdout: string;
  stderr: string;
};

/**
 * execFile with AbortSignal support. On abort, kills the process tree
 * (detached process groups on POSIX) rather than orphaning children.
 */
export function execFileAbortable(
  file: string,
  args: readonly string[],
  options: ExecFileOptions & { signal?: AbortSignal } = {},
): Promise<AbortableExecFileResult> {
  const { signal, ...execOptions } = options;

  if (signal?.aborted) {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      {
        ...execOptions,
        // Prefer killing the group when we spawn detached-like trees via shell-less exec.
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        cleanup();
        if (error) {
          const err = error as Error & {
            stdout?: string;
            stderr?: string;
            code?: string | number | null;
            killed?: boolean;
          };
          if (signal?.aborted || err.name === "AbortError" || err.killed) {
            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            reject(abortError);
            return;
          }
          err.stdout = typeof stdout === "string" ? stdout : String(stdout ?? "");
          err.stderr = typeof stderr === "string" ? stderr : String(stderr ?? "");
          reject(err);
          return;
        }
        resolve({
          stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
          stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
        });
      },
    );

    const onAbort = () => {
      killProcessTree(child.pid);
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", () => {
      // The execFile callback also fires on spawn failures; clear the abort listener.
      cleanup();
    });
  });
}

/**
 * Spawn a child with AbortSignal hard-kill. Returns the ChildProcess.
 * Caller should still attach stdout/stderr/close handlers.
 */
export function spawnAbortable(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    detached?: boolean;
    windowsHide?: boolean;
  } = {},
) {
  const { signal, detached, ...spawnOptions } = options;

  if (signal?.aborted) {
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  }

  const child = spawn(command, [...args], {
    ...spawnOptions,
    detached: detached ?? process.platform !== "win32",
    windowsHide: options.windowsHide ?? true,
  });

  const onAbort = () => {
    killProcessTree(child.pid);
    try {
      child.kill("SIGKILL");
    } catch {
      // already dead
    }
  };

  signal?.addEventListener("abort", onAbort, { once: true });
  child.on("close", () => {
    signal?.removeEventListener("abort", onAbort);
  });
  child.on("error", () => {
    signal?.removeEventListener("abort", onAbort);
  });

  return child;
}

/** Convenience re-export for tools that do not need abort. */
export { execFileAsync };
