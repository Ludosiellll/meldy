import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, HelpCircle, ChevronLeft, Sparkles, GraduationCap, Users, BookOpen, Settings, RefreshCw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getProfile } from '../api/social';

interface FAQItem {
  q: string;
  a: string;
  category: string;
}

const FAQ_DATABASE: FAQItem[] = [
  {
    q: 'Как стать преподавателем?',
    a: 'Чтобы переключить роль, вы можете воспользоваться быстрым переключателем вверху страницы «Дашборд» или в разделе «Мой профиль». Переключение роли мгновенно меняет интерфейс: для преподавателей открывается раздел управления группами и назначения заданий, а для студентов — доступ к дедлайнам и общему лидерборду.',
    category: 'roles'
  },
  {
    q: 'Как преподавателю создать класс?',
    a: 'Перейдите в режим Преподавателя (меню обновится), откройте раздел «Мои группы» (вкладка «Мои группы» в меню) и нажмите синюю кнопку «+ Создать класс» вверху экрана. Введите название (например, "Группа Информатики 10-А") и нажмите "Создать".',
    category: 'groups'
  },
  {
    q: 'Как пригласить студентов в класс?',
    a: 'После создания группы в карточке класса появится «Код приглашения» (например, f3c81). Скопируйте этот код и отправьте его вашим студентам. Как только они введут его на своем аккаунте, они автоматически появятся в вашем лидерборде и увидят все домашние задания.',
    category: 'groups'
  },
  {
    q: 'Как студенту присоединиться к классу?',
    a: 'Перейдите в раздел «Библиотека» (в режиме Студента), нажмите в правом верхнем углу кнопку «Ввести код класса», вставьте пятизначный код, выданный вашим учителем, и нажмите «Вступить». Вы сразу увидите классные дедлайны!',
    category: 'groups'
  },
  {
    q: 'Как загрузить лекцию или конспект?',
    a: 'Перейдите в раздел «Добавить материал». Вы можете загрузить текстовый конспект, PDF-книгу, презентацию или даже аудиозапись лекции. ИИ автоматически создаст краткое содержание, умные карточки для заучивания и тест для проверки знаний.',
    category: 'library'
  },
  {
    q: 'Что такое экспресс-режим подготовки?',
    a: 'Если до экзамена осталось мало времени, откройте любой материал в Библиотеке и нажмите «Повтор за 5 минут». Вы получите ультра-сжатую шпаргалку, написанную простыми словами, и короткий блиц-опрос для быстрой активации памяти.',
    category: 'study'
  },
  {
    q: 'Как работает устный экзамен с ИИ?',
    a: 'В разделе «Устный экзамен» выберите тему и начните диалог с ИИ-Профессором. Он задает вопросы, а вы можете отвечать голосом (через микрофон) или текстом. Профессор адаптирует сложность под ваши оценки и выставляет итоговый балл.',
    category: 'study'
  }
];

