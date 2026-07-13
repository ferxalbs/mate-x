import type OpenAI from "openai";
import type { FunctionTool as ResponsesFunctionTool } from "openai/resources/responses/responses";

import { evaluateTrustForToolCall } from "./workspace-trust";
import { policyService } from "./policy-service";
import { buildGovernedToolDescription } from "./tool-policy-description";
import { lazyToolLoaders } from "./tool-registry";
import { toStrictObjectSchema, validateToolArguments } from "./tool-schema";
import {
  createToolError,
  formatToolFailure,
} from "./tool-result";
import type {
  Tool,
  ToolExecutionContext,
  ToolLoader,
  ToolPerfSample,
} from "./tool-types";

export type { Tool, ToolExecutionContext } from "./tool-types";

const PERF_ENABLED = process.env.MATE_X_TOOL_PERF === "1";
const MAX_PERF_SAMPLES = 500;

export class ToolService {
  private loaders: Map<string, ToolLoader> = new Map();
  private loadedTools: Map<string, Tool> = new Map();
  private loadingTools: Map<string, Promise<Tool>> = new Map();
  /** Canonical tool.name -> registry key(s) that load it. */
  private nameIndex: Map<string, string> = new Map();
  private governedDescriptionCache: Map<string, string> = new Map();
  private chatToolDefinitionsCache: OpenAI.Chat.Completions.ChatCompletionTool[] =
    [];
  private chatToolDefinitionsPromise: Promise<
    OpenAI.Chat.Completions.ChatCompletionTool[]
  > | null = null;
  private responsesToolDefinitionsCache: ResponsesFunctionTool[] = [];
  private responsesToolDefinitionsPromise: Promise<ResponsesFunctionTool[]> | null =
    null;
  private perfSamples: ToolPerfSample[] = [];

  constructor() {
    for (const [name, loader] of lazyToolLoaders) {
      this.registerLazyTool(name, loader);
    }
  }

  registerTool(tool: Tool) {
    if (this.loadedTools.has(tool.name) || this.loaders.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }

    this.cacheLoadedTool(tool.name, tool);
    this.invalidateDefinitionCaches(tool.name);
  }

  registerLazyTool(name: string, loader: ToolLoader) {
    if (this.loadedTools.has(name) || this.loaders.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }

    this.loaders.set(name, loader);
    this.invalidateDefinitionCaches(name);
  }

  /**
   * Resolve a tool by registry key or canonical tool.name.
   * This fixes the historical mismatch where definitions expose tool.name
   * (e.g. git_diag) but loaders were only keyed by short aliases (e.g. git).
   */
  async getTool(name: string): Promise<Tool> {
    const loaded = this.loadedTools.get(name);
    if (loaded) {
      return loaded;
    }

    const loader = this.loaders.get(name);
    if (loader) {
      return this.loadViaLoader(name, loader);
    }

    // Resolve via reverse index built during prior loads.
    const indexedRegistryKey = this.nameIndex.get(name);
    if (indexedRegistryKey) {
      const byIndex = this.loadedTools.get(indexedRegistryKey);
      if (byIndex) {
        this.loadedTools.set(name, byIndex);
        return byIndex;
      }
      const indexLoader = this.loaders.get(indexedRegistryKey);
      if (indexLoader) {
        return this.loadViaLoader(indexedRegistryKey, indexLoader);
      }
    }

    // Do not eagerly load every tool on a miss — that is a cold-start latency trap.
    // Canonical names must be registered as loader keys (see tool-registry aliases).
    throw new Error(
      `Tool "${name}" not found. Use an exact name from the tool definition list.`,
    );
  }

  async getChatToolDefinitions(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
    if (this.chatToolDefinitionsCache.length > 0) {
      return this.chatToolDefinitionsCache;
    }

    if (!this.chatToolDefinitionsPromise) {
      this.chatToolDefinitionsPromise = this.getAllTools()
        .then((allTools) => {
          const definitions: OpenAI.Chat.Completions.ChatCompletionTool[] =
            allTools.map((tool) => ({
              type: "function" as const,
              function: {
                name: tool.name,
                description: this.getGovernedToolDescription(tool),
                parameters: toStrictObjectSchema(tool.parameters) as Record<
                  string,
                  unknown
                >,
              },
            }));
          return definitions;
        })
        .then((definitions) => {
          this.chatToolDefinitionsCache = definitions;
          return definitions;
        })
        .finally(() => {
          this.chatToolDefinitionsPromise = null;
        });
    }

    return this.chatToolDefinitionsPromise;
  }

