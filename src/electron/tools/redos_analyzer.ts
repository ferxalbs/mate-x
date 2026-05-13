import { Worker } from 'node:worker_threads';
import type { Tool } from '../tool-service';

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_INPUT_LENGTH = 20_000;
const MAX_INPUT_LENGTH = 100_000;
const DEFAULT_SAMPLES = 3;
const MAX_SAMPLES = 10;

type StaticSignal = {
  severity: 'high' | 'medium' | 'low';
  message: string;
};

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const validateFlags = (flags: string) => {
  if (!/^[dgimsuvy]*$/.test(flags)) return 'Regex flags contain unsupported characters.';
  if (new Set(flags).size !== flags.length) return 'Regex flags contain duplicates.';
  return '';
};

const analyzeStaticRisk = (regex: string) => {
  const signals: StaticSignal[] = [];

  if (/\((?:[^()\\]|\\.)+[+*](?:[^()\\]|\\.)*\)[+*{]/.test(regex)) {
    signals.push({
      severity: 'high',
      message: 'Nested quantifiers can cause exponential backtracking.',
    });
  }

  if (/\((?:[^()\\]|\\.)+\|(?:[^()\\]|\\.)+\)[+*{]/.test(regex)) {
    signals.push({
      severity: 'medium',
      message: 'Quantified alternation can backtrack heavily when alternatives overlap.',
    });
  }

  if (/\.\*[+*?]?|\.\+[+*?]?/.test(regex)) {
    signals.push({
      severity: 'medium',
      message: 'Wide wildcard quantifier can consume too much input before backtracking.',
    });
  }

  if (/\[[^\]]+\][+*][+*{]/.test(regex)) {
    signals.push({
      severity: 'medium',
      message: 'Repeated character class appears under another quantifier.',
    });
  }

  if (!regex.startsWith('^') || !regex.endsWith('$')) {
    signals.push({
      severity: 'low',
      message: 'Regex is not fully anchored; engine may scan many start positions.',
    });
  }

  return signals;
};

const generateAttackStrings = (regex: string, requested?: string) => {
  if (requested) return [requested];

  const seeds = ['a', '0', 'A', '_', ' ', '/'];
  const suffixes = ['!', 'X', '\n'];
  const strings: string[] = [];

  for (const seed of seeds) {
    for (const suffix of suffixes) {
      strings.push(seed.repeat(2048) + suffix);
    }
  }

  if (regex.includes('/')) strings.push('/'.repeat(2048) + '!');
  if (regex.includes('\\d') || regex.includes('[0-9]')) strings.push('1'.repeat(2048) + '!');
  if (regex.includes('\\w')) strings.push('a'.repeat(2048) + '!');

  return [...new Set(strings)];
};

const severityFromRuntime = (timedOut: boolean, maxTimeMs: number, staticSignals: StaticSignal[]) => {
  if (timedOut) return 'CRITICAL';
  if (maxTimeMs >= 1000 || staticSignals.some((signal) => signal.severity === 'high')) return 'HIGH';
  if (maxTimeMs >= 100 || staticSignals.some((signal) => signal.severity === 'medium')) return 'MEDIUM';
  if (staticSignals.length > 0) return 'LOW';
  return 'INFO';
};

export const redosAnalyzerTool: Tool = {
  name: 'redos_analyzer',
  description: 'Evaluate regex ReDoS risk using static heuristics plus timed isolated worker execution against supplied or generated attack strings.',
  parameters: {
    type: 'object',
    properties: {
      regex: {
        type: 'string',
        description: 'The raw regex string to test (without slashes). E.g. "([a-zA-Z]+)*$"',
      },
      testString: {
        type: 'string',
        description: 'Optional evil string to test. If omitted, analyzer generates adversarial inputs.',
      },
      flags: {
        type: 'string',
        description: 'Optional regex flags, e.g. "i", "m", "u".',
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout per worker execution. Defaults to 2000, capped at 10000.',
      },
      samples: {
        type: 'number',
        description: 'Number of generated attack strings to test. Defaults to 3, capped at 10.',
      },
      maxInputLength: {
        type: 'number',
        description: 'Max test string length. Defaults to 20000, capped at 100000.',
      },
    },
    required: ['regex'],
  },
  async execute(args) {
    const regex = String(args.regex || '');
    const flags = typeof args.flags === 'string' ? args.flags.trim() : '';
    const timeoutMs = toPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const samples = toPositiveInteger(args.samples, DEFAULT_SAMPLES, MAX_SAMPLES);
    const maxInputLength = toPositiveInteger(args.maxInputLength, DEFAULT_MAX_INPUT_LENGTH, MAX_INPUT_LENGTH);
    const testString = typeof args.testString === 'string' ? args.testString.slice(0, maxInputLength) : '';
    const flagError = validateFlags(flags);
    const staticSignals = analyzeStaticRisk(regex);

    if (!regex.trim()) return 'Regex is required.';
    if (flagError) return flagError;
    if (regex.length > 5000) return 'Regex too large to analyze safely.';

    const attackStrings = generateAttackStrings(regex, testString)
      .slice(0, samples)
      .map((value) => value.slice(0, maxInputLength));

    return new Promise((resolve) => {
      const workerCode = `
        const { parentPort, workerData } = require('node:worker_threads');
        try {
          const results = [];
          for (const value of workerData.attackStrings) {
            const re = new RegExp(workerData.regex, workerData.flags);
            const start = performance.now();
            const match = re.test(value);
            const end = performance.now();
            results.push({ match, time: end - start, length: value.length, suffix: value.slice(-8) });
          }
          parentPort.postMessage({ results });
        } catch (e) {
          parentPort.postMessage({ error: e.message });
        }
      `;
      
      const worker = new Worker(workerCode, {
        eval: true,
        workerData: { regex, flags, attackStrings }
      });
      
      const timeout = setTimeout(() => {
        worker.terminate();
        const staticText = staticSignals.map((signal) => `- ${signal.severity.toUpperCase()}: ${signal.message}`).join('\n');
        resolve(
          `CRITICAL ReDoS Risk: execution timed out after ${timeoutMs}ms.\n` +
            `Static signals:\n${staticText || '- none'}\n` +
            'Fix: simplify nested quantifiers/overlapping alternation, anchor pattern, cap input length, or use linear-time parser/regex engine.'
        );
      }, timeoutMs);

      worker.on('message', (msg) => {
        clearTimeout(timeout);
        worker.terminate();
        if (msg.error) resolve(`Error parsing/executing regex: ${msg.error}`);
        else {
          const results = (msg.results || []) as Array<{ match: boolean; time: number; length: number; suffix: string }>;
          const maxTime = Math.max(...results.map((result) => result.time), 0);
          const severity = severityFromRuntime(false, maxTime, staticSignals);
          const runtimeLines = results.map(
            (result, index) =>
              `sample ${index + 1}: ${result.time.toFixed(2)}ms, len=${result.length}, match=${result.match}, suffix=${JSON.stringify(result.suffix)}`
          );
          const staticLines = staticSignals.map((signal) => `- ${signal.severity.toUpperCase()}: ${signal.message}`);
          const fix =
            severity === 'INFO'
              ? 'No immediate ReDoS signal. Keep input length bounded for untrusted data.'
              : 'Review before accepting untrusted input. Prefer anchored, linear patterns; avoid nested quantifiers and overlapping alternation.';

          resolve(
            `${severity} ReDoS Analysis\n` +
              `Regex: /${regex}/${flags}\n` +
              `Runtime max: ${maxTime.toFixed(2)}ms across ${results.length} sample(s)\n` +
              `Runtime samples:\n${runtimeLines.join('\n')}\n` +
              `Static signals:\n${staticLines.join('\n') || '- none'}\n` +
              `Fix: ${fix}`
          );
        }
      });

      worker.on('error', (err) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(`Worker error: ${err.message}`);
      });
    });
  },
};
