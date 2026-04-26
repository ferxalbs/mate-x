import type {
  ValidationCost,
  ValidationPlan,
  ValidationPlanCommand,
  ValidationRun,
  WorkspaceProfile,
} from '../contracts/workspace';
import { createId } from '../lib/id';

export interface ValidationPlannerInput {
  objective: string;
  changedFiles: string[];
  impactedFiles: string[];
  packageScripts: Record<string, string>;
  detectedFramework?: string;
  previousFailures: ValidationRun[];
  profile?: WorkspaceProfile | null;
}

const CONFIG_FILE_PATTERN =
  /(^|\/)(package\.json|bun\.lock|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig[^/]*\.json|vite\.config\.[jt]s|webpack\.config\.[jt]s|eslint\.config\.[jt]s|\.eslintrc|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum)$/;
const CONTRACT_PATTERN = /(^|\/)src\/contracts\//;
const ENTRYPOINT_PATTERN = /(^|\/)(src\/main\.ts|src\/preload\.ts|src\/renderer\.tsx|src\/electron\/ipc-handlers\.ts)$/;
const TEST_FILE_PATTERN = /(\.test|\.spec)\.[tj]sx?$/;
const UI_FILE_PATTERN = /(^|\/)(src\/features|src\/components)\/.*\.tsx$/;
const SECURITY_FILE_PATTERN = /(^|\/)(src\/electron|src\/preload\.ts|src\/contracts)\/|auth|token|secret|credential|ipc/i;

export class ValidationPlanner {
  createPlan(input: ValidationPlannerInput): ValidationPlan {
    const changedFiles = normalizeFiles(input.changedFiles);
    const impactedFiles = normalizeFiles(input.impactedFiles);
    const framework = input.detectedFramework ?? input.profile?.testFramework;
    const fullSuiteRequired = [...changedFiles, ...impactedFiles].some((file) =>
      CONFIG_FILE_PATTERN.test(file) ||
      CONTRACT_PATTERN.test(file) ||
      ENTRYPOINT_PATTERN.test(file),
    );

    const riskLevel = estimateRisk(changedFiles, impactedFiles, fullSuiteRequired);
    const primary = fullSuiteRequired
      ? this.fullSuiteCommand(input, framework)
      : this.targetedCommand(input, changedFiles, impactedFiles, framework);

    const fallbackCandidate = fullSuiteRequired
      ? this.fallbackAfterFullSuite(input)
      : this.fullSuiteCommand(input, framework, 'Fallback covers transitive regressions if targeted validation misses an integration boundary.');
    const fallback = this.ensureDistinctFallback(input, primary, fallbackCandidate, framework);

    return {
      id: createId('vplan'),
      objective: input.objective.trim(),
      changedFiles,
      impactedFiles,
      detectedFramework: framework,
      riskLevel,
      primary,
      fallback,
      fallbackTrigger: buildFallbackTrigger(riskLevel, primary, fallback),
      recommendations: buildRecommendations(input, changedFiles, impactedFiles, riskLevel),
      comments: buildComments(changedFiles, impactedFiles, fullSuiteRequired),
      executionState: {
        primary: "not_run",
        fallback: "not_run",
        persistence: "not_verified",
        blockingInstruction:
          "This plan has not executed validation. Do not report primaryRun, fallbackRun, persistence, PROVEN, GO, or production-ready until run_tests and verify_validation_persistence provide matching evidence.",
      },
      createdAt: new Date().toISOString(),
    };
  }

