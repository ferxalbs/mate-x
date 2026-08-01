import { test } from "bun:test";
import assert from "node:assert/strict";

import { InMemoryEngineeringRepository } from "../engineering/in-memory-repository";
import { AgentExecutionSession } from "./agent-execution-session";

test("records immutable ordered transitions and replays by cursor", () => {
  const repository = new InMemoryEngineeringRepository();
  repository.ensureSchema();
  const session = new AgentExecutionSession(
    "run-trace-test",
    "execute",
    null,
    null,
    repository,
  );
  session.start();

  const legacyEvent = {
    id: "tool-1",
    executionId: "execution-tool-1",
    label: "Search files",
    detail: "Searching the repository.",
    status: "active" as const,
    visibility: "public" as const,
    type: "search" as const,
  };
  session.captureLegacyEvents([legacyEvent]);
  session.captureLegacyEvents([{ ...legacyEvent, status: "completed" }]);

  const events = session.getEvents();
  assert.deepEqual(
    events.map((event) => event.kind),
    ["run.created", "run.started", "tool.started", "tool.completed"],
  );
  assert.deepEqual(
    events.map((event) => event.seq),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    events.slice(2).map((event) => event.executionId),
    ["execution-tool-1", "execution-tool-1"],
  );
  assert.equal(events[0].previousIntegrityHash, null);
  assert.equal(events[1].previousIntegrityHash, events[0].integrityHash);
  assert.deepEqual(
    session.getEvents(2).map((event) => event.seq),
    [3, 4],
  );
});

test("rejects unsafe diagnostic payloads before append", () => {
  const repository = new InMemoryEngineeringRepository();
  repository.ensureSchema();
  const session = new AgentExecutionSession(
    "run-trace-private",
    "execute",
    null,
    null,
    repository,
  );

  assert.throws(
    () =>
      session.record({
        kind: "tool.failed",
        phase: "execution",
        visibility: "local_diagnostic",
        payload: { relativePath: "/Users/example/secret.ts" },
      }),
    /privacy boundary/,
  );
  assert.equal(session.getEvents().length, 1);
});
