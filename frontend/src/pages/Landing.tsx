import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { 
  GraduationCap, Zap, Brain, Calendar, BookOpen,
  MessageSquare, BarChart2, Sparkles, ArrowRight,
  CheckCircle, Upload, Cpu, Trophy, Network, Briefcase, Award, Heart, Menu, X
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
      <HowItWorks />
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
    { value: 'SM-2 Лейтнер', label: 'научный интервал повторений' },
    { value: '100% облако', label: 'доступ с любого устройства' },
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

function HowItWorks() {
  const steps = [
    {
      icon: Upload,
      num: '01',
      title: 'Загрузка лекции',
      desc: 'Загрузите PDF, DOCX, TXT файлы, конспекты или даже сырой текст ваших записей.',
    },
    {
      icon: Cpu,
      num: '02',
      title: 'Параллельная обработка',
      desc: 'Команда AI-агентов моментально создает структурированный конспект, выжимки, тесты и аудиоподкаст.',
    },
    {
      icon: Trophy,
      num: '03',
      title: 'Умное закрепление',
      desc: 'Учитесь по карточкам с адаптивными интервалами, сдавайте устный тест и выстраивайте карьерный путь.',
    },
  ];
  return (
    <section id="how-it-works" className="py-24 px-6 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16 space-y-3">
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
            Как работает StudyForge
          </h2>
          <p className="text-slate-500 text-lg max-w-xl mx-auto">
            Три простых этапа от сложного сырого конспекта к прочным знаниям в долговременной памяти
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 relative">
          {/* Линия соединения шагов */}
          <div className="hidden md:block absolute top-12 left-[15%] right-[15%] h-0.5 bg-slate-200/70" />
          
          {steps.map((step, i) => (
            <div key={i} className="relative group text-center flex flex-col items-center">
              <div className="w-20 h-20 rounded-2xl bg-white border-2 border-slate-200 flex items-center justify-center relative mb-6 shadow-md transition-all duration-300 group-hover:border-indigo-600 group-hover:-translate-y-1">
                <step.icon className="w-8 h-8 text-indigo-600" />
                <span className="absolute -top-2.5 -right-2.5 text-xs font-extrabold text-white bg-indigo-600 rounded-full w-7 h-7 flex items-center justify-center shadow-md">
                  {step.num}
                </span>
              </div>
              <h3 className="text-slate-900 font-bold text-lg mb-2">
                {step.title}
              </h3>
              <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      icon: Zap,
      color: 'indigo',
      title: 'Мультиагентный ИИ-анализ',
      desc: '6 специализированных ИИ-агентов одновременно генерируют конспект, шпаргалки, квесты, подкасты и тесты.',
    },
    {
      icon: Brain,
      color: 'emerald',
      title: 'Метод Лейтнера (Spaced Rep)',
      desc: 'Адаптивный алгоритм отслеживает ваш уровень запоминания карточек и напоминает их ровно вовремя.',
    },
    {
      icon: Network,
      color: 'blue',
      title: 'Карта знаний (Obsidian)',
      desc: 'Визуализация связей между вашими конспектами в виде интерактивного 3D-графа для системного понимания.',
    },
    {
      icon: Calendar,
      color: 'amber',
      title: 'Календарь подготовки',
      desc: 'Внесите предметы и даты экзаменов. Система построит детальный ежедневный план занятий.',
    },
    {
      icon: Briefcase,
      color: 'rose',
      title: 'Навигатор карьеры',
      desc: 'AI проанализирует все ваши лекции и составит профессиональный профиль с подходящими вакансиями.',
    },
    {
      icon: MessageSquare,
      color: 'sky',
      title: 'Интерактивный Лектор',
      desc: 'Задавайте вопросы конспектам. AI отвечает строго в контексте ваших материалов, избегая галлюцинаций.',
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
