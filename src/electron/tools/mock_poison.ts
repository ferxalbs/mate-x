import { createServer, type Server } from "node:http";
import { policyService } from "../policy-service";
import type { Tool } from "../tool-service";

const MOCK_POISON_HOST = "127.0.0.1";
const MOCK_POISON_SERVER_CAP = 2;
const MOCK_POISON_LIFETIME_MS = 300_000;

interface MockServerState {
  server: Server | null;
  hitCount: number;
  lifetimeTimer: NodeJS.Timeout | null;
}

// Keep a persistent state for the mock server across tool calls
const mockServers = new Map<string, MockServerState>();

export const mockPoisonerTool: Tool = {
  name: "mock_poison",
  description:
    "An External Dependency Emulator. Temporarily spins up a local mock HTTP server that intentionally serves highly malicious payloads (oversized buffers, XML bombs, malformed JSON) to see if the client application safely handles compromised third-party data.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "'start' or 'stop' the mock server, or 'status' to check hits.",
      },
      port: {
        type: "number",
        description: "The local port to bind the mock server to. Defaults to 9999.",
      },
      payloadType: {
        type: "string",
        description: "The malicious payload to serve: 'XML_BOMB', 'HUGE_BUFFER', 'MALFORMED_JSON', 'XSS_JSON'.",
      },
    },
    required: ["action"],
  },
  async execute(args, { workspacePath }) {
    const { action, port = 9999, payloadType = "MALFORMED_JSON" } = args;
    const serverKey = `port_${port}`;

    if (action === "stop") {
      const state = mockServers.get(serverKey);
      if (!state || !state.server) return `No mock server running on port ${port}.`;
      
      return new Promise((resolve) => {
        state.server!.close(() => {
          if (state.lifetimeTimer) clearTimeout(state.lifetimeTimer);
          mockServers.delete(serverKey);
          resolve(`Mock Poisoner Server on port ${port} successfully stopped. Total hits intercepted: ${state.hitCount}`);
        });
      });
    }

    if (action === "status") {
      const state = mockServers.get(serverKey);
      if (!state) return `No mock server running on port ${port}.`;
      return `Mock Poisoner Server is RUNNING on port ${port}. Total hits intercepted so far: ${state.hitCount}`;
    }

    if (action === "start") {
      if (mockServers.has(serverKey)) {
        return `Mock server already running on port ${port}. Stop it first.`;
      }
      if (mockServers.size >= MOCK_POISON_SERVER_CAP) {
        return JSON.stringify({
          error: "SERVER_CAP_REACHED",
          message: "Maximum concurrent mock_poison servers reached (2).",
        });
      }
      const approval = await requestMockPoisonApproval({
        workspacePath,
        port,
        payloadType,
      });
      if (!approval) {
        return JSON.stringify({
          error: "POLICY_STOP_DECLINED",
          message: "mock_poison execution requires policy approval.",
        });
      }

      return new Promise((resolve, reject) => {
        const state: MockServerState = { server: null, hitCount: 0, lifetimeTimer: null };
        
        try {
          state.server = createServer((req, res) => {
            state.hitCount++;
            
            // Generate the malicious response based on selected payload type
            const responsePayload =
              payloadType === "XML_BOMB"
                ? {
                    contentType: "text/xml",
                    responseData: `<?xml version="1.0"?>
                  <!DOCTYPE lolz [
                   <!ENTITY lol "lol">
                   <!ELEMENT lolz (#PCDATA)>
                   <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
                   <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
                   <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
                  ]>
                  <lolz>&lol3;</lolz>`,
                  }
                : payloadType === "HUGE_BUFFER"
                  ? {
                      contentType: "application/octet-stream",
                      // Serve 50MB of junk to test for memory exhaustion (Buffer overflow)
                      responseData: Buffer.alloc(50 * 1024 * 1024, "A"),
                    }
                  : payloadType === "XSS_JSON"
                    ? {
                        contentType: "application/json",
                        responseData: JSON.stringify({
                          id: 1,
                          username: "<script>alert('Third-Party XSS')</script>",
                          profile: "javascript:alert(1)"
                        }),
                      }
                    : payloadType === "MALFORMED_JSON"
                      ? {
                          contentType: "application/json",
                          responseData: "{ \"id\": 1, \"name\": \"test\" ",
                        }
                      : {
                          contentType: "application/json",
                          responseData: "{\"error\": \"unknown payload\"}",
                        };

            res.writeHead(200, { "Content-Type": responsePayload.contentType });
            res.end(responsePayload.responseData);
          });

          state.server.listen(port, MOCK_POISON_HOST, () => {
            mockServers.set(serverKey, state);
            state.lifetimeTimer = setTimeout(() => {
              const activeState = mockServers.get(serverKey);
              if (!activeState?.server) return;
              activeState.server.close(() => {
                mockServers.delete(serverKey);
                console.debug(JSON.stringify({ stopped: true, reason: "LIFETIME_EXCEEDED", tool: "mock_poison", port }));
              });
            }, MOCK_POISON_LIFETIME_MS);
            resolve(`Mock Poisoner Server STARTED on http://${MOCK_POISON_HOST}:${port}\\nServing [${payloadType}] payloads.\\nServer lifetime is capped at ${MOCK_POISON_LIFETIME_MS}ms.\\n\\nNow run your sandbox and configure it to fetch dependencies from this local URL!`);
          });

          state.server.on("error", (err) => {
            reject(`Failed to start mock server: ${err.message}`);
          });

        } catch (error) {
          reject(`Error setting up mock server: ${(error as Error).message}`);
        }
      });
    }

    return `Invalid action '${action}'. Use 'start', 'stop', or 'status'.`;
  },
};

async function requestMockPoisonApproval(input: {
  workspacePath: string;
  port: number;
  payloadType: string;
}) {
  const stop = policyService.createStop({
    runId: `tool-${Date.now()}`,
    workspacePath: input.workspacePath,
    toolName: "mock_poison",
    severity: "critical",
    policyId: "mock_poison.execution",
    title: "Run paused: poisoned mock server requires approval.",
    explanation:
      "mock_poison starts a server that serves intentionally malicious payloads and requires explicit approval before execution.",
    kind: "MOCK_POISON_EXECUTION",
    target: `http://${MOCK_POISON_HOST}:${input.port}`,
    command: `mock_poison start ${input.payloadType}`,
    metadata: { riskClass: "high", payloadType: input.payloadType },
    recommendation: "approve_once",
    availableActions: ["approve_once", "abort", "safer_alternative"],
  });
  const resolvedStop = await policyService.waitForResolution(stop.id);
  policyService.markStopCompleted(stop.id);
  return resolvedStop.resolution?.action === "approve_once";
}
