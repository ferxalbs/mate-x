import type { Tool } from "../tool-service";

export const dynamicFuzzerTool: Tool = {
  name: "fuzzer",
  description:
    "A Dynamic Application Security Testing (DAST) fuzzer. Sends potentially malicious payloads to a local endpoint to dynamically verify exploibility.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The local endpoint to hit (e.g., 'http://127.0.0.1:3000/api/search'). Must be localhost.",
      },
      method: {
        type: "string",
        description: "HTTP method (GET, POST).",
      },
      fuzzTarget: {
        type: "string",
        description: "The payload type to test: 'SQLI', 'XSS', 'CMDI'.",
      },
    },
    required: ["url", "method", "fuzzTarget"],
  },
  async execute(args, _context) {
    const { url, method, fuzzTarget } = args;

    // Safety check - ONLY allow localhost testing
    if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
      return "Fuzzer Error: Target URL MUST be localhost or 127.0.0.1. External targeting is prohibited.";
    }

    const payloads = {
      SQLI: ["' OR 1=1 --", "' UNION SELECT null, null --", "\"; WAITFOR DELAY '0:0:5'--"],
      XSS: ["<script>alert('DAST')</script>", "\"><img src=x onerror=alert(1)>"],
      CMDI: ["; id", "& whoami", "| cat /etc/passwd"],
    };

    const targetPayloads = payloads[fuzzTarget as keyof typeof payloads];
    if (!targetPayloads) return `Fuzzer Error: Unknown fuzz target '${fuzzTarget}'.`;

    const results: string[] = [];

    for (const payload of targetPayloads) {
      try {
        let requestUrl = url;
        let body = undefined;

        if (method.toUpperCase() === "GET") {
          requestUrl = `${url}?q=${encodeURIComponent(payload)}`;
        } else if (method.toUpperCase() === "POST") {
          body = JSON.stringify({ input: payload });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000); // 3 sec timeout

        const start = Date.now();
        const response = await fetch(requestUrl, {
          method: method.toUpperCase(),
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
        const elapsed = Date.now() - start;
        clearTimeout(timeout);

        const respText = await response.text();
        
        let analysis = "Neutral";
        if (response.status >= 500) {
          analysis = "POTENTIAL EXPLOIT (Server Error 500 triggered)";
        } else if (fuzzTarget === "XSS" && respText.includes(payload)) {
          analysis = "EXPLOIT CONFIRMED (Reflected XSS)";
        } else if (elapsed > 2000 && fuzzTarget === "SQLI") {
          analysis = "POTENTIAL EXPLOIT (Time-delay response)";
        } else {
          analysis = "BLOCKED / SANITIZED";
        }

        results.push(`Payload: [${payload}] -> Status: ${response.status} -> Analysis: ${analysis}`);

      } catch (error) {
         results.push(`Payload: [${payload}] -> Error: ${(error as Error).name} (Likely connection refused or timeout)`);
      }
    }

    return `Fuzzer Report for ${url} (Target: ${fuzzTarget})\\n================================\\n${results.join("\\n")}`;
  },
};
