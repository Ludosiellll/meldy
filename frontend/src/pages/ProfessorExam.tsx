import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Award, BookOpen, Mic, MicOff, Send, MessageSquare, AlertCircle, CheckCircle2, HelpCircle, ArrowRight, RefreshCw, X, Volume2, Sparkles, Play, Pause, Square, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { CustomSelect } from '../components/CustomSelect';
import 'katex/dist/katex.min.css';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { getMaterials } from '../api/materials';
import { updateQuestProgress, checkAndAwardAchievements, recordStudyActivity } from '../api/quests';
import ConfettiCelebration from '../components/ConfettiCelebration';
import AchievementToast from '../components/AchievementToast';
import type { Achievement } from '../components/AchievementToast';
import { playTTS, pauseTTS, resumeTTS, stopTTS } from '../utils/tts';
import { checkAILimit, incrementAIUsage } from '../api/limits';

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
  const { confirm, alert } = useConfirm();
  const navigate = useNavigate();

  // Восстановление состояния из sessionStorage
  const savedStateStr = sessionStorage.getItem('studyforge_professor_exam_state');
  const savedState = savedStateStr ? JSON.parse(savedStateStr) : null;

  // Состояние материалов
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(savedState?.selectedMaterialId || '');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
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
  const [todayMood, setTodayMood] = useState<any>(null);

  // Конфетти и достижения
  const [showConfetti, setShowConfetti] = useState(false);
  const [achievement, setAchievement] = useState<Achievement | null>(null);

  // Состояние TTS
  const [ttsState, setTtsState] = useState<'playing' | 'paused' | 'stopped'>('stopped');

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

  // Автоозвучка при появлении вопроса
  useEffect(() => {
    if (phase === 'question' && currentQuestion) {
      setTtsState('playing');
      playTTS(
        currentQuestion, 
        'professor', 
        () => setTtsState('stopped'),
        () => setTtsState('stopped')
      );
    } else {
      stopTTS();
      setTtsState('stopped');
    }

    return () => {
      stopTTS();
    };
  }, [phase, currentQuestion]);

  // Загрузка материалов и истории экзаменов
  useEffect(() => {
    if (!user?.id) return;
    const cacheMats = localStorage.getItem(`prof_materials_${user.id}`);
    if (cacheMats) { try { setMaterials(JSON.parse(cacheMats)); } catch(e){} }
    
    getMaterials(user.id).then(data => {
      setMaterials(data);
      localStorage.setItem(`prof_materials_${user.id}`, JSON.stringify(data));
    }).catch(console.error);
    
    fetchExamHistory();
    fetchTodayMood();
  }, [user?.id]);

  const fetchTodayMood = async () => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('mood_log')
      .select('mood, energy_level')
      .eq('user_id', user.id)
      .eq('logged_at', today)
      .limit(1)
      .maybeSingle();
    setTodayMood(data);
  };

  const fetchExamHistory = async () => {
    if (!user) return;
    const cacheKey = `prof_history_${user.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { setExamHistory(JSON.parse(cached)); } catch(e){} }
    
    const { data } = await supabase
      .from('exam_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10);
      
    if (data) {
      setExamHistory(data);
      localStorage.setItem(cacheKey, JSON.stringify(data));
    }
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

    rec.onerror = async (e: any) => {
      console.error('Speech recognition error:', e.error);
      setIsListening(false);
      
      if (e.error === 'not-allowed') {
        await alert({ title: 'Ошибка доступа', message: 'Доступ к микрофону заблокирован. Разрешите его в настройках браузера (значок замка в адресной строке).', type: 'danger' });
      } else if (e.error === 'network') {
        await alert({ title: 'Ошибка сети', message: 'Ошибка сети. Проверьте интернет-соединение. Голосовой ввод Google требует стабильной сети.', type: 'danger' });
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

  const toggleListening = async () => {
    const rec = initRecognition();
    
    if (!rec) {
      await alert({ title: 'Не поддерживается', message: 'Голосовой ввод не поддерживается вашим браузером. Пожалуйста, используйте Google Chrome, Edge или Safari.', type: 'danger' });
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
      .select('mood, energy_level, notes')
      .eq('user_id', user!.id)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Загрузка недавних экзаменов и ошибок для адаптивности сложности
    const [examHistoryRes, mistakesRes] = await Promise.all([
      supabase.from('exam_sessions').select('score, grade').eq('user_id', user!.id).eq('status', 'completed').order('completed_at', { ascending: false }).limit(5),
      supabase.from('mistake_diary').select('topic').eq('user_id', user!.id).eq('is_resolved', false).limit(5)
    ]);

    const examHistory = examHistoryRes.data || [];
    const recentMistakes = (mistakesRes.data || []).map(m => m.topic).filter(Boolean);

    if (user?.id) {
      const limitCheck = await checkAILimit(user.id, 1);
      if (!limitCheck.allowed) {
        setPhase(clearHistory ? 'select' : 'evaluation');
        await alert({ title: 'Энергия ИИ исчерпана', message: 'Не хватает энергии ИИ (нужно 1). Перейдите на PRO-тариф!', type: 'danger' });
        navigate('/pricing');
        return;
      }
      await incrementAIUsage(user.id, 1);
    }

    try {
      const res = await fetch('/api/professor/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          history_text: historyText,
          mood: moodData,
          socratic_mode: socraticMode,
          exam_history: examHistory,
          recent_mistakes: recentMistakes,
        })
      });

      if (!res.ok) throw new Error('Ошибка связи с сервером');
      const data = await res.json();
      setCurrentQuestion(data.question);
      setPhase('question');
    } catch (err) {
      console.error(err);
      await alert({ title: 'Ошибка', message: 'Не удалось задать вопрос. Попробуйте еще раз.', type: 'danger' });
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

    if (user?.id) {
      const limitCheck = await checkAILimit(user.id, 1);
      if (!limitCheck.allowed) {
        setPhase('question');
        await alert({ title: 'Энергия ИИ исчерпана', message: 'Не хватает энергии ИИ (нужно 1). Перейдите на PRO-тариф!', type: 'danger' });
        navigate('/pricing');
        return;
      }
      await incrementAIUsage(user.id, 1);
    }

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

        await recordStudyActivity(user.id, 1, 0);

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
      await alert({ title: 'Ошибка', message: 'Ошибка при оценке ответа. Пожалуйста, попробуйте отправить заново.', type: 'danger' });
      setPhase('question');
    }
  };

  // Цвета для академической оценки
  const getGradeColors = (grade: string) => {
    switch (grade) {
      case '5': return {
        bg: 'bg-gradient-to-br from-emerald-50/90 to-teal-50/40 border-emerald-200/60 shadow-lg shadow-emerald-100/10 backdrop-blur-md',
        text: 'text-emerald-950',
        textColor: 'text-emerald-800',
        sealBg: 'bg-gradient-to-tr from-emerald-500 to-teal-500 shadow-emerald-200 shadow-md border border-emerald-400',
        label: '🏆 Отлично (5)'
      };
      case '4': return {
        bg: 'bg-gradient-to-br from-indigo-50/90 to-blue-50/40 border-indigo-200/60 shadow-lg shadow-indigo-100/10 backdrop-blur-md',
        text: 'text-indigo-950',
        textColor: 'text-indigo-800',
        sealBg: 'bg-gradient-to-tr from-indigo-500 to-blue-500 shadow-indigo-200 shadow-md border border-indigo-400',
        label: '⭐ Хорошо (4)'
      };
      case '3': return {
        bg: 'bg-gradient-to-br from-amber-50/90 to-orange-50/40 border-amber-200/60 shadow-lg shadow-amber-100/10 backdrop-blur-md',
        text: 'text-amber-950',
        textColor: 'text-amber-800',
        sealBg: 'bg-gradient-to-tr from-amber-500 to-orange-500 shadow-amber-200 shadow-md border border-amber-400',
        label: '📝 Удовлетворительно (3)'
      };
      default: return {
        bg: 'bg-gradient-to-br from-rose-50/90 to-red-50/40 border-rose-200/60 shadow-lg shadow-rose-100/10 backdrop-blur-md',
        text: 'text-rose-950',
        textColor: 'text-rose-800',
        sealBg: 'bg-gradient-to-tr from-rose-500 to-red-500 shadow-rose-200 shadow-md border border-rose-400',
        label: '❌ Неудовлетворительно (2)'
      };
    }
  };

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto min-h-[80vh] flex flex-col justify-center">
      <ConfettiCelebration trigger={showConfetti} type="exam5" />
      <AchievementToast achievement={achievement} onClose={() => setAchievement(null)} />
      {/* Заголовок */}
      <div className="flex items-center gap-2 mb-6 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
            <Award className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">AI-Экзаменатор</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Устная репетиция сдача сессии профессору</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Переключатель режима */}
          {phase === 'select' && (
            <button
              onClick={() => setSocraticMode(p => !p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                socraticMode
                  ? 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800'
                  : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-700'
              }`}
              title="Режим Сократовского диалога: профессор докапывается до сути через уточняющие вопросы"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {socraticMode ? 'Сократ ВКЛ' : 'Сократ ВЫКЛ'}
            </button>
          )}
          {phase !== 'select' && (
            <button
              onClick={async () => {
                if (await confirm({ title: 'Завершить', message: 'Вы уверены, что хотите завершить экзамен?', type: 'warning' })) {
                  setPhase('select');
                  setCurrentQuestion('');
                  setAnswerText('');
                  setHistory([]);
                  setEvaluation(null);
                }
              }}
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 rounded-lg text-slate-600 transition dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 dark:border dark:border-slate-700"
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
            <div className="card p-4 md:p-8 text-center relative z-20">
              <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Award className="w-8 h-8 text-rose-500" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">Готовы проверить свои знания?</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
                AI-Профессор задаст вам каверзные вопросы на понимание. Вы можете вводить ответ текстом или наговаривать голосом через микрофон.
              </p>

              <div className="max-w-md mx-auto space-y-4">
                <div className="text-left relative">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-2">Выберите лекцию из библиотеки:</label>
                  <div className="relative">
                    <CustomSelect
                      value={selectedMaterialId}
                      onChange={val => setSelectedMaterialId(val)}
                      placeholder="Выберите материал для сдачи"
                      options={materials.map(m => ({ value: m.id, label: m.title }))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-rose-500 shadow-sm"
                    />
                  </div>
                </div>

                {!todayMood && (
                  <div className="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-xl p-4 text-left shadow-sm">
                    <p className="text-sm font-bold text-indigo-800 dark:text-indigo-300 mb-1">Настроим сложность под вас?</p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-3 leading-relaxed">
                      ИИ-Профессор подстроит каверзность вопросов под ваше текущее состояние. 
                    </p>
                    <Link to="/mood" className="text-xs px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold inline-block hover:bg-indigo-700 transition shadow-sm">
                      Указать настрой в Трекере
                    </Link>
                  </div>
                )}
                {todayMood && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800 rounded-xl p-4 flex items-center justify-between text-left shadow-sm">
                    <div>
                      <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Состояние учтено</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">Сложность экзамена будет адаптирована.</p>
                    </div>
                    <span className="text-3xl ml-3 filter drop-shadow-sm">
                      {todayMood.mood === 'great' ? '🚀' : todayMood.mood === 'good' ? '😊' : todayMood.mood === 'okay' ? '😐' : todayMood.mood === 'tired' ? '😴' : '😰'}
                    </span>
                  </div>
                )}

                <button
                  disabled={!selectedMaterialId}
                  onClick={() => startExamOrNextQuestion(true)}
                  className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-rose-100"
                >
                  <ArrowRight className="w-5 h-5" /> Войти в аудиторию (1 ⚡ ИИ)
                </button>
              </div>
            </div>

            {/* История экзаменов */}
            {examHistory.length > 0 && (
              <div className="card p-4 md:p-6 mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                    История последних экзаменов
                  </h3>
                </div>
                <div className="space-y-3">
                  {examHistory.map(session => (
                    <div key={session.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{session.subject || 'Без предмета'}</span>
                          <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded text-[9px] font-bold">
                            {new Date(session.completed_at).toLocaleDateString('ru-RU')}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">Билет по одной из лекций</p>
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
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-base mb-1">Профессор анализирует материал...</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs leading-relaxed">
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
            <div className="bg-slate-900 text-white rounded-2xl p-4 md:p-6 shadow-xl relative border border-slate-800 overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />
              
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-[10px] font-bold tracking-wider uppercase">Билет №{history.length + 1}</span>
                <span className="text-[10px] text-slate-400">Лекция: {selectedMaterial?.title}</span>
              </div>
              
              <div className="flex gap-4 items-start">
                <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center shrink-0 border border-slate-700">
                  <HelpCircle className="w-5 h-5 text-rose-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-slate-300 text-xs uppercase tracking-wider">Вопрос профессора:</h3>
                    <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
                      {ttsState === 'playing' ? (
                        <button onClick={() => { pauseTTS(); setTtsState('paused'); }} className="p-1.5 hover:bg-slate-700 rounded-md transition text-slate-300" title="Пауза">
                          <Pause className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => { 
                          if (ttsState === 'paused') { resumeTTS(); setTtsState('playing'); }
                          else { playTTS(currentQuestion, 'professor', () => setTtsState('stopped')); setTtsState('playing'); }
                        }} className="p-1.5 hover:bg-slate-700 rounded-md transition text-slate-300" title="Воспроизвести">
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => { stopTTS(); setTtsState('stopped'); }} className="p-1.5 hover:bg-slate-700 rounded-md transition text-slate-300" title="Остановить">
                        <Square className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="text-base font-medium text-white leading-relaxed markdown-content white-text professor-question">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{currentQuestion}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>

            {/* Ввод ответа студента */}
            <div className="card p-4 md:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Ваш устный ответ:</label>
                {SpeechRecognition && (
                  <button
                    onClick={toggleListening}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      isListening
                        ? 'bg-rose-100 text-rose-700 border border-rose-200 animate-pulse dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-400 dark:border-slate-700'
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
                className="w-full h-36 px-4 py-3.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-rose-500 transition resize-none bg-slate-50/50 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-100 dark:placeholder-slate-500"
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
                <div className={`border rounded-3xl p-5 md:p-7 flex flex-col md:flex-row items-center gap-6 md:gap-8 ${colors.bg}`}>
                  {/* Академическая печать оценки */}
                  <div className="shrink-0 flex flex-col items-center justify-center">
                    <div className={`w-24 h-24 rounded-full flex flex-col items-center justify-center text-white font-black text-4xl shadow-xl ${colors.sealBg} relative overflow-hidden border-4 border-white`}>
                      <div className="absolute inset-1 bg-transparent rounded-full border-2 border-dashed border-white/30 scale-95" />
                      {evaluation.grade}
                    </div>
                     <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mt-2.5 tracking-wider uppercase bg-white/80 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700 px-2 py-0.5 rounded-full shadow-sm">Академическая печать</span>
                  </div>

                  {/* Отзыв и точность */}
                  <div className="flex-1 space-y-4 w-full">
                    <div className="text-center md:text-left">
                       <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase bg-white/90 dark:bg-slate-800/90 border border-slate-200/50 dark:border-slate-700/50 shadow-sm ${colors.textColor}`}>
                        {colors.label}
                      </span>
                    </div>

                    {/* Отзыв профессора */}
                     <div className="bg-white/80 dark:bg-slate-800/80 border border-slate-100/80 dark:border-slate-700/50 rounded-2xl p-4 shadow-sm relative hover:shadow-md transition-all duration-300">
                       <div className="flex items-start gap-3">
                         <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center border border-slate-200 dark:border-slate-600 shadow-inner shrink-0 text-lg">
                          👨‍🏫
                        </div>
                        <div className="flex-1 space-y-1">
                           <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Отзыв профессора</div>
                           <p className="text-slate-700 dark:text-slate-300 italic font-semibold text-sm leading-relaxed relative pl-4 border-l-2 border-rose-400">
                            "{evaluation.verdict}"
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Точность ответа */}
                    <div className="flex items-center justify-between gap-4 pt-1 flex-wrap md:flex-nowrap">
                      <div className="flex items-center gap-1.5 shrink-0">
                         <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Точность ответа:</span>
                         <span className="text-xs font-black text-slate-800 dark:text-slate-200">{evaluation.score}%</span>
                      </div>
                      <div className="flex-1 min-w-[150px] h-2 bg-slate-200/60 dark:bg-slate-700/60 rounded-full overflow-hidden relative">
                        <div 
                          className="h-full bg-gradient-to-r from-rose-500 to-rose-600 rounded-full" 
                          style={{ width: `${evaluation.score}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Когнитивный разбор: что правильно, ошибки и пробелы */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Зеленый блок: Что сказали правильно */}
              <div className="card p-5 border border-slate-100 dark:border-slate-700/50 bg-white/70 dark:bg-slate-800/70 backdrop-blur-md shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl flex flex-col h-full">
                <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100 dark:border-slate-700/50">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center border border-emerald-100 shrink-0">
                    <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-emerald-950 dark:text-emerald-100 text-xs uppercase tracking-wider">Усвоено верно</h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">Сильные стороны ответа</p>
                  </div>
                </div>
                <div className="flex-1">
                  {evaluation.correct_points.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center p-4">
                      <p className="text-slate-400 dark:text-slate-500 text-xs italic">Нет полностью верных фактов.</p>
                    </div>
                  ) : (
                    <ul className="space-y-2.5">
                      {evaluation.correct_points.map((p, i) => (
                        <li key={i} className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed flex items-start gap-2 bg-emerald-50/20 dark:bg-emerald-950/20 border border-emerald-50/40 dark:border-emerald-900/40 p-2.5 rounded-xl hover:bg-emerald-50/40 dark:hover:bg-emerald-950/40 transition-all duration-200">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0 mt-1.5" />
                          <span className="font-medium">{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Красный блок: Допущенные ошибки */}
              <div className="card p-5 border border-slate-100 dark:border-slate-700/50 bg-white/70 dark:bg-slate-800/70 backdrop-blur-md shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl flex flex-col h-full">
                <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100 dark:border-slate-700/50">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center border border-rose-100 shrink-0">
                    <AlertCircle className="w-4.5 h-4.5 text-rose-600" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-rose-950 dark:text-rose-100 text-xs uppercase tracking-wider">Фактические ошибки</h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">Неточности в деталях</p>
                  </div>
                </div>
                <div className="flex-1">
                  {evaluation.errors.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4">
                      <span className="text-2xl mb-1">🎉</span>
                      <p className="text-emerald-700 text-xs font-semibold">Ошибок в ответе не обнаружено!</p>
                    </div>
                  ) : (
                    <ul className="space-y-2.5">
                      {evaluation.errors.map((p, i) => (
                        <li key={i} className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed flex items-start gap-2 bg-rose-50/20 dark:bg-rose-950/20 border border-rose-50/40 dark:border-rose-900/40 p-2.5 rounded-xl hover:bg-rose-50/40 dark:hover:bg-rose-950/40 transition-all duration-200">
                          <span className="w-1.5 h-1.5 bg-rose-500 rounded-full shrink-0 mt-1.5" />
                          <span className="font-medium">{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Желтый/серый блок: Упущенные знания */}
              <div className="card p-5 border border-slate-100 dark:border-slate-700/50 bg-white/70 dark:bg-slate-800/70 backdrop-blur-md shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl flex flex-col h-full">
                <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100 dark:border-slate-700/50">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center border border-amber-100 shrink-0">
                    <MessageSquare className="w-4.5 h-4.5 text-amber-600" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-amber-950 dark:text-amber-100 text-xs uppercase tracking-wider">Когнитивные пропуски</h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">Упущенные важные нюансы</p>
                  </div>
                </div>
                <div className="flex-1">
                  {evaluation.missing_points.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4">
                      <span className="text-2xl mb-1">🎯</span>
                      <p className="text-emerald-700 text-xs font-semibold">Исчерпывающий ответ!</p>
                    </div>
                  ) : (
                    <ul className="space-y-2.5">
                      {evaluation.missing_points.map((p, i) => (
                        <li key={i} className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed flex items-start gap-2 bg-amber-50/20 dark:bg-amber-950/20 border border-amber-50/40 dark:border-amber-900/40 p-2.5 rounded-xl hover:bg-amber-50/40 dark:hover:bg-amber-950/40 transition-all duration-200">
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full shrink-0 mt-1.5" />
                          <span className="font-medium">{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Действия */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => startExamOrNextQuestion(false)}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-rose-100 dark:shadow-none"
              >
                <RefreshCw className="w-4 h-4" /> Следующий билет (1 ⚡ ИИ)
              </button>
              
              <button
                onClick={() => setPhase('select')}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition flex items-center justify-center gap-2 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300"
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
