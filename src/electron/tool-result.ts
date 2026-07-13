/**
 * Structured tool result and error helpers.
 *
 * Tools still return strings for model consumption, but failures and structured
 * outcomes should follow a stable, machine-parseable contract so agents and the
 * runtime can detect success/failure without heuristics.
 */

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_OPERATION'
  | 'MISSING_RESOURCE'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'TRANSIENT_EXTERNAL_FAILURE'
  | 'PERMANENT_EXTERNAL_FAILURE'
  | 'VERIFICATION_FAILURE'
  | 'PARTIAL_EXECUTION'
  | 'INTERNAL_INVARIANT'
  | 'PLATFORM_INCOMPATIBLE'
  | 'RESOURCE_EXHAUSTED'
  | 'EXECUTION_ERROR';

export type ToolResultStatus = 'completed' | 'partial' | 'failed' | 'cancelled';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  mayHavePartialEffects: boolean;
  recommendedNextAction?: string;
  details?: Record<string, unknown>;
}

export interface ToolExecutionMeta {
  durationMs?: number;
  toolName?: string;
  verified?: boolean;
  truncated?: boolean;
}

export type StructuredToolResult<T = unknown> =
  | {
      ok: true;
      status: 'completed' | 'partial';
      data: T;
      warnings?: string[];
      meta?: ToolExecutionMeta;
    }
  | {
      ok: false;
      status: 'failed' | 'cancelled';
      error: ToolError;
      meta?: ToolExecutionMeta;
    };

const RETRYABLE_BY_DEFAULT: ReadonlySet<ToolErrorCode> = new Set([
  'RATE_LIMITED',
  'TIMEOUT',
  'DEPENDENCY_UNAVAILABLE',
  'TRANSIENT_EXTERNAL_FAILURE',
  'RESOURCE_EXHAUSTED',
]);

export function isRetryableErrorCode(code: ToolErrorCode): boolean {
  return RETRYABLE_BY_DEFAULT.has(code);
}

export function createToolError(
  code: ToolErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    mayHavePartialEffects?: boolean;
    recommendedNextAction?: string;
    details?: Record<string, unknown>;
  } = {},
): ToolError {
  return {
    code,
    message,
    retryable: options.retryable ?? isRetryableErrorCode(code),
    mayHavePartialEffects: options.mayHavePartialEffects ?? false,
    recommendedNextAction: options.recommendedNextAction,
    details: options.details,
  };
}

/** Format a structured failure for model + runtime consumption. */
export function formatToolFailure(error: ToolError, toolName?: string): string {
  const prefix = toolName ? `Error executing tool "${toolName}"` : 'Error';
  const lines = [
    `${prefix}: [${error.code}] ${error.message}`,
    `retryable=${error.retryable}`,
    `partial_effects=${error.mayHavePartialEffects}`,
  ];

  if (error.recommendedNextAction) {
    lines.push(`next: ${error.recommendedNextAction}`);
  }

  // Compact JSON trailer so isToolFailureOutput and parsers stay reliable.
  const trailer: Record<string, unknown> = {
    ok: false,
    status: 'failed',
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      mayHavePartialEffects: error.mayHavePartialEffects,
      ...(error.recommendedNextAction
        ? { recommendedNextAction: error.recommendedNextAction }
        : {}),
      ...(error.details ? { details: error.details } : {}),
    },
  };

  return `${lines.join('\n')}\n${JSON.stringify(trailer)}`;
}

export function formatToolSuccess<T>(
  data: T,
  options: {
    status?: 'completed' | 'partial';
    warnings?: string[];
    meta?: ToolExecutionMeta;
    textFallback?: string;
  } = {},
): string {
  const status = options.status ?? 'completed';
  const payload: StructuredToolResult<T> = {
    ok: true,
    status,
    data,
    ...(options.warnings && options.warnings.length > 0
      ? { warnings: options.warnings }
      : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  };

  if (options.textFallback) {
    return `${options.textFallback}\n${JSON.stringify(payload)}`;
  }

  return JSON.stringify(payload);
}

export function mapErrnoToToolError(
  error: unknown,
  context: { path?: string; operation?: string } = {},
): ToolError {
  const err = error as NodeJS.ErrnoException;
  const message = err?.message || String(error);
  const pathHint = context.path ? ` (${context.path})` : '';

  switch (err?.code) {
    case 'ENOENT':
      return createToolError(
        'MISSING_RESOURCE',
        `Resource not found${pathHint}: ${message}`,
        {
          retryable: false,
          recommendedNextAction:
            'Verify the path with ls, rg, or glob before retrying.',
        },
      );
    case 'EACCES':
    case 'EPERM':
      return createToolError(
        'FORBIDDEN',
        `Permission denied${pathHint}: ${message}`,
        { retryable: false },
      );
    case 'EEXIST':
      return createToolError(
        'CONFLICT',
        `Resource already exists${pathHint}: ${message}`,
        { retryable: false },
      );
    case 'ENOSPC':
      return createToolError(
        'RESOURCE_EXHAUSTED',
        `Storage exhausted${pathHint}: ${message}`,
        { retryable: true },
      );
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return createToolError('TIMEOUT', `Operation timed out: ${message}`, {
        retryable: true,
        mayHavePartialEffects: true,
      });
    default:
      return createToolError(
        'EXECUTION_ERROR',
        context.operation
          ? `${context.operation} failed: ${message}`
          : message,
        { retryable: false, mayHavePartialEffects: true },
      );
  }
}

/**
 * Detect whether a tool output string indicates failure.
 * Prefer structured JSON markers; fall back to stable textual prefixes.
 */
export function isStructuredToolFailureOutput(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) {
    return false;
  }

  // Structured JSON result (full body or trailer line)
  const jsonCandidate = extractTrailingJsonObject(trimmed);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
      if (parsed.ok === false) {
        return true;
      }
      if (parsed.ok === true) {
        return false;
      }
      if (
        parsed.status === 'failed' ||
        parsed.status === 'error' ||
        parsed.status === 'cancelled'
      ) {
        return true;
      }
      if (parsed.fatal === true) {
        return true;
      }
    } catch {
      // fall through to textual heuristics
    }
  }

  return /^(?:Error\b|Tool .+ failed\b|Invalid arguments\b|Workspace Trust Contract blocks\b|Policy stop\b|File not found\b|Path must remain\b|Timed? ?out\b|Cancelled\b|Canceled\b)/i.test(
    trimmed,
  );
}

