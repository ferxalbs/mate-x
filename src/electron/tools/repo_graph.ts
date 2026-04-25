import type { Tool } from "../tool-service";
import { repoGraphService } from "../repo-graph-service";
import { tursoService } from "../turso-service";

type RepoGraphOperation =
  | "refresh"
  | "get_entrypoints"
  | "get_impacted_files"
  | "get_tests_for_file"
  | "get_import_chain"
  | "get_ipc_surface"
  | "get_env_usage"
  | "get_dependency_surface";

export const repoGraphTool: Tool = {
  name: "repo_graph",
  description:
    "Query persistent repository structure before broad search. Use for entrypoints, impacted files, tests, import chains, IPC, env vars, and dependencies.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: [
          "refresh",
          "get_entrypoints",
          "get_impacted_files",
          "get_tests_for_file",
          "get_import_chain",
          "get_ipc_surface",
          "get_env_usage",
          "get_dependency_surface",
        ],
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Changed files for get_impacted_files.",
      },
      file: {
        type: "string",
        description: "Source file for get_tests_for_file.",
      },
      from: {
        type: "string",
        description: "Start file for get_import_chain.",
      },
      to: {
        type: "string",
        description: "Target file for get_import_chain.",
      },
      variable: {
        type: "string",
        description: "Optional env var name for get_env_usage.",
      },
    },
    required: ["operation"],
  },
  async execute(args, context) {
    const workspace = await resolveWorkspaceByPath(context.workspacePath);
    const operation = String(args.operation ?? "") as RepoGraphOperation;

    switch (operation) {
      case "refresh":
        return stringify(await repoGraphService.refreshWorkspace(workspace));
      case "get_entrypoints":
        return stringify(await repoGraphService.getEntrypoints(workspace));
      case "get_impacted_files":
        return stringify(
          await repoGraphService.getImpactedFiles(
            workspace,
            Array.isArray(args.files) ? args.files : [],
          ),
        );
      case "get_tests_for_file":
        return stringify(
          await repoGraphService.getTestsForFile(workspace, String(args.file ?? "")),
        );
      case "get_import_chain":
        return stringify(
          await repoGraphService.getImportChain(
            workspace,
            String(args.from ?? ""),
            String(args.to ?? ""),
          ),
        );
      case "get_ipc_surface":
        return stringify(await repoGraphService.getIpcSurface(workspace));
      case "get_env_usage":
        return stringify(
          await repoGraphService.getEnvUsage(
            workspace,
            typeof args.variable === "string" && args.variable.trim()
              ? args.variable.trim()
              : undefined,
          ),
        );
      case "get_dependency_surface":
        return stringify(await repoGraphService.getDependencySurface(workspace));
      default:
        return `Unknown repo_graph operation: ${String(args.operation)}`;
    }
  },
};

async function resolveWorkspaceByPath(workspacePath: string) {
  await tursoService.ensureSeedWorkspace(workspacePath);
  const workspaces = await tursoService.getWorkspaces();
  const workspace = workspaces.find((entry) => entry.path === workspacePath);
  if (!workspace) {
    throw new Error(`Workspace not found for path: ${workspacePath}`);
  }
  return workspace;
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}
