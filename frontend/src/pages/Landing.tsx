import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  GraduationCap,
  Headphones,
  MessageCircle,
  MousePointer2,
  Network,
  Play,
  Quote,
  Sparkles,
  Upload,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

const reveal = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  return (
    <div className="landing-shell min-h-screen overflow-hidden bg-[#07111f] text-[#edf7ff] selection:bg-cyan-300 selection:text-slate-950">
      <Navbar />
      <main>
        <Hero />
        <LearningFlow />
        <FeatureGrid />
        <MethodSection />
        <FinalCall />
      </main>
      <Footer />
    </div>
  );
}

function Navbar() {
  const navigate = useNavigate();

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.07] bg-[#07111f]/70 backdrop-blur-2xl">
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <button className="group flex items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" onClick={() => navigate('/')}>
          <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-cyan-300/30 bg-cyan-300/10">
            <span className="absolute inset-0 translate-y-full bg-cyan-300 transition-transform duration-300 group-hover:translate-y-0" />
            <GraduationCap className="relative h-5 w-5 text-cyan-200 transition-colors group-hover:text-slate-950" />
          </span>
          <span className="text-lg font-black tracking-[-0.04em] text-white">StudyForge</span>
        </button>

        <div className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex">
          <a className="transition hover:text-white" href="#process">Как это работает</a>
          <a className="transition hover:text-white" href="#possibilities">Возможности</a>
          <a className="transition hover:text-white" href="#method">Подход</a>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button className="hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white sm:block" onClick={() => navigate('/login')}>
            Войти
          </button>
          <button className="landing-button-primary px-4 py-2.5 text-xs sm:px-5 sm:text-sm" onClick={() => navigate('/register')}>
            Попробовать
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative isolate min-h-[900px] overflow-hidden px-5 pb-28 pt-32 sm:px-8 lg:pt-40">
      <div className="landing-aurora landing-aurora-one" />
      <div className="landing-aurora landing-aurora-two" />
      <div className="landing-grid absolute inset-0 -z-10 opacity-45" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[#07111f]" />

      <div className="relative mx-auto grid max-w-[1400px] items-center gap-16 lg:grid-cols-[0.84fr_1.16fr] lg:gap-12">
        <motion.div
          initial="hidden"
          animate="visible"
          transition={{ staggerChildren: reduceMotion ? 0 : 0.12 }}
          className="relative z-10 max-w-2xl"
        >
          <motion.div variants={reveal} transition={{ duration: 0.65 }} className="mb-7 inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-200/[0.07] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
            </span>
            Учебный материал → система знаний
          </motion.div>

          <motion.h1 variants={reveal} transition={{ duration: 0.75 }} className="max-w-[760px] text-[clamp(3.5rem,7vw,7.5rem)] font-black leading-[0.86] tracking-[-0.075em] text-white">
            Лекция больше
            <span className="landing-title-accent block">не просто файл.</span>
          </motion.h1>

          <motion.p variants={reveal} transition={{ duration: 0.7 }} className="mt-8 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Загрузите материал один раз. StudyForge соберёт из него конспект, карточки, тест, подкаст и маршрут повторения.
          </motion.p>

          <motion.div variants={reveal} transition={{ duration: 0.7 }} className="mt-9 flex flex-wrap items-center gap-3">
            <button className="landing-button-primary px-6 py-4 text-sm sm:px-7 sm:text-base" onClick={() => navigate('/register')}>
              Загрузить первую лекцию
              <ArrowRight className="h-5 w-5" />
            </button>
            <button className="landing-button-ghost px-6 py-4 text-sm sm:text-base" onClick={() => navigate('/analyze')}>
              <Play className="h-4 w-4 fill-current" />
              Открыть демо
            </button>
          </motion.div>

          <motion.div variants={reveal} transition={{ duration: 0.7 }} className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-slate-400 sm:text-sm">
            {['PDF, DOCX, TXT и видео', 'Результаты в одном месте'].map((item) => (
              <span key={item} className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full border border-emerald-300/30 bg-emerald-300/10">
                  <Check className="h-3 w-3 text-emerald-300" />
                </span>
                {item}
              </span>
            ))}
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 36 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="relative mx-auto w-full max-w-[760px] lg:translate-x-6"
        >
          <KnowledgeForge />
        </motion.div>
      </div>
    </section>
  );
}

