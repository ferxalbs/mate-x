import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "../tool-service";
import { policyService } from "../policy-service";
import { resolveWorkspacePath } from "./tool-utils";

const MUTATION_TIMEOUT_MS = 5 * 60 * 1000;
const mutationQueues = new Map<string, Promise<void>>();

async function acquireMutationSlot(workspacePath: string) {
  const previousRun = mutationQueues.get(workspacePath) ?? Promise.resolve();
  let releaseCurrentRun: () => void = () => undefined;
  const currentRun = new Promise<void>((resolve) => {
    releaseCurrentRun = resolve;
  });
  const queuedRun = previousRun.catch((): undefined => undefined).then(() => currentRun);

  mutationQueues.set(workspacePath, queuedRun);
  await previousRun.catch((): undefined => undefined);

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    releaseCurrentRun();
    void queuedRun.finally(() => {
      if (mutationQueues.get(workspacePath) === queuedRun) {
        mutationQueues.delete(workspacePath);
      }
    });
  };
}

function killProcessTree(pid?: number) {
  if (!pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
      return;
    }
    process.kill(-pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Process tree already exited.
      }
    }, 1_000).unref();
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

function parseCommand(command: string) {
  if (/[|&;<>`$()]/.test(command)) {
    throw new Error(
      "Shell operators are not supported. Provide a direct command and arguments only.",
    );
  }

  const tokens =
    command.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map((token) =>
      token.replace(/^['"]|['"]$/g, ""),
    ) ?? [];

  if (tokens.length === 0) {
    throw new Error("verificationCommand is required.");
  }

  return {
    cmd: tokens[0],
    cmdArgs: tokens.slice(1),
  };
}

export const mutationTesterTool: Tool = {
  name: "mutation",
  description:
    "Injects a temporary fault (mutation) into source code, runs a verification command to see if the system catches the invisible glitch, and automatically safely restores the original code.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file to mutate (relative to workspace).",
      },
      searchString: {
        type: "string",
        description: "The exact logic to mutate (e.g., 'if (req.user)').",
      },
      mutationString: {
        type: "string",
        description: "The temporary glitch to inject (e.g., 'if (!req.user)').",
      },
      verificationCommand: {
        type: "string",
        description: "The shell command to run while mutated (e.g., 'bun test' or 'curl http://...').",
      },
    },
    required: ["path", "searchString", "mutationString", "verificationCommand"],
  },
  async execute(args, { workspacePath, trustContract }) {
    const { path, searchString, mutationString, verificationCommand } = args;
    let cmd: string;
    let cmdArgs: string[];

    try {
      ({ cmd, cmdArgs } = parseCommand(String(verificationCommand)));
    } catch (error) {
      return `Mutation failed: ${(error as Error).message}`;
    }

    const targetFile = resolveWorkspacePath(workspacePath, path);
    const releaseMutationSlot = await acquireMutationSlot(workspacePath);
    const startedAt = Date.now();
    const snapshots = new Map<string, string>();

    try {
      const originalContent = await readFile(targetFile, "utf8");
      snapshots.set(targetFile, originalContent);

      if (!originalContent.includes(searchString)) {
        return `Mutation failed: The exact searchString was not found in ${path}.`;
      }

      if (trustContract?.autonomy !== "unrestricted") {
        const approved = await requestMutationApproval({
          workspacePath,
          target: String(path),
          command: `${cmd} ${cmdArgs.join(" ")}`.trim(),
        });
        if (!approved) {
          return JSON.stringify({
            status: "refused",
            reason: "USER_DECLINED_MUTATION_EXECUTION",
            target: String(path),
          });
        }
      }

      const mutatedContent = originalContent.split(searchString).join(mutationString);
      const mutationsInjected = originalContent.split(searchString).length - 1;
      await writeFile(targetFile, mutatedContent, "utf8");

      const commandResult = await runMutationCommand(cmd, cmdArgs, workspacePath);
      const commandStatus = commandResult.timedOut
        ? "MUTATION_TIMEOUT"
        : commandResult.exitCode === 0
          ? "SUCCESS (Command exited 0)"
          : "FAILED (Command returned non-zero)";
      const didSystemCatchIt = commandStatus.includes("FAILED");

      let report = `Mutation Injector Report\\n========================\\n`;
      report += `Status: ${commandResult.timedOut ? "MUTATION_TIMEOUT" : "COMPLETED"}\\n`;
      report += `File: ${path}\\n`;
      report += `Mutation: Added glitch [ ${mutationString} ]\\n`;
      report += `Command: \`${cmd} ${cmdArgs.join(" ")}\` -> Result: ${commandStatus}\\n\\n`;

      if (didSystemCatchIt) {
        report += `[GOOD] The system correctly caught the injected error (Test/Command failed)!\\n`;
      } else if (commandResult.timedOut) {
        report += `[TIMEOUT] Mutation verification exceeded the 5 minute hard timeout.\\n`;
      } else {
        report += `[VULNERABLE] The system FAILED to catch the injected error! The glitch wasn't visible to existing tests/safeguards.\\n`;
      }

      report += `\\nMetrics:\\n`;
      report += `- filesMutated: ${snapshots.size}\\n`;
      report += `- mutationsInjected: ${mutationsInjected}\\n`;
      report += `- mutationsRestored: ${snapshots.size}\\n`;
      report += `- elapsedMs: ${Date.now() - startedAt}\\n`;
      report += `- timeout: ${commandResult.timedOut}\\n`;
      report += `\\nOutput snippet:\\n${commandResult.output.slice(0, 500)}...\\n`;

      return report;
    } catch (error) {
      return `Error executing mutation lifecycle: ${(error as Error).message}`;
    } finally {
      try {
        for (const [filePath, content] of snapshots) {
          await writeFile(filePath, content, "utf8");
        }
      } catch (restoreError) {
        console.error(`CRITICAL: Failed to restore mutation in ${path}`, restoreError);
      } finally {
        releaseMutationSlot();
      }
    }
  },
};

