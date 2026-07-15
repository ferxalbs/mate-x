import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { lazyToolLoaders } from "../tool-registry";
import {
  CORE_AGENT_TOOLS,
  canonicalizeToolName,
  getAgentToolAllowlist,
  getToolExpectations,
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

describe("tool expectations and allowlists", () => {
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

  test("every expectation name is a registered registry key or will resolve via alias", () => {
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

  test("patch allowlist includes edit/validate tools and excludes fuzzer/browser by default", () => {
    const allow = getAgentToolAllowlist("patch_test_verify", "full");
    assert.ok(allow);
    assert.ok(allow!.includes("file_editor"));
    assert.ok(allow!.includes("plan_validation"));
    assert.ok(allow!.includes("run_tests"));
    assert.ok(allow!.includes("sandbox_run"));
    assert.equal(allow!.includes("fuzzer"), false);
    assert.equal(allow!.includes("browser_prober"), false);
  });

  test("chat_help uses core tools only", () => {
    const allow = getAgentToolAllowlist("patch_test_verify", "chat_help");
    assert.deepEqual(allow, [...CORE_AGENT_TOOLS].sort((a, b) => a.localeCompare(b)));
  });

  test("verify_only focuses on validation tools", () => {
    const allow = getAgentToolAllowlist("inspect_explain", "verify_only");
    assert.ok(allow);
    assert.ok(allow!.includes("plan_validation"));
    assert.ok(allow!.includes("run_tests"));
    assert.equal(allow!.includes("file_editor"), false);
  });

  test("unknown path kinds fall back to the full tool catalog", () => {
    assert.equal(
      getAgentToolAllowlist("patch_test_verify", "future_agent_path"),
      null,
    );
  });

  test("core tools are always present on full path runbooks", () => {
    const allow = getAgentToolAllowlist("inspect_explain", "full");
    assert.ok(allow);
    for (const core of CORE_AGENT_TOOLS) {
      assert.ok(allow!.includes(core), `missing core tool ${core}`);
    }
  });
});
