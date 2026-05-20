import type { AppSettings } from "../contracts/settings";
import type { WorkspaceTrustContract } from "../contracts/workspace";

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
    context: ToolExecutionContext,
  ) => Promise<string>;
}

export interface ToolExecutionContext {
  workspacePath: string;
  trustContract?: WorkspaceTrustContract;
  settings: AppSettings;
}

export type ToolLoader = () => Promise<Tool>;
