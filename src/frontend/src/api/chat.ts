import { api } from './request';
import type { ChatReply, Conversation, Message, Topic } from '../types';

export async function fetchTopics(): Promise<Topic[]> {
  const { data } = await api.get<Topic[]>('/chat/topics');
  return data;
}

export async function createConversation(topic?: string, scene?: string): Promise<Conversation> {
  const { data } = await api.post<Conversation>('/chat/conversations', {
    topic: topic ?? null,
    scene: scene ?? null,
  });
  return data;
}

export async function listConversations(): Promise<Conversation[]> {
  const { data } = await api.get<Conversation[]>('/chat/conversations');
  return data;
}

export async function fetchMessages(conversationId: number): Promise<Message[]> {
  const { data } = await api.get<Message[]>(`/chat/conversations/${conversationId}/messages`);
  return data;
}

/** Soft delete: the conversation stays restorable server-side for 7 days. */
export async function deleteConversation(conversationId: number): Promise<void> {
  await api.delete(`/chat/conversations/${conversationId}`);
}

export async function listTrash(): Promise<Conversation[]> {
  const { data } = await api.get<Conversation[]>('/chat/conversations/trash');
  return data;
}

export async function restoreConversation(conversationId: number): Promise<Conversation> {
  const { data } = await api.post<Conversation>(`/chat/conversations/${conversationId}/restore`);
  return data;
}

export async function sendMessage(
  conversationId: number,
  content: string,
  fromVoice = false,
): Promise<ChatReply> {
  const { data } = await api.post<ChatReply>(`/chat/conversations/${conversationId}/messages`, {
    content,
    from_voice: fromVoice,
  });
  return data;
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  /** Assistant turn id plus the learner's own turn id, which free-speech scoring needs. */
  onDone: (messageId: number, userMessageId?: number) => void;
  onError: (detail: string) => void;
}

/**
 * POST + ReadableStream instead of EventSource, because the learner turn has to
 * go in a request body and EventSource only does GET.
 */
export async function streamMessage(
  conversationId: number,
  content: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem('token');
  const response = await fetch(`/api/chat/conversations/${conversationId}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content, from_voice: false }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    handlers.onError(detail || `Request failed (${response.status})`);
    return;
  }
  if (!response.body) {
    handlers.onError('Streaming is not supported by this browser');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      handleFrame(frame, handlers);
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function handleFrame(frame: string, handlers: StreamHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  const raw = dataLines.join('\n');

  try {
    const parsed = JSON.parse(raw) as {
      text?: string;
      message_id?: number;
      user_message_id?: number;
      detail?: string;
    };
    if (event === 'delta' && parsed.text) handlers.onDelta(parsed.text);
    else if (event === 'done' && parsed.message_id)
      handlers.onDone(parsed.message_id, parsed.user_message_id);
    else if (event === 'error') handlers.onError(parsed.detail ?? 'Generation failed');
  } catch {
    // Ignore malformed frames rather than aborting the whole reply.
  }
}
