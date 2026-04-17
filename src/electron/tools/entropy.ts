import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

export const entropyScannerTool: Tool = {
  name: 'entropy_scan',
  description: 'Calculates Shannon entropy to identify unusually random strings that might be hardcoded secrets or tokens.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory or file to scan (relative to workspace root). Defaults to ".".',
      },
      threshold: {
        type: 'number',
        description: 'Entropy threshold (0-8). Higher means more random. Defaults to 4.5.',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath }) {
    const { path = '.', threshold = 4.5 } = args;
    
    try {
      const { stdout } = await execFileAsync('rg', ['--files', path], { cwd: workspacePath });
      const files = stdout.split('\n').filter(Boolean);
      const discoveries: string[] = [];

      for (const file of files) {
        if (file.includes('node_modules') || file.includes('.git') || file.endsWith('.lock')) {
          continue;
        }

        const content = await readFile(join(workspacePath, file), 'utf8');
        // Extract strings and potential keys (alphanumeric sequences > 16 chars)
        const potentialSecrets = content.match(/[A-Za-z0-9+/=_-]{16,}/g);
        
        if (potentialSecrets) {
          for (const secret of potentialSecrets) {
            const entropy = calculateEntropy(secret);
            if (entropy > threshold) {
              discoveries.push(`${file}: High-entropy string found: ${secret.slice(0, 8)}... (Entropy: ${entropy.toFixed(2)})`);
            }
          }
        }
      }

      return discoveries.length > 0
        ? `High-Entropy Discovery Report (Threshold > ${threshold}):\n\n${discoveries.slice(0, 50).join('\n')}`
        : 'Scan complete. No high-entropy strings exceeded the threshold.';
    } catch (error) {
      return `Error performing entropy scan: ${(error as Error).message}`;
    }
  },
};

function calculateEntropy(str: string): number {
  const len = str.length;
  if (len === 0) return 0;
  
  const freqs: Record<string, number> = {};
  for (const char of str) {
    freqs[char] = (freqs[char] || 0) + 1;
  }

  let entropy = 0;
  for (const char in freqs) {
    const p = freqs[char] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
