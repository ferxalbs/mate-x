import path from "node:path";

import type {
  PolicyRunState,
  PolicyStop,
  PolicyStopAction,
  PolicyStopAttemptKind,
  ResolvePolicyStopRequest,
} from "../contracts/policy";
import type {
  ToolImpactType,
  ToolPolicyClassification,
  ToolRiskClass,
} from "../contracts/tool-policy";
import type { WorkspaceTrustContract } from "../contracts/workspace";

type PolicyEvaluationInput = {
  runId: string;
  workspacePath: string;
  toolName: string;
  args: Record<string, unknown>;
  contract?: WorkspaceTrustContract;
};

type PolicyFinding = {
  severity: PolicyStop["severity"];
  policyId: string;
  title: string;
  explanation: string;
  kind: PolicyStopAttemptKind;
  target?: string;
  command?: string;
  metadata?: Record<string, unknown>;
  recommendation: PolicyStopAction;
  availableActions: PolicyStopAction[];
};

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-[^\n]*[rf][^\n]*\s+(\/|~|\*)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\n]*[df][^\n]*/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bchown\s+-R\b/i,
  /\bsudo\b/i,
  /\bcurl\b[^\n|;&]*\|\s*(sh|bash|zsh)\b/i,
  /\bwget\b[^\n|;&]*\|\s*(sh|bash|zsh)\b/i,
];

const PATH_ARG_KEYS = [
  "path",
  "file",
  "filePath",
  "relativePath",
  "specificPath",
  "scope",
  "target",
];

const COMMAND_ARG_KEYS = ["command", "cmd", "script"];
const SECRET_ARG_KEYS = ["apiKey", "token", "secret", "password", "credential"];

const HIGH_IMPACT_PATH_PATTERNS = [
  /^src\/preload\.ts$/,
  /^src\/main\.ts$/,
  /^src\/electron\//,
  /^src\/contracts\//,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)package\.json$/,
  /(^|\/)vite\.config\./,
  /(^|\/)electron\.vite\.config\./,
];

class PolicyService {
  private stops = new Map<string, PolicyStop>();

  classifyToolCall(input: Omit<PolicyEvaluationInput, "runId">): ToolPolicyClassification {
    const action = this.getRequiredAction(input.toolName, input.args);
    const impactTypes = this.classifyImpactTypes(input.toolName, input.args);
    const policyIssue = this.findPolicyIssue({
      ...input,
      runId: "classification",
    });
    const riskClass = policyIssue
      ? "blocked"
      : this.classifyRisk(input.toolName, input.args, impactTypes);
    const allowedByContract = this.isAllowedByContract(action, input.contract);
    const escalationRequired =
      riskClass === "dangerous" ||
      riskClass === "blocked" ||
      (!allowedByContract && riskClass !== "safe");
    const blockedReason = policyIssue?.explanation ??
      (!allowedByContract ? `Workspace Trust Contract does not allow action "${action}".` : undefined);

    return {
      toolName: input.toolName,
      action,
      riskClass,
      impactTypes,
      reason: policyIssue?.explanation ?? this.describeRisk(riskClass, impactTypes),
      allowedByContract,
      escalationRequired,
      decision: policyIssue || !allowedByContract
        ? "blocked"
        : escalationRequired
          ? "escalation_required"
          : "allowed",
      blockedReason,
    };
  }

