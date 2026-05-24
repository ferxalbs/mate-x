import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultWorkspaceTrustContract,
  evaluateTrustForToolCall,
  normalizeWorkspaceTrustContract,
} from "./workspace-trust";

test("default trust contract allows reading local evidence artifacts", () => {
  const contract = createDefaultWorkspaceTrustContract("workspace-1", "Repo");

  assert.equal(
    evaluateTrustForToolCall({
      toolName: "read",
      args: { path: ".mate-x/evidence/task-1/attestation.intoto.json" },
      contract,
    }),
    null,
  );
});

test("normalization adds evidence read path to existing scoped contracts", () => {
  const contract = createDefaultWorkspaceTrustContract("workspace-1", "Repo");
  contract.allowedPaths = ["src"];

  const normalized = normalizeWorkspaceTrustContract(contract);

  assert.deepEqual(normalized.allowedPaths, ["src", ".mate-x/evidence"]);
});
