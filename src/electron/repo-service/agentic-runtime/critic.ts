import type { ToolExecutionRecord } from "../../evidence-pack";
import type { RepoSnapshot } from "../workspace";
import type { AssistantRunOptions, ToolEvent } from "../../../contracts/chat";
import { requestRainyChatCompletion } from "../../rainy-service";
import { appendVerificationWarnings, buildCriticReviewPrompt, buildCriticRevisionPrompt, criticFoundMajorIssue, verifyCriticLoop } from "../../critic-loop";
import { normalizeAssistantText } from "./helpers";

export async function finalizeCriticLoop({
  apiKey,
  model,
  options,
  snapshot,
  events,
  toolExecutions,
  prompt,
  finalContent,
  emitProgress,
  serviceTier,
}: {
  apiKey: string;
  model: string;
  options: AssistantRunOptions;
  snapshot: RepoSnapshot;
  events: ToolEvent[];
  toolExecutions: ToolExecutionRecord[];
  prompt: string;
  finalContent: string;
  emitProgress: (content?: string, thought?: string) => void;
  serviceTier?: AssistantRunOptions["serviceTier"];
}): Promise<string> {
  if (options.mode !== "critic_loop") {
    return finalContent;
  }

  events.push({
    id: "step-critic-review",
    label: "Critic review",
    detail: "Reviewing final draft against existing evidence without tools.",
    status: "active",
  });
  emitProgress(finalContent);

  const criticInput = {
    workspacePath: snapshot.workspace.path,
    prompt,
    finalContent,
    statusLines: snapshot.statusLines,
    events,
    toolExecutions,
  };
  const criticResponse = await requestRainyChatCompletion({
    apiKey,
    model,
    messages: [
      { role: "system", content: "You are a strict internal critic. Do not call tools." },
      { role: "user", content: buildCriticReviewPrompt(criticInput) },
    ],
    serviceTier,
  });
  const criticNotes = normalizeAssistantText(
    criticResponse.choices[0]?.message?.content,
  );
  const criticEvent = events.find((event) => event.id === "step-critic-review");
  if (criticEvent) {
    criticEvent.status = "done";
    criticEvent.detail = criticFoundMajorIssue(criticNotes)
      ? "Major issue found; forcing revision before final response."
      : "No major issue found.";
  }
  emitProgress(finalContent);

  let reviewedContent = finalContent;
  if (criticFoundMajorIssue(criticNotes)) {
    events.push({
      id: "step-critic-revision",
      label: "Critic revision",
      detail: "Revising final answer to remove unsupported or risky claims.",
      status: "active",
    });
    emitProgress(finalContent);

    const revisionResponse = await requestRainyChatCompletion({
      apiKey,
      model,
      messages: [
        { role: "system", content: "You revise final answers using only supplied evidence." },
        { role: "user", content: buildCriticRevisionPrompt(finalContent, criticNotes) },
      ],
      serviceTier,
    });
    reviewedContent =
      normalizeAssistantText(revisionResponse.choices[0]?.message?.content).trim() ||
      finalContent;
    const revisionEvent = events.find((event) => event.id === "step-critic-revision");
    if (revisionEvent) {
      revisionEvent.status = "done";
      revisionEvent.detail = "Revision completed.";
    }
  }

  events.push({
    id: "step-critic-verifier",
    label: "Verifier check",
    detail: "Checking validation state, modified files, claimed files, and executed commands.",
    status: "active",
  });
  emitProgress(reviewedContent);

  const verification = await verifyCriticLoop({
    ...criticInput,
    finalContent: reviewedContent,
  });
  const verifierEvent = events.find((event) => event.id === "step-critic-verifier");
  if (verifierEvent) {
    verifierEvent.status = verification.warnings.length > 0 ? "error" : "done";
    verifierEvent.detail =
      verification.warnings.length > 0
        ? verification.warnings.join(" ")
        : "Verifier checks passed.";
  }

  return appendVerificationWarnings(reviewedContent, verification);
}
