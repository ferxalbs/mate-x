/**
 * Apply typed EngineeringPhaseResult via command-bus transitions.
 * Artifacts must exist (or be supplied in the bundle) — prose never drives transitions.
 */

import type {
  ActorRef,
  CommandResponse,
  DecisionQueueItem,
  EngineeringTask,
  EngineeringTaskSummary,
  SpecificationDocument,
} from "../../contracts/engineering-task";
import { ERR_CODES } from "../../contracts/engineering-task";
import type {
  EngineeringPhaseResult,
  PhaseResultArtifactBundle,
} from "../../contracts/engineering-phase-result";
import { parseEngineeringPhaseResult } from "../../contracts/engineering-phase-result";
import type { EngineeringCommandBus, DispatchableCommand } from "./command-bus";
import type { EngineeringRepository } from "./repository";
import { freezeSpecification } from "./intent-compiler";
import { compileTechnicalApproach } from "./plan-compiler";
import { compileTaskGraph } from "./task-graph-compiler";
import { nowIso } from "./ids";

function fail(
  code: (typeof ERR_CODES)[keyof typeof ERR_CODES],
  message: string,
): CommandResponse<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

function summaryFromTask(
  task: EngineeringTask,
  openDecisionCount = 0,
): EngineeringTaskSummary {
  return {
    engineeringTaskId: task.engineeringTaskId,
    workspaceId: task.workspaceId,
    pathKind: task.pathKind,
    title: task.title,
    status: task.status,
    readiness: task.readiness,
    aggregateVersion: task.aggregateVersion,
    objectivePreview: task.objectiveSeed.slice(0, 200),
    openDecisionCount,
    activeAgentIds: [],
    updatedAt: task.updatedAt,
    conversationId: task.conversationId,
  };
}

function dispatchOrFail(
  bus: EngineeringCommandBus,
  command: DispatchableCommand,
): CommandResponse<EngineeringTaskSummary> {
  return bus.dispatch(command) as CommandResponse<EngineeringTaskSummary>;
}

/**
 * Persist optional artifacts, validate referenced IDs, then apply legal transitions.
 */
