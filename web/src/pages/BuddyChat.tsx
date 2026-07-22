import { useState, useEffect, useRef } from 'react';
import { api, type BuddyStateResponse } from '../api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function BuddyChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [characterName, setCharacterName] = useState('搭子');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<BuddyStateResponse>('/buddy/state').then((data) => {
      setCharacterName(data.character?.name ?? '搭子');
      const history = data.recentHistory.map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      }));
      setMessages(history);
    }).catch(() => {});
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
      setMessages((prev) => [...prev, { role: 'assistant', content: '（网络错误，请重试）' }]);
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <h2 className="page-title">和{characterName}聊天</h2>

      <div className="chat-messages" style={{ flex: 1 }}>
        {messages.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: 40 }}>
            开始和{characterName}聊天吧！
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {sending && (
          <div className="chat-bubble assistant" style={{ opacity: 0.6 }}>
            {characterName}正在思考...
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
