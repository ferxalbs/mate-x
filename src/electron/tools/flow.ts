import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../tool-service";

const execFileAsync = promisify(execFile);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const flowTraceTool: Tool = {
  name: "flow_trace",
  description:
    "Traces data flow from a source variable to potential sinks. Highly complex cross-file analysis.",
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description:
          'The starting variable or parameter name to trace (e.g., "req.body.username").',
      },
      maxDepth: {
        type: "number",
        description:
          "Maximum number of assignment steps to trace. Defaults to 5.",
      },
    },
    required: ["source"],
  },
  async execute(args, { workspacePath }) {
    const { source, maxDepth = 5 } = args;
    const safeDepth = Math.max(1, Math.min(12, Number(maxDepth) || 5));
    let currentTrace = [source];
    const visitedTerms = new Set<string>();
    const flowPath: string[] = [];

    try {
      for (let depth = 0; depth < safeDepth; depth++) {
        const nextTerms: string[] = [];
        for (const term of currentTrace) {
          if (visitedTerms.has(term)) continue;
          visitedTerms.add(term);

          // Search for assignments: var x = term; or x = term;
          const { stdout } = await execFileAsync(
            "rg",
            ["-n", "--no-heading", "--fixed-strings", `${term}`, "."],
            { cwd: workspacePath },
          );
          const lines = stdout.split("\n").filter(Boolean);
          const escapedTerm = escapeRegex(term);
          const assignmentRegex = new RegExp(
            `^(.+?):(\\d+):(.*?\\b[a-zA-Z0-9_]+)\\s*=\\s*.*?\\b${escapedTerm}\\b`,
          );
          const callRegex = new RegExp(
            `^(.+?):(\\d+):([a-zA-Z0-9_]+)\\(.*\\b${escapedTerm}\\b.*\\)`,
          );

          for (const line of lines) {
            // Capture assignments
            const match = line.match(assignmentRegex);
            if (match) {
              const newVar = match[3].trim().split(/\s+/).pop();
              if (newVar && !visitedTerms.has(newVar)) {
                nextTerms.push(newVar);
                flowPath.push(
                  `Step ${depth + 1}: ${term} -> ${newVar} (Found in ${match[1]}:${match[2]})`,
                );
              }
            }

            // Capture function calls: func(term)
            const callMatch = line.match(callRegex);
            if (callMatch) {
              flowPath.push(
                `Step ${depth + 1}: ${term} passed into function ${callMatch[3]}() in ${callMatch[1]}:${callMatch[2]}`,
              );
            }
          }
        }

        if (nextTerms.length === 0) break;
        currentTrace = nextTerms;
      }

      return flowPath.length > 0
        ? `Traced Data Flow for "${source}":\n${flowPath.join("\n")}`
        : `No significant data flow paths found for "${source}".`;
    } catch (_error) {
      return `Error tracing data flow for "${source}": No occurrences found.`;
    }
  },
};