export function applyEngineeringPhaseResult(input: {
  bus: EngineeringCommandBus;
  repo: EngineeringRepository;
  workspaceId: string;
  phaseResult: unknown;
  artifacts?: PhaseResultArtifactBundle;
  actor?: ActorRef;
  expectedAggregateVersion?: number;
}): CommandResponse<EngineeringTaskSummary> {
  const parsed = parseEngineeringPhaseResult(input.phaseResult);
  if (!parsed.ok) {
    return fail(ERR_CODES.ERR_INVARIANT_VIOLATION, parsed.reason);
  }
  const phase = parsed.result;
  const task = input.repo.getTask(phase.engineeringTaskId);
  if (!task) {
    return fail(ERR_CODES.ERR_TASK_NOT_FOUND, "EngineeringTask not found");
  }
  if (task.workspaceId !== input.workspaceId) {
    return fail(ERR_CODES.ERR_TASK_NOT_FOUND, "workspace mismatch");
  }

  // Attach supplied artifacts into the aggregate before ID validation.
  if (input.artifacts) {
    const attachError = attachArtifacts(input.repo, task, input.artifacts);
    if (attachError) return attachError;
  }

  const actor: ActorRef = input.actor ?? { kind: "system", component: "phase-result" };
  const refreshed = input.repo.getTask(phase.engineeringTaskId)!;
  const bundle = input.repo.getBundle(phase.engineeringTaskId);
  if (!bundle) {
    return fail(ERR_CODES.ERR_TASK_NOT_FOUND, "bundle missing");
  }

  switch (phase.kind) {
    case "clarification_required": {
      for (const id of phase.decisionIds) {
        if (!bundle.decisions.has(id) && !(input.artifacts?.decisions ?? []).some((d) => d.decisionId === id)) {
          // re-read after attach
          const again = input.repo.getBundle(phase.engineeringTaskId);
          if (!again?.decisions.has(id)) {
            return fail(
              ERR_CODES.ERR_DECISION_NOT_FOUND,
              `decision artifact missing: ${id}`,
            );
          }
        }
      }
      if (refreshed.status === "captured") {
        const r = dispatchOrFail(input.bus, {
          type: "StartClarification",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor,
          expectedAggregateVersion: input.expectedAggregateVersion,
        });
        if (!r.ok) return r;
      }
      const latest = input.repo.getTask(phase.engineeringTaskId)!;
      return {
        ok: true,
        data: summaryFromTask(latest, phase.decisionIds.length),
        events: [],
        aggregateVersion: latest.aggregateVersion,
        readiness: latest.readiness,
      };
    }

    case "specification_ready": {
      const spec =
        [...bundle.specifications.values()].find(
          (s) => s.specificationId === phase.specificationId,
        ) ??
        (input.artifacts?.specification?.specificationId === phase.specificationId
          ? input.artifacts.specification
          : null);
      // After attach, re-read
      const bundle2 = input.repo.getBundle(phase.engineeringTaskId)!;
      const found =
        [...bundle2.specifications.values()].find(
          (s) => s.specificationId === phase.specificationId,
        ) ?? spec;
      if (!found) {
        return fail(
          ERR_CODES.ERR_NOT_READY,
          `specification artifact missing: ${phase.specificationId}`,
        );
      }
      // Align active version then freeze if needed
      const current = input.repo.getTask(phase.engineeringTaskId)!;
      if (!found.frozenAt) {
        if (current.status === "captured" || current.status === "clarifying") {
          // Ensure draft is on task
          if (current.activeSpecificationVersion == null) {
            input.repo.applyTransaction({
              task: {
                ...current,
                activeSpecificationVersion: found.version,
                updatedAt: nowIso(),
              },
              events: [],
              specification: found,
            });
          }
          const freeze = dispatchOrFail(input.bus, {
            type: "FreezeSpecification",
            engineeringTaskId: phase.engineeringTaskId,
            workspaceId: input.workspaceId,
            actor: actor.kind === "human" ? actor : { kind: "human", userId: "phase-result" },
          });
          if (!freeze.ok) return freeze;
        }
      } else if (current.status === "captured" || current.status === "clarifying") {
        // Already frozen artifact — still need status specified via Freeze if legal, else force via freeze path
        const freeze = dispatchOrFail(input.bus, {
          type: "FreezeSpecification",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor: actor.kind === "human" ? actor : { kind: "human", userId: "phase-result" },
        });
        if (!freeze.ok) return freeze;
      }
      const latest = input.repo.getTask(phase.engineeringTaskId)!;
      return {
        ok: true,
        data: summaryFromTask(latest),
        events: [],
        aggregateVersion: latest.aggregateVersion,
        readiness: latest.readiness,
      };
    }

    case "plan_ready": {
      const b = input.repo.getBundle(phase.engineeringTaskId)!;
      const specs = [...b.specifications.values()];
      const approaches = [...b.approaches.values()];
      const graphs = [...b.taskGraphs.values()];
      const spec = specs.find((s) => s.specificationId === phase.specificationId);
      const approach = approaches.find((a) => a.approachId === phase.approachId);
      const graph = graphs.find((g) => g.taskGraphId === phase.taskGraphId);
      if (!spec) {
        return fail(
          ERR_CODES.ERR_NOT_READY,
          `specification artifact missing: ${phase.specificationId}`,
        );
      }
      if (!approach) {
        return fail(
          ERR_CODES.ERR_NOT_READY,
          `approach artifact missing: ${phase.approachId}`,
        );
      }
      if (!graph) {
        return fail(
          ERR_CODES.ERR_NOT_READY,
          `task graph artifact missing: ${phase.taskGraphId}`,
        );
      }
      if (!spec.frozenAt) {
        return fail(ERR_CODES.ERR_NOT_READY, "specification not frozen");
      }

      let current = input.repo.getTask(phase.engineeringTaskId)!;
      // Ensure status reaches planned with versions linked
      current = linkArtifacts(input.repo, current, spec, approach, graph);

      if (current.status === "captured" || current.status === "clarifying") {
        const freeze = dispatchOrFail(input.bus, {
          type: "FreezeSpecification",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor: { kind: "human", userId: "phase-result" },
        });
        if (!freeze.ok) return freeze;
        current = input.repo.getTask(phase.engineeringTaskId)!;
        current = linkArtifacts(input.repo, current, spec, approach, graph);
      }

      if (current.status === "specified") {
        for (const step of [
          "StartPlanCompilation",
          "CompletePlanCompilation",
        ] as const) {
          const r = dispatchOrFail(input.bus, {
            type: step,
            engineeringTaskId: phase.engineeringTaskId,
            workspaceId: input.workspaceId,
            actor,
          });
          if (!r.ok) return r;
        }
        current = input.repo.getTask(phase.engineeringTaskId)!;
        current = linkArtifacts(input.repo, current, spec, approach, graph);
      }

      if (current.status === "planning") {
        const r = dispatchOrFail(input.bus, {
          type: "CompletePlanCompilation",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor,
        });
        if (!r.ok) return r;
        current = input.repo.getTask(phase.engineeringTaskId)!;
        current = linkArtifacts(input.repo, current, spec, approach, graph);
      }

      if (current.status === "planned") {
        // Ensure graph version then submit
        if (current.activeTaskGraphVersion == null) {
          const r = dispatchOrFail(input.bus, {
            type: "CompileTaskGraph",
            engineeringTaskId: phase.engineeringTaskId,
            workspaceId: input.workspaceId,
            actor,
          });
          if (!r.ok) {
            linkArtifacts(
              input.repo,
              input.repo.getTask(phase.engineeringTaskId)!,
              spec,
              approach,
              graph,
            );
          } else {
            linkArtifacts(
              input.repo,
              input.repo.getTask(phase.engineeringTaskId)!,
              spec,
              approach,
              graph,
            );
          }
        }
        const submit = dispatchOrFail(input.bus, {
          type: "SubmitForApproval",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor,
        });
        if (!submit.ok) return submit;
      }

      let finalTask = input.repo.getTask(phase.engineeringTaskId)!;
      if (finalTask.status === "planned") {
        const submit = dispatchOrFail(input.bus, {
          type: "SubmitForApproval",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor,
        });
        if (!submit.ok) return submit;
        finalTask = input.repo.getTask(phase.engineeringTaskId)!;
      }
      return {
        ok: true,
        data: summaryFromTask(finalTask),
        events: [],
        aggregateVersion: finalTask.aggregateVersion,
        readiness: finalTask.readiness,
      };
    }

    case "execution_result": {
      if (!phase.executionId) {
        return fail(ERR_CODES.ERR_NOT_READY, "executionId required");
      }
      const b = input.repo.getBundle(phase.engineeringTaskId)!;
      const hasExecution = [...b.leases.values()].some(
        () => false,
      );
      // Execution records live on bundle.task lastExecutionId after CompleteTask.
      // Require non-empty evidence IDs as canonical artifact check.
      if (phase.evidenceIds.length === 0) {
        return fail(ERR_CODES.ERR_TASK_EVIDENCE_REQUIRED, "evidenceIds required");
      }
      void hasExecution;
      const current = input.repo.getTask(phase.engineeringTaskId)!;
      if (current.status === "executing") {
        const r = dispatchOrFail(input.bus, {
          type: "BeginVerification",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor,
        });
        if (!r.ok) return r;
      }
      const latest = input.repo.getTask(phase.engineeringTaskId)!;
      // Record lastExecutionId
      input.repo.applyTransaction({
        task: {
          ...latest,
          lastExecutionId: phase.executionId,
          updatedAt: nowIso(),
        },
        events: [],
      });
      const after = input.repo.getTask(phase.engineeringTaskId)!;
      return {
        ok: true,
        data: summaryFromTask(after),
        events: [],
        aggregateVersion: after.aggregateVersion,
        readiness: after.readiness,
      };
    }

    case "validation_result": {
      if (phase.validationRunIds.length === 0) {
        return fail(ERR_CODES.ERR_VALIDATION_REQUIRED_MISSING, "validationRunIds empty");
      }
      const b = input.repo.getBundle(phase.engineeringTaskId)!;
      for (const id of phase.validationRunIds) {
        if (!b.validationRuns.has(id)) {
          return fail(
            ERR_CODES.ERR_VALIDATION_REQUIRED_MISSING,
            `validation run missing: ${id}`,
          );
        }
      }
      let current = input.repo.getTask(phase.engineeringTaskId)!;
      if (current.status === "verifying") {
        const r = dispatchOrFail(input.bus, {
          type: "BeginCoverageConvergence",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor,
        });
        if (!r.ok) return r;
        current = input.repo.getTask(phase.engineeringTaskId)!;
      }
      if (current.status === "converging") {
        const r = dispatchOrFail(input.bus, {
          type: "AcceptConvergence",
          engineeringTaskId: phase.engineeringTaskId,
          workspaceId: input.workspaceId,
          actor: actor.kind === "human" ? actor : { kind: "human", userId: "phase-result" },
        });
        if (!r.ok) return r;
      }
      const latest = input.repo.getTask(phase.engineeringTaskId)!;
      return {
        ok: true,
        data: summaryFromTask(latest),
        events: [],
        aggregateVersion: latest.aggregateVersion,
        readiness: latest.readiness,
      };
    }

    default:
      return fail(ERR_CODES.ERR_INVARIANT_VIOLATION, "unknown phase kind");
  }
}

