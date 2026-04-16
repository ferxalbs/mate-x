import OpenAI from 'openai';

import { MATE_AGENT_SYSTEM_PROMPT } from '../config/mate-agent';
import {
  RAINY_API_BASE_URL,
  RAINY_REQUEST_TIMEOUT_MS,
  resolveRainyApiMode,
} from '../config/rainy';

function createRainyClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: RAINY_API_BASE_URL,
  });
}

function buildChatCompletionsInput(userContext: string) {
  return [
    { role: 'system' as const, content: MATE_AGENT_SYSTEM_PROMPT },
    { role: 'user' as const, content: userContext },
  ];
}

function buildResponsesInput(userContext: string) {
  return [
    {
      role: 'system' as const,
      content: [{ type: 'input_text' as const, text: MATE_AGENT_SYSTEM_PROMPT }],
    },
    {
      role: 'user' as const,
      content: [{ type: 'input_text' as const, text: userContext }],
    },
  ];
}

export async function requestRainyTextResponse(params: {
  apiKey: string;
  userContext: string;
  model: string;
}): Promise<string> {
  const client = createRainyClient(params.apiKey);
  const apiMode = resolveRainyApiMode(params.model);

  if (apiMode === 'responses') {
    const response = await client.responses.create(
      {
        model: params.model,
        input: buildResponsesInput(params.userContext),
      },
      { timeout: RAINY_REQUEST_TIMEOUT_MS },
    );

    return response.output_text.trim();
  }

  const response = await client.chat.completions.create(
    {
      model: params.model,
      messages: buildChatCompletionsInput(params.userContext),
    },
    { timeout: RAINY_REQUEST_TIMEOUT_MS },
  );

  return response.choices[0]?.message?.content?.trim() ?? '';
}
