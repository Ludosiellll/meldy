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
import LandingHero from '../components/LandingHero';

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
        <LandingHero />
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
    <nav className="fixed inset-x-0 top-0 z-50 overflow-hidden border-b border-white/[0.07] bg-[#07111f]/70 backdrop-blur-2xl">
      <div className="mx-auto flex h-[72px] min-w-0 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-8 lg:px-12">
        <button className="group flex min-w-0 shrink items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" onClick={() => navigate('/')}>
          <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-cyan-300/30 bg-cyan-300/10">
            <span className="absolute inset-0 translate-y-full bg-cyan-300 transition-transform duration-300 group-hover:translate-y-0" />
            <GraduationCap className="relative h-5 w-5 text-cyan-200 transition-colors group-hover:text-slate-950" />
          </span>
          <span className="landing-logo-text truncate text-lg font-black tracking-[-0.04em] text-white">StudyForge</span>
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
          <button className="landing-nav-cta landing-button-primary shrink-0 px-3 py-2.5 text-[11px] sm:px-5 sm:text-sm" onClick={() => navigate('/register')}>
            Попробовать
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );
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
