import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getMaterials } from '../api/materials';

export default function Chat() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingHistory, setFetchingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    getMaterials(user.id).then(setMaterials).catch(console.error);
  }, [user]);

  // Загрузка истории при выборе материала
  useEffect(() => {
    if (!selectedId || !user) {
      setMessages([]);
      return;
    }

    const loadHistory = async () => {
      setFetchingHistory(true);
      const { data, error } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('material_id', selectedId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      
      if (!error && data) {
        setMessages(data);
      }
      setFetchingHistory(false);
    };

    loadHistory();
  }, [selectedId, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectedMaterial = materials.find(m => m.id === selectedId);
  
  // Контекст: берем либо оригинал, либо конспект (что есть)
  const getContext = () => {
    if (!selectedMaterial) return '';
    const original = selectedMaterial.original_text || '';
    const summary = typeof selectedMaterial.summary_json === 'string' 
      ? selectedMaterial.summary_json 
      : (selectedMaterial.summary_json?.content || '');
    
    // Если есть оригинал — берем его (он полнее), иначе конспект
    return (original.length > 50 ? original : summary).slice(0, 30000);
  };

  const handleSend = async () => {
    if (!input.trim() || !selectedId || !user || loading) return;
    
    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // 1. Сохраняем сообщение пользователя в БД
      await supabase.from('chat_messages').insert({
        user_id: user.id,
        material_id: selectedId,
        role: 'user',
        content: userMsg.content
      });

      // 2. Запрос к AI
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMsg.content, 
          context: getContext(), 
          history: messages.slice(-6) // Отправляем последние 6 сообщений для памяти
        }),
      });
      
      const data = await res.json();
      const assistantMsg = { role: 'assistant', content: data.reply };
      
      setMessages(prev => [...prev, assistantMsg]);

      // 3. Сохраняем ответ AI в БД
      await supabase.from('chat_messages').insert({
        user_id: user.id,
        material_id: selectedId,
        role: 'assistant',
        content: assistantMsg.content
      });

    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Ошибка при обращении к AI. Попробуйте снова.' }]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = async () => {
    if (!selectedId || !user || !confirm('Очистить историю чата?')) return;
    await supabase.from('chat_messages').delete().eq('material_id', selectedId).eq('user_id', user.id);
    setMessages([]);
  };

  return (
    <div className="h-full flex flex-col p-4 md:p-6 bg-slate-50/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">AI-чат</h1>
            <p className="text-xs text-slate-500">Задавайте вопросы по вашим материалам</p>
          </div>
        </div>
        
        {messages.length > 0 && (
          <button onClick={clearChat} className="p-2 text-slate-400 hover:text-rose-500 transition rounded-lg hover:bg-rose-50">
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Material select */}
      <div className="mb-4">
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="w-full md:w-72 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-sm"
        >
          <option value="">Выберите материал...</option>
          {materials.map(m => (
            <option key={m.id} value={m.id}>{m.title}</option>
          ))}
        </select>
      </div>

      {/* Chat area */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative">
        {!selectedId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-slate-900 font-semibold mb-1">Чат не выбран</h3>
            <p className="text-slate-500 text-sm max-w-xs">Выберите лекцию из списка выше, чтобы начать обсуждение с AI</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {fetchingHistory ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-12">
                  <div className="inline-block px-4 py-2 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium mb-3">
                    Конспект загружен в память
                  </div>
                  <p className="text-slate-400 text-sm">
                    Спросите что-нибудь о «{selectedMaterial?.title}»
                  </p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] md:max-w-[75%] p-3.5 text-sm rounded-2xl shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : 'bg-slate-100 border border-slate-200 text-slate-800 rounded-tl-none'
                      }`}
                    >
                      <div className="whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 border border-slate-200 rounded-2xl rounded-tl-none p-4 flex gap-1.5 shadow-sm">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-slate-50 border-t border-slate-200">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Напишите вопрос по материалу..."
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-sm bg-white"
                  disabled={loading}
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl transition disabled:opacity-50 shadow-md shadow-indigo-200 flex-shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
