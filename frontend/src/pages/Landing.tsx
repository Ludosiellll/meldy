import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { 
  GraduationCap, Zap, Brain, Calendar, BookOpen,
  MessageSquare, Sparkles, ArrowRight,
  CheckCircle, Upload, Cpu, Trophy, Network, Heart, 
  Menu, X, Play, Target, Flame, Layers
} from 'lucide-react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  useEffect(() => { 
    if (user) navigate('/dashboard'); 
  }, [user]);

  // Smooth scroll logic for anchors
  useEffect(() => {
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.documentElement.style.scrollBehavior = 'auto';
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#030712] text-slate-200 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 overflow-x-hidden relative">
      {/* Premium Dark Gradient Mesh Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-900/20 blur-[120px]" />
        <div className="absolute top-[40%] left-[60%] w-[30%] h-[30%] rounded-full bg-emerald-900/10 blur-[100px]" />
        {/* Subtle grid */}
        <div 
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage: `radial-gradient(#4f46e5 1px, transparent 1px)`,
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)'
          }}
        />
      </div>

      <div className="relative z-10">
        <Navbar />
        <Hero />
        <PremiumTicker />
        <EcosystemFeatures />
        <DeepDiveSection />
        <CtaSection />
        <Footer />
      </div>
    </div>
  );
}

