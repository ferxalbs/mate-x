import { isAbsolute, normalize, relative } from "node:path";

import { resolveRainyApiBaseUrl } from "../config/rainy";
import type {
  WorkspaceTrustContract,
  WorkspaceWriteAccess,
} from "../contracts/workspace";
import { createId } from "../lib/id";

export const TRUST_CONTRACT_SCHEMA_VERSION = 2;
const INTERNAL_READ_PATHS = [".mate-x/evidence"];

function resolveConfiguredRainyHostname(): string | null {
  try {
    return new URL(resolveRainyApiBaseUrl()).hostname;
  } catch {
    return null;
  }
}

/**
 * Detect-or-deny defaults (NES-2.4).
 * Non-JS / unknown package managers get empty command allowlists + safe reads only.
 * Never hardcode MaTE monorepo bun-centric law as universal trust.
 */
export function createDefaultWorkspaceTrustContract(
  workspaceId: string,
  workspaceName: string,
  hints?: {
    packageManager?: "bun" | "npm" | "pnpm" | "yarn" | "unknown" | null;
    hasPackageJson?: boolean;
    detectedScripts?: string[];
  },
): WorkspaceTrustContract {
  const rainyHostname = resolveConfiguredRainyHostname();
  const hasPackageJson = hints?.hasPackageJson ?? true;
  const packageManager = hints?.packageManager ?? (hasPackageJson ? "unknown" : null);

  const allowedCommands: string[] = [];
  if (hasPackageJson && packageManager) {
    // Detect scripts when provided; otherwise deny-by-default for commands
    // until workspace profile fills allowlists.
    const scripts = hints?.detectedScripts ?? [];
    for (const script of scripts) {
      if (packageManager === "bun") allowedCommands.push(`bun run ${script}`);
      else if (packageManager === "npm") allowedCommands.push(`npm run ${script}`);
      else if (packageManager === "pnpm") allowedCommands.push(`pnpm run ${script}`);
      else if (packageManager === "yarn") allowedCommands.push(`yarn ${script}`);
    }
    // Safe common verification only when package.json exists and PM known
    if (packageManager === "bun") {
      allowedCommands.push("bun test", "bun run lint", "bun run typecheck");
    } else if (packageManager === "npm") {
      allowedCommands.push("npm test", "npm run lint", "npm run typecheck");
    } else if (packageManager === "pnpm") {
      allowedCommands.push("pnpm test", "pnpm run lint", "pnpm run typecheck");
    } else if (packageManager === "yarn") {
      allowedCommands.push("yarn test", "yarn lint", "yarn typecheck");
    }
    // packageManager unknown with package.json: empty command allowlist (deny)
  }

  const allowedPaths = hasPackageJson
    ? ["src", "package.json", "README.md", "AGENTS.md", ...INTERNAL_READ_PATHS]
    : [".", "README.md", ...INTERNAL_READ_PATHS];

  return {
    id: createId("trust"),
    workspaceId,
    name: `${workspaceName} governed review`,
    version: TRUST_CONTRACT_SCHEMA_VERSION,
    writeAccess: "approval-required",
    allowedPaths,
    forbiddenPaths: [
      ".env",
      ".env.*",
      ".git",
      "node_modules",
      "dist",
      "build",
      "infra/prod",
      ".env.production",
    ],
    allowedCommands,
    allowedDomains: [
      "api.github.com",
      "docs.github.com",
      "docs.npmjs.com",
      ...(rainyHostname ? [rainyHostname] : []),
    ],
    allowedSecrets: [],
    allowedActions: ["read", "search", "patch", "test"],
    blockedActions: [
      "deploy",
      "delete",
      "install-global-packages",
      "exfiltrate-secrets",
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeWorkspaceTrustContract(
  contract: PersistedWorkspaceTrustContract,
): WorkspaceTrustContract {
  const legacyAutonomy = "autonomy" in contract ? contract.autonomy : undefined;
  const { autonomy: _legacyAutonomy, ...currentContract } = contract;
  void _legacyAutonomy;
  const writeAccess =
    contract.writeAccess ??
    (legacyAutonomy === "plan-only"
      ? "read-only"
      : legacyAutonomy === "trusted-patch" || legacyAutonomy === "unrestricted"
        ? "workspace"
        : "approval-required");
  return {
    ...currentContract,
    name: contract.name.trim() || "Workspace trust contract",
    version: Math.max(
      Number.isInteger(contract.version) && contract.version > 0
        ? contract.version
        : TRUST_CONTRACT_SCHEMA_VERSION,
      TRUST_CONTRACT_SCHEMA_VERSION,
    ),
    writeAccess,
    allowedPaths: appendInternalReadPaths(normalizeList(contract.allowedPaths)),
    forbiddenPaths: normalizeList(contract.forbiddenPaths),
    allowedCommands: normalizeList(contract.allowedCommands),
    allowedDomains: normalizeAllowedDomains(contract.allowedDomains),
    allowedSecrets: normalizeList(contract.allowedSecrets),
    allowedActions: normalizeList(contract.allowedActions),
    blockedActions: normalizeList(contract.blockedActions),
    updatedAt: contract.updatedAt || new Date().toISOString(),
  };
}

export type PersistedWorkspaceTrustContract = Omit<
  WorkspaceTrustContract,
  "writeAccess"
> & {
  writeAccess?: WorkspaceWriteAccess;
  autonomy?: "plan-only" | "approval-required" | "trusted-patch" | "unrestricted";
};

function appendInternalReadPaths(paths: string[]) {
  if (paths.length === 0 || paths.includes(".")) return paths;
  return [...paths, ...INTERNAL_READ_PATHS.filter((internalPath) => !paths.includes(internalPath))];
}

export function evaluateTrustForToolCall({
  toolName,
  args,
  contract,
}: {
  toolName: string;
  args: Record<string, unknown>;
  contract: WorkspaceTrustContract;
}) {
  const normalizedContract = normalizeWorkspaceTrustContract(contract);

  const requiredAction = getRequiredAction(toolName, args);

  if (
    normalizedContract.writeAccess === "read-only" &&
    requiredAction &&
    !["read", "search"].includes(requiredAction)
  ) {
    return `Workspace policy blocks ${toolName}: repository writes are disabled.`;
  }

  if (
    requiredAction &&
    !normalizedContract.allowedActions.includes(requiredAction)
  ) {
    return `Workspace policy blocks ${toolName}: action "${requiredAction}" is not allowed.`;
  }

  const blockedAction = getBlockedAction(toolName, args, normalizedContract);
  if (blockedAction) {
    return `Workspace policy blocks ${toolName}: action "${blockedAction}" is prohibited.`;
  }

  const command = extractCommand(toolName, args);
  if (command) {
    const allowed = normalizedContract.allowedCommands.some(
      (allowedCommand) =>
        command === allowedCommand || command.startsWith(`${allowedCommand} `),
    );
    if (!allowed) {
      return `Workspace policy blocks command "${command}".`;
    }
  }

  const pathValues = extractPathValues(args, toolName);
  for (const pathValue of pathValues) {
    const pathError = evaluatePath(pathValue, normalizedContract, toolName);
    if (pathError) {
      return `Workspace policy blocks ${toolName}: ${pathError}`;
    }
  }

  return null;
}

export function canQueryDomain(
  contract: WorkspaceTrustContract,
  hostname: string,
) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizeWorkspaceTrustContract(contract).allowedDomains.some(
    (domain) =>
      normalizedHostname === domain ||
      normalizedHostname.endsWith(`.${domain}`),
  );
}

function normalizeList(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function normalizeAllowedDomains(values: string[]) {
  return normalizeList(values).map((domain) => domain.toLowerCase());
}

function getRequiredAction(toolName: string, args: Record<string, unknown>) {
  if (
    toolName === "auto_patch" ||
    toolName === "file_editor" ||
    toolName === "mutation" ||
    toolName.includes("edit")
  ) {
    return "patch";
  }

  if (toolName === "sandbox_run" && isPackageManagerMutation(args)) {
    return "package-install";
  }

  if (toolName === "run_tests" || toolName === "sandbox_run") {
    return "test";
  }

  if (toolName === "git_diag") {
    return args.operation === "diff" || args.operation === "show"
      ? "read"
      : "search";
  }

  if (toolName.includes("patch")) {
    return "patch";
  }

  return toolName === "rg" ? "search" : "read";
}

function isPackageManagerMutation(args: Record<string, unknown>) {
  const command = typeof args.command === "string" ? args.command : "";

  return /\b(bun|npm|pnpm|yarn)\s+(add|install|i|update|upgrade|remove|uninstall)\b/i.test(
    command,
  );
}

function getBlockedAction(
  toolName: string,
  args: Record<string, unknown>,
  contract: WorkspaceTrustContract,
) {
  if (toolName === "sandbox_run") {
    const command = typeof args.command === "string" ? args.command : "";
    if (
      /\bdeploy\b|vercel|netlify|firebase|railway|flyctl|kubectl/i.test(command)
    ) {
      return "deploy";
    }
    if (
      /\bnpm\s+install\s+-g\b|\bbun\s+add\s+-g\b|\byarn\s+global\b/i.test(
        command,
      )
    ) {
      return "install-global-packages";
    }
  }

  return (
    contract.blockedActions.find((blockedAction) => {
      if (blockedAction === "delete") {
        return /\brm\b|\bdel\b|delete|unlink/i.test(JSON.stringify(args));
      }

      if (blockedAction === "deploy") {
        return /deploy|vercel|netlify|firebase|railway|flyctl|kubectl/i.test(
          JSON.stringify(args),
        );
      }

      return false;
    }) ?? null
  );
}

function extractCommand(toolName: string, args: Record<string, unknown>) {
  if (toolName === "sandbox_run" && typeof args.command === "string") {
    return args.command.trim();
  }

  return null;
}

function extractPathValues(args: Record<string, unknown>, toolName: string) {
  const pathKeys =
    toolName === "run_tests"
      ? ["specificPath"]
      : ["path", "scope", "specificPath"];
  const scalarPaths = pathKeys
    .map((key) => args[key])
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
  const arrayPaths = ["paths"]
    .flatMap((key) => args[key])
    .filter(Array.isArray)
    .flatMap((values) => values)
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );

  return [...scalarPaths, ...arrayPaths];
}

function evaluatePath(
  pathValue: string,
  contract: WorkspaceTrustContract,
  toolName: string,
) {
  const candidate = normalizeWorkspaceRelativePath(pathValue);
  if (!candidate) {
    return "path must remain within the active workspace.";
  }

  if (matchesAnyPath(candidate, contract.forbiddenPaths)) {
    return `"${pathValue}" matches a forbidden path.`;
  }

  if (toolName === "ls" && candidate === ".") {
    return null;
  }

  if (
    contract.allowedPaths.length === 0 ||
    contract.allowedPaths.includes(".")
  ) {
    return null;
  }

  if (!matchesAnyPath(candidate, contract.allowedPaths)) {
    return `"${pathValue}" is outside allowed paths.`;
  }

  return null;
}

function normalizeWorkspaceRelativePath(pathValue: string) {
  const trimmed = pathValue.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "./") {
    return ".";
  }

  const normalized = normalize(trimmed).replaceAll("\\", "/");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    isAbsolute(normalized) ||
    relative(".", normalized).startsWith("..")
  ) {
    return null;
  }

  return normalized === "" ? "." : normalized;
}

function matchesAnyPath(candidate: string, patterns: string[]) {
  return patterns.some((pattern) => matchesPathPattern(candidate, pattern));
}

function matchesPathPattern(candidate: string, pattern: string) {
  const normalizedPattern = normalizeWorkspaceRelativePath(pattern);
  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern === ".") {
    return candidate === "." || !candidate.startsWith("../");
  }

  if (normalizedPattern.endsWith(".*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return candidate.startsWith(prefix);
  }

  return (
    candidate === normalizedPattern ||
    candidate.startsWith(`${normalizedPattern}/`)
  );
}
