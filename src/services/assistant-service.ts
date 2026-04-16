import type { AssistantExecution } from '../contracts/chat';
import { runAssistant as runAssistantViaIpc } from './repo-client';

export async function runAssistant(prompt: string, history: string[]): Promise<AssistantExecution> {
  return runAssistantViaIpc(prompt, history);
}
