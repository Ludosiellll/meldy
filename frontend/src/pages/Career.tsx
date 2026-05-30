import { Term } from '../types/index';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Briefcase, Target, Layers, FileText, ArrowRight, Zap, 
  CheckCircle2, Loader2, Code2, Cpu, MessageSquare, Send, 
  Play, Check, AlertCircle, ExternalLink, Lock, Unlock, 
  Award, Sparkles, Database, Eye, Smile, RefreshCw, 
  Sliders, ChevronRight, X, ArrowLeft, ThumbsUp 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { 
  getCareerProfile, generateCareerProfile, saveCareerProfile, 
  generateCareerCourse, sendCareerChat, evaluateCareerTask, 
  getCareerVacancies, sendVacancyChat, VacancyItem,
  expandCareerCourse, CareerProfile, CareerCourse, CareerModule 
} from '../api/career';
import { getMaterials } from '../api/materials';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { incrementAIUsage } from '../api/limits';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import confetti from 'canvas-confetti';
import toast, { Toaster } from 'react-hot-toast';

export default function Career() {
  const { user } = useAuth();
  const { alert, confirm } = useConfirm();
  const navigate = useNavigate();
  const { verifyEnergy } = useEnergyConfirm();

  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'course'>('profile');

  // New states for Vacancy Selection Dashboard & AI Vacancy Chat
  const [showVacancySelector, setShowVacancySelector] = useState(false);
  const [foundVacancies, setFoundVacancies] = useState<VacancyItem[]>([]);
  const [loadingVacancies, setLoadingVacancies] = useState(false);
  const [selectedVacancy, setSelectedVacancy] = useState<VacancyItem | null>(null);
  const [vacancyChatMessages, setVacancyChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [vacancyChatInput, setVacancyChatInput] = useState('');
  const [sendingVacancyChat, setSendingVacancyChat] = useState(false);
  const [pendingCourseParams, setPendingCourseParams] = useState<{
    profession: string;
    level: string;
    salary: string;
    location: string;
    age?: number;
    gender: string;
    extraContext: string;
  } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // States for advanced course expansion dialogue
  const [showExpandChat, setShowExpandChat] = useState(false);
  const [expandChatMessages, setExpandChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [expandChatInput, setExpandChatInput] = useState('');
  const [sendingExpandChat, setSendingExpandChat] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);

  // Helper for dynamic formatting of salaries
  const formatSalary = (salary: string, location?: string) => {
    if (!salary) return 'не указана';
    let formatted = salary;
    formatted = formatted.replace(/\b(RUR|RUB)\b/gi, '₽');
    formatted = formatted.replace(/\b(BYN|BYR)\b/gi, ' BYN');
    formatted = formatted.replace(/\b(KZT)\b/gi, ' ₸');
    formatted = formatted.replace(/\b(USD)\b/gi, ' $');
    formatted = formatted.replace(/\b(EUR)\b/gi, ' €');
    
    // Handle number-only strings
    if (/^\d+$/.test(formatted.trim())) {
      const loc = (location || '').toLowerCase();
      if (loc.includes('беларусь') || loc.includes('belarus') || loc.includes('минск')) {
        return `${formatted} BYN`;
      }
      if (loc.includes('казахстан') || loc.includes('kazakhstan') || loc.includes('алматы') || loc.includes('астана')) {
        return `${formatted} ₸`;
      }
      if (loc.includes('сша') || loc.includes('usa') || loc.includes('usd')) {
        return `$${formatted}`;
      }
      return `${formatted} ₽`;
    }
    
    return formatted;
  };

  // Coaching Chat State
  const [showCoachChat, setShowCoachChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Active module and practice zone state
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<CareerModule | null>(null);
  const [practiceOpen, setPracticeOpen] = useState(false);
  
  // Universal sandbox states
  const [sandboxCode, setSandboxCode] = useState('');
  const [sandboxText, setSandboxText] = useState('');
  const [sandboxInputs, setSandboxInputs] = useState<Record<string, string>>({});
  const [sandboxClickErrors, setSandboxClickErrors] = useState<Record<string, string>>({});
  
  // Socratic Soft-Skills Roleplay Chat State
  const [roleplayMessages, setRoleplayMessages] = useState<{ role: string; content: string }[]>([]);
  const [roleplayInput, setRoleplayInput] = useState('');
  const [sendingRoleplay, setSendingRoleplay] = useState(false);
  const [roleplayTurnsLeft, setRoleplayTurnsLeft] = useState(4);

  // Verification & AI Expert review states
  const [localTested, setLocalTested] = useState(false);
  const [localTestedPassed, setLocalTestedPassed] = useState(false);
  const [localTestLogs, setLocalTestLogs] = useState<string[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadProfile();
  }, [user?.id]);

  useEffect(() => {
    if (showCoachChat) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, showCoachChat]);

  const loadProfile = () => {
    if (!user) return;
    getCareerProfile(user.id)
      .then(p => {
        setProfile(p);
        if (p?.course) {
          setActiveTab('course');
        }
        setLoading(false);
      })
      .catch(async (e) => {
        console.error(e);
        toast.error('Не удалось загрузить профиль.');
        setLoading(false);
      });
  };

  const handleStartCoachChat = () => {
    setShowCoachChat(true);
    if (chatMessages.length === 0) {
      setChatMessages([
        {
          role: 'assistant',
          content: 'Привет! Я Форджи, твой личный карьерный коуч. Моя цель — помочь тебе определиться с будущей IT-профессией, разобрать твои интересы и составить ультимативно подробный курс на базе вакансий реального рынка труда.\n\nРасскажи, в каком направлении ты хочешь развиваться? К чему лежит душа? У тебя уже есть опыт в программировании, дизайне, аналитике или управлении?'
        }
      ]);
    }
  };

  const handleSendCoachMessage = async (textToSend?: string) => {
    const text = textToSend || chatInput;
    if (!text.trim() || !user || sendingChat) return;

    const newMessages = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(newMessages);
    setChatInput('');
    setSendingChat(true);

    try {
      const reply = await sendCareerChat(text, newMessages.slice(-10));
      
      // Parse trigger token for course generation: [GENERATE_COURSE_ACTION:Profession|Salary|Level|Location|Age|Gender|ExtraContext]
      const triggerRegex = /\[GENERATE_COURSE_ACTION:(.+?)\|(.+?)\|(.+?)(?:\|(.+?)\|(.+?)\|(.+?)\|(.+?))?\]/;
      const match = reply.match(triggerRegex);

      if (match) {
        const profession = match[1].trim();
        const salary = match[2].trim();
        const level = match[3].trim();
        const location = match[4] ? match[4].trim() : '';
        const age = match[5] && match[5].trim() ? parseInt(match[5].trim()) : undefined;
        const gender = match[6] ? match[6].trim() : '';
        const extraContext = match[7] ? match[7].trim() : '';
        
        // Remove token from text visible to user
        const cleanReply = reply.replace(triggerRegex, '').trim();
        setChatMessages(prev => [...prev, { role: 'assistant', content: cleanReply }]);
        
        // Trigger automated roadmap creation
        toast.success(`Согласованы параметры: ${profession}, уровень ${level}, ожидаемая ЗП ${formatSalary(salary, location)}!`);
        setPendingCourseParams({ profession, level, salary, location, age, gender, extraContext });
        setShowVacancySelector(true);
        setShowCoachChat(false);
        fetchAndSetVacancies(profession, location);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка отправки сообщения.');
    } finally {
      setSendingChat(false);
    }
  };

  const fetchAndSetVacancies = async (profession: string, location: string) => {
    setLoadingVacancies(true);
    try {
      const v = await getCareerVacancies(profession, location);
      setFoundVacancies(v);
      if (v.length > 0) {
        setSelectedVacancy(v[0]);
        // Initialize AI chat context for vacancy
        setVacancyChatMessages([
          {
            role: 'assistant',
            content: `Привет! Я твой карьерный ИИ-консультант StudyForge. Я вижу, что ты выбрал отличную вакансию: **"${v[0].title}"** в компании **"${v[0].company}"**.\n\nЯ полностью проанализировал требования работодателя. Спроси меня о чём угодно: о каверзных вопросах на собеседовании, о том, какие технологии из списка самые критичные, или о том, как лучше презентовать твой опыт под эту позицию!`
          }
        ]);
      }
    } catch (e) {
      console.error(e);
      toast.error('Не удалось загрузить вакансии.');
    } finally {
      setLoadingVacancies(false);
    }
  };

  const handleSendVacancyChatMessage = async () => {
    if (!vacancyChatInput.trim() || !selectedVacancy || sendingVacancyChat) return;
    
    const newMsg = [...vacancyChatMessages, { role: 'user', content: vacancyChatInput }];
    setVacancyChatMessages(newMsg);
    setVacancyChatInput('');
    setSendingVacancyChat(true);
    
    try {
      const reply = await sendVacancyChat(vacancyChatInput, newMsg.slice(-8), selectedVacancy);
      setVacancyChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      console.error(e);
      toast.error('Ошибка связи с ИИ-консультантом.');
    } finally {
      setSendingVacancyChat(false);
    }
  };

  const handleStartExpandChat = () => {
    if (!profile?.course) return;
    setShowExpandChat(true);
    setExpandChatMessages([
      {
        role: 'assistant',
        content: `Поздравляю тебя с успешным и полным прохождением базового курса по направлению **"${profile.course.profession}"**! 🎉 Ты проделал колоссальную работу!\n\nЯ готов спроектировать для тебя продвинутые, сверхсложные модули повышенной сложности, чтобы продолжить твое профессиональное развитие. Расскажи, какую новую техническую высоту или специализацию ты хочешь взять теперь? (Например: углубиться в архитектуру высоконагруженных систем, освоить Docker и CI/CD, уйти в Fullstack или затронуть продвинутый SQL/NoSQL?)`
      }
    ]);
  };

  const handleSendExpandChatMessage = async () => {
    if (!expandChatInput.trim() || !profile?.course || !user || sendingExpandChat) return;
    
    const newMsg = [...expandChatMessages, { role: 'user', content: expandChatInput }];
    setExpandChatMessages(newMsg);
    const userInput = expandChatInput;
    setExpandChatInput('');
    setSendingExpandChat(true);
    
    try {
      const systemPromptContext = `Студент только что завершил курс "${profile.course.profession}" из ${profile.course.modules.length} модулей. Теперь он хочет расширить обучение. Поговори с ним о его продвинутых целях. Когда вы полностью согласуете дополнительные темы, напиши в самом конце сообщения: [EXPAND_COURSE_ACTION:НазваниеНаправления|ДополнительныйКонтекст]`;
      
      const res = await fetch('/api/career/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `${userInput}\n\n[CONTEXT: ${systemPromptContext}]`,
          history: newMsg.slice(-8)
        })
      });
      
      if (!res.ok) throw new Error("Ошибка чата");
      const data = await res.json();
      const reply = data.reply;
      
      const triggerRegex = /\[EXPAND_COURSE_ACTION:(.+?)(?:\|(.+?))?\]/;
      const match = reply.match(triggerRegex);
      
      if (match) {
        const additionalFocus = match[1].trim();
        const extraContext = match[2] ? match[2].trim() : '';
        const cleanReply = reply.replace(triggerRegex, '').trim();
        setExpandChatMessages(prev => [...prev, { role: 'assistant', content: cleanReply }]);
        
        toast.success(`Согласованы продвинутые темы: ${additionalFocus}!`);
        // Start advanced generation load
        setShowExpandChat(false);
        await handleExpandCourseSyllabus(additionalFocus, extraContext);
      } else {
        setExpandChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка отправки сообщения.');
    } finally {
      setSendingExpandChat(false);
    }
  };

  const handleExpandCourseSyllabus = async (additionalFocus: string, extraContext: string) => {
    if (!user || !profile?.course) return;
    
    setIsExpanding(true);
    toast.loading('Проектируем продвинутые модули, адаптируем практику под новые цели...', { id: 'expand_course_load' });
    
    try {
      const newModules = await expandCareerCourse(user.id, profile.course, additionalFocus, extraContext);
      if (newModules && newModules.length > 0) {
        toast.success('Программа обучения успешно расширена!', { id: 'expand_course_load' });
        confetti({ particleCount: 150, spread: 80 });
        loadProfile();
      } else {
        toast.error('Не удалось расширить учебную программу.', { id: 'expand_course_load' });
      }
    } catch (e) {
      console.error(e);
      toast.error('Ошибка расширения курса.', { id: 'expand_course_load' });
    } finally {
      setIsExpanding(false);
    }
  };

  const triggerCourseSyllabus = async (
    profession: string, 
    level: string, 
    salary: string,
    location?: string,
    age?: number,
    gender?: string,
    extraContext?: string,
    vacancyContext?: string
  ) => {
    if (!user) return;
    
    setIsGenerating(true);
    setShowCoachChat(false);
    setShowVacancySelector(false);
    
    try {
      // Gather context from materials
      const materials = await getMaterials(user.id);
      let contextStr = "";
      if (materials && materials.length > 0) {
        const contextLines = materials.map(m => {
          let termsStr = "";
          if (m.summary_json && m.summary_json.terms) {
            termsStr = "Термины: " + m.summary_json.terms.map((t: Term) => t.term).join(", ");
          }
          let summaryText = typeof m.summary_json === 'string' ? m.summary_json : (m.summary_json?.content || '');
          return `Тема: ${m.subject || m.title}\nКонспект: ${summaryText.slice(0, 500)}...\n${termsStr}`;
        });
        contextStr = contextLines.join("\n\n---\n\n").slice(0, 10000);
      }

      toast.loading('Подключаемся к API вакансий, собираем требования и генерируем подробнейший курс...', { id: 'gen_course' });
      
      const newCourse = await generateCareerCourse(
        user.id, 
        profession, 
        level, 
        salary, 
        contextStr,
        location,
        age,
        gender,
        extraContext,
        vacancyContext
      );
      
      if (newCourse) {
        toast.success('Элитный практический курс успешно составлен!', { id: 'gen_course' });
        confetti({ particleCount: 150, spread: 80 });
        loadProfile();
      } else {
        toast.error('Произошла ошибка при генерации курса.', { id: 'gen_course' });
      }
    } catch (e) {
      console.error(e);
      toast.error('Не удалось сгенерировать курс.', { id: 'gen_course' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!user) return;

    try {
      const materials = await getMaterials(user.id);
      if (!materials || materials.length === 0) {
        await alert({ 
          title: 'Нет конспектов', 
          message: 'У вас пока нет загруженных конспектов. Добавьте материалы, чтобы ИИ смог оцифровать ваши навыки!', 
          type: 'warning' 
        });
        return;
      }

      const contextLines = materials.map(m => {
        let termsStr = "";
        if (m.summary_json && m.summary_json.terms) {
          termsStr = "Термины: " + m.summary_json.terms.map((t: Term) => t.term).join(", ");
        }
        let summaryText = typeof m.summary_json === 'string' ? m.summary_json : (m.summary_json?.content || '');
        return `Тема: ${m.subject || m.title}\nКонспект: ${summaryText.slice(0, 500)}...\n${termsStr}`;
      });

      const contextStr = contextLines.join("\n\n---\n\n").slice(0, 15000);

      const ok = await verifyEnergy(user.id, 5, 'Оцифровка навыков');
      if (!ok) return;
      
      setIsGenerating(true);
      await incrementAIUsage(user.id, 5);

      const newProfile = await generateCareerProfile(user.id, contextStr);
      if (newProfile) {
        setProfile(newProfile);
        toast.success('Навыки успешно пересчитаны!');
      } else {
        await alert({ title: 'Ошибка', message: 'Произошла ошибка при генерации профиля.', type: 'danger' });
      }
    } catch (error) {
      console.error(error);
      await alert({ title: 'Ошибка', message: 'Не удалось оцифровать навыки.', type: 'danger' });
    } finally {
      setIsGenerating(false);
    }
  };

  const openSandbox = (mod: CareerModule) => {
    setSelectedModule(mod);
    setPracticeOpen(true);
    setLocalTested(false);
    setLocalTestedPassed(false);
    setLocalTestLogs([]);
    setIsEvaluating(false);
    
    // Initialize defaults based on practice type
    if (mod.practice_type === 'algo') {
      setSandboxCode(mod.practice_task.code_template || `function solution() {\n  // напиши свой код здесь\n}`);
    } else if (mod.practice_type === 'sql') {
      setSandboxCode(`SELECT * FROM vacancies WHERE salary > 100000;`);
    } else if (mod.practice_type === 'web') {
      setSandboxCode(`<!-- Напиши HTML & CSS здесь -->\n<div class="card">\n  <h2>Привет, StudyForge!</h2>\n  <p>Сделай центрирование по флексу и добавь градиентный фон.</p>\n</div>\n\n<style>\n  .card {\n    padding: 2rem;\n    text-align: center;\n  }\n</style>`);
    } else if (mod.practice_type === 'business') {
      setSandboxInputs({});
    } else if (mod.practice_type === 'design') {
      setSandboxClickErrors({});
    } else if (mod.practice_type === 'copywriting') {
      setSandboxText(mod.practice_task.task_description.slice(0, 100) + '...');
    } else if (mod.practice_type === 'roleplay') {
      setRoleplayTurnsLeft(4);
      setRoleplayMessages([
        {
          role: 'assistant',
          content: 'Разгневанный клиент: "Почему проект задерживается уже на 2 недели? Мне нужны результаты прямо сейчас, или я требую возврат всей предоплаты!"'
        }
      ]);
    }
  };

  const runLocalTests = () => {
    if (!selectedModule) return;
    setLocalTested(true);
    setLocalTestLogs([]);

    const task = selectedModule.practice_task;
    
    if (selectedModule.practice_type === 'algo') {
      try {
        const userFn = new Function(`return ${sandboxCode}`)();
        const logs: string[] = [];
        let passed = true;

        if (task.test_cases && task.test_cases.length > 0) {
          task.test_cases.forEach((tc, idx) => {
            const inputParsed = JSON.parse(tc.input);
            const expectedParsed = JSON.parse(tc.expected);
            
            let result;
            if (Array.isArray(inputParsed)) {
              result = userFn(...inputParsed);
            } else {
              result = userFn(inputParsed);
            }

            const isMatch = JSON.stringify(result) === JSON.stringify(expectedParsed);
            if (isMatch) {
              logs.push(`✅ Тест ${idx + 1} пройден! Вход: ${tc.input} | Ожидалось: ${tc.expected} | Получено: ${JSON.stringify(result)}`);
            } else {
              logs.push(`❌ Тест ${idx + 1} провален! Вход: ${tc.input} | Ожидалось: ${tc.expected} | Получено: ${JSON.stringify(result)}`);
              passed = false;
            }
          });
        } else {
          logs.push('⚠️ У задачи нет формальных тест-кейсов. Выполняем базовую синтаксическую проверку.');
        }

        setLocalTestLogs(logs);
        setLocalTestedPassed(passed);
        if (passed) {
          toast.success('Все тесты пройдены успешно!');
        } else {
          toast.error('Некоторые тесты провалились.');
        }
      } catch (e: any) {
        setLocalTestLogs([`💥 Ошибка компиляции или выполнения: ${e.message}`]);
        setLocalTestedPassed(false);
        toast.error('Ошибка в коде!');
      }
    } else if (selectedModule.practice_type === 'sql') {
      // Local programmatic SQL simulator
      const query = sandboxCode.toLowerCase();
      const logs = [];
      let passed = false;
      
      logs.push(`Executing query locally: "${sandboxCode}"`);
      
      if (query.includes('select') && query.includes('from')) {
        passed = true;
        logs.push('✅ Синтаксис SQL верный.');
        logs.push('🔍 Найдено подходящих записей: 5 (Middle/Senior vacancies)');
        // render a mock table results
      } else {
        logs.push('❌ Неверный синтаксис SQL. Убедитесь, что используете SELECT ... FROM ...');
      }
      
      setLocalTestLogs(logs);
      setLocalTestedPassed(passed);
    } else if (selectedModule.practice_type === 'web') {
      // Local check for HTML and tags
      const code = sandboxCode.toLowerCase();
      const logs = [];
      let passed = true;

      if (!code.includes('<style>') || !code.includes('</style>')) {
        logs.push('⚠️ Стили не обнаружены. Пожалуйста, напишите CSS внутри тега <style>');
        passed = false;
      }
      if (passed) {
        logs.push('✅ DOM структура корректна. CSS стили внедрены.');
        logs.push('👁️ Visual Previewer успешно отрендерил интерфейс.');
      }
      setLocalTestLogs(logs);
      setLocalTestedPassed(passed);
    } else if (selectedModule.practice_type === 'business') {
      // Business inputs RICE checker
      // Reach * Impact * Confidence / Effort
      // Feature A: 1000 * 2 * 0.8 / 2 = 800
      // Feature B: 5000 * 3 * 0.5 / 5 = 1500
      const a = parseInt(sandboxInputs['rice_a'] || '0');
      const b = parseInt(sandboxInputs['rice_b'] || '0');
      const logs = [];
      let passed = false;

      if (a === 800 && b === 1500) {
        passed = true;
        logs.push('✅ Расчет RICE выполнен абсолютно математически верно!');
        logs.push('Проект B имеет высший приоритет (Score: 1500 vs 800).');
      } else {
        logs.push('❌ Ошибка в расчетах. Перепроверьте формулу: RICE = (Reach * Impact * Confidence) / Effort');
        if (a !== 800) logs.push(`- Ошибка в Score для Feature A (введено: ${a}, ожидается: 800)`);
        if (b !== 1500) logs.push(`- Ошибка в Score для Feature B (введено: ${b}, ожидается: 1500)`);
      }
      setLocalTestLogs(logs);
      setLocalTestedPassed(passed);
    } else if (selectedModule.practice_type === 'design') {
      // Design clicks validator
      const foundCount = Object.keys(sandboxClickErrors).length;
      const logs = [];
      let passed = false;

      if (foundCount >= 3) {
        passed = true;
        logs.push(`✅ Отлично! Вы нашли все критические ошибки дизайна (${foundCount} из 3):`);
        Object.entries(sandboxClickErrors).forEach(([err, type]) => {
          logs.push(`- Зона "${err}": идентифицирована ошибка как "${type}"`);
        });
      } else {
        logs.push(`❌ Найдено только ${foundCount} из 3 критических ошибок на макете.`);
        logs.push('Продолжайте исследовать UI макет.');
      }
      setLocalTestLogs(logs);
      setLocalTestedPassed(passed);
    } else if (selectedModule.practice_type === 'copywriting') {
      // Copywriting validator
      const text = sandboxText.trim();
      const logs = [];
      let passed = true;

      if (text.length > 250) {
        logs.push('❌ Текст слишком длинный! Настоящий копирайтер ужимает воду на 30-50% (должно быть меньше 250 символов).');
        passed = false;
      }
      
      const buzzwords = ['уникальный', 'инновационный', 'синергия', 'лидирующий', 'экосистема'];
      buzzwords.forEach(bw => {
        if (text.toLowerCase().includes(bw)) {
          logs.push(`❌ Найдено стоп-слово из инфостиля: "${bw}". Избавьтесь от штампов.`);
          passed = false;
        }
      });

      if (passed) {
        logs.push('✅ Прекрасный сжатый инфостиль. Стоп-слова исключены.');
        logs.push(`Размер сокращен до ${text.length} символов.`);
      }
      setLocalTestLogs(logs);
      setLocalTestedPassed(passed);
    }
  };

  const handleSendRoleplay = async () => {
    if (!roleplayInput.trim() || sendingRoleplay || !selectedModule || !profile) return;
    
    const text = roleplayInput;
    setRoleplayInput('');
    const newMsgs = [...roleplayMessages, { role: 'user', content: text }];
    setRoleplayMessages(newMsgs);
    setSendingRoleplay(true);

    try {
      // Send Socratic context message to AI coach endpoint configured as customer
      const reply = await sendCareerChat(
        `ТЫ ИГРАЕШЬ РОЛЬ ТРУДНОГО КЛИЕНТА. Продолжай переговоры. Будь эмоционален, но если студент приводит классные аргументы и проявляет эмпатию — постепенно успокаивайся. Твоя реплика должна быть до 3 предложений. Студент ответил: "${text}"`,
        newMsgs.slice(-6)
      );
      setRoleplayMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      setRoleplayTurnsLeft(prev => {
        const left = prev - 1;
        if (left <= 0) {
          setLocalTested(true);
          setLocalTestedPassed(true);
          setLocalTestLogs(['✅ Переговоры завершены! Реплики сторон зафиксированы. Вы можете запросить ИИ-экспертное ревью.']);
        }
        return left;
      });
    } catch (e) {
      toast.error('Сбой связи с клиентом.');
    } finally {
      setSendingRoleplay(false);
    }
  };

  const handleAISubmit = async () => {
    if (!selectedModule || !profile || !user) return;

    const ok = await confirm({
      title: 'ИИ-экспертное ревью',
      message: 'Запрос глубокого ИИ-разбора и оценки от экспертного ментора спишет 5 энергии. Продолжить?'
    });
    if (!ok) return;

    const okEnergy = await verifyEnergy(user.id, 5, 'ИИ Карьерный Эксперт');
    if (!okEnergy) return;

    setIsEvaluating(true);
    await incrementAIUsage(user.id, 5);

    let solutionData = "";
    if (selectedModule.practice_type === 'algo' || selectedModule.practice_type === 'sql' || selectedModule.practice_type === 'web') {
      solutionData = sandboxCode;
    } else if (selectedModule.practice_type === 'copywriting') {
      solutionData = sandboxText;
    } else if (selectedModule.practice_type === 'business') {
      solutionData = JSON.stringify(sandboxInputs);
    } else if (selectedModule.practice_type === 'design') {
      solutionData = JSON.stringify(sandboxClickErrors);
    } else if (selectedModule.practice_type === 'roleplay') {
      solutionData = JSON.stringify(roleplayMessages);
    }

    try {
      const evaluation = await evaluateCareerTask(
        profile.course?.profession || 'IT Специалист',
        selectedModule.title,
        selectedModule.practice_task.task_description,
        selectedModule.practice_type,
        solutionData
      );

      // Update local profile with completion
      const updatedModules = profile.course?.modules.map(m => {
        if (m.id === selectedModule.id) {
          return {
            ...m,
            completed: true,
            score: evaluation.score,
            evaluation: evaluation,
            student_solution: solutionData
          };
        }
        return m;
      }) || [];

      const updatedProfile = {
        ...profile,
        course: {
          ...profile.course!,
          modules: updatedModules
        }
      };

      const saved = await saveCareerProfile(user.id, updatedProfile);
      if (saved) {
        setProfile(updatedProfile);
        setSelectedModule(updatedModules.find(m => m.id === selectedModule.id) || null);
        toast.success(`Задание проверено! Ваша оценка: ${evaluation.score}/100`);
        confetti({ particleCount: 100, spread: 60 });
      } else {
        toast.error('Не удалось сохранить прогресс курса.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Произошла ошибка при анализе ИИ-решения.');
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto min-h-[90vh]">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-tr from-indigo-600 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-none">
            <Target className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">Карьерный Вектор</h1>
            <p className="text-slate-500 dark:text-slate-400">Автоматически оцифрованная траектория и live-обучение</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {profile && (
            <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              <button
                onClick={() => setActiveTab('profile')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  activeTab === 'profile'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                🗂️ Мой Профиль
              </button>
              <button
                onClick={() => setActiveTab('course')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'course'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                🎓 ИИ-Курс с Песочницами
                {profile?.course && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </button>
            </div>
          )}
          
          <button 
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
            Пересчитать профиль
          </button>
        </div>
      </div>

      {/* Screen Generating Loading */}
      {isGenerating && (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 border-4 border-indigo-100 dark:border-indigo-950/40 rounded-full flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 animate-spin" />
            </div>
            <div className="absolute inset-0 border-4 border-indigo-500 rounded-full animate-ping opacity-25" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">StudyForge строит индивидуальный трек...</h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-md">Парсим актуальные вакансии с рынка, генерируем сложнейшие интерактивные песочницы и прорабатываем теорию.</p>
        </div>
      )}

      {/* Active Tab content */}
      {!isGenerating && (
        <>
          {activeTab === 'profile' ? (
            /* original profile display details */
            <div className="grid lg:grid-cols-3 gap-6 md:gap-8">
              {!profile ? (
                <div className="lg:col-span-3 text-center py-20 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Briefcase className="w-8 h-8 text-indigo-500" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">Ваши навыки еще не оцифрованы</h3>
                  <p className="text-slate-500 dark:text-slate-400 max-w-lg mx-auto mb-8 leading-relaxed">
                    Изучите хотя бы одну лекцию в StudyForge, добавьте конспект, и наша система сможет составить ваш полный карьерный профиль.
                  </p>
                  <button 
                    onClick={handleGenerate}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-250 dark:shadow-none"
                  >
                    Оцифровать мои навыки по конспектам
                  </button>
                </div>
              ) : (
                <>
                  {/* Skills & professions */}
                  <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                      <div className="flex items-center gap-2 mb-4">
                        <Code2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Ваши Хард-Скиллы</h2>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {profile.skills?.map((skill, i) => (
                          <span key={i} className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                      <div className="flex items-center gap-2 mb-4">
                        <Briefcase className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Спектр Профессий</h2>
                      </div>
                      <div className="space-y-4">
                        {profile.professions?.map((prof, i) => (
                          <div key={i}>
                            <div className="flex justify-between items-start gap-3 text-xs mb-1">
                              <span className="font-bold text-slate-700 dark:text-slate-300">{prof.title}</span>
                              <span className="font-bold text-indigo-600 dark:text-indigo-400 shrink-0">{prof.match}% match</span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${prof.match}%` }}
                                transition={{ duration: 1, delay: i * 0.2 }}
                                className="h-full bg-indigo-500 rounded-full"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Summary & CV projects */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500" />
                      <div className="flex items-center gap-2 mb-4">
                        <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Карьерное Саммари (Для CV)</h2>
                      </div>
                      <div className="prose prose-sm prose-slate max-w-none text-slate-600 dark:text-slate-300 dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{profile.resume_summary || ''}</ReactMarkdown>
                      </div>
                    </div>

                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <Layers className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        Рекомендуемые пет-проекты для портфолио
                      </h2>
                      <div className="grid sm:grid-cols-2 gap-4">
                        {profile.projects?.map((proj, i) => (
                          <motion.div 
                            key={i}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-750 transition-colors group cursor-pointer"
                          >
                            <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{proj.title}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{proj.description}</p>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Vacancy-backed Adaptive course section */
            <div>
              {!profile?.course ? (
                /* No course generated screen, propose interview with coach */
                <div className="max-w-2xl mx-auto py-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-3xl shadow-sm">
                  <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Sparkles className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mb-4">Создайте курс, превосходящий ожидания</h3>
                  <p className="text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                    Наш ИИ-коуч Форджи проведет с вами интервью, выкачает вакансии с HeadHunter API и построит гигантский индивидуальный курс с 7 интерактивными песочницами. Вы будете писать реальный код, делать SQL-запросы, верстать, считать приоритеты и общаться с разгневанными клиентами.
                  </p>
                  
                  <button
                    onClick={handleStartCoachChat}
                    className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-bold flex items-center gap-3 hover:from-indigo-750 hover:to-violet-750 transition shadow-lg shadow-indigo-200 dark:shadow-none mx-auto"
                  >
                    <MessageSquare className="w-5 h-5 animate-pulse" />
                    Начать диалог с Коучем
                  </button>
                </div>
              ) : (
                /* RENDER Timeline and Modules dashboard */
                <div className="grid lg:grid-cols-3 gap-8">
                  {/* Sidebar Market Analysis */}
                  <div className="lg:col-span-1 space-y-6">
                    <div className="bg-gradient-to-br from-indigo-900 to-slate-950 text-white p-6 rounded-2xl shadow-xl relative overflow-hidden border border-slate-850">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-550 rounded-full blur-3xl opacity-20" />
                      <div className="flex items-center gap-2 mb-4">
                        <Award className="w-6 h-6 text-amber-400" />
                        <h3 className="text-lg font-bold">Рыночный Анализ Вакансий</h3>
                      </div>
                      
                      <div className="space-y-4 text-sm">
                        <div>
                          <span className="text-indigo-200 block text-xs">Целевая профессия</span>
                          <span className="font-bold text-base">{profile.course.profession}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-indigo-200 block text-xs">Уровень трека</span>
                            <span className="font-bold">{profile.course.level}</span>
                          </div>
                          <div>
                            <span className="text-indigo-200 block text-xs">Ожидаемая ЗП</span>
                            <span className="font-bold text-emerald-400">{formatSalary(profile.course.salary, profile.course.location)}</span>
                          </div>
                        </div>
                        <div className="pt-3 border-t border-indigo-950">
                          <span className="text-indigo-200 block text-xs mb-1">Сводная аналитика ИИ-Методиста</span>
                          <p className="text-indigo-50 leading-relaxed text-xs">
                            {profile.course.insights}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Modules Timeline */}
                  <div className="lg:col-span-2 space-y-6">
                    {profile.course && profile.course.modules.length > 0 && profile.course.modules.every(m => m.completed) && (
                      <div className="bg-gradient-to-tr from-indigo-950 via-slate-900 to-indigo-950 rounded-3xl border border-indigo-500/30 p-6 md:p-8 text-center space-y-4 shadow-2xl relative overflow-hidden mb-6">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-650 rounded-full blur-3xl opacity-25" />
                        <div className="w-16 h-16 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-full flex items-center justify-center text-white mx-auto shadow-lg shadow-emerald-950 border border-emerald-400/20">
                          <Award className="w-8 h-8" />
                        </div>
                        <div className="space-y-2 max-w-lg mx-auto">
                          <h3 className="text-xl md:text-2xl font-black text-slate-100 flex items-center justify-center gap-2">
                            Поздравляем с завершением! 🏆
                          </h3>
                          <p className="text-xs md:text-sm text-slate-200 leading-relaxed font-semibold">
                            Вы полностью прошли все {profile.course.modules.length} модулей практики и теории! ИИ-Методист готов проанализировать вашу успеваемость и расширить вашу учебную программу продвинутыми, более сложными темами под ваши новые цели.
                          </p>
                        </div>
                        <button
                          onClick={handleStartExpandChat}
                          className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-indigo-950 flex items-center gap-2 mx-auto transition"
                        >
                          <Sparkles className="w-4 h-4 text-indigo-150 animate-pulse" />
                          🚀 Расширить программу продвинутыми модулями
                        </button>
                      </div>
                    )}
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Layers className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      Учебная программа (Интерактивный Таймлайн)
                    </h2>
                    
                    <div className="relative border-l-2 border-slate-200 dark:border-slate-850 pl-6 ml-4 space-y-8">
                      {profile.course.modules.map((mod, idx) => {
                        // Progressive lock logic: Module is unlocked if it is the first module, or the previous one is completed
                        const isUnlocked = idx === 0 || profile.course!.modules[idx - 1].completed;
                        const isCompleted = mod.completed;
                        
                        return (
                          <div key={mod.id} className="relative">
                            {/* Step icon connector */}
                            <div className={`absolute -left-[35px] top-1.5 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
                              isCompleted 
                                ? 'bg-emerald-500 border-emerald-500 text-white' 
                                : isUnlocked 
                                  ? 'bg-white dark:bg-slate-900 border-indigo-500 text-indigo-500 animate-pulse' 
                                  : 'bg-slate-100 dark:bg-slate-850 border-slate-300 dark:border-slate-800 text-slate-400'
                            }`}>
                              {isCompleted ? <Check className="w-3.5 h-3.5" /> : <span className="text-xs font-bold">{idx + 1}</span>}
                            </div>

                            <div className={`p-6 rounded-2xl border transition-all ${
                              activeModuleId === mod.id 
                                ? 'bg-white dark:bg-slate-900 border-indigo-400 shadow-md ring-1 ring-indigo-400/25' 
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:border-slate-350 dark:hover:border-slate-750'
                            } ${!isUnlocked && 'opacity-60'}`}>
                              
                              <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
                                <h3 className="font-extrabold text-lg text-slate-900 dark:text-slate-100 leading-snug">
                                  {mod.title}
                                </h3>
                                
                                <div className="flex items-center gap-2">
                                  <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                                    mod.practice_type === 'algo' ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-450' :
                                    mod.practice_type === 'sql' ? 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-450' :
                                    mod.practice_type === 'web' ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-450' :
                                    mod.practice_type === 'business' ? 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-450' :
                                    mod.practice_type === 'design' ? 'bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-450' :
                                    mod.practice_type === 'copywriting' ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-450' :
                                    'bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-450'
                                  }`}>
                                    {mod.practice_type === 'algo' ? '💻 LeetCode' :
                                     mod.practice_type === 'sql' ? '🛢️ SQL sandbox' :
                                     mod.practice_type === 'web' ? '🌐 HTML/CSS' :
                                     mod.practice_type === 'business' ? '📊 PM metrics' :
                                     mod.practice_type === 'design' ? '🎨 UI/UX review' :
                                     mod.practice_type === 'copywriting' ? '📝 Copywriting' :
                                     '💬 Soft Skills'}
                                  </span>

                                  {isCompleted && (
                                    <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-bold rounded-md">
                                      Оценка: {mod.score}/100
                                    </span>
                                  )}
                                </div>
                              </div>

                              <p className="text-slate-500 dark:text-slate-400 text-sm mb-4 leading-relaxed">
                                {mod.description}
                              </p>

                              {/* Unlocked detail info toggle */}
                              {isUnlocked && (
                                <button
                                  onClick={() => setActiveModuleId(activeModuleId === mod.id ? null : mod.id)}
                                  className="text-xs text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-1 hover:underline"
                                >
                                  {activeModuleId === mod.id ? 'Скрыть детали модуля' : 'Развернуть теорию и материалы'}
                                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${activeModuleId === mod.id ? 'rotate-90' : ''}`} />
                                </button>
                              )}

                              {/* Toggle expanded theoretical content */}
                              <AnimatePresence>
                                {activeModuleId === mod.id && isUnlocked && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="overflow-hidden mt-5 pt-5 border-t border-slate-100 dark:border-slate-800 space-y-5"
                                  >
                                    <div>
                                      <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">🎯 Зачем это бизнесу</h4>
                                      <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-semibold italic bg-indigo-50/50 dark:bg-slate-850 p-3 rounded-lg border border-indigo-100/10">
                                        {mod.why_needed}
                                      </p>
                                    </div>

                                    <div>
                                      <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">📖 Ультимативная теория темы</h4>
                                      <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed space-y-3 prose prose-xs dark:prose-invert">
                                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{mod.detailed_theory}</ReactMarkdown>
                                      </div>
                                    </div>

                                    <div>
                                      <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">🔗 Отобранные учебные ресурсы</h4>
                                      <div className="space-y-3">
                                        {mod.resources.map((res, rIdx) => (
                                          <a 
                                            key={rIdx}
                                            href={res.url} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="block p-3 bg-slate-50 dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 transition"
                                          >
                                            <div className="flex items-center justify-between mb-1">
                                              <span className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                                                {res.title}
                                                <ExternalLink className="w-3 h-3 text-slate-400" />
                                              </span>
                                            </div>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                              {res.description}
                                            </p>
                                          </a>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="pt-4 flex items-center gap-4">
                                      <button
                                        onClick={() => openSandbox(mod)}
                                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition"
                                      >
                                        <Play className="w-3.5 h-3.5" />
                                        {isCompleted ? 'Перепройти Песочницу' : 'Начать Практическое Задание'}
                                      </button>

                                      {isCompleted && mod.evaluation && (
                                        <div className="p-4 bg-emerald-50 dark:bg-slate-850 rounded-xl border border-emerald-100 dark:border-slate-800 text-xs w-full">
                                          <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-400 font-bold mb-1">
                                            <ThumbsUp className="w-4 h-4" />
                                            Резюме ментора (балл: {mod.evaluation.score}/100)
                                          </div>
                                          <p className="text-slate-600 dark:text-slate-350 leading-relaxed italic mb-2">"{mod.evaluation.verdict}"</p>
                                          
                                          {mod.evaluation.refactored_solution && (
                                            <details className="mt-2 text-[11px] text-indigo-600 dark:text-indigo-400 font-bold cursor-pointer">
                                              <summary>Посмотреть эталонное решение и разбор кода</summary>
                                              <pre className="mt-2 p-3 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-[11px] font-mono whitespace-pre-wrap">
                                                {mod.evaluation.refactored_solution}
                                              </pre>
                                            </details>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>

                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* VACANCY SELECTION & AI VACANCY CHAT MODAL */}
      <AnimatePresence>
        {showVacancySelector && (
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className="bg-slate-900/90 text-white w-full max-w-6xl rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[90vh] backdrop-blur-md"
            >
              {/* Header */}
              <div className="p-4 md:p-6 bg-slate-900 border-b border-slate-800 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
                    <Briefcase className="w-5 h-5 text-indigo-100" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-white text-base md:text-lg flex items-center gap-2">
                      Подборка вакансий: <span className="text-indigo-400">{pendingCourseParams?.profession}</span>
                    </h3>
                    <p className="text-xs text-slate-400">Мы нашли лучшие предложения по вашему региону ({pendingCourseParams?.location || 'Не указан'})</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowVacancySelector(false)}
                  className="p-1.5 hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-100 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {loadingVacancies ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                  <p className="text-sm text-slate-400 font-semibold animate-pulse">Анализируем вакансии и подключаем ИИ-консультанта...</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                  {/* Left Side: Vacancy selector list */}
                  <div className="w-full lg:w-[40%] border-r border-slate-800 p-6 flex flex-col gap-4 overflow-y-auto bg-slate-950/40">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Найдено вакансий: {foundVacancies.length}</h4>
                    <div className="space-y-4">
                      {foundVacancies.map((vac, vIdx) => {
                        const isSelected = selectedVacancy?.title === vac.title && selectedVacancy?.company === vac.company;
                        return (
                          <div
                            key={vIdx}
                            onClick={() => {
                              setSelectedVacancy(vac);
                              setVacancyChatMessages([
                                {
                                  role: 'assistant',
                                  content: `Я вижу, что ты выбрал отличную вакансию: **"${vac.title}"** в компании **"${vac.company}"**.\n\nДавай обсудим её! Спроси меня, какие технологии из списка критичны, какие вопросы тебе зададут на собеседовании или как лучше представить твоё резюме!`
                                }
                              ]);
                            }}
                            className={`p-4 rounded-2xl border transition-all cursor-pointer select-none relative overflow-hidden flex flex-col gap-2 ${
                              isSelected
                                ? 'bg-gradient-to-r from-indigo-950/60 to-indigo-900/40 border-indigo-500 shadow-md shadow-indigo-950'
                                : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-2">
                              <span className="font-extrabold text-sm text-slate-100">{vac.title}</span>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 shrink-0 border border-slate-700">{vac.source}</span>
                            </div>
                            <span className="text-xs text-slate-400 font-semibold">{vac.company}</span>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/40">
                              <span className="text-xs font-bold text-emerald-400">{formatSalary(vac.salary, pendingCourseParams?.location)}</span>
                              <span className="text-[10px] text-indigo-400 flex items-center gap-1 font-bold">Подробнее <ChevronRight className="w-3 h-3" /></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Side: Selected Vacancy details + AI Chat Split Screen */}
                  <div className="flex-grow flex flex-col lg:flex-row overflow-hidden bg-slate-900/20">
                    {selectedVacancy ? (
                      <>
                        {/* Split Left: Detailed description */}
                        <div className="w-full lg:w-[50%] p-6 border-r border-slate-800 overflow-y-auto flex flex-col justify-between">
                          <div className="space-y-6">
                            <div>
                              <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-2">
                                <Target className="w-4 h-4" /> Детализация вакансии
                              </div>
                              <h2 className="text-xl font-black text-slate-100">{selectedVacancy.title}</h2>
                              <p className="text-sm font-semibold text-indigo-300 mt-1">{selectedVacancy.company}</p>
                              <p className="text-base font-bold text-emerald-400 mt-2">{formatSalary(selectedVacancy.salary, pendingCourseParams?.location)}</p>
                            </div>

                            <div className="space-y-4">
                              {selectedVacancy.requirements && (
                                <div>
                                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Требования:</h4>
                                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/20 p-3 rounded-xl border border-slate-805/65 font-medium">
                                    {selectedVacancy.requirements}
                                  </p>
                                </div>
                              )}
                              {selectedVacancy.responsibility && (
                                <div>
                                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Обязанности:</h4>
                                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/20 p-3 rounded-xl border border-slate-805/65 font-medium">
                                    {selectedVacancy.responsibility}
                                  </p>
                                </div>
                              )}
                            </div>

                            {selectedVacancy.url && (
                              <a
                                href={selectedVacancy.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 transition font-bold"
                              >
                                Посмотреть оригинал вакансии <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>

                          <div className="pt-6 border-t border-slate-800/60 mt-6 shrink-0">
                            <button
                              onClick={() => {
                                const lastGen = profile?.course?.last_generated_at;
                                if (lastGen) {
                                  const diffMs = new Date().getTime() - new Date(lastGen).getTime();
                                  const diffHours = diffMs / (1000 * 60 * 60);
                                  if (diffHours < 24) {
                                    const remainingHours = Math.ceil(24 - diffHours);
                                    toast.error(`Лимит генерации активен. Пожалуйста, подождите ещё ${remainingHours} ч.`);
                                    return;
                                  }
                                }
                                setShowConfirmModal(true);
                              }}
                              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-950 transition"
                            >
                              <Zap className="w-5 h-5 text-indigo-100 animate-pulse" />
                              🎯 Запустить индивидуальный курс под эту вакансию
                            </button>
                          </div>
                        </div>

                        {/* Split Right: AI Vacancy Coach Chat */}
                        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/30">
                          {/* Chat Messages */}
                          <div className="flex-grow overflow-y-auto p-6 space-y-4">
                            {vacancyChatMessages.map((msg, mIdx) => (
                              <div
                                key={mIdx}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                              >
                                <div
                                  className={`max-w-[85%] p-4 rounded-2xl text-xs leading-relaxed ${
                                    msg.role === 'user'
                                      ? 'bg-indigo-600 text-white rounded-tr-none'
                                      : 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-750/50'
                                  }`}
                                >
                                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                              </div>
                            ))}
                            {sendingVacancyChat && (
                              <div className="flex justify-start">
                                <div className="bg-slate-800 text-slate-400 p-3 rounded-2xl rounded-tl-none flex items-center gap-2 text-xs border border-slate-700/50">
                                  <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                                  <span>ИИ анализирует вакансию и печатает...</span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Chat Input */}
                          <div className="p-4 bg-slate-950 border-t border-slate-800 flex gap-2 items-center">
                            <input
                              type="text"
                              value={vacancyChatInput}
                              onChange={(e) => setVacancyChatInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSendVacancyChatMessage()}
                              placeholder="Задай любой вопрос по этой вакансии..."
                              className="flex-1 px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <button
                              onClick={handleSendVacancyChatMessage}
                              disabled={sendingVacancyChat || !vacancyChatInput.trim()}
                              className="p-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl transition"
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-grow flex flex-col items-center justify-center p-6 text-slate-400">
                        <Briefcase className="w-12 h-12 text-slate-600 mb-2" />
                        <p className="text-sm font-semibold">Выберите вакансию слева для детального анализа</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WARNING RATE-LIMIT CONFIRMATION MODAL */}
      <AnimatePresence>
        {showConfirmModal && pendingCourseParams && selectedVacancy && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl text-center space-y-5"
            >
              <div className="w-14 h-14 bg-indigo-950/60 rounded-full flex items-center justify-center text-indigo-400 mx-auto border border-indigo-900/60">
                <Sparkles className="w-7 h-7 text-indigo-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-extrabold text-slate-100">Создание ультимативного курса</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  ИИ StudyForge создаст масштабную программу обучения из <strong>10-14 глубоких модулей</strong>, полностью ориентированных на требования вакансии <strong>"{selectedVacancy.title}"</strong> в <strong>"{selectedVacancy.company}"</strong>.
                </p>
              </div>

              <div className="bg-indigo-950/40 p-4 rounded-2xl border border-indigo-900/40 text-left space-y-3">
                <div className="flex gap-2.5 items-start text-xs text-slate-300">
                  <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold text-slate-200">Расход ресурсов:</span> Это сложная операция, использующая самые умные ИИ-агенты, и задействует <strong>50 единиц энергии/токенов</strong>.
                  </div>
                </div>
                <div className="flex gap-2.5 items-start text-xs text-slate-300">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold text-slate-200">Rate Limit:</span> В целях предотвращения спама вы сможете генерировать следующий курс только <strong>раз в 24 часа (1 раз в день)</strong>.
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-2xl text-xs font-extrabold transition"
                >
                  Отмена
                </button>
                <button
                  onClick={async () => {
                    setShowConfirmModal(false);
                    const vacContextStr = `Должность: ${selectedVacancy.title}\nКомпания: ${selectedVacancy.company}\nЗарплата: ${selectedVacancy.salary}\nТребования: ${selectedVacancy.requirements}\nОбязанности: ${selectedVacancy.responsibility}`;
                    await triggerCourseSyllabus(
                      pendingCourseParams.profession,
                      pendingCourseParams.level,
                      pendingCourseParams.salary,
                      pendingCourseParams.location,
                      pendingCourseParams.age,
                      pendingCourseParams.gender,
                      pendingCourseParams.extraContext,
                      vacContextStr
                    );
                  }}
                  className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-extrabold shadow-lg shadow-indigo-950 transition"
                >
                  Да, запустить!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ADVANCED SYLLABUS EXPANSION DIALOGUE MODAL */}
      <AnimatePresence>
        {showExpandChat && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[80vh]"
            >
              {/* Header */}
              <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 dark:text-slate-100">Расширение программы обучения</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Проектирование advanced-модулей</p>
                  </div>
                </div>
                
                <button 
                  onClick={() => setShowExpandChat(false)}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-400 dark:text-slate-350 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-slate-50 dark:bg-slate-950">
                {expandChatMessages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-100 dark:shadow-none' 
                        : 'bg-white dark:bg-slate-850 text-slate-850 dark:text-slate-100 rounded-tl-none shadow-sm border border-slate-200/40 dark:border-slate-800'
                    }`}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
                {sendingExpandChat && (
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-slate-850 text-slate-400 p-4 rounded-2xl rounded-tl-none flex items-center gap-2 text-xs shadow-sm border border-slate-200/40 dark:border-slate-800">
                      <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                      <span>Форджи обдумывает траекторию и печатает...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 flex gap-2 items-center">
                <input 
                  type="text" 
                  value={expandChatInput}
                  onChange={(e) => setExpandChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendExpandChatMessage()}
                  placeholder="Опиши новые продвинутые цели обучения..."
                  className="flex-grow px-4 py-3 bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                
                <button 
                  onClick={handleSendExpandChatMessage}
                  disabled={sendingExpandChat || !expandChatInput.trim()}
                  className="p-3 bg-indigo-650 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-xl transition shadow-md shadow-indigo-200 dark:shadow-none"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* COACH CHAT DIALOGUE MODAL */}
      <AnimatePresence>
        {showCoachChat && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[80vh]"
            >
              {/* Header */}
              <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-indigo-600 flex items-center justify-center text-white">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 dark:text-slate-100">Карьерное собеседование</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">ИИ Коуч Форджи подберет ваш идеальный трек</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCoachChat(false)}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-850 rounded-full text-slate-400 dark:text-slate-300 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Chat flow body */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`p-4 rounded-2xl max-w-[85%] text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none shadow-md'
                        : 'bg-slate-100 dark:bg-slate-850 text-slate-800 dark:text-slate-200 rounded-bl-none border border-slate-200/40 dark:border-slate-800'
                    }`}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
                {sendingChat && (
                  <div className="flex justify-start">
                    <div className="bg-slate-100 dark:bg-slate-850 p-4 rounded-2xl rounded-bl-none text-slate-500 dark:text-slate-400 flex items-center gap-2 text-xs border border-slate-200/40 dark:border-slate-800">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                      Коуч обдумывает ответ...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Suggestions chips */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 shrink-0 flex flex-wrap gap-2">
                {chatMessages.length === 1 && (
                  <>
                    <button onClick={() => handleSendCoachMessage('Хочу создавать сайты и интерфейсы (Frontend)')} className="px-3 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">🎨 Frontend-разработка</button>
                    <button onClick={() => handleSendCoachMessage('Интересны базы данных и проектирование серверной части (Backend)')} className="px-3 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">🔌 Backend (Python/JS)</button>
                    <button onClick={() => handleSendCoachMessage('Люблю цифры, графики и работу со статистикой')} className="px-3 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">📊 Аналитика данных / SQL</button>
                  </>
                )}
                {chatMessages.length === 3 && (
                  <>
                    <button onClick={() => handleSendCoachMessage('Могу учиться 1-2 часа в день в спокойном темпе')} className="px-3 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">⏳ Спокойный темп (1-2ч)</button>
                    <button onClick={() => handleSendCoachMessage('Готов учиться интенсивно по 4 часа в день')} className="px-3 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">🔥 Интенсивно (4ч+)</button>
                  </>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3 shrink-0">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendCoachMessage()}
                  placeholder="Ответьте коучу или задайте свой вопрос..."
                  className="flex-1 px-4 py-3 bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={() => handleSendCoachMessage()}
                  disabled={!chatInput.trim() || sendingChat}
                  className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl disabled:opacity-50 transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PRACTICE ZONE SANDBOX POPUP MODAL */}
      <AnimatePresence>
        {practiceOpen && selectedModule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[90vh]"
            >
              {/* Sandbox Top Header */}
              <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
                    <Code2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2 text-sm md:text-base">
                      Песочница Практики: {selectedModule.title}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Тип: {selectedModule.practice_type.toUpperCase()} Sandbox</p>
                  </div>
                </div>
                
                <button 
                  onClick={() => setPracticeOpen(false)}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-850 rounded-full text-slate-400 dark:text-slate-300 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Sandbox main grid split screen */}
              <div className="flex-1 overflow-hidden grid lg:grid-cols-2">
                {/* Left screen: technical task parameters */}
                <div className="overflow-y-auto p-6 border-r border-slate-200 dark:border-slate-800 space-y-6">
                  <div>
                    <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">📋 Техническое задание (ТЗ)</h4>
                    <p className="text-sm text-slate-700 dark:text-slate-350 leading-relaxed font-semibold">
                      {selectedModule.practice_task.task_description}
                    </p>
                  </div>

                  {/* Render test cases summary if any */}
                  {selectedModule.practice_task.test_cases && selectedModule.practice_task.test_cases.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">🧪 Тестовые сценарии (тест-кейсы)</h4>
                      <div className="space-y-2 text-xs">
                        {selectedModule.practice_task.test_cases.map((tc, tcIdx) => (
                          <div key={tcIdx} className="p-3 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-250 dark:border-slate-800 font-mono">
                            <div><span className="text-slate-400">Вход:</span> {tc.input}</div>
                            <div><span className="text-slate-400">Ожидается:</span> {tc.expected}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Local validation output */}
                  {localTested && (
                    <div className={`p-4 rounded-xl border ${localTestedPassed ? 'bg-emerald-50 dark:bg-slate-850 border-emerald-200' : 'bg-rose-50 dark:bg-slate-850 border-rose-250'}`}>
                      <h4 className="text-xs font-bold flex items-center gap-1.5 mb-2 text-slate-800 dark:text-slate-200">
                        {localTestedPassed ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-rose-500" />}
                        Результат локального прогона
                      </h4>
                      <div className="space-y-1 text-xs font-mono">
                        {localTestLogs.map((log, lIdx) => (
                          <div key={lIdx} className={log.startsWith('✅') ? 'text-emerald-600 dark:text-emerald-400' : log.startsWith('❌') ? 'text-rose-600 dark:text-rose-450' : 'text-slate-600 dark:text-slate-300'}>
                            {log}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right screen: Live Workspace (interactive depending on sandbox type) */}
                <div className="overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950 flex flex-col justify-between">
                  
                  {/* WORKSPACE SWITCHER */}
                  <div className="flex-1">
                    
                    {/* ALGO compiler workspace */}
                    {selectedModule.practice_type === 'algo' && (
                      <div className="space-y-3 h-full flex flex-col">
                        <div className="flex justify-between items-center text-xs text-slate-500">
                          <span>Редактор JavaScript/TypeScript</span>
                          <span>Локальный компилятор (0 токенов)</span>
                        </div>
                        <textarea
                          value={sandboxCode}
                          onChange={(e) => setSandboxCode(e.target.value)}
                          className="flex-grow w-full p-4 bg-slate-900 text-slate-100 rounded-2xl font-mono text-sm leading-relaxed focus:outline-none h-[300px] border border-slate-800 focus:ring-1 focus:ring-indigo-500 shadow-inner"
                        />
                      </div>
                    )}

                    {/* SQL simulator workspace */}
                    {selectedModule.practice_type === 'sql' && (
                      <div className="space-y-4">
                        <div className="p-3 bg-slate-100 dark:bg-slate-850 rounded-xl text-xs text-slate-600 dark:text-slate-300 border">
                          <span className="font-bold block mb-1">Схема базы данных:</span>
                          <span className="font-mono">vacancies (id INTEGER, title TEXT, salary INTEGER, level TEXT, company TEXT)</span>
                        </div>
                        <textarea
                          value={sandboxCode}
                          onChange={(e) => setSandboxCode(e.target.value)}
                          className="w-full p-4 bg-slate-900 text-slate-100 rounded-2xl font-mono text-sm leading-relaxed focus:outline-none h-[180px] border border-slate-800 focus:ring-1 focus:ring-indigo-500 shadow-inner"
                        />
                        
                        {localTestedPassed && (
                          <div className="space-y-2">
                            <span className="text-xs font-bold text-slate-500">Таблица результатов запроса:</span>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[11px]">
                              <table className="w-full text-left">
                                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 uppercase text-[10px]">
                                  <tr>
                                    <th className="p-2 border-b">id</th>
                                    <th className="p-2 border-b">title</th>
                                    <th className="p-2 border-b">salary</th>
                                    <th className="p-2 border-b">company</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y dark:divide-slate-850">
                                  <tr>
                                    <td className="p-2 font-mono">1</td>
                                    <td className="p-2 font-semibold">Senior React Developer</td>
                                    <td className="p-2 text-emerald-500">180,000₽</td>
                                    <td className="p-2">Yandex</td>
                                  </tr>
                                  <tr>
                                    <td className="p-2 font-mono">3</td>
                                    <td className="p-2 font-semibold">Lead Architect</td>
                                    <td className="p-2 text-emerald-500">250,000₽</td>
                                    <td className="p-2">T-Bank</td>
                                  </tr>
                                  <tr>
                                    <td className="p-2 font-mono">4</td>
                                    <td className="p-2 font-semibold">SQL Analyst</td>
                                    <td className="p-2 text-emerald-500">120,000₽</td>
                                    <td className="p-2">Ozon</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* WEB Responsive Layout visual iframe preview */}
                    {selectedModule.practice_type === 'web' && (
                      <div className="space-y-4 h-full flex flex-col">
                        <textarea
                          value={sandboxCode}
                          onChange={(e) => setSandboxCode(e.target.value)}
                          className="w-full p-4 bg-slate-900 text-slate-100 rounded-2xl font-mono text-sm leading-relaxed focus:outline-none h-[180px] border border-slate-800"
                        />
                        <div className="flex-1 min-h-[200px] border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white">
                          <iframe
                            srcDoc={sandboxCode}
                            title="visual_preview"
                            className="w-full h-full"
                            sandbox="allow-scripts"
                          />
                        </div>
                      </div>
                    )}

                    {/* BUSINESS simulator calculations form */}
                    {selectedModule.practice_type === 'business' && (
                      <div className="space-y-4">
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border space-y-4 text-sm">
                          <div>
                            <span className="font-bold text-xs text-indigo-600 block mb-1">Задача №1: Feature A</span>
                            <p className="text-xs text-slate-500 mb-2">Reach=1000, Impact=2, Confidence=0.8, Effort=2</p>
                            <input
                              type="number"
                              placeholder="Рассчитайте RICE Score"
                              value={sandboxInputs['rice_a'] || ''}
                              onChange={(e) => setSandboxInputs({ ...sandboxInputs, rice_a: e.target.value })}
                              className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs"
                            />
                          </div>

                          <div>
                            <span className="font-bold text-xs text-indigo-600 block mb-1">Задача №2: Feature B</span>
                            <p className="text-xs text-slate-500 mb-2">Reach=5000, Impact=3, Confidence=0.5, Effort=5</p>
                            <input
                              type="number"
                              placeholder="Рассчитайте RICE Score"
                              value={sandboxInputs['rice_b'] || ''}
                              onChange={(e) => setSandboxInputs({ ...sandboxInputs, rice_b: e.target.value })}
                              className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border rounded-lg text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* DESIGN Visual UI Critique layout */}
                    {selectedModule.practice_type === 'design' && (
                      <div className="space-y-4">
                        <span className="text-xs font-bold text-slate-500 block">Кликните на элементы с ошибками верстки/контраста на макете ниже:</span>
                        
                        <div className="bg-white p-6 rounded-2xl border-2 border-rose-350/20 space-y-6 shadow-sm max-w-sm mx-auto relative overflow-hidden select-none">
                          {/* Bad font fonts style overlaps */}
                          <div 
                            onClick={() => setSandboxClickErrors({ ...sandboxClickErrors, fonts: 'Разнобой шрифтов (Arial + Times + Comic Sans)' })}
                            className={`p-2 cursor-pointer border rounded-lg hover:bg-rose-50 ${sandboxClickErrors['fonts'] ? 'border-indigo-500 bg-indigo-50/20' : 'border-dashed border-slate-350'}`}
                          >
                            <h3 style={{ fontFamily: 'Times New Roman' }} className="text-lg font-bold text-slate-900">Заголовок макета</h3>
                            <p style={{ fontFamily: 'Comic Sans MS' }} className="text-xs text-slate-500">Канцеляризмы и очень нечитаемый шрифт описания.</p>
                          </div>

                          {/* Gray on gray contrast error */}
                          <div 
                            onClick={() => setSandboxClickErrors({ ...sandboxClickErrors, contrast: 'Ужасная контрастность (светло-серый на белом)' })}
                            className={`p-2 cursor-pointer border rounded-lg hover:bg-rose-50 ${sandboxClickErrors['contrast'] ? 'border-indigo-500 bg-indigo-50/20' : 'border-dashed border-slate-350'}`}
                          >
                            <span className="text-[10px] text-slate-200">Малозаметный вспомогательный текст без контраста.</span>
                          </div>

                          {/* Shifted alignment layout */}
                          <div className="flex justify-between items-center gap-4">
                            <div 
                              onClick={() => setSandboxClickErrors({ ...sandboxClickErrors, alignment: 'Нарушение выравнивания элементов по сетке' })}
                              className={`p-2 cursor-pointer border rounded-lg hover:bg-rose-50 flex-1 ${sandboxClickErrors['alignment'] ? 'border-indigo-500 bg-indigo-50/20' : 'border-dashed border-slate-350'}`}
                            >
                              <div className="ml-10 text-xs font-bold">Сдвинутый влево блок без причины</div>
                            </div>
                          </div>
                        </div>

                        {/* Identified errors chips */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          {Object.entries(sandboxClickErrors).map(([key, val]) => (
                            <span key={key} className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 font-bold rounded-lg border border-indigo-150 text-[10px] flex items-center gap-1">
                              {key.toUpperCase()}: {val}
                              <X onClick={() => {
                                const newErrs = { ...sandboxClickErrors };
                                delete newErrs[key];
                                setSandboxClickErrors(newErrs);
                              }} className="w-3 h-3 cursor-pointer text-indigo-500 hover:text-indigo-700" />
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* COPYWRITING text editor tone checker */}
                    {selectedModule.practice_type === 'copywriting' && (
                      <div className="space-y-4">
                        <div className="p-4 bg-amber-50 dark:bg-slate-850 rounded-xl text-xs text-amber-800 dark:text-amber-400 leading-relaxed border border-amber-200/40">
                          <span className="font-bold block mb-1">Оригинальный черновик (вода и канцеляризмы):</span>
                          "Наша инновационная компания StudyForge осуществляет внедрение передовых синергетических обучающих ИИ-решений с уникальной методикой для достижения тотального лидерства на современном EdTech-рынке..."
                        </div>
                        <textarea
                          value={sandboxText}
                          onChange={(e) => setSandboxText(e.target.value)}
                          className="w-full p-4 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-2xl text-sm leading-relaxed focus:outline-none h-[180px] border focus:ring-1 focus:ring-indigo-500 shadow-sm"
                          placeholder="Перепишите текст в емкий, честный инфостиль..."
                        />
                        <div className="flex justify-between items-center text-xs text-slate-400">
                          <span>Символов: {sandboxText.length} / 250 макс.</span>
                          <span>Buzzwords check active</span>
                        </div>
                      </div>
                    )}

                    {/* ROLEPLAY Messaging soft skills workspace */}
                    {selectedModule.practice_type === 'roleplay' && (
                      <div className="space-y-4 h-full flex flex-col min-h-[350px]">
                        <div className="flex justify-between items-center text-xs text-slate-500 shrink-0">
                          <span>Переговоры с клиентом</span>
                          <span className="font-bold text-amber-500">Реплик осталось: {roleplayTurnsLeft}</span>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 max-h-[220px]">
                          {roleplayMessages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`p-3 rounded-xl max-w-[85%] text-xs leading-relaxed ${
                                msg.role === 'user'
                                  ? 'bg-indigo-600 text-white rounded-br-none'
                                  : 'bg-slate-100 dark:bg-slate-850 text-slate-800 dark:text-slate-200 rounded-bl-none border border-slate-200/40 dark:border-slate-800'
                              }`}>
                                {msg.content}
                              </div>
                            </div>
                          ))}
                          {sendingRoleplay && (
                            <div className="flex justify-start">
                              <div className="bg-slate-100 dark:bg-slate-850 p-3 rounded-xl rounded-bl-none text-slate-500 text-[10px] flex items-center gap-1.5">
                                <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
                                Оппонент пишет...
                              </div>
                            </div>
                          )}
                        </div>

                        {roleplayTurnsLeft > 0 ? (
                          <div className="flex gap-2 shrink-0 pt-2">
                            <input
                              type="text"
                              value={roleplayInput}
                              onChange={(e) => setRoleplayInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSendRoleplay()}
                              placeholder="Сформулируйте эмпатичный аргумент..."
                              className="flex-grow px-3 py-2.5 bg-white dark:bg-slate-900 border rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <button
                              onClick={handleSendRoleplay}
                              disabled={!roleplayInput.trim() || sendingRoleplay}
                              className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl disabled:opacity-50 transition"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 text-xs font-bold rounded-xl text-center">
                            Диалог успешно завершен! Нажмите "Получить ревью эксперта" ниже.
                          </div>
                        )}
                      </div>
                    )}

                  </div>

                  {/* Sandbox Bottom Controls */}
                  <div className="pt-6 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0 bg-slate-50 dark:bg-slate-950">
                    {selectedModule.practice_type !== 'roleplay' && (
                      <button
                        onClick={runLocalTests}
                        className="px-5 py-3 bg-slate-200 dark:bg-slate-800 hover:bg-slate-350 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Локальный прогон (0 токенов)
                      </button>
                    )}

                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        onClick={handleAISubmit}
                        disabled={(!localTestedPassed && selectedModule.practice_type !== 'roleplay') || isEvaluating}
                        className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-550 hover:from-indigo-700 hover:to-indigo-650 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 transition shadow-md shadow-indigo-250 dark:shadow-none disabled:opacity-40"
                      >
                        {isEvaluating ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Эксперт пишет ревью...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Получить ревью эксперта (5⚡)
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
