import { policyService } from "./policy-service";
import type { Tool } from "./tool-types";

export function buildGovernedToolDescription(tool: Tool) {
  const policy = policyService.classifyToolCall({
    workspacePath: "",
    toolName: tool.name,
    args: {},
  });

  const impacts =
    policy.impactTypes.length > 0
      ? policy.impactTypes.map((impact) => impact.replaceAll("_", " ")).join(", ")
      : "read-only or diagnostic";

  return [
    tool.description,
    `Policy: default risk class ${policy.riskClass}; impact: ${impacts}. The active Workspace Trust Contract may allow, require approval for, or block this tool based on its arguments.`,
  ].join("\n\n");
}