function Navbar() {
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <motion.nav 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrolled ? 'py-3 bg-[#030712]/80 backdrop-blur-xl border-b border-white/10 shadow-2xl' : 'py-6 bg-transparent border-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate('/')}>
            <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-violet-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-all duration-300 group-hover:scale-105">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-white text-xl tracking-tight">StudyForge</span>
          </div>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300">
            <a href="#ecosystem" className="hover:text-white transition-colors relative group">
              Экосистема
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-indigo-500 transition-all duration-300 group-hover:w-full" />
            </a>
            <a href="#gamification" className="hover:text-white transition-colors relative group">
              Механики
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-indigo-500 transition-all duration-300 group-hover:w-full" />
            </a>
          </div>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-4">
            <button onClick={() => navigate('/login')}
              className="text-sm font-bold text-slate-300 hover:text-white transition-colors">
              Войти
            </button>
            <button onClick={() => navigate('/register')}
              className="relative text-sm font-bold px-6 py-2.5 rounded-xl text-white group overflow-hidden">
              <span className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-violet-600 transition-all duration-300 group-hover:scale-105" />
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-gradient-to-r from-indigo-500 to-violet-500 blur-lg transition-opacity duration-300" />
              <span className="relative flex items-center gap-2">
                Начать бесплатно
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)} 
            className="md:hidden z-50 p-2 text-slate-300 hover:text-white"
          >
            {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </motion.nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[#030712]/95 backdrop-blur-3xl flex flex-col items-center justify-center gap-8 md:hidden px-6 pt-16"
          >
            <a href="#ecosystem" onClick={() => setIsMenuOpen(false)} className="text-2xl font-black text-white">Экосистема</a>
            <a href="#gamification" onClick={() => setIsMenuOpen(false)} className="text-2xl font-black text-white">Механики</a>
            <div className="flex flex-col w-full max-w-xs gap-4 mt-8">
              <button onClick={() => { setIsMenuOpen(false); navigate('/login'); }}
                className="w-full py-4 text-center font-bold text-slate-300 bg-white/5 rounded-2xl hover:bg-white/10 transition border border-white/10">
                Войти
              </button>
              <button onClick={() => { setIsMenuOpen(false); navigate('/register'); }}
                className="w-full py-4 text-center font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl shadow-lg shadow-indigo-500/25">
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
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"]
  });

  const y1 = useTransform(scrollYProgress, [0, 1], [0, 200]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section ref={containerRef} className="relative pt-40 pb-20 md:pt-48 md:pb-32 px-6 min-h-[90vh] flex items-center max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-center w-full">
        
        {/* Text Content */}
        <motion.div 
          style={{ opacity }}
          className="lg:col-span-6 space-y-8 z-20"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-300 text-xs font-bold tracking-wide backdrop-blur-md"
          >
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>Платформа обучения нового поколения</span>
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-5xl md:text-7xl font-black tracking-tighter leading-[1.05] text-white"
          >
            Учитесь <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">быстрее.</span><br />
            Помните <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">вечно.</span>
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg md:text-xl text-slate-400 leading-relaxed max-w-xl font-medium"
          >
            StudyForge — это ваша геймифицированная нейросетевая академия. Мы превращаем скучные лекции в интерактивные квесты, устные экзамены с ИИ и карточки интервального повторения.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-wrap items-center gap-4"
          >
            <button onClick={() => navigate('/register')}
              className="relative group px-8 py-4 rounded-2xl font-bold text-white text-base overflow-hidden">
              <span className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-violet-600 transition-all duration-300 group-hover:scale-105" />
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-gradient-to-r from-indigo-500 to-violet-500 blur-xl transition-opacity duration-300" />
              <span className="relative flex items-center gap-2">
                Создать аккаунт
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
            
            <button onClick={() => navigate('/analyze')}
              className="px-8 py-4 rounded-2xl font-bold text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-all duration-300 backdrop-blur-md flex items-center gap-2">
              <Play className="w-5 h-5" />
              Смотреть демо
            </button>
          </motion.div>
        </motion.div>

        {/* 3D Floating Elements Showcase */}
        <div className="lg:col-span-6 relative h-[500px] w-full hidden md:block perspective-1000 z-10">
          
          {/* Main Dashboard Card */}
          <motion.div 
            style={{ y: y1 }}
            initial={{ opacity: 0, rotateY: 20, rotateX: 10, x: 50 }}
            animate={{ opacity: 1, rotateY: -5, rotateX: 5, x: 0 }}
            transition={{ duration: 1, type: "spring", bounce: 0.4 }}
            className="absolute top-10 right-0 w-[450px] bg-[#0f172a]/80 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(79,70,229,0.15)] p-6 z-20"
          >
            <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <Brain className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Прогресс обучения</h3>
                  <p className="text-xs text-indigo-400 font-semibold">Уровень 12 • Архимаг</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-400">Опыт (XP)</span>
                  <span className="text-emerald-400">8,450 / 10,000</span>
                </div>
                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: "84.5%" }}
                    transition={{ duration: 1.5, delay: 0.5 }}
                    className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full" 
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex items-center gap-3">
                  <Flame className="w-8 h-8 text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">Стрик</p>
                    <p className="text-lg font-black text-white">14 дней</p>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex items-center gap-3">
                  <Target className="w-8 h-8 text-indigo-400 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">Квесты</p>
                    <p className="text-lg font-black text-white">3 / 3</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Floating Card 1: Co-Study */}
          <motion.div 
            style={{ y: y2 }}
            initial={{ opacity: 0, y: 50, x: -50 }}
            animate={{ opacity: 1, y: 0, x: -30 }}
            transition={{ duration: 1, delay: 0.3, type: "spring" }}
            className="absolute bottom-20 left-0 w-[280px] bg-gradient-to-br from-slate-900/90 to-[#030712]/90 backdrop-blur-2xl border border-indigo-500/30 rounded-3xl p-5 shadow-[0_0_40px_rgba(79,70,229,0.2)] z-30"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/50">
                  <img src="https://api.dicebear.com/7.x/bottts/svg?seed=Forgey&backgroundColor=transparent" alt="AI" className="w-8 h-8" />
                </div>
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">Co-Study Session</p>
                <p className="text-[10px] text-indigo-300">Форджи • ИИ-наставник</p>
              </div>
            </div>
            <div className="bg-indigo-500/10 rounded-xl p-3 border border-indigo-500/20">
              <p className="text-xs font-medium text-slate-300">
                <span className="text-indigo-400 font-bold">Форджи:</span> Отлично! Мы сфокусировано учимся уже 25 минут. Сделаем 5-минутный перерыв? ☕
              </p>
            </div>
          </motion.div>

          {/* Floating Card 2: Knowledge Map */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.6, type: "spring" }}
            className="absolute top-0 left-10 w-[220px] bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl z-10"
          >
            <div className="flex items-center gap-2 mb-3">
              <Network className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Карта знаний</span>
            </div>
            
            {/* Fake Graph */}
            <div className="relative h-24 w-full flex items-center justify-center">
              <div className="absolute w-full h-full">
                <svg className="w-full h-full" viewBox="0 0 100 100">
                  <line x1="50" y1="50" x2="20" y2="20" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                  <line x1="50" y1="50" x2="80" y2="30" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                  <line x1="50" y1="50" x2="70" y2="80" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                  
                  <circle cx="50" cy="50" r="12" fill="#6366f1" className="animate-pulse" />
                  <circle cx="20" cy="20" r="6" fill="#34d399" />
                  <circle cx="80" cy="30" r="8" fill="#f43f5e" />
                  <circle cx="70" cy="80" r="7" fill="#818cf8" />
                </svg>
              </div>
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
}

