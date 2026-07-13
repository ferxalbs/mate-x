import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AgentToolCall } from "./types";
import type { ToolEvent } from "../../../contracts/chat";
import type { AppSettings } from "../../../contracts/settings";
import { policyService } from "../../policy-service";
import { toolService } from "../../tool-service";
import { failureMemoryEngine } from "../../failure-memory-engine";
import { isToolFailureOutput, parseToolArguments, summarizeToolOutput, truncateToolOutput, withTimeout } from "./helpers";
import { resolveToolExecutionTimeoutMs } from "./config";
import type { EngineeringTaskStatus } from "../../../contracts/engineering-task";
import { authorizeToolForEngineeringStatus } from "../../engineering/tool-phase-auth";

export async function executeAgentToolCall({
  toolCall,
  toolIndex,
  iteration,
  snapshot,
  events,
  emitProgress,
  appSettings,
  runId,
  engineeringTaskStatus,
  autonomyPolicy,
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
  autonomyPolicy?: import("../../../contracts/behavior-mode").AutonomyPolicy;
}): Promise<{
  toolCallId: string;
  content: string;
  toolExecution: ToolExecutionRecord;
}> {
  const toolName = toolCall.name;
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
      label: `Failed ${toolName}`,
      detail: reason,
      status: "error",
    });
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: `Tool argument parsing failed for ${toolName}: ${reason}`,
      toolExecution: {
        toolName,
        args: {},
        output: `Tool argument parsing failed for ${toolName}: ${reason}`,
      } satisfies ToolExecutionRecord,
    };
  }

  const phaseAuth = authorizeToolForEngineeringStatus(
    toolName,
    engineeringTaskStatus,
    toolArgs,
    autonomyPolicy,
  );
  if (!phaseAuth.allowed) {
    events.push({
      id: eventId,
      label: `Blocked ${toolName}`,
      detail: phaseAuth.message,
      status: "error",
    });
    emitProgress();
    return {
      toolCallId: toolCall.id,
      content: phaseAuth.message,
      toolExecution: {
        toolName,
        args: toolArgs,
        output: phaseAuth.message,
        parsedOutput: {
          status: "blocked",
          code: phaseAuth.code,
        },
      } satisfies ToolExecutionRecord,
    };
  }

  const policyStop = policyService.evaluateToolCall({
    runId,
    workspacePath: snapshot.workspace.path,
    toolName,
    args: toolArgs,
    contract: snapshot.trustContract,
  });
  const toolPolicy = policyService.classifyToolCall({
    workspacePath: snapshot.workspace.path,
    toolName,
    args: toolArgs,
    contract: snapshot.trustContract,
  });

  if (policyStop) {
    events.push({
      id: eventId,
      label: policyStop.title,
      detail: `${policyStop.explanation} Policy: ${policyStop.policyId}.`,
      status: "error",
      policy: toolPolicy,
    });
    emitProgress();

    const resolvedStop = await policyService.waitForResolution(policyStop.id);
    const toolEvent = events.find((event) => event.id === eventId);
    if (resolvedStop.resolution?.action !== "approve_once") {
      const declinedMessage = `Policy stop ${policyStop.id} was ${resolvedStop.resolution?.action ?? "declined"}. Continue with allowed safer alternatives; do not execute ${toolName}.`;
      if (toolEvent) {
        toolEvent.status = "done";
        toolEvent.detail = declinedMessage;
      }
      policyService.markStopCompleted(policyStop.id);
      emitProgress();

      return {
        toolCallId: toolCall.id,
        content: declinedMessage,
        toolExecution: {
          toolName,
          args: toolArgs,
          output: declinedMessage,
          parsedOutput: {
            policyStop: resolvedStop,
            status: "declined",
          },
        } satisfies ToolExecutionRecord,
      };
    }

    policyService.markStopResumed(policyStop.id);
    if (toolEvent) {
      toolEvent.label = `Executing approved ${toolName}`;
      toolEvent.detail = `Approval received for policy stop ${policyStop.id}.`;
      toolEvent.status = "active";
    }
    emitProgress();
  }

  if (!policyStop) {
    events.push({
      id: eventId,
      label: `Executing ${toolName}`,
      detail: `Running ${toolName} with arguments: ${JSON.stringify(toolArgs)}`,
      status: "active",
      policy: toolPolicy,
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
      }),
      toolTimeoutMs,
      `Tool ${toolName} timed out after ${Math.round(toolTimeoutMs / 1000)}s.`,
      { abortController },
    );

    const normalizedResult = truncateToolOutput(String(result ?? ""));
    const parsedOutput = tryParseJsonObject(normalizedResult);
    const outputIndicatesFailure = isToolFailureOutput(normalizedResult);
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      toolEvent.status = outputIndicatesFailure ? "error" : "done";
      toolEvent.detail = summarizeToolOutput(normalizedResult);
    }
    if (policyStop) {
      if (outputIndicatesFailure) {
        policyService.markStopFailed(policyStop.id);
      } else {
        policyService.markStopCompleted(policyStop.id);
      }
    }
    if (outputIndicatesFailure && (toolName === "run_tests" || toolName === "sandbox_run")) {
      await failureMemoryEngine.recordFailure({
        workspaceId: snapshot.workspace.id,
        command: String(toolArgs.command ?? toolArgs.script ?? toolName),
        output: normalizedResult,
      }).catch((error) => {
        console.warn("Failure memory record failed:", error);
      });
    }
    if (!outputIndicatesFailure && (toolName === "run_tests" || toolName === "sandbox_run")) {
      await failureMemoryEngine.recordResolution({
        workspaceId: snapshot.workspace.id,
        command: String(toolArgs.command ?? toolArgs.script ?? toolName),
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
    const enrichedParsed = enrichParsedForEvidence(toolName, parsedOutput, toolArgs, normalizedResult, !outputIndicatesFailure);

    return {
      toolCallId: toolCall.id,
      content: normalizedResult,
      toolExecution: {
        toolName,
        args: toolArgs,
        output: normalizedResult,
        parsedOutput: enrichedParsed ?? parsedOutput ?? undefined,
      } satisfies ToolExecutionRecord,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Tool ${toolName} failed.`;
    const toolEvent = events.find((event) => event.id === eventId);
    if (toolEvent) {
      toolEvent.status = "error";
      toolEvent.detail = message;
    }
    if (policyStop) {
      policyService.markStopFailed(policyStop.id);
    }
    emitProgress();

    return {
      toolCallId: toolCall.id,
      content: `Tool ${toolName} failed: ${message}`,
      toolExecution: {
        toolName,
        args: toolArgs,
        output: `Tool ${toolName} failed: ${message}`,
        parsedOutput: { status: "error", error: message },
      } satisfies ToolExecutionRecord,
    };
  }
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
 * We keep everything inside the existing `parsedOutput` bag (no contract change yet).
 * The evidence-pack builder and VTS already poke into parsedOutput for exitCode,
 * summary, status, and (after our Phase A-1 changes) paths.
 */
function enrichParsedForEvidence(
  toolName: string,
  parsed: Record<string, unknown> | null,
  args: Record<string, unknown>,
  rawOutput: string,
  success: boolean,
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
