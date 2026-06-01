import { lookup } from "node:dns/promises";
import { isIPv6 } from "node:net";
import { policyService } from "../policy-service";
import type { Tool } from "../tool-service";

const POISON_REQUEST_TIMEOUT_MS = 30_000;

export const trafficPoisonerTool: Tool = {
  name: "traffic_poison",
  description:
    "Simulates advanced application-logic attacks (Context-Aware attacks) like HTTP Parameter Pollution, Mass Assignment, or NoSQL injections against a local sandbox. Goes beyond simple fuzzing.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The local endpoint to poison (e.g., 'http://127.0.0.1:4000/api/users').",
      },
      attackType: {
        type: "string",
        description:
          "The attack vector to simulate: 'PARAMETER_POLLUTION', 'MASS_ASSIGNMENT', 'NOSQL_INJECTION', 'SSRF'.",
      },
      basePayload: {
        type: "string",
        description:
          'A valid expected JSON payload (as a string) to mutate (e.g. \'{"username":"admin"}\').',
      },
    },
    required: ["url", "attackType"],
  },
  async execute(args, { workspacePath, trustContract }) {
    const { url, attackType, basePayload } = args;

    const localhostError = await validateLoopbackUrl(url);
    if (localhostError) {
      return JSON.stringify(localhostError);
    }

    if (trustContract?.autonomy !== "unrestricted") {
      const approval = await requestTrafficPoisonApproval({
        workspacePath,
        target: url,
        attackType,
      });
      if (!approval) {
        return JSON.stringify({
          error: "POLICY_STOP_DECLINED",
          message: "traffic_poison execution requires policy approval.",
        });
      }
    }

    let parsedPayload: Record<string, any> = {};
    if (basePayload) {
      try {
        parsedPayload = JSON.parse(basePayload);
      } catch {
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
          maliciousBody[key] = { $gt: "" };
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
      const timeout = setTimeout(() => controller.abort(), POISON_REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(maliciousUrl, {
          method: "POST", // Standardize on POST for body poisoning validation
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(maliciousBody),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

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

async function validateLoopbackUrl(target: string) {
  try {
    const parsed = new URL(target);
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const { address } = await lookup(host);
    if (address.startsWith("127.") || (isIPv6(address) && address === "::1")) {
      return null;
    }
  } catch {
    // Malformed or unresolvable targets are rejected by the localhost-only gate.
  }

  return {
    error: "NON_LOCALHOST_TARGET",
    message: "traffic_poison is restricted to localhost targets.",
  };
}

async function requestTrafficPoisonApproval(input: {
  workspacePath: string;
  target: string;
  attackType: string;
}) {
  const stop = policyService.createStop({
    runId: `tool-${Date.now()}`,
    workspacePath: input.workspacePath,
    toolName: "traffic_poison",
    severity: "critical",
    policyId: "traffic_poison.execution",
    title: "Run paused: traffic poisoning requires approval.",
    explanation:
      "traffic_poison sends intentionally malicious HTTP payloads and requires explicit approval before execution.",
    kind: "TRAFFIC_POISON_EXECUTION",
    target: input.target,
    command: `traffic_poison ${input.attackType}`,
    metadata: { riskClass: "high", attackType: input.attackType },
    recommendation: "approve_once",
    availableActions: ["approve_once", "abort", "safer_alternative"],
  });
  const resolvedStop = await policyService.waitForResolution(stop.id);
  policyService.markStopCompleted(stop.id);
  return resolvedStop.resolution?.action === "approve_once";
}
