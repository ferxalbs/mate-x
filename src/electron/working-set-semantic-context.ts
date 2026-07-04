import type { WorkingSet, WorkingSetFile } from "../contracts/working-set";

export function buildSemanticContext(input: {
  prompt: string;
  fileKeys: Set<string>;
  gitState: string[];
  primaryFiles: WorkingSetFile[];
}): WorkingSet["semanticContext"] {
  const files = [...input.fileKeys];
  const changed = input.gitState.map((line) => normalizePath(line.replace(/^[ MADRCU?!]{2}\s+/, ""))).filter(Boolean);
  const ranked = input.primaryFiles.map((file) => file.path);
  const evidence = new Set([...changed, ...ranked, ...files.slice(0, 80)]);
  const lowerPrompt = input.prompt.toLowerCase();
  const runtimeSurfaces = collectSignals(evidence, [
    [/app\/api\/|pages\/api\/|routes?\//, "HTTP/API routes"],
    [/middleware|guard|auth/i, "auth/middleware"],
    [/electron\/|preload|ipc/i, "Electron main/preload IPC"],
    [/schema|model|db|sql|prisma|drizzle/i, "data access"],
    [/package\.json|bun\.lock|package-lock|pnpm-lock|yarn\.lock/i, "dependency manifest"],
  ]);
  const trustBoundaries = collectSignals(evidence, [
    [/ipc|preload|contextBridge/i, "renderer to main process"],
    [/fetch|axios|http|webhook|callback/i, "network input/output"],
    [/env|secret|token|credential|api[-_]?key/i, "secret/config boundary"],
    [/upload|file|path|fs\./i, "filesystem/user file boundary"],
    [/auth|session|jwt|oauth|cookie/i, "identity/session boundary"],
  ]);
  const sourceRoles = collectSignals(evidence, [
    [/(\.test|\.spec)\.[tj]sx?$|__tests__\//, "tests excluded from active findings unless they prove runtime behavior"],
    [/docs?\/|README|CHANGELOG|RULES/i, "docs/reference only"],
    [/fixtures?\/|examples?\//, "fixtures/examples reference only"],
    [/src\//, "runtime source"],
  ]);
  const dependencySignals = collectSignals(evidence, [
    [/package\.json|bun\.lock|package-lock|pnpm-lock|yarn\.lock/i, "dependency/SCA check available"],
    [/Dockerfile|compose|kubernetes|helm/i, "container/config posture check available"],
  ]);
  const excludedNoise = [
    "Generated, fixture, docs, and test-only signals stay reference-only unless mapped to runtime code.",
    lowerPrompt.includes("audit") || lowerPrompt.includes("security")
      ? "Security output must separate exploitable runtime findings from scanner/test artifacts."
      : "No broad audit requested; keep working set scoped to objective.",
  ];

  return {
    runtimeSurfaces: fallbackSignals(runtimeSurfaces, "runtime surface not yet classified"),
    trustBoundaries: fallbackSignals(trustBoundaries, "trust boundary not yet classified"),
    sourceRoles: fallbackSignals(sourceRoles, "source role classification pending repo graph refresh"),
    dependencySignals: fallbackSignals(dependencySignals, "no dependency manifest signal in working set"),
    excludedNoise,
  };
}

function normalizePath(file: string) {
  return file.trim().replace(/\\/g, "/").replace(/^"|"$/g, "");
}

function collectSignals(files: Set<string>, patterns: [RegExp, string][]) {
  const signals = new Set<string>();
  for (const file of files) {
    for (const [pattern, label] of patterns) {
      if (pattern.test(file)) {
        signals.add(label);
      }
    }
  }
  return [...signals].slice(0, 5);
}

function fallbackSignals(signals: string[], fallback: string) {
  return signals.length ? signals : [fallback];
}
