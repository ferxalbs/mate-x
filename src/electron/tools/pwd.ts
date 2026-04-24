import type { Tool } from '../tool-service';

export const pwdTool: Tool = {
  name: 'pwd',
  description: 'Print the absolute path of the current workspace directory. Useful for understanding the current working environment context.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(args, { workspacePath }) {
    return `Workspace Root: ${workspacePath}`;
  },
};
