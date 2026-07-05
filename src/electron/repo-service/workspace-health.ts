import type { GitStatus } from "../../contracts/git";
import type { WorkspaceHealthProfile } from "../../contracts/workspace";

export function buildWorkspaceHealthProfile({
  files,
  packageJson,
  stack,
  status,
}: {
  files: string[];
  packageJson: string | null;
  stack: string[];
  status: GitStatus | null;
}): WorkspaceHealthProfile {
  const packageData = parsePackageJson(packageJson);
  const scripts = readPackageScripts(packageData);
  const packageManager = detectPackageManager(files, packageData);
  const testCommand = detectScriptCommand(packageManager, scripts, [
    "test",
    "test:unit",
    "vitest",
  ]);
  const lintCommand = detectScriptCommand(packageManager, scripts, ["lint"]);
  const buildCommand = detectScriptCommand(packageManager, scripts, ["build"]);
  const secretWarningCount = countSecretRiskSignals(files);
  const dependencyWarningCount =
    packageManager === "unknown" && packageJson ? 1 : 0;
  const gitDirtyState = status
    ? status.isClean
      ? "clean"
      : `${status.files.length} changed`
    : "not-a-repo";

  return {
    stack,
    packageManager,
    framework: detectPrimaryFramework(stack),
    testRunner: detectTestRunner(files, packageJson, scripts),
    testCommand,
    lintCommand,
    buildCommand,
    gitDirtyState,
    dependencyWarningCount,
    secretWarningCount,
    recommendedNextAction: getRecommendedHealthAction({
      buildCommand,
      dependencyWarningCount,
      gitDirtyState,
      lintCommand,
      secretWarningCount,
      testCommand,
    }),
    updatedAt: new Date().toISOString(),
  };
}

function parsePackageJson(packageJson: string | null): unknown {
  if (!packageJson) return null;

  try {
    return JSON.parse(packageJson);
  } catch {
    return null;
  }
}

function readPackageScripts(packageData: unknown): Record<string, string> {
  if (
    !packageData ||
    typeof packageData !== "object" ||
    !("scripts" in packageData) ||
    typeof packageData.scripts !== "object" ||
    packageData.scripts === null
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(packageData.scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function detectPackageManager(files: string[], packageData: unknown) {
  const declaredManager = readDeclaredPackageManager(packageData);
  if (declaredManager) return declaredManager;

  if (files.includes("bun.lock")) return "bun";
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";

  return "unknown";
}

export function detectScriptCommand(
  packageManager: string,
  scripts: Record<string, string>,
  candidates: string[],
) {
  const scriptName = candidates.find((candidate) => scripts[candidate]);
  if (!scriptName) return "unknown";
  if (!isNodePackageManager(packageManager)) return "unknown";

  return `${packageManager} run ${scriptName}`;
}

function readDeclaredPackageManager(packageData: unknown) {
  if (
    !packageData ||
    typeof packageData !== "object" ||
    !("packageManager" in packageData) ||
    typeof packageData.packageManager !== "string"
  ) {
    return null;
  }

  const manager = packageData.packageManager.split("@")[0]?.trim();
  return isNodePackageManager(manager) ? manager : null;
}

function isNodePackageManager(manager: string | undefined | null) {
  return (
    manager === "bun" ||
    manager === "pnpm" ||
    manager === "yarn" ||
    manager === "npm"
  );
}

function detectPrimaryFramework(stack: string[]) {
  return (
    stack.find((entry) =>
      ["Electron", "React", "TanStack Router"].includes(entry),
    ) ?? "unknown"
  );
}

function detectTestRunner(
  files: string[],
  packageJson: string | null,
  scripts: Record<string, string>,
) {
  const evidence = `${packageJson ?? ""}\n${Object.values(scripts).join("\n")}`;

  if (
    /vitest/i.test(evidence) ||
    files.some((file) => file.includes("vitest.config"))
  ) {
    return "vitest";
  }
  if (
    /jest/i.test(evidence) ||
    files.some((file) => file.includes("jest.config"))
  ) {
    return "jest";
  }
  if (
    /playwright/i.test(evidence) ||
    files.some((file) => file.includes("playwright.config"))
  ) {
    return "playwright";
  }

  return files.some((file) => /\.test\.[cm]?[tj]sx?$/.test(file))
    ? "detected"
    : "unknown";
}

function countSecretRiskSignals(files: string[]) {
  return files.filter((file) =>
    /(^|\/)\.env($|\.|\/)|secret|credentials|private-key/i.test(file),
  ).length;
}

function getRecommendedHealthAction({
  testCommand,
  lintCommand,
  buildCommand,
  secretWarningCount,
  dependencyWarningCount,
  gitDirtyState,
}: Pick<
  WorkspaceHealthProfile,
  | "testCommand"
  | "lintCommand"
  | "buildCommand"
  | "secretWarningCount"
  | "dependencyWarningCount"
  | "gitDirtyState"
>) {
  if (secretWarningCount > 0) return "Review secret-like files before running analysis.";
  if (testCommand === "unknown") return "Add or configure a test script for verified runs.";
  if (lintCommand === "unknown") return "Add or configure a lint script for quality validation.";
  if (buildCommand === "unknown") return "Add or configure a build script for release validation.";
  if (dependencyWarningCount > 0) return "Confirm package manager before dependency validation.";
  if (gitDirtyState !== "clean" && gitDirtyState !== "not-a-repo") {
    return "Run validation against changed files before committing.";
  }

  return "Repo health profile ready for targeted validation.";
}
