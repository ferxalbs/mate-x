import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AgentToolCall } from "./types";

const MANIFEST_NAMES = new Set([
  "package.json",
  "deno.json",
  "deno.jsonc",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
]);
const ENTRY_BASENAMES = /^(?:main|index|app|server|cli|renderer|preload)\.(?:[cm]?[jt]sx?|py|rs|go)$/i;
const IMPLEMENTATION_EXTENSIONS = /\.(?:[cm]?[jt]sx?|py|rs|go)$/i;
const IGNORED_IMPLEMENTATION_PATH = /(?:^|\/)(?:tests?|__tests__|fixtures?|examples?|scripts?|qa)(?:\/|$)/i;

export interface RepositoryOverviewToolResult {
  toolCallId: string;
  content: string;
  toolExecution: ToolExecutionRecord;
}

export interface RepositoryOverviewEvidence {
  toolResults: RepositoryOverviewToolResult[];
  toolExecutions: ToolExecutionRecord[];
  inspectedFileCount: number;
  evidenceBatchCount: number;
  coverage: RepositoryOverviewCoverage;
  modelContext: string;
}

export interface RepositoryOverviewCoverage {
  sufficient: boolean;
  inventoryTruncated: boolean;
  reasons: string[];
}

export function selectRepositoryOverviewReadPaths(snapshot: RepoSnapshot): string[] {
  const files = snapshot.files.filter((file) => !file.endsWith("/"));
  const selected = new Set<string>();
  const addFirst = (predicate: (file: string) => boolean, limit = 1) => {
    let added = 0;
    for (const file of files) {
      if (predicate(file) && !selected.has(file)) {
        selected.add(file);
        added += 1;
        if (added >= limit) break;
      }
    }
  };

  addFirst((file) => MANIFEST_NAMES.has(file));
  addFirst((file) => file.includes("/") && MANIFEST_NAMES.has(file.split("/").at(-1) ?? ""), 2);
  addFirst((file) => /^(?:README|DEMO)(?:\.[^/]+)?$/i.test(file.split("/").at(-1) ?? ""), 2);
  addFirst((file) => /^(?:docs\/)?[^/]*(?:architecture|overview)[^/]*\.md$/i.test(file), 1);
  addFirst((file) => ENTRY_BASENAMES.test(file.split("/").at(-1) ?? ""), 4);
  addFirst(
    (file) =>
      IMPLEMENTATION_EXTENSIONS.test(file) &&
      !IGNORED_IMPLEMENTATION_PATH.test(file),
    3,
  );

  return Array.from(selected).slice(0, 10);
}

function isUsefulToolResult(content: string) {
  return content.trim().length > 0 &&
    !/^No matches found\.?$/i.test(content.trim()) &&
    !/^Error:/i.test(content.trim());
}

