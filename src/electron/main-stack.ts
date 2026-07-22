import { app } from 'electron';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { loadConfig, createMaTeXStack, type MaTeXConfig } from './config/mate-x.config';
import { MissingSDKClientError } from './orchestration/sdk-orchestrator';
import { setSDKOrchestrator } from './sdk-orchestrator-state';
import { tursoService } from './turso-service';
import { startupPerfMark } from './startup-perf';
import type { AgentAction, AgentSdkClient } from '../contracts/sdk-orchestrator.types';
import type { FailureMemorySyncStateStore } from '../contracts/failure-memory-sync.types';
import type { FilesSdkClient, StorageEvent } from '../contracts/storage-adapter.types';

export type MaTeXStack = Awaited<ReturnType<typeof createMaTeXStack>>;

let stack: MaTeXStack | null = null;
let configSnapshot: MaTeXConfig | null = null;

export async function initStack(): Promise<void> {
  await teardownStack();

  // Durable EngineeringRepository (R1) — fail closed, no in-memory fallback
  await tursoService.initialize();
  startupPerfMark('stack:turso');
  const { initDurableEngineeringRepository } = await import('./engineering/repository');
  const dbPath = tursoService.getLocalDatabaseFilePath();
  if (!dbPath) {
    throw new Error(
      'EngineeringRepository requires a local libSQL file path; remote-only TURSO_DATABASE_URL is not supported for v0.1.2 control-plane authority',
    );
  }
  initDurableEngineeringRepository(dbPath);
  try {
    const { initializeLinearIntegration } = await import('./linear');
    await initializeLinearIntegration();
  } catch (error) {
    console.error('Optional Linear integration failed to initialize:', error);
  }
  startupPerfMark('stack:engineering-repo');

  // Production Rainy agent adapter + optional migration + config load can proceed in parallel
  // after the durable repo is ready (adapter does not depend on migration).
  const agentAdapterPromise = import('./engineering/agent-runtime').then(
    ({ initProductionAgentAdapter, resolveRainyApiKeyFromEnv }) => {
      initProductionAgentAdapter({
        getApiKey: () => resolveRainyApiKeyFromEnv(process.env),
      });
    },
  );

  // Optional v0.1.1 migration fixture path for upgrade installs
  const migrationPromise = (async () => {
    try {
      const { runV011Migration, loadV011Fixture } = await import(
        './engineering/migration/migrate-v011'
      );
      const { getEngineeringRepository } = await import('./engineering/repository');
      const fixturePath = join(app.getPath('userData'), 'legacy', 'v0.1.1-fixture.json');
      const { existsSync } = await import('node:fs');
      if (existsSync(fixturePath)) {
        const fixture = loadV011Fixture(fixturePath);
        runV011Migration({
          repo: getEngineeringRepository(),
          fixture,
          userDataDir: app.getPath('userData'),
        });
      }
    } catch (error) {
      console.warn('Legacy migration skipped or failed safely', error);
    }
  })();

  const configPromise = loadConfig(join(app.getPath('userData'), 'mate-x.config.json')).then(
    async (nextConfig) => ({
      ...nextConfig,
      storage: {
        ...nextConfig.storage,
        credentials: await resolveStorageCredentials(nextConfig),
      },
    }),
  );

  const [, , resolvedConfig] = await Promise.all([
    agentAdapterPromise,
    migrationPromise,
    configPromise,
  ]);
  startupPerfMark('stack:config-ready');

  const nextStack = await createMaTeXStack(resolvedConfig, {
    workspaceId: 'default',
    storage: {
      // Use app-scoped userData for the internal MaTeX SDK storage bucket / EvidencePackStorage
      // adapter (the '.mate-x/evidence' tree). This was previously resolve(process.cwd(), ...),
      // which caused .mate-x folders (and evidence artifacts) to be created inside the mate-x
      // source repo (dev) or the packaged app launch/install dir (prod) instead of being
      // isolated to the app and the *target* workspace's .mate-x/evidence for compliance packs.
      // The portable per-workspace evidence still lives under the user-selected workspacePath
      // (see attestation, complianceExport, evidence-pack build paths using snapshot.workspace.path).
      files: createLocalFilesClient(join(app.getPath('userData'), 'matex-storage', resolvedConfig.storage.bucket ?? 'evidence')),
      privacySentinel: {
        scan: async (content) => {
          const { privacyFirewall } = await import('./privacy/privacy-firewall-service');
          const scan = await privacyFirewall.scanTextSafe(
            typeof content === 'string' ? content : Buffer.from(content).toString('utf8'),
          );
          const categories = Array.from(new Set(scan.spans.map((span) => span.label)));
          return { hasSecrets: categories.length > 0, categories };
        },
      },
      evidenceRecorder: {
        appendStorageEvent: async (event: StorageEvent) => {
          console.debug('MaTE X storage event', event);
        },
      },
      failureMemory: {
        recordFailure: async (input) => {
          const { failureMemoryEngine } = await import('./failure-memory-engine');
          return failureMemoryEngine.recordFailure(input);
        },
      },
      approvalGate: {
        requireApproval: async (input) => {
          const approved = await requestPolicyApproval('storage', input.operation, input);
          if (!approved) {
            throw new Error(`Storage operation ${input.operation} was not approved.`);
          }
        },
      },
      rateLimiter: { check: async () => true },
      agentProfiler: { recordStorageOperation: async () => undefined },
    },
    failureMemory: {
      repository: {
        list: (workspaceId, limit) => tursoService.getFailureMemories(workspaceId, limit),
        upsert: async (records) => {
          const { failureMemoryEngine } = await import('./failure-memory-engine');
          for (const record of records) {
            await failureMemoryEngine.recordFailure({
              workspaceId: record.workspaceId,
              command: record.command,
              exitCode: record.exitCode,
              framework: record.framework,
              failingTests: record.failingTests,
              output: record.stackTraceExcerpt ?? record.errorSignature,
              errorSignature: record.errorSignature,
              stackTraceExcerpt: record.stackTraceExcerpt,
              affectedFiles: record.affectedFiles,
              attemptedFix: record.attemptedFix,
              retryFixed: record.retryFixed,
            });
          }
        },
      },
      stateStore: createFailureMemorySyncStateStore(),
    },
    sdk: {
      codexClient: createUnavailableSdkClient('codex'),
      cursorClient: createUnavailableSdkClient('cursor'),
      antigravityClient: createUnavailableSdkClient('antigravity'),
      privacySentinel: {
        scan: async (payload) => {
          const { privacyFirewall } = await import('./privacy/privacy-firewall-service');
          const scan = await privacyFirewall.scanTextSafe(payload);
          const categories = Array.from(new Set(scan.spans.map((span) => span.label)));
          return { hasSecrets: categories.length > 0, categories };
        },
      },
      evidenceRecorder: {
        appendAgentActionEvent: async (event) => {
          console.debug('MaTE X SDK event', event);
        },
      },
      failureMemory: {
        recordFailure: async (input) => {
          const { failureMemoryEngine } = await import('./failure-memory-engine');
          return failureMemoryEngine.recordFailure(input);
        },
      },
      confirmHighImpact: (action) => requestPolicyApproval(`sdk:${action.agentId}`, action.actionType, action),
    },
  });
  configSnapshot = resolvedConfig;
  stack = nextStack;
  setSDKOrchestrator(nextStack.orchestrator);
  // Defer periodic Failure Memory sync until after first paint / idle.
  // start() only schedules setInterval (no immediate sync), but keep it off the critical path.
  scheduleFailureMemorySyncStart(nextStack.failureMemorySync);
  startupPerfMark('stack:ready');
}

