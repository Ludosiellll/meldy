import { useState, useEffect } from 'react';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getProfile, markOnboardingTourSeen } from '../api/social';
import { supabase } from '../lib/supabase';
import { Bot, Sparkles, BookOpen, MessageSquare, GraduationCap, Zap, Award } from 'lucide-react';

// ──────────────────────────────────────────────
// DESKTOP STEPS — нацелены на элементы сайдбара
// ──────────────────────────────────────────────
const DESKTOP_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <Bot className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-slate-900 dark:text-slate-100 tracking-tight">Привет! Я Форджи</h3>
            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Твой AI-наставник</span>
          </div>
        </div>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Покажу ключевые фичи StudyForge — займёт меньше минуты. Учёба станет значительно продуктивнее!
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-desktop-upload',
    placement: 'right',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Zap className="w-4 h-4 text-indigo-500" /> Добавить материал
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Перетащи PDF, конспект или аудиозапись — ИИ за минуту создаст краткое изложение, умные карточки и тест!
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-desktop-library',
    placement: 'right',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-indigo-500" /> Библиотека
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Все загруженные материалы, конспекты и аудиоподкасты хранятся здесь — в одном удобном месте.
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-desktop-chat',
    placement: 'right',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-indigo-500" /> Чат-наставник
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Непонятна тема? Пиши мне — объясню любой вопрос простыми словами с примерами.
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-desktop-exam',
    placement: 'right',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Award className="w-4 h-4 text-amber-500" /> Устный экзамен
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          ИИ-Профессор задаёт вопросы по твоим конспектам. Отвечай голосом или текстом — и получи честную оценку.
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-desktop-gradebook',
    placement: 'right',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-500" /> Аналитика и оценки
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Загрузи фото бумажного дневника — Smart Scan распознает оценки. Видишь прогресс по всем предметам сразу.
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-desktop-xp',
    placement: 'right',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Твой уровень и XP</h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          За каждое действие зарабатываешь XP. Выполняй ежедневные квесты, повышай уровень и обгоняй одногруппников!
        </p>
      </div>
    ),
  },
];

// ──────────────────────────────────────────────────────────────────────
// MOBILE STEPS — только нижний навбар + элементы главного экрана
// ──────────────────────────────────────────────────────────────────────
const MOBILE_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <Bot className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100 tracking-tight">Привет! Я Форджи</h3>
            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">AI-наставник</span>
          </div>
        </div>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Покажу главные кнопки — займёт 30 секунд!
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-mobile-xp',
    placement: 'bottom',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Твой уровень и XP</h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          За каждое действие зарабатываешь XP. Учись активнее — повышай уровень!
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-mobile-library',
    placement: 'top',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-indigo-500" /> Материалы
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Все твои лекции и конспекты. Загружай PDF или аудио — ИИ создаст карточки и тест автоматически.
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-mobile-chat',
    placement: 'top',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-indigo-500" /> Чат с ИИ
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Непонятна тема? Пиши — объясню простыми словами с примерами, как репетитор.
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-mobile-gradebook',
    placement: 'top',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <GraduationCap className="w-4 h-4 text-amber-500" /> Оценки
        </h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Загрузи фото дневника — Smart Scan распознает оценки. Аналитика успеваемости по всем предметам!
        </p>
      </div>
    ),
  },
];

// Шаги второго тура (после первой загрузки материала) — одинаково для всех экранов
const EXAM_STEPS_DESKTOP: Step[] = [
  {
    target: 'body',
    placement: 'center',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <Bot className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100 tracking-tight">Материалы готовы!</h3>
            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">ИИ-Экзаменатор</span>
          </div>
        </div>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium pt-1">
          Теперь тебе доступен интерактивный устный экзамен с ИИ-профессором!
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-desktop-exam',
    placement: 'right',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Симуляция экзамена</h4>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium">
          Нажми, чтобы запустить экзаменатора. Отвечай голосом или текстом — профессор оценит твои знания.
        </p>
      </div>
    ),
  },
];

const EXAM_STEPS_MOBILE: Step[] = [
  {
    target: 'body',
    placement: 'center',
    disableBeacon: true,
    content: (
      <div className="text-left space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <Bot className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100 tracking-tight">Материалы готовы!</h3>
            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">ИИ-Экзаменатор</span>
          </div>
        </div>
        <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed font-medium pt-1">
          Теперь тебе доступен устный экзамен с ИИ-профессором! Найди его в разделе «Практика» в боковом меню.
        </p>
      </div>
    ),
  },
];

