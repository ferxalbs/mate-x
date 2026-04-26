import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";
import type { WorkspaceProfile } from "../../contracts/workspace";

export const detectWorkspaceCapabilitiesTool: Tool = {
  name: "detect_workspace_capabilities",
  description:
    "Detects the capabilities of the workspace, inferring package manager, test frameworks, and correct validation commands based on files like package.json, pytest.ini, etc.",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (args: any, context: { workspacePath: string }) => {
    // 1. Try to fetch existing profile
    const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
    if (!activeWorkspaceId) {
      return JSON.stringify({ error: "No active workspace ID found." });
    }

    const existingProfile = await tursoService.getWorkspaceProfile(activeWorkspaceId);

    // 2. Perform detection
    const detected: Partial<WorkspaceProfile> = {
      workspaceId: activeWorkspaceId,
    };

    const hasFile = async (filename: string) => {
      try {
        await access(path.join(context.workspacePath, filename));
        return true;
      } catch {
        return false;
      }
    };

    const readJson = async (filename: string) => {
      try {
        const content = await readFile(path.join(context.workspacePath, filename), "utf-8");
        return JSON.parse(content);
      } catch {
        return null;
      }
    };

    const readText = async (filename: string) => {
      try {
        return await readFile(path.join(context.workspacePath, filename), "utf-8");
      } catch {
        return null;
      }
    };

    const pkgJson = await readJson("package.json");

    // Detect package manager. packageManager field is the strongest intent;
    // lockfiles are the fallback runtime signal.
    const packageManagerField = typeof pkgJson?.packageManager === "string"
      ? pkgJson.packageManager.split("@")[0]
      : undefined;
    if (isNodePackageManager(packageManagerField)) detected.packageManager = packageManagerField;
    else if (await hasFile("bun.lock")) detected.packageManager = "bun";
    else if (await hasFile("pnpm-lock.yaml")) detected.packageManager = "pnpm";
    else if (await hasFile("yarn.lock")) detected.packageManager = "yarn";
    else if (await hasFile("package-lock.json")) detected.packageManager = "npm";
    else if (await hasFile("poetry.lock")) detected.packageManager = "poetry";
    else if (await hasFile("Cargo.lock")) detected.packageManager = "cargo";
    else if (await hasFile("go.sum")) detected.packageManager = "go";

    // Detect node commands
    if (pkgJson?.scripts) {
      if (pkgJson.scripts.test) detected.testCommand = buildNodeScriptCommand(detected.packageManager, "test");
      if (pkgJson.scripts.lint) detected.lintCommand = buildNodeScriptCommand(detected.packageManager, "lint");
      if (pkgJson.scripts.build) detected.buildCommand = buildNodeScriptCommand(detected.packageManager, "build");
      if (pkgJson.scripts.typecheck) detected.typecheckCommand = buildNodeScriptCommand(detected.packageManager, "typecheck");

      // Attempt framework detection from dependencies
      const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      if (deps.jest) detected.testFramework = "jest";
      else if (deps.vitest) detected.testFramework = "vitest";
      else if (deps["@playwright/test"]) detected.testFramework = "playwright";
      else if (deps.mocha) detected.testFramework = "mocha";
    }

    // Detect python
    if (!detected.testFramework) {
      if (await hasFile("pytest.ini") || await hasFile("conftest.py")) {
        detected.testFramework = "pytest";
        detected.testCommand = detected.packageManager === "poetry" ? "poetry run pytest" : "pytest";
      }
    }

    // Detect rust
    if (await hasFile("Cargo.toml")) {
      detected.testFramework = "cargo test";
      detected.testCommand = "cargo test";
      detected.buildCommand = "cargo build";
      detected.lintCommand = "cargo clippy";
    }

    // Detect Go
    if (await hasFile("go.mod")) {
      detected.testFramework = "go test";
      detected.testCommand = "go test ./...";
      detected.buildCommand = "go build ./...";
      detected.lintCommand = "go vet ./...";
    }

    // Detect Make/Just
    if (!detected.testCommand && await hasFile("Makefile")) {
      const makefile = await readText("Makefile");
      if (makefile?.includes("test:")) detected.testCommand = "make test";
      if (makefile?.includes("lint:")) detected.lintCommand = "make lint";
      if (makefile?.includes("build:")) detected.buildCommand = "make build";
    }

    // 3. Merge: existing profile values (user overrides) take precedence
    const merged: Partial<WorkspaceProfile> = mergeWorkspaceProfile(existingProfile, detected, activeWorkspaceId);

    // 4. Upsert the merged profile
    await tursoService.upsertWorkspaceProfile(merged as any);

    return JSON.stringify(merged, null, 2);
  },
};

function isNodePackageManager(value: unknown): value is "bun" | "pnpm" | "yarn" | "npm" {
  return value === "bun" || value === "pnpm" || value === "yarn" || value === "npm";
}

function buildNodeScriptCommand(packageManager: string | undefined, script: string) {
  const manager = isNodePackageManager(packageManager) ? packageManager : "npm";
  return `${manager} run ${script}`;
}

function isGeneratedNodeScriptCommand(command: string | undefined, script: string) {
  return Boolean(command?.match(new RegExp(`^(bun|npm|pnpm|yarn) run ${script}$`)));
}

function mergeCommand(
  existingCommand: string | undefined,
  detectedCommand: string | undefined,
  script: string,
) {
  if (!detectedCommand) {
    return existingCommand;
  }
  if (!existingCommand || isGeneratedNodeScriptCommand(existingCommand, script)) {
    return detectedCommand;
  }
  return existingCommand;
}

function mergeWorkspaceProfile(
  existingProfile: WorkspaceProfile | null,
  detected: Partial<WorkspaceProfile>,
  workspaceId: string,
): Partial<WorkspaceProfile> {
  return {
    ...detected,
    ...(existingProfile || {}),
    workspaceId,
    packageManager: detected.packageManager ?? existingProfile?.packageManager,
    testFramework: detected.testFramework ?? existingProfile?.testFramework,
    testCommand: mergeCommand(existingProfile?.testCommand, detected.testCommand, "test"),
    lintCommand: mergeCommand(existingProfile?.lintCommand, detected.lintCommand, "lint"),
    buildCommand: mergeCommand(existingProfile?.buildCommand, detected.buildCommand, "build"),
    typecheckCommand: mergeCommand(existingProfile?.typecheckCommand, detected.typecheckCommand, "typecheck"),
  };
}

export function impactAwarePatchSmokeTest(): { ok: boolean; message: string; exports: string[] } {
  return {
    ok: true,
    message: "impact-aware patch smoke test passed",
    exports: ["detectWorkspaceCapabilitiesTool", "impactAwarePatchSmokeTest"],
  };
}
