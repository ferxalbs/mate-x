import { runInNewContext } from 'node:vm';
import type { Tool } from '../tool-service';

export const prototypePollutionFuzzerTool: Tool = {
  name: 'prototype_pollution_fuzzer',
  description: 'Tests a JS snippet or merge function for Prototype Pollution vulnerabilities inside a secure VM sandbox.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The JS code containing the merge/clone function to test. Assume it receives (target, source).',
      },
      functionName: {
        type: 'string',
        description: 'The name of the function to invoke in the code snippet.',
      },
    },
    required: ['code', 'functionName'],
  },
  async execute(args) {
    const { code, functionName } = args;

    // We will inject this malicious payload into the VM
    const evilPayloadStr = `JSON.parse('{"__proto__":{"polluted":"yes_it_is"}}')`;

    const sandboxCode = `
      ${code}

      let result = "UNKNOWN";
      try {
        const target = {};
        const source = ${evilPayloadStr};
        
        // Execute the user function
        ${functionName}(target, source);

        // Check if the global Object prototype got polluted
        const testObj = {};
        if (testObj.polluted === "yes_it_is") {
          result = "VULNERABLE";
        } else {
          result = "SAFE";
        }
      } catch (err) {
        result = "ERROR: " + err.message;
      }
      
      result;
    `;

    try {
      // Create a fresh V8 sandbox context
      const context = {};
      
      // Execute the code with a strict 2 second timeout
      const result = runInNewContext(sandboxCode, context, { timeout: 2000 });

      if (result === 'VULNERABLE') {
        return `🚨 CRITICAL VULNERABILITY: Prototype Pollution CONFIRMED!\nThe function \`${functionName}\` successfully polluted the global Object prototype.`;
      } else if (result === 'SAFE') {
        return `✅ SAFE: The function \`${functionName}\` successfully mitigated the prototype pollution attempt.`;
      } else {
         return `Analysis inconclusive: ${result}`;
      }

    } catch (error: any) {
      if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        return `Timeout Error: The function took too long to execute (potential ReDoS or Infinite Loop during merge).`;
      }
      return `Error executing fuzzer: ${error.message}`;
    }
  },
};
