import type { EngineeringTaskStatus } from "../contracts/engineering-task";
import { isPreApprovalStatus } from "../contracts/engineering-phase-result";
import type {
  AgentBlockReason,
  AgentOutcome,
} from "../contracts/chat";
import {
  BEHAVIOR_MODE_DEFINITIONS,
  type BehaviorMode,
} from "../contracts/behavior-mode";
import type { WorkspaceTrustContract } from "../contracts/workspace";
import { getToolOperationalMeta } from "./tool-metadata";
import { lazyToolLoaders } from "./tool-registry";
import { evaluateTrustForToolCall } from "./workspace-trust";

export type AgentCapability =
  | "workspace.read"
  | "workspace.write"
  | "command.execute"
  | "network.access"
  | "sensitive.execute"
  | "git.write"
  | "destructive";

export type ToolAuthorizationDecision =
  | {
      decision: "allowed";
      capability: AgentCapability;
    }
  | {
      decision: "needs_approval";
      capability: AgentCapability;
      code:
        | "WORKSPACE_APPROVAL_REQUIRED"
        | "GIT_APPROVAL_REQUIRED"
        | "TASK_APPROVAL_REQUIRED"
        | "HIGH_IMPACT_APPROVAL_REQUIRED";
      summary: string;
    }
  | {
      decision: "blocked";
      capability: AgentCapability;
      outcome: Extract<AgentOutcome, { status: "blocked" }>;
    };

const GIT_WRITE_COMMAND =
  /\bgit\s+(?:add|commit|push|reset|rebase|merge|checkout|switch|branch\s+-[dD])\b/i;
const DESTRUCTIVE_COMMAND =
  /\brm\s+(?:-[^\s]*[rf][^\s]*\s+)?|\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*[df])\b/i;
const HIGH_IMPACT_PATH =
  /^(?:src\/(?:main\.ts|preload\.ts|electron\/|contracts\/)|\.env(?:\.|$)|package\.json$|(?:electron\.)?vite\.config\.)/;

export function classifyToolCapability(
  toolName: string,
  args: Record<string, unknown> = {},
): AgentCapability {
  const command = String(args.command ?? args.script ?? "");
  if (/^(?:mutation|mock_poison|traffic_poison)$/.test(toolName)) {
    return "sensitive.execute";
  }
  if (GIT_WRITE_COMMAND.test(command) || /^(?:git_)?(?:commit|push)$/.test(toolName)) {
    return "git.write";
  }
  if (DESTRUCTIVE_COMMAND.test(command) || /delete|unlink|traffic_poison/i.test(toolName)) {
    return "destructive";
  }

  const meta = getToolOperationalMeta(toolName);
  if (meta.categories.includes("network")) return "network.access";
  if (
    meta.categories.includes("process") ||
    meta.categories.includes("validation")
  ) {
    return "command.execute";
  }
  if (meta.hasSideEffects || meta.categories.includes("mutating")) {
    return "workspace.write";
  }
  return "workspace.read";
}

