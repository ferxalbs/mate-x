import { getToolOperationalMeta } from "./tool-metadata";
import type { Tool } from "./tool-types";

export function buildGovernedToolDescription(tool: Tool) {
  const meta = getToolOperationalMeta(tool.name);

  const ops = [
    meta.hasSideEffects ? "mutates state" : "no side effects",
    meta.idempotent ? "idempotent" : "not idempotent",
    meta.retryable ? "retryable on transient failure" : "do not auto-retry",
    meta.cancellable ? "cancellable" : "not cancellable",
    meta.parallelSafe ? "parallel-safe" : "avoid concurrent use",
    meta.requiresVerification ? "verify after success" : null,
  ]
    .filter(Boolean)
    .join("; ");

  return [
    tool.description,
    `Ops: ${ops}. Default timeout ~${Math.round(meta.timeoutMs / 1000)}s.`,
  ].join("\n\n");
}
