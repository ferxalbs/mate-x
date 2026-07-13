import type { AppSettings } from "../contracts/settings";
import type { WorkspaceTrustContract } from "../contracts/workspace";
import type { ToolOperationalMeta } from "./tool-metadata";

export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  // Index signature keeps OpenAI FunctionParameters assignable.
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  /**
   * Optional operational metadata. When omitted, the static catalog in
   * tool-metadata.ts is used by name.
   */
  meta?: Partial<ToolOperationalMeta>;
  execute: (
    args: any,
    context: ToolExecutionContext,
  ) => Promise<string>;
}

export interface ToolExecutionContext {
  workspacePath: string;
  trustContract?: WorkspaceTrustContract;
  settings: AppSettings;
  /** Cooperative cancellation for long-running tools. */
  signal?: AbortSignal;
  /** Optional run id for correlation / metrics. */
  runId?: string;
}

export type ToolLoader = () => Promise<Tool>;

export interface ToolPerfSample {
  toolName: string;
  phase: "load" | "validate" | "execute" | "total";
  durationMs: number;
  ok: boolean;
  at: number;
}
