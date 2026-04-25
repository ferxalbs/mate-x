import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AssistantRunOptions } from "../contracts/chat";
import type { SearchMatch, WorkspaceMemoryBootstrapContext, WorkspaceSummary } from "../contracts/workspace";
import type { WorkingSet, WorkingSetFile, WorkingSetScript } from "../contracts/working-set";
import { createId } from "../lib/id";
import { tursoService } from "./turso-service";

const execFileAsync = promisify(execFile);
const DEFAULT_TOKEN_BUDGET = 1800;
const CHARS_PER_TOKEN = 4;

interface WorkingSetCompilerInput {
  prompt: string;
  workspace: WorkspaceSummary;
  gitState: string[];
  selectedFiles: string[];
  runMode: AssistantRunOptions["mode"];
  promptMatches: SearchMatch[];
  memoryContext?: WorkspaceMemoryBootstrapContext;
  tokenBudget?: number;
}

interface RankedFile {
  path: string;
  score: number;
  reasons: Set<string>;
}

export class WorkingSetCompiler {
  async compile(input: WorkingSetCompilerInput): Promise<WorkingSet> {
    const tokenBudget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const compiledAt = new Date().toISOString();
    const [nodes, edges, failures, diffSnippets] = await Promise.all([
      tursoService.getRepoGraphNodes(input.workspace.id, ["file", "test", "script", "manifest"]),
      tursoService.getRepoGraphEdges(input.workspace.id, ["imports", "tests", "runs"]),
      tursoService.getRecentValidationRuns(input.workspace.id, 3),
      collectGitDiffSnippets(input.workspace.path, input.gitState, 4),
    ]);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const fileKeys = new Set(
      nodes
        .filter((node) => node.kind === "file" || node.kind === "test")
        .map((node) => node.key),
    );
    const primary = new Map<string, RankedFile>();
    const addPrimary = (file: string, score: number, reason: string) => {
      const normalized = normalizePath(file);
      if (!normalized || !fileKeys.has(normalized)) {
        return;
      }
      addRank(primary, normalized, score, reason);
    };

    for (const file of input.selectedFiles) {
      addPrimary(file, 100, "selected by user");
    }
    for (const statusLine of input.gitState) {
      addPrimary(statusLine.replace(/^[ MADRCU?!]{2}\s+/, ""), 70, "changed in git state");
    }
    for (const match of input.promptMatches.slice(0, 12)) {
      addPrimary(match.file, 60, "matched user objective");
    }

    const promptTerms = tokenize(input.prompt);
    for (const file of fileKeys) {
      const basename = file.split("/").at(-1)?.toLowerCase() ?? file;
      const score = promptTerms.reduce(
        (total, term) => total + (basename.includes(term) || file.toLowerCase().includes(term) ? 12 : 0),
        0,
      );
      if (score > 0) {
        addRank(primary, file, score, "path matches objective terms");
      }
    }

    const primaryFiles = sortRanked(primary).slice(0, 8);
    const primarySet = new Set(primaryFiles.map((file) => file.path));
    const imported = new Map<string, RankedFile>();
    const importing = new Map<string, RankedFile>();
    const tests = new Map<string, RankedFile>();

    for (const edge of edges) {
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      if (!from || !to) {
        continue;
      }
      if (edge.kind === "imports" && primarySet.has(from.key) && fileKeys.has(to.key)) {
        addRank(imported, to.key, 45, `imported by ${from.key}`);
      }
      if (edge.kind === "imports" && primarySet.has(to.key) && fileKeys.has(from.key)) {
        addRank(importing, from.key, 40, `imports ${to.key}`);
      }
      if (edge.kind === "tests" && primarySet.has(to.key) && fileKeys.has(from.key)) {
        addRank(tests, from.key, 55, `tests ${to.key}`);
      }
    }

    const contracts = new Map<string, RankedFile>();
    for (const file of [...primaryFiles, ...sortRanked(imported), ...sortRanked(importing)]) {
      if (isContractOrTypeFile(file.path)) {
        addRank(contracts, file.path, file.score, "contract/type surface");
      }
    }
    for (const file of sortRanked(imported)) {
      if (isContractOrTypeFile(file.path)) {
        addRank(contracts, file.path, file.score + 20, "imported contract/type");
      }
    }

    const scripts = nodes
      .filter((node) => node.kind === "script")
      .flatMap((node) => {
        const script = rankScript(node.key, input.prompt, input.runMode);
        return script ? [script] : [];
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 5);

    const workingSet: WorkingSet = {
      metadata: {
        id: createId("working-set"),
        workspaceId: input.workspace.id,
        compiledAt,
        tokenBudget,
        tokenEstimate: 0,
        runMode: input.runMode,
        primaryFileCount: primaryFiles.length,
        totalFileCount: 0,
        truncated: false,
      },
      objective: input.prompt,
      primaryTargetFiles: primaryFiles,
      directlyImportedFiles: sortRanked(imported).slice(0, 8),
      directlyImportingFiles: sortRanked(importing).slice(0, 8),
      relatedTests: sortRanked(tests).slice(0, 8),
      relevantPackageScripts: scripts,
      gitDiffSnippets: diffSnippets,
      relatedContractsTypes: sortRanked(contracts).slice(0, 6),
      recentFailureContext: failures.map((failure) => ({
        command: failure.command,
        status: failure.status,
        exitCode: failure.exitCode,
        summary: failure.outputSummary,
        failingTests: failure.failingTests,
        ranAt: failure.ranAt,
      })),
      workspacePlaybookNotes: splitPlaybookNotes(input.memoryContext?.context),
    };

    return enforceBudget(workingSet);
  }
}

export const workingSetCompiler = new WorkingSetCompiler();

export function renderWorkingSetForPrompt(workingSet: WorkingSet): string {
  return [
    "Use this working set first. Do not inspect unrelated files unless evidence requires it.",
    `Budget: ${workingSet.metadata.tokenEstimate}/${workingSet.metadata.tokenBudget} tokens`,
    renderFiles("Primary target files", workingSet.primaryTargetFiles),
    renderFiles("Directly imported files", workingSet.directlyImportedFiles),
    renderFiles("Directly importing files", workingSet.directlyImportingFiles),
    renderFiles("Related tests", workingSet.relatedTests),
    renderFiles("Related contracts/types", workingSet.relatedContractsTypes),
    renderScripts(workingSet.relevantPackageScripts),
    renderSnippets(workingSet.gitDiffSnippets),
    renderFailures(workingSet.recentFailureContext),
    renderNotes(workingSet.workspacePlaybookNotes),
  ].filter(Boolean).join("\n\n");
}

function addRank(target: Map<string, RankedFile>, file: string, score: number, reason: string) {
  const existing = target.get(file);
  if (existing) {
    existing.score += score;
    existing.reasons.add(reason);
    return;
  }
  target.set(file, { path: file, score, reasons: new Set([reason]) });
}

function sortRanked(files: Map<string, RankedFile>): WorkingSetFile[] {
  return [...files.values()]
    .map((file) => ({ path: file.path, score: file.score, reasons: [...file.reasons].slice(0, 4) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function tokenize(prompt: string) {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((term) => term.length >= 4)
    .slice(0, 20);
}

function normalizePath(file: string) {
  return file.trim().replace(/\\/g, "/").replace(/^"|"$/g, "");
}

function isContractOrTypeFile(file: string) {
  return file.includes("/contracts/") || /(^|\/)types?\.tsx?$/.test(file) || /\.d\.ts$/.test(file);
}

function rankScript(scriptName: string, prompt: string, runMode: AssistantRunOptions["mode"]): WorkingSetScript | null {
  const lowerPrompt = prompt.toLowerCase();
  const lowerName = scriptName.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  for (const term of ["test", "lint", "typecheck", "build", "start"]) {
    if (lowerPrompt.includes(term) && lowerName.includes(term)) {
      score += 35;
      reasons.push(`objective mentions ${term}`);
    }
  }
  if (runMode === "build" && ["test", "lint", "typecheck"].some((term) => lowerName.includes(term))) {
    score += 15;
    reasons.push("build mode verification");
  }
  return score > 0 ? { name: scriptName, command: `bun run ${scriptName}`, score, reasons } : null;
}

async function collectGitDiffSnippets(workspacePath: string, gitState: string[], limit: number) {
  const changedFiles = gitState
    .map((line) => normalizePath(line.replace(/^[ MADRCU?!]{2}\s+/, "")))
    .filter(Boolean)
    .slice(0, limit);
  const snippets = [];
  for (const file of changedFiles) {
    try {
      const { stdout } = await execFileAsync("git", ["-C", workspacePath, "diff", "--", file], {
        maxBuffer: 120_000,
      });
      const content = stdout.trim().slice(0, 1600);
      if (content) {
        snippets.push({ path: file, content, tokenEstimate: estimateTokens(content) });
      }
    } catch {
      // Git diff context is helpful but not required for the run.
    }
  }
  return snippets;
}

function splitPlaybookNotes(context?: string) {
  return (context ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function enforceBudget(workingSet: WorkingSet): WorkingSet {
  let estimate = estimateTokens(renderWorkingSetForPrompt({ ...workingSet, metadata: { ...workingSet.metadata, tokenEstimate: 0 } }));
  const trimmed = workingSet;
  while (estimate > trimmed.metadata.tokenBudget && trimmed.gitDiffSnippets.length > 0) {
    trimmed.gitDiffSnippets.pop();
    trimmed.metadata.truncated = true;
    estimate = estimateTokens(renderWorkingSetForPrompt({ ...trimmed, metadata: { ...trimmed.metadata, tokenEstimate: 0 } }));
  }
  while (estimate > trimmed.metadata.tokenBudget && trimmed.directlyImportingFiles.length > 4) {
    trimmed.directlyImportingFiles.pop();
    trimmed.directlyImportedFiles.pop();
    trimmed.metadata.truncated = true;
    estimate = estimateTokens(renderWorkingSetForPrompt({ ...trimmed, metadata: { ...trimmed.metadata, tokenEstimate: 0 } }));
  }
  trimmed.metadata.tokenEstimate = estimate;
  trimmed.metadata.totalFileCount = new Set([
    ...trimmed.primaryTargetFiles.map((file) => file.path),
    ...trimmed.directlyImportedFiles.map((file) => file.path),
    ...trimmed.directlyImportingFiles.map((file) => file.path),
    ...trimmed.relatedTests.map((file) => file.path),
    ...trimmed.relatedContractsTypes.map((file) => file.path),
  ]).size;
  return trimmed;
}

function estimateTokens(value: string) {
  return Math.ceil(value.length / CHARS_PER_TOKEN);
}

function renderFiles(label: string, files: WorkingSetFile[]) {
  if (files.length === 0) {
    return `${label}: none`;
  }
  return `${label}:\n${files.map((file) => `- ${file.path} (${file.score}): ${file.reasons.join("; ")}`).join("\n")}`;
}

function renderScripts(scripts: WorkingSetScript[]) {
  return scripts.length
    ? `Relevant package scripts:\n${scripts.map((script) => `- ${script.name}: ${script.command} (${script.reasons.join("; ")})`).join("\n")}`
    : "Relevant package scripts: none";
}

function renderSnippets(snippets: WorkingSet["gitDiffSnippets"]) {
  return snippets.length
    ? `Git diff snippets:\n${snippets.map((snippet) => `--- ${snippet.path}\n${snippet.content}`).join("\n")}`
    : "Git diff snippets: none";
}

function renderFailures(failures: WorkingSet["recentFailureContext"]) {
  return failures.length
    ? `Recent failure context:\n${failures.map((failure) => `- ${failure.command} ${failure.status ?? "unknown"}${failure.exitCode === undefined ? "" : ` (${failure.exitCode})`}: ${failure.summary ?? "no summary"}`).join("\n")}`
    : "Recent failure context: none";
}

function renderNotes(notes: string[]) {
  return notes.length ? `Workspace playbook notes:\n${notes.map((note) => `- ${note}`).join("\n")}` : "Workspace playbook notes: none";
}