const demoStates = [
  { id: 'summary', label: 'Конспект', icon: FileText },
  { id: 'cards', label: 'Карточки', icon: Brain },
  { id: 'quiz', label: 'Тест', icon: Zap },
];

function KnowledgeForge() {
  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % demoStates.length), 3200);
    return () => window.clearInterval(timer);
  }, [reduceMotion]);

  return (
    <div className="relative min-h-[540px] sm:min-h-[610px]">
      <div className="absolute left-[8%] top-[6%] h-[82%] w-[84%] rounded-full bg-cyan-300/10 blur-[80px]" />
      <motion.div
        animate={reduceMotion ? undefined : { y: [0, -9, 0], rotate: [-1.2, 0.4, -1.2] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute left-0 top-24 z-20 hidden w-44 rounded-2xl border border-white/10 bg-[#0c1a2b]/90 p-4 shadow-2xl backdrop-blur-xl sm:block"
      >
        <div className="flex items-center gap-2 text-xs font-bold text-cyan-200"><Upload className="h-4 w-4" /> Лекция загружена</div>
        <div className="mt-3 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-400/15"><FileText className="h-5 w-5 text-rose-300" /></div>
          <div className="min-w-0"><p className="truncate text-xs font-semibold text-white">Квантовая физика.pdf</p><p className="mt-1 text-[10px] text-slate-500">24 страницы</p></div>
        </div>
      </motion.div>

      <motion.div
        animate={reduceMotion ? undefined : { y: [0, 11, 0], rotate: [1.5, -0.5, 1.5] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
        className="absolute right-0 top-8 z-20 hidden w-48 rounded-2xl border border-violet-300/20 bg-violet-300/[0.08] p-4 shadow-2xl backdrop-blur-xl md:block"
      >
        <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-200">Связи найдены</span><Network className="h-4 w-4 text-violet-300" /></div>
        <div className="mt-4 flex items-center justify-center gap-3">
          {[2, 4, 3].map((size, index) => <span key={index} className="rounded-full bg-violet-300" style={{ width: size * 4, height: size * 4, opacity: 0.45 + index * 0.2 }} />)}
        </div>
      </motion.div>

      <div className="landing-demo-window absolute inset-x-0 top-16 mx-auto w-[94%] overflow-hidden rounded-[28px] sm:top-20 sm:w-[86%]">
        <div className="flex h-14 items-center justify-between border-b border-white/[0.08] px-4 sm:px-6">
          <div className="flex gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" /></div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500"><WandSparkles className="h-3.5 w-3.5 text-cyan-300" /> Анализ завершён</div>
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-cyan-200 to-violet-400" />
        </div>

        <div className="grid min-h-[430px] grid-cols-1 sm:grid-cols-[150px_1fr]">
          <aside className="hidden border-r border-white/[0.07] p-4 sm:block">
            <div className="mb-7 flex items-center gap-2 px-2 text-xs font-black text-white"><Sparkles className="h-4 w-4 text-cyan-300" /> StudyForge</div>
            <div className="space-y-1.5">
              {demoStates.map((state, index) => (
                <button key={state.id} onClick={() => setActive(index)} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[11px] font-semibold transition ${active === index ? 'bg-cyan-300 text-slate-950' : 'text-slate-500 hover:bg-white/5 hover:text-slate-200'}`}>
                  <state.icon className="h-3.5 w-3.5" />{state.label}
                </button>
              ))}
            </div>
            <div className="mt-24 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
              <p className="text-[9px] uppercase tracking-wider text-slate-600">Материал</p>
              <p className="mt-1.5 text-[10px] font-semibold text-slate-300">Квантовая физика</p>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full w-full bg-gradient-to-r from-cyan-300 to-violet-400" /></div>
            </div>
          </aside>

          <div className="relative overflow-hidden p-5 sm:p-7">
            <div className="mb-5 flex items-start justify-between">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">Рабочая область</p><h3 className="mt-1.5 text-lg font-black tracking-tight text-white">Основы квантовой механики</h3></div>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[9px] font-bold text-emerald-300">ГОТОВО</span>
            </div>

            <div className="mb-5 flex gap-2 sm:hidden">
              {demoStates.map((state, index) => <button aria-label={state.label} key={state.id} onClick={() => setActive(index)} className={`rounded-lg p-2 ${active === index ? 'bg-cyan-300 text-slate-950' : 'bg-white/5 text-slate-400'}`}><state.icon className="h-4 w-4" /></button>)}
            </div>

            <motion.div key={active} initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.45 }}>
              {active === 0 && <SummaryDemo />}
              {active === 1 && <CardsDemo />}
              {active === 2 && <QuizDemo />}
            </motion.div>
          </div>
        </div>
      </div>

      <motion.div
        animate={reduceMotion ? undefined : { y: [0, -8, 0], rotate: [-0.8, 0.8, -0.8] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut', delay: 1.2 }}
        className="absolute bottom-0 right-[4%] z-30 w-48 rounded-2xl border border-emerald-300/20 bg-[#10261f]/90 p-4 shadow-2xl backdrop-blur-xl sm:w-56"
      >
        <div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-300 text-slate-950"><Brain className="h-4 w-4" /></div><div><p className="text-[10px] text-emerald-200/60">Следующее повторение</p><p className="text-xs font-bold text-white">Сегодня · 12 карточек</p></div></div>
      </motion.div>
    </div>
  );
}

function SummaryDemo() {
  return <div className="space-y-3"><div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4"><div className="mb-3 flex items-center gap-2 text-xs font-bold text-white"><span className="h-2 w-2 rounded-full bg-cyan-300" />Ключевая идея</div><p className="text-xs leading-6 text-slate-400">Состояние частицы описывается волновой функцией, а измерение связывает возможный результат с его вероятностью.</p></div><div className="grid grid-cols-2 gap-3"><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-[9px] uppercase tracking-wider text-slate-600">Термины</p><p className="mt-2 text-2xl font-black text-cyan-200">14</p></div><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-[9px] uppercase tracking-wider text-slate-600">Разделы</p><p className="mt-2 text-2xl font-black text-violet-200">05</p></div></div><div className="space-y-2 pt-1">{[100, 86, 92].map((width, i) => <div key={i} className="h-2 rounded-full bg-white/[0.05]"><motion.div initial={{ width: 0 }} animate={{ width: `${width}%` }} transition={{ duration: 0.7, delay: i * 0.08 }} className="h-full rounded-full bg-gradient-to-r from-cyan-300/50 to-violet-400/30" /></div>)}</div></div>;
}

function CardsDemo() {
  return <div className="relative mx-auto max-w-sm pt-2"><div className="absolute inset-x-8 top-6 h-48 rotate-3 rounded-2xl border border-violet-300/10 bg-violet-300/5" /><div className="relative flex h-52 flex-col justify-between rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-300/[0.09] to-violet-300/[0.04] p-5"><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-300">Карточка 04 / 14</p><p className="text-center text-lg font-black leading-snug text-white">Что означает принцип суперпозиции?</p><div className="flex justify-center"><span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[10px] text-slate-400">Нажмите, чтобы открыть ответ</span></div></div></div>;
}

function QuizDemo() {
  return <div><p className="mb-4 text-sm font-bold leading-6 text-white">Что происходит с волновой функцией при измерении?</p><div className="space-y-2.5">{['Она коллапсирует в одно состояние', 'Она исчезает навсегда', 'Она удваивает амплитуду'].map((answer, i) => <div key={answer} className={`flex items-center gap-3 rounded-xl border p-3 text-[11px] ${i === 0 ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100' : 'border-white/[0.07] bg-white/[0.025] text-slate-400'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg font-black ${i === 0 ? 'bg-emerald-300 text-slate-950' : 'bg-white/5 text-slate-500'}`}>{String.fromCharCode(65 + i)}</span>{answer}{i === 0 && <Check className="ml-auto h-4 w-4 text-emerald-300" />}</div>)}</div></div>;
}

function LearningFlow() {
  const steps = [
    { icon: Upload, label: 'Добавьте материал', text: 'Файл, текст, аудио или видео.' },
    { icon: WandSparkles, label: 'Выберите формат', text: 'Конспект, карточки, тест и другое.' },
    { icon: Brain, label: 'Закрепите тему', text: 'Повторяйте и проверяйте себя.' },
  ];

  return (
    <section id="process" className="relative px-5 py-28 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="Один материал — несколько способов учиться" title="От загрузки до повторения — в одном потоке" text="Не нужно переносить текст между сервисами. Результаты остаются рядом с исходным материалом." />
        <div className="relative mt-16 grid gap-4 md:grid-cols-3">
          <div className="landing-process-line absolute left-[16%] right-[16%] top-11 hidden h-px md:block" />
          {steps.map((step, index) => (
            <motion.article key={step.label} variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.6, delay: index * 0.12 }} className="group relative rounded-[24px] border border-white/[0.08] bg-white/[0.025] p-6 transition duration-500 hover:-translate-y-1 hover:border-cyan-300/25 hover:bg-white/[0.045]">
              <div className="relative z-10 mb-8 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-[#0b1929] text-cyan-200 shadow-xl transition duration-500 group-hover:rotate-[-5deg] group-hover:scale-110"><step.icon className="h-6 w-6" /></div>
              <span className="absolute right-6 top-6 font-mono text-xs text-slate-700">0{index + 1}</span>
              <h3 className="text-lg font-black tracking-tight text-white">{step.label}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{step.text}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <motion.div variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.7 }} className="max-w-3xl">
      <p className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">{eyebrow}</p>
      <h2 className="text-4xl font-black leading-[1.02] tracking-[-0.05em] text-white sm:text-5xl lg:text-6xl">{title}</h2>
      <p className="mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">{text}</p>
    </motion.div>
  );
}

function FeatureGrid() {
  const features = [
    { icon: FileText, title: 'Структурный конспект', text: 'Основные идеи, термины и выводы без ручной разметки.', tone: 'cyan' },
    { icon: Brain, title: 'Карточки для повторения', text: 'Вопросы по материалу остаются рядом с источником.', tone: 'violet' },
    { icon: MessageCircle, title: 'Устный экзамен', text: 'Профессор задаёт открытые вопросы и разбирает ответ.', tone: 'amber' },
    { icon: Headphones, title: 'Сценарий подкаста', text: 'Материал превращается в диалог двух ведущих.', tone: 'rose' },
    { icon: CalendarDays, title: 'План подготовки', text: 'Темы распределяются по дням до экзамена.', tone: 'emerald' },
    { icon: Network, title: 'Карта знаний', text: 'Материалы собираются в связанную учебную картину.', tone: 'blue' },
  ];

  return (
    <section id="possibilities" className="relative px-5 py-28 sm:px-8">
      <div className="absolute inset-x-0 top-0 mx-auto h-px max-w-6xl bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="Работайте с темой по-разному" title="Один источник. Шесть учебных инструментов." text="Переключайтесь между чтением, активным вспоминанием, проверкой и планированием — без потери контекста." />
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <motion.article key={feature.title} variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }} transition={{ duration: 0.55, delay: (index % 3) * 0.08 }} className={`landing-feature-card landing-tone-${feature.tone} group`}>
              <div className="landing-feature-icon"><feature.icon className="h-5 w-5" /></div>
              <h3 className="mt-8 text-lg font-black tracking-tight text-white">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-500">{feature.text}</p>
              <div className="mt-7 flex items-center gap-1 text-xs font-bold text-slate-600 transition group-hover:gap-2 group-hover:text-white">Подробнее <ChevronRight className="h-3.5 w-3.5" /></div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function MethodSection() {
  return (
    <section id="method" className="px-5 py-28 sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-14 rounded-[32px] border border-white/[0.08] bg-gradient-to-br from-white/[0.05] to-transparent p-7 sm:p-12 lg:grid-cols-[0.9fr_1.1fr] lg:p-16">
        <motion.div variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true }} transition={{ duration: 0.7 }}>
          <div className="mb-8 flex -space-x-2">
            {[Brain, BookOpen, Zap].map((Icon, index) => <span key={index} className="grid h-11 w-11 place-items-center rounded-full border-2 border-[#0b1726] bg-gradient-to-br from-cyan-200 to-violet-400 text-slate-950"><Icon className="h-4 w-4" /></span>)}
          </div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Не только генерация</p>
          <h2 className="mt-4 text-4xl font-black leading-[1.04] tracking-[-0.05em] text-white sm:text-5xl">Материал должен стать знанием.</h2>
          <p className="mt-6 text-base leading-7 text-slate-400">Поэтому после конспекта начинается активная работа: карточки, вопросы, разбор ошибок и повторение.</p>
        </motion.div>

        <motion.div variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.15 }} className="relative">
          <div className="absolute -left-6 top-4 hidden h-[calc(100%-2rem)] w-px bg-gradient-to-b from-cyan-300/50 via-violet-300/30 to-transparent lg:block" />
          <Quote className="h-8 w-8 text-cyan-300/50" />
          <blockquote className="mt-5 text-xl font-bold leading-9 tracking-tight text-slate-200 sm:text-2xl sm:leading-10">Не перечитывайте один и тот же текст. Сначала разберите его, затем попробуйте восстановить главное без подсказки.</blockquote>
          <div className="mt-8 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-4"><p className="text-xs font-black text-cyan-200">Active recall</p><p className="mt-2 text-xs leading-5 text-slate-500">Ответ до просмотра подсказки</p></div>
            <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-4"><p className="text-xs font-black text-violet-200">Повторение</p><p className="mt-2 text-xs leading-5 text-slate-500">Возврат к карточкам по сроку</p></div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function FinalCall() {
  const navigate = useNavigate();
  return (
    <section className="px-5 py-28 sm:px-8">
      <motion.div variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.35 }} transition={{ duration: 0.75 }} className="landing-final-call relative mx-auto max-w-6xl overflow-hidden rounded-[36px] px-6 py-20 text-center sm:px-12 sm:py-24">
        <div className="landing-grid absolute inset-0 opacity-20" />
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 28, repeat: Infinity, ease: 'linear' }} className="absolute -right-28 -top-28 h-64 w-64 rounded-[40%] border border-cyan-200/20" />
        <div className="relative mx-auto max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">Попробуйте на своём материале</p>
          <h2 className="mt-5 text-4xl font-black leading-[0.98] tracking-[-0.055em] text-white sm:text-6xl">Превратите следующую лекцию в план действий.</h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-cyan-50/65">Создайте аккаунт, загрузите файл и выберите, как хотите изучить тему.</p>
          <button className="mt-9 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-4 text-sm font-black text-slate-950 shadow-2xl transition hover:-translate-y-1 hover:bg-cyan-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-200/40" onClick={() => navigate('/register')}>
            Начать бесплатно <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.07] px-5 py-8 text-sm text-slate-600 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-300 text-slate-950"><GraduationCap className="h-4 w-4" /></span><span className="font-black tracking-tight text-white">StudyForge</span></div>
        <span className="text-xs">© {new Date().getFullYear()} StudyForge</span>
        <a href="#" className="flex items-center gap-1 text-xs transition hover:text-white"><MousePointer2 className="h-3.5 w-3.5" /> Наверх</a>
      </div>
    </footer>
  );
}
