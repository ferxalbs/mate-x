import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { lazyToolLoaders } from "../tool-registry";
import {
  CORE_AGENT_TOOLS,
  canonicalizeToolName,
  getAgentToolAllowlist,
  getPreferredToolsForRunbook,
  getToolExpectations,
  renderToolPreferenceGuidance,
} from "./tool-expectations";
import type { WorkRunbook } from "./types";

const RUNBOOKS: WorkRunbook[] = [
  "answer_from_context",
  "inspect_explain",
  "review_classify_summarize",
  "patch_test_verify",
  "audit_reproduce_remediate",
  "scan_contain_report",
  "trace_source_to_sink",
  "validate_only",
  "evidence_only",
];

describe("tool expectations and preferences", () => {
  test("canonicalizes historical aliases", () => {
    assert.equal(canonicalizeToolName("git"), "git_diag");
    assert.equal(canonicalizeToolName("secrets"), "secret_scan");
    assert.equal(canonicalizeToolName("validation_plan"), "plan_validation");
    assert.equal(canonicalizeToolName("git_diag"), "git_diag");
  });

  test("expectations use only canonical names", () => {
    for (const runbook of RUNBOOKS) {
      for (const expectation of getToolExpectations(runbook)) {
        for (const name of expectation.tools) {
          assert.equal(
            name,
            canonicalizeToolName(name),
            `${runbook} expectation uses non-canonical name: ${name}`,
          );
        }
      }
    }
  });

  test("every expectation name is a registered registry key", () => {
    const keys = new Set(lazyToolLoaders.map(([name]) => name));
    for (const runbook of RUNBOOKS) {
      for (const expectation of getToolExpectations(runbook)) {
        for (const name of expectation.tools) {
          assert.equal(
            keys.has(name),
            true,
            `runbook ${runbook}: tool "${name}" missing from registry keys`,
          );
        }
      }
    }
  });

  test("hard allowlists are disabled — full catalog always", () => {
    for (const runbook of RUNBOOKS) {
      assert.equal(getAgentToolAllowlist(runbook, "full"), null);
      assert.equal(getAgentToolAllowlist(runbook, "chat_help"), null);
      assert.equal(getAgentToolAllowlist(runbook, "verify_only"), null);
    }
  });

  test("preferred tools are guidance for patch and prefer edit/validate first", () => {
    const preferred = getPreferredToolsForRunbook("patch_test_verify", "full");
    assert.ok(preferred.includes("file_editor"));
    assert.ok(preferred.includes("plan_validation"));
    assert.ok(preferred.includes("run_tests"));
    // Preferences are not exclusive — capable agents still get the full catalog.
  });

  test("preference guidance states full catalog is available", () => {
    const text = renderToolPreferenceGuidance("patch_test_verify", "full");
    assert.match(text, /full catalog available/i);
    assert.match(text, /file_editor/);
    assert.match(text, /prefer/i);
  });

  test("core tools appear in preferred set for inspect", () => {
    const preferred = getPreferredToolsForRunbook("inspect_explain", "full");
    for (const core of CORE_AGENT_TOOLS) {
      assert.ok(preferred.includes(core), `missing preferred core tool ${core}`);
    }
  });
});
