import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, BookOpen, HelpCircle, CheckCircle2, AlertCircle, ArrowRight, ChevronRight, X, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getMaterials } from '../api/materials';

interface QuickPrepData {
  key_points: string[];
  cheatsheet: string;
  questions: { question: string; answer: string }[];
}

type Phase = 'select' | 'loading' | 'cheatsheet' | 'quiz' | 'done';

export default function QuickPrep() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Восстановление состояния из sessionStorage
  const savedStateStr = sessionStorage.getItem('studyforge_quickprep_state');
  const savedState = savedStateStr ? JSON.parse(savedStateStr) : null;

  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>(savedState?.selectedId || '');
  const [phase, setPhase] = useState<Phase>(
    savedState?.phase === 'loading' ? 'select' : (savedState?.phase || 'select')
  );
  const [data, setData] = useState<QuickPrepData | null>(savedState?.data || null);
  const [quizIndex, setQuizIndex] = useState<number>(savedState?.quizIndex || 0);
  const [showAnswer, setShowAnswer] = useState<boolean>(savedState?.showAnswer || false);
  const [timer, setTimer] = useState<number>(savedState?.timer !== undefined ? savedState.timer : 300); // 5 минут

  // Сохранение состояния в sessionStorage
  useEffect(() => {
    sessionStorage.setItem('studyforge_quickprep_state', JSON.stringify({
      selectedId,
      phase,
      data,
      quizIndex,
      showAnswer,
      timer
    }));
  }, [selectedId, phase, data, quizIndex, showAnswer, timer]);

  useEffect(() => {
    if (!user?.id) return;
    getMaterials(user.id).then(setMaterials).catch(console.error);
  }, [user?.id]);

  // Таймер
  useEffect(() => {
    if (phase !== 'cheatsheet' && phase !== 'quiz') return;
    if (timer <= 0) return;
    const t = setInterval(() => setTimer(p => p - 1), 1000);
    return () => clearInterval(t);
  }, [phase, timer]);

  const selectedMaterial = materials.find(m => m.id === selectedId);

  const startPrep = async () => {
    if (!selectedMaterial) return;
    setPhase('loading');
    setTimer(300);
    setQuizIndex(0);
    setShowAnswer(false);

    const summary = typeof selectedMaterial.summary_json === 'string'
      ? selectedMaterial.summary_json
      : (selectedMaterial.summary_json?.content || '');
    const context = (selectedMaterial.original_text || summary || '').slice(0, 15000);

    try {
      const res = await fetch('/api/quick-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData(d);
      setPhase('cheatsheet');
    } catch {
      alert('Не удалось подготовить материал. Попробуйте ещё раз.');
      setPhase('select');
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="p-6 max-w-3xl mx-auto min-h-[80vh] flex flex-col justify-center">
      {/* Заголовок */}
      <div className="flex items-center gap-2 mb-6 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Повтор за 5 минут</h1>
            <p className="text-xs text-slate-500">Быстрое освежение памяти перед парой</p>
          </div>
        </div>
        {phase !== 'select' && (
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold ${timer < 60 ? 'bg-rose-100 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
              <Clock className="w-4 h-4" />
              {formatTime(timer)}
            </div>
            <button
              onClick={() => {
                setPhase('select');
                setSelectedId('');
                setData(null);
                setQuizIndex(0);
                setShowAnswer(false);
                setTimer(300);
              }}
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 rounded-lg text-slate-600 transition"
            >
              <X className="w-3.5 h-3.5" /> Выйти
            </button>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {/* ВЫБОР МАТЕРИАЛА */}
        {phase === 'select' && (
          <motion.div
            key="select"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="card p-8 text-center"
          >
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Zap className="w-8 h-8 text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Осталось 5 минут до пары?</h2>
            <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
              Выберите лекцию — AI мгновенно создаст шпаргалку и 2 разогревочных вопроса. Идеально для освежения памяти.
            </p>
            <div className="max-w-sm mx-auto space-y-4">
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-amber-500 transition"
              >
                <option value="">Выберите лекцию</option>
                {materials.map(m => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
              <button
                disabled={!selectedId}
                onClick={startPrep}
                className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-amber-100"
              >
                <Zap className="w-5 h-5" /> Подготовить за 5 минут
              </button>
            </div>
          </motion.div>
        )}

        {/* ЗАГРУЗКА */}
        {phase === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="relative mb-6">
              <div className="w-16 h-16 border-4 border-amber-100 border-t-amber-500 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Zap className="w-6 h-6 text-amber-500 animate-pulse" />
              </div>
            </div>
            <h3 className="font-semibold text-slate-800 mb-1">AI составляет экспресс-шпаргалку...</h3>
            <p className="text-xs text-slate-400 max-w-xs">Выжимаем самое главное из лекции — займёт пару секунд</p>
          </motion.div>
        )}

        {/* ШПАРГАЛКА */}
        {phase === 'cheatsheet' && data && (
          <motion.div
            key="cheatsheet"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-5"
          >
            {/* Прогресс */}
            <div className="flex items-center gap-3">
              {[
                { label: '1. Шпаргалка', active: true, done: false },
                { label: '2. Вопросы', active: false, done: false },
                { label: '3. Готов!', active: false, done: false },
              ].map((step, i) => (
                <div key={i} className={`flex-1 text-center text-xs font-bold py-2 rounded-lg transition ${step.active ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {step.label}
                </div>
              ))}
            </div>

            {/* Ключевые тезисы */}
            <div className="card p-5">
              <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-500" />
                Топ-3 самых важных тезиса
              </h3>
              <div className="space-y-3">
                {data.key_points.map((point, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-6 h-6 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-0.5">{i + 1}</span>
                    <p className="text-sm text-slate-700 leading-relaxed">{point}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Мини-шпаргалка */}
            <div className="bg-slate-900 text-white rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">⚡ Экспресс-шпаргалка</p>
              <div className="text-sm text-slate-300 leading-relaxed markdown-content white-text">
                <ReactMarkdown>{data.cheatsheet}</ReactMarkdown>
              </div>
            </div>

            <button
              onClick={() => { setPhase('quiz'); setQuizIndex(0); setShowAnswer(false); }}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-amber-100"
            >
              Перейти к вопросам <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {/* ВОПРОСЫ */}
        {phase === 'quiz' && data && (
          <motion.div
            key={`quiz-${quizIndex}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-5"
          >
            {/* Прогресс */}
            <div className="flex items-center gap-3">
              {[
                { label: '1. Шпаргалка', active: false, done: true },
                { label: `2. Вопрос ${quizIndex + 1}/${data.questions.length}`, active: true, done: false },
                { label: '3. Готов!', active: false, done: false },
              ].map((step, i) => (
                <div key={i} className={`flex-1 text-center text-xs font-bold py-2 rounded-lg transition ${step.active ? 'bg-amber-500 text-white' : step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {step.done ? '✓ ' : ''}{step.label}
                </div>
              ))}
            </div>

            <div className="card p-6 space-y-4">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-amber-500" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Разогревочный вопрос</span>
              </div>
              <p className="text-base font-semibold text-slate-800 leading-relaxed">
                {data.questions[quizIndex]?.question}
              </p>

              {!showAnswer ? (
                <button
                  onClick={() => setShowAnswer(true)}
                  className="w-full py-3 border-2 border-dashed border-amber-300 hover:border-amber-400 hover:bg-amber-50 text-amber-700 rounded-xl font-bold transition text-sm"
                >
                  Показать ответ
                </button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  style={{ overflow: 'hidden' }}
                  className="bg-emerald-50 border border-emerald-200 rounded-xl"
                >
                  <div className="p-4">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Правильный ответ:
                    </p>
                    <p className="text-sm text-slate-700 leading-relaxed">{data.questions[quizIndex]?.answer}</p>
                  </div>
                </motion.div>
              )}

              {showAnswer && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => {
                    if (quizIndex + 1 >= data.questions.length) {
                      setPhase('done');
                    } else {
                      setQuizIndex(q => q + 1);
                      setShowAnswer(false);
                    }
                  }}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold transition flex items-center justify-center gap-2"
                >
                  {quizIndex + 1 >= data.questions.length ? 'Я готов! 🎯' : 'Следующий вопрос'} <ChevronRight className="w-4 h-4" />
                </motion.button>
              )}
            </div>
          </motion.div>
        )}

        {/* ФИНАЛ */}
        {phase === 'done' && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card p-10 text-center bg-gradient-to-br from-amber-50 to-orange-50 border-amber-100"
          >
            <div className="text-6xl mb-4">🎯</div>
            <h2 className="text-2xl font-black text-amber-800 mb-2">Ты готов к паре!</h2>
            <p className="text-slate-600 text-sm max-w-sm mx-auto mb-6">
              Главное — помни ключевые тезисы. Ты потратил менее 5 минут и освежил память по «{selectedMaterial?.title}».
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => { setPhase('select'); setSelectedId(''); }}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold transition"
              >
                Другая лекция
              </button>
              <button
                onClick={() => navigate('/dashboard')}
                className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition"
              >
                На дашборд
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