  private targetedCommand(
    input: ValidationPlannerInput,
    changedFiles: string[],
    impactedFiles: string[],
    framework?: string,
  ): ValidationPlanCommand {
    const previousFailureCommand = input.previousFailures.find((run) =>
      run.status === 'failed' && run.command,
    )?.command;
    if (previousFailureCommand) {
      return {
        command: previousFailureCommand,
        reason: 'Previous validation failed; rerunning that exact command gives the fastest confirmation that the reported failure is fixed.',
        estimatedCost: 'cheap',
        expectedSignal: 'Reproduces or clears the most recent known failing validation.',
      };
    }

    const directTest = changedFiles.find((file) => TEST_FILE_PATTERN.test(file));
    if (directTest && input.profile?.testCommand) {
      return {
        command: `${input.profile.testCommand} ${quotePath(directTest)}`,
        reason: 'A changed test file is available, so the narrowest useful check is that test path.',
        estimatedCost: 'cheap',
        expectedSignal: 'Direct unit or integration coverage for the edited behavior.',
      };
    }

    const colocatedTest = findLikelyTestPath(changedFiles, impactedFiles);
    if (colocatedTest && input.profile?.testCommand) {
      return {
        command: `${input.profile.testCommand} ${quotePath(colocatedTest)}`,
        reason: 'RepoGraph impact is limited and a likely colocated test exists for the touched code.',
        estimatedCost: 'cheap',
        expectedSignal: 'Focused regression coverage near the changed module.',
      };
    }

    const checkCommand = input.profile?.typecheckCommand ?? scriptCommand(input, 'typecheck');
    if (checkCommand && isTypeScriptFramework(framework, changedFiles)) {
      return {
        command: checkCommand,
        reason: 'No precise test target was identified, but TypeScript changes can be validated cheaply with type checking.',
        estimatedCost: 'medium',
        expectedSignal: 'Compile-time contract, import, and type-safety regressions.',
      };
    }

    const lintCommand = input.profile?.lintCommand ?? scriptCommand(input, 'lint');
    if (lintCommand && changedFiles.some((file) => UI_FILE_PATTERN.test(file))) {
      return {
        command: lintCommand,
        reason: 'UI changes have no precise test target; lint is the cheapest useful check for React and accessibility mistakes before broader fallback.',
        estimatedCost: 'cheap',
        expectedSignal: 'Fast static signal for component, hook, import, and JSX issues.',
      };
    }

    const testCommand = input.profile?.testCommand ?? scriptCommand(input, 'test');
    if (testCommand) {
      return {
        command: testCommand,
        reason: 'No narrower test target was available, so the workspace test script is the smallest reliable validation.',
        estimatedCost: estimateCost(testCommand),
        expectedSignal: 'General automated regression signal from the project test runner.',
      };
    }

    return {
      command: scriptCommand(input, 'lint') ?? input.profile?.lintCommand ?? 'echo "No validation command detected"',
      reason: 'No test command was detected; using the cheapest available static validation.',
      estimatedCost: 'cheap',
      expectedSignal: 'Basic syntax or lint signal when tests are unavailable.',
    };
  }

  private fullSuiteCommand(
    input: ValidationPlannerInput,
    framework?: string,
    reason = 'Config, dependency, shared contract, or entrypoint changes can affect broad runtime behavior, so full validation is required.',
  ): ValidationPlanCommand {
    const command =
      input.profile?.testCommand ??
      scriptCommand(input, 'test') ??
      input.profile?.typecheckCommand ??
      scriptCommand(input, 'typecheck') ??
      input.profile?.buildCommand ??
      scriptCommand(input, 'build') ??
      input.profile?.lintCommand ??
      scriptCommand(input, 'lint') ??
      'echo "No validation command detected"';

    return {
      command,
      reason,
      estimatedCost: estimateCost(command, framework),
      expectedSignal: 'Broad regression signal across the changed dependency, configuration, or shared runtime surface.',
    };
  }

  private fallbackAfterFullSuite(input: ValidationPlannerInput): ValidationPlanCommand {
    const command =
      input.profile?.buildCommand ??
      scriptCommand(input, 'build') ??
      input.profile?.typecheckCommand ??
      scriptCommand(input, 'typecheck') ??
      input.profile?.lintCommand ??
      scriptCommand(input, 'lint') ??
      this.fullSuiteCommand(input).command;

    return {
      command,
      reason: 'Fallback checks packaging or static correctness after the full test command is unavailable or inconclusive.',
      estimatedCost: estimateCost(command),
      expectedSignal: 'Build, type, or lint failures that a test runner may not expose.',
    };
  }

  private ensureDistinctFallback(
    input: ValidationPlannerInput,
    primary: ValidationPlanCommand,
    fallback: ValidationPlanCommand,
    framework?: string,
  ): ValidationPlanCommand {
    if (primary.command !== fallback.command) {
      return fallback;
    }

    const alternatives: ValidationPlanCommand[] = [
      commandFromProfile(input.profile?.buildCommand ?? scriptCommand(input, 'build'), {
        reason: 'Selected build because it provides packaging and bundler/runtime integration signal distinct from the primary command.',
        estimatedCost: 'expensive',
        expectedSignal: 'Bundler, packaging, and entrypoint regressions not caught by the primary command.',
      }),
      commandFromProfile(input.profile?.lintCommand ?? scriptCommand(input, 'lint'), {
        reason: 'Selected lint because it provides static quality and correctness signal distinct from the primary command.',
        estimatedCost: 'cheap',
        expectedSignal: 'Import, style, React hook, and static rule violations.',
      }),
      commandFromProfile(input.profile?.typecheckCommand ?? scriptCommand(input, 'typecheck'), {
        reason: 'Selected typecheck because it provides contract and cross-module compile signal distinct from the primary command.',
        estimatedCost: 'cheap',
        expectedSignal: 'Type, contract, and cross-module compile errors.',
      }),
      commandFromProfile(input.profile?.testCommand ?? scriptCommand(input, 'test'), {
        reason: 'Selected full test command because it provides broader regression signal distinct from the primary command.',
        estimatedCost: estimateCost(input.profile?.testCommand ?? scriptCommand(input, 'test') ?? '', framework),
        expectedSignal: 'Automated test failures outside targeted coverage.',
      }),
    ].filter((candidate): candidate is ValidationPlanCommand =>
      Boolean(candidate && candidate.command !== primary.command),
    );

    return alternatives[0] ?? {
      command: fallback.command,
      reason: `${fallback.reason} No distinct fallback command was detected from available workspace scripts.`,
      estimatedCost: fallback.estimatedCost,
      expectedSignal: `${fallback.expectedSignal} Warning: duplicate command, no additional signal.`,
    };
  }
}

