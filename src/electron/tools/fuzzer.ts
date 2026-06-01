import type { Tool } from "../tool-service";

const FUZZER_TIMEOUT_MS = 120_000;
const OUTPUT_CAP_CHARS = 512_000;
const MAX_CONCURRENT_REQUESTS = 8;

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
    const activeControllers = new Set<AbortController>();
    let completedPayloads = 0;
    let outputLength = 0;
    let outputTruncated = false;
    let cancelled = false;

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

    const abortActiveRequests = () => {
      cancelled = true;
      for (const controller of activeControllers) {
        controller.abort();
      }
    };

    const appendResult = (line: string) => {
      if (outputTruncated) return;
      const nextLength = outputLength + line.length + 1;
      if (nextLength > OUTPUT_CAP_CHARS) {
        outputTruncated = true;
        results.push(line.slice(0, Math.max(OUTPUT_CAP_CHARS - outputLength, 0)));
        abortActiveRequests();
        return;
      }
      outputLength = nextLength;
      results.push(line);
    };

    const runPayload = async (payload: string) => {
      if (cancelled) return;
      try {
        let requestUrl = url;
        let body = undefined;

        if (method.toUpperCase() === "GET") {
          requestUrl = `${url}?q=${encodeURIComponent(payload)}`;
        } else if (method.toUpperCase() === "POST") {
          body = JSON.stringify({ input: payload });
        }

        const controller = new AbortController();
        activeControllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 3000); // 3 sec timeout

        try {
          const start = Date.now();
          const response = await fetch(requestUrl, {
            method: method.toUpperCase(),
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          });
          const elapsed = Date.now() - start;

          let respText = "";
          if (!outputTruncated && !cancelled) {
            const readResult = await readCappedResponseText(
              response,
              Math.max(OUTPUT_CAP_CHARS - outputLength, 0),
            );
            respText = readResult.text;
            if (readResult.truncated) {
              outputTruncated = true;
              abortActiveRequests();
            }
          }
          
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

          completedPayloads++;
          appendResult(`Payload: [${payload}] -> Status: ${response.status} -> Analysis: ${analysis}`);
        } finally {
          clearTimeout(timeout);
          activeControllers.delete(controller);
        }

      } catch (error) {
        if (!cancelled) {
          completedPayloads++;
          appendResult(`Payload: [${payload}] -> Error: ${(error as Error).name} (Likely connection refused or timeout)`);
        }
      }
    };

    const executeFuzzer = async () => {
      let nextIndex = 0;
      const workers = Array.from(
        { length: Math.min(MAX_CONCURRENT_REQUESTS, targetPayloads.length) },
        async () => {
          while (!cancelled && nextIndex < targetPayloads.length) {
            const payload = targetPayloads[nextIndex++];
            await runPayload(payload);
          }
        },
      );
      await Promise.all(workers);
    };

    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<"timeout">((resolve) => {
        timeoutHandle = setTimeout(() => resolve("timeout"), FUZZER_TIMEOUT_MS);
      });
      const completed = await Promise.race([executeFuzzer(), timeout]);

      if (completed === "timeout") {
        abortActiveRequests();
        return JSON.stringify({
          error: "FUZZER_TIMEOUT",
          timeoutMs: FUZZER_TIMEOUT_MS,
          completedPayloads,
          totalPayloads: targetPayloads.length,
        });
      }
    } catch (error) {
      abortActiveRequests();
      return JSON.stringify({
        error: "FUZZER_ERROR",
        message: (error as Error).message,
        completedPayloads,
        totalPayloads: targetPayloads.length,
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      abortActiveRequests();
    }

    return `Fuzzer Report for ${url} (Target: ${fuzzTarget})\\n================================\\n${results.join("\\n")}${outputTruncated ? "\\n[output truncated]" : ""}`;
  },
};

async function readCappedResponseText(response: Response, maxChars: number) {
  if (maxChars <= 0) {
    return { text: "", truncated: true };
  }
  if (!response.body) {
    const text = await response.text();
    return {
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (text.length < maxChars) {
    const { done, value } = await reader.read();
    if (done) {
      text += decoder.decode();
      return { text, truncated: false };
    }
    text += decoder.decode(value, { stream: true });
  }

  await reader.cancel();
  return { text: text.slice(0, maxChars), truncated: true };
}