function extractSuccessfulReadPaths(content: string) {
  return content
    .split(/^### /m)
    .slice(1)
    .filter((section) => !/^.*\nError:/s.test(section))
    .map((section) => section.split("\n", 1)[0]!.trim())
    .filter(Boolean);
}

export function assessRepositoryOverviewCoverage(input: {
  snapshot: RepoSnapshot;
  readPaths: string[];
  searchContent: string;
}): RepositoryOverviewCoverage {
  const reasons: string[] = [];
  const hasPurposeSource = input.readPaths.some((file) =>
    MANIFEST_NAMES.has(file.split("/").at(-1) ?? "") ||
    /^(?:README|DEMO)(?:\.[^/]+)?$/i.test(file.split("/").at(-1) ?? "")
  );
  const hasImplementation = input.readPaths.some((file) =>
    IMPLEMENTATION_EXTENSIONS.test(file) && !IGNORED_IMPLEMENTATION_PATH.test(file)
  );
  const hasEntryPoint = input.readPaths.some((file) =>
    ENTRY_BASENAMES.test(file.split("/").at(-1) ?? "")
  ) || isUsefulToolResult(input.searchContent);

  if (!hasPurposeSource) reasons.push("No manifest or repository documentation was read.");
  if (!hasImplementation) reasons.push("No implementation file was read.");
  if (!hasEntryPoint) reasons.push("No likely entry point or execution-flow signal was found.");

  return {
    sufficient: reasons.length === 0,
    inventoryTruncated: input.snapshot.files.length >= 200,
    reasons,
  };
}

export function buildRepositoryOverviewExpansionToolCalls(
  snapshot: RepoSnapshot,
  initialReadPaths: string[],
): AgentToolCall[] {
  const alreadyRead = new Set(initialReadPaths);
  const expansionPaths = snapshot.files
    .filter((file) => !alreadyRead.has(file))
    .filter((file) =>
      MANIFEST_NAMES.has(file.split("/").at(-1) ?? "") ||
      /(?:README|architecture|overview|entry|bootstrap)/i.test(file) ||
      ENTRY_BASENAMES.test(file.split("/").at(-1) ?? "") ||
      (IMPLEMENTATION_EXTENSIONS.test(file) && !IGNORED_IMPLEMENTATION_PATH.test(file))
    )
    .slice(0, 8);

  return [
    {
      id: "repository-overview-expansion-read",
      name: "read_many",
      arguments: JSON.stringify({ paths: expansionPaths, maxCharsPerFile: 6_000 }),
    },
    {
      id: "repository-overview-expansion-search",
      name: "rg",
      arguments: JSON.stringify({
        query: "#!/|\\b(?:main|bootstrap|start|serve|run)\\b|\\b(?:scripts|bin|exports)\\b",
        isRegex: true,
        paths: ["."],
        maxResults: 40,
        maxOutputChars: 12_000,
        sort: "path",
      }),
    },
  ];
}

export function buildRepositoryOverviewToolCalls(
  snapshot: RepoSnapshot,
): AgentToolCall[] {
  const readPaths = selectRepositoryOverviewReadPaths(snapshot);
  const sourceDirectories = Array.from(new Set(
    snapshot.files
      .map((file) => file.split("/")[0])
      .filter((directory) => /^(?:src|app|lib|packages?|cmd)$/i.test(directory)),
  )).slice(0, 4);

  return [
    {
      id: "repository-overview-read",
      name: "read_many",
      arguments: JSON.stringify({
        paths: readPaths,
        maxCharsPerFile: 8_000,
      }),
    },
    {
      id: "repository-overview-search",
      name: "rg",
      arguments: JSON.stringify({
        query: "createRoot|ReactDOM|app\\.listen|BrowserWindow|export\\s+(?:default|async\\s+)?(?:function|class)|\\bmain\\s*\\(",
        isRegex: true,
        paths: sourceDirectories.length > 0 ? sourceDirectories : ["."],
        maxResults: 40,
        maxOutputChars: 12_000,
        sort: "path",
      }),
    },
  ];
}

export async function collectRepositoryOverviewEvidence(input: {
  snapshot: RepoSnapshot;
  execute: (
    toolCall: AgentToolCall,
    toolIndex: number,
  ) => Promise<RepositoryOverviewToolResult>;
}): Promise<RepositoryOverviewEvidence> {
  const toolCalls = buildRepositoryOverviewToolCalls(input.snapshot);
  const toolResults = await Promise.all(
    toolCalls.map((toolCall, toolIndex) => input.execute(toolCall, toolIndex)),
  );
  const requestedInitialReadPaths = JSON.parse(
    toolCalls[0]!.arguments ?? "{}",
  ).paths as string[];
  const initialReadContent = toolResults.find(
    (result) => result.toolExecution.toolName === "read_many",
  )?.content ?? "";
  const initialReadPaths = extractSuccessfulReadPaths(initialReadContent);
  const initialSearchContent = toolResults.find(
    (result) => result.toolExecution.toolName === "rg",
  )?.content ?? "";
  let coverage = assessRepositoryOverviewCoverage({
    snapshot: input.snapshot,
    readPaths: initialReadPaths,
    searchContent: initialSearchContent,
  });
  let evidenceBatchCount = 1;
  if (!coverage.sufficient) {
    const expansionCalls = buildRepositoryOverviewExpansionToolCalls(
      input.snapshot,
      requestedInitialReadPaths,
    );
    const expansionResults = await Promise.all(
      expansionCalls.map((toolCall, toolIndex) =>
        input.execute(toolCall, toolCalls.length + toolIndex)
      ),
    );
    toolResults.push(...expansionResults);
    evidenceBatchCount = 2;
    const expansionReadPaths = extractSuccessfulReadPaths(
      expansionResults.find(
        (result) => result.toolExecution.toolName === "read_many",
      )?.content ?? "",
    );
    coverage = assessRepositoryOverviewCoverage({
      snapshot: input.snapshot,
      readPaths: [...initialReadPaths, ...expansionReadPaths],
      searchContent: [
        initialSearchContent,
        expansionResults.find((result) => result.toolExecution.toolName === "rg")?.content ?? "",
      ].join("\n"),
    });
  }
  const inspectedFileCount = toolResults
    .filter((result) => result.toolExecution.toolName === "read_many")
    .reduce(
      (count, result) => count + extractSuccessfulReadPaths(result.content).length,
      0,
    );
  const majorDirectories = Array.from(new Set(
    input.snapshot.files
      .map((file) => file.split("/")[0])
      .filter((part) => part && !part.includes(".")),
  )).slice(0, 16);

  return {
    toolResults,
    toolExecutions: toolResults.map((result) => result.toolExecution),
    inspectedFileCount,
    evidenceBatchCount,
    coverage,
    modelContext: [
      `Repository files (bounded inventory):\n${input.snapshot.files.join("\n")}`,
      `Major directories: ${majorDirectories.join(", ") || "(root-only repository)"}`,
      coverage.sufficient
        ? `Coverage: sufficient for a bounded overview.${coverage.inventoryTruncated ? " The inventory was capped at 200 deterministically prioritized files; avoid claims about uninspected areas." : ""}`
        : `Coverage: incomplete after the bounded expansion. State this limitation naturally and avoid confident claims beyond inspected evidence. Missing: ${coverage.reasons.join(" ")}`,
      ...toolResults.map((result) =>
        `${result.toolExecution.toolName} evidence:\n${result.content}`
      ),
    ].join("\n\n"),
  };
}