export const validationPlanner = new ValidationPlanner();

function normalizeFiles(files: string[]) {
  return Array.from(new Set(files.map((file) => file.trim()).filter(Boolean))).sort();
}

function scriptCommand(input: ValidationPlannerInput, script: string) {
  if (!input.packageScripts[script]) return undefined;
  return `${input.profile?.packageManager ?? 'npm'} run ${script}`;
}

function findLikelyTestPath(changedFiles: string[], impactedFiles: string[]) {
  const allFiles = [...changedFiles, ...impactedFiles];
  const directTest = allFiles.find((file) => TEST_FILE_PATTERN.test(file));
  if (directTest) return directTest;

  const sourceNames = changedFiles.map((file) =>
    file.replace(/\.[tj]sx?$/, '').replace(/\/index$/, ''),
  );
  return allFiles.find((file) =>
    TEST_FILE_PATTERN.test(file) &&
    sourceNames.some((sourceName) => file.startsWith(sourceName) || file.includes(`${sourceName.split('/').pop()}.`)),
  );
}

function isTypeScriptFramework(framework: string | undefined, files: string[]) {
  return Boolean(framework?.match(/react|vite|next|typescript|vitest|jest/i)) ||
    files.some((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
}

function estimateCost(command: string, framework?: string): ValidationCost {
  if (/lint|typecheck|--onlyChanged|\.test\.|\.spec\./.test(command)) return 'cheap';
  if (/build|playwright|e2e|make|cargo test|go test \.\/\.\./.test(command) || framework === 'playwright') return 'expensive';
  return 'medium';
}

function quotePath(file: string) {
  return `"${file.replace(/"/g, '\\"')}"`;
}

function commandFromProfile(
  command: string | undefined,
  metadata: Omit<ValidationPlanCommand, 'command'>,
) {
  return command ? { command, ...metadata } : undefined;
}

function estimateRisk(changedFiles: string[], impactedFiles: string[], fullSuiteRequired: boolean) {
  if (fullSuiteRequired || impactedFiles.length > 20 || changedFiles.some((file) => SECURITY_FILE_PATTERN.test(file))) {
    return 'high';
  }
  if (impactedFiles.length > 5 || changedFiles.length > 3) {
    return 'medium';
  }
  return 'low';
}

function buildFallbackTrigger(
  riskLevel: ValidationPlan['riskLevel'],
  primary: ValidationPlanCommand,
  fallback: ValidationPlanCommand,
) {
  if (primary.command === fallback.command) {
    return 'No distinct fallback exists; inspect primary output and create a manual follow-up command if signal is weak.';
  }
  if (riskLevel === 'high') {
    return 'Run fallback after primary passes, because touched surface is broad or security-sensitive.';
  }
  return 'Run fallback only if primary fails, is inconclusive, or user-facing behavior still changed outside targeted coverage.';
}

function buildRecommendations(
  input: ValidationPlannerInput,
  changedFiles: string[],
  impactedFiles: string[],
  riskLevel: ValidationPlan['riskLevel'],
) {
  const recommendations: string[] = [];
  if (riskLevel === 'high') {
    recommendations.push('Treat fallback as required before final confidence.');
  }
  if (changedFiles.some((file) => UI_FILE_PATTERN.test(file))) {
    recommendations.push('After command validation, inspect UI manually or with browser QA if visual behavior changed.');
  }
  if (changedFiles.some((file) => SECURITY_FILE_PATTERN.test(file))) {
    recommendations.push('Add security-oriented evidence: IPC/input validation, secret handling, or trust-boundary checks.');
  }
  if (impactedFiles.length === 0) {
    recommendations.push('RepoGraph returned no impacted files; mention lower confidence and rely on static validation.');
  }
  if (!input.profile?.testCommand && !input.packageScripts.test) {
    recommendations.push('No test script detected; prefer typecheck/lint and call out missing automated test coverage.');
  }
  return recommendations;
}

function buildComments(changedFiles: string[], impactedFiles: string[], fullSuiteRequired: boolean) {
  const comments = [
    `${changedFiles.length} changed file(s), ${impactedFiles.length} impacted file(s).`,
  ];
  comments.push(
    fullSuiteRequired
      ? 'Full-suite trigger matched config, dependency, shared contract, or entrypoint surface.'
      : 'No full-suite trigger matched; planner prefers narrowest useful validation.',
  );
  return comments;
}
