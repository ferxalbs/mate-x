import type { ExecutionOutcome } from "../../../contracts/execution";

interface VerifiedScopePresentation {
  count: number | null;
  label: string;
  naturalSubject: string;
}

export function getTerminalAssistantResponse(outcome: ExecutionOutcome) {
  const changedCount = getChangedFileCount(outcome);
  const changedSubject = getChangedFileSubject(outcome, changedCount);
  const objective = getObjectivePresentation(outcome);
  const checksSentence = getPassedChecksSentence(outcome);
  const unavailableSentence = getUnavailableCheckSentence(outcome);

  switch (outcome.completionKind) {
    case "already_satisfied":
      return [
        "The requested state was already present.",
        objective.verificationSentence,
        objective.allowedMatchSentence,
        checksSentence,
        "No files were changed.",
      ].filter(Boolean).join(" ");
    case "changed_verified":
      return [
        `Updated ${changedCount} ${changedSubject} to the requested repository state.`,
        objective.followUpSentence,
        checksSentence,
      ].filter(Boolean).join(" ");
    case "changed_unverified":
      return [
        `Updated ${changedCount} ${changedSubject}.`,
        objective.followUpSentence,
        checksSentence,
        unavailableSentence,
        "Review the diff before shipping.",
      ].filter(Boolean).join(" ");
    case "awaiting_approval":
      return "I need your approval before I can continue. No repository changes were made.";
    case "blocked":
      return changedCount > 0
        ? "I couldn’t complete the task because the required repository evidence was incomplete. Review the partial changes before continuing."
        : "I couldn’t complete the task because the required repository evidence was unavailable. No files were changed.";
    case "failed":
      return changedCount > 0
        ? "The task stopped before completion. Review the partial changes before trying again."
        : "The task stopped before completion. No files were changed.";
    case "validation_completed":
      return checksSentence || "The requested repository checks completed.";
    case "inspection_completed":
    default:
      return [
        objective.verificationSentence || "I inspected the requested repository state.",
        checksSentence,
      ].filter(Boolean).join(" ");
  }
}

export function getOutcomeEvidenceRow(outcome: ExecutionOutcome) {
  const changedCount = getChangedFileCount(outcome);
  const scope = getVerifiedScope(outcome);
  const checks = getPassedChecksLabel(outcome);
  const unavailable = isValidationUnavailable(outcome)
    ? "1 check unavailable"
    : null;

  return [
    `${changedCount} ${changedCount === 1 ? "file" : "files"} changed`,
    scope.label,
    checks,
    unavailable,
  ].filter(Boolean).join(" · ");
}

export function getTerminalActivityEvidence(outcome: ExecutionOutcome) {
  const verification = outcome.evidence.objective?.verification;
  return {
    repositoryVerified:
      verification?.status === "satisfied" &&
      verification.coverage === "complete",
    passedChecksLabel: getPassedChecksLabel(outcome),
  };
}

function getObjectivePresentation(outcome: ExecutionOutcome) {
  const verification = outcome.evidence.objective?.verification;
  const scope = getVerifiedScope(outcome);
  const forbiddenPassed = verification?.assertions.some(
    (assertion) =>
      assertion.kind === "forbidden_pattern_absent" &&
      assertion.status === "passed",
  );
  const allowed = verification?.assertions.find(
    (assertion) =>
      assertion.kind === "allowed_match_only" &&
      assertion.status === "passed" &&
      assertion.matches.length > 0,
  );
  const verified =
    verification?.status === "satisfied" &&
    verification.coverage === "complete";
  const verificationSubject = scope.naturalSubject;
  const verificationSentence = verified
    ? `I verified ${verificationSubject}${forbiddenPassed ? " and confirmed no prohibited runtime calls remain" : ""}.`
    : "";
  const followUpSentence = verified
    ? `Follow-up repository verification${forbiddenPassed ? " confirmed no prohibited runtime calls remain" : " passed"}.`
    : "";
  const allowedMatchSentence = allowed
    ? allowed.matches.length === 1
      ? `The remaining legacy reference is confined to an allowed declaration or compatibility stub.`
      : `The remaining legacy references are confined to allowed declarations or compatibility stubs.`
    : "";

  return {
    allowedMatchSentence,
    followUpSentence,
    verificationSentence,
  };
}

