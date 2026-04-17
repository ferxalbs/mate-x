import { rgTool } from './tools/rg';
import { lsTool } from './tools/ls';
import { readTool } from './tools/read';
import { gitTool } from './tools/git';
import { secretScanTool } from './tools/secrets';
import { fileMetadataTool } from './tools/metadata';
import { projectTreeTool } from './tools/tree';
import { securityAuditTool } from './tools/audit';
import { dependencyAnalyzerTool } from './tools/deps';
import { networkMapTool } from './tools/network';
import { sqlAuditTool } from './tools/sql';
import { envSafetyTool } from './tools/env_safety';
import { containerAuditTool } from './tools/container';
import { flowTraceTool } from './tools/flow';
import { entropyScannerTool } from './tools/entropy';
import { accessControlAuditTool } from './tools/auth';
import { securityReportTool } from './tools/report';
import { astGrepTool } from './tools/ast_grep';
import { gitForensicsTool } from './tools/git_forensics';
import { threatModelTool } from './tools/threat_model';
import { autoPatchTool } from './tools/auto_patch';
import { dynamicFuzzerTool } from './tools/fuzzer';
import { cveAuditTool } from './tools/cve_audit';
import { mutationTesterTool } from './tools/mutation';
import { sandboxRunnerTool } from './tools/sandbox_run';
import { trafficPoisonerTool } from './tools/traffic_poison';
import { mockPoisonerTool } from './tools/mock_poison';

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: any, context: { workspacePath: string }) => Promise<string>;
}

export class ToolService {
  private tools: Map<string, Tool> = new Map();

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
    // Future tools can be registered here or dynamically loaded
  }

  registerTool(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  getToolDefinitions() {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  async callTool(
    name: string,
    args: any,
    context: { workspacePath: string },
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found.`);
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
