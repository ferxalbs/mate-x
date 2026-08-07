import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type {
  ObjectiveAssertionMatch,
  ObjectiveAssertionResult,
  ObjectiveVerificationEvidence,
  RepositoryObjectiveAssertion,
  WorkObjectiveContract,
} from "../../contracts/work-objective";
import { GitService } from "../git-service";
import { readUtf8FileSafe, resolveWorkspacePathForRead } from "../tools/tool-utils";
import type { WorkPlan } from "./types";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".mate-x",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".cts",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);

const MAX_INSPECTABLE_FILE_BYTES = 4 * 1024 * 1024;

interface RepositoryFile {
  path: string;
  contentHash: string;
  text?: string;
}

export interface VerifyRepositoryObjectiveInput {
  objective: WorkObjectiveContract;
  workspacePath: string;
  workspaceId: string;
  runId: string;
  previousEvidence?: ObjectiveVerificationEvidence;
  maxFiles?: number;
  now?: () => string;
}

export async function scheduleObjectiveVerification(input: {
  workPlan: WorkPlan;
  workspacePath: string;
  workspaceId: string;
  runId: string;
}) {
  const objective = input.workPlan.objectiveContract;
  if (!objective || (objective.repositoryAssertions?.length ?? 0) === 0) {
    input.workPlan.objectiveVerification = undefined;
    return undefined;
  }
  const evidence = await verifyRepositoryObjective({
    objective,
    workspacePath: input.workspacePath,
    workspaceId: input.workspaceId,
    runId: input.runId,
    previousEvidence: input.workPlan.objectiveVerification,
  });
  const state = objectiveStateFromVerification(evidence);
  input.workPlan.objectiveVerification = evidence;
  objective.objectiveAlreadySatisfied = state === "satisfied";
  objective.actualDelta.targetState = state;
  objective.actualDelta.evidenceIds = evidence.evidenceExecutionIds;
  return evidence;
}

export async function verifyRepositoryObjective(
  input: VerifyRepositoryObjectiveInput,
): Promise<ObjectiveVerificationEvidence> {
  const assertions = input.objective.repositoryAssertions ?? [];
  const objectiveContractHash = hashJson({
    schemaVersion: input.objective.schemaVersion,
    primaryObjective: input.objective.primaryObjective,
    requestedRepositoryState: input.objective.requestedRepositoryState,
    assertions,
  });
  const objectiveId = `objective-${objectiveContractHash.slice(0, 24)}`;
  const repository = await inspectRepository(input.workspacePath);
  const repositoryHead = await readRepositoryHead(input.workspacePath);
  const repositorySnapshotId = hashRepositorySnapshot(repositoryHead, repository.files);
  const requiredScopeHash = hashRequiredScope(assertions, repository.files);

  if (isReusableObjectiveVerification(input.previousEvidence, {
    workspaceId: input.workspaceId,
    objectiveId,
    objectiveContractHash,
    requiredScopeHash,
    repositorySnapshotId,
  })) {
    return input.previousEvidence!;
  }

  const maxFiles = Math.max(1, input.maxFiles ?? 10_000);
  const results = assertions.map((assertion) => evaluateAssertion(
    assertion,
    repository.files,
    repository.readFailures,
    maxFiles,
  ));
  const coverage = repository.readFailures.length > 0 || results.some((result) => result.status === "indeterminate")
    ? "partial" as const
    : "complete" as const;
  const status = coverage === "partial"
    ? "indeterminate" as const
    : results.length === 0
      ? "indeterminate" as const
      : results.some((result) => result.status === "failed")
        ? "unsatisfied" as const
        : results.every((result) => result.status === "passed")
          ? "satisfied" as const
          : "indeterminate" as const;
  const inspectedFiles = unique(results.flatMap((result) => filesInspectedForResult(
    result,
    assertions,
    repository.files,
    maxFiles,
  ))).sort();
  const evidenceSeed = hashJson({
    objectiveId,
    runId: input.runId,
    workspaceId: input.workspaceId,
    repositorySnapshotId,
    status,
    coverage,
    results,
  });
  const id = `objective-verification-${evidenceSeed.slice(0, 24)}`;

  return {
    id,
    objectiveId,
    objectiveContractHash,
    requiredScopeHash,
    runId: input.runId,
    workspaceId: input.workspaceId,
    repositorySnapshotId,
    repositoryHead,
    status,
    coverage,
    assertions: results,
    inspectedFiles,
    evidenceExecutionIds: [`objective-verifier:${id}`],
    createdAt: input.now?.() ?? new Date().toISOString(),
  };
}

