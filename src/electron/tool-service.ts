import type OpenAI from "openai";
import type { FunctionTool as ResponsesFunctionTool } from "openai/resources/responses/responses";

import type { WorkspaceTrustContract } from "../contracts/workspace";
import type { AppSettings } from "../contracts/settings";
import { evaluateTrustForToolCall } from "./workspace-trust";
import { policyService } from "./policy-service";

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
  private loaders: Map<string, () => Promise<Tool>> = new Map();
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
    this.registerLazyTool("rg", () => import("./tools/rg").then((m) => m.rgTool));
    this.registerLazyTool("ls", () => import("./tools/ls").then((m) => m.lsTool));
    this.registerLazyTool("read", () => import("./tools/read").then((m) => m.readTool));
    this.registerLazyTool("git", () => import("./tools/git").then((m) => m.gitTool));
    this.registerLazyTool("secrets", () => import("./tools/secrets").then((m) => m.secretScanTool));
    this.registerLazyTool("metadata", () => import("./tools/metadata").then((m) => m.fileMetadataTool));
    this.registerLazyTool("tree", () => import("./tools/tree").then((m) => m.projectTreeTool));
    this.registerLazyTool("audit", () => import("./tools/audit").then((m) => m.securityAuditTool));
    this.registerLazyTool("deps", () => import("./tools/deps").then((m) => m.dependencyAnalyzerTool));
    this.registerLazyTool("network", () => import("./tools/network").then((m) => m.networkMapTool));
    this.registerLazyTool("sql", () => import("./tools/sql").then((m) => m.sqlAuditTool));
    this.registerLazyTool("env_safety", () => import("./tools/env_safety").then((m) => m.envSafetyTool));
    this.registerLazyTool("container", () => import("./tools/container").then((m) => m.containerAuditTool));
    this.registerLazyTool("flow", () => import("./tools/flow").then((m) => m.flowTraceTool));
    this.registerLazyTool("entropy", () => import("./tools/entropy").then((m) => m.entropyScannerTool));
    this.registerLazyTool("auth", () => import("./tools/auth").then((m) => m.accessControlAuditTool));
    this.registerLazyTool("report", () => import("./tools/report").then((m) => m.securityReportTool));
    this.registerLazyTool("ast_grep", () => import("./tools/ast_grep").then((m) => m.astGrepTool));
    this.registerLazyTool("git_forensics", () => import("./tools/git_forensics").then((m) => m.gitForensicsTool));
    this.registerLazyTool("threat_model", () => import("./tools/threat_model").then((m) => m.threatModelTool));
    this.registerLazyTool("auto_patch", () => import("./tools/auto_patch").then((m) => m.autoPatchTool));
    this.registerLazyTool("fuzzer", () => import("./tools/fuzzer").then((m) => m.dynamicFuzzerTool));
    this.registerLazyTool("cve_audit", () => import("./tools/cve_audit").then((m) => m.cveAuditTool));
    this.registerLazyTool("mutation", () => import("./tools/mutation").then((m) => m.mutationTesterTool));
    this.registerLazyTool("sandbox_run", () => import("./tools/sandbox_run").then((m) => m.sandboxRunnerTool));
    this.registerLazyTool("traffic_poison", () => import("./tools/traffic_poison").then((m) => m.trafficPoisonerTool));
    this.registerLazyTool("mock_poison", () => import("./tools/mock_poison").then((m) => m.mockPoisonerTool));
    this.registerLazyTool("read_many", () => import("./tools/read_many").then((m) => m.readManyTool));
    this.registerLazyTool("json_probe", () => import("./tools/json_probe").then((m) => m.jsonProbeTool));
    this.registerLazyTool("validation_profile", () => import("./tools/validation_profile").then((m) => m.detectWorkspaceCapabilitiesTool));
    this.registerLazyTool("validation_plan", () => import("./tools/validation_plan").then((m) => m.validationPlanTool));
    this.registerLazyTool("validation_persistence", () => import("./tools/validation_persistence").then((m) => m.validationPersistenceTool));
    this.registerLazyTool("run_tests", () => import("./tools/run_tests").then((m) => m.runTestsTool));
    this.registerLazyTool("find_similar_failures", () => import("./tools/failure_memory").then((m) => m.findSimilarFailuresTool));
    this.registerLazyTool("record_failure", () => import("./tools/failure_memory").then((m) => m.recordFailureTool));
    this.registerLazyTool("record_resolution", () => import("./tools/failure_memory").then((m) => m.recordResolutionTool));
    this.registerLazyTool("supermemory", () => import("./tools/supermemory").then((m) => m.supermemoryTool));
    this.registerLazyTool("pdf_report", () => import("./tools/pdf_report").then((m) => m.pdfReportTool));
    this.registerLazyTool("glob", () => import("./tools/glob").then((m) => m.globTool));
    this.registerLazyTool("pwd", () => import("./tools/pwd").then((m) => m.pwdTool));
    this.registerLazyTool("du", () => import("./tools/du").then((m) => m.duTool));
    this.registerLazyTool("find", () => import("./tools/find").then((m) => m.findTool));
    this.registerLazyTool("package_audit", () => import("./tools/package_audit").then((m) => m.packageAuditTool));
    this.registerLazyTool("file_editor", () => import("./tools/file_editor").then((m) => m.fileEditorTool));
    this.registerLazyTool("http_prober", () => import("./tools/http_prober").then((m) => m.httpProberTool));
    this.registerLazyTool("redos_analyzer", () => import("./tools/redos_analyzer").then((m) => m.redosAnalyzerTool));
    this.registerLazyTool("jwt_decoder", () => import("./tools/jwt_decoder").then((m) => m.jwtDecoderTool));
    this.registerLazyTool("browser_prober", () => import("./tools/browser_prober").then((m) => m.browserProberTool));
    this.registerLazyTool("source_map_analyzer", () => import("./tools/source_map_analyzer").then((m) => m.sourceMapAnalyzerTool));
    this.registerLazyTool("oob_listener", () => import("./tools/oob_listener").then((m) => m.oobListenerTool));
    this.registerLazyTool("creds_validator", () => import("./tools/creds_validator").then((m) => m.credsValidatorTool));
    this.registerLazyTool("prototype_pollution_fuzzer", () => import("./tools/prototype_pollution_fuzzer").then((m) => m.prototypePollutionFuzzerTool));
    this.registerLazyTool("local_network_recon", () => import("./tools/local_network_recon").then((m) => m.localNetworkReconTool));
    this.registerLazyTool("repo_graph", () => import("./tools/repo_graph").then((m) => m.repoGraphTool));
    this.registerLazyTool("security_path_trace", () => import("./tools/security_path_trace").then((m) => m.securityPathTraceTool));
    this.registerLazyTool("attack_surface_scan", () => import("./tools/attack_surface_scan").then((m) => m.attackSurfaceScanTool));
    this.registerLazyTool("candidate_revalidator", () => import("./tools/candidate_revalidator").then((m) => m.candidateRevalidatorTool));
    this.registerLazyTool("evidence_pack", () => import("./tools/evidence_pack").then((m) => m.evidencePackTool));
    this.registerLazyTool("deep_analysis_pipeline", () => import("./tools/deep_analysis_pipeline").then((m) => m.deepAnalysisPipelineTool));
    this.registerLazyTool("semgrep_scan", () => import("./tools/semgrep_scan").then((m) => m.semgrepScanTool));
    this.registerLazyTool("eslint_scan", () => import("./tools/eslint_scan").then((m) => m.eslintScanTool));
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

  registerLazyTool(name: string, loader: () => Promise<Tool>) {
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
    context: {
      workspacePath: string;
      trustContract?: WorkspaceTrustContract;
      settings: AppSettings;
    },
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

function buildGovernedToolDescription(tool: Tool) {
  const policy = policyService.classifyToolCall({
    workspacePath: "",
    toolName: tool.name,
    args: {},
  });

  const impacts =
    policy.impactTypes.length > 0
      ? policy.impactTypes.map((impact) => impact.replaceAll("_", " ")).join(", ")
      : "read-only or diagnostic";

  return [
    tool.description,
    `Policy: default risk class ${policy.riskClass}; impact: ${impacts}. The active Workspace Trust Contract may allow, require approval for, or block this tool based on its arguments.`,
  ].join("\n\n");
}

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

      if (schema.properties && typeof schema.properties === "object") {
        const objectValue = value as Record<string, unknown>;
        const properties = schema.properties as Record<string, unknown>;
        const required = Array.isArray(schema.required) ? schema.required : [];

        for (const requiredKey of required) {
          if (!(requiredKey in objectValue)) {
            return `Missing required argument "${keyPath}.${requiredKey}".`;
          }
        }

        for (const childKey of Object.keys(objectValue)) {
          const childSchema = properties[childKey];
          if (!childSchema) {
            return `Unexpected argument "${keyPath}.${childKey}".`;
          }

          const childError = validateValueAgainstSchema(
            objectValue[childKey],
            childSchema,
            `${keyPath}.${childKey}`,
          );
          if (childError) {
            return childError;
          }
        }
      }

      return null;
    default:
      return null;
  }
}
