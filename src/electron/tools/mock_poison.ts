import { createServer, type Server } from "node:http";
import type { Tool } from "../tool-service";

interface MockServerState {
  server: Server | null;
  hitCount: number;
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
  async execute(args, _context) {
    const { action, port = 9999, payloadType = "MALFORMED_JSON" } = args;
    const serverKey = `port_${port}`;

    if (action === "stop") {
      const state = mockServers.get(serverKey);
      if (!state || !state.server) return `No mock server running on port ${port}.`;
      
      return new Promise((resolve) => {
        state.server!.close(() => {
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

      return new Promise((resolve, reject) => {
        const state: MockServerState = { server: null, hitCount: 0 };
        
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

          state.server.listen(port, "127.0.0.1", () => {
            mockServers.set(serverKey, state);
            resolve(`Mock Poisoner Server STARTED on http://127.0.0.1:${port}\\nServing [${payloadType}] payloads.\\n\\nNow run your sandbox and configure it to fetch dependencies from this local URL!`);
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