async function resolveStorageCredentials(config: MaTeXConfig): Promise<Record<string, unknown>> {
  if (!config.storage.credentialsSecureKey) {
    return config.storage.credentials;
  }

  const credentials = await tursoService.getSecureAppSecretJson(config.storage.credentialsSecureKey);
  if (!credentials) {
    throw new Error(`Storage credentials are not configured for secure key "${config.storage.credentialsSecureKey}".`);
  }
  return credentials;
}

export function getStack(): MaTeXStack {
  if (!stack) {
    throw new Error('MaTeX stack not initialized. Call initStack() first.');
  }

  return stack;
}

export function getConfigSnapshot(): MaTeXConfig {
  if (!configSnapshot) {
    throw new Error('MaTE X config not initialized. Call initStack() first.');
  }

  return configSnapshot;
}

export async function teardownStack(): Promise<void> {
  const { teardownLinearIntegration } = await import('./linear');
  teardownLinearIntegration();
  if (!stack) {
    setSDKOrchestrator(null);
    configSnapshot = null;
    return;
  }

  stack.failureMemorySync.stop();
  setSDKOrchestrator(null);
  stack = null;
  configSnapshot = null;
}

function createUnavailableSdkClient(agentId: AgentAction['agentId']): AgentSdkClient {
  return {
    async execute() {
      throw new MissingSDKClientError(agentId);
    },
  };
}

