import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AgentToolCall } from "./types";
import type { AgentOutcome, ToolEvent } from "../../../contracts/chat";
import type { AppSettings } from "../../../contracts/settings";
import { policyService } from "../../policy-service";
import { toolService } from "../../tool-service";
import { isToolFailureOutput, parseToolArguments, truncateToolOutputForModel, withTimeout } from "./helpers";
import { resolveToolExecutionTimeoutMs } from "./config";
import type { EngineeringTaskStatus } from "../../../contracts/engineering-task";
import { normalizeToolEvidence } from "../../work-engine/execution-evidence";
import { resolveToolAuthorization } from "../../capability-resolver";
import type { BehaviorMode } from "../../../contracts/behavior-mode";
import type { WorkStrategy } from "../../../contracts/work-objective";
import { createPublicToolProgress } from "./public-tool-progress";
import { resolveToolExecutionPolicy } from "./tool-requirement";
import type { ToolExecutionPolicy } from "../../../contracts/agent-run-trace";
import {
  isValidationLikeCommand,
  isValidationResolutionCause,
  validationRequirementForCommand,
} from "../../validation-command";
import {
  redactSecretPayload,
  redactSensitiveText,
} from "../../secret-redaction";

export async function executeAgentToolCall(
  input: Parameters<typeof executeAgentToolCallInternal>[0],
): Promise<Awaited<ReturnType<typeof executeAgentToolCallInternal>>> {
  const result = await executeAgentToolCallInternal(input);
  const safeEvents = redactSecretPayload(input.events);
  input.events.splice(0, input.events.length, ...safeEvents);
  return {
    ...result,
    content: redactSensitiveText(result.content),
    toolExecution: redactSecretPayload(result.toolExecution),
  };
}

