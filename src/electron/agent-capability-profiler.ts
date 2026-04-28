import type { EvidencePack, ToolEvent } from '../contracts/chat';
import type {
  AgentCapabilityMetricTotals,
  AgentCapabilityProfile,
  AgentCapabilityRunMetrics,
  AgentCapabilityTag,
  AgentRoutingRecommendation,
} from '../contracts/agent-capability-profiler';
import type { ToolExecutionRecord } from './evidence-pack';
import { createTokenEstimator } from './token-estimator';

const EMPTY_TOTALS: AgentCapabilityMetricTotals = {
  taskCount: 0,
  verifiedTaskCount: 0,
  toolCallCount: 0,
  successfulToolCallCount: 0,
  invalidToolCallCount: 0,
  iterationCount: 0,
  patchAttemptCount: 0,
  patchSuccessCount: 0,
  validationAttemptCount: 0,
  validationPassCount: 0,
  hallucinatedFilePathCount: 0,
  repeatedFailureCount: 0,
  tokenCount: 0,
  verifiedTokenCount: 0,
  elapsedMs: 0,
  verifiedElapsedMs: 0,
};

const PATCH_TOOL_NAMES = new Set(['auto_patch', 'file_editor']);
const PATCH_EXPERIMENT_TOOL_NAMES = new Set(['mutation']);
const VALIDATION_TOOL_NAMES = new Set([
  'run_tests',
  'sandbox_run',
  'verify_validation_persistence',
]);
const TOOL_FAILURE_PATTERN =
  /\b(error|failed|failure|invalid|not found|timed out|timeout|permission denied|outside workspace)\b/i;
const PATCH_SUCCESS_PATTERN =
  /\b(patch applied successfully|successfully edited|file .* successfully edited|mutation lifecycle complete|restored original)\b/i;
const PATCH_FAILURE_PATTERN =
  /\b(patch failed|error applying patch|error editing file|mutation failed|exact searchstring was not found|could not read file)\b/i;
const VALIDATION_PASS_PATTERN =
  /\b(status["']?\s*:\s*["']?success|exitCode["']?\s*:\s*0|exit code:?\s*0|tests? passed|passed\b|success\b|validation .*persisted|run persisted)\b/i;
const VALIDATION_FAIL_PATTERN =
  /\b(status["']?\s*:\s*["']?failed|exitCode["']?\s*:\s*[1-9]|exit code:?\s*[1-9]|tests? failed|failed\b|error signature|validation .*not.*persisted)\b/i;
const HALLUCINATED_PATH_PATTERN =
  /\b(no such file|does not exist|file not found|path must remain within the active workspace|outside workspace|invalid path|unknown file|could not read file)\b/i;
const INVALID_TOOL_PATTERN =
  /\b(invalid tool|unknown tool|tool .*not found|failed to parse|invalid arguments|schema validation failed)\b/i;
const REPEATED_FAILURE_PATTERN =
  /\b(similar failure|repeated failure|same failure|retry loop|rerun-failed|prior failure|error signature)\b/i;

export function createEmptyAgentCapabilityTotals() {
  return { ...EMPTY_TOTALS };
}

export function buildAgentCapabilityRunMetrics(params: {
  model: string;
  workspaceId: string;
  prompt: string;
  content: string;
  events: ToolEvent[];
  toolExecutions: ToolExecutionRecord[];
  evidencePack: EvidencePack;
  startedAt: number;
  completedAt: string;
}): AgentCapabilityRunMetrics {
  const prompt = params.prompt.toLowerCase();
  const patchExecutions = params.toolExecutions.filter(isPatchExecution);
  const validationExecutions = params.toolExecutions.filter(isValidationExecution);
  const invalidToolCallCount = countEventMatches(params.events, INVALID_TOOL_PATTERN);
  const hallucinatedFilePathCount =
    countEventMatches(params.events, HALLUCINATED_PATH_PATTERN) +
    countExecutionMatches(params.toolExecutions, HALLUCINATED_PATH_PATTERN);
  const repeatedFailureCount =
    countEventMatches(params.events, REPEATED_FAILURE_PATTERN) +
    countExecutionMatches(params.toolExecutions, REPEATED_FAILURE_PATTERN);
  const toolCallCount = params.toolExecutions.length + invalidToolCallCount;
  const successfulToolCallCount = params.toolExecutions.filter(
    isSuccessfulToolExecution,
  ).length;
  const validationPassCount = validationExecutions.filter(
    isSuccessfulValidationExecution,
  ).length;
  const patchSuccessCount = patchExecutions.filter((execution) =>
    isSuccessfulPatchExecution(execution, params.evidencePack.touchedPaths ?? []),
  ).length;
  const verified =
    params.evidencePack.status === 'complete' &&
    (validationExecutions.length === 0 ||
      validationPassCount === validationExecutions.length);

  return {
    model: params.model,
    workspaceId: params.workspaceId,
    taskKind: prompt.includes('review')
      ? 'review'
      : /test|spec|validation/.test(prompt)
        ? 'tests'
        : patchExecutions.length > 0 || /fix|implement|patch|change/.test(prompt)
          ? 'patch'
          : 'general',
    toolCallCount,
    successfulToolCallCount,
    invalidToolCallCount,
    iterationCount: params.events.filter((event) =>
      event.id.startsWith('step-agent-loop-'),
    ).length,
    patchAttemptCount: patchExecutions.length,
    patchSuccessCount,
    validationAttemptCount: validationExecutions.length,
    validationPassCount,
    hallucinatedFilePathCount,
    repeatedFailureCount,
    tokenCount: createTokenEstimator(params.model).estimateTokens(
      `${params.prompt}\n${params.content}`,
    ),
    elapsedMs: Math.max(Date.now() - params.startedAt, 0),
    verified,
    completedAt: params.completedAt,
  };
}

