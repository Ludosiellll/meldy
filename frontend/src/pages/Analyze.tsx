import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import UploadZone from '../components/UploadZone';
import { Mic, Zap, BookOpen, AlertTriangle } from 'lucide-react';
import AgentCards from '../components/AgentCards';
import ResultsPanel from '../components/ResultsPanel';
import { AnalysisState, AgentStatus, DEFAULT_SETTINGS } from '../types';
import { DEMO_TEXT } from '../demo';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { syncFlashcards } from '../api/flashcards';
import { recordStudyActivity } from '../api/quests';
import { hasBadWords } from '../utils/moderation';
import toast from 'react-hot-toast';
import { checkAILimit, incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';

const initAgents: AgentStatus[] = [
  { id: 'summarizer', label: 'Конспект', status: 'idle', progress: 0 },
  { id: 'flashcards', label: 'Карточки', status: 'idle', progress: 0 },
  { id: 'quiz', label: 'Тест', status: 'idle', progress: 0 },
  { id: 'cheatsheet', label: 'Шпаргалка', status: 'idle', progress: 0 },
  { id: 'podcast', label: 'Разговор', status: 'idle', progress: 0 },
];

// Миссии больше не показываются в результатах, поэтому их не генерируем при анализе.
const SELECTABLE_AGENT_IDS = new Set(initAgents.map(a => a.id));

interface Toast {
  id: number;
  text: string;
}

export default function Analyze() {
  const [state, setState] = useState<AnalysisState>({
    phase: 'upload', agents: initAgents, results: null, settings: DEFAULT_SETTINGS,
  });
  const [isDemo, setIsDemo] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const analysisStartRef = useRef<number>(0);
  const sourceFileNameRef = useRef<string>('');
  const textLengthRef = useRef<number>(0);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { verifyEnergy } = useEnergyConfirm();

  const addToast = (text: string) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const handleUpload = async (file: File | null, url?: string) => {
    // ПРОВЕРКА ЛИМИТОВ ИИ перед сменой интерфейса
    if (user?.id) {
      const ok = await verifyEnergy(user.id, 20, 'Анализ материала');
      if (!ok) {
        return; // остаемся на экране загрузки
      }
    }

    analysisStartRef.current = Date.now();
    sourceFileNameRef.current = file ? file.name : (url ? url : 'Unknown');
    // Пустой список бэкенд понимает как «все агенты», включая миссии, поэтому подставляем набор по умолчанию.
    const selectedAgents = (state.settings.enabledAgents || []).filter(id => SELECTABLE_AGENT_IDS.has(id));
    const enabledAgents = selectedAgents.length > 0 ? selectedAgents : DEFAULT_SETTINGS.enabledAgents;
    const activeAgents = initAgents.filter(a => enabledAgents.includes(a.id));
    setState({ phase: 'extracting', agents: activeAgents.map(a => ({ ...a, status: 'idle' as const })), results: null, settings: state.settings, sourceFileName: sourceFileNameRef.current });
    
    const fd = new FormData();
    if (file) fd.append('file', file);
    if (url) fd.append('url', url);
    
    fd.append('summary_detail', state.settings.summaryDetail);
    fd.append('flashcard_count', String(state.settings.flashcardCount));
    fd.append('quiz_count', String(state.settings.quizCount));
    fd.append('quiz_difficulty', state.settings.quizDifficulty);
    fd.append('quiz_type', state.settings.quizType);
    fd.append('enabled_agents', JSON.stringify(enabledAgents));
    
    // Определяем эндпоинт в зависимости от типа
    const isMedia = file && (file.type.startsWith('video/') || file.type.startsWith('audio/') || file.type.startsWith('image/'));
    const endpoint = url ? '/api/analyze/url' : (isMedia ? '/api/analyze/media' : '/api/analyze');

    try {
      const abortController = new AbortController();
      (window as any)._analyzeAbort = abortController;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Сессия истекла. Войдите снова и повторите анализ.');
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        body: fd,
        signal: abortController.signal,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Ошибка сервера'); }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No body');
      const dec = new TextDecoder('utf-8'); let buf = '';
      const consumeSSE = (chunk: string) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          try { handleSSE(JSON.parse(payload)); }
          catch (error) { console.warn('Пропущено повреждённое SSE-событие', error); }
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeSSE(dec.decode(value, { stream: true }));
      }
      consumeSSE(dec.decode());
      if (buf.trim().startsWith('data:')) consumeSSE('\n');
    } catch (err: Error | any) { 
      if (err.name === 'AbortError') return;
      setState(p => ({ ...p, phase: 'error', error: err.message })); 
    }
  };

  const handleSSE = (d: Record<string, any>) => {
    if (d.type === 'text_extracted') { 
      if (hasBadWords(d.text)) {
        if ((window as any)._analyzeAbort) {
          (window as any)._analyzeAbort.abort();
        }
        setState(p => ({ ...p, phase: 'error', error: 'Текст содержит недопустимые материалы (мат или неприемлемый контент).' }));
        return;
      }
      setState(p => ({ ...p, phase: 'analyzing', textLength: d.length })); 
      textLengthRef.current = d.length;
      (window as any)._lastExtractedText = d.text;
    }
    else if (d.type === 'status') {
    }
    else if (d.type === 'agent_start') setState(p => ({ ...p, agents: p.agents.map(a => a.id === d.agent ? { ...a, status: 'running' } : a) }));
    else if (d.type === 'agent_done') {
      setState(p => ({ ...p, agents: p.agents.map(a => a.id === d.agent ? { ...a, status: 'done', progress: d.progress / d.total } : a) }));
    }
    else if (d.type === 'results') {
      const results = {
        summarizer: d.summarizer,
        flashcards: d.flashcards,
        quiz: d.quiz,
        cheatsheet: d.cheatsheet,
        podcast: d.podcast,
        missions: d.missions,
        warnings: d.warnings || [],
        grounding: d.grounding,
      };
      const dur = analysisStartRef.current
        ? Math.round((Date.now() - analysisStartRef.current) / 1000)
        : 0;

      if (user) {

        (async () => {
          try {
            const title = results.summarizer?.title || (sourceFileNameRef.current
              ? sourceFileNameRef.current.replace(/\.[^/.]+$/, '')
              : 'Без названия');

            const { data: inserted, error } = await supabase
              .from('materials')
              .insert({
                user_id: user.id,
                title,
                subject: results.summarizer?.subject || '',
                original_text: textLengthRef.current > 0 ? (window as any)._lastExtractedText || '' : '',
                summary_json: {
                  content: results.summarizer?.content || '',
                  terms: results.summarizer?.terms || [],
                  cheatsheet: results.cheatsheet?.content || '',
                  podcast: results.podcast?.podcast || [],
                  source_ids: results.summarizer?.source_ids || [],
                  grounding: results.grounding,
                },
                missions_json: results.missions,
                flashcards_json: results.flashcards,
                quiz_json: results.quiz,
              })
              .select('id')
              .single();

            if (error) {
              console.error('Supabase insert error:', error);
              toast.error('Результат получен, но сохранить его не удалось. Попробуйте ещё раз.');
              return;
            }

            // Списываем лимит только после успешного сохранения материала.
            await incrementAIUsage(user.id, 20);

            if (inserted?.id) {
              setState(p => ({ ...p, savedMaterialId: inserted.id }));
            }

            const cards = results.flashcards?.flashcards || [];
            if (cards.length > 0 && inserted?.id) {
              await syncFlashcards(user.id, inserted.id, cards);
            }
            await recordStudyActivity(user.id, 0, 1);
          } catch (err) {
            console.error('AI Usage or DB error:', err);
            toast.error('Не удалось завершить сохранение результата.');
          }
        })();
      }
      
      setState(p => ({ ...p, results, analysisDuration: dur || undefined }));
    }
    else if (d.type === 'done') setState(p => ({ ...p, phase: 'done' }));
    else if (d.type === 'error') setState(p => ({ ...p, phase: 'error', error: d.message }));
  };

  const reset = () => { setState({ phase: 'upload', agents: initAgents, results: null, settings: DEFAULT_SETTINGS }); setIsDemo(false); };

  const handleDemo = () => {
    setIsDemo(true);
    const file = new File([DEMO_TEXT], 'demo_lecture.txt', { type: 'text/plain' });
    handleUpload(file);
  };

  return (
    <div className={`mx-auto p-4 md:p-6 ${state.phase === 'done' ? 'max-w-5xl' : 'max-w-3xl'}`}>
      <AnimatePresence mode="wait">
        {state.phase === 'upload' && (
          <motion.div key="upload" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <UploadZone settings={state.settings} onSettingsChange={s => setState(p => ({ ...p, settings: s }))} onUpload={handleUpload} onDemo={handleDemo} />
          </motion.div>
        )}
        {(state.phase === 'extracting' || state.phase === 'analyzing') && (
          <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <AgentCards agents={state.agents} phase={state.phase} isDemo={isDemo} />
          </motion.div>
        )}
        {state.phase === 'done' && state.results && (
          <motion.div key="results" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <ResultsPanel 
              results={state.results} 
              onReset={reset} 
              textLength={state.textLength} 
              analysisDuration={state.analysisDuration} 
              sourceFileName={state.sourceFileName} 
              materialId={state.savedMaterialId} 
            />
            <div className="mt-2 border-t border-slate-200 pt-5 text-left dark:border-slate-800">
              <button
                onClick={() => navigate('/library')}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <BookOpen className="w-4 h-4" /> Открыть библиотеку
              </button>
            </div>
          </motion.div>
        )}
        {state.phase === 'error' && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
            {state.error?.includes('429') || state.error?.includes('API_LIMIT_REACHED') ? (
              <>
                <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Сервис временно занят</h2>
                <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm max-w-sm mx-auto leading-relaxed">
                  Сейчас одновременно обрабатывается слишком много материалов. Подождите несколько минут и повторите попытку.
                </p>
                <button onClick={reset} className="px-6 py-2.5 bg-amber-500 text-white font-bold rounded-xl text-sm hover:bg-amber-600 transition shadow-lg shadow-amber-500/20">
                  Попробовать снова
                </button>
              </>
            ) : (
              <>
                <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Ошибка</h2>
                <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">{state.error}</p>
                <button onClick={reset} className="rounded-lg bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">Попробовать снова</button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg rounded-lg px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 font-medium">
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
