/**
 * Static operational metadata for tools.
 *
 * Kept independent of tool module imports so discovery/timeout/retry decisions
 * do not require loading heavy tool implementations.
 */

export type ToolCategory =
  | 'read-only'
  | 'mutating'
  | 'destructive'
  | 'filesystem'
  | 'network'
  | 'process'
  | 'search'
  | 'analysis'
  | 'validation'
  | 'generation'
  | 'orchestration'
  | 'platform-specific';

export interface ToolOperationalMeta {
  /** Canonical tool name exposed to agents (tool.name). */
  name: string;
  /** Registry keys that resolve to this tool (includes aliases). */
  aliases?: string[];
  categories: ToolCategory[];
  /** Safe to retry without duplicating side effects. */
  idempotent: boolean;
  /** Transient failures may be retried automatically. */
  retryable: boolean;
  /** Supports cooperative cancellation via AbortSignal. */
  cancellable: boolean;
  /** Safe to run in parallel with other tools of the same kind. */
  parallelSafe: boolean;
  hasSideEffects: boolean;
  requiresVerification: boolean;
  /** Default execution timeout in ms (excluding grace). */
  timeoutMs: number;
  /** Prefer exclusive access to workspace resources when true. */
  exclusive?: boolean;
  /**
   * Max characters of tool output returned to the model (not evidence store).
   * Hard ceiling is still enforced by the agent runtime (80k).
   */
  modelOutputBudgetChars?: number;
}

/** Default model-facing output budgets by category. */
const DEFAULT_MODEL_OUTPUT_BUDGET_CHARS = 40_000;
const NOISY_MODEL_OUTPUT_BUDGET_CHARS = 16_000;
const SCAN_MODEL_OUTPUT_BUDGET_CHARS = 20_000;

const DEFAULT_READ_TIMEOUT_MS = 15_000;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 60_000;
const DEFAULT_NETWORK_TIMEOUT_MS = 45_000;
const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;
const DEFAULT_MUTATION_TIMEOUT_MS = 30_000;

/**
 * Metadata keyed by registry registration name AND canonical tool name.
 * Missing tools fall back to safe defaults via getToolOperationalMeta.
 */
