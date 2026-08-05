import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  getRepositoryStartupProgressLabel,
  getImmediateConversationalResponse,
  isConversationalPrompt,
  isPureSocialPrompt,
  isRepositoryGroundedQuestion,
  isRepositoryOverviewRequest,
} from "./conversational-intent";
import { MATE_AGENT_SYSTEM_PROMPT } from "../config/mate-agent";

test("separates pure social prompts from general questions", () => {
  assert.equal(isPureSocialPrompt("Hi"), true);
  assert.equal(isPureSocialPrompt("Thanks"), true);
  assert.equal(isPureSocialPrompt("How are you?"), true);
  assert.equal(isConversationalPrompt("What is React?"), true);
  assert.equal(
    isRepositoryGroundedQuestion("What is application security?", {
      hasActiveWorkspace: true,
    }),
    false,
  );
  assert.equal(isConversationalPrompt("Fix the failing test"), false);
});

test("bounds only repository overview requests", () => {
  const activeWorkspace = { hasActiveWorkspace: true };
  assert.equal(isRepositoryOverviewRequest("Explain me the repo", activeWorkspace), true);
  assert.equal(isRepositoryOverviewRequest("Describe the architecture", activeWorkspace), true);
  assert.equal(isRepositoryOverviewRequest("How is this app structured?", activeWorkspace), true);
  assert.equal(isRepositoryOverviewRequest("Where is authentication handled?", activeWorkspace), false);
  assert.equal(isRepositoryOverviewRequest("Fix the code", activeWorkspace), false);
  assert.equal(isRepositoryOverviewRequest("Hi", activeWorkspace), false);
});

test("repository references take precedence over conversational wording", () => {
  const activeWorkspace = { hasActiveWorkspace: true };

  assert.equal(isRepositoryGroundedQuestion("Explain me the repo", activeWorkspace), true);
  assert.equal(isRepositoryGroundedQuestion("Summarize this codebase", activeWorkspace), true);
  assert.equal(isRepositoryGroundedQuestion("What does this project do?", activeWorkspace), true);
  assert.equal(isRepositoryGroundedQuestion("Describe the architecture", activeWorkspace), true);
  assert.equal(isRepositoryGroundedQuestion("Tell me about this workspace", activeWorkspace), true);
  assert.equal(isRepositoryGroundedQuestion("How is this app structured?", activeWorkspace), true);
  assert.equal(isRepositoryGroundedQuestion("What is React?", activeWorkspace), false);
  assert.equal(isRepositoryGroundedQuestion("Fix the code", activeWorkspace), false);
  assert.equal(isConversationalPrompt("Explain me the repo", activeWorkspace), false);
  assert.equal(
    getRepositoryStartupProgressLabel("Explain me the repo", true),
    "Understanding the repository",
  );
});

test("repository prompt contract forbids capability disclaimers and name speculation", () => {
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /never claim that you cannot inspect or access the repository/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /never speculate from a repository name/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /do not ask the user to paste files/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /repository explanation is read-only/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /do not edit files, execute validation/i);
});

test("repository prompt contract keeps explanations concise and temporal claims accurate", () => {
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /Default to 150-300 words/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /open with 1-2 sentences/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /2-4 architecture bullets/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /execution flow in one short paragraph or compact sequence/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /Do not create dedicated Inference or Unknowns sections by default/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /unless fresh typed evidence was produced during this run/i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /The latest recorded test run passed\. I did not rerun the tests during this inspection\./i);
  assert.match(MATE_AGENT_SYSTEM_PROMPT, /Never combine currently with recorded, historical, persisted, or prior-run evidence/i);
});

test("returns immediate local responses for social turns", () => {
  assert.equal(
    getImmediateConversationalResponse("Hi", "acme-demo"),
    "Hey — what do you want to inspect or change in acme-demo?",
  );
  assert.match(
    getImmediateConversationalResponse("Thanks!", "acme-demo") ?? "",
    /You’re welcome/,
  );
  assert.equal(
    getImmediateConversationalResponse("What changed?", "acme-demo"),
    null,
  );
});
