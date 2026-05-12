import { spawn } from "node:child_process";

export function parseDirectCommand(command: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (const char of command) {
    if ((char === "'" || char === "\"") && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (!quote && /[|&;<>`$]/.test(char)) {
      throw new Error(
        "Shell operators are not supported. Provide a direct command and arguments only.",
      );
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Unclosed quote in command.");
  }

  if (current) {
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
      spawn("taskkill", ["/pid", String(childPid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
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
