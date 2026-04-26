import path from 'node:path';

import type { RepoGraphEdge, RepoGraphImpactedFile, RepoGraphNode } from '../contracts/repo-graph';
import { repoGraphService } from './repo-graph-service';
import { tursoService } from './turso-service';

type PatchImpactWorkspace = {
  id: string;
  name: string;
  path: string;
};

type SurfaceDiff = {
  added: string[];
  removed: string[];
  unknown: boolean;
};

export type PatchImpactSummary = {
  targetFile: string;
  before: {
    importingFiles: string[];
    importedFiles: string[];
    relatedTests: string[];
    affectedContractsTypes: string[];
    affectedPackageScripts: string[];
    unknown: string[];
  };
  after: {
    impactedNodes: RepoGraphImpactedFile[];
    imports: SurfaceDiff;
    exports: SurfaceDiff;
    ipcApiEnvDependencySurface: SurfaceDiff;
    unknown: string[];
  };
  validationCommands: string[];
};

type GraphState = {
  nodesById: Map<string, RepoGraphNode>;
  fileNodeByKey: Map<string, RepoGraphNode>;
  edges: RepoGraphEdge[];
};

type PatchImpactBefore = {
  workspace: PatchImpactWorkspace;
  targetFile: string;
  graph: GraphState | null;
  summary: PatchImpactSummary['before'];
};

const CONFIG_OR_MANIFEST = new Set(['config', 'manifest']);
const VALIDATION_PURPOSES = ['test', 'lint', 'typecheck', 'build'];

export async function analyzePatchBefore(
  workspacePath: string,
  requestedPath: string,
): Promise<PatchImpactBefore> {
  const workspace = await resolveWorkspaceByPath(workspacePath);
  const targetFile = normalizeRelativePath(requestedPath);

  try {
    await repoGraphService.ensureWorkspaceGraph(workspace);
    const graph = await loadGraph(workspace.id);
    const target = graph.fileNodeByKey.get(targetFile);
    const unknown = target ? [] : [`${targetFile} is not indexed in RepoGraph.`];

    return {
      workspace,
      targetFile,
      graph,
      summary: {
        importingFiles: filesImportingTarget(graph, targetFile),
        importedFiles: filesImportedByTarget(graph, targetFile),
        relatedTests: await relatedTests(workspace, graph, targetFile),
        affectedContractsTypes: affectedContractsTypes(graph, targetFile),
        affectedPackageScripts: affectedPackageScripts(graph, targetFile),
        unknown,
      },
    };
  } catch (error) {
    return {
      workspace,
      targetFile,
      graph: null,
      summary: {
        importingFiles: [],
        importedFiles: [],
        relatedTests: [],
        affectedContractsTypes: [],
        affectedPackageScripts: [],
        unknown: [`RepoGraph pre-impact analysis failed: ${(error as Error).message}`],
      },
    };
  }
}

export async function analyzePatchAfter(before: PatchImpactBefore): Promise<PatchImpactSummary> {
  const unknown: string[] = [];
  let afterGraph: GraphState | null = null;

  try {
    await repoGraphService.refreshWorkspace(before.workspace);
    afterGraph = await loadGraph(before.workspace.id);
  } catch (error) {
    unknown.push(`RepoGraph post-impact analysis failed: ${(error as Error).message}`);
  }

  const impactedNodes = afterGraph
    ? await repoGraphService.getImpactedFiles(before.workspace, [before.targetFile]).catch((error) => {
        unknown.push(`Impacted nodes unavailable: ${(error as Error).message}`);
        return [];
      })
    : [];

  const after = {
    impactedNodes,
    imports: diffSet(
      edgeValues(before.graph, before.targetFile, ['imports'], 'to'),
      edgeValues(afterGraph, before.targetFile, ['imports'], 'to'),
      !before.graph || !afterGraph,
    ),
    exports: diffSet(
      edgeValues(before.graph, before.targetFile, ['exports'], 'to'),
      edgeValues(afterGraph, before.targetFile, ['exports'], 'to'),
      !before.graph || !afterGraph,
    ),
    ipcApiEnvDependencySurface: diffSet(
      surfaceValues(before.graph, before.targetFile),
      surfaceValues(afterGraph, before.targetFile),
      !before.graph || !afterGraph,
    ),
    unknown,
  };

  return {
    targetFile: before.targetFile,
    before: before.summary,
    after,
    validationCommands: chooseValidationCommands(before, after),
  };
}

