import { useState, useEffect } from 'react';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getProfile, markOnboardingTourSeen } from '../api/social';
import { Bot, Sparkles } from 'lucide-react';

const DASHBOARD_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    content: (
      <div className="text-left space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <Bot className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-slate-900 tracking-tight">Привет! Я Форджи 🤖</h3>
            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Твой AI-наставник</span>
          </div>
        </div>
        <p className="text-slate-600 text-xs leading-relaxed font-medium pt-2">
          Я помогу тебе освоить платформу StudyForge. Давай я быстро покажу ключевые фичи, чтобы твоя учёба стала проще и продуктивнее!
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-upload',
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          Загрузка материалов ⚡
        </h4>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          Сюда ты перетаскиваешь лекции, PDF-книги или аудиозаписи. Я сам составлю конспект, карточки для запоминания и подготовлю тесты!
        </p>
      </div>
    ),
    placement: 'bottom',
  },
  {
    target: '.tour-step-library',
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900">Твоя библиотека 📚</h4>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          Все твои загруженные материалы, лекции, тесты и аудиоподкасты будут бережно храниться здесь.
        </p>
      </div>
    ),
    placement: 'right',
  },
  {
    target: '.tour-step-chat',
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900">Чат-наставник 💬</h4>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          Если что-то непонятно в конспекте лекции — просто напиши мне сюда. Я объясню любую тему простыми словами и приведу примеры!
        </p>
      </div>
    ),
    placement: 'right',
  },
  {
    target: '.tour-step-xp',
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900">Твой уровень и XP 🏆</h4>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          За каждое полезное действие (повторил карточку, сдал тест) ты получаешь XP. Выполняй квесты дня и недели, повышай уровень и обгоняй одногруппников!
        </p>
      </div>
    ),
    placement: 'bottom',
  }
];

const EXAM_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    content: (
      <div className="text-left space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <Bot className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-slate-900 tracking-tight">Первые лекции готовы! 🎓</h3>
            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">ИИ-Экзаменатор</span>
          </div>
        </div>
        <p className="text-slate-600 text-xs leading-relaxed font-medium pt-2">
          Вижу, ты добавил первые учебные материалы. Теперь тебе доступен интерактивный устный экзамен!
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-exam',
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900">Симуляция экзамена 🏆</h4>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          Нажми сюда, чтобы запустить экзаменатора. Ты сможешь отвечать на вопросы голосом или текстом, а профессор оценит твои знания.
        </p>
      </div>
    ),
    placement: 'right',
  }
];

const CLASS_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    content: (
      <div className="text-left space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <Bot className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-slate-900 tracking-tight">Твой учебный класс! 👥</h3>
            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest">Совместное обучение</span>
          </div>
        </div>
        <p className="text-slate-600 text-xs leading-relaxed font-medium pt-2">
          Здесь происходит управление совместным обучением. Давай я помогу тебе разобраться!
        </p>
      </div>
    ),
  },
  {
    target: '.tour-step-role-toggle',
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900">Смена роли (Студент / Учитель) 🔄</h4>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          Ты можешь переключаться между ролями прямо здесь или на Дашборде. Роль преподавателя позволяет создавать свои классы и давать задания.
        </p>
      </div>
    ),
    placement: 'bottom',
  },
  {
    target: '.tour-step-invite',
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900">Код приглашения 🔑</h4>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          Скопируйте этот код и передайте студентам. Они смогут присоединиться к классу со своих аккаунтов.
        </p>
      </div>
    ),
    placement: 'bottom',
  },
  {
    target: '.tour-step-leaderboard',
    content: (
      <div className="text-left space-y-1">
        <h4 className="font-bold text-sm text-slate-900">Рейтинг класса 📊</h4>
        <p className="text-slate-600 text-xs leading-relaxed font-medium">
          Следи за успехами одноклассников. Лидерборд автоматически ранжирует участников по XP за все время и за последние 7 дней!
        </p>
      </div>
    ),
    placement: 'top',
  }
];

export default function OnboardingManager() {
  const { user } = useAuth();
  const location = useLocation();
  const [steps, setSteps] = useState<Step[]>([]);
  const [run, setRun] = useState(false);
  const [tourKey, setTourKey] = useState('');

  useEffect(() => {
    if (!user) return;
    
    const timer = setTimeout(() => {
      checkTours();
    }, 1000);

    return () => clearTimeout(timer);
  }, [user, location.pathname]);

  const checkTours = async () => {
    if (!user) return;
    const profile = await getProfile(user.id);
    if (!profile) return;
    const status = profile.onboarding_status || {};

    const isMobile = window.innerWidth < 768;
    const mapStep = (s: Step) => ({
      ...s,
      target: isMobile 
        ? (s.target as string).replace('.tour-step-', '.tour-step-mobile-')
        : (s.target as string).replace('.tour-step-', '.tour-step-desktop-'),
      placement: isMobile && s.placement === 'right' ? 'bottom' : s.placement,
    });

    if (location.pathname === '/dashboard' && !status['dashboard_tour']) {
      const mappedSteps = DASHBOARD_STEPS.map(mapStep);
      // Wait for DOM
      setTimeout(() => {
        if (document.querySelector(mappedSteps[1].target as string)) {
          setSteps(mappedSteps);
          setTourKey('dashboard_tour');
          markOnboardingTourSeen(user.id, 'dashboard_tour');
          setRun(true);
        }
      }, 100);
    } else if (location.pathname === '/dashboard' && status['dashboard_tour'] && profile.total_materials > 0 && !status['exam_tour']) {
      const mappedSteps = EXAM_STEPS.map(mapStep);
      setTimeout(() => {
        if (document.querySelector(mappedSteps[1].target as string)) {
          setSteps(mappedSteps);
          setTourKey('exam_tour');
          markOnboardingTourSeen(user.id, 'exam_tour');
          setRun(true);
        }
      }, 100);
    } else if ((location.pathname === '/teacher' || location.pathname === '/groups') && !status['class_tour']) {
      const mappedSteps = CLASS_STEPS.map(mapStep);
      setTimeout(() => {
        if (document.querySelector('.tour-step-role-toggle')) {
          setSteps(mappedSteps);
          setTourKey('class_tour');
          markOnboardingTourSeen(user.id, 'class_tour');
          setRun(true);
        }
      }, 100);
    }
  };

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
    
    if (finishedStatuses.includes(status)) {
      setRun(false);
    }
  };

  return (
    <Joyride
      callback={handleJoyrideCallback}
      continuous
      hideCloseButton
      run={run}
      scrollToFirstStep
      showProgress
      showSkipButton
      steps={steps}
      styles={{
        options: {
          zIndex: 10000,
          primaryColor: '#4f46e5',
          textColor: '#0f172a',
          backgroundColor: '#ffffff',
        },
        tooltip: {
          borderRadius: '24px',
          padding: '20px',
          boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
          border: '1px solid #f1f5f9',
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        buttonNext: {
          backgroundColor: '#4f46e5',
          borderRadius: '12px',
          fontWeight: 'bold',
          padding: '8px 16px',
        },
        buttonBack: {
          marginRight: 10,
          color: '#64748b',
          fontWeight: 'bold',
        },
        buttonSkip: {
          color: '#94a3b8',
          fontWeight: 'bold',
        }
      }}
      locale={{
        back: 'Назад',
        close: 'Закрыть',
        last: 'Понятно!',
        next: 'Далее',
        skip: 'Пропустить',
      }}
    />
  );
}
