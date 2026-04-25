import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  RepoGraphDependencySurface,
  RepoGraphEdge,
  RepoGraphEntrypoint,
  RepoGraphEnvUsage,
  RepoGraphImpactedFile,
  RepoGraphImportChain,
  RepoGraphIpcSurface,
  RepoGraphNode,
  RepoGraphNodeKind,
  RepoGraphSnapshot,
} from '../contracts/repo-graph';
import type { WorkspaceEntry } from '../contracts/workspace';
import { tursoService } from './turso-service';

type RepoGraphWorkspace = Pick<WorkspaceEntry, 'id' | 'name' | 'path'>;

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]);
const CONFIG_FILENAMES = new Set([
  'vite.config.ts',
  'vite.config.js',
  'electron.vite.config.ts',
  'tsconfig.json',
  'eslint.config.js',
  'tailwind.config.ts',
  'forge.config.ts',
]);
const MANIFEST_FILENAMES = new Set(['package.json']);
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.next',
  'out',
  'target',
  'coverage',
]);
const MAX_FILES = 3500;
const MAX_FILE_BYTES = 600_000;
const SERVICE_CALL_PATTERN =
  /\b([A-Za-z0-9_$]+(?:Service)?)\.([A-Za-z0-9_$]+)\s*\(/g;
const DIRECT_CALL_PATTERN = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
const FAN_OUT_LIMIT = 12;

export class RepoGraphService {
  private watchers = new Map<string, FSWatcher>();
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private inFlightRefreshes = new Map<string, Promise<RepoGraphSnapshot>>();

  async refreshWorkspace(workspace: RepoGraphWorkspace): Promise<RepoGraphSnapshot> {
    const existing = this.inFlightRefreshes.get(workspace.id);
    if (existing) {
      return existing;
    }

    const refresh = this.buildWorkspaceGraph(workspace).finally(() => {
      this.inFlightRefreshes.delete(workspace.id);
    });
    this.inFlightRefreshes.set(workspace.id, refresh);
    return refresh;
  }

  async ensureWorkspaceGraph(workspace: RepoGraphWorkspace): Promise<RepoGraphSnapshot> {
    this.ensureWatcher(workspace);
    const snapshot = await tursoService.getRepoGraphSnapshot(workspace.id);
    return snapshot ?? this.refreshWorkspace(workspace);
  }

  async noteGitStatusChanged(workspace: RepoGraphWorkspace) {
    this.scheduleRefresh(workspace, 750);
  }

  async getEntrypoints(workspace: RepoGraphWorkspace): Promise<RepoGraphEntrypoint[]> {
    await this.ensureWorkspaceGraph(workspace);
    const nodes = await tursoService.getRepoGraphNodes(workspace.id, [
      'entrypoint',
      'file',
      'config',
      'manifest',
    ]);
    const edges = await tursoService.getRepoGraphEdges(workspace.id, ['entrypoint_for']);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return edges
      .map((edge) => {
        const from = nodeById.get(edge.fromNodeId);
        const to = nodeById.get(edge.toNodeId);
        if (!from || to?.kind !== 'entrypoint') {
          return null;
        }
        return {
          file: from.key,
          reason: String(edge.metadata?.reason ?? 'entrypoint'),
        };
      })
      .filter((entry): entry is RepoGraphEntrypoint => Boolean(entry))
      .sort((a, b) => a.file.localeCompare(b.file));
  }

  async getImpactedFiles(
    workspace: RepoGraphWorkspace,
    changedFiles: string[],
  ): Promise<RepoGraphImpactedFile[]> {
    await this.ensureWorkspaceGraph(workspace);
    const { nodesById, fileNodeByKey, reverseImports, runtimeTargets, testsByFile } =
      await this.loadFileGraph(workspace.id);
    const queue = changedFiles
      .map((file) => normalizeRelativePath(file))
      .filter((file): file is string => Boolean(fileNodeByKey.get(file)))
      .map((file) => ({ file, distance: 0, reason: 'changed' }));
    const seen = new Map<string, RepoGraphImpactedFile>();

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (seen.has(current.file)) {
        continue;
      }
      seen.set(current.file, current);

      const dependents = prioritizeImpactTargets(reverseImports.get(current.file) ?? []);
      for (const dependent of dependents) {
        queue.push({
          file: dependent,
          distance: current.distance + 1,
          reason: describeImpactReason(dependent, `imports ${current.file}`),
        });
      }
      addFanOutSummary(queue, current, reverseImports.get(current.file) ?? [], `imports ${current.file}`);

      const runtimeDelegates = prioritizeImpactTargets(runtimeTargets.get(current.file) ?? []);
      for (const target of runtimeDelegates) {
        queue.push({
          file: target,
          distance: current.distance + 1,
          reason: describeImpactReason(target, `runtime delegate from ${current.file}`),
        });
      }
      addFanOutSummary(
        queue,
        current,
        runtimeTargets.get(current.file) ?? [],
        `runtime delegate from ${current.file}`,
      );

      for (const test of testsByFile.get(current.file) ?? []) {
        queue.push({
          file: test,
          distance: current.distance + 1,
          reason: `tests ${current.file}`,
        });
      }
    }

    return [...seen.values()]
      .filter((entry) => entry.group || nodesById.has(fileNodeByKey.get(entry.file)?.id ?? ''))
      .sort((a, b) => a.distance - b.distance || a.file.localeCompare(b.file));
  }

  async getTestsForFile(workspace: RepoGraphWorkspace, file: string): Promise<string[]> {
    await this.ensureWorkspaceGraph(workspace);
    const { testsByFile } = await this.loadFileGraph(workspace.id);
    return [...(testsByFile.get(normalizeRelativePath(file)) ?? [])].sort();
  }

  async getImportChain(
    workspace: RepoGraphWorkspace,
    from: string,
    to: string,
  ): Promise<RepoGraphImportChain | null> {
    await this.ensureWorkspaceGraph(workspace);
    const { importsByFile } = await this.loadFileGraph(workspace.id);
    const source = normalizeRelativePath(from);
    const target = normalizeRelativePath(to);
    const queue = [[source]];
    const seen = new Set<string>();

    for (let index = 0; index < queue.length; index += 1) {
      const chain = queue[index];
      const current = chain[chain.length - 1];
      if (current === target) {
        return { from: source, to: target, chain };
      }
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const next of importsByFile.get(current) ?? []) {
        queue.push([...chain, next]);
      }
    }

    return null;
  }

  async getIpcSurface(workspace: RepoGraphWorkspace): Promise<RepoGraphIpcSurface[]> {
    await this.ensureWorkspaceGraph(workspace);
    const nodes = await tursoService.getRepoGraphNodes(workspace.id, [
      'ipc_channel',
      'file',
      'function',
    ]);
    const edges = await tursoService.getRepoGraphEdges(workspace.id, [
      'ipc_calls',
      'ipc_handles',
      'delegates_to',
    ]);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const surface = new Map<string, RepoGraphIpcSurface>();

    for (const edge of edges) {
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      const channel = from?.kind === 'ipc_channel' ? from : to;
      const file = from?.kind === 'file' ? from : to;
      if (!channel || !file) {
        continue;
      }
      const entry =
        surface.get(channel.key) ??
        surface
          .set(channel.key, { channel: channel.key, callers: [], callees: [] })
          .get(channel.key)!;
      if (edge.kind === 'ipc_calls') {
        entry.callers.push(file.key);
      } else if (edge.kind === 'ipc_handles') {
        entry.callees.push(file.key);
      } else if (edge.kind === 'delegates_to' && from?.kind === 'ipc_channel' && to?.kind === 'function') {
        entry.callees.push(to.key);
      }
    }

    return [...surface.values()].map((entry) => ({
      channel: entry.channel,
      callers: uniqueSorted(entry.callers),
      callees: uniqueSorted(entry.callees),
    }));
  }

  async getEnvUsage(
    workspace: RepoGraphWorkspace,
    variable?: string,
  ): Promise<RepoGraphEnvUsage[]> {
    await this.ensureWorkspaceGraph(workspace);
    const nodes = await tursoService.getRepoGraphNodes(workspace.id, [
      'env_var',
      'file',
    ]);
    const edges = await tursoService.getRepoGraphEdges(workspace.id, ['uses_env']);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const usage = new Map<string, string[]>();

    for (const edge of edges) {
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      if (from?.kind !== 'file' || to?.kind !== 'env_var') {
        continue;
      }
      if (variable && to.key !== variable) {
        continue;
      }
      usage.set(to.key, [...(usage.get(to.key) ?? []), from.key]);
    }

    return [...usage.entries()]
      .map(([name, files]) => ({ variable: name, files: uniqueSorted(files) }))
      .sort((a, b) => a.variable.localeCompare(b.variable));
  }

  async getDependencySurface(
    workspace: RepoGraphWorkspace,
  ): Promise<RepoGraphDependencySurface[]> {
    await this.ensureWorkspaceGraph(workspace);
    const nodes = await tursoService.getRepoGraphNodes(workspace.id, [
      'dependency',
      'file',
      'manifest',
    ]);
    const edges = await tursoService.getRepoGraphEdges(workspace.id, [
      'depends_on',
      'imports',
    ]);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const manifestByDependency = new Map<string, string>();
    const filesByDependency = new Map<string, string[]>();

    for (const edge of edges) {
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      if (edge.kind === 'depends_on' && from?.kind === 'manifest' && to?.kind === 'dependency') {
        manifestByDependency.set(to.key, from.key);
      }
      if (edge.kind === 'imports' && from?.kind === 'file' && to?.kind === 'dependency') {
        filesByDependency.set(to.key, [...(filesByDependency.get(to.key) ?? []), from.key]);
      }
    }

    return [...manifestByDependency.entries()]
      .map(([dependency, manifest]) => ({
        manifest,
        dependency,
        files: uniqueSorted(filesByDependency.get(dependency) ?? []),
      }))
      .sort((a, b) => a.dependency.localeCompare(b.dependency));
  }

  async getPromptSummary(workspace: RepoGraphWorkspace) {
    await this.ensureWorkspaceGraph(workspace);
    const [snapshot, entrypoints, ipcSurface, envUsage] = await Promise.all([
      tursoService.getRepoGraphSnapshot(workspace.id),
      this.getEntrypoints(workspace),
      this.getIpcSurface(workspace),
      this.getEnvUsage(workspace),
    ]);

    return [
      `Indexed: ${snapshot?.indexedAt ?? 'pending'} (${snapshot?.nodeCount ?? 0} nodes, ${snapshot?.edgeCount ?? 0} edges)`,
      `Entrypoints: ${entrypoints.slice(0, 8).map((entry) => `${entry.file} (${entry.reason})`).join(', ') || 'none'}`,
      `IPC: ${ipcSurface.slice(0, 10).map((entry) => entry.channel).join(', ') || 'none'}`,
      `Env vars: ${envUsage.slice(0, 10).map((entry) => entry.variable).join(', ') || 'none'}`,
    ].join('\n');
  }

  private async buildWorkspaceGraph(workspace: RepoGraphWorkspace) {
    const files = await collectIndexableFiles(workspace.path);
    const builder = new GraphBuilder(workspace.id);
    const fileContents = new Map<string, string>();

    for (const file of files) {
      const kind = classifyFile(file);
      builder.node(kind, file, file, { extension: path.extname(file) });
      const absolutePath = path.join(workspace.path, file);
      const content = await readSmallFile(absolutePath);
      if (content === null) {
        continue;
      }
      fileContents.set(file, content);
      if (kind === 'test') {
        linkTestFile(builder, file, files);
      }
      if (SOURCE_EXTENSIONS.has(path.extname(file))) {
        parseSourceFile(builder, workspace.path, file, content, files);
      }
      if (MANIFEST_FILENAMES.has(path.basename(file))) {
        parsePackageManifest(builder, file, content);
      }
      if (kind === 'config') {
        builder.edge('config', file, 'entrypoint', `config:${file}`, 'entrypoint_for', {
          reason: 'config file',
        });
      }
    }

    inferEntrypoints(builder, fileContents);
    const { nodes, edges } = builder.snapshot();
    return tursoService.replaceRepoGraph(workspace.id, nodes, edges);
  }

  private async loadFileGraph(workspaceId: string) {
    const nodes = await tursoService.getRepoGraphNodes(workspaceId, ['file', 'test']);
    const edges = await tursoService.getRepoGraphEdges(workspaceId, [
      'imports',
      'tests',
      'runtime_depends_on',
    ]);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const fileNodeByKey = new Map(nodes.map((node) => [node.key, node]));
    const importsByFile = new Map<string, string[]>();
    const reverseImports = new Map<string, string[]>();
    const runtimeTargets = new Map<string, string[]>();
    const testsByFile = new Map<string, string[]>();

    for (const edge of edges) {
      const from = nodesById.get(edge.fromNodeId);
      const to = nodesById.get(edge.toNodeId);
      if (!from || !to) {
        continue;
      }
      if (edge.kind === 'imports' && (from.kind === 'file' || from.kind === 'test')) {
        importsByFile.set(from.key, [...(importsByFile.get(from.key) ?? []), to.key]);
        reverseImports.set(to.key, [...(reverseImports.get(to.key) ?? []), from.key]);
      }
      if (
        edge.kind === 'runtime_depends_on' &&
        (from.kind === 'file' || from.kind === 'test') &&
        (to.kind === 'file' || to.kind === 'test')
      ) {
        runtimeTargets.set(from.key, [...(runtimeTargets.get(from.key) ?? []), to.key]);
        reverseImports.set(to.key, [...(reverseImports.get(to.key) ?? []), from.key]);
      }
      if (edge.kind === 'tests' && from.kind === 'test') {
        testsByFile.set(to.key, [...(testsByFile.get(to.key) ?? []), from.key]);
      }
    }

    return { nodesById, fileNodeByKey, importsByFile, reverseImports, runtimeTargets, testsByFile };
  }

  private ensureWatcher(workspace: RepoGraphWorkspace) {
    if (this.watchers.has(workspace.id)) {
      return;
    }

    try {
      const watcher = watch(
        workspace.path,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename || shouldIgnorePath(String(filename))) {
            return;
          }
          this.scheduleRefresh(workspace, 1000);
        },
      );
      this.watchers.set(workspace.id, watcher);
    } catch {
      // Unsupported watcher platforms still refresh through explicit API/git status.
    }
  }

  private scheduleRefresh(workspace: RepoGraphWorkspace, delayMs: number) {
    const existingTimer = this.refreshTimers.get(workspace.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.refreshTimers.delete(workspace.id);
      void this.refreshWorkspace(workspace);
    }, delayMs);
    this.refreshTimers.set(workspace.id, timer);
  }
}

