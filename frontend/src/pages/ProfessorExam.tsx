import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  Award, 
  BookOpen, 
  Mic, 
  MicOff, 
  Send, 
  MessageSquare, 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle, 
  ArrowRight, 
  RefreshCw, 
  X, 
  Volume2, 
  Sparkles, 
  Play, 
  Pause, 
  Square, 
  ChevronDown, 
  Zap, 
  Check, 
  Star, 
  BookOpen as BookIcon 
} from 'lucide-react';
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
import { updateQuestProgress, recordStudyActivity } from '../api/quests';
import ConfettiCelebration from '../components/ConfettiCelebration';
import { playTTS, pauseTTS, resumeTTS, stopTTS } from '../utils/tts';
import { incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';

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

interface ExamStep {
  question: string;
  studentAnswer: string;
  answer: string;
  evaluation: EvaluationResult;
}

interface ProfessorConfig {
  id: string;
  name: string;
  avatar: string;
  title: string;
  character: string;
  specialties: string[];
  description: string;
  gradient: string;
  accentColor: string;
  borderColor: string;
  textAccent: string;
  hoverAccent: string;
}

const PROFESSORS: ProfessorConfig[] = [
  {
    id: 'arkadiy',
    name: 'Проф. Аркадий Степанович',
    avatar: '👨‍🏫',
    title: 'Доктор физико-математических наук, академик',
    character: 'Строгий, академичный, ценит точность формул и логику.',
    specialties: ['Точные науки', 'Математика', 'Алгоритмы'],
    description: 'Не терпит «воды» в ответах. Ценит строгие определения, четкие формулировки и логические доказательства.',
    gradient: 'from-blue-600 to-indigo-800 dark:from-blue-700 dark:to-indigo-900',
    accentColor: 'bg-indigo-600 text-white',
    borderColor: 'border-indigo-200 dark:border-indigo-800',
    textAccent: 'text-indigo-600 dark:text-indigo-400',
    hoverAccent: 'hover:border-indigo-500 dark:hover:border-indigo-400',
  },
  {
    id: 'elizaveta',
    name: 'Проф. Елизавета Петровна',
    avatar: '👩‍🏫',
    title: 'Заслуженный преподаватель гуманитарных дисциплин',
    character: 'Вдохновляющая, приветливая, любит примеры и творческие аналогии.',
    specialties: ['История', 'Философия', 'Литература', 'Этика'],
    description: 'Обращает внимание на глубину понимания сути, умение объяснять сложные вещи простыми словами и приводить живые примеры.',
    gradient: 'from-pink-500 to-purple-700 dark:from-pink-600 dark:to-purple-800',
    accentColor: 'bg-purple-600 text-white',
    borderColor: 'border-purple-200 dark:border-purple-800',
    textAccent: 'text-purple-600 dark:text-purple-400',
    hoverAccent: 'hover:border-purple-500 dark:hover:border-purple-400',
  },
  {
    id: 'max',
    name: 'ИИ-Тьютор Макс',
    avatar: '🧑‍💻',
    title: 'Практикующий Team Lead, эксперт по IT и разработке',
    character: 'Технологичный, современный, говорит на понятном IT-языке.',
    specialties: ['Программирование', 'IT-инженерия', 'Архитектура ПО'],
    description: 'Ценит практические кейсы, лаконичность рассуждений и реальный опыт решения прикладных задач.',
    gradient: 'from-emerald-500 to-teal-700 dark:from-emerald-600 dark:to-teal-800',
    accentColor: 'bg-emerald-600 text-white',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    textAccent: 'text-emerald-600 dark:text-emerald-400',
    hoverAccent: 'hover:border-emerald-500 dark:hover:border-emerald-400',
  }
];

const EXAM_LENGTHS = [
  { value: 3, label: '⚡ Экспресс-блиц', cost: 1, xp: 30, desc: 'Быстрый опрос по ключевым темам лекции.' },
  { value: 5, label: '🎓 Классический билет', cost: 2, xp: 50, desc: 'Стандартный академический зачет на прочность.' },
  { value: 10, label: '🔥 Ультимативный зачет', cost: 4, xp: 100, desc: 'Полная строгая проверка по всем нюансам лекции.' }
];

const getEnergyCost = (length: number) => {
  if (length === 3) return 1;
  if (length === 10) return 4;
  return 2;
};

const getProfTheme = (id: string) => {
  if (id === 'elizaveta') {
    return {
      border: 'border-purple-500 dark:border-purple-400',
      borderBg: 'border-purple-100 dark:border-purple-900/40',
      bg: 'bg-purple-50/10 dark:bg-purple-950/10',
      badge: 'bg-purple-500 text-white',
      chip: 'bg-purple-100/50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      glow: 'shadow-purple-500/10 dark:shadow-purple-500/5',
      accentColorClass: 'text-purple-600 dark:text-purple-400',
      button: 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-200 dark:shadow-none'
    };
  }
  if (id === 'max') {
    return {
      border: 'border-emerald-500 dark:border-emerald-400',
      borderBg: 'border-emerald-100 dark:border-emerald-900/40',
      bg: 'bg-emerald-50/10 dark:bg-emerald-950/10',
      badge: 'bg-emerald-500 text-white',
      chip: 'bg-emerald-100/50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      glow: 'shadow-emerald-500/10 dark:shadow-emerald-500/5',
      accentColorClass: 'text-emerald-600 dark:text-emerald-400',
      button: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 dark:shadow-none'
    };
  }
  return {
    border: 'border-indigo-500 dark:border-indigo-400',
    borderBg: 'border-indigo-100 dark:border-indigo-900/40',
    bg: 'bg-indigo-50/10 dark:bg-indigo-950/10',
    badge: 'bg-indigo-500 text-white',
    chip: 'bg-indigo-100/50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    glow: 'shadow-indigo-500/10 dark:shadow-indigo-500/5',
    accentColorClass: 'text-indigo-600 dark:text-indigo-400',
    button: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 dark:shadow-none'
  };
};

const VoiceWaveform = ({ colorClass = 'bg-indigo-500' }: { colorClass?: string }) => {
  return (
    <div className="flex items-center gap-1 h-6 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200/50 dark:border-slate-700/50 shadow-inner">
      {[...Array(12)].map((_, i) => {
        const duration = 0.5 + Math.random() * 0.5;
        const delay = i * 0.05;
        return (
          <motion.div
            key={i}
            animate={{
              height: [4, 18, 4],
            }}
            transition={{
              duration: duration,
              repeat: Infinity,
              delay: delay,
              ease: "easeInOut"
            }}
            className={`w-0.5 rounded-full ${colorClass}`}
          />
        );
      })}
    </div>
  );
};

const RecordingWaveform = ({ colorClass = 'bg-rose-500' }: { colorClass?: string }) => {
  return (
    <div className="flex items-center gap-0.5 h-5">
      {[...Array(8)].map((_, i) => (
        <motion.div
          key={i}
          animate={{
            scaleY: [1, 2.5, 1],
          }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.07,
            ease: "easeInOut"
          }}
          className={`w-0.5 rounded-full h-2.5 ${colorClass} origin-center`}
        />
      ))}
    </div>
  );
};

