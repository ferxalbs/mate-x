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

type PatchImpactRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export type PatchImpactSummary = {
  targetFile: string;
  risk: {
    level: PatchImpactRiskLevel;
    score: number | null;
    requiresConfirmation: boolean;
    reasons: string[];
    userMessage: string;
  };
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

type PatchImpactDecision = PatchImpactSummary['risk'] & {
  validationCommands: string[];
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

  const validationCommands = chooseValidationCommands(before, after);
  return {
    targetFile: before.targetFile,
    risk: assessPatchRisk(before, after, validationCommands),
    before: before.summary,
    after,
    validationCommands,
  };
}

export function assessPatchBeforeWrite(before: PatchImpactBefore): PatchImpactDecision {
  const validationCommands = chooseValidationCommands(before, {
    impactedNodes: [],
    imports: { added: [], removed: [], unknown: !before.graph },
    exports: { added: [], removed: [], unknown: !before.graph },
    ipcApiEnvDependencySurface: { added: [], removed: [], unknown: !before.graph },
    unknown: [],
  });
  return {
    ...assessPatchRisk(before, {
      impactedNodes: [],
      imports: { added: [], removed: [], unknown: !before.graph },
      exports: { added: [], removed: [], unknown: !before.graph },
      ipcApiEnvDependencySurface: { added: [], removed: [], unknown: !before.graph },
      unknown: [],
    }, validationCommands),
    validationCommands,
  };
}

export function formatPatchImpactBlocked(
  targetFile: string,
  decision: PatchImpactDecision,
  before: PatchImpactSummary['before'],
) {
  return [
    `Patch not applied to ${targetFile}.`,
    'PATCH_IMPACT_DECISION',
    `Risk: ${decision.level.toUpperCase()}`,
    `Confirmation required: ${decision.requiresConfirmation ? 'yes' : 'no'}`,
    decision.userMessage,
    `Reasons: ${decision.reasons.join(' ')}`,
    `Validation: ${decision.validationCommands.join(', ')}`,
    decision.requiresConfirmation
      ? 'To apply anyway, call the patch tool again with allowHighImpact: true after user confirmation.'
      : 'No file was changed.',
    'PATCH_IMPACT_BEFORE_JSON',
    '```json',
    JSON.stringify({ targetFile, risk: decision, before }, null, 2),
    '```',
  ].join('\n');
}

export function formatPatchImpactSkipped(
  targetFile: string,
  decision: PatchImpactDecision,
  before: PatchImpactSummary['before'],
) {
  return [
    `Edit skipped for ${targetFile}. Replacement would not change the file.`,
    'PATCH_IMPACT_DECISION',
    `Risk: ${decision.level.toUpperCase()}`,
    `Confirmation required: ${decision.requiresConfirmation ? 'yes' : 'no'}`,
    decision.userMessage,
    `Reasons: ${decision.reasons.join(' ')}`,
    `Validation: ${decision.validationCommands.join(', ')}`,
    'No file was changed.',
    'PATCH_IMPACT_BEFORE_JSON',
    '```json',
    JSON.stringify({ targetFile, risk: decision, before }, null, 2),
    '```',
  ].join('\n');
}

export function formatPatchImpactSummary(summary: PatchImpactSummary) {
  return [
    'PATCH_IMPACT_DECISION',
    `Risk: ${summary.risk.level.toUpperCase()}`,
    `Confirmation required: ${summary.risk.requiresConfirmation ? 'yes' : 'no'}`,
    summary.risk.userMessage,
    `Validation: ${summary.validationCommands.join(', ')}`,
    'PATCH_IMPACT_SUMMARY_JSON',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
  ].join('\n');
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
    before.summary.affectedContractsTypes.length ||
    isTypeScriptSourceFile(before.targetFile)
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

function assessPatchRisk(
  before: PatchImpactBefore,
  after: PatchImpactSummary['after'],
  validationCommands: string[],
): PatchImpactSummary['risk'] {
  const reasons: string[] = [];
  const unknownCount = before.summary.unknown.length + after.unknown.length;
  if (
    unknownCount > 0 ||
    after.imports.unknown ||
    after.exports.unknown ||
    after.ipcApiEnvDependencySurface.unknown
  ) {
    return {
      level: 'unknown',
      score: null,
      requiresConfirmation: true,
      reasons: [
        ...before.summary.unknown,
        ...after.unknown,
        'RepoGraph could not fully determine the patch impact.',
      ],
      userMessage:
        'Impact could not be fully determined. Ask for confirmation and run broad validation before trusting this patch.',
    };
  }

  let score = 0;
  const importingCount = before.summary.importingFiles.length;
  const impactedCount = after.impactedNodes.filter((entry) => !entry.group).length;
  const exportChanges = after.exports.added.length + after.exports.removed.length;
  const importChanges = after.imports.added.length + after.imports.removed.length;
  const surfaceChanges =
    after.ipcApiEnvDependencySurface.added.length +
    after.ipcApiEnvDependencySurface.removed.length;

  if (importingCount >= 10) {
    score += 35;
    reasons.push(`${importingCount} files import ${before.targetFile}.`);
  } else if (importingCount >= 3) {
    score += 18;
    reasons.push(`${importingCount} files import ${before.targetFile}.`);
  } else if (importingCount > 0) {
    score += 8;
    reasons.push(`${importingCount} file imports ${before.targetFile}.`);
  }

  if (impactedCount >= 15) {
    score += 30;
    reasons.push(`${impactedCount} RepoGraph nodes are impacted after the patch.`);
  } else if (impactedCount >= 5) {
    score += 16;
    reasons.push(`${impactedCount} RepoGraph nodes are impacted after the patch.`);
  }

  if (exportChanges > 0) {
    score += 22;
    reasons.push(`${exportChanges} exported symbol change(s) detected.`);
  }
  if (importChanges > 0) {
    score += 12;
    reasons.push(`${importChanges} import change(s) detected.`);
  }
  if (surfaceChanges > 0) {
    score += 25;
    reasons.push(`${surfaceChanges} IPC/API/env/dependency surface change(s) detected.`);
  }
  if (before.summary.affectedContractsTypes.length > 0) {
    score += 25;
    reasons.push('Shared contracts or type surfaces are affected.');
  }
  if (before.summary.affectedPackageScripts.length > 0) {
    score += 18;
    reasons.push('Package scripts may be affected by a config or manifest change.');
  }
  if (before.summary.relatedTests.length === 0) {
    score += 8;
    reasons.push('No related tests were detected.');
  }
  if (validationCommands.includes('unknown')) {
    score += 10;
    reasons.push('No precise validation command could be selected.');
  }

  const level: PatchImpactRiskLevel = score >= 55 ? 'high' : score >= 25 ? 'medium' : 'low';
  const requiresConfirmation =
    level === 'high' ||
    surfaceChanges > 0 ||
    before.summary.affectedContractsTypes.length > 0 ||
    before.summary.affectedPackageScripts.length > 0;

  return {
    level,
    score,
    requiresConfirmation,
    reasons: reasons.length > 0 ? reasons : ['Patch impact is narrow and structurally unchanged.'],
    userMessage: describeRiskForUser(level, requiresConfirmation),
  };
}

function describeRiskForUser(level: PatchImpactRiskLevel, requiresConfirmation: boolean) {
  if (level === 'high') {
    return 'High blast radius. Confirm with the user before applying similar patches and run the recommended validation commands.';
  }
  if (level === 'medium') {
    return requiresConfirmation
      ? 'Moderate blast radius with sensitive surface changes. Confirm before continuing.'
      : 'Moderate blast radius. Run the recommended validation commands before trusting the patch.';
  }
  return 'Low blast radius. Run the recommended validation command when available.';
}

function normalizeRelativePath(value: string) {
  return value.split(path.sep).join('/').replace(/^\.\/+/, '');
}

function isContractOrTypeFile(file: string) {
  return file.startsWith('src/contracts/') || /\.(types?|d)\.tsx?$/.test(file);
}

function isTypeScriptSourceFile(file: string) {
  return /\.(ts|tsx|mts|cts)$/.test(file) && !/\.d\.ts$/.test(file);
}

function uniqSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