class GraphBuilder {
  private nodes = new Map<string, RepoGraphNode>();
  private edges = new Map<string, RepoGraphEdge>();

  constructor(private readonly workspaceId: string) {}

  node(
    kind: RepoGraphNodeKind,
    key: string,
    label = key,
    metadata?: Record<string, unknown>,
  ) {
    const normalizedKey = normalizeRelativePath(key);
    const id = `graph_${this.workspaceId}_${kind}_${hashKey(normalizedKey)}`;
    const node: RepoGraphNode = {
      id,
      workspaceId: this.workspaceId,
      kind,
      key: normalizedKey,
      label,
      metadata,
      updatedAt: new Date(0).toISOString(),
    };
    this.nodes.set(`${kind}:${normalizedKey}`, node);
    return node;
  }

  edge(
    fromKind: RepoGraphNodeKind,
    fromKey: string,
    toKind: RepoGraphNodeKind,
    toKey: string,
    kind: RepoGraphEdge['kind'],
    metadata?: Record<string, unknown>,
  ) {
    const from = this.node(fromKind, fromKey);
    const to = this.node(toKind, toKey);
    const edgeKey = `${kind}:${from.id}:${to.id}`;
    this.edges.set(edgeKey, {
      id: `graph_edge_${this.workspaceId}_${hashKey(edgeKey)}`,
      workspaceId: this.workspaceId,
      kind,
      fromNodeId: from.id,
      toNodeId: to.id,
      metadata,
      updatedAt: new Date(0).toISOString(),
    });
  }

