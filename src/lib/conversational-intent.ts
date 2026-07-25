const CONVERSATIONAL_PROMPT = /^(?:(?:um+|hey)\s+)?(?:hi|hello|hey|how are you|thanks|thank you|ok|okay|cool|nice|great|explain\b.*|what is\b.*|what changed\b.*|summari[sz]e\b.*|describe\b.*|tell me\b.*|casual conversation|general chat\b.*)$/i;

export function isConversationalPrompt(prompt: string): boolean {
  const normalized = prompt
    .toLowerCase()
    .replace(/[^\w\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.length > 0 && CONVERSATIONAL_PROMPT.test(normalized);
}
