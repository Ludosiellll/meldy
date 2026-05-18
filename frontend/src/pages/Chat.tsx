import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getMaterials } from '../api/materials';

export default function Chat() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    getMaterials(user.id).then(setMaterials).catch(console.error);
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectedMaterial = materials.find(m => m.id === selectedId);
  const context = selectedMaterial?.original_text || 
                 (typeof selectedMaterial?.summary_json === 'string' ? selectedMaterial.summary_json : selectedMaterial?.summary_json?.content || '');

  const handleSend = async () => {
    if (!input.trim() || !selectedId || loading) return;
    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, context, history: messages }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Ошибка при обращении к AI. Попробуйте снова.' }]);
    }
    setLoading(false);
  };

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-600" />
          <h1 className="text-xl font-bold text-slate-900">AI-чат по материалам</h1>
        </div>
      </div>

      {/* Material select */}
      <select
        value={selectedId}
        onChange={e => { setSelectedId(e.target.value); setMessages([]); }}
        className="w-full max-w-md bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition mb-4"
      >
        <option value="">Выберите материал для обсуждения</option>
        {materials.map(m => (
          <option key={m.id} value={m.id}>{m.title}</option>
        ))}
      </select>

      {/* No material selected */}
      {!selectedId && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <MessageSquare className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400">Выберите материал чтобы начать диалог</p>
          </div>
        </div>
      )}

      {/* Chat area */}
      {selectedId && (
        <>
          <div className="flex-1 overflow-y-auto space-y-3 py-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-400 text-sm py-8">
                Задай вопрос по материалу «{selectedMaterial?.title}»
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] p-3 text-sm rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-tr-sm'
                      : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm p-3 flex gap-1">
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 pt-4 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Напишите вопрос..."
              className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl transition disabled:opacity-50"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}