export default function ProfessorExam() {
  const { user } = useAuth();
  const { confirm, alert } = useConfirm();
  const navigate = useNavigate();
  const { verifyEnergy } = useEnergyConfirm();

  // Восстановление состояния из localStorage
  const savedStateStr = localStorage.getItem('studyforge_professor_exam_state');
  const savedState = savedStateStr ? JSON.parse(savedStateStr) : null;

  // Состояние материалов
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(savedState?.selectedMaterialId || '');
  
  // Новые состояния экзаменатора и настроек
  const [selectedProfId, setSelectedProfId] = useState<'arkadiy' | 'elizaveta' | 'max'>(
    savedState?.selectedProfId || 'arkadiy'
  );
  const [examLength, setExamLength] = useState<3 | 5 | 10>(savedState?.examLength || 5);
  const [currentStep, setCurrentStep] = useState<number>(savedState?.currentStep || 0);
  const [examSteps, setExamSteps] = useState<ExamStep[]>(savedState?.examSteps || []);

  // Базовые фазы экзамена
  const [phase, setPhase] = useState<'select' | 'question' | 'step_feedback' | 'final_gradebook' | 'loading'>(
    savedState?.phase === 'loading' ? 'select' : (savedState?.phase || 'select')
  );
  
  const [currentQuestion, setCurrentQuestion] = useState<string>(savedState?.currentQuestion || '');
  const [answerText, setAnswerText] = useState<string>(savedState?.answerText || '');
  const [interimText, setInterimText] = useState<string>('');
  
  // Простая плоская история для совместимости с внешними блоками / DB
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

  // Конфетти
  const [showConfetti, setShowConfetti] = useState(false);

  // Состояние TTS
  const [ttsState, setTtsState] = useState<'playing' | 'paused' | 'stopped'>('stopped');

  // Сохранение состояния в localStorage
  useEffect(() => {
    localStorage.setItem('studyforge_professor_exam_state', JSON.stringify({
      selectedMaterialId,
      selectedProfId,
      examLength,
      currentStep,
      examSteps,
      phase,
      currentQuestion,
      answerText,
      history,
      evaluation,
      socraticMode
    }));
  }, [
    selectedMaterialId, 
    selectedProfId, 
    examLength, 
    currentStep, 
    examSteps, 
    phase, 
    currentQuestion, 
    answerText, 
    history, 
    evaluation, 
    socraticMode
  ]);

  // Остановка озвучки при смене фазы или уходе со страницы
  useEffect(() => {
    if (phase !== 'question' && phase !== 'step_feedback') {
      stopTTS();
      setTtsState('stopped');
    }

    return () => {
      stopTTS();
    };
  }, [phase]);

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
    if (!user) {
      await alert({ title: 'Сессия истекла', message: 'Ваша сессия истекла. Пожалуйста, обновите страницу или войдите заново.', type: 'danger' });
      return;
    }
    
    if (!selectedMaterial) {
      await alert({ title: 'Ошибка', message: 'Материал не выбран или не загружен. Попробуйте обновить страницу.', type: 'danger' });
      return;
    }
    
    setPhase('loading');
    setAnswerText('');
    
    let currentSteps = examSteps;
    if (clearHistory) {
      currentSteps = [];
      setExamSteps([]);
      setCurrentStep(0);
      setHistory([]);
      setEvaluation(null);
    }

    // Собираем историю для контекста
    const historyText = currentSteps
      .map((h, idx) => `Билет ${idx + 1}. В: ${h.question}\nО: ${h.studentAnswer}\nОценка: ${h.evaluation.grade}`)
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

    // Списание энергии происходит ОДИН раз при старте нового экзамена
    if (clearHistory && user?.id) {
      const cost = getEnergyCost(examLength);
      const ok = await verifyEnergy(user.id, cost, 'AI-Экзаменатор');
      if (!ok) {
        setPhase('select');
        return;
      }
      await incrementAIUsage(user.id, cost);
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
          professor_id: selectedProfId
        })
      });

      if (!res.ok) throw new Error('Ошибка связи с сервером');
      const data = await res.json();
      setCurrentQuestion(data.question);
      setPhase('question');
    } catch (err) {
      console.error(err);
      await alert({ title: 'Ошибка', message: 'Не удалось задать вопрос. Попробуйте еще раз.', type: 'danger' });
      setPhase(clearHistory ? 'select' : 'step_feedback');
    }
  };

  // Отправить ответ на оценку
  const submitAnswer = async () => {
    if (!answerText.trim()) return;
    
    if (!user) {
      await alert({ title: 'Сессия истекла', message: 'Ваша сессия истекла. Пожалуйста, обновите страницу или войдите заново.', type: 'danger' });
      return;
    }

    if (!selectedMaterial) {
      await alert({ title: 'Ошибка', message: 'Материал не загружен. Возможно, он был удален или сессия устарела. Попробуйте обновить страницу.', type: 'danger' });
      return;
    }

    setPhase('loading');

    const summary = typeof selectedMaterial.summary_json === 'string'
      ? selectedMaterial.summary_json
      : (selectedMaterial.summary_json?.content || '');
    const context = (selectedMaterial.original_text || summary || '').slice(0, 20000);

    // Энергия уже списана при старте! Внутри шагов мы её больше не списываем
    try {
      const res = await fetch('/api/professor/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          question: currentQuestion,
          student_answer: answerText,
          professor_id: selectedProfId
        })
      });

      if (!res.ok) throw new Error('Ошибка оценки');
      const evalData: EvaluationResult = await res.json();
      
      setEvaluation(evalData);
      
      // Конфетти при отличной оценке (5)
      if (evalData.grade === '5') {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 100);
      }
      
      // Добавляем к шагам
      const newStep: ExamStep = {
        question: currentQuestion,
        studentAnswer: answerText,
        answer: answerText,
        evaluation: evalData
      };
      const updatedSteps = [...examSteps, newStep];
      setExamSteps(updatedSteps);

      // Добавляем в простую историю (для совместимости)
      setHistory(prev => [
        ...prev,
        { question: currentQuestion, answer: answerText, grade: evalData.grade }
      ]);

      // Если это ПОСЛЕДНИЙ вопрос билета, записываем всю сессию в Supabase!
      if (currentStep === examLength - 1) {
        if (user) {
          const avgScore = Math.round(updatedSteps.reduce((acc, step) => acc + step.evaluation.score, 0) / updatedSteps.length);
          
          const { data: sessionData } = await supabase.from('exam_sessions').insert({
            user_id: user.id,
            material_id: selectedMaterial?.id ?? null,
            subject: selectedMaterial?.subject ?? '',
            score: avgScore,
            questions_json: updatedSteps,
            total_questions: updatedSteps.length,
            status: 'completed',
            completed_at: new Date().toISOString()
          }).select().single();

          if (sessionData) {
            fetchExamHistory();
            await updateQuestProgress(user.id, 'exam', 1);
          }

          await recordStudyActivity(user.id, 1, 0);

          // Сохраняем все накопившиеся ошибки и упущения в дневник ошибок
          const mistakesToSave: any[] = [];
          updatedSteps.forEach((step) => {
            step.evaluation.errors.forEach((err: string) => {
              mistakesToSave.push({
                user_id: user.id,
                material_id: selectedMaterial?.id ?? null,
                question: step.question,
                correct_answer: err,
                student_answer: step.studentAnswer,
                topic: selectedMaterial?.subject ?? '',
                is_resolved: false,
              });
            });
            step.evaluation.missing_points.forEach((miss: string) => {
              mistakesToSave.push({
                user_id: user.id,
                material_id: selectedMaterial?.id ?? null,
                question: step.question,
                correct_answer: miss,
                student_answer: '(не упомянуто)',
                topic: selectedMaterial?.subject ?? '',
                is_resolved: false,
              });
            });
          });

          if (mistakesToSave.length > 0) {
            await supabase.from('mistake_diary').insert(mistakesToSave);
          }
        }
      }

      setPhase('step_feedback');
    } catch (err) {
      console.error(err);
      await alert({ title: 'Ошибка', message: 'Ошибка при оценке ответа. Пожалуйста, попробуйте отправить заново.', type: 'danger' });
      setPhase('question');
    }
  };

  const handleNextStep = async () => {
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    setAnswerText('');
    setInterimText('');
    await startExamOrNextQuestion(false);
  };

  // Цвета для академической оценки
  const getGradeColors = (grade: string) => {
    switch (grade) {
      case '5': return {
        bg: 'bg-gradient-to-br from-emerald-50/90 to-teal-50/40 dark:from-emerald-950/40 dark:to-teal-950/20 border-emerald-200/60 dark:border-emerald-800 shadow-lg shadow-emerald-100/10 backdrop-blur-md',
        text: 'text-emerald-950 dark:text-emerald-100',
        textColor: 'text-emerald-800 dark:text-emerald-300',
        sealBg: 'bg-gradient-to-tr from-emerald-500 to-teal-500 shadow-emerald-200 dark:shadow-none border border-emerald-400',
        label: '🏆 Отлично (5)'
      };
      case '4': return {
        bg: 'bg-gradient-to-br from-indigo-50/90 to-blue-50/40 dark:from-indigo-950/40 dark:to-blue-950/20 border-indigo-200/60 dark:border-indigo-800 shadow-lg shadow-indigo-100/10 backdrop-blur-md',
        text: 'text-indigo-950 dark:text-indigo-100',
        textColor: 'text-indigo-800 dark:text-indigo-300',
        sealBg: 'bg-gradient-to-tr from-indigo-500 to-blue-500 shadow-indigo-200 dark:shadow-none border border-indigo-400',
        label: '⭐ Хорошо (4)'
      };
      case '3': return {
        bg: 'bg-gradient-to-br from-amber-50/90 to-orange-50/40 dark:from-amber-950/40 dark:to-orange-950/20 border-amber-200/60 dark:border-amber-800 shadow-lg shadow-amber-100/10 backdrop-blur-md',
        text: 'text-amber-950 dark:text-amber-100',
        textColor: 'text-amber-800 dark:text-amber-300',
        sealBg: 'bg-gradient-to-tr from-amber-500 to-orange-500 shadow-amber-200 dark:shadow-none border border-amber-400',
        label: '📝 Удовлетворительно (3)'
      };
      default: return {
        bg: 'bg-gradient-to-br from-rose-50/90 to-red-50/40 dark:from-rose-950/40 dark:to-red-950/20 border-rose-200/60 dark:border-rose-800 shadow-lg shadow-rose-100/10 backdrop-blur-md',
        text: 'text-rose-950 dark:text-rose-100',
        textColor: 'text-rose-800 dark:text-rose-300',
        sealBg: 'bg-gradient-to-tr from-rose-500 to-red-500 shadow-rose-200 dark:shadow-none border border-rose-400',
        label: '❌ Неудовлетворительно (2)'
      };
    }
  };

  const activeProf = PROFESSORS.find(p => p.id === selectedProfId) || PROFESSORS[0];
  const profTheme = getProfTheme(selectedProfId);

  // Агрегированные оценки
  const avgScore = examSteps.length > 0 
    ? Math.round(examSteps.reduce((acc, step) => acc + step.evaluation.score, 0) / examSteps.length)
    : 0;

  const getGradeFromScore = (score: number): string => {
    if (score >= 85) return '5';
    if (score >= 70) return '4';
    if (score >= 50) return '3';
    return '2';
  };

  const finalGrade = getGradeFromScore(avgScore);

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto min-h-[80vh] flex flex-col justify-center select-none-elements">
      <ConfettiCelebration trigger={showConfetti} type="exam5" />
      
      {/* Заголовок */}
      <div className="flex items-center gap-2 mb-6 justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20 shadow-inner">
            <Award className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 tracking-wide uppercase">AI-Экзаменатор</h1>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Интерактивный устный зачет на прочность</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {phase !== 'select' && (
            <button
              onClick={async () => {
                if (await confirm({ title: 'Прервать сессию', message: 'Вы уверены, что хотите завершить экзамен? Весь текущий прогресс будет потерян.', type: 'warning' })) {
                  setPhase('select');
                  setCurrentQuestion('');
                  setAnswerText('');
                  setHistory([]);
                  setExamSteps([]);
                  setEvaluation(null);
                  setCurrentStep(0);
                }
              }}
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200/50 hover:bg-rose-50 hover:text-rose-600 rounded-xl text-slate-500 transition-all duration-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
            >
              <X className="w-3.5 h-3.5" /> Прервать
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        
        {/* ФАЗА 1: Выбор настроек и экзаменатора */}
        {phase === 'select' && (
          <motion.div
            key="select"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
          >
            {/* Карточка-приветствие */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-xl">
              <div className="absolute top-0 right-0 w-48 h-48 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />
              
              <div className="max-w-2xl mx-auto text-center space-y-4">
                <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-100 rounded-full dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/40">
                  Интеллектуальная подготовка
                </span>
                <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                  Выберите Экзаменатора и Тяните Билет
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-lg mx-auto">
                  ИИ-Профессор проверит ваше понимание лекции, выявит фактические неточности и составит зачетную ведомость. Отвечайте развернуто текстом или говорите в микрофон!
                </p>
              </div>

              {/* Выбор лекции */}
              <div className="max-w-xl mx-auto mt-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                    1. Выберите лекцию для проверки:
                  </label>
                  <CustomSelect
                    value={selectedMaterialId}
                    onChange={val => setSelectedMaterialId(val)}
                    placeholder="Какую лекцию будем сдавать?"
                    options={materials.map(m => ({ 
                      value: m.id, 
                      label: `${m.title} (${format(new Date(m.created_at), 'dd.MM.yyyy')})` 
                    }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-rose-500 shadow-sm"
                  />
                </div>

                {/* Выбор Профессора */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                    2. Выберите ИИ-Экзаменатора:
                  </label>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {PROFESSORS.map(prof => {
                      const isSelected = selectedProfId === prof.id;
                      const currentProfTheme = getProfTheme(prof.id);
                      return (
                        <motion.div
                          key={prof.id}
                          whileHover={{ y: -3 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => setSelectedProfId(prof.id as any)}
                          className={`cursor-pointer rounded-2xl border-2 p-4 transition-all duration-300 relative overflow-hidden flex flex-col h-full ${
                            isSelected
                              ? `${currentProfTheme.border} ${currentProfTheme.bg} ${currentProfTheme.glow} shadow-lg`
                              : 'border-slate-200/60 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 hover:border-slate-350 dark:hover:border-slate-700'
                          }`}
                        >
                          {isSelected && (
                            <div className={`absolute top-0 right-0 ${currentProfTheme.badge} rounded-bl-xl p-1.5 z-10`}>
                              <Check className="w-3.5 h-3.5 stroke-[3px]" />
                            </div>
                          )}
                          
                          <div className="flex items-center gap-3 mb-3">
                            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${prof.gradient} flex items-center justify-center text-xl shadow-md shrink-0`}>
                              {prof.avatar}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-black text-slate-800 dark:text-slate-200 text-xs leading-snug truncate">
                                {prof.name}
                              </h4>
                              <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block truncate mt-0.5">
                                {prof.specialties[0]}
                              </span>
                            </div>
                          </div>

                          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed flex-1">
                            {prof.character}
                          </p>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>

                {/* Выбор формата экзамена */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Длина */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                      3. Длина билета и расход энергии:
                    </label>
                    <div className="flex flex-col gap-2">
                      {EXAM_LENGTHS.map(opt => {
                        const isSelected = examLength === opt.value;
                        return (
                          <div
                            key={opt.value}
                            onClick={() => setExamLength(opt.value as any)}
                            className={`flex items-center justify-between p-3 rounded-2xl cursor-pointer border-2 transition-all duration-300 ${
                              isSelected
                                ? `${profTheme.border} ${profTheme.bg} shadow-md`
                                : 'border-slate-200/60 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <span className="text-xs font-black text-slate-800 dark:text-slate-200 block">{opt.label}</span>
                              <span className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight block mt-0.5">{opt.desc}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="px-2 py-0.5 rounded-lg bg-yellow-500/10 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-400 text-[10px] font-black flex items-center gap-0.5 border border-yellow-500/20">
                                <Zap className="w-3 h-3 fill-yellow-500" /> {opt.cost} ⚡
                              </span>
                              <span className={`px-1.5 py-0.5 rounded-lg text-[9px] font-black ${
                                isSelected ? 'bg-indigo-650 text-white dark:bg-indigo-500' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                              }`}>
                                +{opt.xp} XP
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Режим Сократа и Настрой */}
                  <div className="space-y-4 flex flex-col justify-between">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                        4. Особый режим экзамена:
                      </label>
                      <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/50 p-3.5 rounded-2xl flex items-center justify-between shadow-inner">
                        <div className="space-y-0.5 pr-2">
                          <h4 className="font-black text-slate-800 dark:text-slate-200 text-xs uppercase tracking-wide flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                            Метод Сократа
                          </h4>
                          <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal">
                            Профессор будет задавать дополнительные каверзные вопросы и цепляться к неточностям.
                          </p>
                        </div>
                        
                        <button
                          onClick={() => setSocraticMode(p => !p)}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            socraticMode ? 'bg-purple-650' : 'bg-slate-200 dark:bg-slate-750'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              socraticMode ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Настрой пользователя */}
                    {todayMood ? (
                      <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-2xl p-3.5 flex items-center justify-between shadow-sm text-left">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">Ваше состояние учтено</p>
                          <p className="text-[9px] text-emerald-600 dark:text-emerald-400 mt-0.5 leading-snug">Сложность и стиль профессора будут мягко адаптированы.</p>
                        </div>
                        <span className="text-2xl filter drop-shadow-sm shrink-0 ml-2">
                          {todayMood.mood === 'great' ? '🚀' : todayMood.mood === 'good' ? '😊' : todayMood.mood === 'okay' ? '😐' : todayMood.mood === 'tired' ? '😴' : '😰'}
                        </span>
                      </div>
                    ) : (
                      <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/50 dark:border-indigo-900/40 rounded-2xl p-3.5 shadow-sm text-left flex justify-between items-center">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-indigo-800 dark:text-indigo-300 uppercase tracking-wide">Адаптировать сложность?</p>
                          <p className="text-[9px] text-indigo-600 dark:text-indigo-400 mt-0.5 leading-snug">Укажите ваше состояние, чтобы снизить каверзность при усталости.</p>
                        </div>
                        <Link to="/mood" className="text-[10px] px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg font-black shrink-0 hover:bg-indigo-750 transition shadow-sm ml-2">
                          Настроить
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                {/* Кнопка входа */}
                <button
                  disabled={!selectedMaterialId}
                  onClick={() => startExamOrNextQuestion(true)}
                  className={`w-full py-4 rounded-2xl font-black transition-all duration-300 flex items-center justify-center gap-2.5 shadow-lg ${
                    selectedMaterialId 
                      ? profTheme.button 
                      : 'bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <ArrowRight className="w-5 h-5" /> 
                  Войти в аудиторию ({getEnergyCost(examLength)} ⚡)
                </button>
              </div>
            </div>

            {/* История экзаменов */}
            {examHistory.length > 0 && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 md:p-6 shadow-md">
                <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-850 pb-3">
                  <h3 className="font-extrabold text-slate-800 dark:text-slate-200 text-xs uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                    Предыдущие зачетные сессии
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {examHistory.map(session => (
                    <div key={session.id} className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-150/40 dark:border-slate-700/50 hover:bg-slate-100/50 dark:hover:bg-slate-800/60 transition-all">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-[11px] font-black text-slate-700 dark:text-slate-200 truncate">{session.subject || 'Без предмета'}</span>
                          <span className="px-1.5 py-0.5 bg-slate-200/60 dark:bg-slate-750 text-slate-500 dark:text-slate-400 rounded-md text-[8px] font-bold shrink-0">
                            {new Date(session.completed_at).toLocaleDateString('ru-RU')}
                          </span>
                        </div>
                        <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">Сдано билетов: {session.total_questions || 1}</p>
                      </div>
                      <div className="flex items-center gap-3 ml-3 shrink-0">
                        <div className="text-right">
                          <p className={`text-sm font-black ${
                            session.score >= 85 ? 'text-emerald-600 dark:text-emerald-405' : session.score >= 70 ? 'text-indigo-600 dark:text-indigo-405' : 'text-amber-600'
                          }`}>{session.score}%</p>
                          <p className="text-[8px] text-slate-400 uppercase font-black tracking-widest mt-0.5">Точность</p>
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
            className="flex flex-col items-center justify-center py-20 text-center space-y-6"
          >
            <div className="relative mb-2">
              <div className={`w-20 h-20 border-4 border-slate-100 border-t-indigo-600 dark:border-slate-800 rounded-full animate-spin`} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Award className="w-8 h-8 text-indigo-500 animate-pulse" />
              </div>
            </div>
            <div>
              <h3 className="font-extrabold text-slate-850 dark:text-slate-200 text-base mb-1">
                {currentStep === 0 ? 'Формулируется первый билет...' : 'Профессор проверяет билет...'}
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 max-w-xs leading-relaxed uppercase tracking-wider font-bold mx-auto">
                {currentStep === 0 ? 'Составляются каверзные вопросы на понимание' : 'Анализируется когнитивная полнота ответа'}
              </p>
            </div>
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              
              {/* Левый сайдбар: Карточка профессора */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-lg flex flex-col items-center text-center relative overflow-hidden">
                  <div className={`absolute -top-10 -left-10 w-24 h-24 rounded-full blur-2xl opacity-10 bg-gradient-to-br ${activeProf.gradient}`} />
                  
                  <div className="relative mb-3">
                    <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${activeProf.gradient} flex items-center justify-center text-4xl shadow-md border-4 border-white dark:border-slate-800`} />
                    <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        isListening ? 'bg-rose-400 animate-pulse' : ttsState === 'playing' ? 'bg-indigo-400' : 'bg-green-400'
                      }`} />
                      <span className={`relative inline-flex rounded-full h-4 w-4 ${
                        isListening ? 'bg-rose-500' : ttsState === 'playing' ? 'bg-indigo-500' : 'bg-green-500'
                      }`} />
                    </span>
                  </div>

                  <h3 className="font-extrabold text-slate-850 dark:text-slate-200 text-sm leading-tight">{activeProf.name}</h3>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mt-0.5">{activeProf.title}</p>
                  
                  {/* Статус экзаменатора */}
                  <div className="mt-4 w-full bg-slate-50 dark:bg-slate-800/40 border border-slate-150/40 dark:border-slate-700/50 rounded-2xl p-3.5 text-xs flex flex-col items-center gap-1.5 shadow-inner">
                    <span className="font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-[8px]">Статус экзаменатора</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 text-center">
                      {isListening ? (
                        <span className="text-rose-600 dark:text-rose-455 flex items-center gap-1.5 justify-center">
                          <Mic className="w-3.5 h-3.5 animate-pulse" /> Внимательно слушает...
                        </span>
                      ) : ttsState === 'playing' ? (
                        <span className="text-indigo-650 dark:text-indigo-405 flex items-center gap-1.5 justify-center">
                          <Volume2 className="w-3.5 h-3.5" /> Озвучивает билет...
                        </span>
                      ) : (
                        <span className="text-slate-655 dark:text-slate-400 flex items-center gap-1.5 justify-center">
                          <Sparkles className="w-3.5 h-3.5 text-yellow-505" /> Ожидает вашего ответа
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                
                {/* Карточка деталей сессии */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-4.5 shadow-md text-[11px] space-y-2.5">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Дисциплина:</span>
                    <span className="text-slate-850 dark:text-slate-200 font-extrabold max-w-[130px] truncate" title={selectedMaterial?.title}>{selectedMaterial?.title}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Формат билета:</span>
                    <span className="text-slate-850 dark:text-slate-200 font-extrabold">
                      {examLength === 3 ? '⚡ Блиц (3 вопр.)' : examLength === 5 ? '🎓 Классик (5 вопр.)' : '🔥 Ультимейт (10 вопр.)'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Режим Сократа:</span>
                    <span className={`px-2 py-0.5 rounded-md font-black text-[9px] uppercase tracking-wider ${
                      socraticMode ? 'bg-purple-100 text-purple-750 dark:bg-purple-950/40 dark:text-purple-300' : 'bg-slate-105 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      {socraticMode ? 'Включен' : 'Выключен'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Правая часть: Билет и форма ввода */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Экзаменационный Билет (3D Frame) */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep}
                    initial={{ rotateY: 35, opacity: 0, y: 15 }}
                    animate={{ rotateY: 0, opacity: 1, y: 0 }}
                    exit={{ rotateY: -35, opacity: 0, y: -15 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="relative bg-amber-50/20 dark:bg-slate-950/40 border border-amber-200/50 dark:border-amber-950/20 rounded-3xl shadow-xl p-5 md:p-8 overflow-hidden"
                    style={{ transformStyle: 'preserve-3d', perspective: 1000 }}
                  >
                    <Award className="absolute -bottom-12 -right-12 w-44 h-44 text-amber-600/5 dark:text-amber-500/2 pointer-events-none" />
                    
                    {/* Заголовок билета */}
                    <div className="flex items-center justify-between border-b border-amber-250/30 dark:border-amber-900/20 pb-3 mb-5">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-amber-600 dark:text-amber-500" />
                        <span className="font-serif text-[11px] uppercase tracking-widest text-amber-900 dark:text-amber-400 font-extrabold">ЭКЗАМЕНАЦИОННЫЙ БИЛЕТ №{currentStep + 1}</span>
                      </div>
                      <span className="text-[9px] uppercase font-black tracking-widest text-amber-800 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-950/30 px-2 py-0.5 rounded border border-amber-200/30 dark:border-amber-900/20">
                        Билет {currentStep + 1} из {examLength}
                      </span>
                    </div>

                    {/* Текст вопроса */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="font-bold text-slate-400 dark:text-slate-500 text-[9px] uppercase tracking-widest">Формулировка вопроса:</h4>
                        
                        <div className="flex items-center gap-1.5">
                          {ttsState === 'playing' ? (
                            <>
                              <VoiceWaveform colorClass={selectedProfId === 'elizaveta' ? 'bg-purple-500' : selectedProfId === 'max' ? 'bg-emerald-500' : 'bg-indigo-500'} />
                              <button onClick={() => { pauseTTS(); setTtsState('paused'); }} className="p-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-slate-650 dark:text-slate-300 transition" title="Пауза">
                                <Pause className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <button onClick={() => { 
                              const voiceRole: 'professor' | 'female' | 'male' = 
                                selectedProfId === 'elizaveta' ? 'female' : 
                                selectedProfId === 'max' ? 'male' : 'professor';
                              if (ttsState === 'paused') { resumeTTS(); setTtsState('playing'); }
                              else { playTTS(currentQuestion, voiceRole, () => setTtsState('stopped')); setTtsState('playing'); }
                            }} className="p-1.5 bg-slate-100 hover:bg-slate-250 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-350 transition flex items-center gap-1 text-[9px] font-black uppercase px-2.5 py-1.5 border border-slate-200/40 dark:border-slate-700" title="Зачитать вопрос">
                              <Volume2 className="w-3.5 h-3.5 text-rose-500" /> Озвучить вопрос
                            </button>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed font-serif pl-4 border-l-4 border-amber-300 dark:border-amber-800/60 markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{currentQuestion}</ReactMarkdown>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>

                {/* Ввод ответа студента */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Ваш аргументированный ответ:</label>
                    
                    {SpeechRecognition && (
                      <div className="flex items-center gap-2">
                        {isListening && <RecordingWaveform colorClass="bg-rose-500" />}
                        <button
                          onClick={toggleListening}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all duration-300 shadow-sm border ${
                            isListening
                              ? 'bg-rose-100 border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-900/60 dark:text-rose-350 animate-pulse'
                              : 'bg-slate-50 border-slate-200/50 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-750'
                          }`}
                        >
                          {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-rose-500" />}
                          {isListening ? 'Идет запись...' : 'Голосовой ввод'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <textarea
                      value={answerText + (interimText ? (answerText ? ' ' : '') + interimText : '')}
                      onChange={e => {
                        setAnswerText(e.target.value);
                        setInterimText('');
                      }}
                      placeholder="Формулируйте мысли структурировано, приводите примеры и пишите развернуто..."
                      className="w-full h-40 px-4 py-3.5 border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-rose-500 transition resize-none bg-slate-50/30 dark:bg-slate-800/40 dark:border-slate-700 dark:text-slate-100 dark:placeholder-slate-500"
                    />
                    <span className="absolute bottom-2.5 right-3 text-[9px] font-black text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 px-1.5 py-0.5 rounded-md">
                      Слов: {answerText.trim() === '' ? 0 : answerText.trim().split(/\s+/).length}
                    </span>
                  </div>

                  <div className="flex gap-3">
                    <button
                      disabled={!answerText.trim()}
                      onClick={submitAnswer}
                      className={`flex-1 py-3.5 rounded-2xl font-black transition-all duration-300 flex items-center justify-center gap-2 shadow-lg border border-transparent ${profTheme.button} disabled:opacity-50 disabled:pointer-events-none`}
                    >
                      <Send className="w-4 h-4" /> Ответить Профессору
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ФАЗА 3: Промежуточная оценка шага */}
        {phase === 'step_feedback' && evaluation && (
          <motion.div
            key="step_feedback"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            {/* Оценка и отзыв за билет */}
            {(() => {
              const colors = getGradeColors(evaluation.grade);
              return (
                <div className={`border rounded-3xl p-5 md:p-7 flex flex-col md:flex-row items-center gap-6 md:gap-8 ${colors.bg}`}>
                  <div className="shrink-0 flex flex-col items-center justify-center">
                    <div className={`w-20 h-20 rounded-full flex flex-col items-center justify-center text-white font-black text-3xl shadow-xl ${colors.sealBg} relative overflow-hidden border-4 border-white dark:border-slate-800`}>
                      <div className="absolute inset-1 bg-transparent rounded-full border border-dashed border-white/20 scale-95" />
                      {evaluation.grade}
                    </div>
                    <span className="text-[8px] font-black text-slate-400 dark:text-slate-500 mt-2 tracking-wider uppercase bg-white/80 dark:bg-slate-900/80 border border-slate-150/40 dark:border-slate-800 px-2 py-0.5 rounded-full shadow-sm">Билет сдан</span>
                  </div>

                  <div className="flex-1 space-y-4 w-full">
                    <div className="text-center md:text-left">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-[9px] font-black tracking-widest uppercase bg-white/90 dark:bg-slate-900/90 border border-slate-200/50 dark:border-slate-800 shadow-sm ${colors.textColor}`}>
                        {colors.label}
                      </span>
                    </div>

                    {/* Комментарий экзаменатора */}
                    <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-100/80 dark:border-slate-800 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${activeProf.gradient} flex items-center justify-center text-lg shadow-inner shrink-0`}>
                          {activeProf.avatar}
                        </div>
                        <div className="flex-1 space-y-1 min-w-0">
                          <div className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Вердикт {activeProf.name}</div>
                          <p className="text-slate-700 dark:text-slate-300 italic font-semibold text-xs leading-relaxed pl-3 border-l-2 border-rose-455">
                            "{evaluation.verdict}"
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Шкала точности */}
                    <div className="flex items-center justify-between gap-4 pt-1 flex-wrap md:flex-nowrap">
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Точность шага:</span>
                        <span className="text-xs font-black text-slate-800 dark:text-slate-250">{evaluation.score}%</span>
                      </div>
                      <div className="flex-1 min-w-[150px] h-2 bg-slate-200/60 dark:bg-slate-850 rounded-full overflow-hidden relative">
                        <div 
                          className={`h-full bg-gradient-to-r ${activeProf.gradient} rounded-full`} 
                          style={{ width: `${evaluation.score}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Когнитивный разбор шага */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              
              {/* Усвоено верно */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col h-full">
                <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100/40 dark:border-emerald-900/30 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="font-black text-emerald-950 dark:text-emerald-100 text-[10px] uppercase tracking-widest">Усвоено верно</h4>
                    <p className="text-[9px] text-slate-400 dark:text-slate-550">Плюсы вашего ответа</p>
                  </div>
                </div>
                <div className="flex-1">
                  {evaluation.correct_points.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center p-4">
                      <p className="text-slate-400 dark:text-slate-500 text-xs italic">Нет полностью верных фактов.</p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {evaluation.correct_points.map((p, i) => (
                        <li key={i} className="text-slate-700 dark:text-slate-350 text-xs leading-relaxed flex items-start gap-2 bg-emerald-50/10 dark:bg-emerald-950/10 border border-emerald-50/20 dark:border-emerald-900/20 p-2 rounded-xl">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0 mt-1.5" />
                          <span className="font-semibold">{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Фактические ошибки */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col h-full">
                <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-100/40 dark:border-rose-900/30 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-455" />
                  </div>
                  <div>
                    <h4 className="font-black text-rose-950 dark:text-rose-100 text-[10px] uppercase tracking-widest">Ошибки</h4>
                    <p className="text-[9px] text-slate-400 dark:text-slate-550">Фактические неточности</p>
                  </div>
                </div>
                <div className="flex-1">
                  {evaluation.errors.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4">
                      <span className="text-xl">🛡️</span>
                      <p className="text-emerald-700 dark:text-emerald-400 text-xs font-black uppercase mt-1">Ошибок нет!</p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {evaluation.errors.map((p, i) => (
                        <li key={i} className="text-slate-700 dark:text-slate-350 text-xs leading-relaxed flex items-start gap-2 bg-rose-50/10 dark:bg-rose-950/10 border border-rose-50/20 dark:border-rose-900/20 p-2 rounded-xl">
                          <span className="w-1.5 h-1.5 bg-rose-500 rounded-full shrink-0 mt-1.5" />
                          <span className="font-semibold">{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Упущенное */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col h-full">
                <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100/40 dark:border-amber-900/30 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h4 className="font-black text-amber-950 dark:text-amber-100 text-[10px] uppercase tracking-widest">Пропуски</h4>
                    <p className="text-[9px] text-slate-400 dark:text-slate-550">Важно упомянуть</p>
                  </div>
                </div>
                <div className="flex-1">
                  {evaluation.missing_points.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4">
                      <span className="text-xl">🎯</span>
                      <p className="text-emerald-700 dark:text-emerald-400 text-xs font-black uppercase mt-1">Полный ответ!</p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {evaluation.missing_points.map((p, i) => (
                        <li key={i} className="text-slate-700 dark:text-slate-350 text-xs leading-relaxed flex items-start gap-2 bg-amber-50/10 dark:bg-amber-950/10 border border-amber-50/20 dark:border-amber-900/20 p-2 rounded-xl">
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full shrink-0 mt-1.5" />
                          <span className="font-semibold">{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Действия */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              {currentStep < examLength - 1 ? (
                <button
                  onClick={handleNextStep}
                  className={`flex-1 py-3.5 rounded-2xl font-black transition-all duration-300 flex items-center justify-center gap-2 shadow-lg border border-transparent ${profTheme.button}`}
                >
                  <RefreshCw className="w-4 h-4 animate-spin-slow" /> Тянуть следующий билет →
                </button>
              ) : (
                <button
                  onClick={() => setPhase('final_gradebook')}
                  className={`flex-1 py-3.5 rounded-2xl font-black transition-all duration-300 flex items-center justify-center gap-2 shadow-lg border border-transparent ${profTheme.button}`}
                >
                  <Award className="w-4 h-4" /> Посмотреть зачетную книжку 🎓
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* ФАЗА 4: Итоговая Зачетная Ведомость (Gradebook) */}
        {phase === 'final_gradebook' && (
          <motion.div
            key="final_gradebook"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            {/* Сама зачетка */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
              <div className={`h-2.5 bg-gradient-to-r ${activeProf.gradient}`} />
              
              <div className="p-5 md:p-8">
                {/* Шапка результата */}
                <div className="text-center mb-8 pb-5 border-b border-slate-100 dark:border-slate-850">
                  <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100">
                    Результат проверки
                  </h2>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                  
                  {/* Левая страница: сведения, средний балл и оценка */}
                  <div className="space-y-5 bg-slate-50/50 dark:bg-slate-800/20 border border-slate-150/40 dark:border-slate-800/80 p-5 rounded-2xl relative shadow-inner">
                    <h3 className="font-extrabold text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-200/40 dark:border-slate-850 pb-2 mb-3">Сведения</h3>
                    
                    <div className="space-y-2.5 text-xs">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-200/30 dark:border-slate-800/40">
                        <span className="text-slate-400 font-semibold">Студент:</span>
                        <span className="text-slate-800 dark:text-slate-200 font-black">{user?.email?.split('@')[0] || 'Пользователь'}</span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-slate-200/30 dark:border-slate-800/40">
                        <span className="text-slate-400 font-semibold">Дисциплина:</span>
                        <span className="text-slate-850 dark:text-slate-205 font-extrabold max-w-[170px] truncate" title={selectedMaterial?.title}>{selectedMaterial?.title}</span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-slate-200/30 dark:border-slate-800/40">
                        <span className="text-slate-400 font-semibold">Экзаменатор:</span>
                        <span className="text-slate-850 dark:text-slate-205 font-extrabold">{activeProf.name}</span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-slate-200/30 dark:border-slate-800/40">
                        <span className="text-slate-400 font-semibold">Билетов сдано:</span>
                        <span className="text-slate-850 dark:text-slate-205 font-extrabold">{examSteps.length} из {examLength}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 font-semibold">Дата сдачи:</span>
                        <span className="text-slate-850 dark:text-slate-205 font-extrabold">{format(new Date(), 'dd.MM.yyyy HH:mm')}</span>
                      </div>
                    </div>
                    
                    {/* Круговой индикатор + Печать */}
                    <div className="flex flex-col sm:flex-row items-center justify-around gap-6 pt-4 border-t border-slate-200/40 dark:border-slate-800">
                      
                      {/* Круг точности */}
                      <div className="flex flex-col items-center">
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-black mb-2.5">Средний балл</span>
                        <div className="relative w-24 h-24 flex items-center justify-center">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle cx="48" cy="48" r="40" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="5.5" fill="transparent" />
                            <motion.circle
                              cx="48"
                              cy="48"
                              r="40"
                              className={selectedProfId === 'elizaveta' ? 'stroke-purple-600' : selectedProfId === 'max' ? 'stroke-emerald-600' : 'stroke-indigo-600'}
                              strokeWidth="5.5"
                              strokeDasharray={2 * Math.PI * 40}
                              initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
                              animate={{ strokeDashoffset: 2 * Math.PI * 40 - (avgScore / 100) * 2 * Math.PI * 40 }}
                              transition={{ duration: 1.2, ease: 'easeOut' }}
                              fill="transparent"
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-xl font-black text-slate-850 dark:text-slate-100">{avgScore}%</span>
                            <span className="text-[8px] text-slate-400 uppercase font-black tracking-widest">верно</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Оценка */}
                      <div className="flex flex-col items-center">
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-black mb-2.5">Оценка</span>
                        <motion.div
                          initial={{ scale: 0.8, opacity: 0, rotate: -20 }}
                          animate={{ scale: 1, opacity: 1, rotate: 5 }}
                          transition={{ type: 'spring', stiffness: 90, delay: 0.3 }}
                          className={`w-24 h-24 rounded-full flex flex-col items-center justify-center text-white shadow-xl relative overflow-hidden border-4 border-white dark:border-slate-800 select-none ${
                            finalGrade === '5'
                              ? 'bg-gradient-to-tr from-emerald-650 to-teal-500 shadow-emerald-500/20'
                              : finalGrade === '4'
                              ? 'bg-gradient-to-tr from-indigo-650 to-blue-500 shadow-indigo-500/20'
                              : finalGrade === '3'
                              ? 'bg-gradient-to-tr from-amber-600 to-orange-500 shadow-amber-500/20'
                              : 'bg-gradient-to-tr from-rose-650 to-red-500 shadow-rose-500/20'
                          }`}
                        >
                          <div className="absolute inset-1 rounded-full border border-dashed border-white/20 scale-95" />
                          <span className="text-[7px] tracking-widest font-black uppercase text-white/70 absolute top-3">{finalGrade === '2' ? 'НЕ ЗАЧТЕНО' : 'ЗАЧТЕНО'}</span>
                          <span className="text-3xl font-black drop-shadow-md z-10">{finalGrade}</span>
                          <span className="text-[8px] tracking-widest font-black uppercase text-white/80 absolute bottom-3">
                            {finalGrade === '5' ? 'ОТЛИЧНО' : finalGrade === '4' ? 'ХОРОШО' : finalGrade === '3' ? 'УДОВЛ.' : 'НЕУДОВЛ.'}
                          </span>
                        </motion.div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Правая страница: Агрегированный разбор когнитивных точек */}
                  <div className="space-y-4">
                    <h3 className="font-extrabold text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-200/40 dark:border-slate-850 pb-2 mb-2">Общая аналитика сессии</h3>
                    
                    {/* Сильные стороны */}
                    <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-900/50">
                      <div className="flex items-center justify-between p-3.5 bg-emerald-50/20 dark:bg-emerald-950/10 border-b border-slate-150 dark:border-slate-850">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-450" />
                          <span className="text-[10px] font-black uppercase text-emerald-850 dark:text-emerald-300 tracking-wider">Усвоено на отлично ({examSteps.flatMap(s => s.evaluation.correct_points).length})</span>
                        </div>
                      </div>
                      <div className="p-3.5 max-h-40 overflow-y-auto space-y-2">
                        {examSteps.flatMap(s => s.evaluation.correct_points).length === 0 ? (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 italic text-center py-2">Мало сведений для анализа.</p>
                        ) : (
                          examSteps.flatMap(s => s.evaluation.correct_points).map((item, idx) => (
                            <div key={idx} className="text-xs text-slate-700 dark:text-slate-350 bg-emerald-50/10 dark:bg-emerald-950/10 border border-emerald-100/20 dark:border-emerald-900/20 p-2.5 rounded-xl flex items-start gap-2">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mt-1.5 shrink-0" />
                              <span>{item}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Ошибки */}
                    <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-900/50">
                      <div className="flex items-center justify-between p-3.5 bg-rose-50/20 dark:bg-rose-950/10 border-b border-slate-150 dark:border-slate-850">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-455" />
                          <span className="text-[10px] font-black uppercase text-rose-850 dark:text-rose-300 tracking-wider">Допущенные неточности ({examSteps.flatMap(s => s.evaluation.errors).length})</span>
                        </div>
                      </div>
                      <div className="p-3.5 max-h-40 overflow-y-auto space-y-2">
                        {examSteps.flatMap(s => s.evaluation.errors).length === 0 ? (
                          <div className="text-center py-2 flex flex-col items-center justify-center">
                            <span className="text-lg">🛡️</span>
                            <p className="text-[10px] text-emerald-700 dark:text-emerald-450 font-black uppercase mt-1">Идеально! Ошибок нет.</p>
                          </div>
                        ) : (
                          examSteps.flatMap(s => s.evaluation.errors).map((item, idx) => (
                            <div key={idx} className="text-xs text-slate-700 dark:text-slate-355 bg-rose-50/10 dark:bg-rose-950/10 border border-rose-100/20 dark:border-rose-900/20 p-2.5 rounded-xl flex items-start gap-2">
                              <span className="w-1.5 h-1.5 bg-rose-500 rounded-full mt-1.5 shrink-0" />
                              <span>{item}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Пропуски */}
                    <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-900/50">
                      <div className="flex items-center justify-between p-3.5 bg-amber-50/20 dark:bg-amber-950/10 border-b border-slate-150 dark:border-slate-850">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-450" />
                          <span className="text-[10px] font-black uppercase text-amber-850 dark:text-amber-300 tracking-wider">Упущенные моменты ({examSteps.flatMap(s => s.evaluation.missing_points).length})</span>
                        </div>
                      </div>
                      <div className="p-3.5 max-h-40 overflow-y-auto space-y-2">
                        {examSteps.flatMap(s => s.evaluation.missing_points).length === 0 ? (
                          <div className="text-center py-2 flex flex-col items-center justify-center">
                            <span className="text-lg">🎯</span>
                            <p className="text-[10px] text-emerald-700 dark:text-emerald-450 font-black uppercase mt-1">Исчерпывающие билеты!</p>
                          </div>
                        ) : (
                          examSteps.flatMap(s => s.evaluation.missing_points).map((item, idx) => (
                            <div key={idx} className="text-xs text-slate-700 dark:text-slate-355 bg-amber-50/10 dark:bg-amber-950/10 border border-amber-100/20 dark:border-amber-900/20 p-2.5 rounded-xl flex items-start gap-2">
                              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mt-1.5 shrink-0" />
                              <span>{item}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>
            
            {/* Действия */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => {
                  setPhase('select');
                  setCurrentQuestion('');
                  setAnswerText('');
                  setHistory([]);
                  setExamSteps([]);
                  setEvaluation(null);
                  setCurrentStep(0);
                }}
                className={`flex-1 py-3.5 rounded-2xl font-black transition-all duration-300 flex items-center justify-center gap-2 shadow-lg border border-transparent ${profTheme.button}`}
              >
                <RefreshCw className="w-4 h-4" /> Начать новый экзамен
              </button>
              <Link
                to="/materials"
                className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-705 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 rounded-2xl font-black transition flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700"
              >
                В библиотеку лекций
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
