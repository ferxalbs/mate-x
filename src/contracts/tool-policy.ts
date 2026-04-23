export type ToolRiskClass = "safe" | "sensitive" | "dangerous" | "blocked";

export type ToolImpactType =
  | "file_edit"
  | "shell"
  | "network"
  | "secrets"
  | "external_communication"
  | "package_install"
  | "process_control";

export type ToolPolicyExecutionDecision = "allowed" | "escalation_required" | "blocked";

export interface ToolPolicyClassification {
  toolName: string;
  action: string;
  riskClass: ToolRiskClass;
  impactTypes: ToolImpactType[];
  reason: string;
  allowedByContract: boolean;
  escalationRequired: boolean;
  decision: ToolPolicyExecutionDecision;
  blockedReason?: string;
}