  async getResponsesToolDefinitions(): Promise<ResponsesFunctionTool[]> {
    if (this.responsesToolDefinitionsCache.length > 0) {
      return this.responsesToolDefinitionsCache;
    }

    if (!this.responsesToolDefinitionsPromise) {
      this.responsesToolDefinitionsPromise = this.getAllTools()
        .then((allTools) => {
          const definitions: ResponsesFunctionTool[] = allTools.map((tool) => ({
            type: "function" as const,
            name: tool.name,
            description: this.getGovernedToolDescription(tool),
            parameters: toStrictObjectSchema(tool.parameters) as {
              [key: string]: unknown;
            },
            strict: true,
          }));
          return definitions;
        })
        .then((definitions) => {
          this.responsesToolDefinitionsCache = definitions;
          return definitions;
        })
        .finally(() => {
          this.responsesToolDefinitionsPromise = null;
        });
    }

    return this.responsesToolDefinitionsPromise;
  }

  async callTool(
    name: string,
    args: any,
    context: ToolExecutionContext,
  ): Promise<string> {
    const totalStart = PERF_ENABLED ? performance.now() : 0;

    if (context.signal?.aborted) {
      return formatToolFailure(
        createToolError("CANCELLED", "Tool call aborted before execution.", {
          retryable: false,
        }),
        name,
      );
    }

    let tool: Tool;
    try {
      const loadStart = PERF_ENABLED ? performance.now() : 0;
      tool = await this.getTool(name);
      if (PERF_ENABLED) {
        this.recordPerf({
          toolName: name,
          phase: "load",
          durationMs: performance.now() - loadStart,
          ok: true,
          at: Date.now(),
        });
      }
    } catch (error) {
      return formatToolFailure(
        createToolError(
          "MISSING_RESOURCE",
          error instanceof Error ? error.message : `Tool "${name}" not found.`,
          {
            retryable: false,
            recommendedNextAction:
              "Call get available tools / use an exact tool name from the tool list.",
          },
        ),
        name,
      );
    }

    const validateStart = PERF_ENABLED ? performance.now() : 0;
    const validationError = validateToolArguments(tool, args);
    if (PERF_ENABLED) {
      this.recordPerf({
        toolName: name,
        phase: "validate",
        durationMs: performance.now() - validateStart,
        ok: !validationError,
        at: Date.now(),
      });
    }

    if (validationError) {
      return formatToolFailure(
        createToolError("INVALID_INPUT", validationError, {
          retryable: false,
          recommendedNextAction:
            "Fix argument types/required fields and retry with a valid payload.",
        }),
        tool.name,
      );
    }

    if (context.trustContract) {
      const trustError = evaluateTrustForToolCall({
        toolName: tool.name,
        args,
        contract: context.trustContract,
      });
      const approvedOnce = policyService.isApprovedToolCall({
        workspacePath: context.workspacePath,
        toolName: tool.name,
        args,
      });
      // Also accept approvals keyed by the caller's alias name.
      const approvedByAlias =
        name !== tool.name &&
        policyService.isApprovedToolCall({
          workspacePath: context.workspacePath,
          toolName: name,
          args,
        });

      if (trustError && !approvedOnce && !approvedByAlias) {
        return formatToolFailure(
          createToolError("FORBIDDEN", trustError, {
            retryable: false,
            recommendedNextAction:
              "Request approval or use a safer tool permitted by the Workspace Trust Contract.",
          }),
          tool.name,
        );
      }
      if (trustError) {
        policyService.consumeApprovedToolCall({
          workspacePath: context.workspacePath,
          toolName: approvedOnce ? tool.name : name,
          args,
        });
      }
    }

    try {
      if (context.signal?.aborted) {
        return formatToolFailure(
          createToolError("CANCELLED", "Tool call aborted before execution.", {
            retryable: false,
          }),
          tool.name,
        );
      }

      const executeStart = PERF_ENABLED ? performance.now() : 0;
      const result = await tool.execute(args, context);
      if (PERF_ENABLED) {
        this.recordPerf({
          toolName: tool.name,
          phase: "execute",
          durationMs: performance.now() - executeStart,
          ok: true,
          at: Date.now(),
        });
        this.recordPerf({
          toolName: tool.name,
          phase: "total",
          durationMs: performance.now() - totalStart,
          ok: true,
          at: Date.now(),
        });
      }
      return result;
    } catch (error) {
      if (PERF_ENABLED) {
        this.recordPerf({
          toolName: tool.name,
          phase: "total",
          durationMs: performance.now() - totalStart,
          ok: false,
          at: Date.now(),
        });
      }

      if (context.signal?.aborted || isAbortError(error)) {
        return formatToolFailure(
          createToolError("CANCELLED", "Tool execution was cancelled.", {
            retryable: false,
            mayHavePartialEffects: true,
          }),
          tool.name,
        );
      }

      return formatToolFailure(
        createToolError(
          "EXECUTION_ERROR",
          error instanceof Error ? error.message : String(error),
          {
            retryable: false,
            mayHavePartialEffects: true,
          },
        ),
        tool.name,
      );
    }
  }

