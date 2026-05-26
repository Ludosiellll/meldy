import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { 
  GraduationCap, Zap, Brain, Calendar, BookOpen,
  MessageSquare, BarChart2, Sparkles, ArrowRight,
  CheckCircle, Upload, Cpu, Trophy, Network, Briefcase, Award, Heart, Menu, X,
  MousePointer2, Terminal, FileText, Check, Loader2, Play, FileCheck, Headphones,
  Search, LayoutDashboard, Volume2, Pause, Square, RotateCcw, Folder, HardDrive, 
  Monitor, Download, ArrowLeft, ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  useEffect(() => { if (user) navigate('/dashboard'); }, [user]);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900 overflow-x-hidden relative">
      {/* Grid Pattern Background */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.4]"
        style={{
          backgroundImage: `radial-gradient(#cbd5e1 1.5px, transparent 1.5px)`,
          backgroundSize: '24px 24px',
          maskImage: 'linear-gradient(to bottom, white 50%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, white 50%, transparent)'
        }}
      />

      <Navbar />
      <Hero />
      <Stats />
      <ProductSimulation />
      <Features />
      <EducatorsSection />
      <CtaSection />
      <Footer />
    </div>
  );
}

function Navbar() {
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 bg-white/70 backdrop-blur-xl border-b border-slate-200/50">
        {/* Logo */}
        <div className="flex items-center gap-2.5 cursor-pointer z-50" onClick={() => navigate('/')}>
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <span className="font-extrabold text-slate-900 text-xl tracking-tight">StudyForge</span>
        </div>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
          <a href="#features" className="hover:text-indigo-600 transition">Возможности</a>
          <a href="#how-it-works" className="hover:text-indigo-600 transition">Как это работает</a>
          <a href="#educators" className="hover:text-indigo-600 transition">Преподавателям</a>
        </div>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-2 sm:gap-3">
          <button onClick={() => navigate('/login')}
            className="text-sm font-bold text-slate-600 hover:text-slate-900 transition px-3 py-2">
            Войти
          </button>
          <button onClick={() => navigate('/register')}
            className="text-sm font-bold px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition shadow-lg shadow-indigo-100 hover:shadow-indigo-200 hover:-translate-y-0.5 active:translate-y-0 duration-200">
            Начать бесплатно
          </button>
        </div>

        {/* Mobile Menu Toggle */}
        <button 
          onClick={() => setIsMenuOpen(!isMenuOpen)} 
          className="md:hidden z-50 p-2 text-slate-600 hover:text-slate-900 focus:outline-none"
        >
          {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 z-40 bg-white/95 backdrop-blur-xl flex flex-col items-center justify-center gap-8 md:hidden px-6 pt-16"
          >
            <a href="#features" onClick={() => setIsMenuOpen(false)} className="text-xl font-bold text-slate-800">Возможности</a>
            <a href="#how-it-works" onClick={() => setIsMenuOpen(false)} className="text-xl font-bold text-slate-800">Как это работает</a>
            <a href="#educators" onClick={() => setIsMenuOpen(false)} className="text-xl font-bold text-slate-800">Преподавателям</a>
            <div className="flex flex-col w-full max-w-xs gap-4 mt-4">
              <button onClick={() => { setIsMenuOpen(false); navigate('/login'); }}
                className="w-full py-4 text-center font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition">
                Войти
              </button>
              <button onClick={() => { setIsMenuOpen(false); navigate('/register'); }}
                className="w-full py-4 text-center font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-lg shadow-indigo-100">
                Начать бесплатно
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Hero() {
  const navigate = useNavigate();
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const box = card.getBoundingClientRect();
    const x = e.clientX - box.left - box.width / 2;
    const y = e.clientY - box.top - box.height / 2;
    // Максимальный угол наклона - 12 градусов
    setRotateX(-y / (box.height / 24));
    setRotateY(x / (box.width / 24));
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setRotateX(0);
    setRotateY(0);
  };

  return (
    <section className="pt-32 pb-24 px-6 relative max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
      
      {/* Левая текстовая колонка */}
      <motion.div 
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.2 } }
        }}
        className="lg:col-span-6 text-left space-y-6"
      >
        {/* Академический бейдж */}
        <motion.div 
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
          }}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-full text-indigo-700 text-xs font-semibold tracking-wide"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Доказательная педагогика и ИИ</span>
        </motion.div>

        <motion.h1 
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
          }}
          className="text-4xl md:text-6xl font-black tracking-tight leading-[1.1] text-slate-900"
        >
          Осваивайте лекции <br className="hidden md:block" />
          <span className="text-indigo-600">в 4 раза быстрее</span>
        </motion.h1>

        <motion.p 
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
          }}
          className="text-lg text-slate-600 leading-relaxed max-w-xl"
        >
          Автоматизируйте рутину конспектирования. StudyForge анализирует материалы, создаёт интерактивные конспекты, карточки для интервального повторения по методу Лейтнера и проводит устные экзамены.
        </motion.p>

        {/* Кнопки действий */}
        <motion.div 
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
          }}
          className="flex items-center gap-4 flex-wrap pt-2"
        >
          <button onClick={() => navigate('/register')}
            className="group relative flex items-center gap-2 px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base rounded-xl transition-all shadow-xl shadow-indigo-200 hover:shadow-indigo-300 hover:-translate-y-1 active:translate-y-0 duration-300 overflow-hidden">
            <span className="absolute inset-0 w-full h-full -mt-1 rounded-lg opacity-30 bg-gradient-to-b from-transparent via-transparent to-black" />
            <span className="relative">Начать бесплатно</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform relative" />
          </button>
          <button onClick={() => navigate('/analyze')}
            className="flex items-center gap-2 px-8 py-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-base rounded-xl transition-all shadow-sm hover:shadow-md hover:-translate-y-1 active:translate-y-0 duration-300">
            <Zap className="w-4 h-4 text-indigo-600" />
            Быстрое демо
          </button>
        </motion.div>

        {/* Дополнительные преимущества */}
        <motion.div 
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
          }}
          className="flex items-center gap-6 pt-4 text-xs font-semibold text-slate-500"
        >
          <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-emerald-500" /> Без привязки карт</span>
          <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-emerald-500" /> Сделано для вузов</span>
        </motion.div>
      </motion.div>

      {/* Правая колонка с интерактивной 3D сценой */}
      <div className="lg:col-span-6 flex items-center justify-center relative mt-12 lg:mt-0">
        {/* Размытый фон сцены с пульсацией */}
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute w-[450px] h-[450px] bg-gradient-to-tr from-indigo-300/40 to-violet-300/40 rounded-full blur-[100px] pointer-events-none" 
        />

        {/* 3D Перспектива */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.8, y: 50 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, type: "spring", bounce: 0.4, delay: 0.2 }}
          className="relative w-full max-w-lg aspect-[4/3] cursor-pointer origin-center z-10"
          style={{ perspective: 1200 }}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={handleMouseLeave}
        >
          <motion.div
            className="w-full h-full relative"
            animate={{
              rotateX: isHovered ? rotateX : 0,
              rotateY: isHovered ? rotateY : 0,
              scale: isHovered ? 1.05 : 1
            }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
            style={{ transformStyle: "preserve-3d" }}
          >
            {/* Нижний уровень: Тень с пульсацией */}
            <motion.div 
              animate={{ opacity: isHovered ? 0.8 : 0.4, scale: isHovered ? 1.05 : 1 }}
              className="absolute inset-4 bg-indigo-600/15 rounded-3xl blur-2xl transition-all duration-300"
              style={{ transform: "translateZ(-60px)" }}
            />
            
            {/* Базовый слой: Панель Дашборда */}
            <div 
              className="absolute inset-0 bg-white/90 backdrop-blur-xl border border-white/60 rounded-3xl shadow-[0_20px_50px_rgba(79,70,229,0.1)] p-6 flex flex-col gap-4 select-none"
              style={{ transform: "translateZ(0px)" }}
            >
              {/* Хедер дашборда */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-400 shadow-sm" />
                  <div className="w-3 h-3 rounded-full bg-amber-400 shadow-sm" />
                  <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-sm" />
                </div>
                <div className="h-4 w-32 bg-slate-100 rounded-full" />
                <div className="w-6 h-6 rounded-full bg-slate-100" />
              </div>

              {/* Тело дашборда */}
              <div className="grid grid-cols-12 gap-4 flex-1 mt-2">
                {/* Левое меню */}
                <div className="col-span-3 space-y-3 pr-2">
                  <div className="h-6 bg-indigo-50 rounded-lg w-full" />
                  <div className="h-5 bg-slate-50 rounded-lg w-5/6" />
                  <div className="h-5 bg-slate-50 rounded-lg w-4/5" />
                  <div className="h-5 bg-slate-50 rounded-lg w-3/4" />
                </div>
                
                {/* Рабочая зона */}
                <div className="col-span-9 space-y-4">
                  <div className="h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center px-4 justify-between">
                    <span className="text-xs font-bold text-slate-400">Мой прогресс</span>
                    <span className="text-xs text-indigo-600 font-extrabold bg-indigo-50 px-2 py-1 rounded-md">+120 XP</span>
                  </div>
                  {/* Анимированный график */}
                  <div className="h-28 bg-white border border-slate-100 rounded-xl p-3 flex items-end justify-between gap-1.5 shadow-inner">
                    {[30, 45, 20, 60, 80, 50, 95, 40, 70, 85].map((h, i) => (
                      <motion.div 
                        key={i} 
                        initial={{ height: 0 }}
                        animate={{ height: `${h}%` }}
                        transition={{ duration: 1, delay: 0.5 + i * 0.05, type: "spring" }}
                        className="bg-gradient-to-t from-indigo-200 to-indigo-100 hover:from-indigo-400 hover:to-indigo-300 transition-colors w-full rounded-t-sm" 
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Парящий слой 1: 📝 Конспект (Слева сверху) */}
            <motion.div 
              initial={{ opacity: 0, y: -20, x: -20 }}
              animate={{ opacity: 1, y: [0, -10, 0], x: 0 }}
              transition={{ 
                opacity: { delay: 1, duration: 0.5 },
                y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 },
                x: { delay: 1, duration: 0.5, type: "spring" }
              }}
              className="hidden md:flex absolute top-[-10%] left-[-10%] w-[55%] bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl p-4 flex-col gap-2"
              style={{ transform: "translateZ(80px)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">📝 Конспект</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              </div>
              <p className="text-[11px] font-bold text-slate-800 line-clamp-1">Тема: Дифференциальные уравнения</p>
              <div className="space-y-1.5 mt-1">
                <div className="h-1.5 bg-slate-200/80 rounded-full w-full" />
                <div className="h-1.5 bg-slate-200/80 rounded-full w-5/6" />
                <div className="h-1.5 bg-slate-200/80 rounded-full w-2/3" />
              </div>
            </motion.div>

            {/* Парящий слой 2: 🃏 Карточки (Справа снизу) */}
            <motion.div 
              initial={{ opacity: 0, y: 20, x: 20 }}
              animate={{ opacity: 1, y: [0, 10, 0], x: 0 }}
              transition={{ 
                opacity: { delay: 1.2, duration: 0.5 },
                y: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1.5 },
                x: { delay: 1.2, duration: 0.5, type: "spring" }
              }}
              className="hidden md:flex absolute bottom-[12%] right-[-12%] w-[50%] bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-2xl p-4 flex-col gap-3"
              style={{ transform: "translateZ(120px)" }}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                <Brain className="w-4 h-4" />
                <span>Интервальное повторение</span>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center shadow-inner">
                <p className="text-[10px] font-medium text-slate-500 mb-1">Термин</p>
                <p className="text-xs font-bold text-slate-800">Интеграл Фурье</p>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-[9px] font-bold px-2 py-1 bg-rose-50 text-rose-600 border border-rose-100 rounded-md shadow-sm">Помню плохо</span>
                <span className="text-[9px] font-bold px-2 py-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-md shadow-sm">Отлично помню</span>
              </div>
            </motion.div>

            {/* Парящий слой 3: ❓ Устный экзамен (Слева снизу) */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1, y: [0, -8, 0] }}
              transition={{ 
                opacity: { delay: 1.4, duration: 0.5 },
                scale: { delay: 1.4, duration: 0.5, type: "spring" },
                y: { duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 2 }
              }}
              className="hidden md:flex absolute bottom-[-15%] left-[-5%] w-[60%] bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl shadow-[0_20px_40px_rgba(79,70,229,0.4)] p-4 flex-col gap-2 border border-indigo-400/30"
              style={{ transform: "translateZ(150px)" }}
            >
              <div className="flex items-center justify-between text-[10px] font-bold text-indigo-100">
                <span className="flex items-center gap-1"><Award className="w-3.5 h-3.5 text-amber-300" /> Собеседование у ИИ</span>
                <span className="bg-white/20 px-2 py-0.5 rounded shadow-sm">95/100</span>
              </div>
              <p className="text-xs font-bold leading-relaxed">«Ответ верный. Объясните физический смысл градиента функции...»</p>
              <div className="h-1.5 bg-black/20 rounded-full w-full mt-1 overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: "95%" }}
                  transition={{ duration: 1.5, delay: 1.8, ease: "easeOut" }}
                  className="h-full bg-white rounded-full shadow-[0_0_5px_rgba(255,255,255,0.8)]" 
                />
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function Stats() {
  const items = [
    { value: '15 секунд', label: 'глубокий анализ лекции' },
    { value: '6 агентов', label: 'работают параллельно' },
    { value: 'Квесты & XP', label: 'встроенная геймификация' },
    { value: 'Co-Study', label: 'защита от выгорания' },
  ];
  return (
    <section className="py-16 px-6 border-y border-slate-200/60 bg-white/50 backdrop-blur">
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        {items.map((s, i) => (
          <div key={i} className="text-center space-y-1">
            <p className="text-3xl font-extrabold text-indigo-600 tracking-tight">{s.value}</p>
            <p className="text-slate-500 text-sm font-semibold">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductSimulation() {
  const [step, setStep] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [cardCompleted, setCardCompleted] = useState(false);
  const [podcastPlaying, setPodcastPlaying] = useState(false);
  const [agentProgress, setAgentProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 900, y: 550, scale: 1, opacity: 1, clicked: false });

  // Автоматический цикл симуляции
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let progressInterval: ReturnType<typeof setInterval>;

    switch (step) {
      case 0: {
        setCardFlipped(false);
        setCardCompleted(false);
        setPodcastPlaying(false);
        setAgentProgress(0);
        setUploadProgress(0);
        setCursorPos({ x: 900, y: 550, scale: 1, opacity: 1, clicked: false });

        // Начинаем полет к зоне загрузки
        timer = setTimeout(() => {
          setStep(1);
        }, 1500);
        break;
      }
      case 1: {
        // Летим к зоне загрузки
        setCursorPos({ x: 620, y: 360, scale: 1, opacity: 1, clicked: false });
        timer = setTimeout(() => {
          // Кликаем по зоне загрузки
          setCursorPos(prev => ({ ...prev, scale: 0.8, clicked: true }));
          timer = setTimeout(() => {
            setCursorPos(prev => ({ ...prev, scale: 1, clicked: false }));
            setStep(2); // Открывается проводник
          }, 200);
        }, 1200);
        break;
      }
      case 2: {
        // Проводник открыт. Летим к файлу docx
        setCursorPos({ x: 520, y: 240, scale: 1, opacity: 1, clicked: false });
        timer = setTimeout(() => {
          // Выбираем файл
          setCursorPos(prev => ({ ...prev, scale: 0.8, clicked: true }));
          timer = setTimeout(() => {
            setCursorPos(prev => ({ ...prev, scale: 1, clicked: false }));
            setStep(3); // Летим к кнопке Открыть
          }, 200);
        }, 1200);
        break;
      }
      case 3: {
        // Летим к кнопке "Открыть"
        setCursorPos({ x: 740, y: 480, scale: 1, opacity: 1, clicked: false });
        timer = setTimeout(() => {
          // Кликаем по кнопке
          setCursorPos(prev => ({ ...prev, scale: 0.8, clicked: true }));
          timer = setTimeout(() => {
            setCursorPos(prev => ({ ...prev, scale: 1, clicked: false }));
            setStep(4); // Закрываем проводник, запускаем загрузку
          }, 200);
        }, 1000);
        break;
      }
      case 4: {
        // Загрузка файла. Скрываем курсор.
        setCursorPos(prev => ({ ...prev, opacity: 0 }));
        
        const totalDuration = 1500;
        const stepsCount = 15;
        let currentStep = 0;
        progressInterval = setInterval(() => {
          currentStep++;
          setUploadProgress(Math.min(100, Math.floor((currentStep / stepsCount) * 100)));
          if (currentStep >= stepsCount) {
            clearInterval(progressInterval);
            setStep(5); // Переходим к агентам
          }
        }, totalDuration / stepsCount);
        break;
      }
      case 5: {
        // Сканирование агентами
        let currentAgent = 0;
        progressInterval = setInterval(() => {
          currentAgent++;
          setAgentProgress(currentAgent);
          if (currentAgent >= 6) {
            clearInterval(progressInterval);
            timer = setTimeout(() => {
              setStep(6); // Появление дашборда
            }, 600);
          }
        }, 500);
        break;
      }
      case 6: {
        // Дашборд открылся. Курсор летит к карточке
        setCursorPos({ x: 260, y: 500, scale: 1, opacity: 1, clicked: false });
        timer = setTimeout(() => {
          setCursorPos({ x: 815, y: 195, scale: 1, opacity: 1, clicked: false });
          timer = setTimeout(() => {
            setStep(7); // Клик по карточке (переворот)
          }, 1000);
        }, 500);
        break;
      }
      case 7: {
        // Клик по карточке
        setCursorPos(prev => ({ ...prev, scale: 0.8, clicked: true }));
        timer = setTimeout(() => {
          setCursorPos(prev => ({ ...prev, scale: 1, clicked: false }));
          setCardFlipped(true);
          timer = setTimeout(() => {
            setStep(8); // Летим к Помню
          }, 600);
        }, 200);
        break;
      }
      case 8: {
        // Летим к Помню
        setCursorPos({ x: 880, y: 295, scale: 1, opacity: 1, clicked: false });
        timer = setTimeout(() => {
          setStep(9); // Клик по Помню
        }, 1000);
        break;
      }
      case 9: {
        // Клик по Помню
        setCursorPos(prev => ({ ...prev, scale: 0.8, clicked: true }));
        timer = setTimeout(() => {
          setCursorPos(prev => ({ ...prev, scale: 1, clicked: false }));
          setCardCompleted(true);
          timer = setTimeout(() => {
            setStep(10); // Летим к подкасту
          }, 1200);
        }, 200);
        break;
      }
      case 10: {
        // Летим к виджету подкаста
        setCursorPos({ x: 815, y: 465, scale: 1, opacity: 1, clicked: false });
        timer = setTimeout(() => {
          setStep(11); // Клик по подкасту
        }, 1000);
        break;
      }
      case 11: {
        // Клик по виджету подкаста
        setCursorPos(prev => ({ ...prev, scale: 0.8, clicked: true }));
        timer = setTimeout(() => {
          setCursorPos(prev => ({ ...prev, scale: 1, clicked: false }));
          setStep(12); // Открывается плеер подкаста
        }, 200);
        break;
      }
      case 12: {
        // Плеер открыт. Летим к кнопке Play
        setCursorPos({ x: 260, y: 500, scale: 1, opacity: 1, clicked: false });
        timer = setTimeout(() => {
          setCursorPos({ x: 880, y: 125, scale: 1, opacity: 1, clicked: false });
          timer = setTimeout(() => {
            setStep(13); // Клик по Play
          }, 1000);
        }, 400);
        break;
      }
      case 13: {
        // Клик по Play
        setCursorPos(prev => ({ ...prev, scale: 0.8, clicked: true }));
        timer = setTimeout(() => {
          setCursorPos(prev => ({ ...prev, scale: 1, clicked: false }));
          setPodcastPlaying(true);
          timer = setTimeout(() => {
            setStep(14); // Макс говорит
          }, 300);
        }, 200);
        break;
      }
      case 14: {
        // Говорит Макс. Скрываем курсор
        setCursorPos(prev => ({ ...prev, opacity: 0 }));
        timer = setTimeout(() => {
          setStep(15); // Говорит Софья
        }, 4000);
        break;
      }
      case 15: {
        // Говорит Софья
        timer = setTimeout(() => {
          setStep(16); // Макс говорит снова
        }, 4500);
        break;
      }
      case 16: {
        // Макс заканчивает
        timer = setTimeout(() => {
          setStep(17); // Экран завершения, летим к перезапуску
        }, 4000);
        break;
      }
      case 17: {
        setPodcastPlaying(false);
        setCursorPos({ x: 620, y: 380, scale: 1, opacity: 1, clicked: false });
        timer = setTimeout(() => {
          setStep(18); // Клик по Начать заново
        }, 1200);
        break;
      }
      case 18: {
        // Клик по кнопке перезапуска
        setCursorPos(prev => ({ ...prev, scale: 0.8, clicked: true }));
        timer = setTimeout(() => {
          setCursorPos(prev => ({ ...prev, scale: 1, clicked: false }));
          setStep(0); // Сброс в начало
        }, 200);
        break;
      }
      default:
        break;
    }

    return () => {
      clearTimeout(timer);
      clearInterval(progressInterval);
    };
  }, [step]);

  const agentsList = [
    { name: "Агент Парсер", desc: "Извлечение docx-структуры и текста", icon: FileText },
    { name: "Агент Саммаризатор", desc: "Глубокое выделение ключевых понятий", icon: BookOpen },
    { name: "Агент Карточки", desc: "Создание QA-пар для интервального повторения", icon: Brain },
    { name: "Агент Подкаст", desc: "Написание сценария диалога Макса и Софьи", icon: Headphones },
    { name: "Агент Квесты", desc: "Конфигурирование опыта XP и задач", icon: Trophy },
    { name: "Агент Граф", desc: "Связывание терминов в общую базу знаний", icon: Network },
  ];

  const podcastSpeech = [
    {
      speaker: 'Макс',
      text: 'Привет! С вами ИИ-Подкаст StudyForge. Сегодня разберем тему нейросетей простыми словами. Софья, как бы ты объяснила это первокурснику?',
      isMax: true,
      stepActive: 14
    },
    {
      speaker: 'Софья',
      text: 'Привет, Макс! Представь детскую игру с сортировкой фигур. Круг проходит в круглую дырочку, квадрат — в квадратную. Нейросеть — это миллионы таких фильтров, которые обучаются распознавать нужные паттерны.',
      isMax: false,
      stepActive: 15
    },
    {
      speaker: 'Макс',
      text: 'Отличная аналогия! То есть на входе у нас сырые данные, а на выходе — готовый ответ. И всё благодаря автоматической настройке весов связей между нейронами в процессе обучения.',
      isMax: true,
      stepActive: 16
    }
  ];

  // Вычисление таймера подкаста
  const getPodcastTime = () => {
    if (step === 13 || step === 14) return '00:15';
    if (step === 15) return '00:36';
    if (step === 16) return '01:02';
    return '01:25';
  };

  const getPodcastProgressWidth = () => {
    if (step === 13 || step === 14) return '15%';
    if (step === 15) return '45%';
    if (step === 16) return '78%';
    return '100%';
  };

  return (
    <section id="simulation" className="py-24 px-6 relative bg-slate-50 border-y border-slate-200 overflow-hidden select-none">
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-16 space-y-3">
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
            Один клик — и всё готово
          </h2>
          <p className="text-slate-500 text-lg max-w-xl mx-auto">
            Посмотрите, как за пару секунд StudyForge раскладывает лекцию на атомы: от загрузки до 3D-карточек и аудиоподкаста.
          </p>
        </div>

        {/* Адаптивный контейнер симулятора */}
        <div className="relative w-full h-[230px] min-[400px]:h-[280px] min-[500px]:h-[350px] sm:h-[450px] lg:h-[620px] overflow-hidden flex items-center justify-center">
          <div className="absolute w-[1000px] h-[600px] scale-[0.32] min-[400px]:scale-[0.38] min-[500px]:scale-[0.48] sm:scale-[0.68] lg:scale-100 origin-center shrink-0 border border-slate-200 shadow-2xl rounded-2xl bg-white overflow-hidden flex flex-col">
            
            {/* Имитация заголовка браузера */}
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center justify-between z-20 shrink-0">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-rose-400" />
                <div className="w-3 h-3 rounded-full bg-amber-400" />
                <div className="w-3 h-3 rounded-full bg-emerald-400" />
              </div>
              <div className="flex bg-white border border-slate-200 rounded-md px-3 py-1 flex-1 max-w-md mx-4 items-center justify-center gap-2">
                <Search className="w-3 h-3 text-slate-400" />
                <span className="text-xs font-semibold text-slate-400">app.studyforge.ru/dashboard</span>
              </div>
              <div className="flex items-center gap-3 pr-2">
                <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-extrabold text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm">
                  <Sparkles className="w-3 h-3 text-amber-500 fill-amber-300" />
                  <span>450 XP</span>
                </div>
                <div className="w-6.5 h-6.5 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center font-bold text-[10px] text-slate-600">
                  АИ
                </div>
              </div>
            </div>

            {/* Тело приложения */}
            <div className="flex flex-1 overflow-hidden relative">
              
              {/* Боковое меню */}
              <div className="w-60 border-r border-slate-100 bg-slate-50/50 p-4 flex flex-col gap-4 shrink-0">
                <div className="h-8 bg-indigo-50 border border-indigo-100 rounded-lg w-full flex items-center px-3 gap-2">
                  <LayoutDashboard className="w-4 h-4 text-indigo-600 animate-pulse" />
                  <span className="text-[11px] font-extrabold text-indigo-700">Дашборд</span>
                </div>
                <div className="space-y-2 mt-2">
                  <div className="flex items-center gap-2 px-3 py-2 text-slate-500 rounded-lg hover:bg-slate-100">
                    <FileText className="w-4 h-4 text-slate-400" />
                    <span className="text-[11px] font-bold">Мои конспекты</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 text-slate-500 rounded-lg hover:bg-slate-100">
                    <Brain className="w-4 h-4 text-slate-400" />
                    <span className="text-[11px] font-bold">Карточки</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 text-slate-500 rounded-lg hover:bg-slate-100">
                    <Headphones className="w-4 h-4 text-slate-400" />
                    <span className="text-[11px] font-bold">Подкасты</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 text-slate-500 rounded-lg hover:bg-slate-100">
                    <Trophy className="w-4 h-4 text-slate-400" />
                    <span className="text-[11px] font-bold">Учебные квесты</span>
                  </div>
                </div>
                
                {/* Нижняя часть меню (прогресс) */}
                <div className="mt-auto bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                  <div className="flex justify-between text-[9px] font-bold text-slate-400 mb-1">
                    <span>Уровень 3</span>
                    <span>120 / 500 XP</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 border border-slate-200/50 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full w-[24%]" />
                  </div>
                </div>
              </div>

              {/* Главный рабочий стол */}
              <div className="flex-1 relative bg-white overflow-hidden">
                
                <AnimatePresence mode="wait">
                  {/* ШАГ 0, 1: Экран загрузки файла */}
                  {(step === 0 || step === 1) && (
                    <motion.div 
                      key="upload-prompt"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-6"
                    >
                      <div className="w-24 h-24 bg-indigo-50/50 border-2 border-dashed border-indigo-200 rounded-3xl flex items-center justify-center shadow-inner group">
                        <Upload className="w-10 h-10 text-indigo-400 group-hover:scale-110 transition duration-300" />
                      </div>
                      <div className="text-center space-y-1">
                        <h3 className="text-lg font-extrabold text-slate-800">Загрузите материалы для разбора</h3>
                        <p className="text-xs text-slate-400 max-w-xs mx-auto">
                          Перетащите Word, PDF или лекционный текст сюда
                        </p>
                      </div>
                      <button 
                        className="px-8 py-3 bg-indigo-600 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition"
                      >
                        Загрузить файл
                      </button>
                    </motion.div>
                  )}

                  {/* ШАГ 4: Шкала прогресса загрузки */}
                  {step === 4 && (
                    <motion.div
                      key="uploading-state"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-6"
                    >
                      <div className="w-20 h-24 bg-white border border-slate-200 rounded-xl shadow-lg flex items-center justify-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-5 h-5 bg-indigo-600 rounded-bl-lg rounded-tr flex items-center justify-center text-[9px] font-bold text-white">W</div>
                        <FileText className="w-10 h-10 text-indigo-600" />
                        <motion.div
                          animate={{ top: ["100%", "0%", "100%"] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                          className="absolute left-0 right-0 h-1 bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,1)]"
                        />
                      </div>
                      <div className="w-full max-w-xs text-center space-y-2">
                        <p className="text-xs font-bold text-slate-800">Загрузка: Лекция_1_Нейросети.docx</p>
                        <div className="h-2 w-full bg-slate-100 border border-slate-200 rounded-full overflow-hidden relative">
                          <div 
                            className="h-full bg-indigo-600 rounded-full transition-all duration-100" 
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-400 font-bold">{uploadProgress}% завершено</span>
                      </div>
                    </motion.div>
                  )}

                  {/* ШАГ 5: Мультиагентный ИИ-анализ (Агенты) */}
                  {step === 5 && (
                    <motion.div
                      key="scanning-state"
                      initial={{ opacity: 0, filter: 'blur(4px)' }}
                      animate={{ opacity: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-slate-50/50"
                    >
                      <div className="text-center mb-6 space-y-1">
                        <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5 justify-center">
                          <Cpu className="w-4 h-4 text-indigo-600 animate-spin" />
                          Мультиагентный ИИ-анализ лекции
                        </h4>
                        <p className="text-[10px] text-slate-400 font-medium">6 специализированных агентов обрабатывают данные...</p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 w-full max-w-xl">
                        {agentsList.map((agent, idx) => {
                          const isDone = agentProgress > idx;
                          const isActive = agentProgress === idx;
                          
                          return (
                            <motion.div
                              key={idx}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.05 }}
                              className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-300 ${
                                isDone 
                                  ? 'bg-white border-emerald-200/80 shadow-sm' 
                                  : isActive
                                  ? 'bg-white border-indigo-300 ring-2 ring-indigo-500/10 shadow-sm'
                                  : 'bg-slate-50/50 border-slate-200/60 opacity-60'
                              }`}
                            >
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                                isDone 
                                  ? 'bg-emerald-50 text-emerald-500' 
                                  : isActive 
                                  ? 'bg-indigo-50 text-indigo-600' 
                                  : 'bg-slate-100 text-slate-400'
                              }`}>
                                {isDone ? (
                                  <Check className="w-4 h-4" />
                                ) : isActive ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                                ) : (
                                  <agent.icon className="w-4.5 h-4.5" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className={`text-[10.5px] font-extrabold truncate ${isDone ? 'text-emerald-700' : isActive ? 'text-indigo-900' : 'text-slate-500'}`}>
                                  {agent.name}
                                </p>
                                <p className="text-[8.5px] text-slate-400 truncate leading-normal">{agent.desc}</p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}

                  {/* ШАГИ 6-11: Главный дашборд результатов */}
                  {(step >= 6 && step <= 11) && (
                    <motion.div 
                      key="dashboard-state"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, x: -60, filter: 'blur(5px)' }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 p-6 flex gap-6 bg-slate-50/50"
                    >
                      {/* Левая панель: Умный конспект */}
                      <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex-1 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm overflow-hidden flex flex-col"
                      >
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <FileCheck className="w-4.5 h-4.5 text-emerald-500" />
                            <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">Умный Конспект</h4>
                          </div>
                          <span className="text-[9px] font-bold text-slate-400">PDF Разбор</span>
                        </div>
                        
                        <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                          <div>
                            <h5 className="font-extrabold text-slate-800 text-[13px] mb-1.5">Тема: Нейронные сети и веса связей</h5>
                            <div className="h-0.5 bg-indigo-500/20 rounded w-full mb-3" />
                          </div>
                          
                          <div className="space-y-3.5">
                            {/* Построчная анимация конспекта */}
                            <motion.div 
                              initial={{ opacity: 0, y: 5 }} 
                              animate={{ opacity: 1, y: 0 }} 
                              transition={{ delay: 0.3 }}
                              className="text-[11px] leading-relaxed text-slate-600 flex gap-2"
                            >
                              <span className="text-indigo-500 font-bold shrink-0">•</span>
                              <p>
                                <strong>Искусственная нейронная сеть</strong> — это математическая модель, имитирующая биологические синаптические связи для распознавания образов.
                              </p>
                            </motion.div>
                            
                            <motion.div 
                              initial={{ opacity: 0, y: 5 }} 
                              animate={{ opacity: 1, y: 0 }} 
                              transition={{ delay: 0.8 }}
                              className="text-[11px] leading-relaxed text-slate-600 flex gap-2"
                            >
                              <span className="text-indigo-500 font-bold shrink-0">•</span>
                              <div>
                                <p className="font-bold mb-1">Основные структурные элементы:</p>
                                <div className="pl-3 space-y-1 text-slate-500">
                                  <p>— Входные нейроны (получение сырых данных)</p>
                                  <p>— Скрытые слои (автоматическое выделение признаков)</p>
                                  <p>— Выходные нейроны (выдача финальной классификации)</p>
                                </div>
                              </div>
                            </motion.div>

                            <motion.div 
                              initial={{ opacity: 0, y: 5 }} 
                              animate={{ opacity: 1, y: 0 }} 
                              transition={{ delay: 1.4 }}
                              className="text-[11px] leading-relaxed text-slate-600 flex gap-2"
                            >
                              <span className="text-indigo-500 font-bold shrink-0">•</span>
                              <p>
                                <strong>Обучение</strong> происходит через алгоритм обратного распространения ошибки (Backpropagation) путем многократной корректировки весов.
                              </p>
                            </motion.div>
                          </div>
                        </div>
                      </motion.div>

                      {/* Правая панель: Интерактивная карточка + виджет подкаста */}
                      <div className="w-[330px] flex flex-col gap-6 shrink-0">
                        
                        {/* Карточка */}
                        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm relative overflow-hidden flex flex-col">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Карточка 1/14</span>
                            <Brain className="w-3.5 h-3.5 text-indigo-500" />
                          </div>
                          
                          {/* 3D Переворачивающаяся карточка */}
                          <div className="relative w-full h-[140px] mt-1" style={{ perspective: 1000 }}>
                            <motion.div
                              className="w-full h-full relative"
                              style={{ transformStyle: 'preserve-3d' }}
                              animate={{ rotateY: cardFlipped ? 180 : 0 }}
                              transition={{ duration: 0.6, type: "spring", stiffness: 80 }}
                            >
                              {/* Лицо */}
                              <div 
                                className="absolute inset-0 bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex flex-col items-center justify-center shadow-inner"
                                style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                              >
                                <p className="text-[9px] font-semibold text-slate-400 mb-0.5">Термин</p>
                                <p className="text-sm font-extrabold text-slate-800 text-center">Нейронная сеть</p>
                              </div>

                              {/* Оборот */}
                              <div 
                                className="absolute inset-0 bg-indigo-50/30 border border-indigo-100 rounded-xl p-3 flex flex-col items-center justify-between shadow-inner"
                                style={{ 
                                  backfaceVisibility: 'hidden', 
                                  WebkitBackfaceVisibility: 'hidden',
                                  transform: 'rotateY(180deg)' 
                                }}
                              >
                                <div className="text-center">
                                  <p className="text-[9px] font-semibold text-indigo-500 mb-0.5">Определение</p>
                                  <p className="text-[10.5px] font-medium text-slate-700 leading-tight">
                                    Математическая модель, имитирующая биологические синаптические связи.
                                  </p>
                                </div>
                                
                                {/* Кнопки на обороте карточки */}
                                <div className="flex gap-2 w-full mt-1.5">
                                  <button className="h-6.5 flex-1 bg-white border border-rose-200 rounded-md text-[9px] font-bold text-rose-500 pointer-events-none">
                                    Забыл
                                  </button>
                                  <motion.button 
                                    animate={step === 9 ? { scale: [1, 0.9, 1] } : {}}
                                    className={`h-6.5 flex-1 border rounded-md text-[9px] font-bold transition-all duration-300 pointer-events-none flex items-center justify-center gap-1 ${
                                      cardCompleted 
                                        ? 'bg-emerald-500 border-emerald-600 text-white' 
                                        : 'bg-white border-emerald-200 text-emerald-600'
                                    }`}
                                  >
                                    {cardCompleted ? <Check className="w-3 h-3 text-white" /> : null}
                                    Помню
                                  </motion.button>
                                </div>
                              </div>
                            </motion.div>
                          </div>

                          {/* Float XP Bonus */}
                          <AnimatePresence>
                            {cardCompleted && (
                              <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.5 }}
                                animate={{ opacity: 1, y: -45, scale: 1.2 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-emerald-500 text-white font-extrabold text-[10px] px-3 py-1 rounded-full shadow-lg z-20 pointer-events-none flex items-center gap-1"
                              >
                                <Sparkles className="w-3 h-3" />
                                +10 XP
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* Виджет подкаста */}
                        <div 
                          className={`rounded-2xl p-4 text-white shadow-lg transition-all duration-500 relative overflow-hidden flex flex-col ${
                            step >= 10 
                              ? 'bg-indigo-700 scale-[0.98] ring-4 ring-indigo-500/25 border-indigo-400' 
                              : 'bg-gradient-to-br from-indigo-600 to-indigo-800 border border-indigo-500/20'
                          }`}
                        >
                          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="font-extrabold text-xs flex items-center gap-1.5"><Headphones className="w-4 h-4 animate-pulse text-indigo-200" /> AI-Подкаст</h5>
                            <span className="text-[9px] font-mono bg-white/20 px-2 py-0.5 rounded">03:45</span>
                          </div>
                          <p className="text-[10px] text-indigo-100 font-medium line-clamp-1 mb-3">Диалог: Введение в Нейросети</p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 h-6">
                              {[...Array(10)].map((_, i) => (
                                <div key={i} className="w-1 bg-white/40 h-2 rounded-full" />
                              ))}
                            </div>
                            <span className="text-[9px] font-bold bg-white text-indigo-600 px-3 py-1 rounded-lg shadow-sm">
                              Открыть плеер
                            </span>
                          </div>
                        </div>

                      </div>
                    </motion.div>
                  )}

                  {/* ШАГИ 12-16: Полноэкранный плеер подкаста */}
                  {step >= 12 && (
                    <motion.div 
                      key="podcast-player-state"
                      initial={{ opacity: 0, x: 60, filter: 'blur(5px)' }}
                      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 p-6 bg-slate-50/50 flex flex-col gap-5 overflow-hidden"
                    >
                      {/* Шапка/Плеер подкаста */}
                      <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white rounded-2xl p-5 shadow-md border border-indigo-500/20 flex items-center justify-between gap-5 relative overflow-hidden shrink-0">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none -mt-10 -mr-10" />
                        
                        <div className="flex items-center gap-3.5 relative z-10 w-auto">
                          <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center shrink-0 border border-white/20 shadow-inner">
                            <Headphones className="w-6 h-6 text-white" />
                          </div>
                          <div className="text-left">
                            <h4 className="font-extrabold text-sm text-white flex items-center gap-1.5">
                              AI-Подкаст: Введение в нейронные сети
                              <Sparkles className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                            </h4>
                            <p className="text-[10px] text-indigo-200 mt-0.5">Слушайте простое объяснение темы</p>
                          </div>
                        </div>

                        {/* Управление */}
                        <div className="flex items-center gap-4 relative z-10">
                          {/* Спектрограмма */}
                          <div className="flex items-center gap-1.2 h-8 w-24 justify-center">
                            {[...Array(12)].map((_, i) => (
                              <motion.div 
                                key={i}
                                animate={{ 
                                  height: podcastPlaying 
                                    ? ["20%", "100%", "20%"] 
                                    : "20%" 
                                }}
                                transition={{ 
                                  duration: 0.5 + (i % 3) * 0.15, 
                                  repeat: Infinity, 
                                  delay: i * 0.05, 
                                  ease: "easeInOut" 
                                }}
                                className="w-1 bg-white/80 rounded-full"
                              />
                            ))}
                          </div>

                          <div className="h-6 w-[1px] bg-white/20" />

                          {/* Кнопка запуска */}
                          <button
                            className="px-5 py-2.5 bg-white hover:bg-indigo-50 text-indigo-600 font-extrabold rounded-lg text-[11px] transition flex items-center gap-1.5 shadow-md hover:-translate-y-0.5"
                          >
                            {podcastPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                            {podcastPlaying ? 'Пауза' : 'Слушать'}
                          </button>
                        </div>

                        {/* Полоса прогресса воспроизведения подкаста */}
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-900/30">
                          <motion.div 
                            className="h-full bg-amber-400 transition-all duration-300"
                            style={{ width: getPodcastProgressWidth() }}
                          />
                        </div>
                      </div>

                      {/* Диалоговая лента */}
                      <div className="space-y-3 flex-1 overflow-y-auto pr-1 flex flex-col mt-1">
                        {podcastSpeech.map((msg, i) => {
                          if (step < msg.stepActive) return null;
                          const isSpeaking = step === msg.stepActive;
                          
                          return (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, y: 15, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              transition={{ duration: 0.4 }}
                              className={`flex ${msg.isMax ? 'justify-start' : 'justify-end'} mb-1`}
                            >
                              <div
                                className={`relative max-w-[80%] px-4 py-3 rounded-2xl shadow-sm border transition-all duration-300 ${
                                  isSpeaking
                                    ? 'bg-indigo-50/90 border-indigo-300 ring-2 ring-indigo-500/10 scale-[1.01]'
                                    : msg.isMax
                                    ? 'bg-white border-slate-200 text-slate-800 rounded-bl-none'
                                    : 'bg-indigo-600 border-indigo-700 text-white rounded-br-none'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1.5 opacity-80 gap-6">
                                  <span className={`text-[9px] font-black uppercase tracking-wider ${msg.isMax ? 'text-slate-500' : 'text-indigo-200'}`}>
                                    {msg.speaker}
                                  </span>
                                  {isSpeaking && (
                                    <Volume2 className={`w-3.5 h-3.5 ${msg.isMax ? 'text-indigo-500' : 'text-white'} animate-pulse`} />
                                  )}
                                </div>
                                <p className={`text-[12px] leading-relaxed font-medium ${msg.isMax ? 'text-slate-700' : 'text-white'}`}>
                                  {msg.text}
                                </p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>

                      {/* Всплывающий оверлей успеха в конце воспроизведения подкаста */}
                      <AnimatePresence>
                        {step >= 17 && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-indigo-950/90 backdrop-blur-md flex flex-col items-center justify-center text-white p-6 z-20"
                          >
                            <motion.div
                              initial={{ scale: 0.5, y: 20 }}
                              animate={{ scale: 1, y: 0 }}
                              transition={{ type: "spring", stiffness: 90 }}
                              className="text-center space-y-6 max-w-sm flex flex-col items-center"
                            >
                              <div className="w-16 h-16 bg-amber-500 rounded-full flex items-center justify-center shadow-lg shadow-amber-500/20 text-white mb-2">
                                <Trophy className="w-8 h-8 fill-amber-300" />
                              </div>
                              <div className="space-y-2">
                                <h4 className="font-extrabold text-lg">Демо-урок завершен!</h4>
                                <p className="text-xs text-indigo-200">
                                  Вы успешно разобрали конспект, решили карточку с термином и прослушали AI-подкаст.
                                </p>
                              </div>
                              <div className="bg-white/10 px-5 py-2.5 rounded-xl border border-white/10 flex items-center gap-6 justify-center w-full">
                                <div className="text-center">
                                  <p className="text-[10px] font-bold text-indigo-300">ПОЛУЧЕНО</p>
                                  <p className="font-extrabold text-amber-400 text-sm flex items-center gap-1 justify-center">
                                    <Sparkles className="w-3.5 h-3.5" /> +60 XP
                                  </p>
                                </div>
                                <div className="h-6 w-[1px] bg-white/10" />
                                <div className="text-center">
                                  <p className="text-[10px] font-bold text-indigo-300">КВЕСТЫ</p>
                                  <p className="font-extrabold text-white text-xs">2 / 2 выполнено</p>
                                </div>
                              </div>
                              <button
                                className="px-6 py-2.5 bg-white text-indigo-600 font-extrabold text-xs rounded-xl shadow-md flex items-center gap-1.5 hover:bg-slate-50 transition"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Начать заново
                              </button>
                            </motion.div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Windows File Explorer Modal */}
                <AnimatePresence>
                  {(step >= 2 && step <= 3) && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: '-40%', x: '-50%' }}
                      animate={{ opacity: 1, scale: 1, y: '-50%', x: '-50%' }}
                      exit={{ opacity: 0, scale: 0.95, y: '-40%', x: '-50%' }}
                      transition={{ duration: 0.25 }}
                      className="absolute top-1/2 left-1/2 w-[620px] h-[390px] bg-white border border-slate-300 rounded-xl shadow-2xl z-30 flex flex-col overflow-hidden text-slate-800 text-xs"
                    >
                      {/* Explorer Title Bar */}
                      <div className="bg-[#f3f4f6] px-3 py-2 flex items-center justify-between border-b border-slate-200 select-none shrink-0">
                        <div className="flex items-center gap-2">
                          <div className="w-3.5 h-3.5 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-[8px]">W</div>
                          <span className="font-semibold text-slate-700 text-[11px]">Открыть — Проводник</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-6 h-6 hover:bg-slate-200 rounded flex items-center justify-center text-slate-500 font-medium">－</div>
                          <div className="w-6 h-6 hover:bg-slate-200 rounded flex items-center justify-center text-slate-500 text-[10px]">⬜</div>
                          <div className="w-6 h-6 hover:bg-rose-500 hover:text-white rounded flex items-center justify-center text-slate-500">✕</div>
                        </div>
                      </div>

                      {/* Explorer Navigation Bar */}
                      <div className="bg-white px-3 py-1.5 flex items-center gap-2 border-b border-slate-200 shrink-0">
                        <div className="flex items-center gap-1">
                          <button className="p-1 hover:bg-slate-100 rounded text-slate-400"><ArrowLeft className="w-3.5 h-3.5" /></button>
                          <button className="p-1 hover:bg-slate-100 rounded text-slate-400 rotate-180"><ArrowLeft className="w-3.5 h-3.5" /></button>
                        </div>
                        
                        {/* Explorer Path Bar */}
                        <div className="flex-1 flex items-center gap-1 px-2.5 py-1 bg-[#f3f4f6] border border-slate-200 rounded text-[11px] text-slate-600 overflow-hidden truncate">
                          <Monitor className="w-3 h-3 text-slate-400 shrink-0" />
                          <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>Этот компьютер</span>
                          <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>Документы</span>
                          <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-semibold text-slate-800">Учеба</span>
                        </div>

                        {/* Explorer Search */}
                        <div className="w-36 flex items-center gap-1.5 px-2 py-1 border border-slate-200 rounded text-[11px] bg-slate-50">
                          <Search className="w-3 h-3 text-slate-400" />
                          <span className="text-slate-400">Поиск в: Учеба</span>
                        </div>
                      </div>

                      {/* Explorer Main Body */}
                      <div className="flex flex-1 min-h-0 bg-white">
                        {/* Explorer Sidebar */}
                        <div className="w-40 border-r border-slate-200 bg-[#f9fafb] p-2 flex flex-col gap-1 select-none shrink-0">
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded text-slate-600">
                            <Monitor className="w-3.5 h-3.5 text-slate-400" />
                            <span>Этот компьютер</span>
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded text-slate-600 pl-4">
                            <Download className="w-3.5 h-3.5 text-slate-400" />
                            <span>Загрузки</span>
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 bg-indigo-50 border-l-2 border-indigo-500 rounded-r text-indigo-700 pl-4 font-semibold">
                            <Folder className="w-3.5 h-3.5 text-indigo-500" />
                            <span>Документы</span>
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded text-slate-600 pl-6">
                            <Folder className="w-3.5 h-3.5 text-slate-400" />
                            <span>Учеба</span>
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded text-slate-600 pl-4">
                            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                            <span>Локальный диск (C:)</span>
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded text-slate-600 pl-4">
                            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                            <span>Локальный диск (D:)</span>
                          </div>
                        </div>

                        {/* Explorer Content Pane */}
                        <div className="flex-1 p-3 bg-white overflow-y-auto select-none flex flex-wrap gap-3 content-start">
                          {/* Folder */}
                          <div className="flex flex-col items-center justify-center p-2 rounded-lg hover:bg-slate-100 w-24 text-center shrink-0">
                            <Folder className="w-10 h-10 text-amber-400 fill-amber-200" />
                            <span className="text-[10px] font-medium text-slate-700 mt-1 truncate w-full">Семестр 2</span>
                          </div>

                          {/* Target File Docx (clickable) */}
                          <div 
                            className={`flex flex-col items-center justify-center p-2 rounded-lg border w-24 text-center transition duration-200 shrink-0 ${
                              step >= 3
                                ? 'bg-indigo-100/60 border-indigo-300 shadow-sm' 
                                : 'hover:bg-slate-100 border-transparent'
                            }`}
                          >
                            <div className="w-9 h-11 bg-white border border-slate-200 rounded flex items-center justify-center relative shadow-sm shrink-0">
                              <div className="absolute top-0 right-0 w-3 h-3 bg-indigo-600 rounded-bl rounded-tr flex items-center justify-center text-[6px] font-bold text-white">W</div>
                              <FileText className="w-6 h-6 text-indigo-600" />
                            </div>
                            <span className="text-[10px] font-medium text-slate-800 mt-1 truncate w-full">Лекция_1_Нейросети.docx</span>
                          </div>

                          {/* Disabled files for decoration */}
                          <div className="flex flex-col items-center justify-center p-2 rounded-lg hover:bg-slate-100 w-24 text-center opacity-40 shrink-0">
                            <div className="w-9 h-11 bg-white border border-slate-200 rounded flex items-center justify-center relative shadow-sm shrink-0">
                              <div className="absolute top-0 right-0 w-3 h-3 bg-indigo-600 rounded-bl rounded-tr flex items-center justify-center text-[6px] font-bold text-white">W</div>
                              <FileText className="w-6 h-6 text-indigo-600" />
                            </div>
                            <span className="text-[10px] font-medium text-slate-700 mt-1 truncate w-full">Курсовая_Черновик.docx</span>
                          </div>

                          <div className="flex flex-col items-center justify-center p-2 rounded-lg hover:bg-slate-100 w-24 text-center opacity-40 shrink-0">
                            <div className="w-9 h-11 bg-white border border-slate-200 rounded flex items-center justify-center relative shadow-sm shrink-0">
                              <FileText className="w-6 h-6 text-slate-400" />
                            </div>
                            <span className="text-[10px] font-medium text-slate-700 mt-1 truncate w-full">Схема_Алгоритма.png</span>
                          </div>
                        </div>
                      </div>

                      {/* Explorer Footer bar */}
                      <div className="bg-[#f3f4f6] px-4 py-2 border-t border-slate-200 flex items-center justify-between shrink-0">
                        <div className="text-[10px] text-slate-500">
                          Имя файла: <span className="font-semibold text-slate-700">{step >= 3 ? 'Лекция_1_Нейросети.docx' : ''}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            className={`px-5 py-1 border rounded text-[11px] font-medium shadow-sm transition ${
                              step >= 3 
                                ? 'bg-indigo-600 hover:bg-indigo-700 border-indigo-700 text-white font-semibold'
                                : 'bg-white border-slate-300 text-slate-400'
                            }`}
                          >
                            Открыть
                          </button>
                          <button className="px-5 py-1 bg-white border border-slate-300 hover:bg-slate-50 rounded text-[11px] font-medium text-slate-700 shadow-sm">
                            Отмена
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Анимированный курсор */}
                {cursorPos.opacity > 0 && (
                  <motion.div
                    animate={{ 
                      x: cursorPos.x, 
                      y: cursorPos.y, 
                      opacity: cursorPos.opacity, 
                      scale: cursorPos.scale 
                    }}
                    transition={{ 
                      type: "spring", 
                      stiffness: 85, 
                      damping: 17,
                      opacity: { duration: 0.15 }
                    }}
                    className="absolute z-50 pointer-events-none select-none drop-shadow-xl"
                    style={{ left: 0, top: 0 }}
                  >
                    <MousePointer2 className="w-5.5 h-5.5 text-slate-900 fill-white -rotate-[22deg]" />
                  </motion.div>
                )}

                {/* Волна пульсации клика */}
                {cursorPos.clicked && (
                  <motion.div
                    initial={{ scale: 0.3, opacity: 0.8 }}
                    animate={{ scale: 2.0, opacity: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="absolute w-10 h-10 rounded-full border-2 border-indigo-600 bg-indigo-500/10 pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2 animate-ping"
                    style={{ left: cursorPos.x, top: cursorPos.y }}
                  />
                )}

              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      icon: MessageSquare,
      color: 'indigo',
      title: 'Co-Study с Форджи',
      desc: 'Совместные учебные сессии с ИИ-помощником. Встроенный Pomodoro таймер и поддержка фокуса.',
    },
    {
      icon: Heart,
      color: 'emerald',
      title: 'Дневник ошибок и Менталочка',
      desc: 'Отслеживайте выгорание через Mood Tracker и автоматически прорабатывайте паттерны ошибок.',
    },
    {
      icon: Trophy,
      color: 'amber',
      title: 'Геймификация и Квесты',
      desc: 'Ежедневные задания, система уровней и глобальный лидерборд. Превратите рутину в увлекательную RPG.',
    },
    {
      icon: Network,
      color: 'blue',
      title: 'Интерактивная карта знаний',
      desc: 'Визуализация связей между вашими конспектами в виде 3D-графа для системного понимания и навигации.',
    },
    {
      icon: Cpu,
      color: 'rose',
      title: 'Мультиагентный ИИ-анализ',
      desc: '6 специализированных агентов за секунды парсят лекции, создают конспекты, тесты и Flash-карточки.',
    },
    {
      icon: GraduationCap,
      color: 'sky',
      title: 'Кабинет преподавателя',
      desc: 'Создавайте классы, мониторьте статистику студентов и анализируйте общую успеваемость потока в ВУЗе.',
    },
  ];

  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-600',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-600',
    blue: 'bg-blue-50 border-blue-100 text-blue-600',
    amber: 'bg-amber-50 border-amber-100 text-amber-600',
    rose: 'bg-rose-50 border-rose-100 text-rose-600',
    sky: 'bg-sky-50 border-sky-100 text-sky-600',
  };

  return (
    <section id="features" className="py-24 px-6 bg-white border-y border-slate-200/50">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16 space-y-3">
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
            Полный инструментарий студента
          </h2>
          <p className="text-slate-500 text-lg max-w-xl mx-auto">
            Объединяем передовые когнитивные технологии с удобством Notion
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div key={i}
              className="group p-6 rounded-2xl bg-slate-50/50 border border-slate-200/80 hover:border-slate-300 hover:bg-white hover:shadow-xl hover:shadow-slate-100 transition-all duration-300 hover:-translate-y-1">
              <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110 ${colorMap[f.color]}`}>
                <f.icon className="w-6 h-6" />
              </div>
              <h3 className="text-slate-900 font-bold text-base mb-2 group-hover:text-indigo-600 transition-colors">{f.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EducatorsSection() {
  const points = [
    {
      title: "Академическая честность",
      desc: "Инструменты самопроверки не подменяют знания, а стимулируют активное вспоминание и углубляют понимание сложных разделов."
    },
    {
      title: "Визуализация знаний",
      desc: "Использование карт понятий (concept mapping) снижает когнитивную нагрузку на студентов и помогает отслеживать логические связи."
    },
    {
      title: "Контроль успеваемости",
      desc: "Студенты могут сами тестировать себя в режиме Сократовского диалога перед сдачей реальных зачетов и курсовых."
    }
  ];

  return (
    <section id="educators" className="py-24 px-6 bg-slate-50/50 relative">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Картинка или графический элемент */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-indigo-50 text-indigo-600 font-bold text-[10px] px-3 py-1 rounded-bl-xl border-l border-b border-slate-200">
              ДЛЯ ВУЗОВ
            </div>
            <h4 className="text-sm font-extrabold text-slate-800 mb-4 flex items-center gap-1.5">
              <GraduationCap className="w-5 h-5 text-indigo-600" />
              Методическое обоснование
            </h4>
            <div className="space-y-4 text-xs">
              <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                <span className="font-bold text-slate-700 block mb-0.5">1. Active Recall</span>
                <p className="text-slate-500 leading-relaxed">Интервальные тесты вместо пассивного перечитывания лекций.</p>
              </div>
              <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                <span className="font-bold text-slate-700 block mb-0.5">2. Spaced Repetition</span>
                <p className="text-slate-500 leading-relaxed">Кривая забывания Эббингауза сглаживается за счет своевременного повторения.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Текст */}
        <div className="lg:col-span-7 space-y-6">
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
            Одобрено преподавателями <br />и методологами
          </h2>
          <p className="text-slate-600 leading-relaxed">
            Мы строим StudyForge на принципах доказательного образования (Evidence-Based Learning). Сервис помогает превратить хаотичные конспекты лекций в четкую структуру, облегчая подготовку к сессии и работу с понятиями.
          </p>
          <div className="space-y-4">
            {points.map((p, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 mt-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">{p.title}</h4>
                  <p className="text-slate-500 text-xs leading-relaxed mt-0.5">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  const navigate = useNavigate();
  return (
    <section className="py-24 px-6 max-w-5xl mx-auto">
      <div className="relative bg-gradient-to-r from-indigo-600 to-indigo-800 border border-indigo-700 rounded-3xl p-12 text-center text-white overflow-hidden shadow-xl shadow-indigo-100">
        {/* Фоновые круги */}
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-white/5 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[200px] h-[200px] bg-indigo-500/30 rounded-full blur-[60px] pointer-events-none" />
        
        <div className="relative space-y-6 max-w-2xl mx-auto">
          <div className="flex justify-center gap-2 flex-wrap">
            {['✓ Бесплатно', '✓ Мгновенный запуск', '✓ Простой импорт'].map(t => (
              <span key={t}
                className="text-xs text-indigo-200 bg-white/10 px-3 py-1 rounded-full backdrop-blur-sm">
                {t}
              </span>
            ))}
          </div>
          
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            Готовы учиться более осознанно?
          </h2>
          
          <p className="text-indigo-100 text-base max-w-md mx-auto leading-relaxed">
            Создайте аккаунт бесплатно, загрузите первую лекцию и начните повышать свою академическую успеваемость.
          </p>
          
          <div className="pt-2">
            <button onClick={() => navigate('/register')}
              className="group inline-flex items-center gap-2 px-10 py-4 bg-white hover:bg-slate-50 text-indigo-600 font-extrabold text-base rounded-xl transition shadow-2xl hover:scale-[1.02] duration-200">
              Начать обучение
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-8 px-6 border-t border-slate-200/50 bg-white text-slate-500 text-sm">
      <div className="max-w-5xl mx-auto flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <span className="text-slate-800 font-extrabold tracking-tight">StudyForge</span>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold">
          <span>&copy; {new Date().getFullYear()} StudyForge. Все права защищены.</span>
        </div>
      </div>
    </footer>
  );
}