function extractTrailingJsonObject(text: string): string | null {
  if (text.startsWith('{') && text.endsWith('}')) {
    return text;
  }

  const lastBrace = text.lastIndexOf('\n{');
  if (lastBrace >= 0) {
    const candidate = text.slice(lastBrace + 1).trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      return candidate;
    }
  }

  return null;
}

/** Shorthand failure for tool bodies. */
export function failTool(
  toolName: string,
  message: string,
  code: ToolErrorCode = 'EXECUTION_ERROR',
  options: {
    retryable?: boolean;
    mayHavePartialEffects?: boolean;
    recommendedNextAction?: string;
    details?: Record<string, unknown>;
  } = {},
): string {
  return formatToolFailure(createToolError(code, message, options), toolName);
}

/** Return a structured cancellation failure when the signal is aborted. */
export function cancelledTool(
  toolName: string,
  message = 'Tool execution was cancelled.',
): string {
  return formatToolFailure(
    createToolError('CANCELLED', message, {
      retryable: false,
      mayHavePartialEffects: true,
    }),
    toolName,
  );
}

export function throwIfAborted(signal: AbortSignal | undefined, toolName: string): void {
  if (signal?.aborted) {
    const error = new Error(`Tool "${toolName}" was cancelled.`);
    error.name = 'AbortError';
    throw error;
  }
}

/**
 * Run a tool body with abort + structured error normalization.
 * Prefer this in execute() so catch blocks always produce structured failures.
 */
export async function runToolBody(
  toolName: string,
  signal: AbortSignal | undefined,
  body: () => Promise<string>,
): Promise<string> {
  try {
    throwIfAborted(signal, toolName);
    const result = await body();
    throwIfAborted(signal, toolName);
    return ensureStructuredToolOutput(result, toolName);
  } catch (error) {
    if (signal?.aborted || (error as Error)?.name === 'AbortError') {
      return cancelledTool(toolName);
    }
    return formatToolFailure(mapErrnoToToolError(error, { operation: toolName }), toolName);
  }
}

/**
 * Normalize legacy free-form error strings into structured failures.
 * Success payloads and already-structured results pass through unchanged.
 */
export function ensureStructuredToolOutput(output: string, toolName: string): string {
  if (typeof output !== 'string') {
    return formatToolFailure(
      createToolError('INTERNAL_INVARIANT', 'Tool returned a non-string result.'),
      toolName,
    );
  }

  const trimmed = output.trim();
  if (!trimmed) {
    return output;
  }

  // Already structured (success or failure trailer / full JSON)
  const jsonCandidate = extractTrailingJsonObject(trimmed);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
      if (typeof parsed.ok === 'boolean') {
        return output;
      }
    } catch {
      // continue
    }
  }

  // Legacy error-shaped free text → structured failure (preserve original message).
  if (
    /^(?:Error\b|Tool .+ failed\b|Invalid arguments\b|Workspace Trust Contract blocks\b|Policy stop\b|File not found\b|Path must remain\b|Timed? ?out\b|Cancelled\b|Canceled\b)/i.test(
      trimmed,
    )
  ) {
    const message = trimmed
      .replace(/^Error executing tool "[^"]+":\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .replace(/^Error\s+/i, '');

    let code: ToolErrorCode = 'EXECUTION_ERROR';
    if (/not found|ENOENT/i.test(message)) code = 'MISSING_RESOURCE';
    else if (/permission|forbidden|EACCES|EPERM|Path must remain/i.test(message))
      code = 'FORBIDDEN';
    else if (/invalid|required|must be/i.test(message)) code = 'INVALID_INPUT';
    else if (/timeout|timed out/i.test(message)) code = 'TIMEOUT';
    else if (/cancel/i.test(message)) code = 'CANCELLED';
    else if (/rate limit/i.test(message)) code = 'RATE_LIMITED';

    // Avoid double-wrapping if already structured by formatToolFailure text form.
    if (trimmed.includes('"ok":false') || trimmed.includes('"ok": false')) {
      return output;
    }

    return formatToolFailure(createToolError(code, message), toolName);
  }

  return output;
}