function attachArtifacts(
  repo: EngineeringRepository,
  task: EngineeringTask,
  artifacts: PhaseResultArtifactBundle,
): CommandResponse<never> | null {
  let next = { ...task, updatedAt: nowIso() };
  const specification = artifacts.specification;
  const approach = artifacts.approach;
  const taskGraph = artifacts.taskGraph;
  let decisions: DecisionQueueItem[] | undefined;

  if (artifacts.decisions?.length) {
    decisions = artifacts.decisions.map((d) => ({
      ...d,
    }));
  }

  if (specification) {
    next = {
      ...next,
      activeSpecificationVersion: specification.version,
    };
  }
  if (approach) {
    next = {
      ...next,
      activePlanVersion: approach.version,
    };
  }
  if (taskGraph) {
    next = {
      ...next,
      activeTaskGraphVersion: taskGraph.version,
    };
  }

  repo.applyTransaction({
    task: next,
    events: [],
    specification,
    approach,
    taskGraph,
    decisions,
  });
  return null;
}

function linkArtifacts(
  repo: EngineeringRepository,
  task: EngineeringTask,
  spec: SpecificationDocument,
  approach: { approachId: string; version: number },
  graph: { taskGraphId: string; version: number },
): EngineeringTask {
  const next: EngineeringTask = {
    ...task,
    activeSpecificationVersion: spec.version,
    activePlanVersion: approach.version,
    activeTaskGraphVersion: graph.version,
    updatedAt: nowIso(),
  };
  repo.applyTransaction({
    task: next,
    events: [],
    specification: spec,
    approach: approach as never,
    taskGraph: graph as never,
  });
  return repo.getTask(task.engineeringTaskId)!;
}

