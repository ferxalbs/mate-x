const CONVERSATIONAL_PROMPT = /^(?:(?:um+|hey)\s+)?(?:hi|hello|hey|how are you|thanks|thank you|ok|okay|cool|nice|great|explain\b.*|what is\b.*|what changed\b.*|summari[sz]e\b.*|describe\b.*|tell me\b.*|casual conversation|general chat\b.*)$/i;
const GREETING_PROMPT = /^(?:(?:um+|hey)\s+)?(?:hi|hello|hey|how are you)$/i;
const THANKS_PROMPT = /^(?:thanks|thank you)$/i;
const ACKNOWLEDGEMENT_PROMPT = /^(?:ok|okay|cool|nice|great)$/i;

function normalizeConversationalPrompt(prompt: string) {
  return prompt
    .toLowerCase()
    .replace(/[^\w\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isConversationalPrompt(prompt: string): boolean {
  const normalized = normalizeConversationalPrompt(prompt);

  return normalized.length > 0 && CONVERSATIONAL_PROMPT.test(normalized);
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
