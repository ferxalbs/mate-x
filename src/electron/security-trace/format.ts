import type { SecurityTrace, TraceNode } from './types';

function formatSnippet(snippet: string) {
  return snippet.replace(/`/g, '\\`');
}

function formatNode(node: TraceNode) {
  return `- ${node.kind}: ${node.label}
  - ${node.evidence.file}:${node.evidence.line}
  - \`${formatSnippet(node.evidence.snippet)}\``;
}

export function formatSecurityTraces(traces: SecurityTrace[]) {
  if (traces.length === 0) {
    return 'No precise security source-to-sink traces found.';
  }

  return [
    'Security Path Trace Report',
    '==========================',
    ...traces.map((trace) => {
      const path = trace.path.map((node) => node.label).join(' -> ');
      return `
## [${trace.confidence.toUpperCase()}] ${trace.finding.title}

Path: ${path}
${trace.path.map(formatNode).join('\n\n')}

Trace summary: ${trace.finding.summary}

Patch suggestion: ${trace.patchSuggestion}`;
    }),
  ].join('\n');
}
