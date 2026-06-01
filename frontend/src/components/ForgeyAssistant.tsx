import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, ChevronLeft, Sparkles, Users, BookOpen, RefreshCw } from 'lucide-react';
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
    a: 'Чтобы переключить роль, воспользуйтесь переключателем на странице «Дашборд» или в разделе «Мой профиль». Для преподавателей открывается управление группами и назначение заданий.',
    category: 'roles'
  },
  {
    q: 'Как преподавателю создать класс?',
    a: 'Перейдите в режим Преподавателя, откройте «Сообщество» → «Мой класс» и нажмите «+ Создать класс». Введите название и нажмите «Создать».',
    category: 'groups'
  },
  {
    q: 'Как пригласить студентов в класс?',
    a: 'После создания группы появится «Код приглашения». Скопируйте его и отправьте студентам — они сразу появятся в лидерборде и увидят все задания.',
    category: 'groups'
  },
  {
    q: 'Как студенту присоединиться к классу?',
    a: 'Перейдите в Библиотеку → «Ввести код класса», вставьте пятизначный код учителя и нажмите «Вступить».',
    category: 'groups'
  },
  {
    q: 'Как загрузить лекцию или конспект?',
    a: 'Раздел «📚 Учёба» → «Добавить материал». Загружайте PDF, текст или аудио — ИИ создаст краткое содержание, карточки и тест автоматически.',
    category: 'library'
  },
  {
    q: 'Что такое экспресс-режим подготовки?',
    a: 'В разделе «🎯 Практика» → «Быстрый повтор». Ультра-сжатая шпаргалка + блиц-опрос за 5 минут перед экзаменом.',
    category: 'study'
  },
  {
    q: 'Как работает устный экзамен с ИИ?',
    a: 'В «🎯 Практика» → «Устный экзамен». Выбери тему, отвечай голосом или текстом. ИИ-Профессор адаптирует сложность и выставляет балл.',
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

  const [isSocraticOpen, setIsSocraticOpen] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isAnyModalOpen, setIsAnyModalOpen] = useState(false);

  useEffect(() => {
    const handleToggle = () => {
      setIsVisible(localStorage.getItem('forgey_assistant_hidden') !== 'true');
    };
    const handleSocraticOpen = () => { setIsSocraticOpen(true); setIsOpen(false); };
    const handleSocraticClose = () => setIsSocraticOpen(false);
    window.addEventListener('forgey_assistant_toggle', handleToggle);
    window.addEventListener('socratic_chat_open', handleSocraticOpen);
    window.addEventListener('socratic_chat_close', handleSocraticClose);
    return () => {
      window.removeEventListener('forgey_assistant_toggle', handleToggle);
      window.removeEventListener('socratic_chat_open', handleSocraticOpen);
      window.removeEventListener('socratic_chat_close', handleSocraticClose);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then(setProfile);
  }, [user?.id, location.pathname]);

  // Закрываем панель при переходе на страницу чата
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) {
      setIsOpen(false);
    }
    setSelectedFaq(null);
  }, [location.pathname]);

  // Track global input focus to hide chatbot button on mobile keyboard
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true')) {
        setIsInputFocused(true);
      }
    };

    const handleFocusOut = () => {
      setIsInputFocused(false);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Track if any active modal / overlay is currently open
  useEffect(() => {
    const checkModal = () => {
      const hasModal = !!document.querySelector('.backdrop-blur-sm') || 
                       !!document.querySelector('.bg-slate-900/60') ||
                       !!document.querySelector('.bg-slate-950/80') ||
                       !!document.querySelector('.bg-black/20') ||
                       !!document.querySelector('[role="dialog"]');
      setIsAnyModalOpen(hasModal);
    };

    checkModal();
    const interval = setInterval(checkModal, 450);
    return () => clearInterval(interval);
  }, []);

  const getPageAdvice = () => {
    const path = location.pathname;
    const isTeacher = profile?.role === 'teacher';

    if (path.startsWith('/dashboard')) {
      return {
        title: 'Твоя панель управления',
        text: `Привет, ${profile?.full_name || 'друг'}! Здесь видны ежедневные квесты, ближайшие экзамены и рекомендации. ${
          isTeacher
            ? 'Как преподаватель, переключайся на управление группами через «Сообщество».'
            : 'Карточки на повторение — твой главный инструмент: начни с них!'
        }`
      };
    }
    if (path.startsWith('/library')) return { title: 'Твоя библиотека', text: 'Все загруженные материалы. Кликни на лекцию — откроется конспект, карточки и тест.' };
    if (path.startsWith('/analyze')) return { title: 'Загрузка материалов', text: 'Перетащи PDF, конспект или аудио. ИИ создаст краткое изложение, карточки и тест за минуту.' };
    if (path.startsWith('/teacher')) return { title: isTeacher ? 'Управление классами' : 'Мой учебный класс', text: isTeacher ? 'Создайте класс, отправьте код студентам, назначайте материалы и следите за успеваемостью в лидерборде.' : 'Здесь задания и дедлайны от преподавателя. Выполняй их — зарабатывай XP!' };
    if (path.startsWith('/courses')) return { title: 'Учебные курсы', text: 'Объединяй материалы в структурированные курсы. ИИ разобьёт лекции по разделам от простого к сложному.' };
    if (path.startsWith('/exam')) return { title: 'Устный экзамен с ИИ', text: 'Симуляция настоящего экзамена. Отвечай голосом или текстом — Профессор оценит полноту ответа.' };
    if (path.startsWith('/analytics')) return { title: 'Аналитика успеваемости', text: 'Тепловая карта знаний: зеленые темы — отличные знания, красные — нужно срочно повторить.' };
    if (path.startsWith('/review')) return { title: 'Умные карточки', text: 'Интервальное повторение: алгоритм сам рассчитывает, когда показать карточку, чтобы ты не забыл.' };
    if (path.startsWith('/mistakes')) return { title: 'Дневник ошибок', text: 'Сюда попадают все неверные ответы из тестов. Повторяй их регулярно — ИИ учтёт это на экзамене.' };
    if (path.startsWith('/knowledge-map')) return { title: 'Карта знаний', text: 'Визуальный граф всех твоих лекций и понятий. Видишь связи между темами? Это и есть настоящее понимание.' };
    if (path.startsWith('/quick-prep')) return { title: 'Быстрый повтор', text: 'Экспресс-шпаргалка + блиц-опрос по материалу. Идеально за 5 минут до занятия.' };

    return { title: 'Помощник Форджи', text: 'Я готов помочь на любой странице StudyForge! Выбери вопрос ниже.' };
  };

  const currentAdvice = getPageAdvice();

  // На странице чата на мобильных — полностью скрываем кнопку
  const isChatPage = location.pathname.startsWith('/chat');
  const isMessagesPage = location.pathname.startsWith('/messages');

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const shouldHideGlobally = isChatPage || isMessagesPage || isSocraticOpen || isAnyModalOpen || (isMobile && isInputFocused);

  if (!isVisible) return (
    <div className={`fixed z-[9999] ${shouldHideGlobally ? 'hidden' : 'bottom-[80px] right-4 md:bottom-6 md:right-6'}`}>
      <motion.button
        onClick={() => { setIsVisible(true); localStorage.removeItem('forgey_assistant_hidden'); }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Показать помощника"
        className="w-10 h-10 bg-slate-200 dark:bg-slate-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-full flex items-center justify-center shadow-md border border-slate-300 dark:border-slate-600 text-slate-400 hover:text-indigo-500 transition"
      >
        <Bot className="w-5 h-5" />
      </motion.button>
    </div>
  );

  // Скрываем полностью при выполнении любого глобального условия
  if (shouldHideGlobally) return null;

  return (
    <>
      {/* FLOATING BUTTON */}
      <div className="fixed bottom-[80px] right-4 md:bottom-6 md:right-6 z-[9999]">
        <motion.button
          onClick={() => setIsOpen(!isOpen)}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className="relative w-13 h-13 w-[52px] h-[52px] bg-gradient-to-tr from-indigo-600 to-indigo-500 rounded-full flex items-center justify-center shadow-xl shadow-indigo-600/30 border border-indigo-400/20 text-white cursor-pointer"
          aria-label="Открыть помощника"
        >
          <span className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping opacity-75" />
          <Bot className="w-6 h-6" />
          <span className="absolute top-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full" />
        </motion.button>
      </div>

      {/* ASSISTANT PANEL */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop on mobile */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[9997] md:hidden"
              onClick={() => setIsOpen(false)}
            />

            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              // На мобилке — снизу по центру экрана, не перекрывает навбар
              // На десктопе — справа внизу рядом с кнопкой
              className="fixed z-[9998] flex flex-col overflow-hidden
                inset-x-3 bottom-[148px] max-h-[60vh]
                md:inset-x-auto md:bottom-24 md:right-6 md:w-[340px] md:max-h-[500px]
                bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl"
            >
              {/* HEADER */}
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
                  aria-label="Закрыть"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* BODY */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar text-xs">
                <AnimatePresence mode="wait">
                  {!selectedFaq ? (
                    <motion.div key="advice" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-4">
                      {/* Context balloon */}
                      <div className="bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 rounded-2xl p-3.5">
                        <h4 className="font-black text-indigo-900 dark:text-indigo-200 mb-1 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                          {currentAdvice.title}
                        </h4>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium">{currentAdvice.text}</p>
                      </div>

                      {/* FAQ */}
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
                              <span className="text-slate-300 dark:text-slate-600 group-hover:text-indigo-400 transition shrink-0">→</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="faq-detail" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
                      <button onClick={() => setSelectedFaq(null)} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-bold px-1">
                        <ChevronLeft className="w-4 h-4" /> Назад
                      </button>
                      <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-2">
                        <h4 className="font-extrabold text-slate-900 dark:text-slate-100 text-sm leading-tight">{selectedFaq.q}</h4>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium">{selectedFaq.a}</p>
                      </div>
                      {selectedFaq.category === 'groups' && (
                        <button onClick={() => { setIsOpen(false); navigate('/messages'); }} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-center transition flex items-center justify-center gap-2">
                          <Users className="w-4 h-4" /> Перейти к Сообществу
                        </button>
                      )}
                      {selectedFaq.category === 'library' && (
                        <button onClick={() => { setIsOpen(false); navigate('/library'); }} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-center transition flex items-center justify-center gap-2">
                          <BookOpen className="w-4 h-4" /> Открыть Библиотеку
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* FOOTER */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-[10px] font-bold text-slate-400 shrink-0">
                <button
                  onClick={() => { setIsOpen(false); setIsVisible(false); localStorage.setItem('forgey_assistant_hidden', 'true'); }}
                  className="hover:text-rose-500 dark:hover:text-rose-400 transition"
                >
                  Скрыть помощника
                </button>
                <button
                  onClick={() => {
                    if (user) {
                      localStorage.removeItem('forgey_assistant_hidden');
                      supabase.from('profiles').update({ onboarding_status: {} }).eq('id', user.id).then(() => {
                        setIsOpen(false);
                        window.dispatchEvent(new Event('profile_updated'));
                        navigate('/dashboard');
                      });
                    }
                  }}
                  className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 transition flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Начать тур заново
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
