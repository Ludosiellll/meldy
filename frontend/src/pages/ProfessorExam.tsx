import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, BookOpen, Mic, MicOff, Send, MessageSquare, AlertCircle, CheckCircle2, HelpCircle, ArrowRight, RefreshCw, X, Volume2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getMaterials } from '../api/materials';
import { updateQuestProgress, checkAndAwardAchievements } from '../api/quests';
import ConfettiCelebration from '../components/ConfettiCelebration';
import AchievementToast from '../components/AchievementToast';
import type { Achievement } from '../components/AchievementToast';

// Web Speech API
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

interface EvaluationResult {
  score: number;
  grade: string;
  verdict: string;
  correct_points: string[];
  errors: string[];
  missing_points: string[];
}

export default function ProfessorExam() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Восстановление состояния из sessionStorage
  const savedStateStr = sessionStorage.getItem('studyforge_professor_exam_state');
  const savedState = savedStateStr ? JSON.parse(savedStateStr) : null;

  // Состояние материалов
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(savedState?.selectedMaterialId || '');
  
  // Состояние экзамена
  const [phase, setPhase] = useState<'select' | 'question' | 'evaluation' | 'loading'>(
    savedState?.phase === 'loading' ? 'select' : (savedState?.phase || 'select')
  );
  const [currentQuestion, setCurrentQuestion] = useState<string>(savedState?.currentQuestion || '');
  const [answerText, setAnswerText] = useState<string>(savedState?.answerText || '');
  const [interimText, setInterimText] = useState<string>('');
  const [history, setHistory] = useState<{ question: string; answer: string; grade: string }[]>(savedState?.history || []);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(savedState?.evaluation || null);
  const [examHistory, setExamHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  
  // Голосовой ввод
  const [isListening, setIsListening] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);
  // Режим экзамена
  const [socraticMode, setSocraticMode] = useState<boolean>(savedState?.socraticMode || false);
  // Конфетти и достижения
  const [showConfetti, setShowConfetti] = useState(false);
  const [achievement, setAchievement] = useState<Achievement | null>(null);

  // Сохранение состояния в sessionStorage
  useEffect(() => {
    sessionStorage.setItem('studyforge_professor_exam_state', JSON.stringify({
      selectedMaterialId,
      phase,
      currentQuestion,
      answerText,
      history,
      evaluation,
      socraticMode
    }));
  }, [selectedMaterialId, phase, currentQuestion, answerText, history, evaluation, socraticMode]);

  // Загрузка материалов и истории экзаменов
  useEffect(() => {
    if (!user?.id) return;
    getMaterials(user.id).then(setMaterials).catch(console.error);
    fetchExamHistory();
  }, [user?.id]);

  const fetchExamHistory = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('exam_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10);
    if (data) setExamHistory(data);
  };

  // Настройка голосового распознавания
  const initRecognition = () => {
    if (recognitionRef.current) return recognitionRef.current;
    
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.lang = 'ru-RU';
    rec.interimResults = true;

    rec.onstart = () => {
      setIsListening(true);
      console.log('Speech recognition started');
    };
    
    rec.onend = () => {
      setIsListening(false);
      setInterimText('');
      console.log('Speech recognition ended');
    };

    rec.onresult = (event: any) => {
      let finalTranscript = '';
      let currentInterim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setAnswerText(prev => prev ? prev + ' ' + finalTranscript : finalTranscript);
      }
      setInterimText(currentInterim);
    };

    rec.onerror = (e: any) => {
      console.error('Speech recognition error:', e.error);
      setIsListening(false);
      
      if (e.error === 'not-allowed') {
        alert('Доступ к микрофону заблокирован. Разрешите его в настройках браузера (значок замка в адресной строке).');
      } else if (e.error === 'network') {
        alert('Ошибка сети. Проверьте интернет-соединение. Голосовой ввод Google требует стабильной сети.');
      } else if (e.error === 'no-speech') {
        // Просто игнорируем, если не услышал
        console.log('No speech detected');
      } else {
        console.warn('Recognition error:', e.error);
      }
    };

    recognitionRef.current = rec;
    return rec;
  };

  const toggleListening = () => {
    const rec = initRecognition();
    
    if (!rec) {
      alert('Голосовой ввод не поддерживается вашим браузером. Пожалуйста, используйте Google Chrome, Edge или Safari.');
      return;
    }

    if (isListening) {
      try {
        rec.stop();
      } catch (e) {
        console.error('Stop error:', e);
      }
    } else {
      try {
        rec.start();
      } catch (err: any) {
        console.error('Start error:', err);
        // Если уже запущено, просто обновляем стейт
        if (err.name === 'InvalidStateError') {
          setIsListening(true);
        }
      }
    }
  };

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  const selectedMaterial = materials.find(m => m.id === selectedMaterialId);

  // Начать экзамен / Запросить вопрос
  const startExamOrNextQuestion = async (clearHistory = false) => {
    if (!selectedMaterial) return;
    setPhase('loading');
    setAnswerText('');
    
    let currentHistory = history;
    if (clearHistory) {
      currentHistory = [];
      setHistory([]);
      setEvaluation(null);
    }

    // Собираем историю для контекста
    const historyText = currentHistory
      .map(h => `В: ${h.question}\nО: ${h.answer}\nОценка: ${h.grade}`)
      .join('\n\n');

    // Получаем конспект/оригинал лекции
    const summary = typeof selectedMaterial.summary_json === 'string'
      ? selectedMaterial.summary_json
      : (selectedMaterial.summary_json?.content || '');
    const context = (selectedMaterial.original_text || summary || '').slice(0, 20000);

    // Получаем актуальное настроение пользователя
    const { data: moodData } = await supabase
      .from('mood_log')
      .select('mood, energy_level')
      .eq('user_id', user!.id)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    try {
      const res = await fetch('/api/professor/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          history_text: historyText,
          mood: moodData,
          socratic_mode: socraticMode,
        })
      });

      if (!res.ok) throw new Error('Ошибка связи с сервером');
      const data = await res.json();
      setCurrentQuestion(data.question);
      setPhase('question');
    } catch (err) {
      console.error(err);
      alert('Не удалось задать вопрос. Попробуйте еще раз.');
      setPhase(clearHistory ? 'select' : 'evaluation');
    }
  };

  // Отправить ответ на оценку
  const submitAnswer = async () => {
    if (!answerText.trim() || !selectedMaterial) return;
    setPhase('loading');

    const summary = typeof selectedMaterial.summary_json === 'string'
      ? selectedMaterial.summary_json
      : (selectedMaterial.summary_json?.content || '');
    const context = (selectedMaterial.original_text || summary || '').slice(0, 20000);

    try {
      const res = await fetch('/api/professor/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          question: currentQuestion,
          student_answer: answerText
        })
      });

      if (!res.ok) throw new Error('Ошибка оценки');
      const evalData: EvaluationResult = await res.json();
      
      setEvaluation(evalData);
      
      // Конфетти при пятёрке!
      if (evalData.grade === '5') {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 100);
      }
      
      // Добавляем в локальную историю
      setHistory(prev => [
        ...prev,
        { question: currentQuestion, answer: answerText, grade: evalData.grade }
      ]);

      // Запись сессии в Supabase для статистики
      if (user) {
        // Создаем сессию экзамена если ее еще нет
        const { data: sessionData } = await supabase.from('exam_sessions').insert({
          user_id: user.id,
          material_id: selectedMaterial?.id ?? null,
          subject: selectedMaterial?.subject ?? '',
          score: evalData.score,
          questions_json: [{ question: currentQuestion, answer: answerText, evaluation: evalData }],
          total_questions: 1,
          status: 'completed',
          completed_at: new Date().toISOString()
        }).select().single();

        if (sessionData) {
          fetchExamHistory();
          await updateQuestProgress(user.id, 'exam', 1);
          // Проверяем достижения
          const newAchs = await checkAndAwardAchievements(user.id);
          if (newAchs.length > 0) {
            setAchievement({ id: newAchs[0].id, title: newAchs[0].title, description: newAchs[0].description, icon: newAchs[0].icon, xp: newAchs[0].xp });
          }
        }

        await supabase.from('study_sessions').insert({
          user_id: user.id,
          cards_reviewed: 1,
          date: new Date().toISOString().split('T')[0]
        });

        // Автоматически сохраняем ошибки в дневник ошибок
        const mistakesToSave = [
          ...evalData.errors.map((err: string) => ({
            user_id: user.id,
            material_id: selectedMaterial?.id ?? null,
            question: currentQuestion,
            correct_answer: err,
            student_answer: answerText,
            topic: selectedMaterial?.subject ?? '',
            is_resolved: false,
          })),
          ...evalData.missing_points.map((miss: string) => ({
            user_id: user.id,
            material_id: selectedMaterial?.id ?? null,
            question: currentQuestion,
            correct_answer: miss,
            student_answer: '(не упомянуто)',
            topic: selectedMaterial?.subject ?? '',
            is_resolved: false,
          })),
        ];

        if (mistakesToSave.length > 0) {
          await supabase.from('mistake_diary').insert(mistakesToSave);
        }
      }

      setPhase('evaluation');
    } catch (err) {
      console.error(err);
      alert('Ошибка при оценке ответа. Пожалуйста, попробуйте отправить заново.');
      setPhase('question');
    }
  };

  // Цвета для академической оценки
  const getGradeColors = (grade: string) => {
    switch (grade) {
      case '5': return { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', sealBg: 'bg-emerald-500', label: 'ОТЛИЧНО (5)' };
      case '4': return { bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700', sealBg: 'bg-indigo-500', label: 'ХОРОШО (4)' };
      case '3': return { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', sealBg: 'bg-amber-500', label: 'УДОВЛЕТВОРИТЕЛЬНО (3)' };
      default: return { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-700', sealBg: 'bg-rose-500', label: 'НЕУД (2)' };
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto min-h-[80vh] flex flex-col justify-center">
      <ConfettiCelebration trigger={showConfetti} type="exam5" />
      <AchievementToast achievement={achievement} onClose={() => setAchievement(null)} />
      {/* Заголовок */}
      <div className="flex items-center gap-2 mb-6 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
            <Award className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">AI-Экзаменатор</h1>
            <p className="text-xs text-slate-500">Устная репетиция сдача сессии профессору</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Переключатель режима */}
          {phase === 'select' && (
            <button
              onClick={() => setSocraticMode(p => !p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                socraticMode
                  ? 'bg-purple-100 text-purple-700 border-purple-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
              }`}
              title="Режим Сократовского диалога: профессор докапывается до сути через уточняющие вопросы"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {socraticMode ? 'Сократ ВКЛ' : 'Сократ ВЫКЛ'}
            </button>
          )}
          {phase !== 'select' && (
            <button
              onClick={() => {
                if (confirm('Вы уверены, что хотите завершить экзамен?')) {
                  setPhase('select');
                  setCurrentQuestion('');
                  setAnswerText('');
                  setHistory([]);
                  setEvaluation(null);
                }
              }}
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 rounded-lg text-slate-600 transition"
            >
              <X className="w-3.5 h-3.5" /> Выйти
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ФАЗА 1: Выбор материала */}
        {phase === 'select' && (
          <motion.div
            key="select"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
          >
            <div className="card p-6 md:p-8 text-center">
              <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Award className="w-8 h-8 text-rose-500" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">Готовы проверить свои знания?</h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
                AI-Профессор задаст вам каверзные вопросы на понимание. Вы можете вводить ответ текстом или наговаривать голосом через микрофон.
              </p>

              <div className="max-w-md mx-auto space-y-4">
                <div className="text-left">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Выберите лекцию из библиотеки:</label>
                  <select
                    value={selectedMaterialId}
                    onChange={e => setSelectedMaterialId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-rose-500 transition shadow-sm"
                  >
                    <option value="">Выберите материал для сдачи</option>
                    {materials.map(m => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </select>
                </div>

                <button
                  disabled={!selectedMaterialId}
                  onClick={() => startExamOrNextQuestion(true)}
                  className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-rose-100"
                >
                  <ArrowRight className="w-5 h-5" /> Войти в аудиторию
                </button>
              </div>
            </div>

            {/* История экзаменов */}
            {examHistory.length > 0 && (
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-slate-400" />
                    История последних экзаменов
                  </h3>
                </div>
                <div className="space-y-3">
                  {examHistory.map(session => (
                    <div key={session.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-bold text-slate-700 truncate">{session.subject || 'Без предмета'}</span>
                          <span className="px-1.5 py-0.5 bg-slate-200 text-slate-500 rounded text-[9px] font-bold">
                            {new Date(session.completed_at).toLocaleDateString('ru-RU')}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">Билет по одной из лекций</p>
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <div className="text-right">
                          <p className="text-xs font-black text-rose-600">{session.score}%</p>
                          <p className="text-[9px] text-slate-400 uppercase font-bold">Оценка</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ФАЗА ЗАГРУЗКИ / «Профессор думает...» */}
        {phase === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="relative mb-6">
              <div className="w-16 h-16 border-4 border-rose-100 border-t-rose-600 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Award className="w-6 h-6 text-rose-500 animate-pulse" />
              </div>
            </div>
            <h3 className="font-semibold text-slate-800 text-base mb-1">Профессор анализирует материал...</h3>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
              Формулируется индивидуальный вопрос для оценки вашего понимания
            </p>
          </motion.div>
        )}

        {/* ФАЗА 2: Экзаменационный вопрос */}
        {phase === 'question' && (
          <motion.div
            key="question"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            {/* Вопрос Профессора */}
            <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl relative border border-slate-800 overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />
              
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-[10px] font-bold tracking-wider uppercase">Билет №{history.length + 1}</span>
                <span className="text-[10px] text-slate-400">Лекция: {selectedMaterial?.title}</span>
              </div>
              
              <div className="flex gap-4 items-start">
                <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center shrink-0 border border-slate-700">
                  <HelpCircle className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-300 text-xs uppercase tracking-wider mb-1">Вопрос профессора:</h3>
                  <div className="text-base font-medium text-white leading-relaxed markdown-content white-text professor-question">
                    <ReactMarkdown>{currentQuestion}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>

            {/* Ввод ответа студента */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ваш устный ответ:</label>
                {SpeechRecognition && (
                  <button
                    onClick={toggleListening}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      isListening
                        ? 'bg-rose-100 text-rose-700 border border-rose-200 animate-pulse'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-rose-500" />}
                    {isListening ? 'Слушаю вас...' : 'Говорить в микрофон'}
                  </button>
                )}
              </div>

              <textarea
                value={answerText + (interimText ? (answerText ? ' ' : '') + interimText : '')}
                onChange={e => {
                  setAnswerText(e.target.value);
                  setInterimText('');
                }}
                placeholder="Сформулируйте ваш развернутый ответ на вопрос профессора..."
                className="w-full h-36 px-4 py-3.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-rose-500 transition resize-none bg-slate-50/50"
              />

              <div className="flex gap-3">
                <button
                  disabled={!answerText.trim()}
                  onClick={submitAnswer}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-rose-100"
                >
                  <Send className="w-4 h-4" /> Ответить Профессору
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ФАЗА 3: Оценка и глубокий разбор пробелов */}
        {phase === 'evaluation' && evaluation && (
          <motion.div
            key="evaluation"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            {/* Оценка и вердикт */}
            {(() => {
              const colors = getGradeColors(evaluation.grade);
              return (
                <div className={`border rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-center gap-6 ${colors.bg}`}>
                  {/* Академическая печать оценки */}
                  <div className="shrink-0 flex flex-col items-center justify-center">
                    <div className={`w-20 h-20 rounded-full flex flex-col items-center justify-center text-white font-black text-3xl shadow-md ${colors.sealBg} relative overflow-hidden`}>
                      <div className="absolute inset-0 bg-white/10 rounded-full scale-90 border border-dashed border-white/50" />
                      {evaluation.grade}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 mt-2 tracking-widest uppercase">Академическая печать</span>
                  </div>

                  <div className="flex-1 text-center md:text-left">
                    <h3 className={`text-sm font-black tracking-wider uppercase mb-1 ${colors.text}`}>{colors.label}</h3>
                    <p className="text-slate-700 font-medium text-sm leading-relaxed mb-2">"{evaluation.verdict}"</p>
                    <div className="flex items-center justify-center md:justify-start gap-1.5">
                      <span className="text-xs font-semibold text-slate-400">Точность ответа:</span>
                      <span className="text-xs font-bold text-slate-800">{evaluation.score}%</span>
                      <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-500 rounded-full" style={{ width: `${evaluation.score}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Когнитивный разбор: что правильно, ошибки и пробелы */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Зеленый блок: Что сказали правильно */}
              <div className="card p-5 border-l-4 border-l-emerald-500 bg-white">
                <h4 className="font-bold text-emerald-800 text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  Усвоено верно
                </h4>
                {evaluation.correct_points.length === 0 ? (
                  <p className="text-slate-400 text-xs italic">Нет полностью верных фактов в ответе.</p>
                ) : (
                  <ul className="space-y-2">
                    {evaluation.correct_points.map((p, i) => (
                      <li key={i} className="text-slate-600 text-xs leading-relaxed flex items-start gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full shrink-0 mt-1.5" />
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Красный блок: Допущенные ошибки */}
              <div className="card p-5 border-l-4 border-l-rose-500 bg-white">
                <h4 className="font-bold text-rose-800 text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  Фактические ошибки
                </h4>
                {evaluation.errors.length === 0 ? (
                  <p className="text-emerald-600 text-xs font-medium">Ошибок в ответе не обнаружено! Отличная точность.</p>
                ) : (
                  <ul className="space-y-2">
                    {evaluation.errors.map((p, i) => (
                      <li key={i} className="text-slate-600 text-xs leading-relaxed flex items-start gap-1.5">
                        <span className="w-1.5 h-1.5 bg-rose-400 rounded-full shrink-0 mt-1.5" />
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Желтый/серый блок: Упущенные знания */}
              <div className="card p-5 border-l-4 border-l-amber-500 bg-white">
                <h4 className="font-bold text-amber-800 text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-amber-500 shrink-0" />
                  Когнитивные пропуски
                </h4>
                {evaluation.missing_points.length === 0 ? (
                  <p className="text-emerald-600 text-xs font-medium">Ничего не упущено. Исчерпывающий ответ!</p>
                ) : (
                  <ul className="space-y-2">
                    {evaluation.missing_points.map((p, i) => (
                      <li key={i} className="text-slate-600 text-xs leading-relaxed flex items-start gap-1.5">
                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full shrink-0 mt-1.5" />
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Действия */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => startExamOrNextQuestion(false)}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-rose-100"
              >
                <RefreshCw className="w-4 h-4" /> Следующий билет
              </button>
              
              <button
                onClick={() => setPhase('select')}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition flex items-center justify-center gap-2"
              >
                Завершить экзамен
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
