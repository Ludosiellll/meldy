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
    <div className="landing-shell min-h-screen overflow-hidden selection:bg-blue-100 selection:text-slate-950">
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
    <nav className="landing-nav fixed inset-x-0 top-0 z-50 overflow-hidden border-b backdrop-blur-lg">
      <div className="mx-auto flex h-[72px] min-w-0 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-8 lg:px-12">
        <button className="group flex min-w-0 shrink items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => navigate('/')}>
          <span className="landing-mark relative grid h-9 w-9 place-items-center overflow-hidden rounded-lg">
            <GraduationCap className="relative h-5 w-5" />
          </span>
          <span className="landing-logo-text truncate text-lg font-semibold tracking-[-0.04em]">StudyForge</span>
        </button>

        <div className="landing-nav-links hidden items-center gap-8 text-sm font-medium md:flex">
          <a className="transition hover:text-white" href="#process">Как это работает</a>
          <a className="transition hover:text-white" href="#possibilities">Возможности</a>
          <a className="transition hover:text-white" href="#method">Подход</a>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button className="landing-login hidden rounded-full px-4 py-2.5 text-sm font-medium transition sm:block" onClick={() => navigate('/login')}>
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
    <section id="process" className="landing-section relative px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="Один материал — несколько способов учиться" title="От загрузки до повторения — в одном потоке" text="Не нужно переносить текст между сервисами. Результаты остаются рядом с исходным материалом." />
        <div className="relative mt-16 grid gap-4 md:grid-cols-3">
          <div className="landing-process-line absolute left-[16%] right-[16%] top-11 hidden h-px md:block" />
          {steps.map(step => (
            <motion.article key={step.label} variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.4 }} className="landing-step-card group relative p-6">
              <div className="landing-step-icon relative z-10 mb-7 grid h-12 w-12 place-items-center rounded-xl"><step.icon className="h-5 w-5" /></div>
              <h3 className="text-lg font-semibold tracking-tight">{step.label}</h3>
              <p className="landing-copy mt-2 text-sm leading-6">{step.text}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <motion.div variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.4 }} className="max-w-3xl">
      <p className="landing-eyebrow mb-3 text-xs font-semibold">{eyebrow}</p>
      <h2 className="landing-section-title text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl">{title}</h2>
      <p className="landing-copy mt-5 max-w-2xl text-base leading-7 sm:text-lg">{text}</p>
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
    <section id="possibilities" className="landing-section relative px-5 py-24 sm:px-8">
      <div className="landing-section-rule absolute inset-x-0 top-0 mx-auto h-px max-w-6xl" />
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="Работайте с темой по-разному" title="Один источник. Шесть учебных инструментов." text="Переключайтесь между чтением, активным вспоминанием, проверкой и планированием — без потери контекста." />
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <motion.article key={feature.title} variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.25 }} transition={{ duration: 0.35, delay: (index % 3) * 0.05 }} className="landing-feature-card group">
              <div className="landing-feature-icon"><feature.icon className="h-5 w-5" /></div>
              <h3 className="mt-6 text-lg font-semibold tracking-tight">{feature.title}</h3>
              <p className="landing-copy mt-2 text-sm leading-6">{feature.text}</p>
              <div className="landing-feature-more mt-5 flex items-center gap-1 text-xs font-medium">Возможность приложения <ChevronRight className="h-3.5 w-3.5" /></div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function MethodSection() {
  return (
    <section id="method" className="landing-section px-5 py-24 sm:px-8">
      <div className="landing-method-panel mx-auto grid max-w-6xl gap-12 p-7 sm:p-12 lg:grid-cols-[0.9fr_1.1fr] lg:p-14">
        <motion.div variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true }} transition={{ duration: 0.7 }}>
          <div className="mb-7 flex -space-x-2">
            {[Brain, BookOpen, Zap].map((Icon, index) => <span key={index} className="landing-method-icon grid h-10 w-10 place-items-center rounded-full"><Icon className="h-4 w-4" /></span>)}
          </div>
          <p className="landing-eyebrow text-xs font-semibold">Как устроено обучение</p>
          <h2 className="landing-section-title mt-3 text-4xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-5xl">Материал должен стать знанием.</h2>
          <p className="landing-copy mt-5 text-base leading-7">После конспекта можно перейти к карточкам, вопросам, разбору ошибок и повторению.</p>
        </motion.div>

        <motion.div variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.15 }} className="relative">
          <div className="landing-method-rule absolute -left-6 top-4 hidden h-[calc(100%-2rem)] w-px lg:block" />
          <Quote className="h-7 w-7 text-[var(--sf-accent)]" />
          <blockquote className="mt-5 text-xl font-medium leading-8 tracking-tight sm:text-2xl sm:leading-9">Сначала разберитесь в теме. Затем закройте конспект и попробуйте объяснить главное своими словами.</blockquote>
          <div className="mt-8 grid grid-cols-2 gap-3">
            <div className="landing-method-note rounded-xl border p-4"><p className="text-xs font-semibold">Вспоминание</p><p className="landing-copy mt-2 text-xs leading-5">Сначала ответьте без подсказки.</p></div>
            <div className="landing-method-note rounded-xl border p-4"><p className="text-xs font-semibold">Повторение</p><p className="landing-copy mt-2 text-xs leading-5">Возвращайтесь к карточкам позже.</p></div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function FinalCall() {
  const navigate = useNavigate();
  return (
    <section className="landing-section px-5 py-20 sm:px-8">
      <motion.div variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.35 }} transition={{ duration: 0.4 }} className="landing-final-call relative mx-auto max-w-6xl px-6 py-16 text-center sm:px-12 sm:py-20">
        <div className="relative mx-auto max-w-3xl">
          <p className="landing-eyebrow text-xs font-semibold">Начните с одного материала</p>
          <h2 className="landing-section-title mt-4 text-4xl font-semibold leading-[1.04] tracking-[-0.045em] sm:text-5xl">Подготовьтесь к следующей теме увереннее.</h2>
          <p className="landing-copy mx-auto mt-5 max-w-xl text-base leading-7">Загрузите файл и выберите удобный способ изучения.</p>
          <button className="landing-button-primary mt-8 px-7 py-3.5 text-sm" onClick={() => navigate('/register')}>
            Создать аккаунт <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="landing-footer border-t px-5 py-7 text-sm sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5"><span className="landing-mark grid h-8 w-8 place-items-center rounded-lg"><GraduationCap className="h-4 w-4" /></span><span className="font-semibold tracking-tight">StudyForge</span></div>
        <span className="landing-copy text-xs">© {new Date().getFullYear()} StudyForge</span>
        <a href="#" className="landing-footer-link flex items-center gap-1 text-xs transition"><MousePointer2 className="h-3.5 w-3.5" /> Наверх</a>
      </div>
    </footer>
  );
}
