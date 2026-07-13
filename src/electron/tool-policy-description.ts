import { policyService } from "./policy-service";
import { getToolOperationalMeta } from "./tool-metadata";
import type { Tool } from "./tool-types";

export function buildGovernedToolDescription(tool: Tool) {
  const policy = policyService.classifyToolCall({
    workspacePath: "",
    toolName: tool.name,
    args: {},
  });
  const meta = getToolOperationalMeta(tool.name);

  const impacts =
    policy.impactTypes.length > 0
      ? policy.impactTypes.map((impact) => impact.replaceAll("_", " ")).join(", ")
      : "read-only or diagnostic";

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
    `Policy: default risk class ${policy.riskClass}; impact: ${impacts}. The active Workspace Trust Contract may allow, require approval for, or block this tool based on its arguments.`,
  ].join("\n\n");
}
