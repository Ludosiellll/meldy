import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Bot, Sparkles, BookOpen, Headphones } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function SharedMaterial() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [material, setMaterial] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMaterial() {
      try {
        const { data, error } = await supabase
          .from('materials')
          .select('*')
          .eq('id', id)
          .eq('is_public', true)
          .maybeSingle();

        if (error) throw error;
        setMaterial(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    if (id) loadMaterial();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!material) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
        <Bot className="w-16 h-16 text-slate-300 dark:text-slate-600 mb-4" />
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-200 mb-2">Материал не найден</h2>
        <p className="text-slate-500 dark:text-slate-400 mb-8">Возможно, ссылка устарела или автор закрыл к нему доступ.</p>
        <button onClick={() => navigate('/')} className="px-6 py-3 bg-cyan-300 text-slate-950 font-semibold rounded-lg hover:bg-cyan-200 transition-colors">На главную</button>
      </div>
    );
  }

  const cheatsheet = material.summary_json?.cheatsheet;

  const extractCleanContent = (data: any): string => {
    if (!data) return '';
    let raw = data.content || data.raw || '';
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.content) raw = parsed.content;
      } catch (e) {
        const match = raw.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
        if (match) raw = match[1];
      }
    }
    return raw;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 sm:p-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-cyan-300 rounded-lg flex items-center justify-center">
            <Bot className="w-6 h-6 text-slate-950" />
          </div>
          <div>
            <h1 className="font-black text-slate-900 dark:text-white text-lg">StudyForge</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-wide uppercase">Общий материал</p>
          </div>
        </div>
        <button onClick={() => navigate('/register')} className="px-4 py-2 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-800 dark:text-cyan-300 font-semibold rounded-lg text-sm hover:bg-cyan-100 dark:hover:bg-cyan-950/50 transition-colors">
          Создать свой
        </button>
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full p-4 sm:p-6 space-y-6">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mb-2">{material.title}</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Сгенерировано ИИ на основе лекции
          </p>
        </div>

        {cheatsheet ? (
          <div className="bg-slate-900 dark:bg-slate-800/80 text-white rounded-2xl p-6 sm:p-8 shadow-xl border border-slate-200/10 dark:border-slate-800 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full blur-3xl pointer-events-none" />
            <p className="text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 uppercase tracking-widest mb-4 flex items-center gap-1.5">
              Краткий конспект
            </p>
            <div className="prose prose-invert max-w-none text-sm sm:text-base text-slate-300 leading-relaxed cheatsheet-style">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{cheatsheet}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
             <div className="prose dark:prose-invert max-w-none text-sm sm:text-base text-slate-700 dark:text-slate-300">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {extractCleanContent(material.summary_json) || material.original_text || ''}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="bg-[#091522] border border-white/10 rounded-xl p-6 sm:p-8 text-center text-white relative overflow-hidden mt-8">
           <div className="absolute top-0 left-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -ml-20 -mt-20 pointer-events-none" />
           <h3 className="text-2xl font-semibold mb-3">Подготовьте свой материал</h3>
           <p className="text-slate-300 max-w-md mx-auto mb-6 text-sm">Загрузите лекцию или учебник, чтобы получить конспект, карточки и тест со ссылками на источник.</p>
           <button onClick={() => navigate('/register')} className="px-8 py-3 bg-cyan-300 text-slate-950 font-semibold rounded-lg hover:bg-cyan-200 transition-colors">
             Создать материал
           </button>
        </div>
      </div>
    </div>
  );
}
