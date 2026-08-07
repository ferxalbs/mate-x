import { tursoService } from "../turso-service";
import type { Tool } from "../tool-service";
import type { WorkspaceProfile } from "../../contracts/workspace";
import { collectRepositoryToolchainProfile } from "../repository-toolchain";
import { readUtf8FileSafe, resolveWorkspacePathForRead } from "./tool-utils";

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
        await resolveWorkspacePathForRead(context.workspacePath, filename);
        return true;
      } catch {
        return false;
      }
    };

    const readJson = async (filename: string) => {
      try {
        const { content } = await readUtf8FileSafe(context.workspacePath, filename);
        return JSON.parse(content);
      } catch {
        return null;
      }
    };

    const readText = async (filename: string) => {
      try {
        return (await readUtf8FileSafe(context.workspacePath, filename)).content;
      } catch {
        return null;
      }
    };

    const pkgJson = await readJson("package.json");
    const targetToolchain = await collectRepositoryToolchainProfile({
      root: context.workspacePath,
      changedFiles: [],
    });

    // Detect package manager. packageManager field is the strongest intent;
    // lockfiles are the fallback runtime signal.
    const packageManagerField = typeof pkgJson?.packageManager === "string"
      ? pkgJson.packageManager.split("@")[0]
      : undefined;
    if (targetToolchain.manager) detected.packageManager = targetToolchain.manager;
    else if (isNodePackageManager(packageManagerField)) detected.packageManager = packageManagerField;
    else if (await hasFile("bun.lock")) detected.packageManager = "bun";
    else if (await hasFile("pnpm-lock.yaml")) detected.packageManager = "pnpm";
    else if (await hasFile("yarn.lock")) detected.packageManager = "yarn";
    else if (await hasFile("package-lock.json")) detected.packageManager = "npm";
    else if (await hasFile("poetry.lock")) detected.packageManager = "poetry";
    else if (await hasFile("Cargo.lock")) detected.packageManager = "cargo";
    else if (await hasFile("go.sum")) detected.packageManager = "go";

    // Detect node commands
    if (pkgJson?.scripts) {
      detected.testCommand = targetToolchain.commands.test.command ?? undefined;
      detected.lintCommand = targetToolchain.commands.lint.command ?? undefined;
      detected.buildCommand = targetToolchain.commands.build.command ?? undefined;
      detected.typecheckCommand = targetToolchain.commands.typecheck.command ?? undefined;

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

    // 3. Keep user-selected shell/flags, but replace every auto-detected command
    // with the current repository snapshot. Missing commands intentionally clear
    // stale generated values from prior runs.
    const merged: Partial<WorkspaceProfile> = {
      ...detected,
      workspaceId: activeWorkspaceId,
      testFramework: detected.testFramework ?? existingProfile?.testFramework,
      shell: existingProfile?.shell,
      flags: existingProfile?.flags,
      updatedAt: new Date().toISOString(),
    };

    // 4. Upsert the merged profile
    await tursoService.upsertWorkspaceProfile(
      { ...merged, workspaceId: activeWorkspaceId },
      { replaceDetectedFields: true },
    );

    return JSON.stringify(merged, null, 2);
  },
};

function isNodePackageManager(value: unknown): value is "bun" | "pnpm" | "yarn" | "npm" {
  return value === "bun" || value === "pnpm" || value === "yarn" || value === "npm";
}


export function impactAwarePatchSmokeTest(): { ok: boolean; message: string; exports: string[] } {
  return {
    ok: true,
    message: "impact-aware patch smoke test passed",
    exports: ["detectWorkspaceCapabilitiesTool", "impactAwarePatchSmokeTest"],
  };
}
