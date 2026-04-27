import { failureMemoryEngine } from '../failure-memory-engine';
import { tursoService } from '../turso-service';
import type { Tool } from '../tool-service';

export const findSimilarFailuresTool: Tool = {
  name: 'find_similar_failures',
  description:
    'Finds prior structured failures in this workspace before retrying validation, patching, or command execution. Use before rerunning a failed task to avoid repeated failed loops.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command about to run or retry.' },
      framework: { type: 'string', description: 'Detected framework or test runner.' },
      failingTests: {
        type: 'array',
        items: { type: 'string' },
        description: 'Known failing test names or failure lines.',
      },
      errorSignature: { type: 'string', description: 'Previously computed stable error signature.' },
      output: { type: 'string', description: 'Command output, validation output, or error text to match.' },
      stackTraceExcerpt: { type: 'string', description: 'Stack trace excerpt to match.' },
      limit: { type: 'number', description: 'Maximum matches to return.' },
    },
    required: [],
  },
  execute: async (args) => {
    const workspaceId = await tursoService.getActiveWorkspaceId();
    if (!workspaceId) {
      return JSON.stringify({ error: 'No active workspace ID found.' });
    }

    const matches = await failureMemoryEngine.findSimilarFailures({
      workspaceId,
      command: args.command,
      framework: args.framework,
      failingTests: args.failingTests,
      errorSignature: args.errorSignature,
      output: args.output,
      stackTraceExcerpt: args.stackTraceExcerpt,
      limit: args.limit,
    });

    return JSON.stringify({
      warning: matches.length > 0
        ? 'Similar failure exists in this workspace. Warn user before retrying; if repeated, change approach instead of looping.'
        : undefined,
      matches,
    }, null, 2);
  },
};

export const recordFailureTool: Tool = {
  name: 'record_failure',
  description:
    'Records structured failure knowledge for this workspace after validation, patch attempts, or command outputs fail.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Failed command or attempted action.' },
      exitCode: { type: 'number', description: 'Process exit code if available.' },
      framework: { type: 'string', description: 'Detected framework or test runner.' },
      failingTests: {
        type: 'array',
        items: { type: 'string' },
        description: 'Failing test names or failure lines.',
      },
      errorSignature: { type: 'string', description: 'Stable normalized signature if already computed.' },
      output: { type: 'string', description: 'Command output or error text.' },
      stackTraceExcerpt: { type: 'string', description: 'Stack trace excerpt.' },
      affectedFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files implicated by the failure.',
      },
      attemptedFix: { type: 'string', description: 'Patch or remediation attempted before this failure.' },
      retryFixed: { type: 'boolean', description: 'Whether retry fixed the failure.' },
    },
    required: ['command'],
  },
  execute: async (args) => {
    const workspaceId = await tursoService.getActiveWorkspaceId();
    if (!workspaceId) {
      return JSON.stringify({ error: 'No active workspace ID found.' });
    }

    const failure = await failureMemoryEngine.recordFailure({
      workspaceId,
      command: args.command,
      exitCode: args.exitCode,
      framework: args.framework,
      failingTests: args.failingTests,
      errorSignature: args.errorSignature,
      output: args.output,
      stackTraceExcerpt: args.stackTraceExcerpt,
      affectedFiles: args.affectedFiles,
      attemptedFix: args.attemptedFix,
      retryFixed: args.retryFixed,
    });

    return JSON.stringify({ failure }, null, 2);
  },
};

export const recordResolutionTool: Tool = {
  name: 'record_resolution',
  description:
    'Marks a known failure as resolved and stores whether retry fixed it. Use after a validation retry or patch clears a known failure.',
  parameters: {
    type: 'object',
    properties: {
      failureId: { type: 'string', description: 'Failure memory ID.' },
      errorSignature: { type: 'string', description: 'Stable failure signature when ID is unavailable.' },
      command: { type: 'string', description: 'Command associated with the resolved failure.' },
      attemptedFix: { type: 'string', description: 'Fix that resolved or failed to resolve the issue.' },
      retryFixed: { type: 'boolean', description: 'Whether retry fixed this failure.' },
    },
    required: ['retryFixed'],
  },
  execute: async (args) => {
    const workspaceId = await tursoService.getActiveWorkspaceId();
    if (!workspaceId) {
      return JSON.stringify({ error: 'No active workspace ID found.' });
    }

    const failure = await failureMemoryEngine.recordResolution({
      workspaceId,
      failureId: args.failureId,
      errorSignature: args.errorSignature,
      command: args.command,
      attemptedFix: args.attemptedFix,
      retryFixed: args.retryFixed,
    });

    return JSON.stringify({
      failure,
      status: failure ? 'recorded' : 'not_found',
    }, null, 2);
  },
};