export function applyAgentCapabilityRun(
  totals: AgentCapabilityMetricTotals,
  run: AgentCapabilityRunMetrics,
): AgentCapabilityMetricTotals {
  return {
    taskCount: totals.taskCount + 1,
    verifiedTaskCount: totals.verifiedTaskCount + (run.verified ? 1 : 0),
    toolCallCount: totals.toolCallCount + run.toolCallCount,
    successfulToolCallCount:
      totals.successfulToolCallCount + run.successfulToolCallCount,
    invalidToolCallCount: totals.invalidToolCallCount + run.invalidToolCallCount,
    iterationCount: totals.iterationCount + run.iterationCount,
    patchAttemptCount: totals.patchAttemptCount + run.patchAttemptCount,
    patchSuccessCount: totals.patchSuccessCount + run.patchSuccessCount,
    validationAttemptCount:
      totals.validationAttemptCount + run.validationAttemptCount,
    validationPassCount: totals.validationPassCount + run.validationPassCount,
    hallucinatedFilePathCount:
      totals.hallucinatedFilePathCount + run.hallucinatedFilePathCount,
    repeatedFailureCount: totals.repeatedFailureCount + run.repeatedFailureCount,
    tokenCount: totals.tokenCount + run.tokenCount,
    verifiedTokenCount:
      totals.verifiedTokenCount + (run.verified ? run.tokenCount : 0),
    elapsedMs: totals.elapsedMs + run.elapsedMs,
    verifiedElapsedMs:
      totals.verifiedElapsedMs + (run.verified ? run.elapsedMs : 0),
  };
}

export function buildAgentCapabilityProfile(params: {
  model: string;
  workspaceId: string | null;
  totals: AgentCapabilityMetricTotals;
  updatedAt: string;
}): AgentCapabilityProfile {
  const { totals } = params;
  const profile = {
    model: params.model,
    workspaceId: params.workspaceId,
    totals,
    toolCallSuccessRate: rate(totals.successfulToolCallCount, totals.toolCallCount),
    invalidToolCallRate: rate(totals.invalidToolCallCount, totals.toolCallCount),
    averageIterations: rate(totals.iterationCount, totals.taskCount),
    patchSuccessRate: rate(totals.patchSuccessCount, totals.patchAttemptCount),
    validationPassRate: rate(
      totals.validationPassCount,
      totals.validationAttemptCount,
    ),
    averageTokensPerVerifiedTask: rate(
      totals.verifiedTokenCount,
      totals.verifiedTaskCount,
    ),
    averageTimePerVerifiedTaskMs: rate(
      totals.verifiedElapsedMs,
      totals.verifiedTaskCount,
    ),
    tags: [] as AgentCapabilityTag[],
    updatedAt: params.updatedAt,
  };

  profile.tags = deriveTags(profile);
  return profile;
}

export function recommendAgentModel(params: {
  task: string;
  profiles: AgentCapabilityProfile[];
  currentModel: string | null;
  autoSwitchAllowed: boolean;
}): AgentRoutingRecommendation {
  const task = params.task.toLowerCase();
  const preferredTag: AgentCapabilityTag = task.includes('review')
    ? 'good_at_review'
    : /test|validation|spec/.test(task)
      ? 'good_at_tests'
      : /fix|implement|patch|change/.test(task)
        ? 'good_at_patch'
        : 'expensive_but_reliable';
  const ranked = [...params.profiles].sort(
    (a, b) => scoreProfile(b, preferredTag) - scoreProfile(a, preferredTag),
  );
  const best = ranked[0] ?? null;

  if (!best) {
    return {
      model: params.currentModel,
      reason:
        params.currentModel === null
          ? 'No profiler data exists yet. Run verified tasks to build routing evidence.'
          : `For this task, recommended model is ${params.currentModel} because no profiler data exists yet; keeping current model.`,
      tags: [],
      autoSwitchAllowed: params.autoSwitchAllowed,
    };
  }

  return {
    model: best.model,
    reason: `For this task, recommended model is ${best.model} because it has ${formatPercent(best.validationPassRate)} validation pass rate, ${formatPercent(best.toolCallSuccessRate)} tool success rate, and tags: ${best.tags.join(', ') || 'none'}.`,
    tags: best.tags,
    workspaceProfile: best.workspaceId ? best : undefined,
    globalProfile: best.workspaceId ? undefined : best,
    autoSwitchAllowed: params.autoSwitchAllowed,
  };
}