export function formatPatchImpactSummary(summary: PatchImpactSummary) {
  return `PATCH_IMPACT_SUMMARY_JSON\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``;
}

async function resolveWorkspaceByPath(workspacePath: string): Promise<PatchImpactWorkspace> {
  await tursoService.ensureSeedWorkspace(workspacePath);
  const workspaces = await tursoService.getWorkspaces();
  const workspace = workspaces.find((entry) => entry.path === workspacePath);
  if (!workspace) {
    throw new Error(`Workspace not found for path: ${workspacePath}`);
  }
  return workspace;
}

async function loadGraph(workspaceId: string): Promise<GraphState> {
  const nodes = await tursoService.getRepoGraphNodes(workspaceId, [
    'file',
    'test',
    'config',
    'manifest',
    'export',
    'dependency',
    'env_var',
    'ipc_channel',
    'script',
    'command',
  ]);
  const edges = await tursoService.getRepoGraphEdges(workspaceId, [
    'imports',
    'exports',
    'tests',
    'runs',
    'uses_env',
    'ipc_calls',
    'ipc_handles',
    'depends_on',
  ]);
  return {
    nodesById: new Map(nodes.map((node) => [node.id, node])),
    fileNodeByKey: new Map(
      nodes
        .filter((node) => ['file', 'test', 'config', 'manifest'].includes(node.kind))
        .map((node) => [node.key, node]),
    ),
    edges,
  };
}

function filesImportingTarget(graph: GraphState, targetFile: string) {
  return uniqSorted(
    graph.edges
      .filter((edge) => edge.kind === 'imports')
      .filter((edge) => graph.nodesById.get(edge.toNodeId)?.key === targetFile)
      .map((edge) => graph.nodesById.get(edge.fromNodeId)?.key)
      .filter(isString),
  );
}

function filesImportedByTarget(graph: GraphState, targetFile: string) {
  return uniqSorted(
    graph.edges
      .filter((edge) => edge.kind === 'imports')
      .filter((edge) => graph.nodesById.get(edge.fromNodeId)?.key === targetFile)
      .map((edge) => graph.nodesById.get(edge.toNodeId)?.key)
      .filter(isString),
  );
}

async function relatedTests(
  workspace: PatchImpactWorkspace,
  graph: GraphState,
  targetFile: string,
) {
  const directTests = await repoGraphService.getTestsForFile(workspace, targetFile).catch(() => []);
  const importingTests = graph.edges
    .filter((edge) => edge.kind === 'imports')
    .filter((edge) => graph.nodesById.get(edge.toNodeId)?.key === targetFile)
    .map((edge) => graph.nodesById.get(edge.fromNodeId))
    .filter((node): node is RepoGraphNode => node?.kind === 'test')
    .map((node) => node.key);
  return uniqSorted([...directTests, ...importingTests]);
}

function affectedContractsTypes(graph: GraphState, targetFile: string) {
  const related = new Set<string>();
  if (isContractOrTypeFile(targetFile)) {
    related.add(targetFile);
  }
  for (const file of [...filesImportingTarget(graph, targetFile), ...filesImportedByTarget(graph, targetFile)]) {
    if (isContractOrTypeFile(file)) {
      related.add(file);
    }
  }
  return [...related].sort();
}

function affectedPackageScripts(graph: GraphState, targetFile: string) {
  const target = graph.fileNodeByKey.get(targetFile);
  if (!target || !CONFIG_OR_MANIFEST.has(target.kind)) {
    return [];
  }
  return uniqSorted(
    graph.edges
      .filter((edge) => edge.kind === 'runs')
      .filter((edge) => graph.nodesById.get(edge.fromNodeId)?.kind === 'manifest')
      .map((edge) => {
        const script = graph.nodesById.get(edge.toNodeId);
        const command = edge.metadata?.command;
        return script?.kind === 'script'
          ? `${script.key}${typeof command === 'string' ? `: ${command}` : ''}`
          : null;
      })
      .filter(isString),
  );
}

function edgeValues(
  graph: GraphState | null,
  targetFile: string,
  kinds: RepoGraphEdge['kind'][],
  direction: 'from' | 'to',
) {
  if (!graph) {
    return [];
  }
  return uniqSorted(
    graph.edges
      .filter((edge) => kinds.includes(edge.kind))
      .filter((edge) => graph.nodesById.get(edge.fromNodeId)?.key === targetFile)
      .map((edge) => {
        const node = graph.nodesById.get(direction === 'to' ? edge.toNodeId : edge.fromNodeId);
        const specifier = edge.metadata?.specifier;
        return node ? `${node.kind}:${node.key}${typeof specifier === 'string' ? ` (${specifier})` : ''}` : null;
      })
      .filter(isString),
  );
}

function surfaceValues(graph: GraphState | null, targetFile: string) {
  if (!graph) {
    return [];
  }
  const surfaceKinds: RepoGraphEdge['kind'][] = [
    'ipc_calls',
    'ipc_handles',
    'uses_env',
    'depends_on',
    'imports',
  ];
  return uniqSorted(
    graph.edges
      .filter((edge) => surfaceKinds.includes(edge.kind))
      .filter((edge) => graph.nodesById.get(edge.fromNodeId)?.key === targetFile)
      .map((edge) => {
        const to = graph.nodesById.get(edge.toNodeId);
        if (!to || !['ipc_channel', 'env_var', 'dependency'].includes(to.kind)) {
          return null;
        }
        return `${edge.kind}:${to.kind}:${to.key}`;
      })
      .filter(isString),
  );
}

function diffSet(before: string[], after: string[], unknown: boolean): SurfaceDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((value) => !beforeSet.has(value)),
    removed: before.filter((value) => !afterSet.has(value)),
    unknown,
  };
}

function chooseValidationCommands(
  before: PatchImpactBefore,
  after: PatchImpactSummary['after'],
) {
  const commands = new Set<string>();
  for (const test of before.summary.relatedTests) {
    commands.add(`bun test ${test}`);
  }

  const scriptCommands = before.summary.affectedPackageScripts
    .map((script) => {
      const [name, command] = script.split(/:\s+(.+)/);
      return { name, command };
    })
    .filter((script) => script.command);

  for (const purpose of VALIDATION_PURPOSES) {
    const match = scriptCommands.find((script) => script.name.includes(purpose));
    if (match?.command) {
      commands.add(match.command);
    }
  }

  if (
    after.imports.added.length ||
    after.imports.removed.length ||
    after.exports.added.length ||
    after.exports.removed.length ||
    before.summary.affectedContractsTypes.length
  ) {
    commands.add('bun run typecheck');
  }
  if (before.summary.affectedPackageScripts.length || after.ipcApiEnvDependencySurface.added.length) {
    commands.add('bun run lint');
  }

  if (commands.size === 0) {
    commands.add('unknown');
  }
  return [...commands];
}

function normalizeRelativePath(value: string) {
  return value.split(path.sep).join('/').replace(/^\.\/+/, '');
}

function isContractOrTypeFile(file: string) {
  return file.startsWith('src/contracts/') || /\.(types?|d)\.tsx?$/.test(file);
}

function uniqSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
