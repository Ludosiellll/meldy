import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, BookOpen, AlertCircle, CheckCircle2, ChevronRight, HelpCircle, Trophy, Sparkles, X, ArrowRight, Lock, Unlock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { getMaterials } from '../api/materials';
import { updateQuestProgress, checkAndAwardAchievements, recordStudyActivity } from '../api/quests';
import ConfettiCelebration from '../components/ConfettiCelebration';
import AchievementToast from '../components/AchievementToast';
import type { Achievement } from '../components/AchievementToast';

interface Mission {
  id: number;
  title: string;
  explanation: string;
  question: string;
  options: string[];
  correct: string;
  hint: string;
}

export default function Missions() {
  const { user } = useAuth();
  const { confirm, alert } = useConfirm();
  const navigate = useNavigate();

  // Восстановление состояния из sessionStorage
  const savedStateStr = sessionStorage.getItem('studyforge_missions_state');
  const savedState = savedStateStr ? JSON.parse(savedStateStr) : null;

  // Состояние материалов
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(savedState?.selectedMaterialId || '');
  
  // Состояние игры
  const [phase, setPhase] = useState<'select' | 'loading' | 'game' | 'completed'>(
    savedState?.phase === 'loading' ? 'select' : (savedState?.phase || 'select')
  );
  const [missions, setMissions] = useState<Mission[]>(savedState?.missions || []);
  const [activeStep, setActiveStep] = useState<number>(savedState?.activeStep !== undefined ? savedState.activeStep : 0); // индекс текущей миссии (0, 1, 2)
  const [selectedOption, setSelectedOption] = useState<string | null>(savedState?.selectedOption || null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(savedState?.isCorrect !== undefined ? savedState.isCorrect : null);
  const [showHint, setShowHint] = useState<boolean>(savedState?.showHint || false);
  const [shake, setShake] = useState<boolean>(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [achievement, setAchievement] = useState<Achievement | null>(null);

  // Сохранение состояния в sessionStorage
  useEffect(() => {
    sessionStorage.setItem('studyforge_missions_state', JSON.stringify({
      selectedMaterialId,
      phase,
      missions,
      activeStep,
      selectedOption,
      isCorrect,
      showHint
    }));
  }, [selectedMaterialId, phase, missions, activeStep, selectedOption, isCorrect, showHint]);

  // Загрузка материалов
  useEffect(() => {
    if (!user) return;
    getMaterials(user.id).then(setMaterials).catch(console.error);
  }, [user?.id]);

  const selectedMaterial = materials.find(m => m.id === selectedMaterialId);

  // Старт игры: запрос генерации квестов
  const startGame = async () => {
    if (!selectedMaterial) return;
    setPhase('loading');
    setSelectedOption(null);
    setIsCorrect(null);
    setShowHint(false);
    setActiveStep(0);

    // 1. Проверяем, есть ли уже сгенерированные миссии в БД
    if (selectedMaterial.missions_json && selectedMaterial.missions_json.missions && selectedMaterial.missions_json.missions.length > 0) {
      setMissions(selectedMaterial.missions_json.missions);
      setPhase('game');
      return;
    }

    // 2. Если нет (старый материал), генерируем на лету
    const summary = typeof selectedMaterial.summary_json === 'string'
      ? selectedMaterial.summary_json
      : (selectedMaterial.summary_json?.content || '');
    const context = (selectedMaterial.original_text || summary || '').slice(0, 15000);

    try {
      const res = await fetch('/api/missions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context })
      });

      if (!res.ok) throw new Error('Ошибка генерации игры');
      const data = await res.json();
      
      if (data.missions && data.missions.length > 0) {
        setMissions(data.missions);
        setPhase('game');
      } else {
        throw new Error('Пустой список миссий');
      }
    } catch (err) {
      console.error(err);
      await alert({ title: 'Ошибка', message: 'Не удалось сформировать игру по материалу. Попробуйте еще раз.', type: 'danger' });
      setPhase('select');
    }
  };

  // Проверка ответа студента
  const handleOptionClick = (option: string) => {
    if (isCorrect) return; // уже ответил верно

    setSelectedOption(option);
    const correctLetter = missions[activeStep].correct; // 'A', 'B' или 'C'
    const isCorrectAnswer = option.startsWith(correctLetter);

    if (isCorrectAnswer) {
      setIsCorrect(true);
      setShowHint(false);
    } else {
      setIsCorrect(false);
      setShowHint(true);
      setShake(true);
      setTimeout(() => setShake(false), 500); // анимация тряски
    }
  };

  // Переход к следующей миссии
  const handleNextMission = async () => {
    setSelectedOption(null);
    setIsCorrect(null);
    setShowHint(false);

    if (activeStep + 1 >= missions.length) {
      // Все миссии пройдены!
      setShowConfetti(true);
      setPhase('completed');
      setTimeout(() => setShowConfetti(false), 100);
      
      // Запись сессии в Supabase для начисления XP и активности
      if (user) {
        await updateQuestProgress(user.id, 'quiz', 1);
        await recordStudyActivity(user.id, 3, 0);
        // Проверяем достижения
        const newAchs = await checkAndAwardAchievements(user.id);
        if (newAchs.length > 0) {
          setAchievement({ id: newAchs[0].id, title: newAchs[0].title, description: newAchs[0].description, icon: newAchs[0].icon, xp: newAchs[0].xp });
        }
      }
    } else {
      setActiveStep(prev => prev + 1);
    }
  };

  const currentMission = missions[activeStep];

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto min-h-[80vh] flex flex-col justify-center">
      <ConfettiCelebration trigger={showConfetti} type="quest" />
      <AchievementToast achievement={achievement} onClose={() => setAchievement(null)} />
      {/* Шапка */}
      <div className="flex items-center gap-2 mb-6 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Gamepad2 className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Интерактивные миссии</h1>
            <p className="text-xs text-slate-500">Геймификация сложных лекций в порции квестов</p>
          </div>
        </div>
        {phase !== 'select' && (
          <button
            onClick={async () => {
              if (await confirm({ title: 'Выход', message: 'Вы уверены, что хотите выйти из игры? Весь прогресс будет потерян.', type: 'warning' })) {
                setPhase('select');
                setMissions([]);
                setActiveStep(0);
                setSelectedOption(null);
                setIsCorrect(null);
                setShowHint(false);
              }
            }}
            className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 rounded-lg text-slate-600 transition"
          >
            <X className="w-3.5 h-3.5" /> Выйти из игры
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {/* ФАЗА 1: Выбор материала */}
        {phase === 'select' && (
          <motion.div
            key="select"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="card p-4 md:p-8 text-center"
          >
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Gamepad2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Микро-квесты по лекциям</h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
              AI-Методист разобьет сложную тему на 3 простые миссии. Изучите порции теории на простом языке и разблокируйте все уровни игры!
            </p>

            <div className="max-w-md mx-auto space-y-4">
              <div className="text-left">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Выберите лекцию из библиотеки:</label>
                <select
                  value={selectedMaterialId}
                  onChange={e => setSelectedMaterialId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition shadow-sm"
                >
                  <option value="">Выберите лекцию для игры</option>
                  {materials.map(m => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
              </div>

              <button
                disabled={!selectedMaterialId}
                onClick={startGame}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-100"
              >
                <ArrowRight className="w-5 h-5" /> Начать игру
              </button>
            </div>
          </motion.div>
        )}

        {/* ФАЗА ЗАГРУЗКИ / ГЕНЕРАЦИИ ИГРЫ */}
        {phase === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div className="relative mb-6">
              <div className="w-16 h-16 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Gamepad2 className="w-6 h-6 text-emerald-500 animate-pulse" />
              </div>
            </div>
            <h3 className="font-semibold text-slate-800 text-base mb-1">ИИ-Методист готовит сценарий квестов...</h3>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
              Сложная научная лекция переводится на игровой язык с метафорами и аналогиями
            </p>
          </motion.div>
        )}

        {/* ФАЗА 2: Игровой процесс */}
        {phase === 'game' && currentMission && (
          <motion.div
            key="game"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            {/* Визуальная шкала миссий */}
            <div className="flex items-center justify-between bg-slate-100 p-2.5 rounded-2xl border border-slate-200">
              {missions.map((m, idx) => {
                const isActive = activeStep === idx;
                const isPassed = activeStep > idx;
                const isLocked = activeStep < idx;

                return (
                  <div key={m.id} className="flex-1 flex items-center justify-center gap-1.5 relative">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm ${
                      isActive 
                        ? 'bg-emerald-600 text-white' 
                        : isPassed 
                        ? 'bg-emerald-100 text-emerald-700' 
                        : 'bg-slate-50 border border-slate-200 text-slate-400'
                    }`}>
                      {isPassed ? <CheckCircle2 className="w-3.5 h-3.5" /> : isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      <span>Миссия {idx + 1}</span>
                    </div>
                    {idx < missions.length - 1 && (
                      <div className="hidden sm:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                        <ChevronRight className="w-4 h-4 text-slate-300" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Игровой блок теории (простым языком) */}
            <div className="bg-gradient-to-br from-emerald-900 to-slate-900 text-white rounded-2xl p-4 md:p-6 shadow-xl relative border border-emerald-900/50 overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
              
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-black tracking-wider uppercase">Квест {activeStep + 1}: {currentMission.title}</span>
              </div>
              
              <div className="space-y-4">
                <h3 className="text-base font-extrabold text-white leading-snug">
                  📖 Теория на пальцах
                </h3>
                <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-line markdown-content white-text">
                  <ReactMarkdown>{currentMission.explanation}</ReactMarkdown>
                </div>
              </div>
            </div>

            {/* Проверочный вопрос */}
            <motion.div 
              animate={shake ? { x: [-10, 10, -10, 10, 0] } : {}}
              transition={{ duration: 0.4 }}
              className="card p-4 md:p-5 space-y-4 bg-white"
            >
              <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Испытание для разблокировки следующего уровня:</h4>
              </div>

              <div className="text-sm font-semibold text-slate-700 leading-relaxed mb-4 markdown-content">
                <ReactMarkdown>{currentMission.question}</ReactMarkdown>
              </div>

              {/* Кнопки ответов */}
              <div className="grid grid-cols-1 gap-3">
                {currentMission.options.map((opt) => {
                  const isThisSelected = selectedOption === opt;
                  const isCorrectAnswer = opt.startsWith(currentMission.correct);

                  let btnStyle = "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100";
                  if (selectedOption) {
                    if (isThisSelected) {
                      btnStyle = isCorrectAnswer 
                        ? "bg-emerald-50 border-emerald-300 text-emerald-800 ring-2 ring-emerald-500/20 font-bold" 
                        : "bg-rose-50 border-rose-300 text-rose-800 ring-2 ring-rose-500/20 font-bold";
                    } else if (isCorrectAnswer && !isCorrect) {
                      // подсвечиваем правильный если ответили неверно
                      btnStyle = "bg-emerald-50 border-emerald-200 text-emerald-700 opacity-60";
                    } else {
                      btnStyle = "bg-slate-50 border-transparent text-slate-400 opacity-40 cursor-default";
                    }
                  }

                  return (
                    <button
                      key={opt}
                      onClick={() => handleOptionClick(opt)}
                      disabled={isCorrect !== null}
                      className={`w-full p-3 md:p-4 rounded-xl border text-left text-xs sm:text-sm font-medium transition-all duration-200 flex justify-between items-center ${btnStyle}`}
                    >
                      <span>{opt}</span>
                      {selectedOption && isThisSelected && (
                        isCorrectAnswer 
                          ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> 
                          : <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Вывод подсказки при ошибке */}
              <AnimatePresence>
                {showHint && currentMission.hint && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden' }}
                    className="bg-amber-50 border border-amber-200 rounded-xl"
                  >
                    <div className="p-3.5 flex items-start gap-2 text-xs text-amber-800">
                      <AlertCircle className="w-4.5 h-4.5 shrink-0 text-amber-500 mt-0.5" />
                      <div>
                        <span className="font-bold block mb-0.5">💡 Подсказка AI-Методиста:</span>
                        {currentMission.hint}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Кнопка далее */}
              {isCorrect && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="pt-2"
                >
                  <button
                    onClick={handleNextMission}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-100"
                  >
                    {activeStep + 1 >= missions.length ? 'Завершить обучение 🎉' : 'Пройти к миссии ' + (activeStep + 2) + ' →'}
                  </button>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}

        {/* ФАЗА 3: Завершение и награда */}
        {phase === 'completed' && (
          <motion.div
            key="completed"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="card p-5 md:p-10 text-center bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-100 shadow-lg relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />

            <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 text-white shadow-xl relative overflow-hidden">
              <div className="absolute inset-0 bg-white/10 rounded-full scale-90 border border-dashed border-white/50 animate-spin-slow" />
              <Trophy className="w-10 h-10 animate-pulse" />
            </div>

            <h2 className="text-2xl font-black text-emerald-800 mb-2 flex items-center justify-center gap-2">
              Тема полностью освоена!
              <Sparkles className="w-6 h-6 text-amber-500 animate-bounce" />
            </h2>
            <p className="text-slate-600 text-sm max-w-md mx-auto mb-8">
              Вы успешно прошли все 3 микро-миссии по лекции «{selectedMaterial?.title}»! Вы поняли суть темы без лишней академической шелухи.
            </p>

            {/* Бейдж награды XP */}
            <div className="inline-flex items-center gap-2 bg-emerald-600 text-white font-extrabold px-6 py-3 rounded-2xl shadow-md mb-8 ring-4 ring-emerald-600/10">
              <Sparkles className="w-5 h-5 text-amber-300" />
              <span>НАГРАДА: +50 XP</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
              <button
                onClick={() => setPhase('select')}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-100"
              >
                Выбрать другую лекцию
              </button>
              <button
                onClick={() => navigate('/dashboard')}
                className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition"
              >
                Вернуться на дашборд
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
