import type { AssistantExecution } from '../contracts/chat';
import { chatStream } from '../lib/openai';
import { createId } from '../lib/id';

export async function runAssistant(prompt: string, history: string[]): Promise<AssistantExecution> {
  const fullPrompt = history.length > 0 ? history.join('\n') + '\n\nUser: ' + prompt : prompt;
  let fullResponse = '';

  await chatStream(fullPrompt, (chunk) => {
    fullResponse += chunk;
  });

  return {
    message: {
      id: createId('assistant'),
      role: 'assistant',
      content: fullResponse,
      createdAt: new Date().toISOString(),
    },
    suggestedTitle: undefined,
  };
}