async function executeAgentToolCallInternal({
  toolCall,
  toolIndex,
  iteration,
  snapshot,
  events,
  emitProgress,
  appSettings,
  runId,
  engineeringTaskStatus,
  behaviorMode,
  workStrategy,
  signal,
}: {
  toolCall: AgentToolCall;
  toolIndex: number;
  iteration: number;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  emitProgress: () => void;
  appSettings: AppSettings;
  runId: string;
  /** Control-plane status authority for pre-approval tool restrictions. */
  engineeringTaskStatus?: EngineeringTaskStatus | null;
  behaviorMode: BehaviorMode;
  workStrategy?: WorkStrategy;
  signal?: AbortSignal;
}): Promise<{
  toolCallId: string;
  content: string;
  toolExecution: ToolExecutionRecord;
  outcome?: AgentOutcome;
  executionPolicy: ToolExecutionPolicy;
}> {
  const toolName = toolCall.name;
  const executionPolicy = resolveToolExecutionPolicy(toolName, behaviorMode);
  const eventId = `tool-${iteration}-${toolIndex}-${toolName}`;
  const rawArguments = toolCall.arguments;
  let toolArgs: Record<string, unknown>;

  try {
    toolArgs = parseToolArguments(rawArguments);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Invalid tool arguments.";
    events.push({
      id: eventId,
      executionId: toolCall.id,
      label: "Action could not start",
      detail: reason,
      status: "error",
      visibility: "technical",
    });
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: `Tool argument parsing failed for ${toolName}: ${reason}`,
      toolExecution: {
        toolName,
        args: {},
        output: `Tool argument parsing failed for ${toolName}: ${reason}`,
        evidence: normalizeToolEvidence(
          toolName,
          {},
          `Tool argument parsing failed for ${toolName}: ${reason}`,
          { status: "failed", error: reason },
        ),
      } satisfies ToolExecutionRecord,
      executionPolicy,
    };
  }

  const authorization = resolveToolAuthorization({
    toolName,
    args: toolArgs,
    behaviorMode,
    workStrategy,
    workspacePolicy: snapshot.trustContract,
    engineeringTaskStatus,
  });
  if (authorization.decision === "blocked") {
    return blockedToolResult({
      toolCallId: toolCall.id,
      toolName,
      toolArgs,
      eventId,
      events,
      emitProgress,
      outcome: authorization.outcome,
      executionPolicy,
    });
  }

  const policyStop =
    authorization.decision === "needs_approval"
      ? policyService.createStop({
          runId,
          workspaceId: snapshot.workspace.id,
          workspacePath: snapshot.workspace.path,
          toolName,
          requiredCapability: authorization.capability,
          // The policy service HMACs the exact in-memory args for approval
          // binding; it stores only the resulting digest, never these values.
          operationArgs: toolArgs,
          severity: "warning",
          policyId: authorization.code,
          title: authorization.summary,
          explanation: authorization.summary,
          kind:
            authorization.capability === "workspace.write"
              ? "file_write"
              : authorization.capability === "network.access"
                ? "network"
                : "command",
          target: authorization.capability,
          recommendation: "approve_once",
          availableActions: ["approve_once", "abort"],
        })
      : null;
  let approvedPolicyStopId: string | undefined;
  let approvedValidationOverride = false;

  if (policyStop) {
    events.push({
      id: eventId,
      executionId: toolCall.id,
      label: "Approval required",
      detail: policyStop.title,
      status: "active",
      visibility: "public",
    });
    emitProgress();

    let resolvedStop;
    try {
      resolvedStop = await policyService.waitForResolution(policyStop.id, signal);
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "AbortError";
      const cancelledMessage = cancelled
        ? "Approval was cancelled."
        : "Approval could not be completed.";
      const toolEvent = events.find((event) => event.id === eventId);
      if (toolEvent) {
        toolEvent.status = "error";
        toolEvent.detail = cancelledMessage;
      }
      policyService.markStopFailed(policyStop.id);
      emitProgress();

      const outcome: AgentOutcome = cancelled
        ? {
            status: "blocked",
            summary: cancelledMessage,
            blocker: {
              code: "APPROVAL_DENIED",
              requestedCapability: authorization.capability,
            },
          }
        : {
            status: "failed",
            summary: cancelledMessage,
            diagnostic: { code: "APPROVAL_FAILED", message: cancelledMessage },
          };
      return {
        toolCallId: toolCall.id,
        content: JSON.stringify(outcome),
        outcome,
        toolExecution: {
          toolName,
          args: redactSecretPayload(toolArgs),
          output: cancelledMessage,
          parsedOutput: {
            policyStop,
            status: cancelled ? "cancelled" : "error",
          },
          evidence: normalizeToolEvidence(toolName, redactSecretPayload(toolArgs), cancelledMessage, {
            policyStop,
            status: cancelled ? "cancelled" : "error",
          }),
        } satisfies ToolExecutionRecord,
        executionPolicy,
      };
    }
    const toolEvent = events.find((event) => event.id === eventId);
    if (resolvedStop.resolution?.action !== "approve_once") {
      const declinedMessage = "Action cancelled.";
      const outcome: AgentOutcome = {
        status: "blocked",
        summary: declinedMessage,
        blocker: {
          code: "APPROVAL_DENIED",
          requestedCapability: authorization.capability,
        },
      };
      if (toolEvent) {
        toolEvent.status = "done";
        toolEvent.detail = declinedMessage;
      }
      policyService.markStopCompleted(policyStop.id);
      emitProgress();

      return {
        toolCallId: toolCall.id,
        content: JSON.stringify(outcome),
        outcome,
        toolExecution: {
          toolName,
          args: redactSecretPayload(toolArgs),
          output: declinedMessage,
          parsedOutput: {
            policyStop: resolvedStop,
            status: "declined",
          },
          evidence: normalizeToolEvidence(toolName, redactSecretPayload(toolArgs), declinedMessage, {
            policyStop: resolvedStop,
            status: "declined",
          }),
        } satisfies ToolExecutionRecord,
        executionPolicy,
      };
    }

    approvedPolicyStopId = policyStop.id;
    const currentAuthority = await policyService.resolveCurrentAuthority({
      runId,
      workspaceId: snapshot.workspace.id,
      workspacePath: snapshot.workspace.path,
    });
    const currentAuthorization = currentAuthority
      ? resolveToolAuthorization({
          toolName,
          args: toolArgs,
          ...currentAuthority,
        })
      : null;
    if (!currentAuthorization || currentAuthorization.decision === "blocked") {
      policyService.markStopFailed(policyStop.id);
      const outcome: Extract<AgentOutcome, { status: "blocked" }> =
        currentAuthorization?.decision === "blocked"
          ? currentAuthorization.outcome
          : {
              status: "blocked",
              summary: "The approved operation no longer has an active execution context.",
              blocker: {
                code: "ACTION_NOT_ALLOWED",
                requestedCapability: authorization.capability,
              },
            };
      return blockedToolResult({
        toolCallId: toolCall.id,
        toolName,
        toolArgs,
        eventId,
        events,
        emitProgress,
        outcome,
        executionPolicy,
      });
    }
    if (toolEvent) {
      Object.assign(
        toolEvent,
        createPublicToolProgress(toolName, redactSecretPayload(toolArgs)),
      );
    }
    approvedValidationOverride = toolName === "run_tests" || toolName === "sandbox_run";
    emitProgress();
  }

  if (!policyStop) {
    events.push({
      id: eventId,
      executionId: toolCall.id,
      ...createPublicToolProgress(toolName, redactSecretPayload(toolArgs)),
    });
    emitProgress();
  }

  try {
    const toolTimeoutMs = resolveToolExecutionTimeoutMs(toolName, toolArgs);
    const abortController = new AbortController();
    const result = await withTimeout(
      toolService.callTool(toolName, toolArgs, {
        workspacePath: snapshot.workspace.path,
        trustContract: snapshot.trustContract,
        settings: appSettings,
        signal: abortController.signal,
        runId,
        authority: {
          behaviorMode,
          workStrategy,
          workspacePolicy: snapshot.trustContract,
          engineeringTaskStatus,
        },
        approvedPolicyStopId,
      }),
      toolTimeoutMs,
      `Tool ${toolName} timed out after ${Math.round(toolTimeoutMs / 1000)}s.`,
      { abortController },
    );

    const rawResult = String(result ?? "");
    const parsedOutput = tryParseJsonObject(rawResult);
    const outputIndicatesFailure = isToolFailureOutput(rawResult);
    const preliminaryEvidence = normalizeToolEvidence(
      toolName,
      toolArgs,
      rawResult,
      parsedOutput ?? undefined,
    );
    approvedValidationOverride = Boolean(
      (policyStop &&
        (toolName === "run_tests" || toolName === "sandbox_run") &&
        isValidationLikeCommand(
          [
            toolArgs.command ?? toolArgs.script ?? toolName,
            ...(Array.isArray(toolArgs.args) ? toolArgs.args : []),
          ].filter((value): value is string => typeof value === "string").join(" "),
        )) ||
      (parsedOutput?.validationExecution &&
        typeof parsedOutput.validationExecution === "object" &&
        (parsedOutput.validationExecution as Record<string, unknown>).authorization === "approved_override"),
    );
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      Object.assign(
        toolEvent,
        createPublicToolProgress(
          toolName,
          redactSecretPayload(toolArgs),
          outputIndicatesFailure ? "failed" : "completed",
          redactSecretPayload(parsedOutput ?? undefined),
        ),
      );
    }
    if (policyStop) {
      if (outputIndicatesFailure) {
        policyService.markStopFailed(policyStop.id);
      } else {
        policyService.markStopCompleted(policyStop.id);
      }
    }
    if (
      outputIndicatesFailure &&
      (toolName === "run_tests" || toolName === "sandbox_run") &&
      !isValidationResolutionCause(preliminaryEvidence.validationCause)
    ) {
      const { failureMemoryEngine } = await import("../../failure-memory-engine");
      await failureMemoryEngine.recordFailure({
        workspaceId: snapshot.workspace.id,
        command: redactSensitiveText(String(toolArgs.command ?? toolArgs.script ?? toolName)),
        output: redactSensitiveText(rawResult),
      }).catch((error) => {
        console.warn("Failure memory record failed:", error);
      });
    }
    if (!outputIndicatesFailure && (toolName === "run_tests" || toolName === "sandbox_run")) {
      const { failureMemoryEngine } = await import("../../failure-memory-engine");
      await failureMemoryEngine.recordResolution({
        workspaceId: snapshot.workspace.id,
        command: redactSensitiveText(String(toolArgs.command ?? toolArgs.script ?? toolName)),
        retryFixed: true,
      }).catch((error) => {
        console.warn("Failure memory resolution failed:", error);
      });
    }
    emitProgress();

    // Enrich for Evidence Pack grounding: proof-producing tools (edits, traces, validation,
    // browser probes, etc.) contribute structured signals that flow through ToolExecutionRecord
    // into buildEvidencePack, VTS, filesModified rescue, commandsExecuted, and the on-disk
    // attestation / compliance ZIP. This is the primary mechanism that makes packs "real"
    // instead of model-narrative only.
    const enrichedParsed = enrichParsedForEvidence(
      toolName,
      parsedOutput,
      toolArgs,
      rawResult,
      !outputIndicatesFailure,
      toolCall.id,
      approvedValidationOverride,
    );
    const modelContent = truncateToolOutputForModel(
      toolName,
      redactSensitiveText(rawResult),
    );
    const evidence = normalizeToolEvidence(
      toolName,
      toolArgs,
      rawResult,
      enrichedParsed ?? parsedOutput ?? undefined,
    );
    const finalValidationAuthorization = evidence.validationAuthorization ??
      (approvedValidationOverride ? "approved_override" as const : undefined);
    if (finalValidationAuthorization) {
      evidence.validationAuthorization = finalValidationAuthorization;
    }
    return {
      toolCallId: toolCall.id,
      content: modelContent,
      toolExecution: {
        toolName,
        args: redactSecretPayload(toolArgs),
        output: redactSensitiveText(rawResult),
        parsedOutput: enrichedParsed ?? parsedOutput ?? undefined,
        evidence,
        validationAuthorization: finalValidationAuthorization,
      } satisfies ToolExecutionRecord,
      executionPolicy,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Tool ${toolName} failed.`;
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      Object.assign(
        toolEvent,
        createPublicToolProgress(
          toolName,
          redactSecretPayload(toolArgs),
          "failed",
        ),
      );
    }
    if (policyStop) {
      policyService.markStopFailed(policyStop.id);
    }
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: JSON.stringify({
        status: "failed",
        code: "TOOL_EXECUTION_FAILED",
        message: safeToolDiagnostic(message),
      }),
      toolExecution: {
        toolName,
        args: redactSecretPayload(toolArgs),
        output: redactSensitiveText(`Tool ${toolName} failed: ${message}`),
        parsedOutput: { status: "error", error: redactSensitiveText(message) },
        validationAuthorization:
          approvedValidationOverride ? "approved_override" : undefined,
        evidence: normalizeToolEvidence(
          toolName,
          redactSecretPayload(toolArgs),
          redactSensitiveText(`Tool ${toolName} failed: ${message}`),
          { status: "error", error: redactSensitiveText(message) },
        ),
      } satisfies ToolExecutionRecord,
      executionPolicy,
    };
  }
}

function blockedToolResult(input: {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  eventId: string;
  events: ToolEvent[];
  emitProgress: () => void;
  outcome: Extract<AgentOutcome, { status: "blocked" }>;
  executionPolicy: ToolExecutionPolicy;
}) {
  const publicProgress = createPublicToolProgress(
    input.toolName,
    redactSecretPayload(input.toolArgs),
    "failed",
  );
  const blockedLabel =
    publicProgress.type === "validation"
      ? `${publicProgress.label.replace(/ failed$/i, "")} blocked by policy`
      : publicProgress.type === "edit"
        ? "Edit blocked by policy"
        : "Action blocked by policy";
  const blockedDetail =
    publicProgress.type === "validation"
      ? `${publicProgress.label.replace(/ failed$/i, "")} could not run because workspace policy does not allow its command.`
      : publicProgress.type === "edit"
        ? "Workspace policy did not allow the requested edit."
        : "Workspace policy did not allow the requested operation.";
  const event = input.events.find((candidate) => candidate.id === input.eventId);
  if (event) {
    Object.assign(event, publicProgress);
    event.executionId = input.toolCallId;
    event.label = blockedLabel;
    event.detail = blockedDetail;
    event.status = "blocked";
  } else {
    input.events.push({
      id: input.eventId,
      executionId: input.toolCallId,
      ...publicProgress,
      label: blockedLabel,
      detail: blockedDetail,
      status: "blocked",
    });
  }
  input.emitProgress();
  const outcome =
    publicProgress.type === "validation"
      ? { ...input.outcome, summary: blockedDetail }
      : input.outcome;
  const serialized = JSON.stringify(outcome);
  return {
    toolCallId: input.toolCallId,
    content: serialized,
    outcome,
    toolExecution: {
      toolName: input.toolName,
      args: redactSecretPayload(input.toolArgs),
      output: serialized,
      parsedOutput: {
        status: "blocked",
        outcome,
      },
      evidence: normalizeToolEvidence(
        input.toolName,
        redactSecretPayload(input.toolArgs),
        serialized,
        {
          status: "blocked",
          outcome,
        },
      ),
    } satisfies ToolExecutionRecord,
    executionPolicy: input.executionPolicy,
  };
}

function safeToolDiagnostic(message: string) {
  return redactSensitiveText(message).replace(/\s+/g, " ").trim().slice(0, 500) || "Action failed.";
}

function tryParseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Post-process parsed tool output for high-signal security-proof tools so that
 * EvidencePack / VTS / attestation see concrete, machine-readable outcomes
 * (paths actually edited, traces produced, validation results, repro status, etc.)
 * instead of only free-form text or raw args.
 *
 * We keep validation provenance in the parsed output and typed execution record.
 * The evidence-pack builder and VTS already poke into parsedOutput for exitCode,
 * summary, status, and (after our Phase A-1 changes) paths.
 */
function enrichParsedForEvidence(
  toolName: string,
  parsed: Record<string, unknown> | null,
  args: Record<string, unknown>,
  rawOutput: string,
  success: boolean,
  toolCallId: string,
  approvedValidationOverride = false,
): Record<string, unknown> | null {
  const base: Record<string, unknown> = parsed ? { ...parsed } : {};

  // Always ensure a usable summary for commandsExecuted cards
  if (!base.summary && typeof rawOutput === "string") {
    base.summary = rawOutput.slice(0, 200);
  }

  const lowerName = toolName.toLowerCase();

  // === Patch / edit tools (the source of "filesModified" in practice) ===
  if (lowerName.includes("file_editor") || lowerName.includes("auto_patch") || lowerName.includes("patch") || lowerName.includes("edit")) {
    if (args.path && typeof args.path === "string") base.path = args.path;
    if (args.file && typeof args.file === "string") base.path = args.file as string;
    base.status = success ? "success" : "failed";
    // If the underlying tool already returned a diff or before/after, keep it; otherwise the
    // git status + tool arg scraping (Phase A-1) will still rescue the path for filesModified.
    if (typeof (base as any).diff === "string") {
      base.diffSummary = String((base as any).diff).slice(0, 300);
    }
  }

  // === Proof / trace / revalidation tools ===
  if (lowerName.includes("security_path_trace") || lowerName.includes("trace")) {
    base.evidenceType = "security_path_trace";
    base.status = success ? "success" : "failed";
    if (base.path == null && args.target) base.path = args.target;
  }
  if (lowerName.includes("candidate_revalidator") || lowerName.includes("revalidator")) {
    base.evidenceType = "candidate_revalidator";
    base.status = success ? "success" : "failed";
  }

  // === Validation / reproduction (sandbox_run, run_tests) ===
  if (lowerName === "run_tests" || lowerName.includes("sandbox_run")) {
    base.evidenceType = "validation";
    // Many of these already return {status, exitCode, summary, planId, scope}
    // We just make sure exitCode is top-level for the pack builder's commandsExecuted.
    if (typeof base.exitCode === "undefined" && typeof (base as any).exit === "number") {
      base.exitCode = (base as any).exit;
    }
    const reportExitCode = Number(rawOutput.match(/\bExit code:\s*(-?\d+)\b/i)?.[1]);
    const exitCode = typeof base.exitCode === "number"
      ? base.exitCode
      : Number.isFinite(reportExitCode)
        ? reportExitCode
        : undefined;
    const command = typeof base.command === "string"
      ? base.command
      : [args.command, ...(Array.isArray(args.args) ? args.args : [])]
          .filter((value): value is string => typeof value === "string")
          .join(" ")
          .trim();
    const existingExecution = base.validationExecution;
    if (command) {
      base.validationExecution = {
        ...(existingExecution && typeof existingExecution === "object" ? existingExecution : {}),
        executionId: toolCallId,
        command,
        processStarted: typeof existingExecution === "object" && existingExecution &&
          typeof (existingExecution as Record<string, unknown>).processStarted === "boolean"
          ? (existingExecution as Record<string, unknown>).processStarted
          :
          success &&
          !/\bStatus:\s*START_FAILED\b/i.test(rawOutput) &&
          typeof exitCode === "number",
        exitCode: typeof existingExecution === "object" && existingExecution &&
          typeof (existingExecution as Record<string, unknown>).exitCode === "number"
          ? (existingExecution as Record<string, unknown>).exitCode
          : exitCode,
        requirementId: typeof existingExecution === "object" && existingExecution &&
          typeof (existingExecution as Record<string, unknown>).requirementId === "string"
          ? (existingExecution as Record<string, unknown>).requirementId
          : validationRequirementForCommand(command),
        ...(approvedValidationOverride ? { authorization: "approved_override" } : {}),
      };
    }
  }

  // === Browser / frontend probes (live evidence of client-side issues) ===
  if (lowerName.includes("browser_prober")) {
    base.evidenceType = "browser_probe";
    base.status = success ? "success" : "failed";
    // The tool returns rich findings; we surface a compact count/summary if present.
    const findings = (base as any).findings || (base as any).issues || (base as any).results;
    if (Array.isArray(findings)) base.findingsCount = findings.length;
  }

  // === Static / deep analysis that produces candidates or reports ===
  if (lowerName.includes("deep_analysis") || lowerName.includes("attack_surface")) {
    base.evidenceType = "analysis";
  }

  // Mark that this record contributed real tool-backed evidence (used by pack builder heuristics)
  if (success && (base.path || base.evidenceType || base.findingsCount)) {
    base.hasStructuredEvidence = true;
  }

  return Object.keys(base).length > 0 ? base : null;
}
