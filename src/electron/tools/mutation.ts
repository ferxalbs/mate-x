import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";
import { resolveWorkspacePath } from "./tool-utils";

const execFileAsync = promisify(execFile);

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
  async execute(args, { workspacePath }) {
    const { path, searchString, mutationString, verificationCommand } = args;
    let cmd: string;
    let cmdArgs: string[];

    try {
      ({ cmd, cmdArgs } = parseCommand(String(verificationCommand)));
    } catch (error) {
      return `Mutation failed: ${(error as Error).message}`;
    }

    const targetFile = resolveWorkspacePath(workspacePath, path);

    let originalContent: string;
    try {
      originalContent = await readFile(targetFile, "utf8");

      if (!originalContent.includes(searchString)) {
        return `Mutation failed: The exact searchString was not found in ${path}.`;
      }
    } catch (error) {
       return `Mutation failed: Could not read file ${path} - ${(error as Error).message}`;
    }

    try {
      // Apply the temporary mutation
      const mutatedContent = originalContent.split(searchString).join(mutationString);
      await writeFile(targetFile, mutatedContent, "utf8");

      let commandOutput = "";
      let commandStatus = "";

      // Run verification
      try {
        const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
          cwd: workspacePath,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        });
        commandOutput = stdout + "\\n" + stderr;
        commandStatus = "SUCCESS (Command exited 0)";
      } catch (cmdErr) {
        const normalized = cmdErr as {
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        commandOutput = `${normalized.stdout ?? ""}\\n${normalized.stderr ?? ""}\\n${normalized.message ?? ""}`;
        commandStatus = "FAILED (Command returned non-zero)";
      }

      // Check if the system caught the mutation (usually if testing catches a bug, it throws a non-zero exit)
      const didSystemCatchIt = commandStatus.includes("FAILED");

      let report = `Mutation Injector Report\\n========================\\n`;
      report += `File: ${path}\\n`;
      report += `Mutation: Added glitch [ ${mutationString} ]\\n`;
      report += `Command: \`${cmd} ${cmdArgs.join(" ")}\` -> Result: ${commandStatus}\\n\\n`;
      
      if (didSystemCatchIt) {
        report += `[GOOD] The system correctly caught the injected error (Test/Command failed)!\\n`;
      } else {
        report += `[VULNERABLE] The system FAILED to catch the injected error! The glitch wasn't visible to existing tests/safeguards.\\n`;
      }
      
      report += `\\nOutput snippet:\\n${commandOutput.slice(0, 500)}...\\n`;

      return report;
    } catch (error) {
      return `Error executing mutation lifecycle: ${(error as Error).message}`;
    } finally {
      // SAFETY CRITICAL: ALWAYS restore the original content
      try {
        await writeFile(targetFile, originalContent, "utf8");
      } catch (restoreError) {
        // Very unlikely unless permissions change mid-flight, but critical to catch
        console.error(`CRITICAL: Failed to restore mutation in ${path}`, restoreError);
      }
    }
  },
};