function PremiumTicker() {
  return (
    <div className="w-full py-8 border-y border-white/5 bg-white/[0.02] overflow-hidden flex items-center">
      <div className="max-w-7xl mx-auto px-6 w-full flex flex-col items-center">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6 text-center">Создано для студентов ведущих ВУЗов</p>
        <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-50 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-500">
           {/* Placeholder Logos / Text for universities */}
           <div className="text-xl font-black text-slate-400 font-serif">МГУ</div>
           <div className="text-xl font-black text-slate-400 font-sans tracking-tighter">МФТИ</div>
           <div className="text-xl font-black text-slate-400 font-serif italic">ВШЭ</div>
           <div className="text-xl font-black text-slate-400 font-sans uppercase">Бауманка</div>
           <div className="text-xl font-black text-slate-400 font-serif">ИТМО</div>
        </div>
      </div>
    </div>
  );
}

function EcosystemFeatures() {
  const features = [
    {
      icon: Cpu,
      title: "Мультиагентный ИИ-анализ",
      desc: "6 специализированных нейросетей одновременно парсят лекцию: выделяют термины, создают квизы и даже генерируют подкасты.",
      color: "from-indigo-500 to-violet-500"
    },
    {
      icon: Layers,
      title: "Дневник ошибок",
      desc: "Система автоматически ловит ваши ошибки в тестах и формирует индивидуальные квесты для закрытия пробелов в знаниях.",
      color: "from-rose-500 to-pink-500"
    },
    {
      icon: Brain,
      title: "Трекер ментального здоровья",
      desc: "Мы следим за вашим эмоциональным фоном. Если ИИ замечает выгорание, он снижает нагрузку и предлагает техники релаксации.",
      color: "from-emerald-400 to-teal-500"
    },
    {
      icon: Trophy,
      title: "Геймификация и Квесты",
      desc: "Ежедневные задания, система уровней, стрик и глобальный лидерборд. Учеба превращается в увлекательную RPG.",
      color: "from-amber-400 to-orange-500"
    },
    {
      icon: Network,
      title: "Интерактивная карта знаний",
      desc: "Визуализируйте свои знания в виде 3D-графа в стиле Obsidian. Видьте связи между предметами и находите слабые места.",
      color: "from-blue-400 to-cyan-500"
    },
    {
      icon: Users,
      title: "Кабинет преподавателя",
      desc: "Мощный инструмент для ВУЗов. Создавайте классы, отслеживайте статистику студентов и анализируйте общую успеваемость потока.",
      color: "from-purple-500 to-fuchsia-500"
    }
  ];

  return (
    <section id="ecosystem" className="py-32 px-6 relative">
      <div className="max-w-7xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center max-w-3xl mx-auto mb-20 space-y-6"
        >
          <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight">
            Больше, чем просто конспекты.
            <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">Целая образовательная экосистема.</span>
          </h2>
          <p className="text-lg text-slate-400">
            StudyForge объединяет передовые когнитивные методики, мощь ИИ и механики вовлечения, чтобы сделать обучение эффективным и нескучным.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <FeatureCard key={i} index={i} feature={f} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature, index }: { feature: any, index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative bg-white/5 hover:bg-white/10 backdrop-blur-xl border border-white/10 hover:border-white/20 rounded-3xl p-8 transition-all duration-500 hover:-translate-y-2 overflow-hidden"
    >
      {/* Glow effect on hover */}
      <div className={`absolute -inset-px bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-10 blur-xl transition-opacity duration-500`} />
      
      <div className="relative z-10">
        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.color} p-0.5 mb-6`}>
          <div className="w-full h-full bg-[#0f172a] rounded-[14px] flex items-center justify-center">
            <feature.icon className="w-6 h-6 text-white" />
          </div>
        </div>
        <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
        <p className="text-sm text-slate-400 leading-relaxed">{feature.desc}</p>
      </div>
    </motion.div>
  );
}

function DeepDiveSection() {
  return (
    <section id="gamification" className="py-32 px-6 bg-[#0a0f1c] relative border-y border-white/5">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        
        <motion.div 
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="space-y-8"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-rose-500/10 border border-rose-500/20 rounded-full text-rose-400 text-xs font-bold tracking-wide">
            <Heart className="w-4 h-4" />
            <span>Забота о студентах</span>
          </div>
          
          <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
            Учись вместе с ИИ. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400">Без выгорания.</span>
          </h2>
          
          <p className="text-lg text-slate-400 leading-relaxed">
            Наш уникальный режим **Co-Study** с поддержкой Pomodoro таймера позволяет вам учиться бок о бок с ИИ-помощником. Он подбадривает вас, следит за фокусом и вовремя отправляет на перерыв.
          </p>
          
          <ul className="space-y-4">
            {['Интервальное повторение Лейтнера', 'Аналитика паттернов ошибок', 'Адаптивный уровень сложности'].map((text, i) => (
              <li key={i} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <span className="text-sm font-semibold text-slate-300">{text}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          className="relative"
        >
          {/* Decorative blur */}
          <div className="absolute inset-0 bg-gradient-to-tr from-rose-500/20 to-orange-500/20 blur-3xl rounded-full" />
          
          {/* Complex UI Mockup */}
          <div className="relative bg-[#0f172a]/90 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-8 border-b border-white/5 pb-4">
              <h4 className="font-bold text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-rose-400" /> Фокус-сессия
              </h4>
              <span className="px-3 py-1 bg-white/5 rounded-full text-xs font-mono text-slate-300 border border-white/10">25:00</span>
            </div>

            <div className="space-y-6">
              {/* Chat bubble */}
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/50 shrink-0">
                  <img src="https://api.dicebear.com/7.x/bottts/svg?seed=Forgey&backgroundColor=transparent" alt="AI" className="w-8 h-8" />
                </div>
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl rounded-tl-sm p-4 w-full">
                  <p className="text-sm text-slate-300 leading-relaxed">
                    Вижу, ты немного устал после теста по Физике. Давай сделаем 5-минутную дыхательную практику перед следующим блоком? 🧘‍♂️
                  </p>
                </div>
              </div>

              {/* Mood Tracker Mockup */}
              <div className="bg-[#030712]/50 border border-white/5 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-400 uppercase mb-3">Уровень энергии</p>
                <div className="flex items-end gap-2 h-16">
                  {[40, 60, 50, 80, 45, 30, 65].map((h, i) => (
                    <motion.div 
                      key={i}
                      initial={{ height: 0 }}
                      whileInView={{ height: `${h}%` }}
                      transition={{ duration: 1, delay: i * 0.1 }}
                      className={`w-full rounded-t-sm ${i === 5 ? 'bg-rose-500' : 'bg-indigo-500'}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

      </div>
    </section>
  );
}