export function isReusableObjectiveVerification(
  evidence: ObjectiveVerificationEvidence | undefined,
  expected: {
    workspaceId: string;
    objectiveId: string;
    objectiveContractHash: string;
    requiredScopeHash: string;
    repositorySnapshotId: string;
  },
) {
  return Boolean(
    evidence &&
    evidence.coverage === "complete" &&
    evidence.workspaceId === expected.workspaceId &&
    evidence.objectiveId === expected.objectiveId &&
    evidence.objectiveContractHash === expected.objectiveContractHash &&
    evidence.requiredScopeHash === expected.requiredScopeHash &&
    evidence.repositorySnapshotId === expected.repositorySnapshotId,
  );
}

export function objectiveStateFromVerification(
  evidence: ObjectiveVerificationEvidence | undefined,
) {
  if (evidence?.status === "satisfied" && evidence.coverage === "complete") return "satisfied" as const;
  if (evidence?.status === "unsatisfied" && evidence.coverage === "complete") return "unsatisfied" as const;
  return "unknown" as const;
}

function evaluateAssertion(
  assertion: RepositoryObjectiveAssertion,
  files: RepositoryFile[],
  readFailures: string[],
  maxFiles: number,
): ObjectiveAssertionResult {
  const completeScope = files.filter((file) => assertionIncludesPath(assertion, file.path));
  const inspectedScope = completeScope.slice(0, maxFiles);
  const incomplete = completeScope.length > inspectedScope.length || readFailures.some((file) =>
    assertionIncludesPath(assertion, file));
  const matches = assertion.pattern
    ? inspectedScope.flatMap((file) => findPatternMatches(file, assertion))
    : [];

  if (assertion.kind === "file_state") {
    if (incomplete || completeScope.length === 0) {
      return result(assertion, "indeterminate", [], completeScope.length === 0
        ? "The required repository scope resolved to no inspectable files."
        : `Only ${inspectedScope.length} of ${completeScope.length} scoped files were inspected.`);
    }
    return result(assertion, "passed", [], `Inspected all ${completeScope.length} files in the required scope.`);
  }

  if (incomplete) {
    return result(
      assertion,
      "indeterminate",
      matches,
      `Pattern coverage is partial: inspected ${inspectedScope.length} of ${completeScope.length} scoped files.`,
    );
  }

  if (assertion.kind === "forbidden_pattern_absent") {
    return matches.length === 0
      ? result(assertion, "passed", [], `No forbidden ${assertion.pattern} call remains in the complete scope.`)
      : result(assertion, "failed", matches, `Found ${matches.length} forbidden ${assertion.pattern} call match${matches.length === 1 ? "" : "es"}.`);
  }

  if (assertion.kind === "required_pattern_present") {
    return matches.length > 0
      ? result(assertion, "passed", matches, `Found ${matches.length} required ${assertion.pattern} call match${matches.length === 1 ? "" : "es"}.`)
      : result(assertion, "failed", [], `The required ${assertion.pattern} call is absent from the complete scope.`);
  }

  const disallowed = matches.filter((match) => !isAllowedRemainingMatch(match, assertion));
  return disallowed.length === 0
    ? result(assertion, "passed", matches, matches.length === 0
        ? "No remaining legacy match exists outside runtime scope."
        : `All ${matches.length} remaining legacy match${matches.length === 1 ? " is" : "es are"} confined to allowed declarations or stubs.`)
    : result(assertion, "failed", disallowed, `Found ${disallowed.length} legacy match${disallowed.length === 1 ? "" : "es"} outside allowed declaration or stub contexts.`);
}

