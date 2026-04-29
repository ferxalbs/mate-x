import type { Tool } from '../tool-service';
import { formatSecurityTraces } from '../security-trace/format';
import { traceSecurityPaths } from '../security-trace/scanner';

export const securityPathTraceTool: Tool = {
  name: 'security_path_trace',
  description:
    'Traces security-relevant source-to-sink flows in TypeScript, JavaScript, and Electron code. Produces precise source -> transform -> sink paths with confidence, evidence, findings, and patch suggestions.',
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
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope : '.';
    const maxFiles = Math.max(10, Math.min(1000, Number(args.maxFiles) || 250));
    const maxTraces = Math.max(1, Math.min(50, Number(args.maxTraces) || 12));

    try {
      const traces = await traceSecurityPaths(workspacePath, { scope, maxFiles, maxTraces });
      return formatSecurityTraces(traces);
    } catch (error) {
      return `Error tracing security paths: ${(error as Error).message}`;
    }
  },
};

