import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';

export function useChat(conversationId?: number) {
  const store = useChatStore();

  useEffect(() => {
    if (conversationId && store.current?.id !== conversationId) {
      void store.openConversation(conversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (store.topics.length === 0) void store.loadTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return store;
}
