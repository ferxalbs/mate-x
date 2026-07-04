import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildSemanticContext } from "./working-set-semantic-context";

describe("buildSemanticContext", () => {
  it("classifies runtime surfaces, trust boundaries, and reference-only noise", () => {
    const semanticContext = buildSemanticContext({
      prompt: "audit auth risk",
      fileKeys: new Set([
        "src/app/api/users/route.ts",
        "src/electron/preload/index.ts",
        "docs/auth-example.md",
        "src/features/auth/auth-flow.test.ts",
        "package.json",
      ]),
      gitState: [" M src/app/api/users/route.ts"],
      primaryFiles: [
        {
          path: "src/app/api/users/route.ts",
          score: 90,
          reasons: ["changed in git state"],
        },
      ],
    });

    assert.ok(semanticContext.runtimeSurfaces.includes("HTTP/API routes"));
    assert.ok(semanticContext.trustBoundaries.includes("renderer to main process"));
    assert.ok(semanticContext.sourceRoles.includes("docs/reference only"));
    assert.ok(semanticContext.sourceRoles.some((role) => role.startsWith("tests excluded")));
    assert.ok(semanticContext.dependencySignals.includes("dependency/SCA check available"));
    assert.match(semanticContext.excludedNoise.join(" "), /runtime findings/);
  });
});
