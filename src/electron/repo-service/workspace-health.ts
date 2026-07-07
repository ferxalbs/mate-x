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
  const packageManagerDetails = detectPackageManagerDetails(files, packageData);
  const packageManager = packageManagerDetails.name;
  const testRunner = detectTestRunner(files, packageJson, scripts);
  const testCommand = detectScriptCommand(packageManager, scripts, [
    "test",
    "test:unit",
    "vitest",
  ]);
  const lintCommand = detectScriptCommand(packageManager, scripts, ["lint"]);
  const buildCommand = detectScriptCommand(packageManager, scripts, ["build"]);
  const typecheckCommand = detectScriptCommand(packageManager, scripts, [
    "typecheck",
    "check:types",
    "tsc",
  ]);
  const secretWarningCount = countSecretRiskSignals(files);
  const dependencyWarningCount =
    packageManagerDetails.warnings.length +
    (packageManager === "unknown" && packageJson ? 1 : 0);
  const gitDirtyState = status
    ? status.isClean
      ? "clean"
      : `${status.files.length} changed`
    : "not-a-repo";

  return {
    stack,
    packageManager,
    packageManagerSource: packageManagerDetails.source,
    packageManagerWarnings: packageManagerDetails.warnings,
    framework: detectPrimaryFramework(stack),
    testRunner,
    testCommand,
    lintCommand,
    buildCommand,
    typecheckCommand,
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
      typecheckCommand,
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
  return detectPackageManagerDetails(files, packageData).name;
}

export function detectPackageManagerDetails(
  files: string[],
  packageData: unknown,
) {
  const declaredManager = readDeclaredPackageManager(packageData);
  const evidence = collectPackageManagerEvidence(files);
  const warnings = getPackageManagerWarnings(
    declaredManager ? [declaredManager, ...evidence] : evidence,
  );

  if (declaredManager) {
    return {
      name: declaredManager.name,
      source: declaredManager.source,
      warnings,
    };
  }

  const rootEvidence = evidence.find((entry) => entry.scope === "root");
  if (rootEvidence) {
    return {
      name: rootEvidence.name,
      source: rootEvidence.source,
      warnings,
    };
  }

  const nestedEvidence = evidence[0];
  if (nestedEvidence) {
    return {
      name: nestedEvidence.name,
      source: nestedEvidence.source,
      warnings: [
        ...warnings,
        `Package manager inferred from nested ${nestedEvidence.file}; root intent is not explicit.`,
      ],
    };
  }

  return {
    name: "unknown",
    source: "none",
    warnings,
  };
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
  const manager = readPackageManagerField(packageData);
  if (manager) {
    return {
      name: manager,
      source: "package.json packageManager",
      scope: "root" as const,
      file: "package.json",
    };
  }

  const devEngineManager = readDevEnginesPackageManager(packageData);
  if (devEngineManager) {
    return {
      name: devEngineManager,
      source: "package.json devEngines.packageManager",
      scope: "root" as const,
      file: "package.json",
    };
  }

  return null;
}

function readPackageManagerField(packageData: unknown) {
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

function readDevEnginesPackageManager(packageData: unknown) {
  if (
    !packageData ||
    typeof packageData !== "object" ||
    !("devEngines" in packageData) ||
    !packageData.devEngines ||
    typeof packageData.devEngines !== "object" ||
    !("packageManager" in packageData.devEngines)
  ) {
    return null;
  }

  const value = packageData.devEngines.packageManager;
  const manager =
    typeof value === "string"
      ? value.split("@")[0]?.trim()
      : value &&
          typeof value === "object" &&
          "name" in value &&
          typeof value.name === "string"
        ? value.name.trim()
        : null;

  return isNodePackageManager(manager) ? manager : null;
}

function collectPackageManagerEvidence(files: string[]) {
  return files.flatMap((file) => {
    const normalized = file.replaceAll("\\", "/");
    const basename = normalized.split("/").pop();
    const scope = normalized === basename ? ("root" as const) : ("nested" as const);
    const name = lockfilePackageManager(basename);

    return name
      ? [
          {
            name,
            source: `${scope} ${basename}`,
            scope,
            file: normalized,
          },
        ]
      : [];
  });
}

function lockfilePackageManager(file: string | undefined) {
  switch (file) {
    case "bun.lock":
    case "bun.lockb":
      return "bun";
    case "pnpm-lock.yaml":
      return "pnpm";
    case "yarn.lock":
      return "yarn";
    case "package-lock.json":
    case "npm-shrinkwrap.json":
      return "npm";
    default:
      return null;
  }
}

function getPackageManagerWarnings(
  evidence: Array<{ name: string; source: string }>,
) {
  const managers = new Map<string, string[]>();

  for (const entry of evidence) {
    managers.set(entry.name, [...(managers.get(entry.name) ?? []), entry.source]);
  }

  if (managers.size <= 1) return [];

  const summary = Array.from(managers.entries())
    .map(([manager, sources]) => `${manager}: ${sources.join(", ")}`)
    .join("; ");

  return [`Conflicting package manager evidence found (${summary}).`];
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
  typecheckCommand,
}: Pick<
  WorkspaceHealthProfile,
  | "testCommand"
  | "lintCommand"
  | "buildCommand"
  | "typecheckCommand"
  | "secretWarningCount"
  | "dependencyWarningCount"
  | "gitDirtyState"
>) {
  if (secretWarningCount > 0) return "Review secret-like files before running analysis.";
  if (testCommand === "unknown") return "Add or configure a test script for verified runs.";
  if (lintCommand === "unknown") return "Add or configure a lint script for quality validation.";
  if (buildCommand === "unknown") return "Add or configure a build script for release validation.";
  if (typecheckCommand === "unknown") return "Add or configure a typecheck script for release validation.";
  if (dependencyWarningCount > 0) return "Resolve package manager evidence before dependency validation.";
  if (gitDirtyState !== "clean" && gitDirtyState !== "not-a-repo") {
    return "Run validation against changed files before committing.";
  }

  return "Repo health profile ready for targeted validation.";
}
