import { create } from 'zustand';
import * as chatApi from '../api/chat';
import type { Conversation, Message, Topic } from '../types';

/** Ids of the turn that just completed; the caller scores against them (3.2.6). */
export interface SendResult {
  userMessageId: number | null;
  assistantMessageId: number | null;
}

interface ChatState {
  topics: Topic[];
  conversations: Conversation[];
  current: Conversation | null;
  messages: Message[];
  streamingText: string;
  isTyping: boolean;
  error: string | null;

  loadTopics: () => Promise<void>;
  loadConversations: () => Promise<void>;
  startConversation: (topic?: Topic, scene?: string) => Promise<Conversation | null>;
  openConversation: (id: number) => Promise<void>;
  send: (content: string) => Promise<SendResult>;
  stop: () => void;
  reset: () => void;
}

let abort: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  topics: [],
  conversations: [],
  current: null,
  messages: [],
  streamingText: '',
  isTyping: false,
  error: null,

  loadTopics: async () => {
    if (get().topics.length) return;
    try {
      set({ topics: await chatApi.fetchTopics() });
    } catch (err) {
      set({ error: errMessage(err) });
    }
  },

  loadConversations: async () => {
    try {
      set({ conversations: await chatApi.listConversations() });
    } catch (err) {
      set({ error: errMessage(err) });
    }
  },

  startConversation: async (topic, scene) => {
    try {
      const conversation = await chatApi.createConversation(topic?.label, scene ?? topic?.key);
      set({
        current: conversation,
        messages: [],
        streamingText: '',
        error: null,
      });
      await get().loadConversations();
      return conversation;
    } catch (err) {
      set({ error: errMessage(err) });
      return null;
    }
  },

  openConversation: async (id) => {
    const match = get().conversations.find((c) => c.id === id);
    try {
      const messages = await chatApi.fetchMessages(id);
      set({ current: match ?? null, messages, streamingText: '', error: null });
    } catch (err) {
      set({ error: errMessage(err) });
    }
  },

  // Scoring deliberately happens in the caller: a score belongs to a specific
  // message, and only the page knows where to hang it (产品规划 3.2.6).
  send: async (content) => {
    const conversation = get().current;
    if (!conversation || get().isTyping) return { userMessageId: null, assistantMessageId: null };

    // Optimistic user bubble; the server already persisted this turn before streaming.
    const placeholder: Message = {
      id: -Date.now(),
      conversation_id: conversation.id,
      role: 'user',
      content,
      feedback: null,
      sequence: get().messages.length + 1,
      created_at: new Date().toISOString(),
    };
    set({ messages: [...get().messages, placeholder], isTyping: true, streamingText: '', error: null });

    abort = new AbortController();
    let acc = '';
    const ids: SendResult = { userMessageId: null, assistantMessageId: null };
    try {
      await chatApi.streamMessage(
        conversation.id,
        content,
        {
          onDelta: (text) => {
            acc += text;
            set({ streamingText: acc });
          },
          onDone: (messageId, userMessageId) => {
            set({ isTyping: false, streamingText: '' });
            ids.assistantMessageId = messageId;
            ids.userMessageId = userMessageId ?? null;
            void get().openConversation(conversation.id);
          },
          onError: (detail) => {
            set({ isTyping: false, streamingText: '', error: detail });
          },
        },
        abort.signal,
      );
      if (get().isTyping) {
        set({ isTyping: false });
        void get().openConversation(conversation.id);
      }
    } catch (err) {
      set({ isTyping: false, streamingText: '', error: errMessage(err) });
    } finally {
      abort = null;
    }
    return ids;
  },

  stop: () => {
    abort?.abort();
    abort = null;
    set({ isTyping: false, streamingText: '' });
  },

  reset: () => set({ current: null, messages: [], streamingText: '', error: null }),
}));

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed';
}
