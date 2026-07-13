import { resolve } from 'node:path';
import type { Tool } from '../tool-service';
import { formatSecurityTraces } from '../security-trace/format';
import { traceSecurityPaths } from '../security-trace/scanner';
import { isInsideWorkspace } from './tool-utils';

const toPositiveInteger = (value: unknown, fallback: number, max: number, min = 1) => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < min) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

export const securityPathTraceTool: Tool = {
  name: 'security_path_trace',
  description:
    'Traces security-relevant source-to-sink flows in TypeScript, JavaScript, and Electron code with scope guards, caps, confidence, evidence, findings, and patch suggestions.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Directory or file to trace, relative to workspace root. Defaults to ".".',
      },
      maxFiles: {
        type: 'number',
        description: 'Maximum code files to inspect. Defaults to 250.',
      },
      maxTraces: {
        type: 'number',
        description: 'Maximum traces to return. Defaults to 12.',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence hint for caller/UI filtering. Scanner support may vary. Defaults to 0.',
      },
      mode: {
        type: 'string',
        enum: ['summary', 'full'],
        description: 'Output verbosity. Defaults to full.',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope : '.';
    const resolvedScope = resolve(workspacePath, scope);
    const maxFiles = toPositiveInteger(args.maxFiles, 250, 1000, 10);
    const maxTraces = toPositiveInteger(args.maxTraces, 12, 50);
    const minConfidence = Math.max(0, Math.min(1, Number(args.minConfidence) || 0));
    const mode = args.mode === 'summary' ? 'summary' : 'full';

    if (!isInsideWorkspace(workspacePath, resolvedScope)) {
      return 'Refusing to trace outside the workspace.';
    }

    try {
      const traces = await traceSecurityPaths(workspacePath, { scope, maxFiles, maxTraces });
      const filteredTraces =
        minConfidence > 0
          ? traces.filter((trace) => typeof trace.confidence !== 'number' || trace.confidence >= minConfidence)
          : traces;
      const formatted = formatSecurityTraces(filteredTraces);

      if (mode === 'summary') {
        return [
          `Security path trace summary: ${filteredTraces.length} trace(s), scope=${scope}, maxFiles=${maxFiles}, maxTraces=${maxTraces}`,
          formatted.split('\n').slice(0, 40).join('\n'),
        ].join('\n');
      }

      return `Security path trace complete: ${filteredTraces.length} trace(s), scope=${scope}\n${formatted}`;
    } catch (error) {
      return `Error tracing security paths: ${(error as Error).message}`;
    }
  },
};
