import { execFile, spawn, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SAFE_TOOL_ENV_KEYS = [
  'APPDATA',
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
      env[key] = value;
    }
  }

  return {
    ...env,
    ...overrides,
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
      // callback above also fires; ensure abort listener is cleared on early errors
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