  hasTools() {
    return this.loadedTools.size > 0 || this.loaders.size > 0;
  }

  /** Number of registered loaders + already-loaded tools (unique registry keys). */
  getRegisteredCount(): number {
    const keys = new Set<string>([
      ...this.loaders.keys(),
      ...this.loadedTools.keys(),
    ]);
    return keys.size;
  }

  getLoadedCount(): number {
    // Count unique tool instances by canonical name.
    const names = new Set<string>();
    for (const tool of this.loadedTools.values()) {
      names.add(tool.name);
    }
    return names.size;
  }

  getPerfSamples(): readonly ToolPerfSample[] {
    return this.perfSamples;
  }

  clearPerfSamples() {
    this.perfSamples = [];
  }

  private async loadViaLoader(registryKey: string, loader: ToolLoader): Promise<Tool> {
    const existing = this.loadedTools.get(registryKey);
    if (existing) {
      return existing;
    }

    const loading = this.loadingTools.get(registryKey);
    if (loading) {
      return loading;
    }

    const load = loader()
      .then((tool) => {
        this.cacheLoadedTool(registryKey, tool);
        return tool;
      })
      .finally(() => {
        this.loadingTools.delete(registryKey);
      });
    this.loadingTools.set(registryKey, load);
    return load;
  }

  private cacheLoadedTool(registryKey: string, tool: Tool) {
    this.loadedTools.set(registryKey, tool);
    // Index by canonical name so agent calls using tool.name resolve.
    this.loadedTools.set(tool.name, tool);
    this.nameIndex.set(tool.name, registryKey);
    if (registryKey !== tool.name) {
      this.nameIndex.set(registryKey, registryKey);
    }
  }

  private invalidateDefinitionCaches(toolName?: string) {
    this.chatToolDefinitionsCache = [];
    this.chatToolDefinitionsPromise = null;
    this.responsesToolDefinitionsCache = [];
    this.responsesToolDefinitionsPromise = null;
    if (toolName) {
      this.governedDescriptionCache.delete(toolName);
    } else {
      this.governedDescriptionCache.clear();
    }
  }

  private getGovernedToolDescription(tool: Tool) {
    const cached = this.governedDescriptionCache.get(tool.name);
    if (cached) {
      return cached;
    }

    const description = buildGovernedToolDescription(tool);
    this.governedDescriptionCache.set(tool.name, description);
    return description;
  }

  private async getAllTools(): Promise<Tool[]> {
    const unloadedNames = Array.from(this.loaders.keys()).filter(
      (name) => !this.loadedTools.has(name),
    );
    await Promise.all(
      unloadedNames.map((name) =>
        this.getTool(name).catch(() => {
          // Keep definition set resilient when optional tools fail to load.
          return null;
        }),
      ),
    );

    const byCanonicalName = new Map<string, Tool>();
    for (const tool of this.loadedTools.values()) {
      byCanonicalName.set(tool.name, tool);
    }
    return Array.from(byCanonicalName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  private recordPerf(sample: ToolPerfSample) {
    this.perfSamples.push(sample);
    if (this.perfSamples.length > MAX_PERF_SAMPLES) {
      this.perfSamples.splice(0, this.perfSamples.length - MAX_PERF_SAMPLES);
    }
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = (error as { name?: string }).name;
  return name === "AbortError";
}

export const toolService = new ToolService();
