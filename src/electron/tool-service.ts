import type OpenAI from "openai";
import type { FunctionTool as ResponsesFunctionTool } from "openai/resources/responses/responses";

import { rgTool } from "./tools/rg";
import { lsTool } from "./tools/ls";
import { readTool } from "./tools/read";
import { gitTool } from "./tools/git";
import { secretScanTool } from "./tools/secrets";
import { fileMetadataTool } from "./tools/metadata";
import { projectTreeTool } from "./tools/tree";
import { securityAuditTool } from "./tools/audit";
import { dependencyAnalyzerTool } from "./tools/deps";
import { networkMapTool } from "./tools/network";
import { sqlAuditTool } from "./tools/sql";
import { envSafetyTool } from "./tools/env_safety";
import { containerAuditTool } from "./tools/container";
import { flowTraceTool } from "./tools/flow";
import { entropyScannerTool } from "./tools/entropy";
import { accessControlAuditTool } from "./tools/auth";
import { securityReportTool } from "./tools/report";
import { astGrepTool } from "./tools/ast_grep";
import { gitForensicsTool } from "./tools/git_forensics";
import { threatModelTool } from "./tools/threat_model";
import { autoPatchTool } from "./tools/auto_patch";
import { dynamicFuzzerTool } from "./tools/fuzzer";
import { cveAuditTool } from "./tools/cve_audit";
import { mutationTesterTool } from "./tools/mutation";
import { sandboxRunnerTool } from "./tools/sandbox_run";
import { trafficPoisonerTool } from "./tools/traffic_poison";
import { mockPoisonerTool } from "./tools/mock_poison";
import { readManyTool } from "./tools/read_many";
import { jsonProbeTool } from "./tools/json_probe";
import { detectWorkspaceCapabilitiesTool } from "./tools/validation_profile";
import { runTestsTool } from "./tools/run_tests";
import { supermemoryTool } from "./tools/supermemory";
import { pdfReportTool } from "./tools/pdf_report";
import type { WorkspaceTrustContract } from "../contracts/workspace";
import type { AppSettings } from "../contracts/settings";
import { evaluateTrustForToolCall } from "./workspace-trust";

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (
    args: any,
    context: {
      workspacePath: string;
      trustContract?: WorkspaceTrustContract;
      settings: AppSettings;
    },
  ) => Promise<string>;
}

export class ToolService {
  private tools: Map<string, Tool> = new Map();
  private chatToolDefinitionsCache: OpenAI.Chat.Completions.ChatCompletionTool[] =
    [];
  private responsesToolDefinitionsCache: ResponsesFunctionTool[] = [];

  constructor() {
    this.registerTool(rgTool);
    this.registerTool(lsTool);
    this.registerTool(readTool);
    this.registerTool(gitTool);
    this.registerTool(secretScanTool);
    this.registerTool(fileMetadataTool);
    this.registerTool(projectTreeTool);
    this.registerTool(securityAuditTool);
    this.registerTool(dependencyAnalyzerTool);
    this.registerTool(networkMapTool);
    this.registerTool(sqlAuditTool);
    this.registerTool(envSafetyTool);
    this.registerTool(containerAuditTool);
    this.registerTool(flowTraceTool);
    this.registerTool(entropyScannerTool);
    this.registerTool(accessControlAuditTool);
    this.registerTool(securityReportTool);
    this.registerTool(astGrepTool);
    this.registerTool(gitForensicsTool);
    this.registerTool(threatModelTool);
    this.registerTool(autoPatchTool);
    this.registerTool(dynamicFuzzerTool);
    this.registerTool(cveAuditTool);
    this.registerTool(mutationTesterTool);
    this.registerTool(sandboxRunnerTool);
    this.registerTool(trafficPoisonerTool);
    this.registerTool(mockPoisonerTool);
    this.registerTool(readManyTool);
    this.registerTool(jsonProbeTool);
    this.registerTool(detectWorkspaceCapabilitiesTool);
    this.registerTool(runTestsTool);
    this.registerTool(supermemoryTool);
    this.registerTool(pdfReportTool);
    // Future tools can be registered here or dynamically loaded
  }