  snapshot() {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }
}

async function collectIndexableFiles(rootPath: string) {
  const files: string[] = [];
  async function visit(directory: string) {
    if (files.length >= MAX_FILES) {
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(rootPath, absolutePath));
      if (shouldIgnorePath(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (isIndexableFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  await visit(rootPath);
  return files.sort();
}

async function readSmallFile(filePath: string) {
  const fileStat = await stat(filePath);
  if (fileStat.size > MAX_FILE_BYTES) {
    return null;
  }
  return readFile(filePath, 'utf8');
}

function parseSourceFile(
  builder: GraphBuilder,
  rootPath: string,
  file: string,
  content: string,
  allFiles: string[],
) {
  for (const specifier of extractImportSpecifiers(content)) {
    const resolvedFile = resolveImport(rootPath, file, specifier, allFiles);
    if (resolvedFile) {
      builder.edge('file', file, classifyFile(resolvedFile), resolvedFile, 'imports', {
        specifier,
      });
    } else if (!specifier.startsWith('.')) {
      const dependency = specifier.split('/')[0]?.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (dependency) {
        builder.edge('file', file, 'dependency', dependency, 'imports', { specifier });
      }
    }
  }

  for (const exportName of extractExports(content)) {
    builder.edge('file', file, 'export', `${file}#${exportName}`, 'exports');
  }

  for (const envVar of extractEnvVars(content)) {
    builder.edge('file', file, 'env_var', envVar, 'uses_env');
  }

  for (const channel of extractIpcChannels(content, ['ipcRenderer.invoke', 'ipcRenderer.send'])) {
    builder.edge('file', file, 'ipc_channel', channel, 'ipc_calls');
  }
  for (const channel of extractIpcChannels(content, ['ipcMain.handle', 'ipcMain.on'])) {
    builder.edge('file', file, 'ipc_channel', channel, 'ipc_handles');
  }

  for (const delegation of extractIpcDelegations(rootPath, file, content, allFiles)) {
    builder.edge('ipc_channel', delegation.channel, 'function', delegation.functionKey, 'delegates_to', {
      file: delegation.file,
      function: delegation.functionName,
      service: delegation.serviceName,
    });
    builder.edge('file', file, classifyFile(delegation.file), delegation.file, 'runtime_depends_on', {
      channel: delegation.channel,
      function: delegation.functionName,
    });
  }
}

function parsePackageManifest(builder: GraphBuilder, file: string, content: string) {
  try {
    const manifest = JSON.parse(content) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      main?: string;
      module?: string;
      exports?: unknown;
    };
    builder.node('manifest', file, file);

    for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
      builder.edge('manifest', file, 'script', script, 'runs', { command });
      builder.edge('script', script, 'command', command, 'runs');
      builder.edge('command', command, 'entrypoint', `purpose:${script}`, 'has_purpose', {
        purpose: inferCommandPurpose(script, command),
      });
    }

    for (const dependency of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]) {
      builder.edge('manifest', file, 'dependency', dependency, 'depends_on');
    }

    for (const entrypoint of [manifest.main, manifest.module].filter(Boolean)) {
      builder.edge('manifest', file, 'entrypoint', String(entrypoint), 'entrypoint_for', {
        reason: 'package manifest',
      });
    }
  } catch {
    builder.node('manifest', file, file, { parseError: true });
  }
}

function inferEntrypoints(builder: GraphBuilder, contents: Map<string, string>) {
  for (const [file, content] of contents) {
    const basename = path.basename(file);
    if (['main.ts', 'main.tsx', 'renderer.tsx', 'preload.ts', 'index.ts', 'index.tsx'].includes(basename)) {
      builder.edge('file', file, 'entrypoint', file, 'entrypoint_for', { reason: 'conventional entrypoint' });
    }
    if (content.includes('createRoot(') || content.includes('app.whenReady(')) {
      builder.edge('file', file, 'entrypoint', file, 'entrypoint_for', { reason: 'runtime bootstrap' });
    }
  }
}

function linkTestFile(builder: GraphBuilder, testFile: string, allFiles: string[]) {
  const base = testFile
    .replace(/\.test\.[^.]+$/, '')
    .replace(/\.spec\.[^.]+$/, '');
  const candidate = allFiles.find((file) => {
    if (file === testFile) {
      return false;
    }
    const withoutExtension = file.slice(0, -path.extname(file).length);
    return withoutExtension === base;
  });
  if (candidate) {
    builder.edge('test', testFile, classifyFile(candidate), candidate, 'tests');
  }
}

async function loadActiveWorkspace() {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const workspaces = await tursoService.getWorkspaces();
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  const workspace =
    workspaces.find((entry) => entry.id === activeWorkspaceId) ?? workspaces[0];
  if (!workspace) {
    throw new Error('No active workspace available.');
  }
  return workspace;
}

function classifyFile(file: string): RepoGraphNodeKind {
  const basename = path.basename(file);
  if (/\.(test|spec)\.[^.]+$/.test(basename)) {
    return 'test';
  }
  if (MANIFEST_FILENAMES.has(basename)) {
    return 'manifest';
  }
  if (CONFIG_FILENAMES.has(basename) || basename.startsWith('.env')) {
    return 'config';
  }
  return 'file';
}

function isIndexableFile(file: string) {
  const basename = path.basename(file);
  return (
    SOURCE_EXTENSIONS.has(path.extname(file)) ||
    MANIFEST_FILENAMES.has(basename) ||
    CONFIG_FILENAMES.has(basename) ||
    basename.startsWith('.env')
  );
}

function shouldIgnorePath(filePath: string) {
  return normalizeRelativePath(filePath)
    .split('/')
    .some((part) => IGNORED_DIRS.has(part) || part.endsWith('.log') || part.endsWith('.map'));
}

function extractImportSpecifiers(content: string) {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"()]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^'"()]+?\s+from\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function extractExports(content: string) {
  const exports = new Set<string>();
  for (const match of content.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/g)) {
    exports.add(match[1]);
  }
  if (/\bexport\s+default\b/.test(content)) {
    exports.add('default');
  }
  for (const match of content.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const name of match[1].split(',')) {
      const exportedName = name.trim().split(/\s+as\s+/).pop()?.trim();
      if (exportedName) {
        exports.add(exportedName);
      }
    }
  }
  return [...exports];
}