const TOOL_META: Record<string, ToolOperationalMeta> = {
  rg: {
    name: 'rg',
    categories: ['read-only', 'search', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_READ_TIMEOUT_MS,
  },
  ls: {
    name: 'ls',
    categories: ['read-only', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 10_000,
  },
  read: {
    name: 'read',
    categories: ['read-only', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 10_000,
  },
  read_many: {
    name: 'read_many',
    categories: ['read-only', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 20_000,
  },
  git: {
    name: 'git_diag',
    aliases: ['git', 'git_diag'],
    categories: ['read-only', 'search'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 20_000,
  },
  git_diag: {
    name: 'git_diag',
    aliases: ['git', 'git_diag'],
    categories: ['read-only', 'search'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 20_000,
  },
  secrets: {
    name: 'secret_scan',
    aliases: ['secrets', 'secret_scan'],
    categories: ['read-only', 'analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  secret_scan: {
    name: 'secret_scan',
    aliases: ['secrets', 'secret_scan'],
    categories: ['read-only', 'analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  file_editor: {
    name: 'file_editor',
    categories: ['mutating', 'filesystem'],
    idempotent: false,
    retryable: false,
    cancellable: false,
    parallelSafe: false,
    hasSideEffects: true,
    requiresVerification: true,
    timeoutMs: DEFAULT_MUTATION_TIMEOUT_MS,
    exclusive: true,
  },
  auto_patch: {
    name: 'auto_patch',
    categories: ['mutating', 'filesystem'],
    idempotent: false,
    retryable: false,
    cancellable: false,
    parallelSafe: false,
    hasSideEffects: true,
    requiresVerification: true,
    timeoutMs: DEFAULT_MUTATION_TIMEOUT_MS,
    exclusive: true,
  },
  sandbox_run: {
    name: 'sandbox_run',
    categories: ['process', 'validation', 'mutating'],
    idempotent: false,
    retryable: false,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: true,
    requiresVerification: true,
    timeoutMs: 35_000,
    exclusive: true,
  },
  run_tests: {
    name: 'run_tests',
    categories: ['process', 'validation'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: false,
    requiresVerification: true,
    timeoutMs: 120_000,
  },
  browser_prober: {
    name: 'browser_prober',
    categories: ['network', 'analysis', 'process'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 90_000,
  },
  http_prober: {
    name: 'http_prober',
    categories: ['network', 'analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_NETWORK_TIMEOUT_MS,
  },
  deep_analysis_pipeline: {
    name: 'deep_analysis_pipeline',
    categories: ['analysis', 'orchestration'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 180_000,
  },
  attack_surface_scan: {
    name: 'attack_surface_scan',
    categories: ['analysis', 'search'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  security_path_trace: {
    name: 'security_path_trace',
    categories: ['analysis', 'search'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  semgrep_scan: {
    name: 'semgrep_scan',
    categories: ['analysis', 'process'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 120_000,
  },
  eslint_scan: {
    name: 'eslint_scan',
    categories: ['analysis', 'process'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 90_000,
  },
  local_network_recon: {
    name: 'local_network_recon',
    categories: ['network', 'analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_NETWORK_TIMEOUT_MS,
  },
  oob_listener: {
    name: 'oob_listener',
    categories: ['network', 'process'],
    idempotent: false,
    retryable: false,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: true,
    requiresVerification: false,
    timeoutMs: DEFAULT_NETWORK_TIMEOUT_MS,
  },
  pwd: {
    name: 'pwd',
    categories: ['read-only'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 2_000,
  },
  glob: {
    name: 'glob',
    categories: ['read-only', 'search', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_READ_TIMEOUT_MS,
  },
  find: {
    name: 'find',
    categories: ['read-only', 'search', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_READ_TIMEOUT_MS,
  },
  tree: {
    name: 'tree',
    categories: ['read-only', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 15_000,
  },
  du: {
    name: 'du',
    categories: ['read-only', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 20_000,
  },
  repo_graph: {
    name: 'repo_graph',
    categories: ['analysis', 'search'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  pdf_report: {
    name: 'pdf_security_report',
    aliases: ['pdf_report', 'pdf_security_report'],
    categories: ['generation'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: true,
    requiresVerification: true,
    timeoutMs: 60_000,
  },
  pdf_security_report: {
    name: 'pdf_security_report',
    aliases: ['pdf_report', 'pdf_security_report'],
    categories: ['generation'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: true,
    requiresVerification: true,
    timeoutMs: 60_000,
  },
  audit: {
    name: 'security_audit',
    aliases: ['audit', 'security_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  security_audit: {
    name: 'security_audit',
    aliases: ['audit', 'security_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  metadata: {
    name: 'file_metadata',
    aliases: ['metadata', 'file_metadata'],
    categories: ['read-only', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 10_000,
  },
  file_metadata: {
    name: 'file_metadata',
    aliases: ['metadata', 'file_metadata'],
    categories: ['read-only', 'filesystem'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 10_000,
  },
  deps: {
    name: 'dependency_check',
    aliases: ['deps', 'dependency_check'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  dependency_check: {
    name: 'dependency_check',
    aliases: ['deps', 'dependency_check'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  network: {
    name: 'network_map',
    aliases: ['network', 'network_map'],
    categories: ['analysis', 'network'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  network_map: {
    name: 'network_map',
    aliases: ['network', 'network_map'],
    categories: ['analysis', 'network'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  sql: {
    name: 'sql_audit',
    aliases: ['sql', 'sql_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  sql_audit: {
    name: 'sql_audit',
    aliases: ['sql', 'sql_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  env_safety: {
    name: 'env_audit',
    aliases: ['env_safety', 'env_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  env_audit: {
    name: 'env_audit',
    aliases: ['env_safety', 'env_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  container: {
    name: 'container_audit',
    aliases: ['container', 'container_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  container_audit: {
    name: 'container_audit',
    aliases: ['container', 'container_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  flow: {
    name: 'flow_trace',
    aliases: ['flow', 'flow_trace'],
    categories: ['analysis', 'search'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  flow_trace: {
    name: 'flow_trace',
    aliases: ['flow', 'flow_trace'],
    categories: ['analysis', 'search'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  entropy: {
    name: 'entropy_scan',
    aliases: ['entropy', 'entropy_scan'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  entropy_scan: {
    name: 'entropy_scan',
    aliases: ['entropy', 'entropy_scan'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  auth: {
    name: 'auth_audit',
    aliases: ['auth', 'auth_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  auth_audit: {
    name: 'auth_audit',
    aliases: ['auth', 'auth_audit'],
    categories: ['analysis'],
    idempotent: true,
    retryable: true,
    cancellable: true,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  },
  report: {
    name: 'security_report',
    aliases: ['report', 'security_report'],
    categories: ['generation'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 30_000,
  },
  security_report: {
    name: 'security_report',
    aliases: ['report', 'security_report'],
    categories: ['generation'],
    idempotent: true,
    retryable: true,
    cancellable: false,
    parallelSafe: true,
    hasSideEffects: false,
    requiresVerification: false,
    timeoutMs: 30_000,
  },
  fuzzer: {
    name: 'fuzzer',
    categories: ['process', 'analysis'],
    idempotent: false,
    retryable: false,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: true,
    requiresVerification: false,
    timeoutMs: DEFAULT_PROCESS_TIMEOUT_MS,
  },
  mutation: {
    name: 'mutation',
    categories: ['mutating', 'analysis'],
    idempotent: false,
    retryable: false,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: true,
    requiresVerification: true,
    timeoutMs: DEFAULT_PROCESS_TIMEOUT_MS,
    exclusive: true,
  },
  traffic_poison: {
    name: 'traffic_poison',
    categories: ['network', 'mutating'],
    idempotent: false,
    retryable: false,
    cancellable: true,
    parallelSafe: false,
    hasSideEffects: true,
    requiresVerification: false,
    timeoutMs: DEFAULT_NETWORK_TIMEOUT_MS,
  },
  mock_poison: {
    name: 'mock_poison',
    categories: ['mutating', 'filesystem'],
    idempotent: false,
    retryable: false,
    cancellable: false,
    parallelSafe: false,
    hasSideEffects: true,
    requiresVerification: true,
    timeoutMs: DEFAULT_MUTATION_TIMEOUT_MS,
    exclusive: true,
  },
};

const SAFE_DEFAULT_META: ToolOperationalMeta = {
  name: 'unknown',
  categories: ['read-only'],
  idempotent: true,
  retryable: false,
  cancellable: false,
  parallelSafe: true,
  hasSideEffects: false,
  requiresVerification: false,
  timeoutMs: 20_000,
};

export function getToolOperationalMeta(toolName: string): ToolOperationalMeta {
  const exact = TOOL_META[toolName];
  if (exact) {
    return exact;
  }

  // Fuzzy fallback for tools not yet explicitly catalogued.
  const lower = toolName.toLowerCase();
  if (
    lower.includes('patch') ||
    lower.includes('edit') ||
    lower.includes('write') ||
    lower.includes('mutation')
  ) {
    return {
      ...SAFE_DEFAULT_META,
      name: toolName,
      categories: ['mutating', 'filesystem'],
      idempotent: false,
      retryable: false,
      hasSideEffects: true,
      requiresVerification: true,
      parallelSafe: false,
      exclusive: true,
      timeoutMs: DEFAULT_MUTATION_TIMEOUT_MS,
    };
  }

  if (
    lower.includes('scan') ||
    lower.includes('audit') ||
    lower.includes('analysis') ||
    lower.includes('trace')
  ) {
    return {
      ...SAFE_DEFAULT_META,
      name: toolName,
      categories: ['analysis'],
      retryable: true,
      cancellable: true,
      timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
    };
  }

  if (
    lower.includes('network') ||
    lower.includes('http') ||
    lower.includes('browser') ||
    lower.includes('recon')
  ) {
    return {
      ...SAFE_DEFAULT_META,
      name: toolName,
      categories: ['network', 'analysis'],
      retryable: true,
      cancellable: true,
      timeoutMs: DEFAULT_NETWORK_TIMEOUT_MS,
    };
  }

  return { ...SAFE_DEFAULT_META, name: toolName };
}

/** Resolve timeout for a tool call, with special handling for sandbox_run. */
export function resolveToolTimeoutMs(
  toolName: string,
  args: Record<string, unknown> = {},
  graceMs = 5_000,
): number {
  if (toolName === 'sandbox_run') {
    const allowed = new Set([30, 45, 60, 120, 240]);
    const timeoutSeconds = Number(args.timeoutSeconds);
    if (!allowed.has(timeoutSeconds)) {
      return 30_000 + graceMs;
    }
    return timeoutSeconds * 1000 + graceMs;
  }

  const meta = getToolOperationalMeta(toolName);
  return meta.timeoutMs + graceMs;
}

export function listCataloguedToolNames(): string[] {
  return Object.keys(TOOL_META);
}

/**
 * Characters of tool output to feed back into the model.
 * Noisy scanners/search tools get a tighter budget to protect context.
 */
export function getToolModelOutputBudgetChars(toolName: string): number {
  const meta = getToolOperationalMeta(toolName);
  if (typeof meta.modelOutputBudgetChars === "number" && meta.modelOutputBudgetChars > 0) {
    return meta.modelOutputBudgetChars;
  }

  if (
    meta.categories.includes("search") ||
    toolName === "rg" ||
    toolName === "tree" ||
    toolName === "find" ||
    toolName === "glob" ||
    toolName === "ls"
  ) {
    return NOISY_MODEL_OUTPUT_BUDGET_CHARS;
  }

  if (
    meta.categories.includes("analysis") ||
    toolName.includes("scan") ||
    toolName.includes("audit") ||
    toolName.includes("fuzzer")
  ) {
    return SCAN_MODEL_OUTPUT_BUDGET_CHARS;
  }

  return DEFAULT_MODEL_OUTPUT_BUDGET_CHARS;
}

/** True when this tool must not run concurrent with other exclusive/non-parallel tools. */
export function isToolBatchExclusive(toolName: string): boolean {
  const meta = getToolOperationalMeta(toolName);
  return meta.exclusive === true || meta.parallelSafe === false;
}
