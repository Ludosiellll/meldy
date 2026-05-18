import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { GraduationCap, Zap, Brain, Calendar, BookOpen,
         MessageSquare, BarChart2, Sparkles, ArrowRight,
         CheckCircle, Upload, Cpu, Trophy } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  useEffect(() => { if (user) navigate('/dashboard'); }, [user]);

  return (
    <div className="min-h-screen bg-[#080c14] text-white overflow-x-hidden">
      <Navbar />
      <Hero />
      <Stats />
      <HowItWorks />
      <Features />
      <CtaSection />
      <Footer />
    </div>
  );
}

function Navbar() {
  const navigate = useNavigate();
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center
      justify-between px-6 md:px-12 py-4
      bg-[#080c14]/80 backdrop-blur-xl border-b border-white/[0.06]">

      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <GraduationCap className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-white text-lg">StudyForge</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/login')}
          className="text-sm text-slate-400 hover:text-white transition px-3 py-2">
          Войти
        </button>
        <button onClick={() => navigate('/register')}
          className="text-sm font-semibold px-4 py-2 bg-indigo-600
            hover:bg-indigo-500 text-white rounded-lg transition">
          Начать бесплатно
        </button>
      </div>
    </nav>
  );
}

function Hero() {
  const navigate = useNavigate();
  return (
    <section className="pt-36 pb-20 px-6 text-center relative">

      {/* Фоновый glow */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[300px]
        bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none" />

      {/* Заголовок */}
      <h1 className="text-5xl md:text-[72px] font-black leading-[1.05]
        tracking-tight mb-6 max-w-4xl mx-auto">
        <span className="text-white">Превращай лекции</span>
        <br />
        <span className="bg-gradient-to-r from-indigo-400 via-purple-400
          to-indigo-300 bg-clip-text text-transparent">
          в знания за секунды
        </span>
      </h1>

      {/* Подзаголовок */}
      <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto
        mb-10 leading-relaxed">
        Загрузи PDF или текст лекции — три AI-агента параллельно создадут
        конспект, карточки и тест. Повторяй по алгоритму spaced repetition
        и планируй подготовку к экзаменам.
      </p>

      {/* CTA кнопки */}
      <div className="flex items-center justify-center gap-4 flex-wrap">
        <button onClick={() => navigate('/register')}
          className="group flex items-center gap-2 px-8 py-4 bg-indigo-600
            hover:bg-indigo-500 text-white font-bold text-base rounded-xl
            transition shadow-2xl shadow-indigo-500/30 hover:shadow-indigo-500/50">
          Начать бесплатно
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
        </button>
        <button onClick={() => navigate('/analyze')}
          className="flex items-center gap-2 px-8 py-4 bg-white/[0.06]
            hover:bg-white/[0.1] border border-white/[0.1]
            hover:border-white/20 text-white font-bold text-base
            rounded-xl transition">
          <Zap className="w-4 h-4 text-indigo-400" />
          Попробовать демо
        </button>
      </div>

      {/* Мок интерфейса */}
      <div className="mt-16 max-w-4xl mx-auto relative">
        {/* Внешний glow */}
        <div className="absolute inset-0 bg-indigo-600/10 rounded-2xl
          blur-xl scale-105 pointer-events-none" />

        {/* Фейковый интерфейс приложения */}
        <div className="relative bg-[#0f1623] border border-white/[0.08]
          rounded-2xl overflow-hidden shadow-2xl">

          {/* Топбар мока */}
          <div className="flex items-center gap-2 px-4 py-3
            border-b border-white/[0.06] bg-[#0d1420]">
            <div className="w-3 h-3 rounded-full bg-rose-500/70" />
            <div className="w-3 h-3 rounded-full bg-amber-500/70" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
            <div className="flex-1 mx-4 h-5 bg-white/[0.04] rounded-md" />
          </div>

          {/* Контент мока — три агента */}
          <div className="p-6 grid grid-cols-3 gap-4">
            {[
              { name: 'Конспект', icon: '📝', color: 'indigo', done: true },
              { name: 'Карточки', icon: '🃏', color: 'emerald', done: true },
              { name: 'Тест', icon: '✅', color: 'amber', done: false },
            ].map((agent, i) => (
              <div key={i} className="bg-white/[0.03] border border-white/[0.06]
                rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-lg">{agent.icon}</span>
                  {agent.done
                    ? <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    : <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  }
                </div>
                <p className="text-white text-sm font-medium mb-2">{agent.name}</p>
                <div className="space-y-1.5">
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${
                      agent.done
                        ? 'bg-emerald-500 w-full'
                        : 'bg-amber-400 w-3/4 animate-pulse'
                    }`} />
                  </div>
                  <div className="h-2 bg-white/[0.06] rounded-full w-3/4" />
                  <div className="h-2 bg-white/[0.04] rounded-full w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const items = [
    { value: '15 сек', label: 'среднее время анализа' },
    { value: '3', label: 'AI-агента работают параллельно' },
    { value: 'SM-2', label: 'алгоритм повторения как в Anki' },
    { value: '∞', label: 'материалов в библиотеке' },
  ];
  return (
    <section className="py-16 px-6 border-y border-white/[0.06]
      bg-white/[0.02]">
      <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        {items.map((s, i) => (
          <div key={i} className="text-center">
            <p className="text-3xl font-black text-white mb-1">{s.value}</p>
            <p className="text-slate-500 text-sm">{s.label}</p>
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
      title: 'Загрузи материал',
      desc: 'PDF, DOCX, TXT или MD. Просто перетащи файл — размер до 50 МБ.',
    },
    {
      icon: Cpu,
      num: '02',
      title: 'AI обрабатывает',
      desc: 'Три агента параллельно создают конспект, карточки и тест. Занимает 15–30 секунд.',
    },
    {
      icon: Trophy,
      num: '03',
      title: 'Учись и повторяй',
      desc: 'Используй карточки с алгоритмом spaced repetition и AI-чат для вопросов по материалу.',
    },
  ];
  return (
    <section className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">
            Как это работает
          </h2>
          <p className="text-slate-500 text-lg">Три шага от лекции до знаний</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Линия между шагами */}
          <div className="hidden md:block absolute top-8 left-1/6 right-1/6
            h-px bg-gradient-to-r from-transparent via-indigo-500/40
            to-transparent" />
          {steps.map((step, i) => (
            <div key={i} className="relative text-center md:text-left">
              <div className="flex md:flex-col items-center md:items-start
                gap-4 md:gap-0">
                <div className="relative mb-0 md:mb-6">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-950/80
                    border border-indigo-800/50 flex items-center
                    justify-center shrink-0">
                    <step.icon className="w-7 h-7 text-indigo-400" />
                  </div>
                  <span className="absolute -top-2 -right-2 text-xs
                    font-black text-indigo-400 bg-[#080c14]
                    border border-indigo-800/50 rounded-full
                    w-6 h-6 flex items-center justify-center">
                    {i + 1}
                  </span>
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg mb-2">
                    {step.title}
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </div>
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
      title: 'Мультиагентный анализ',
      desc: 'Три AI-агента работают параллельно и создают конспект, карточки и тест одновременно.',
    },
    {
      icon: Brain,
      color: 'emerald',
      title: 'Spaced Repetition',
      desc: 'Алгоритм SM-2 как в Anki определяет когда показать карточку для оптимального запоминания.',
    },
    {
      icon: Calendar,
      color: 'amber',
      title: 'AI-планировщик',
      desc: 'Введи предметы и даты экзаменов — AI составит конкретный план подготовки на каждый день.',
    },
    {
      icon: BookOpen,
      color: 'purple',
      title: 'Библиотека знаний',
      desc: 'Все материалы хранятся в облаке. Поиск по содержимому, фильтр по предметам.',
    },
    {
      icon: MessageSquare,
      color: 'sky',
      title: 'AI-чат по лекции',
      desc: 'Задавай вопросы по любому материалу из библиотеки. AI отвечает строго по теме.',
    },
    {
      icon: BarChart2,
      color: 'rose',
      title: 'Аналитика прогресса',
      desc: 'Streak учёбы, графики активности, статистика правильных ответов по предметам.',
    },
  ];

  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };

  return (
    <section className="py-24 px-6 bg-white/[0.02] border-t border-white/[0.06]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">
            Всё для эффективной учёбы
          </h2>
          <p className="text-slate-500 text-lg max-w-xl mx-auto">
            Платформа объединяет лучшие инструменты для студентов в одном месте
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div key={i}
              className="group p-6 rounded-2xl bg-white/[0.03]
                border border-white/[0.06] hover:border-white/[0.12]
                hover:bg-white/[0.05] transition-all duration-300">
              <div className={`w-10 h-10 rounded-xl border flex items-center
                justify-center mb-4 ${colorMap[f.color]}`}>
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="text-white font-bold text-base mb-2">{f.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  const navigate = useNavigate();
  return (
    <section className="py-24 px-6">
      <div className="max-w-3xl mx-auto text-center relative">
        <div className="absolute inset-0 bg-indigo-600/10 rounded-3xl
          blur-3xl pointer-events-none" />
        <div className="relative bg-gradient-to-b from-indigo-950/50
          to-slate-900/30 border border-indigo-800/30 rounded-3xl p-12">
          <div className="flex justify-center gap-2 mb-6">
            {['✓ Бесплатно', '✓ Без привязки карты', '✓ Все функции сразу'].map(t => (
              <span key={t}
                className="text-xs text-indigo-300 bg-indigo-950/60
                  border border-indigo-800/50 px-3 py-1 rounded-full">
                {t}
              </span>
            ))}
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">
            Готов учиться умнее?
          </h2>
          <p className="text-slate-400 text-lg mb-8">
            Зарегистрируйся и загрузи первую лекцию прямо сейчас
          </p>
          <button onClick={() => navigate('/register')}
            className="group inline-flex items-center gap-2 px-10 py-4
              bg-indigo-600 hover:bg-indigo-500 text-white font-bold
              text-lg rounded-xl transition shadow-2xl
              shadow-indigo-500/30">
            Начать бесплатно
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition" />
          </button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-8 px-6 border-t border-white/[0.06]">
      <div className="max-w-5xl mx-auto flex items-center
        justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-indigo-600 rounded-md flex
            items-center justify-center">
            <GraduationCap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-slate-400 text-sm font-medium">StudyForge</span>
        </div>
        <p className="text-slate-600 text-sm">
          © 2025 StudyForge
        </p>
      </div>
    </footer>
  );
}