function extractEnvVars(content: string) {
  const vars = new Set<string>();
  for (const match of content.matchAll(/\bprocess\.env\.([A-Z0-9_]+)/g)) {
    vars.add(match[1]);
  }
  for (const match of content.matchAll(/\bimport\.meta\.env\.([A-Z0-9_]+)/g)) {
    vars.add(match[1]);
  }
  return [...vars];
}

function extractIpcChannels(content: string, callees: string[]) {
  const channels = new Set<string>();
  for (const callee of callees) {
    const escaped = callee.replace('.', '\\.');
    const pattern = new RegExp(`${escaped}\\(\\s*["']([^"']+)["']`, 'g');
    for (const match of content.matchAll(pattern)) {
      channels.add(match[1]);
    }
  }
  return [...channels];
}

function extractIpcDelegations(
  rootPath: string,
  file: string,
  content: string,
  allFiles: string[],
) {
  const importMap = buildImportedIdentifierMap(rootPath, file, content, allFiles);
  const delegations: Array<{
    channel: string;
    serviceName: string;
    functionName: string;
    functionKey: string;
    file: string;
  }> = [];
  for (const handler of extractIpcHandlerSections(content)) {
    const channel = handler.channel;
    const body = handler.body;
    for (const callMatch of body.matchAll(SERVICE_CALL_PATTERN)) {
      const serviceName = callMatch[1];
      const functionName = callMatch[2];
      const targetFile = importMap.get(serviceName);
      if (!targetFile || serviceName === 'ipcMain') {
        continue;
      }
      delegations.push({
        channel,
        serviceName,
        functionName,
        functionKey: `${targetFile}#${functionName}`,
        file: targetFile,
      });
    }
    for (const callMatch of body.matchAll(DIRECT_CALL_PATTERN)) {
      const functionName = callMatch[1];
      const targetFile = importMap.get(functionName);
      if (!targetFile) {
        continue;
      }
      delegations.push({
        channel,
        serviceName: functionName,
        functionName,
        functionKey: `${targetFile}#${functionName}`,
        file: targetFile,
      });
    }
  }

  return delegations;
}

