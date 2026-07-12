/**
 * Repository check: fail if prohibited legacy mode terms reappear in active runtime paths.
 * Excludes: migration fixtures, migration-only modules, changelog, docs history.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');

const EXCLUDE_DIR_PARTS = [
  'node_modules',
  '.git',
  'out',
  '.vite',
  'dist',
  'CHANGELOG.md',
  'docs/native-engineering-system',
  'fixtures/legacy',
  'src/electron/engineering/migration',
  '.agents',
];

const EXCLUDE_FILE_SUFFIXES = [
  '.original.md',
  'check-legacy-terms.ts',
  'factory-run.test.ts', // tests residual mode stripping with cast payloads
  'factory-run.ts', // normalize residual mode fields only
  'chat-store.test.ts', // residual mode alias strip tests
];

/** Prohibited in active runtime product contracts / UI */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'AssistantMode type export', re: /export type AssistantMode\b/ },
  { name: 'mode: "factory"', re: /mode:\s*["']factory["']/ },
  { name: 'mode: "ship"', re: /mode:\s*["']ship["']/ },
  { name: 'mode: "critic_loop"', re: /mode:\s*["']critic_loop["']/ },
  { name: 'mode: "build" (assistant)', re: /mode:\s*["']build["']/ },
  { name: 'mode: "plan" (assistant)', re: /mode:\s*["']plan["']/ },
  { name: 'mode: "chat" (assistant)', re: /mode:\s*["']chat["']/ },
  { name: 'mode: "review" (assistant)', re: /mode:\s*["']review["']/ },
  { name: 'FactoryRun as current model', re: /export interface FactoryRun\b/ },
  { name: 'createFactoryRun product authority', re: /function createFactoryRun[\s\S]{0,200}return \{/ },
];

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (EXCLUDE_DIR_PARTS.some((p) => rel === p || rel.startsWith(p + '/'))) {
      continue;
    }
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      if (EXCLUDE_FILE_SUFFIXES.some((s) => rel.endsWith(s) || name.endsWith(s))) {
        continue;
      }
      files.push(full);
    }
  }
  return files;
}

const violations: Array<{ file: string; rule: string; line: number; text: string }> = [];

for (const file of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (const { name, re } of PATTERNS) {
    // Skip privacy mode: "review" in privacy modules
    if (
      name.includes('mode: "review"') &&
      (rel.includes('privacy') || rel.includes('settings'))
    ) {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Allow comments explaining removal
      if (/AssistantMode product|deleted AssistantMode|not user-facing AssistantMode|residual mode|legacy mode/.test(line)) {
        continue;
      }
      if (re.test(line)) {
        violations.push({
          file: rel,
          rule: name,
          line: i + 1,
          text: line.trim().slice(0, 120),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('LEGACY TERM CHECK FAILED');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: [${v.rule}] ${v.text}`);
  }
  process.exit(1);
}

console.log('LEGACY TERM CHECK PASS — no prohibited AssistantMode/Factory runtime terms in active paths');
