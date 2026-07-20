import type {
  ChatMessage,
  Conversation,
  ReproducibleRun,
  ToolEvent,
} from "../contracts/chat";

/** Keep a margin below the main-process IPC guard for JSON/encoding overhead. */
export const MAX_PERSISTED_CONVERSATION_SIZE = 1_800_000;

const MAX_PERSISTED_STRING_LENGTH = 4_000;
const MAX_PERSISTED_THOUGHT_LENGTH = 12_000;
const MAX_PERSISTED_EVENT_COUNT = 120;
const MAX_PERSISTED_ARTIFACT_COUNT = 40;
const MAX_PERSISTED_DECISION_COUNT = 40;

function truncate(value: string, maxLength = MAX_PERSISTED_STRING_LENGTH) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n… [truncated for local session storage]`;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncate(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 5) return "[omitted from local session storage]";

  if (Array.isArray(value)) {
    return value
      .slice(-MAX_PERSISTED_EVENT_COUNT)
      .map((item) => compactValue(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      compactValue(child, depth + 1),
    ]),
  );
}

function compactEvents(events: ToolEvent[] | undefined) {
  return events
    ?.slice(-MAX_PERSISTED_EVENT_COUNT)
    .map((event) => compactValue(event) as ToolEvent);
}

function compactMessage(message: ChatMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.thought
      ? { thought: truncate(message.thought, MAX_PERSISTED_THOUGHT_LENGTH) }
      : {}),
    ...(message.events ? { events: compactEvents(message.events) } : {}),
    ...(message.artifacts
      ? {
          artifacts: message.artifacts
            .slice(-MAX_PERSISTED_ARTIFACT_COUNT)
            .map(
              (artifact) =>
                compactValue(artifact) as NonNullable<ChatMessage["artifacts"]>[number],
            ),
        }
      : {}),
    ...(message.evidencePack
      ? {
          evidencePack: compactValue(message.evidencePack) as NonNullable<
            ChatMessage["evidencePack"]
          >,
        }
      : {}),
    // Working-set snippets are available in the run evidence and are too large
    // to duplicate in every persisted message.
  };
}

function compactRun(run: ReproducibleRun): ReproducibleRun {
  return {
    ...run,
    userIntent: truncate(run.userIntent, MAX_PERSISTED_THOUGHT_LENGTH),
    decisions: run.decisions
      .slice(-MAX_PERSISTED_DECISION_COUNT)
      .map((decision) => compactValue(decision) as ReproducibleRun["decisions"][number]),
    events: compactEvents(run.events) ?? [],
    artifacts: run.artifacts
      .slice(-MAX_PERSISTED_ARTIFACT_COUNT)
      .map((artifact) => compactValue(artifact) as ReproducibleRun["artifacts"][number]),
    result: run.result
      ? {
          ...run.result,
          summary: truncate(run.result.summary, MAX_PERSISTED_THOUGHT_LENGTH),
          // The full evidence pack is already stored on the assistant message.
          evidencePack: undefined,
        }
      : undefined,
  };
}

function compactConversation(thread: Conversation): Conversation {
  return {
    id: thread.id,
    title: truncate(thread.title, 500),
    lastUpdatedAt: thread.lastUpdatedAt,
    ...(thread.isArchived ? { isArchived: true } : {}),
    messages: thread.messages.map(compactMessage),
    ...(thread.runs ? { runs: thread.runs.map(compactRun) } : {}),
  };
}

function compactConversationCore(
  thread: Conversation,
  maxMessageLength: number,
): Conversation {
  return {
    id: thread.id,
    title: truncate(thread.title, 500),
    lastUpdatedAt: thread.lastUpdatedAt,
    ...(thread.isArchived ? { isArchived: true } : {}),
    messages: thread.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: truncate(message.content, maxMessageLength),
      createdAt: message.createdAt,
    })),
  };
}

function serializedSize(value: Conversation[]) {
  return JSON.stringify(value).length;
}

function fitCoreSnapshot(
  threads: Conversation[],
  activeThreadId: string,
): Conversation[] {
  const byRecency = threads.toSorted(
    (left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt),
  );
  const active = byRecency.find((thread) => thread.id === activeThreadId);
  const fitThread = (thread: Conversation): Conversation => {
    const base = { ...thread, messages: [] };
    const fittedMessages: Conversation["messages"] = [];
    let size = JSON.stringify(base).length;

    for (const message of thread.messages.toReversed()) {
      const messageSize = JSON.stringify(message).length;
      const separatorSize = fittedMessages.length > 0 ? 1 : 0;
      if (size + separatorSize + messageSize > MAX_PERSISTED_CONVERSATION_SIZE) {
        continue;
      }
      fittedMessages.push(message);
      size += separatorSize + messageSize;
    }

    return { ...base, messages: fittedMessages.toReversed() };
  };
  const ordered = active
    ? [fitThread(active), ...byRecency.filter((thread) => thread.id !== activeThreadId)]
    : byRecency;
  const selected: Conversation[] = [];
  let selectedSize = 2;

  for (const thread of ordered) {
    const threadSize = JSON.stringify(thread).length;
    const separatorSize = selected.length > 0 ? 1 : 0;
    if (selectedSize + separatorSize + threadSize <= MAX_PERSISTED_CONVERSATION_SIZE) {
      selected.push(thread);
      selectedSize += separatorSize + threadSize;
    }
  }

  return selected.length > 0 ? selected : ordered[0] ? [fitThread(ordered[0])] : [];
}

/**
 * Prepare renderer state for durable storage without dropping normal chat
 * history. Tool traces and run records contain duplicated, potentially huge
 * command output, so they are bounded before crossing the IPC boundary.
 */
export function compactConversationSnapshotForPersistence(
  threads: Conversation[],
  activeThreadId: string,
): Conversation[] {
  const richSnapshot = threads.map(compactConversation);
  if (serializedSize(richSnapshot) <= MAX_PERSISTED_CONVERSATION_SIZE) {
    return richSnapshot;
  }

  const mediumSnapshot = threads.map((thread) =>
    compactConversationCore(thread, 16_000),
  );
  if (serializedSize(mediumSnapshot) <= MAX_PERSISTED_CONVERSATION_SIZE) {
    return mediumSnapshot;
  }

  const smallSnapshot = threads.map((thread) => compactConversationCore(thread, 4_000));
  if (serializedSize(smallSnapshot) <= MAX_PERSISTED_CONVERSATION_SIZE) {
    return smallSnapshot;
  }

  return fitCoreSnapshot(
    threads.map((thread) => compactConversationCore(thread, 1_200)),
    activeThreadId,
  );
}