function deriveTags(profile: Omit<AgentCapabilityProfile, 'tags'>) {
  const tags: AgentCapabilityTag[] = [];
  if (profile.toolCallSuccessRate >= 0.9 && profile.totals.taskCount >= 2) {
    tags.push('good_at_review');
  }
  if (profile.patchSuccessRate >= 0.75 && profile.totals.patchAttemptCount >= 2) {
    tags.push('good_at_patch');
  }
  if (
    profile.validationPassRate >= 0.75 &&
    profile.totals.validationAttemptCount >= 2
  ) {
    tags.push('good_at_tests');
  }
  if (profile.totals.hallucinatedFilePathCount > profile.totals.taskCount / 3) {
    tags.push('high_hallucination_risk');
  }
  if (profile.averageTokensPerVerifiedTask > 12000 && profile.validationPassRate >= 0.8) {
    tags.push('expensive_but_reliable');
  }
  if (profile.averageTokensPerVerifiedTask > 0 && profile.averageTokensPerVerifiedTask < 6000) {
    tags.push('cheap_fast');
  }
  return tags;
}

function isPatchExecution(execution: ToolExecutionRecord) {
  return (
    PATCH_TOOL_NAMES.has(execution.toolName) ||
    PATCH_EXPERIMENT_TOOL_NAMES.has(execution.toolName)
  );
}

function isValidationExecution(execution: ToolExecutionRecord) {
  return VALIDATION_TOOL_NAMES.has(execution.toolName);
}

function isSuccessfulToolExecution(execution: ToolExecutionRecord) {
  if (isValidationExecution(execution)) {
    return !isFailedValidationExecution(execution);
  }
  if (isPatchExecution(execution)) {
    return !isFailedPatchExecution(execution);
  }
  return !TOOL_FAILURE_PATTERN.test(renderExecutionText(execution));
}

function isSuccessfulPatchExecution(
  execution: ToolExecutionRecord,
  touchedPaths: string[],
) {
  if (isFailedPatchExecution(execution)) {
    return false;
  }
  if (PATCH_SUCCESS_PATTERN.test(renderExecutionText(execution))) {
    return true;
  }
  const path = typeof execution.args.path === 'string' ? execution.args.path : null;
  return path !== null && touchedPaths.some((touchedPath) => touchedPath === path);
}

function isFailedPatchExecution(execution: ToolExecutionRecord) {
  return PATCH_FAILURE_PATTERN.test(renderExecutionText(execution));
}

function isSuccessfulValidationExecution(execution: ToolExecutionRecord) {
  if (isFailedValidationExecution(execution)) {
    return false;
  }
  const status = execution.parsedOutput?.status;
  const exitCode = execution.parsedOutput?.exitCode;
  return (
    status === 'success' ||
    exitCode === 0 ||
    VALIDATION_PASS_PATTERN.test(renderExecutionText(execution))
  );
}

function isFailedValidationExecution(execution: ToolExecutionRecord) {
  const status = execution.parsedOutput?.status;
  const exitCode = execution.parsedOutput?.exitCode;
  return (
    status === 'failed' ||
    (typeof exitCode === 'number' && exitCode !== 0) ||
    VALIDATION_FAIL_PATTERN.test(renderExecutionText(execution))
  );
}

function countEventMatches(events: ToolEvent[], pattern: RegExp) {
  return events.filter((event) => pattern.test(`${event.label}\n${event.detail}`))
    .length;
}

function countExecutionMatches(executions: ToolExecutionRecord[], pattern: RegExp) {
  return executions.filter((execution) => pattern.test(renderExecutionText(execution)))
    .length;
}

function renderExecutionText(execution: ToolExecutionRecord) {
  return `${execution.toolName}\n${JSON.stringify(execution.args)}\n${execution.output}\n${JSON.stringify(execution.parsedOutput ?? {})}`;
}

function scoreProfile(profile: AgentCapabilityProfile, preferredTag: AgentCapabilityTag) {
  const tagScore = profile.tags.includes(preferredTag) ? 2 : 0;
  const riskPenalty = profile.tags.includes('high_hallucination_risk') ? 1.5 : 0;
  return (
    tagScore +
    profile.validationPassRate +
    profile.toolCallSuccessRate +
    profile.patchSuccessRate -
    profile.invalidToolCallRate -
    riskPenalty
  );
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
