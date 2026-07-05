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
  | "get_dependency_surface"
  | "semantic_search"
  | "get_semantic_profile"
  | "get_architecture_summary"
  | "detect_changes";

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
          "semantic_search",
          "get_semantic_profile",
          "get_architecture_summary",
          "detect_changes",
        ],
      },
      query: {
        type: "string",
        description: "Search query for semantic_search.",
      },
      limit: {
        type: "number",
        description: "Maximum semantic_search results.",
      },
      role: {
        type: "string",
        description: "Optional semantic role filter for semantic_search.",
      },
      risk: {
        type: "string",
        description: "Optional risk tag filter for semantic_search.",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Changed files for get_impacted_files or detect_changes.",
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
      case "semantic_search":
        return stringify(
          await repoGraphService.semanticSearch(
            workspace,
            String(args.query ?? ""),
            {
              limit: typeof args.limit === "number" ? args.limit : undefined,
              role: typeof args.role === "string" && args.role.trim()
                ? args.role.trim()
                : undefined,
              risk: typeof args.risk === "string" && args.risk.trim()
                ? args.risk.trim()
                : undefined,
            },
          ),
        );
      case "get_semantic_profile":
        return stringify(
          await repoGraphService.getSemanticProfile(workspace, String(args.file ?? "")),
        );
      case "get_architecture_summary":
        return stringify(await repoGraphService.getArchitectureSummary(workspace));
      case "detect_changes":
        return stringify(
          await repoGraphService.detectChanges(
            workspace,
            Array.isArray(args.files) ? args.files : undefined,
          ),
        );
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