function getVerifiedScope(outcome: ExecutionOutcome): VerifiedScopePresentation {
  const verification = outcome.evidence.objective?.verification;
  if (
    verification?.status !== "satisfied" ||
    verification.coverage !== "complete"
  ) {
    return { count: null, label: "", naturalSubject: "the relevant repository files" };
  }

  const requiredAssertion = verification.assertions.find(
    (assertion) =>
      assertion.kind === "required_pattern_present" &&
      assertion.status === "passed",
  );
  const matchedPaths = new Set(
    requiredAssertion?.matches.map((match) => match.path) ?? [],
  );
  if (matchedPaths.size === 0) {
    return {
      count: null,
      label: "Repository verified",
      naturalSubject: "the relevant repository files",
    };
  }

  const isServiceScope = requiredAssertion?.scope.includes(
    "semantic:runtime_service",
  );
  const noun = isServiceScope
    ? matchedPaths.size === 1 ? "service" : "services"
    : matchedPaths.size === 1 ? "file" : "files";
  return {
    count: matchedPaths.size,
    label: `${matchedPaths.size} ${noun} verified`,
    naturalSubject: isServiceScope
      ? `the ${matchedPaths.size} runtime ${matchedPaths.size === 1 ? "service" : "services"}`
      : `the ${matchedPaths.size} relevant ${matchedPaths.size === 1 ? "file" : "files"}`,
  };
}

function getChangedFileCount(outcome: ExecutionOutcome) {
  return (outcome.files ?? outcome.evidence.changedFiles).length;
}

function getChangedFileSubject(outcome: ExecutionOutcome, count: number) {
  const paths = outcome.evidence.changedFiles.map((file) => file.path);
  const allServices =
    paths.length > 0 &&
    paths.every((path) => /(?:^|[/._-])services?(?:[/._-]|$)/i.test(path));
  if (allServices) return count === 1 ? "service file" : "service files";
  return count === 1 ? "file" : "files";
}

function getPassedChecksLabel(outcome: ExecutionOutcome) {
  const signals = getPassedSignals(outcome);
  if (signals.length === 0) {
    return outcome.evidence.validation.status === "passed"
      ? "Checks passed"
      : null;
  }
  if (signals.length > 1) return "Checks passed";
  switch (signals[0]) {
    case "test":
      return "Tests passed";
    case "typecheck":
      return "Typecheck passed";
    case "lint":
      return "Lint passed";
    case "build":
      return "Build passed";
    default:
      return "Checks passed";
  }
}

function getPassedChecksSentence(outcome: ExecutionOutcome) {
  const label = getPassedChecksLabel(outcome);
  if (!label) return "";
  if (label === "Tests passed") return "Focused tests passed.";
  return `${label}.`;
}

function getPassedSignals(outcome: ExecutionOutcome) {
  return [...new Set(
    (outcome.evidence.validation.contract?.items ?? [])
      .filter((item) => item.evidence?.status === "passed")
      .map((item) => item.signal),
  )];
}

function isValidationUnavailable(outcome: ExecutionOutcome) {
  return outcome.evidence.validation.status === "not_run" ||
    Boolean(outcome.evidence.validation.cause);
}

function getUnavailableCheckSentence(outcome: ExecutionOutcome) {
  switch (outcome.evidence.validation.cause) {
    case "TYPECHECK_UNAVAILABLE":
      return "This repository does not define a typecheck command, so that check could not run.";
    case "TOOLCHAIN_AMBIGUOUS":
      return "The repository toolchain is ambiguous, so a required check could not run.";
    case "VALIDATION_COMMAND_UNRESOLVED":
      return "A required repository check was unavailable.";
    default:
      return outcome.evidence.validation.status === "not_run"
        ? "A required repository check could not run."
        : "";
  }
}
