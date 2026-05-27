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
import { updateQuestProgress, recordStudyActivity } from '../api/quests';
import { hasBadWords } from '../utils/moderation';

const initAgents: AgentStatus[] = [
  { id: 'summarizer', label: 'Конспект', status: 'idle', progress: 0 },
  { id: 'flashcards', label: 'Карточки', status: 'idle', progress: 0 },
  { id: 'quiz', label: 'Тест', status: 'idle', progress: 0 },
  { id: 'cheatsheet', label: 'Шпаргалка', status: 'idle', progress: 0 },
  { id: 'podcast', label: 'Подкаст', status: 'idle', progress: 0 },
  { id: 'missions', label: 'Миссии', status: 'idle', progress: 0 },
];

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

  const addToast = (text: string) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const handleUpload = async (file: File | null, youtubeUrl?: string) => {
    analysisStartRef.current = Date.now();
    sourceFileNameRef.current = file ? file.name : (youtubeUrl ? 'YouTube Video' : 'Unknown');
    setState({ phase: 'extracting', agents: initAgents.map(a => ({ ...a, status: 'idle' as const })), results: null, settings: state.settings, sourceFileName: sourceFileNameRef.current });
    
    const fd = new FormData();
    if (file) fd.append('file', file);
    if (youtubeUrl) fd.append('youtube_url', youtubeUrl);
    
    fd.append('summary_detail', state.settings.summaryDetail);
    fd.append('flashcard_count', String(state.settings.flashcardCount));
    fd.append('quiz_count', String(state.settings.quizCount));
    fd.append('quiz_difficulty', state.settings.quizDifficulty);
    fd.append('quiz_type', state.settings.quizType);
    
    // Определяем эндпоинт в зависимости от типа
    const isMedia = youtubeUrl || (file && (file.type.startsWith('video/') || file.type.startsWith('audio/') || file.type.startsWith('image/')));
    const endpoint = isMedia ? '/api/analyze/media' : '/api/analyze';
    
    try {
      const abortController = new AbortController();
      (window as any)._analyzeAbort = abortController;
      const res = await fetch(endpoint, { method: 'POST', body: fd, signal: abortController.signal });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Ошибка сервера'); }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No body');
      const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const l of lines) {
          if (l.startsWith('data: ')) {
            try { handleSSE(JSON.parse(l.slice(6))); } catch {}
          }
        }
      }
    } catch (err: Error | any) { 
      if (err.name === 'AbortError') return;
      setState(p => ({ ...p, phase: 'error', error: err.message })); 
    }
  };

  const agentDoneLabels: Record<string, string> = {
    summarizer: 'Конспект готов',
    flashcards: 'Карточки готовы',
    quiz: 'Тест готов',
    cheatsheet: 'Шпаргалка готова',
    podcast: 'Подкаст готов',
    missions: 'Квесты готовы',
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
      (window as any)._lastExtractedText = d.text; // Сохраняем текст из события
    }
    else if (d.type === 'status') {
      // No toast needed, handled in main UI
    }
    else if (d.type === 'agent_start') setState(p => ({ ...p, agents: p.agents.map(a => a.id === d.agent ? { ...a, status: 'running' } : a) }));
    else if (d.type === 'agent_done') {
      // No toast needed, visualized directly in agent card
      setState(p => ({ ...p, agents: p.agents.map(a => a.id === d.agent ? { ...a, status: 'done', progress: d.progress / d.total } : a) }));
    }
    else if (d.type === 'results') {
      const results = {
        summarizer: d.summarizer,
        flashcards: d.flashcards,
        quiz: d.quiz,
        cheatsheet: d.cheatsheet,
        podcast: d.podcast,
        missions: d.missions
      };
      const dur = analysisStartRef.current
        ? Math.round((Date.now() - analysisStartRef.current) / 1000)
        : 0;
      setState(p => ({ ...p, phase: 'done', results, analysisDuration: dur || undefined }));

      if (user) {
        const title = sourceFileNameRef.current
          ? sourceFileNameRef.current.replace(/\.[^/.]+$/, '')
          : 'Без названия';

        (async () => {
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
                podcast: results.podcast?.podcast || []
              },
              missions_json: results.missions,
              flashcards_json: results.flashcards,
              quiz_json: results.quiz,
            })
            .select('id')
            .single();

          if (error) {
            console.error('Supabase insert error:', error);
            return;
          }

          if (inserted?.id) {
            setState(p => ({ ...p, savedMaterialId: inserted.id }));
          }

          const cards = results.flashcards?.flashcards || [];
          if (cards.length > 0 && inserted?.id) {
            await syncFlashcards(user.id, inserted.id, cards);
          }
          await updateQuestProgress(user.id, 'analyze', 1);
          await recordStudyActivity(user.id, 0, 1);
        })();
      }
    }
    else if (d.type === 'error') setState(p => ({ ...p, phase: 'error', error: d.message }));
  };

  const reset = () => { setState({ phase: 'upload', agents: initAgents, results: null, settings: DEFAULT_SETTINGS }); setIsDemo(false); };

  const handleDemo = () => {
    setIsDemo(true);
    const file = new File([DEMO_TEXT], 'demo_lecture.txt', { type: 'text/plain' });
    handleUpload(file);
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
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
            
            {state.savedMaterialId && state.results.podcast && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-6 bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4 border border-slate-700">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-rose-500/20 rounded-xl flex items-center justify-center shrink-0 border border-rose-500/30">
                    <Mic className="w-6 h-6 text-rose-500" />
                  </div>
                  <div className="text-center sm:text-left">
                    <h3 className="font-bold text-lg mb-1 flex items-center justify-center sm:justify-start gap-2">AI-Подкаст сгенерирован! <Zap className="w-4 h-4 text-rose-400" /></h3>
                    <p className="text-slate-400 text-sm">Слушайте разбор этой темы в аудиоформате.</p>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/library/${state.savedMaterialId}?mode=express&tab=podcast`)}
                  className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-sm transition w-full sm:w-auto shrink-0 shadow-lg shadow-rose-900/50"
                >
                  Слушать подкаст
                </button>
              </motion.div>
            )}

            <div className="mt-6 text-center">
              <button
                onClick={() => navigate('/library')}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition shadow-md flex items-center gap-2 mx-auto"
              >
                <BookOpen className="w-4 h-4" /> Перейти в библиотеку
              </button>
            </div>
          </motion.div>
        )}
        {state.phase === 'error' && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Ошибка</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">{state.error}</p>
            <button onClick={reset} className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition">Попробовать снова</button>
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