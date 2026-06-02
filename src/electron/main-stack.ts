import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { loadConfig, createMaTeXStack, type MaTeXConfig } from './config/mate-x.config';
import { failureMemoryEngine } from './failure-memory-engine';
import { MissingSDKClientError } from './orchestration/sdk-orchestrator';
import { policyService } from './policy-service';
import { privacyFirewall } from './privacy/privacy-firewall-service';
import { setSDKOrchestrator } from './repo-service';
import { tursoService } from './turso-service';
import type { AgentAction, AgentSdkClient } from '../contracts/sdk-orchestrator.types';
import type { FailureMemorySyncStateStore } from '../contracts/failure-memory-sync.types';
import type { StorageEvent } from '../contracts/storage-adapter.types';

export type MaTeXStack = Awaited<ReturnType<typeof createMaTeXStack>>;

let stack: MaTeXStack | null = null;
let configSnapshot: MaTeXConfig | null = null;

export async function initStack(): Promise<void> {
  configSnapshot = await loadConfig();
  stack = await createMaTeXStack(configSnapshot, {
    workspaceId: 'default',
    storage: {
      privacySentinel: {
        scan: async (content) => {
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
        recordFailure: (input) => failureMemoryEngine.recordFailure(input),
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
        recordFailure: (input) => failureMemoryEngine.recordFailure(input),
      },
      confirmHighImpact: (action) => requestPolicyApproval(`sdk:${action.agentId}`, action.actionType, action),
    },
  });
  setSDKOrchestrator(stack.orchestrator);
  stack.failureMemorySync.start();
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
  if (!stack) {
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

async function requestPolicyApproval(toolName: string, actionType: string, payload: unknown): Promise<boolean> {
  const runId = `policy-${Date.now()}`;
  const stop = policyService.createStop({
    runId,
    workspacePath: process.cwd(),
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
