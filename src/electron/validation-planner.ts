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

    const primary = fullSuiteRequired
      ? this.fullSuiteCommand(input, framework)
      : this.targetedCommand(input, changedFiles, impactedFiles, framework);

    const fallback = fullSuiteRequired
      ? this.fallbackAfterFullSuite(input)
      : this.fullSuiteCommand(input, framework, 'Fallback covers transitive regressions if targeted validation misses an integration boundary.');

    return {
      id: createId('vplan'),
      objective: input.objective.trim(),
      changedFiles,
      impactedFiles,
      detectedFramework: framework,
      primary,
      fallback,
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
  return [...changedFiles, ...impactedFiles].find((file) => TEST_FILE_PATTERN.test(file));
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
