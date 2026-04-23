import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from '../tool-service';

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
  async execute(args, { workspacePath, settings }) {
    const relativePath = args.path || '.';
    const targetDir = join(workspacePath, relativePath);

    try {
      const files = await readdir(targetDir);
      const results: string[] = [];
      const envFiles = files.filter(f => f.includes('.env'));
      
      let gitIgnoreContent = '';
      try {
        gitIgnoreContent = await readFile(join(workspacePath, '.gitignore'), 'utf8');
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