  registerTool(tool: Tool) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }

    this.tools.set(tool.name, tool);
    this.chatToolDefinitionsCache = [];
    this.responsesToolDefinitionsCache = [];
  }

  getChatToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    if (this.chatToolDefinitionsCache.length > 0) {
      return this.chatToolDefinitionsCache;
    }

    this.chatToolDefinitionsCache = Array.from(this.tools.values()).map(
      (tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: toStrictObjectSchema(tool.parameters),
        },
      }),
    );

    return this.chatToolDefinitionsCache;
  }

  getResponsesToolDefinitions(): ResponsesFunctionTool[] {
    if (this.responsesToolDefinitionsCache.length > 0) {
      return this.responsesToolDefinitionsCache;
    }

    this.responsesToolDefinitionsCache = Array.from(this.tools.values()).map(
      (tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: toStrictObjectSchema(tool.parameters),
        strict: true,
      }),
    );

    return this.responsesToolDefinitionsCache;
  }

  async callTool(
    name: string,
    args: any,
    context: {
      workspacePath: string;
      trustContract?: WorkspaceTrustContract;
      settings: AppSettings;
    },
  ): Promise<string> {
    const tool = this.tools.get(name);
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
      if (trustError) {
        return trustError;
      }
    }

    try {
      return await tool.execute(args, context);
    } catch (error) {
      return `Error executing tool "${name}": ${(error as Error).message}`;
    }
  }

  hasTools() {
    return this.tools.size > 0;
  }
}

export const toolService = new ToolService();

function toStrictObjectSchema(schema: Tool["parameters"]): Tool["parameters"] {
  const normalized = strictifySchemaNode(schema);
  return {
    ...normalized,
    type: "object",
    required: Array.isArray(normalized.required) ? normalized.required : [],
  };
}

function strictifySchemaNode(node: any): any {
  if (!node || typeof node !== "object") {
    return node;
  }

  if (node.type === "object") {
    const properties = Object.fromEntries(
      Object.entries(node.properties ?? {}).map(([key, value]) => [
        key,
        strictifySchemaNode(value),
      ]),
    );

    return {
      ...node,
      properties,
      additionalProperties: false,
      required: Array.isArray(node.required) ? node.required : [],
    };
  }

  if (node.type === "array" && node.items) {
    return {
      ...node,
      items: strictifySchemaNode(node.items),
    };
  }

  return node;
}

function validateToolArguments(tool: Tool, args: unknown): string | null {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return "Arguments must be a JSON object.";
  }

  const values = args as Record<string, unknown>;
  const schema = tool.parameters;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const key of required) {
    if (!(key in values)) {
      return `Missing required argument "${key}".`;
    }
  }

  for (const key of Object.keys(values)) {
    const propertySchema = properties[key] as any;
    if (!propertySchema) {
      return `Unexpected argument "${key}".`;
    }

    const error = validateValueAgainstSchema(values[key], propertySchema, key);
    if (error) {
      return error;
    }
  }

  return null;
}

function validateValueAgainstSchema(
  value: unknown,
  schema: any,
  keyPath: string,
): string | null {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `"${keyPath}" must be one of: ${schema.enum.join(", ")}.`;
  }

  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        return `"${keyPath}" must be a string.`;
      }
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `"${keyPath}" must be a finite number.`;
      }
      return null;
    case "boolean":
      if (typeof value !== "boolean") {
        return `"${keyPath}" must be a boolean.`;
      }
      return null;
    case "array":
      if (!Array.isArray(value)) {
        return `"${keyPath}" must be an array.`;
      }

      if (schema.items) {
        for (let index = 0; index < value.length; index += 1) {
          const childError = validateValueAgainstSchema(
            value[index],
            schema.items,
            `${keyPath}[${index}]`,
          );
          if (childError) {
            return childError;
          }
        }
      }

      return null;
    case "object":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `"${keyPath}" must be an object.`;
      }
      return null;
    default:
      return null;
  }
}