export default function ForgeyAssistant() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [selectedFaq, setSelectedFaq] = useState<FAQItem | null>(null);
  const [isVisible, setIsVisible] = useState(() => {
    return localStorage.getItem('forgey_assistant_hidden') !== 'true';
  });

  useEffect(() => {
    const handleToggle = () => {
      setIsVisible(localStorage.getItem('forgey_assistant_hidden') !== 'true');
    };
    window.addEventListener('forgey_assistant_toggle', handleToggle);
    return () => window.removeEventListener('forgey_assistant_toggle', handleToggle);
  }, []);

  // Загружаем профиль, чтобы знать роль и имя
  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then(setProfile);
  }, [user, location.pathname]);

  const getPageAdvice = () => {
    const path = location.pathname;
    const isTeacher = profile?.role === 'teacher';

    if (path.startsWith('/dashboard')) {
      return {
        title: 'Твоя панель управления',
        text: `Привет, ${profile?.full_name || 'друг'}! Это главный экран. Здесь ты видишь свои ежедневные квесты для прокачки XP, ближайшие экзамены и рекомендации ИИ по нагрузке на сегодня. ${
          isTeacher 
            ? 'Как преподаватель, вы можете быстро переключаться на управление группами.' 
            : 'Если твой преподаватель дал тебе код класса, нажми "Как вступить в класс" ниже.'
        }`
      };
    }
    if (path.startsWith('/library')) {
      return {
        title: 'Твоя личная библиотека',
        text: 'Здесь хранятся все загруженные материалы. Ты можешь кликнуть на любую лекцию, чтобы открыть конспект, запустить быстрое повторение или сдать устный экзамен ИИ-профессору.'
      };
    }
    if (path.startsWith('/analyze')) {
      return {
        title: 'Загрузка материалов',
        text: 'Просто перетащи сюда PDF-документ, конспект лекции или аудиозапись занятия. ИИ-методист за минуту создаст краткое изложение, разделит темы и сделает карточки для запоминания.'
      };
    }
    if (path.startsWith('/teacher') || path.startsWith('/groups')) {
      return {
        title: isTeacher ? 'Управление классами' : 'Мой учебный класс',
        text: isTeacher 
          ? 'Здесь вы управляете своими группами. Создайте класс, отправьте студентам сгенерированный код приглашения, назначайте им материалы из вашей библиотеки и отслеживайте успеваемость в живом лидерборде!'
          : 'Здесь отображаются назначенные тебе домашние задания и дедлайны. Также тут работает еженедельный и всеобщий лидерборд класса: учись активно, зарабатывай XP и занимай 1-е место на пьедестале!'
      };
    }
    if (path.startsWith('/courses')) {
      return {
        title: 'Учебные курсы с ИИ',
        text: 'Объединяй разрозненные материалы в структурированные курсы. ИИ-методист может самостоятельно разбить лекции по разделам от простого к сложному, либо ты можешь настроить программу вручную.'
      };
    }
    if (path.startsWith('/exam')) {
      return {
        title: 'Устный экзамен с ИИ',
        text: 'Симуляция настоящего устного экзамена. ИИ-Профессор задает вопросы по выбранному конспекту. Отвечай голосом (нажав микрофон) или текстом. Профессор оценивает полноту ответа и ставит заслуженную оценку.'
      };
    }
    if (path.startsWith('/co-study')) {
      return {
        title: 'Совместная комната',
        text: 'Учитесь вместе! В этой комнате работает синхронный Pomodoro-таймер: запуск таймера виден всем онлайн-участникам. Вы также можете общаться в реальном времени в чате и видеть статусы друг друга.'
      };
    }
    if (path.startsWith('/analytics')) {
      return {
        title: 'Аналитика успеваемости',
        text: 'Твой учебный дашборд. Тепловая карта знаний показывает уровень владения темами. Зеленые ячейки — отличные знания, красные — темы, в которых много ошибок и которые нужно срочно повторить.'
      };
    }
    if (path.startsWith('/review')) {
      return {
        title: 'Умные карточки (Интервалы)',
        text: 'Используй метод интервального повторения. Алгоритм сам рассчитывает время, когда ты начинаешь забывать информацию, и показывает карточки именно в этот момент.'
      };
    }
    if (path.startsWith('/mistakes')) {
      return {
        title: 'Твой дневник ошибок',
        text: 'Сюда попадают все неверные ответы из тестов. Повторяй их регулярно. Информация отсюда передается ИИ-Профессору, чтобы он на экзамене проверил твою работу над ошибками.'
      };
    }
    if (path.startsWith('/mood')) {
      return {
        title: 'Эмоциональный фон',
        text: 'Записывай свое самочувствие. Если ты устал, ИИ порекомендует легкое повторение или короткий подкаст, а если полон сил — глубокое погружение или экзамен, защищая тебя от выгорания.'
      };
    }

    return {
      title: 'Твой AI-помощник Форджи',
      text: 'Я готов помочь тебе на любой странице StudyForge! Кликни на интересующий вопрос в списке ниже, чтобы узнать больше о функциях платформы.'
    };
  };

  const currentAdvice = getPageAdvice();

  // При переходе на новую страницу автоматически сбрасываем выбранный FAQ
  useEffect(() => {
    setSelectedFaq(null);
  }, [location.pathname]);

  // Если бот скрыт — показываем маленькую кнопку восстановления
  if (!isVisible) return (
    <div className="fixed bottom-[72px] right-4 md:bottom-6 md:right-6 z-[9999]">
      <motion.button
        onClick={() => {
          setIsVisible(true);
          localStorage.removeItem('forgey_assistant_hidden');
        }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Показать помощника"
        className="w-10 h-10 bg-slate-200 dark:bg-slate-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-full flex items-center justify-center shadow-md border border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition"
      >
        <Bot className="w-5 h-5" />
      </motion.button>
    </div>
  );

  return (
    <>
      {/* FLOATING BUTTON WITH ANIMATIONS */}
      <div className="fixed bottom-[72px] right-4 md:bottom-6 md:right-6 z-[9999]">
        <motion.button
          onClick={() => setIsOpen(!isOpen)}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className="relative w-14 h-14 bg-gradient-to-tr from-indigo-600 to-indigo-500 rounded-full flex items-center justify-center shadow-xl shadow-indigo-600/30 border border-indigo-400/20 text-white cursor-pointer"
        >
          {/* Pulsing ring animation */}
          <span className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping opacity-75" />
          
          <Bot className="w-7 h-7" />
          
          {/* Mini unread status bubble */}
          <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full" />
        </motion.button>
      </div>

      {/* ASSISTANT PANEL */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-[140px] right-4 md:bottom-24 md:right-6 w-[340px] max-w-[calc(100vw-2rem)] max-h-[500px] bg-white dark:bg-slate-900 backdrop-blur-md rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl z-[9998] flex flex-col overflow-hidden"
          >
            {/* PANEL HEADER */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center shadow-md">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm tracking-tight">Помощник Форджи</h3>
                  <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Онлайн · AI наставник
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* PANEL BODY */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar text-xs">
              <AnimatePresence mode="wait">
                {!selectedFaq ? (
                  <motion.div
                    key="advice"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="space-y-4"
                  >
                    {/* Character Balloon */}
                    <div className="bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 rounded-2xl p-3.5 relative">
                      <div className="absolute top-3 -left-2 w-4 h-4 bg-indigo-50/80 dark:bg-indigo-950/40 border-l border-b border-indigo-100 dark:border-indigo-900/50 rotate-45 hidden md:block" />
                      <h4 className="font-black text-indigo-900 dark:text-indigo-200 mb-1 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 animate-spin-slow" />
                        {currentAdvice.title}
                      </h4>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                        {currentAdvice.text}
                      </p>
                    </div>

                    {/* Quick Questions (FAQ) */}
                    <div>
                      <h5 className="font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-[9px] mb-2 px-1">Частые вопросы</h5>
                      <div className="space-y-1.5">
                        {FAQ_DATABASE.map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedFaq(item)}
                            className="w-full text-left p-2.5 bg-slate-50 dark:bg-slate-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-300 rounded-xl transition font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-between border border-slate-100 dark:border-slate-700/60 hover:border-indigo-100 dark:hover:border-indigo-800/50 group"
                          >
                            <span className="truncate pr-2">{item.q}</span>
                            <span className="text-slate-300 dark:text-slate-600 group-hover:text-indigo-400 dark:group-hover:text-indigo-400 transition shrink-0">→</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="faq-detail"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-4"
                  >
                    {/* Back Button */}
                    <button
                      onClick={() => setSelectedFaq(null)}
                      className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-bold px-1"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Назад к советам
                    </button>

                    {/* FAQ Answer */}
                    <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-2">
                      <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm leading-tight">
                        {selectedFaq.q}
                      </h4>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                        {selectedFaq.a}
                      </p>
                    </div>

                    {/* Action navigation trigger */}
                    {selectedFaq.category === 'groups' && (
                      <button
                        onClick={() => {
                          setIsOpen(false);
                          navigate('/teacher');
                        }}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-center transition flex items-center justify-center gap-2"
                      >
                        <Users className="w-4 h-4" />
                        Перейти к Классам
                      </button>
                    )}
                    {selectedFaq.category === 'library' && (
                      <button
                        onClick={() => {
                          setIsOpen(false);
                          navigate('/library');
                        }}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-center transition flex items-center justify-center gap-2"
                      >
                        <BookOpen className="w-4 h-4" />
                        Открыть Библиотеку
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* PANEL FOOTER */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-[10px] font-bold text-slate-400 shrink-0">
              <button 
                onClick={() => {
                  setIsOpen(false);
                  setIsVisible(false);
                  localStorage.setItem('forgey_assistant_hidden', 'true');
                }} 
                className="hover:text-rose-500 dark:hover:text-rose-400 transition"
              >
                Скрыть помощника
              </button>
              
              <button 
                onClick={() => {
                  if (user) {
                    localStorage.removeItem('forgey_assistant_hidden');
                    supabase.from('profiles').update({
                      onboarding_status: {}
                    }).eq('id', user.id).then(() => {
                      setIsOpen(false);
                      window.location.href = '/dashboard';
                    });
                  }
                }}
                className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Начать тур заново
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
