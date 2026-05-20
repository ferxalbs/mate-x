import type OpenAI from "openai";
import type { FunctionTool as ResponsesFunctionTool } from "openai/resources/responses/responses";

import { evaluateTrustForToolCall } from "./workspace-trust";
import { policyService } from "./policy-service";
import { buildGovernedToolDescription } from "./tool-policy-description";
import { lazyToolLoaders } from "./tool-registry";
import { toStrictObjectSchema, validateToolArguments } from "./tool-schema";
import type { Tool, ToolExecutionContext, ToolLoader } from "./tool-types";

export type { Tool, ToolExecutionContext } from "./tool-types";

export class ToolService {
  private loaders: Map<string, ToolLoader> = new Map();
  private loadedTools: Map<string, Tool> = new Map();
  private loadingTools: Map<string, Promise<Tool>> = new Map();
  private governedDescriptionCache: Map<string, string> = new Map();
  private chatToolDefinitionsCache: OpenAI.Chat.Completions.ChatCompletionTool[] =
    [];
  private chatToolDefinitionsPromise: Promise<
    OpenAI.Chat.Completions.ChatCompletionTool[]
  > | null = null;
  private responsesToolDefinitionsCache: ResponsesFunctionTool[] = [];
  private responsesToolDefinitionsPromise: Promise<ResponsesFunctionTool[]> | null =
    null;

  constructor() {
    for (const [name, loader] of lazyToolLoaders) {
      this.registerLazyTool(name, loader);
    }
  }

  registerTool(tool: Tool) {
    if (this.loadedTools.has(tool.name) || this.loaders.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }

    this.loadedTools.set(tool.name, tool);
    this.chatToolDefinitionsCache = [];
    this.chatToolDefinitionsPromise = null;
    this.responsesToolDefinitionsCache = [];
    this.responsesToolDefinitionsPromise = null;
    this.governedDescriptionCache.delete(tool.name);
  }

  registerLazyTool(name: string, loader: ToolLoader) {
    if (this.loadedTools.has(name) || this.loaders.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }

    this.loaders.set(name, loader);
    this.chatToolDefinitionsCache = [];
    this.chatToolDefinitionsPromise = null;
    this.responsesToolDefinitionsCache = [];
    this.responsesToolDefinitionsPromise = null;
    this.governedDescriptionCache.delete(name);
  }

  async getTool(name: string): Promise<Tool> {
    const loaded = this.loadedTools.get(name);
    if (loaded) {
      return loaded;
    }

    const loader = this.loaders.get(name);
    if (!loader) {
      throw new Error(`Tool "${name}" not found.`);
    }

    const loading = this.loadingTools.get(name);
    if (loading) {
      return loading;
    }

    const load = loader()
      .then((tool) => {
        this.loadedTools.set(name, tool);
        return tool;
      })
      .finally(() => {
        this.loadingTools.delete(name);
      });
    this.loadingTools.set(name, load);
    return load;
  }

  async getChatToolDefinitions(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
    if (this.chatToolDefinitionsCache.length > 0) {
      return this.chatToolDefinitionsCache;
    }

    if (!this.chatToolDefinitionsPromise) {
      this.chatToolDefinitionsPromise = this.getAllTools()
        .then((allTools) =>
          allTools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: this.getGovernedToolDescription(tool),
              parameters: toStrictObjectSchema(tool.parameters),
            },
          })),
        )
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
        .then((allTools) =>
          allTools.map((tool) => ({
            type: "function" as const,
            name: tool.name,
            description: this.getGovernedToolDescription(tool),
            parameters: toStrictObjectSchema(tool.parameters),
            strict: true,
          })),
        )
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
    const tool = await this.getTool(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found.`);
    }

    const validationError = validateToolArguments(tool, args);
    if (validationError) {
      return `Invalid arguments for "${name}": ${validationError}`;
    }

    if (context.trustContract) {
      const trustError = evaluateTrustForToolCall({
        toolName: name,
        args,
        contract: context.trustContract,
      });
      const approvedOnce = policyService.isApprovedToolCall({
        workspacePath: context.workspacePath,
        toolName: name,
        args,
      });
      if (trustError && !approvedOnce) {
        return trustError;
      }
      if (trustError) {
        policyService.consumeApprovedToolCall({
          workspacePath: context.workspacePath,
          toolName: name,
          args,
        });
      }
    }

    try {
      return await tool.execute(args, context);
    } catch (error) {
      return `Error executing tool "${name}": ${(error as Error).message}`;
    }
  }

  hasTools() {
    return this.loadedTools.size > 0 || this.loaders.size > 0;
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
    const loadedTools = Array.from(this.loadedTools.values());
    const unloadedNames = Array.from(this.loaders.keys()).filter(
      (name) => !this.loadedTools.has(name),
    );
    const tools = await Promise.all(unloadedNames.map((name) => this.getTool(name)));

    return [...loadedTools, ...tools].filter(
      (tool, index, self) => self.findIndex((t) => t.name === tool.name) === index,
    );
  }
}

export const toolService = new ToolService();