  evaluateToolCall(input: PolicyEvaluationInput): PolicyStop | null {
    const finding = this.findPolicyIssue(input);

    if (!finding) {
      return null;
    }

    const stop: PolicyStop = {
      id: `policy-stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId: input.runId,
      workspacePath: input.workspacePath,
      createdAt: new Date().toISOString(),
      severity: finding.severity,
      policyId: finding.policyId,
      title: finding.title,
      explanation: finding.explanation,
      attemptedAction: {
        kind: finding.kind,
        toolName: input.toolName,
        target: finding.target,
        command: finding.command,
        metadata: finding.metadata,
      },
      recommendation: finding.recommendation,
      availableActions: finding.availableActions,
      status: "open",
    };

    this.stops.set(stop.id, stop);
    return stop;
  }

  listStops(runId?: string) {
    const stops = Array.from(this.stops.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );

    return runId ? stops.filter((stop) => stop.runId === runId) : stops;
  }

  getRunState(runId: string): PolicyRunState {
    const openStops = this.listStops(runId).filter(
      (stop) => stop.status === "open",
    );

    return {
      runId,
      status: openStops.length > 0 ? "paused" : "clear",
      openStops,
    };
  }

  resolveStop(request: ResolvePolicyStopRequest): PolicyStop {
    if (!request || typeof request !== "object") {
      throw new Error("Policy stop resolution request is required.");
    }

    if (!this.isPolicyStopAction(request.action)) {
      throw new Error("Invalid policy stop resolution action.");
    }

    if (typeof request.stopId !== "string" || !request.stopId.trim()) {
      throw new Error("Policy stop id is required.");
    }

    const stop = this.stops.get(request.stopId);

    if (!stop) {
      throw new Error("Policy stop not found.");
    }

    if (stop.status === "resolved") {
      return stop;
    }

    const resolvedStop: PolicyStop = {
      ...stop,
      status: "resolved",
      resolution: {
        action: request.action,
        resolvedAt: new Date().toISOString(),
        scopeExpansion: request.scopeExpansion,
      },
    };

    this.stops.set(stop.id, resolvedStop);
    return resolvedStop;
  }

  private findPolicyIssue(input: PolicyEvaluationInput): PolicyFinding | null {
    const secretKey = Object.keys(input.args).find((key) =>
      SECRET_ARG_KEYS.some((secretKey) =>
        key.toLowerCase().includes(secretKey.toLowerCase()),
      ),
    );

    if (secretKey) {
      return {
        severity: "critical",
        policyId: "secret.unauthorized_access",
        title: "Run paused: attempted action included a secret-like argument.",
        explanation:
          "The agent attempted to use an argument that looks like a secret. Secret values must be resolved by trusted main-process services and never passed through tool calls.",
        kind: "secret",
        metadata: { argumentName: secretKey },
        recommendation: "abort",
        availableActions: ["abort", "safer_alternative"],
      };
    }

    const command = this.extractCommand(input.args);
    if (
      command &&
      DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
    ) {
      return {
        severity: "critical",
        policyId: "command.dangerous",
        title: "Run paused: command requires risk approval.",
        explanation:
          "The agent attempted to execute a destructive or privileged command. This requires explicit user review before any execution can continue.",
        kind: "command",
        command,
        recommendation: "abort",
        availableActions: ["approve_once", "abort", "safer_alternative"],
      };
    }

    const outOfScopePath = this.findOutOfScopePath(input);
    if (outOfScopePath) {
      return {
        severity: "critical",
        policyId: this.isWriteTool(input.toolName)
          ? "workspace.scope.write"
          : "workspace.scope.read",
        title: "Run paused: attempted action exceeded workspace contract.",
        explanation:
          "The agent attempted to access a path outside the active workspace. Workspace scope must be expanded explicitly before this action can run.",
        kind: this.isWriteTool(input.toolName) ? "file_write" : "file_read",
        target: outOfScopePath,
        recommendation: "abort",
        availableActions: [
          "approve_once",
          "expand_scope",
          "abort",
          "safer_alternative",
        ],
      };
    }

    const highImpactPath = this.findHighImpactPath(input.args);
    if (highImpactPath && this.isWriteTool(input.toolName)) {
      return {
        severity: "warning",
        policyId: "change.high_impact",
        title: "Run paused: high-impact security surface changed.",
        explanation:
          "The agent attempted to modify main-process, preload, shared contract, environment, or build configuration files. These changes affect MaTE X trust boundaries and require explicit approval.",
        kind: "code_change",
        target: highImpactPath,
        recommendation: "safer_alternative",
        availableActions: ["approve_once", "abort", "safer_alternative"],
      };
    }

    return null;
  }

  private extractCommand(args: Record<string, unknown>) {
    for (const key of COMMAND_ARG_KEYS) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  private findOutOfScopePath(input: PolicyEvaluationInput) {
    for (const key of PATH_ARG_KEYS) {
      const value = input.args[key];
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }

      const requestedPath = value.trim();
      if (!path.isAbsolute(requestedPath) && !requestedPath.startsWith("..")) {
        continue;
      }

      const absolutePath = path.resolve(input.workspacePath, requestedPath);
      const relativePath = path.relative(input.workspacePath, absolutePath);

      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return requestedPath;
      }
    }

    return null;
  }

  private findHighImpactPath(args: Record<string, unknown>) {
    const values = Object.values(args).flatMap((value) =>
      typeof value === "string" ? value.split(/\s+/) : [],
    );

    return (
      values.find((value) => {
        const normalized = value.replace(/^["'`]+|["'`,:;]+$/g, "");
        return HIGH_IMPACT_PATH_PATTERNS.some((pattern) =>
          pattern.test(normalized),
        );
      }) ?? null
    );
  }

  private isWriteTool(toolName: string) {
    return /patch|write|edit|mutation/i.test(toolName);
  }

  private classifyRisk(
    toolName: string,
    args: Record<string, unknown>,
    impactTypes: ToolImpactType[],
  ): ToolRiskClass {
    if (this.extractCommand(args) || impactTypes.includes("package_install")) {
      return "dangerous";
    }

    if (
      this.isWriteTool(toolName) ||
      impactTypes.includes("network") ||
      impactTypes.includes("external_communication") ||
      impactTypes.includes("secrets") ||
      impactTypes.includes("process_control")
    ) {
      return "sensitive";
    }

    return "safe";
  }

  private classifyImpactTypes(
    toolName: string,
    args: Record<string, unknown>,
  ): ToolImpactType[] {
    const impacts = new Set<ToolImpactType>();
    const command = this.extractCommand(args);

    if (this.isWriteTool(toolName)) impacts.add("file_edit");
    if (toolName === "sandbox_run" || command) impacts.add("shell");
    if (/cve|deps|network|supermemory|traffic|poison/i.test(toolName)) impacts.add("network");
    if (/secret|env|auth/i.test(toolName)) impacts.add("secrets");
    if (/supermemory|pdf_report/i.test(toolName)) impacts.add("external_communication");
    if (command && /\b(bun|npm|pnpm|yarn)\s+(add|install|i)\b/i.test(command)) {
      impacts.add("package_install");
      impacts.add("network");
      impacts.add("file_edit");
    }
    if (/mock_poison|traffic_poison|fuzzer|sandbox_run/i.test(toolName)) {
      impacts.add("process_control");
    }

    return Array.from(impacts);
  }

  private describeRisk(riskClass: ToolRiskClass, impactTypes: ToolImpactType[]) {
    if (riskClass === "safe") {
      return "Read-only local inspection with no meaningful side effects.";
    }

    if (riskClass === "dangerous") {
      return "Can execute commands, install code, modify dependency state, or affect processes.";
    }

    if (impactTypes.length === 0) {
      return "Requires policy tracking because the operation may touch sensitive runtime context.";
    }

    return `Touches ${impactTypes.map((impact) => impact.replaceAll("_", " ")).join(", ")} and requires runtime policy review.`;
  }

  private getRequiredAction(toolName: string, args: Record<string, unknown>) {
    if (this.isWriteTool(toolName)) return "patch";
    if (toolName === "run_tests" || toolName === "sandbox_run") return "test";
    if (toolName === "rg" || "pattern" in args || "query" in args) return "search";
    return "read";
  }

  private isAllowedByContract(action: string, contract?: WorkspaceTrustContract) {
    if (!contract || contract.autonomy === "unrestricted") {
      return true;
    }

    return contract.allowedActions.includes(action) && !contract.blockedActions.includes(action);
  }

  private isPolicyStopAction(action: string): action is PolicyStopAction {
    return (
      action === "approve_once" ||
      action === "expand_scope" ||
      action === "abort" ||
      action === "safer_alternative"
    );
  }
}

export const policyService = new PolicyService();
