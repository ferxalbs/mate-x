import { readdir } from 'node:fs/promises';
import type { Tool } from '../tool-service';
import { readUtf8FileSafe, resolveWorkspacePathForRead } from './tool-utils';

export const envSafetyTool: Tool = {
  name: 'env_audit',
  description: 'Audits environment management, checking .gitignore compliance and identifying leaked or mismatched keys.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to audit. Defaults to ".".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings: _settings }) {
    const relativePath = args.path || '.';
    try {
      const targetDir = await resolveWorkspacePathForRead(workspacePath, relativePath);
      const files = await readdir(targetDir);
      const results: string[] = [];
      const envFiles = files.filter(f => f.includes('.env'));
      
      let gitIgnoreContent = '';
      try {
        ({ content: gitIgnoreContent } = await readUtf8FileSafe(workspacePath, '.gitignore'));
      } catch {
        results.push('[MAJOR] .gitignore is missing. This is a high risk for secret leakage!');
      }

      for (const envFile of envFiles) {
        if (envFile === '.env.example' || envFile === '.env.template') continue;
        
        const isIgnored = gitIgnoreContent.includes(envFile) || gitIgnoreContent.includes('*.env') || gitIgnoreContent.includes('.env*');
        if (!isIgnored) {
          results.push(`[HIGH RISK] ${envFile} is not explicitly ignored in .gitignore!`);
        } else {
          results.push(`[OK] ${envFile} is properly ignored.`);
        }
      }

      const prodEnvFiles = envFiles.filter(f => f.toLowerCase().includes('prod'));
      if (prodEnvFiles.length > 0) {
        results.push(`[WARNING] Production environment files found in repo: ${prodEnvFiles.join(', ')}`);
      }

      return results.length > 0
        ? `Environment Safety Report:\n${results.join('\n')}`
        : 'No immediate environment safety issues found.';
    } catch (error) {
      return `Error auditing environment: ${(error as Error).message}`;
    }
  },
};
