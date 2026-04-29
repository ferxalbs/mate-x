export type TraceConfidence = 'high' | 'medium' | 'low';

export type TraceNodeKind = 'source' | 'transform' | 'sink';

export interface TraceEvidence {
  file: string;
  line: number;
  snippet: string;
}

export interface TraceNode {
  kind: TraceNodeKind;
  label: string;
  evidence: TraceEvidence;
  symbols: string[];
}

export interface SecurityTrace {
  id: string;
  confidence: TraceConfidence;
  path: TraceNode[];
  patchSuggestion: string;
  finding: {
    title: string;
    severity: 'critical' | 'warning' | 'note';
    summary: string;
    file: string;
    recommendation: string;
  };
}

export interface TraceOptions {
  scope: string;
  maxFiles: number;
  maxTraces: number;
}

