import { Worker } from 'node:worker_threads';
import type { Tool } from '../tool-service';

export const redosAnalyzerTool: Tool = {
  name: 'redos_analyzer',
  description: 'Evaluate a regular expression for Catastrophic Backtracking (ReDoS) vulnerability in a safe, isolated thread.',
  parameters: {
    type: 'object',
    properties: {
      regex: {
        type: 'string',
        description: 'The raw regex string to test (without slashes). E.g. "([a-zA-Z]+)*$"',
      },
      testString: {
        type: 'string',
        description: 'The evil string to test the regex against. Should be designed to trigger backtracking.',
      },
    },
    required: ['regex', 'testString'],
  },
  async execute(args) {
    const { regex, testString } = args;
    
    return new Promise((resolve) => {
      const workerCode = `
        const { parentPort, workerData } = require('node:worker_threads');
        try {
          const re = new RegExp(workerData.regex);
          const start = Date.now();
          const match = re.test(workerData.testString);
          const end = Date.now();
          parentPort.postMessage({ match, time: end - start });
        } catch (e) {
          parentPort.postMessage({ error: e.message });
        }
      `;
      
      const worker = new Worker(workerCode, {
        eval: true,
        workerData: { regex, testString }
      });
      
      const timeout = setTimeout(() => {
        worker.terminate();
        resolve(`VULNERABLE: Catastrophic Backtracking detected! Execution timed out after 2000ms.`);
      }, 2000);

      worker.on('message', (msg) => {
        clearTimeout(timeout);
        worker.terminate();
        if (msg.error) resolve(`Error parsing/executing regex: ${msg.error}`);
        else resolve(`SAFE: Regex execution completed in ${msg.time}ms. Match: ${msg.match}`);
      });

      worker.on('error', (err) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(`Worker error: ${err.message}`);
      });
    });
  },
};