function result(
  assertion: RepositoryObjectiveAssertion,
  status: ObjectiveAssertionResult["status"],
  matches: ObjectiveAssertionMatch[],
  reason: string,
): ObjectiveAssertionResult {
  return {
    id: assertion.id,
    kind: assertion.kind,
    scope: assertion.scope,
    exclusions: assertion.exclusions,
    status,
    matches: matches.map(({ path: matchPath, line, symbol }) => ({ path: matchPath, line, symbol })),
    reason,
  };
}

function findPatternMatches(
  file: RepositoryFile,
  assertion: RepositoryObjectiveAssertion,
): Array<ObjectiveAssertionMatch & { sourceLine: string }> {
  if (!file.text || !assertion.pattern) return [];
  const regex = patternRegex(assertion.pattern, assertion.matcher ?? "literal");
  return file.text.split(/\r?\n/).flatMap((sourceLine, index) => {
    regex.lastIndex = 0;
    return regex.test(sourceLine)
      ? [{ path: file.path, line: index + 1, symbol: assertion.pattern, sourceLine }]
      : [];
  });
}

function patternRegex(pattern: string, matcher: "literal" | "symbol" | "call_expression") {
  const segments = pattern.split(".").map((segment) => escapeRegExp(segment.trim()));
  const expression = segments.join("\\s*\\.\\s*");
  return new RegExp(
    matcher === "call_expression"
      ? `${expression}\\s*\\(`
      : matcher === "symbol"
        ? `\\b${expression}\\b`
        : expression,
    "g",
  );
}

function isAllowedRemainingMatch(
  match: ObjectiveAssertionMatch & { sourceLine?: string },
  assertion: RepositoryObjectiveAssertion,
) {
  const contexts = assertion.allowedContexts ?? [];
  const normalizedPath = match.path.toLowerCase();
  const sourceLine = match.sourceLine?.trim() ?? "";
  const declaration = normalizedPath.endsWith(".d.ts") ||
    /(^|\/)(?:declarations?|types?)(\/|$)/.test(normalizedPath) ||
    /\b(?:declare|interface|type)\b/.test(sourceLine);
  const stub = /(^|[/.\-_])(?:compat|deprecated|legacy|sdk|stub)([/.\-_]|$)/.test(normalizedPath) ||
    /(?:deprecated|compatibility|legacy|stub)/i.test(sourceLine);
  return (contexts.includes("declaration") && declaration) ||
    (contexts.includes("stub") && stub);
}

function assertionIncludesPath(assertion: RepositoryObjectiveAssertion, relativePath: string) {
  return matchesAnyScope(relativePath, assertion.scope) &&
    !matchesAnyScope(relativePath, assertion.exclusions);
}

function matchesAnyScope(relativePath: string, scopes: string[]) {
  return scopes.some((scope) => matchesScope(relativePath, scope));
}

function matchesScope(relativePath: string, scope: string) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (scope === "semantic:repository_source") return isSourceFile(normalizedPath);
  if (scope === "semantic:runtime_source") return isRuntimeSource(normalizedPath);
  if (scope === "semantic:runtime_service") return isRuntimeSource(normalizedPath) && isServicePath(normalizedPath);
  if (scope === "semantic:test") return isTestPath(normalizedPath);
  if (scope === "semantic:documentation") return isDocumentationPath(normalizedPath);
  if (scope === "semantic:generated") return isGeneratedPath(normalizedPath);
  return globRegex(scope).test(normalizedPath);
}