async function requestMutationApproval(input: {
  workspacePath: string;
  target: string;
  command: string;
}) {
  const stop = policyService.createStop({
    runId: `tool-${Date.now()}`,
    workspacePath: input.workspacePath,
    toolName: "mutation",
    severity: "critical",
    policyId: "mutation.execution",
    title: "Run paused: mutation execution requires approval.",
    explanation:
      "Mutation testing temporarily writes faults into source files and executes a verification command. This is high-risk and requires explicit approval.",
    kind: "MUTATION_EXECUTION",
    target: input.target,
    command: input.command,
    metadata: { riskClass: "high" },
    recommendation: "approve_once",
    availableActions: ["approve_once", "abort", "safer_alternative"],
  });
  const resolvedStop = await policyService.waitForResolution(stop.id);
  policyService.markStopCompleted(stop.id);
  return resolvedStop.resolution?.action === "approve_once";
}

function runMutationCommand(cmd: string, cmdArgs: string[], workspacePath: string) {
  return new Promise<{ output: string; exitCode: number | null; timedOut: boolean }>((resolve) => {
    let output = "";
    let finished = false;
    let timedOut = false;
    const child = spawn(cmd, cmdArgs, {
      cwd: workspacePath,
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
      output += `\nMUTATION_TIMEOUT: terminated process tree after ${MUTATION_TIMEOUT_MS / 1000} seconds.`;
      finish(124);
    }, MUTATION_TIMEOUT_MS);
    const finish = (exitCode: number | null) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve({ output, exitCode, timedOut });
    };

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });
    child.stderr?.on("data", (data) => {
      output += `\n[STDERR] ${data.toString()}`;
    });
    child.on("error", (error) => {
      output += `\n[ERROR] ${error.message}`;
      finish(1);
    });
    child.on("close", (code) => {
      if (!timedOut) {
        finish(code);
      }
    });
  });
}
