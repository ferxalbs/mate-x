const GREETING_PROMPT = /^(?:(?:um+|hey)\s+)?(?:hi|hello|hey|how are you)\??$/i;
const THANKS_PROMPT = /^(?:thanks|thank you)$/i;
const ACKNOWLEDGEMENT_PROMPT = /^(?:ok|okay|cool|nice|great)$/i;
const GENERAL_QUESTION_PROMPT = /^(?:explain\b.*|what (?:is|does|are)\b.*|summari[sz]e\b.*|describe\b.*|tell me\b.*|how (?:is|does|do|are)\b.*|casual conversation|general chat\b.*)$/i;
const REPOSITORY_REFERENCE = /\b(?:repo|repository|codebase|project|workspace)\b/i;
const CONTEXTUAL_REPOSITORY_REFERENCE = /\barchitecture\b|\b(?:this|the|current|our)\s+(?:app|application|source|implementation|files?|code)\b|\b(?:app|application|source|implementation|files?|code)\b(?=\s+(?:overview|structure|structured|entry points?|execution flow)\b)/i;
const REPOSITORY_QUESTION = /^(?:explain\b|summari[sz]e\b|describe\b|tell me\b|what (?:is|does|are|changed)\b|how (?:is|does|do|are)\b|where\b|which\b|why\b|show me\b|walk me through\b|give me (?:an? )?overview\b)/i;
const REPOSITORY_OVERVIEW = /\b(?:overview|structure|structured|architecture|entry points?|execution flow)\b/i;
const WORK_REQUEST = /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:fix|change|edit|implement|add|remove|delete|write|create|refactor|migrate|update|run|execute|test|validate|lint|build|commit|push)\b|\b(?:run|execute)\s+(?:the\s+)?(?:tests?|validation|lint|build|typecheck)\b/i;

function normalizeConversationalPrompt(prompt: string) {
  return prompt
    .toLowerCase()
    .replace(/[^\w\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isConversationalPrompt(
  prompt: string,
  options: { hasActiveWorkspace?: boolean } = {},
): boolean {
  const normalized = normalizeConversationalPrompt(prompt);

  return normalized.length > 0 &&
    !isRepositoryGroundedQuestion(normalized, options) &&
    !isRepositoryWorkRequest(normalized) && (
    isPureSocialPrompt(normalized) ||
    GENERAL_QUESTION_PROMPT.test(normalized)
  );
}

export function isPureSocialPrompt(prompt: string): boolean {
  const normalized = normalizeConversationalPrompt(prompt);

  return normalized.length > 0 && (
    GREETING_PROMPT.test(normalized) ||
    THANKS_PROMPT.test(normalized) ||
    ACKNOWLEDGEMENT_PROMPT.test(normalized)
  );
}

export function isRepositoryWorkRequest(prompt: string): boolean {
  const normalized = normalizeConversationalPrompt(prompt);

  return normalized.length > 0 && WORK_REQUEST.test(normalized);
}

export function isRepositoryGroundedQuestion(
  prompt: string,
  options: { hasActiveWorkspace?: boolean } = {},
): boolean {
  const normalized = normalizeConversationalPrompt(prompt);
  if (
    normalized.length === 0 ||
    isPureSocialPrompt(normalized) ||
    isRepositoryWorkRequest(normalized)
  ) {
    return false;
  }

  const asksForRepositoryExplanation =
    REPOSITORY_QUESTION.test(normalized) ||
    REPOSITORY_OVERVIEW.test(normalized);
  if (!asksForRepositoryExplanation) {
    return false;
  }

  if (REPOSITORY_REFERENCE.test(normalized)) {
    return true;
  }

  return options.hasActiveWorkspace === true && (
    CONTEXTUAL_REPOSITORY_REFERENCE.test(normalized) ||
    /^what changed\b/i.test(normalized)
  );
}

export function isRepositoryOverviewRequest(
  prompt: string,
  options: { hasActiveWorkspace?: boolean } = {},
): boolean {
  const normalized = normalizeConversationalPrompt(prompt);
  if (!isRepositoryGroundedQuestion(normalized, options)) {
    return false;
  }

  return (
    /^(?:explain|summari[sz]e|describe|tell me|walk me through|give me (?:an? )?overview)\b/i.test(normalized) ||
    /^(?:what does (?:this|the|our) (?:repo|repository|codebase|project|workspace|app|application) do|how is (?:this|the|our) (?:repo|repository|codebase|project|workspace|app|application) structured)\b/i.test(normalized) ||
    REPOSITORY_OVERVIEW.test(normalized)
  );
}

export function getRepositoryStartupProgressLabel(
  prompt: string,
  hasActiveWorkspace: boolean,
): string {
  return isRepositoryGroundedQuestion(prompt, { hasActiveWorkspace })
    ? "Understanding the repository"
    : "Preparing repository context";
}

export function getImmediateConversationalResponse(
  prompt: string,
  workspaceName: string,
): string | null {
  const normalized = normalizeConversationalPrompt(prompt);
  const workspace = workspaceName.trim() || "this repository";

  if (GREETING_PROMPT.test(normalized)) {
    return `Hey — what do you want to inspect or change in ${workspace}?`;
  }
  if (THANKS_PROMPT.test(normalized)) {
    return `You’re welcome. What do you want to inspect or change next in ${workspace}?`;
  }
  if (ACKNOWLEDGEMENT_PROMPT.test(normalized)) {
    return `Got it. What do you want to inspect or change in ${workspace}?`;
  }
  return null;
}