function isSourceFile(relativePath: string) {
  return SOURCE_EXTENSIONS.has(path.posix.extname(relativePath.toLowerCase()));
}

function isRuntimeSource(relativePath: string) {
  return isSourceFile(relativePath) &&
    !isTestPath(relativePath) &&
    !isDocumentationPath(relativePath) &&
    !isGeneratedPath(relativePath) &&
    !/(^|\/)(?:examples?|fixtures?|mocks?|qa)(\/|$)/i.test(relativePath);
}

function isServicePath(relativePath: string) {
  return /(^|\/)(?:services?)(\/|$)/i.test(relativePath) ||
    /(?:^|\/)[^/]*(?:[.-]service)\.[^/]+$/i.test(relativePath);
}

function isTestPath(relativePath: string) {
  return /(^|\/)(?:__tests__|tests?|spec)(\/|$)|\.(?:spec|test)\.[^/]+$/i.test(relativePath);
}

function isDocumentationPath(relativePath: string) {
  return /(^|\/)(?:docs?|documentation)(\/|$)/i.test(relativePath);
}

function isGeneratedPath(relativePath: string) {
  return /(^|\/)(?:generated|vendor)(\/|$)|\.generated\.[^/]+$/i.test(relativePath);
}

function globRegex(scope: string) {
  const normalized = scope.replace(/\\/g, "/").replace(/^\.\//, "");
  const escaped = escapeRegExp(normalized)
    .replace(/\\\*\\\*/g, ".*")
    .replace(/\\\*/g, "[^/]*");
  return new RegExp(`^${escaped}${normalized.endsWith("/") ? ".*" : ""}$`);
}

async function inspectRepository(workspacePath: string) {
  const files: RepositoryFile[] = [];
  const readFailures: string[] = [];
  for (const relativePath of await listRepositoryFiles(workspacePath)) {
    try {
      const safePath = await resolveWorkspacePathForRead(workspacePath, relativePath);
      const { content } = await readUtf8FileSafe(workspacePath, safePath);
      files.push({
        path: relativePath,
        contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
        text: isSourceFile(relativePath) && Buffer.byteLength(content, "utf8") <= MAX_INSPECTABLE_FILE_BYTES
          ? content
          : undefined,
      });
      if (isSourceFile(relativePath) && Buffer.byteLength(content, "utf8") > MAX_INSPECTABLE_FILE_BYTES) {
        readFailures.push(relativePath);
      }
    } catch {
      readFailures.push(relativePath);
    }
  }
  return { files, readFailures };
}

async function listRepositoryFiles(workspacePath: string) {
  const files: string[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = path.join(workspacePath, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, "/"), entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };
  await visit("");
  return files.sort();
}

async function readRepositoryHead(workspacePath: string) {
  const log = await new GitService(workspacePath).getLog(1).catch(() => []);
  return log[0]?.hash ?? "unversioned";
}

function hashRepositorySnapshot(head: string, files: RepositoryFile[]) {
  const hash = createHash("sha256").update(`${head}\0`);
  for (const file of files) {
    hash.update(file.path).update("\0").update(file.contentHash).update("\0");
  }
  return hash.digest("hex");
}

function hashRequiredScope(assertions: RepositoryObjectiveAssertion[], files: RepositoryFile[]) {
  return hashJson(assertions.map((assertion) => ({
    id: assertion.id,
    files: files.filter((file) => assertionIncludesPath(assertion, file.path)).map((file) => file.path),
  })));
}

function filesInspectedForResult(
  result: ObjectiveAssertionResult,
  assertions: RepositoryObjectiveAssertion[],
  files: RepositoryFile[],
  maxFiles: number,
) {
  const assertion = assertions.find((candidate) => candidate.id === result.id);
  return assertion
    ? files.filter((file) => assertionIncludesPath(assertion, file.path)).slice(0, maxFiles).map((file) => file.path)
    : [];
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
