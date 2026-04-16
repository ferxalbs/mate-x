import type { Conversation } from '../../contracts/chat';
import type { WorkspaceSummary } from '../../contracts/workspace';

export function buildThreadTitle(prompt: string) {
  const collapsed = prompt.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 42) {
    return collapsed;
  }
  return `${collapsed.slice(0, 39).trimEnd()}...`;
}

export function getConversationPreview(conversation: Conversation) {
  const latestMessage = conversation.messages.at(-1);
  if (!latestMessage) {
    return 'Start a new thread';
  }
  return latestMessage.content.replace(/\s+/g, ' ').trim();
}

export function getWorkspaceFact(workspace: WorkspaceSummary | null, label: string) {
  return workspace?.facts.find((fact) => fact.label === label)?.value ?? null;
}

export function formatRelativeTimestamp(input: string) {
  const timestamp = new Date(input).getTime();
  const deltaMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (deltaMinutes < 1) {
    return 'just now';
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}
