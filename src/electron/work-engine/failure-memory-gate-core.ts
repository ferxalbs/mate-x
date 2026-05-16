export interface FailureMemoryPromptMatch {
  command: string;
  status: string;
  signature: string;
  lastSeenAt: string;
}

export function renderFailureMemoryInstructionFromSummaries(matches: FailureMemoryPromptMatch[]) {
  if (matches.length === 0) {
    return "Failure Memory: no similar failure found before this run.";
  }

  return [
    "Failure Memory:",
    "Similar failure exists. Do not repeat same command or patch path unless new hypothesis is explicit.",
    ...matches.map(
      (match) => `- ${match.command} :: ${match.status} :: ${match.signature} :: ${match.lastSeenAt}`,
    ),
  ].join("\n");
}