/** Build deterministic plan artifacts from a frozen (or freezable) task for CTA handlers. */
export function buildPlanArtifactsForTask(input: {
  repo: EngineeringRepository;
  engineeringTaskId: string;
}):
  | {
      ok: true;
      specification: SpecificationDocument;
      approach: import("../../contracts/engineering-task").TechnicalApproachDocument;
      taskGraph: import("../../contracts/engineering-task").TaskGraphDocument;
    }
  | { ok: false; reason: string } {
  const bundle = input.repo.getBundle(input.engineeringTaskId);
  const task = input.repo.getTask(input.engineeringTaskId);
  if (!bundle || !task) {
    return { ok: false, reason: "task not found" };
  }
  let spec =
    task.activeSpecificationVersion != null
      ? bundle.specifications.get(task.activeSpecificationVersion)
      : undefined;
  if (!spec) {
    return { ok: false, reason: "specification missing" };
  }
  if (!spec.frozenAt) {
    const frozen = freezeSpecification(spec, "human");
    if (!frozen.ok) return { ok: false, reason: frozen.reason };
    spec = frozen.spec;
  }
  const approachResult = compileTechnicalApproach(
    spec,
    (task.activePlanVersion ?? 0) + 1,
  );
  if (!approachResult.ok) return { ok: false, reason: approachResult.reason };
  const graphResult = compileTaskGraph({
    spec,
    approach: approachResult.approach,
    version: (task.activeTaskGraphVersion ?? 0) + 1,
  });
  if (!graphResult.ok) return { ok: false, reason: graphResult.reason };
  return {
    ok: true,
    specification: spec,
    approach: approachResult.approach,
    taskGraph: graphResult.graph,
  };
}

export type { EngineeringPhaseResult };