export default function OnboardingManager() {
  const { user } = useAuth();
  const location = useLocation();
  const [steps, setSteps] = useState<Step[]>([]);
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(checkTours, 1200);
    return () => clearTimeout(timer);
  }, [user?.id, location.pathname]);

  const checkTours = async () => {
    if (!user) return;
    const profile = await getProfile(user.id);
    if (!profile) return;
    const status = profile.onboarding_status || {};
    const isMobile = window.innerWidth < 768;

    if (location.pathname !== '/dashboard') return;

    if (!status['dashboard_tour']) {
      const tourSteps = isMobile ? MOBILE_STEPS : DESKTOP_STEPS;
      // Verify the second target exists in DOM before starting
      const secondTarget = tourSteps[1]?.target as string;
      if (secondTarget === 'body' || document.querySelector(secondTarget)) {
        setSteps(tourSteps);
        markOnboardingTourSeen(user.id, 'dashboard_tour');
        setTimeout(() => setRun(true), 100);
      }
    } else if (
      status['dashboard_tour'] &&
      !status['exam_tour'] &&
      profile.total_materials > 0
    ) {
      const tourSteps = isMobile ? EXAM_STEPS_MOBILE : EXAM_STEPS_DESKTOP;
      const secondTarget = tourSteps[1]?.target as string;
      const targetExists = !secondTarget || secondTarget === 'body' || document.querySelector(secondTarget);
      if (targetExists) {
        setSteps(tourSteps);
        markOnboardingTourSeen(user.id, 'exam_tour');
        setTimeout(() => setRun(true), 100);
      }
    }
  };

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, type, step } = data;

    if (type === 'step:before' && step.target !== 'body') {
      setTimeout(() => {
        const el = document.querySelector(step.target as string);
        if (el) {
          const isInSidebar = el.closest('aside') !== null;
          if (isInSidebar) {
            el.closest('aside')?.scrollTo({ top: (el as HTMLElement).offsetTop - 80, behavior: 'smooth' });
          } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 50);
    }

    if (status === STATUS.SKIPPED) {
      setRun(false);
      if (user) {
        getProfile(user.id).then(p => {
          if (!p) return;
          const next = { ...(p.onboarding_status || {}), dashboard_tour: true, exam_tour: true, skipped_all: true };
          supabase.from('profiles').update({ onboarding_status: next }).eq('id', user.id);
        });
      }
    } else if (status === STATUS.FINISHED) {
      setRun(false);
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <Joyride
      callback={handleJoyrideCallback}
      continuous
      disableScrolling={false}
      scrollToFirstStep
      scrollOffset={100}
      hideCloseButton
      run={run}
      showProgress
      showSkipButton
      steps={steps}
      disableOverlayClose={false}
      spotlightPadding={6}
      styles={{
        options: {
          zIndex: 10000,
          primaryColor: '#4f46e5',
          textColor: document.documentElement.classList.contains('dark') ? '#f1f5f9' : '#0f172a',
          backgroundColor: document.documentElement.classList.contains('dark') ? '#1e293b' : '#ffffff',
          overlayColor: 'rgba(0,0,0,0.45)',
        },
        tooltip: {
          borderRadius: '20px',
          padding: isMobile ? '16px' : '20px',
          boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.15), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
          border: document.documentElement.classList.contains('dark') ? '1px solid #334155' : '1px solid #f1f5f9',
          maxWidth: isMobile ? 'min(300px, calc(100vw - 32px))' : '360px',
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        buttonNext: {
          backgroundColor: '#4f46e5',
          borderRadius: '10px',
          fontWeight: 'bold',
          fontSize: '13px',
          padding: '7px 14px',
          outline: 'none',
          border: 'none',
        },
        buttonBack: {
          marginRight: 8,
          color: '#64748b',
          fontWeight: 'bold',
          fontSize: '13px',
          outline: 'none',
          border: 'none',
        },
        buttonSkip: {
          color: '#94a3b8',
          fontWeight: 'bold',
          fontSize: '12px',
          outline: 'none',
          border: 'none',
        },
      }}
      locale={{
        back: 'Назад',
        close: 'Закрыть',
        last: 'Понятно! 🎉',
        next: 'Далее →',
        skip: 'Пропустить',
      }}
    />
  );
}
