import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from '../tool-service';

export const dependencyAnalyzerTool: Tool = {
  name: 'dependency_check',
  description: 'Analyzes manifest files (package.json, etc.) for suspicious scripts or supply chain risks.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the manifest file (e.g., "package.json"). Defaults to "package.json".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings }) {
    const relativePath = args.path || 'package.json';
    const targetFile = join(workspacePath, relativePath);

    try {
      const content = await readFile(targetFile, 'utf8');
      const pkg = JSON.parse(content);
      const results: string[] = [];

      // Check for suspicious scripts
      if (pkg.scripts) {
        const suspiciousKeywords = ['curl', 'wget', 'sh ', 'bash', 'python', 'node -e', 'eval'];
        for (const [name, script] of Object.entries(pkg.scripts as Record<string, string>)) {
          if (suspiciousKeywords.some(kw => script.toLowerCase().includes(kw))) {
            results.push(`[Suspicious Script] "${name}": ${script}`);
          }
        }
      }

      // Check for dependency configuration smells
      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies as Record<string, string>)) {
          if (version.includes('http://') || version.includes('git+http://')) {
            results.push(`[Insecure Dependency] "${name}" uses insecure protocol: ${version}`);
          }
        }
      }

      // Identify major frameworks for context
      const stack = [];
      if (pkg.dependencies?.['electron']) stack.push('Electron');
      if (pkg.dependencies?.['react']) stack.push('React');
      if (pkg.dependencies?.['express']) stack.push('Express');

      let report = `Dependency Report for ${relativePath}:\n`;
      if (stack.length > 0) report += `Detected Stack: ${stack.join(', ')}\n`;
      report += results.length > 0 
        ? `\nIdentified Smells:\n${results.join('\n')}`
        : '\nNo immediate dependency smells identified.';

      return report;
    } catch (error) {
      return `Error analyzing dependencies: ${(error as Error).message}`;
    }
  },
};