function extractIpcHandlerSections(content: string) {
  const starts = [...content.matchAll(/\bipcMain\.(?:handle|on)\(\s*["']([^"']+)["']/g)];
  return starts.map((match, index) => {
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? content.length;
    return {
      channel: match[1],
      body: content.slice(start, end),
    };
  });
}

function buildImportedIdentifierMap(
  rootPath: string,
  file: string,
  content: string,
  allFiles: string[],
) {
  const imports = new Map<string, string>();
  const namedImportPattern = /\bimport\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  const defaultImportPattern = /\bimport\s+([A-Za-z0-9_$]+)\s+from\s+["']([^"']+)["']/g;

  for (const match of content.matchAll(namedImportPattern)) {
    const targetFile = resolveImport(rootPath, file, match[2], allFiles);
    if (!targetFile) {
      continue;
    }
    for (const imported of match[1].split(',')) {
      const localName = imported.trim().split(/\s+as\s+/).pop()?.trim();
      if (localName) {
        imports.set(localName, targetFile);
      }
    }
  }

  for (const match of content.matchAll(defaultImportPattern)) {
    const targetFile = resolveImport(rootPath, file, match[2], allFiles);
    if (targetFile) {
      imports.set(match[1], targetFile);
    }
  }

  return imports;
}

function resolveImport(
  rootPath: string,
  fromFile: string,
  specifier: string,
  allFiles: string[],
) {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const basePath = normalizeRelativePath(
    path.relative(rootPath, path.resolve(rootPath, path.dirname(fromFile), specifier)),
  );
  const candidates = [
    basePath,
    ...[...SOURCE_EXTENSIONS].map((extension) => `${basePath}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) => `${basePath}/index${extension}`),
  ];
  return candidates.find((candidate) => allFiles.includes(candidate)) ?? null;
}

function inferCommandPurpose(script: string, command: string) {
  const lower = `${script} ${command}`.toLowerCase();
  if (lower.includes('test') || lower.includes('vitest') || lower.includes('jest')) {
    return 'test';
  }
  if (lower.includes('lint') || lower.includes('eslint')) {
    return 'lint';
  }
  if (lower.includes('typecheck') || lower.includes('tsc')) {
    return 'typecheck';
  }
  if (lower.includes('build') || lower.includes('vite build')) {
    return 'build';
  }
  if (lower.includes('start') || lower.includes('dev')) {
    return 'dev';
  }
  return 'script';
}

function normalizeRelativePath(filePath: string) {
  return filePath.replaceAll(path.sep, '/').replace(/^\.?\//, '');
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function prioritizeImpactTargets(files: string[]) {
  const uniqueFiles = uniqueSorted(files);
  if (uniqueFiles.length <= FAN_OUT_LIMIT) {
    return uniqueFiles;
  }

  const highSignal = uniqueFiles.filter((file) => !isFanOutLeaf(file));
  const lowSignal = uniqueFiles.filter(isFanOutLeaf);
  return [...highSignal, ...lowSignal].slice(0, FAN_OUT_LIMIT);
}

function addFanOutSummary(
  queue: RepoGraphImpactedFile[],
  current: RepoGraphImpactedFile,
  files: string[],
  reason: string,
) {
  const uniqueFiles = uniqueSorted(files);
  if (uniqueFiles.length <= FAN_OUT_LIMIT) {
    return;
  }
  const shown = prioritizeImpactTargets(uniqueFiles);
  const hiddenCount = uniqueFiles.length - shown.length;
  if (hiddenCount <= 0) {
    return;
  }

  queue.push({
    file: `${current.file}#fanout:${hashKey(reason)}`,
    distance: current.distance + 1,
    reason: `${reason}; ${hiddenCount} lower-signal files grouped`,
    group: inferImpactGroup(uniqueFiles),
    hiddenCount,
  });
}

function describeImpactReason(file: string, reason: string) {
  const group = inferImpactGroup([file]);
  return group ? `${reason}; ${group}` : reason;
}

function inferImpactGroup(files: string[]) {
  if (files.every((file) => file.startsWith('src/electron/tools/'))) {
    return 'tool ecosystem';
  }
  if (files.every((file) => file.includes('/tools/'))) {
    return 'tool ecosystem';
  }
  if (files.every((file) => file.endsWith('.test.ts') || file.endsWith('.test.tsx'))) {
    return 'tests';
  }
  return undefined;
}

function isFanOutLeaf(file: string) {
  return file.startsWith('src/electron/tools/') || file.includes('/tools/');
}

function hashKey(input: string) {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export const repoGraphService = new RepoGraphService();
export const resolveActiveWorkspaceForRepoGraph = loadActiveWorkspace;