function createLocalFilesClient(root: string): FilesSdkClient {
  const safePath = (key: string) => {
    if (typeof key !== 'string' || key.includes('\0')) {
      throw new Error(`Refusing local storage path outside evidence root: ${String(key)}`);
    }
    const resolved = resolve(root, key);
    const rel = relative(root, resolved);
    // Cross-drive relatives are absolute on Windows; treat them as escapes.
    const escapedRoot =
      isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`);
    if (escapedRoot) {
      throw new Error(`Refusing local storage path outside evidence root: ${key}`);
    }
    return resolved;
  };

  return {
    async upload(key, body) {
      const path = safePath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(await bodyToBytes(body)));
      return { url: `file://${path}` };
    },
    async download(key) {
      return readFile(safePath(key));
    },
    async delete(key) {
      await rm(safePath(key), { force: true });
    },
    async list(options) {
      const prefix = typeof options?.prefix === 'string' ? options.prefix : '';
      const rootPath = safePath(prefix);
      return listLocalFiles(root, rootPath);
    },
  };
}

async function bodyToBytes(body: string | Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  return new Uint8Array(await body.arrayBuffer());
}

async function listLocalFiles(root: string, currentPath: string): Promise<Array<{ key: string; size: number; updatedAt: string }>> {
  try {
    const currentStat = await stat(currentPath);
    if (currentStat.isFile()) {
      return [{
        key: relative(root, currentPath),
        size: currentStat.size,
        updatedAt: currentStat.mtime.toISOString(),
      }];
    }
  } catch {
    return [];
  }

  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = join(currentPath, entry.name);
    return entry.isDirectory() ? listLocalFiles(root, entryPath) : stat(entryPath).then((entryStat) => [{
      key: relative(root, entryPath),
      size: entryStat.size,
      updatedAt: entryStat.mtime.toISOString(),
    }]);
  }));
  return files.flat();
}

async function requestPolicyApproval(toolName: string, actionType: string, payload: unknown): Promise<boolean> {
  const { policyService } = await import('./policy-service');
  const runId = `policy-${Date.now()}`;
  const stop = policyService.createStop({
    runId,
    // Use a stable app-scoped path for policy context (high-impact storage/SDK approvals).
    // Previously process.cwd() leaked target context and could point at the wrong tree.
    // Real per-target workspacePath for evidence/compliance is supplied via snapshot
    // at run time in the assistant and orchestrator paths.
    workspacePath: app.getPath('userData'),
    toolName,
    severity: 'critical',
    policyId: 'sdk.high_impact_approval',
    title: 'Approve high-impact SDK action',
    explanation: `MaTE X requested high-impact action "${actionType}".`,
    kind: 'tool_call',
    command: actionType,
    metadata: { payload: JSON.stringify(payload).slice(0, 4_000) },
    recommendation: 'abort',
    availableActions: ['approve_once', 'abort', 'safer_alternative'],
  });
  const resolved = await policyService.waitForResolution(stop.id);
  return resolved.status === 'approved';
}

function scheduleFailureMemorySyncStart(sync: { start: () => void; stop: () => void }) {
  // Prefer idle callback when available (Electron/Chromium); else short deferral.
  const start = () => {
    try {
      sync.start();
    } catch (error) {
      console.warn('Failure Memory sync failed to start', error);
    }
  };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof idle === 'function') {
    idle(start, { timeout: 5_000 });
    return;
  }
  setTimeout(start, 2_500);
}

function createFailureMemorySyncStateStore(): FailureMemorySyncStateStore {
  const statePath = join(app.getPath('userData'), 'failure-memory-sync-state.json');

  return {
    async getLastSyncAt(workspaceId) {
      const state = await readJsonRecord(statePath);
      const value = state[workspaceId];
      return typeof value === 'string' ? value : null;
    },
    async setLastSyncAt(workspaceId, timestamp) {
      const state = await readJsonRecord(statePath);
      state[workspaceId] = timestamp;
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    },
  };
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}
