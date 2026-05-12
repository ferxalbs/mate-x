import { spawn } from "node:child_process";

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
