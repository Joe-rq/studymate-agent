import { useState, useEffect, useRef } from 'react';
import { api, type BuddyStateResponse } from '../api';
import Mascot from '../components/Mascot';
import { EmptyState, ErrorState } from '../components/Feedback';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function BuddyChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [characterName, setCharacterName] = useState('搭子');
  const [characterId, setCharacterId] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<BuddyStateResponse>('/buddy/state').then((data) => {
      setCharacterName(data.character?.name ?? '搭子');
      setCharacterId(data.character?.id);
      const history = data.recentHistory.map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      }));
      setMessages(history);
    }).catch((e) => setLoadError(e.message))
    .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setSending(true);

    try {
      const { reply } = await api.post<{ reply: string }>('/buddy/chat', { message: text });
      setMessages((prev) => [...prev, { role: 'assistant', content: reply || '...' }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '（网络开小差了，稍后再试～）' }]);
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => window.location.reload()} />;
  }

  return (
    <div className="chat-page">
      <h2 className="page-title">和{characterName}聊天</h2>

      <div className="chat-messages">
        {messages.length === 0 && !sending && loaded && (
          <EmptyState
            characterId={characterId}
            mood="thinking"
            title={`和${characterName}聊点什么吧`}
            hint="可以聊聊今天的复习、遇到的难题，或者只是吐槽一下。"
          />
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-row ${msg.role} fade-in-up`}>
            {msg.role === 'assistant' && (
              <div className="chat-avatar">
                <Mascot characterId={characterId} mood="default" size={34} />
              </div>
            )}
            <div className={`chat-bubble ${msg.role}`}>{msg.content}</div>
          </div>
        ))}
        {sending && (
          <div className="chat-row assistant">
            <div className="chat-avatar">
              <Mascot characterId={characterId} mood="thinking" size={34} />
            </div>
            <div className="chat-bubble assistant" style={{ opacity: 0.7 }}>
              {characterName}正在思考...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`对${characterName}说点什么...`}
          disabled={sending}
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={sending || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}
