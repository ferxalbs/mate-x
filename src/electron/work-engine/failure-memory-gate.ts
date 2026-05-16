import { failureMemoryEngine } from "../failure-memory-engine";
import { renderFailureMemoryInstructionFromSummaries } from "./failure-memory-gate-core";

export async function findFailureMemoryBeforeRetry(input: {
  workspaceId: string;
  command?: string;
  output?: string;
  limit?: number;
}) {
  return failureMemoryEngine.findSimilarFailures({
    workspaceId: input.workspaceId,
    command: input.command,
    output: input.output,
    limit: input.limit ?? 3,
  });
}

export function renderFailureMemoryInstruction(matches: Awaited<ReturnType<typeof findFailureMemoryBeforeRetry>>) {
  if (matches.length === 0) {
    return renderFailureMemoryInstructionFromSummaries([]);
  }

  return renderFailureMemoryInstructionFromSummaries(
    matches.map((match) => ({
      command: match.failure.command,
      status: match.failure.resolvedAt ? "resolved" : "open",
      signature: match.failure.errorSignature,
      lastSeenAt: match.failure.lastSeenAt,
    })),
  );
}