export function resolveToolAuthorization(input: {
  toolName: string;
  args?: Record<string, unknown>;
  behaviorMode: BehaviorMode;
  workspacePolicy: WorkspaceTrustContract;
  engineeringTaskStatus?: EngineeringTaskStatus | null;
}): ToolAuthorizationDecision {
  const args = input.args ?? {};
  const capability = classifyToolCapability(input.toolName, args);
  const definition = BEHAVIOR_MODE_DEFINITIONS[input.behaviorMode];

  // Precedence is deliberate: mode restrictions and hard workspace limits can
  // never be overridden by an approval. Only an otherwise-authorized action may
  // transition into the needs_approval state.
  if (
    capability !== "workspace.read" &&
    (!definition.allowsMutation ||
      (capability === "command.execute" && !definition.allowsCommands))
  ) {
    const summary =
      input.behaviorMode === "review"
        ? "Review mode only inspects existing work."
        : "Plan mode prepares implementation without changing the repository.";
    return blocked(
      capability,
      "MODE_READ_ONLY",
      summary,
      { type: "change_mode", target: "execute", label: "Switch to Execute" },
    );
  }

  const workspaceError = evaluateTrustForToolCall({
    toolName: input.toolName,
    args,
    contract: input.workspacePolicy,
  });
  if (workspaceError) {
    return blocked(
      capability,
      workspaceError.includes("command")
        ? "COMMAND_NOT_ALLOWED"
        : workspaceError.includes("path")
          ? "WORKSPACE_SCOPE"
          : input.workspacePolicy.writeAccess === "read-only" &&
              capability === "workspace.write"
            ? "WORKSPACE_READ_ONLY"
            : "ACTION_NOT_ALLOWED",
      userWorkspaceSummary(workspaceError),
      { type: "update_workspace_policy", label: "Review workspace policy" },
    );
  }

  if (
    input.engineeringTaskStatus &&
    isPreApprovalStatus(input.engineeringTaskStatus) &&
    capability !== "workspace.read" &&
    capability !== "network.access"
  ) {
    return {
      decision: "needs_approval",
      capability,
      code: "TASK_APPROVAL_REQUIRED",
      summary: "Approve current task before MaTE X changes or validates repository state.",
    };
  }

  if (capability === "git.write") {
    return {
      decision: "needs_approval",
      capability,
      code: "GIT_APPROVAL_REQUIRED",
      summary: "Approve this Git change once.",
    };
  }

  if (capability === "destructive") {
    return blocked(
      capability,
      "DESTRUCTIVE_ACTION",
      "Workspace policy does not permit this destructive action.",
      { type: "update_workspace_policy", label: "Review workspace policy" },
    );
  }

  if (capability === "sensitive.execute") {
    return {
      decision: "needs_approval",
      capability,
      code: "HIGH_IMPACT_APPROVAL_REQUIRED",
      summary: "Approve this security test once.",
    };
  }

  if (
    capability === "workspace.write" &&
    requestedPaths(args).some((requestedPath) => HIGH_IMPACT_PATH.test(requestedPath))
  ) {
    return {
      decision: "needs_approval",
      capability,
      code: "HIGH_IMPACT_APPROVAL_REQUIRED",
      summary: "Approve this security-sensitive repository change once.",
    };
  }

  if (
    input.workspacePolicy.writeAccess === "approval-required" &&
    (capability === "workspace.write" || capability === "command.execute")
  ) {
    return {
      decision: "needs_approval",
      capability,
      code: "WORKSPACE_APPROVAL_REQUIRED",
      summary:
        capability === "workspace.write"
          ? "Approve this repository change once."
          : "Approve this command once.",
    };
  }

  return { decision: "allowed", capability };
}

function requestedPaths(args: Record<string, unknown>): string[] {
  return ["path", "file", "filePath", "relativePath", "target"]
    .map((key) => args[key])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replaceAll("\\", "/").replace(/^\.\/+/, ""));
}

export function resolveAdvertisedToolNames(mode: BehaviorMode): string[] {
  const definition = BEHAVIOR_MODE_DEFINITIONS[mode];
  const names = new Set<string>();
  for (const [name] of lazyToolLoaders) {
    const capability = classifyToolCapability(name);
    if (
      capability === "workspace.read" ||
      (definition.allowsMutation &&
        capability !== "git.write" &&
        capability !== "destructive")
    ) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function blocked(
  capability: AgentCapability,
  code: AgentBlockReason,
  summary: string,
  remediation?: Extract<AgentOutcome, { status: "blocked" }>["blocker"]["remediation"],
): Extract<ToolAuthorizationDecision, { decision: "blocked" }> {
  return {
    decision: "blocked",
    capability,
    outcome: {
      status: "blocked",
      summary,
      blocker: {
        code,
        requestedCapability: capability,
        remediation,
      },
    },
  };
}

function userWorkspaceSummary(error: string): string {
  if (error.includes("outside allowed paths") || error.includes("forbidden path")) {
    return "Requested path is outside this workspace's allowed scope.";
  }
  if (error.includes("command")) {
    return "Workspace policy does not allow this command.";
  }
  if (error.includes("repository writes are disabled")) {
    return "Workspace is read-only.";
  }
  return "Workspace policy does not allow this action.";
}
