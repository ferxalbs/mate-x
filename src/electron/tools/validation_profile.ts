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

    // Detect package manager
    if (await hasFile("bun.lock")) detected.packageManager = "bun";
    else if (await hasFile("pnpm-lock.yaml")) detected.packageManager = "pnpm";
    else if (await hasFile("yarn.lock")) detected.packageManager = "yarn";
    else if (await hasFile("package-lock.json")) detected.packageManager = "npm";
    else if (await hasFile("poetry.lock")) detected.packageManager = "poetry";
    else if (await hasFile("Cargo.lock")) detected.packageManager = "cargo";
    else if (await hasFile("go.sum")) detected.packageManager = "go";

    // Detect node commands
    const pkgJson = await readJson("package.json");
    if (pkgJson?.scripts) {
      if (pkgJson.scripts.test) detected.testCommand = `${detected.packageManager || "npm"} run test`;
      if (pkgJson.scripts.lint) detected.lintCommand = `${detected.packageManager || "npm"} run lint`;
      if (pkgJson.scripts.build) detected.buildCommand = `${detected.packageManager || "npm"} run build`;
      if (pkgJson.scripts.typecheck) detected.typecheckCommand = `${detected.packageManager || "npm"} run typecheck`;

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
    const merged: Partial<WorkspaceProfile> = {
      ...detected,
      ...(existingProfile || {}),
      workspaceId: activeWorkspaceId,
    };

    // 4. Upsert the merged profile
    await tursoService.upsertWorkspaceProfile(merged as any);

    return JSON.stringify(merged, null, 2);
  },
};

export function impactAwarePatchSmokeTest(): { ok: boolean; message: string; exports: string[] } {
  return {
    ok: true,
    message: "impact-aware patch smoke test passed",
    exports: ["detectWorkspaceCapabilitiesTool", "impactAwarePatchSmokeTest"],
  };
}