function CtaSection() {
  const navigate = useNavigate();
  return (
    <section className="py-32 px-6 max-w-5xl mx-auto relative">
      <motion.div 
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        className="relative rounded-3xl p-1px bg-gradient-to-b from-indigo-500 to-violet-900 overflow-hidden"
      >
        <div className="relative bg-[#0a0f1c] rounded-3xl p-12 md:p-20 text-center overflow-hidden h-full w-full flex flex-col items-center justify-center">
          
          {/* Background Glows inside CTA */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-[600px] bg-indigo-500/20 blur-[100px] pointer-events-none" />
          
          <div className="relative z-10 space-y-8 max-w-2xl mx-auto">
            <h2 className="text-4xl md:text-6xl font-black text-white tracking-tight">
              Готовы стать <br className="hidden md:block" />лучшей версией себя?
            </h2>
            
            <p className="text-lg text-slate-400 leading-relaxed">
              Присоединяйтесь к тысячам студентов, которые уже автоматизировали свою рутину и превратили учебу в игру.
            </p>
            
            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button onClick={() => navigate('/register')}
                className="w-full sm:w-auto relative group px-10 py-5 rounded-2xl font-bold text-white text-lg overflow-hidden">
                <span className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-violet-600 transition-all duration-300 group-hover:scale-105" />
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-gradient-to-r from-indigo-400 to-violet-400 blur-xl transition-opacity duration-300" />
                <span className="relative flex items-center justify-center gap-2">
                  Начать прямо сейчас
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </div>
            
            <p className="text-xs text-slate-500 font-medium">Бесплатный базовый функционал навсегда. Кредитка не требуется.</p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

// Temporary Users icon component for EcosystemFeatures since it's missing in initial lucide imports list
function Users(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function Footer() {
  return (
    <footer className="py-12 px-6 border-t border-white/5 bg-[#030712] text-slate-500 text-sm">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
            <GraduationCap className="w-4 h-4 text-slate-300" />
          </div>
          <span className="text-slate-300 font-extrabold tracking-tight text-lg">StudyForge</span>
        </div>
        
        <div className="flex gap-6 text-xs font-semibold">
          <a href="#" className="hover:text-white transition-colors">Политика конфиденциальности</a>
          <a href="#" className="hover:text-white transition-colors">Пользовательское соглашение</a>
          <a href="#" className="hover:text-white transition-colors">Контакты</a>
        </div>
        
        <div className="text-xs font-semibold">
          &copy; {new Date().getFullYear()} StudyForge. ИИ-платформа для студентов.
        </div>
      </div>
    </footer>
  );
}
