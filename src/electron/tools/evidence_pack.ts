import type { Tool } from '../tool-service';

type Verdict = 'candidate_only' | 'trace_unproven' | 'confirmed_finding';

function inferVerdict(revalidation: string, trace: string): Verdict {
  const normalizedRevalidation = revalidation.toLowerCase();
  const normalizedTrace = trace.toLowerCase();

  if (
    normalizedTrace.includes('no precise security source-to-sink traces found') ||
    normalizedRevalidation.includes('likely_false_positive')
  ) {
    return 'candidate_only';
  }

  if (
    normalizedTrace.includes('source:') &&
    normalizedTrace.includes('sink:') &&
    !normalizedTrace.includes('no precise security source-to-sink traces found')
  ) {
    return 'confirmed_finding';
  }

  return 'trace_unproven';
}

function verdictLabel(verdict: Verdict) {
  if (verdict === 'confirmed_finding') return 'Confirmed finding';
  if (verdict === 'trace_unproven') return 'Unproven trace';
  return 'Candidate only';
}

function verdictRule(verdict: Verdict) {
  if (verdict === 'confirmed_finding') {
    return 'Source-to-sink path exists in tracer output. Finding language allowed, but still cite exact source, sink, and missing mitigation.';
  }
  if (verdict === 'trace_unproven') {
    return 'Candidate has not been proven exploitable. Do not call it vulnerability or finding.';
  }
  return 'Candidate remains unconfirmed. Treat as investigation target, not vulnerability or finding.';
}

export const evidencePackTool: Tool = {
  name: 'evidence_pack',
  description: 'Builds a strict security evidence pack from candidate scan, revalidation, and trace output. Enforces candidate vs finding wording.',
  parameters: {
    type: 'object',
    properties: {
      candidateSummary: {
        type: 'string',
        description: 'Relevant attack_surface_scan candidate text.',
      },
      revalidation: {
        type: 'string',
        description: 'candidate_revalidator output for this candidate.',
      },
      trace: {
        type: 'string',
        description: 'security_path_trace output for this candidate or scope.',
      },
      recommendation: {
        type: 'string',
        description: 'Optional fix or next action.',
      },
    },
    required: ['candidateSummary'],
  },
  async execute(args) {
    const candidateSummary = String(args.candidateSummary || '').trim();
    const revalidation = String(args.revalidation || '').trim();
    const trace = String(args.trace || '').trim();
    const recommendation = String(args.recommendation || '').trim();
    const verdict = inferVerdict(revalidation, trace);

    let report = 'Security Evidence Pack\n======================\n';
    report += `Verdict: ${verdictLabel(verdict)}\n`;
    report += `Language rule: ${verdictRule(verdict)}\n`;

    report += '\nCandidate\n---------\n';
    report += candidateSummary ? `${candidateSummary.slice(0, 2000)}\n` : 'No candidate summary provided.\n';

    report += '\nRevalidation\n------------\n';
    report += revalidation ? `${revalidation.slice(0, 3000)}\n` : 'No revalidation output provided.\n';

    report += '\nTrace\n-----\n';
    report += trace ? `${trace.slice(0, 3000)}\n` : 'No trace output provided.\n';

    report += '\nDecision\n--------\n';
    if (verdict === 'confirmed_finding') {
      report += '- Report as confirmed finding only with exact source, sink, exploit path, and missing/failed mitigation.\n';
    } else {
      report += '- Report as candidate only. Say no confirmed exploitability was proven.\n';
    }

    report += '\nFinal Answer Block\n------------------\n';
    if (verdict === 'confirmed_finding') {
      report += 'Verdict: Confirmed finding.\n';
      report += 'Use finding language only with cited source, sink, exploit path, and missing mitigation from the trace above.\n';
    } else {
      report += `Verdict: ${verdictLabel(verdict)}.\n`;
      report += 'No confirmed exploitability was proven. Treat this as an investigation candidate, not a vulnerability.\n';
    }

    report += '\nNext Action\n-----------\n';
    report += recommendation || (verdict === 'confirmed_finding'
      ? 'Patch vulnerable path and add regression validation.'
      : 'Inspect callers/imports or lower priority if no runtime path exists.');

    return report;
  },
};
