import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BubbleSelector } from '../components/BubbleSelector';
import { useAuth } from '../hooks/useAuth';
import { useChatStore } from '../stores/chatStore';
import type { Topic } from '../types';

export function HomePage() {
  const { topics, loadTopics, startConversation, error } = useChatStore();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    void loadTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (topic: Topic | null) => {
    const conversation = await startConversation(topic ?? undefined);
    if (conversation) navigate(`/chat/${conversation.id}`);
  };

  return (
    <div className="space-y-8 py-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-800">
          {user ? `Hey ${user.username}, let's talk` : "Let's talk in English"}
        </h1>
        <p className="mt-2 text-slate-500">
          Pick a topic or just start typing — speaking is the only way to get better.
        </p>
      </div>

      <BubbleSelector topics={topics} onPick={pick} />

      {error && <p className="text-center text-sm text-rose-600">{error}</p>}
    </div>
  );
}
