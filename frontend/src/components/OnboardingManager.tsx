import { useState, useEffect } from 'react';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getProfile, markOnboardingTourSeen } from '../api/social';
import { Bot } from 'lucide-react';

const DASHBOARD_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    content: (
      <div className="text-left">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
            <Bot className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-lg text-slate-900">Привет! Я твой AI-наставник 🤖</h3>
        </div>
        <p className="text-slate-600 text-sm">Давай я покажу тебе, как использовать StudyForge на все 100%, чтобы учиться легко и получать лучшие оценки.</p>
      </div>
    ),
  },
  {
    target: '.tour-step-upload',
    content: (
      <div className="text-left">
        <h3 className="font-bold text-md text-slate-900 mb-1">Волшебная кнопка ✨</h3>
        <p className="text-slate-600 text-sm">Сюда ты загружаешь свои конспекты, PDF или аудио. Я сам прочитаю их и сделаю для тебя интерактивные карточки и тесты!</p>
      </div>
    ),
    placement: 'bottom',
  },
  {
    target: '.tour-step-library',
    content: 'Все твои загруженные материалы, сгенерированные тесты и подкасты хранятся здесь.',
    placement: 'right',
  },
  {
    target: '.tour-step-chat',
    content: 'Если что-то непонятно в лекции — пиши мне в чат. Я объясню любую тему простыми словами.',
    placement: 'right',
  },
  {
    target: '.tour-step-xp',
    content: 'За каждое действие (пройденный тест, выученная карточка) ты получаешь XP. Выполняй квесты и повышай свой уровень! Удачи!',
    placement: 'bottom',
  }
];

const EXAM_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    content: (
      <div className="text-left">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
            <Bot className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-lg text-slate-900">Готов к экзамену? 🎓</h3>
        </div>
        <p className="text-slate-600 text-sm">Вижу, ты загрузил свои первые конспекты. Теперь ты можешь запустить симуляцию устного экзамена с суровым профессором!</p>
      </div>
    ),
  },
  {
    target: '.tour-step-exam',
    content: 'Нажми сюда, когда будешь готов проверить свои знания в боевых условиях.',
    placement: 'right',
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
    
    // Slight delay to let UI render
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

    if (location.pathname === '/dashboard' && !status['dashboard_tour']) {
      // Check if elements exist
      if (document.querySelector('.tour-step-upload')) {
        setSteps(DASHBOARD_STEPS);
        setTourKey('dashboard_tour');
        setRun(true);
      }
    } else if (location.pathname === '/dashboard' && status['dashboard_tour'] && profile.total_materials > 0 && !status['exam_tour']) {
      if (document.querySelector('.tour-step-exam')) {
        setSteps(EXAM_STEPS);
        setTourKey('exam_tour');
        setRun(true);
      }
    }
  };

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
    
    if (finishedStatuses.includes(status)) {
      setRun(false);
      if (user && tourKey) {
        markOnboardingTourSeen(user.id, tourKey);
      }
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
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        buttonNext: {
          backgroundColor: '#4f46e5',
          borderRadius: '8px',
          fontWeight: 'bold',
        },
        buttonBack: {
          marginRight: 10,
        },
        buttonSkip: {
          color: '#64748b',
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
