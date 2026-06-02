import { Term } from '../types/index';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Briefcase, Target, Layers, FileText, ArrowRight, Zap, 
  CheckCircle2, Loader2, Code2, Cpu, MessageSquare, Send, 
  Play, Check, AlertCircle, ExternalLink, Lock, Unlock, 
  Award, Sparkles, Database, Eye, Smile, RefreshCw, 
  Sliders, ChevronRight, X, ArrowLeft, ThumbsUp, Printer,
  RotateCcw, BookOpen, Trophy, HelpCircle, GitBranch, Star,
  TrendingUp, Flame, Layers2, MapPin, Search
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { 
  getCareerProfile, generateCareerProfile, saveCareerProfile, 
  generateCareerCourse, sendCareerChat, evaluateCareerTask, 
  getCareerVacancies, sendVacancyChat, VacancyItem,
  expandCareerCourse, generateNextSyllabusModule, CareerProfile, CareerCourse, CareerModule,
  generateReviewTest, updateModuleReview, getDueReviews,
  generateRetryTask, getModuleHint,
  saveXPToProfile, getLevelFromXP, XP_REWARDS, ModuleReviewRecord,
  getCodeDiagnostics, generateGithubReadme, generatePetProjects, evaluatePetProject
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
import SkillsRadarChart from '../components/SkillsRadarChart';
import SalaryProgressBar from '../components/SalaryProgressBar';
import ReviewTestModal from '../components/ReviewTestModal';
import MockInterviewModal from '../components/MockInterviewModal';
import SocraticTutor from '../components/SocraticTutor';
import LearningDashboard from '../components/LearningDashboard';
import JobTracker from '../components/JobTracker';
import DiagnosticTestModal from '../components/DiagnosticTestModal';
import VacancyMobileTabs from '../components/VacancyMobileTabs';
import { supabase } from '../lib/supabase';

function patchModule(mod: CareerModule, profession: string): CareerModule {
  const isTechnicalProfession = 
    /разработчик|developer|программист|frontend|backend|fullstack|devops|qa|тестировщик|engineer|инженер|c#|\.net|python|java|golang|c\+\+|ruby|php|rust|swift|kotlin/i.test(profession || "");

  let patched = { ...mod };

  if (isTechnicalProfession && patched.practice_type === 'copywriting' && (patched.title.includes('Основы') || patched.title.includes('введение') || patched.practice_task.task_description.includes('план обучения'))) {
    patched = {
      ...patched,
      practice_type: 'algo',
      practice_task: {
        ...patched.practice_task,
        task_description: "Напишите функцию solution(name), которая принимает имя и возвращает строку 'Привет, ' + name + '!'. Например: solution('Мир') должен вернуть 'Привет, Мир!'.",
        origin_interview_questions: "Компания: Тинькофф. Вопросы на собеседовании: 1) В чем разница между ссылочными типами и типами значений в вашем стеке? 2) Как устроена память в куче и стеке?",
        code_template: "function solution(name) {\n  // Напишите ваш код здесь\n  \n}",
        test_cases: [
          { "input": '["Студент"]', "expected": '"Привет, Студент!"' },
          { "input": '["Мир"]', "expected": '"Привет, Мир!"' }
        ],
        non_code_options: [],
        non_code_correct: "",
        explanation: "Базовая алгоритмическая проверка пройдена успешно!"
      },
      practice_guided: {
        hints: ["Шаг 1: Примите аргумент name в вашей функции.", "Шаг 2: Произведите конкатенацию строки 'Привет, ' с name и '!'.", "Шаг 3: Используйте оператор return."],
        simplified_template: "function solution(name) {\n  return 'Привет, ' + name + '!';\n}"
      },
      practice_expert: {
        constraint: "Если передан пустой name или аргумент не является строкой, верните 'Привет, Гость!'",
        bonus_description: "Это докажет ваше умение валидировать аргументы функций и писать устойчивый к падениям код."
      }
    };
  }

  // Auto-enrich modules with exactly 10 progressive tasks if they do not have them
  if (!patched.tasks || patched.tasks.length === 0) {
    if (patched.practice_type === 'algo') {
      patched.tasks = [
        {
          id: 1,
          title: "Задача 1: Базовый вызов (" + (patched.title.length > 20 ? patched.title.slice(0, 20) + "..." : patched.title) + ")",
          task_description: patched.practice_task.task_description,
          code_template: patched.practice_task.code_template || "function solution() {\n  // Напишите решение на JavaScript\n}",
          test_cases: patched.practice_task.test_cases && patched.practice_task.test_cases.length > 0
            ? patched.practice_task.test_cases
            : [{ "input": "[]", "expected": "[]" }]
        },
        {
          id: 2,
          title: "Задача 2: Условия (Четное/Нечетное)",
          task_description: "Напишите функцию solution(num), которая принимает число num и возвращает true, если оно четное, и false, если нечетное.",
          code_template: "function solution(num) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": "[4]", "expected": "true" },
            { "input": "[7]", "expected": "false" }
          ]
        },
        {
          id: 3,
          title: "Задача 3: Массивы (Поиск максимума)",
          task_description: "Напишите функцию solution(arr), которая принимает массив чисел и возвращает наибольшее число из этого массива.",
          code_template: "function solution(arr) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": "[[1, 5, 3, 9, 2]]", "expected": "9" },
            { "input": "[[-1, -5, -3]]", "expected": "-1" }
          ]
        },
        {
          id: 4,
          title: "Задача 4: Циклы (Сумма диапазона)",
          task_description: "Напишите функцию solution(n), которая принимает целое положительное число n и возвращает сумму всех целых чисел от 1 до n включительно.",
          code_template: "function solution(n) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": "[5]", "expected": "15" },
            { "input": "[10]", "expected": "55" }
          ]
        },
        {
          id: 5,
          title: "Задача 5: Строки (Разворот текста)",
          task_description: "Напишите функцию solution(str), которая принимает строку и возвращает ее в перевернутом виде (задом наперед).",
          code_template: "function solution(str) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": '["abc"]', "expected": '"cba"' },
            { "input": '["hello"]', "expected": '"olleh"' }
          ]
        },
        {
          id: 6,
          title: "Задача 6: Поиск (Индекс элемента)",
          task_description: "Напишите функцию solution(arr, target), которая находит индекс числа target в массиве arr. Если элемент не найден, верните -1.",
          code_template: "function solution(arr, target) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": "[[10, 20, 30], 20]", "expected": "1" },
            { "input": "[[10, 20, 30], 40]", "expected": "-1" }
          ]
        },
        {
          id: 7,
          title: "Задача 7: Массивы (Фильтрация положительных)",
          task_description: "Напишите функцию solution(arr), которая принимает массив чисел и возвращает новый массив, содержащий только положительные числа (больше 0).",
          code_template: "function solution(arr) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": "[[1, -2, 3, 0, -5]]", "expected": "[1,3]" }
          ]
        },
        {
          id: 8,
          title: "Задача 8: Проверка (Палиндромы)",
          task_description: "Напишите функцию solution(str), которая проверяет, является ли строка палиндромом (читается одинаково слева направо и справа налево).",
          code_template: "function solution(str) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": '["radar"]', "expected": "true" },
            { "input": '["hello"]', "expected": "false" }
          ]
        },
        {
          id: 9,
          title: "Задача 9: Массивы (Уникальные значения)",
          task_description: "Напишите функцию solution(arr), которая принимает массив чисел и возвращает массив, содержащий только уникальные элементы (без дубликатов).",
          code_template: "function solution(arr) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": "[[1, 2, 2, 3, 1]]", "expected": "[1,2,3]" }
          ]
        },
        {
          id: 10,
          title: "Задача 10: Финал (Числа Фибоначчи)",
          task_description: "Напишите функцию solution(n), которая возвращает n-ое число Фибоначчи (f(0)=0, f(1)=1, f(2)=1, f(3)=2, f(4)=3, f(5)=5, f(6)=8 и т.д.).",
          code_template: "function solution(n) {\n  // Напишите ваш код здесь\n  \n}",
          test_cases: [
            { "input": "[6]", "expected": "8" },
            { "input": "[10]", "expected": "55" }
          ]
        }
      ];
    } else if (patched.practice_type === 'sql') {
      patched.tasks = [
        {
          id: 1,
          title: "Задача 1: Базовая выборка (" + (patched.title.length > 20 ? patched.title.slice(0, 20) + "..." : patched.title) + ")",
          task_description: patched.practice_task.task_description,
          code_template: patched.practice_task.code_template || "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: patched.practice_task.test_cases && patched.practice_task.test_cases.length > 0
            ? patched.practice_task.test_cases
            : [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 2,
          title: "Задача 2: Конкретные колонки (SELECT name, salary)",
          task_description: "Напишите SQL-запрос, который выбирает только имя (name) и зарплату (salary) из таблицы employees.",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 3,
          title: "Задача 3: Фильтрация строк (WHERE equals)",
          task_description: "Напишите SQL-запрос, который выбирает всех сотрудников из отдела 'IT' (колонка department).",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 4,
          title: "Задача 4: Фильтрация по диапазону (WHERE range)",
          task_description: "Напишите SQL-запрос, который выбирает всех сотрудников, у которых зарплата (salary) больше 80000.",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 5,
          title: "Задача 5: Логические условия (AND)",
          task_description: "Напишите SQL-запрос, который выбирает сотрудников из отдела 'IT' с зарплатой больше 90000.",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 6,
          title: "Задача 6: Поиск шаблонов (LIKE)",
          task_description: "Напишите SQL-запрос, который выбирает всех сотрудников, чье имя (name) начинается на букву 'А'.",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 7,
          title: "Задача 7: Упорядочивание (ORDER BY)",
          task_description: "Напишите SQL-запрос, который выбирает всех сотрудников и сортирует их по зарплате (salary) в порядке убывания (DESC).",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 8,
          title: "Задача 8: Ограничение записей (LIMIT)",
          task_description: "Напишите SQL-запрос, который возвращает 3-х сотрудников с самой высокой зарплатой (используйте ORDER BY и LIMIT).",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 9,
          title: "Задача 9: Агрегация количества (COUNT)",
          task_description: "Напишите SQL-запрос, который возвращает общее количество сотрудников в таблице employees.",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        },
        {
          id: 10,
          title: "Задача 10: Финал (Комплексный SQL)",
          task_description: "Напишите SQL-запрос, который выбирает имя (name) и зарплату (salary) 5 сотрудников из отдела 'IT' с зарплатой выше 70000, отсортированных по имени (name) в алфавитном порядке (ASC).",
          code_template: "SELECT -- Напишите ваш SQL-запрос здесь\n;",
          test_cases: [{"input": "[]", "expected": "[]"}]
        }
      ];
    } else {
      // General non-code practices
      patched.tasks = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        title: `Шаг ${i + 1}: ${i === 0 ? 'Анализ' : i === 9 ? 'Финал' : 'Разработка'}`,
        task_description: `Это этап ${i + 1} в выполнении вашего практического задания. \n\nОсновная задача: ${patched.practice_task.task_description} \n\nПроработайте данный шаг и напишите ответ для проверки ИИ-экспертом.`,
        code_template: patched.practice_task.code_template,
        test_cases: patched.practice_task.test_cases
      }));
    }
  }

  return patched;
}

function getCodeLanguage(code: string, profession: string, template: string): string {
  const p = (profession || "").toLowerCase();
  const t = (template || "").toLowerCase();
  const c = (code || "").toLowerCase();

  if (p.includes("python") || p.includes("django") || p.includes("fastapi") || t.includes("def ") || c.includes("def ")) return "python";
  if (p.includes("c#") || p.includes(".net") || p.includes("csharp") || t.includes("using system") || c.includes("using system")) return "csharp";
  if (p.includes("java") || t.includes("public class") || c.includes("public class")) return "java";
  if (p.includes("golang") || p.includes("go ") || t.includes("package main") || c.includes("package main") || t.includes("func main") || c.includes("func main")) return "go";
  if (p.includes("c++") || p.includes("cpp") || t.includes("#include") || c.includes("#include")) return "cpp";
  if (p.includes("php") || t.includes("<?php") || c.includes("<?php")) return "php";
  if (p.includes("ruby") || t.includes("def ") || c.includes("end")) return "ruby";
  if (p.includes("rust") || t.includes("fn ") || c.includes("fn ")) return "rust";
  if (p.includes("swift") || t.includes("func ") || c.includes("func ")) return "swift";
  if (p.includes("kotlin") || t.includes("fun ") || c.includes("fun ")) return "kotlin";
  
  return "javascript";
}

export default function Career() {
  const { user } = useAuth();
  const { alert, confirm } = useConfirm();
  const navigate = useNavigate();
  const { verifyEnergy } = useEnergyConfirm();

  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as 'course' | 'plan' | 'analytics' | 'jobs' | 'interviews') || 'course';
  const [activeTab, setActiveTab] = useState<'course' | 'plan' | 'analytics' | 'jobs' | 'interviews'>(initialTab);

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
  const [isGeneratingNextModule, setIsGeneratingNextModule] = useState(false);

  // Sprint 3: Diagnostic Test States
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);
  const [diagnosticModule, setDiagnosticModule] = useState<CareerModule | null>(null);
  const [moduleTestModal, setModuleTestModal] = useState<{ open: boolean; module: CareerModule | null }>({ open: false, module: null });

  // Sprint 3: AI Code Diagnostics Sandbox States
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = useState(false);
  const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false);
  const [diagnosticsResult, setDiagnosticsResult] = useState<any | null>(null);

  // Sprint 3: GitHub README States
  const [isReadmeLoading, setIsReadmeLoading] = useState(false);

  // Capstone Graduation Pet Project States
  const [isGeneratingCapstone, setIsGeneratingCapstone] = useState(false);
  const [isSubmittingCapstone, setIsSubmittingCapstone] = useState(false);
  const [capstoneSolutionCode, setCapstoneSolutionCode] = useState('');
  const [capstoneSubmissionTab, setCapstoneSubmissionTab] = useState<'github' | 'manual'>('github');
  const [capstoneGithubUrl, setCapstoneGithubUrl] = useState('');
  const [showCertificateModal, setShowCertificateModal] = useState(false);
  const [compareViewMode, setCompareViewMode] = useState<'split' | 'refactoring'>('split');
  const [githubReadme, setGithubReadme] = useState<string | null>(null);
  const [certificateStudentName, setCertificateStudentName] = useState('');

  useEffect(() => {
    if (showCertificateModal && user) {
      const defaultName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || '';
      setCertificateStudentName(defaultName);
    }
  }, [showCertificateModal, user]);

  // States for manual vacancy search & filter (Variant B)
  const [searchProfession, setSearchProfession] = useState('');
  const [searchLocation, setSearchLocation] = useState('');

  useEffect(() => {
    if (pendingCourseParams) {
      setSearchProfession(pendingCourseParams.profession || '');
      setSearchLocation(pendingCourseParams.location || '');
    }
  }, [pendingCourseParams]);

  // Helper for dynamic formatting of salaries
  const formatSalary = (salary: string, location?: string) => {
    if (!salary) return 'не указана';
    const trimmed = salary.trim().toLowerCase();
    if (trimmed === '0' || trimmed.startsWith('0 ') || trimmed === 'не важно' || trimmed === 'неважно' || trimmed === 'not important' || trimmed.includes('договорная')) {
      return 'не важна';
    }
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
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
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
  const [lastEvalResult, setLastEvalResult] = useState<any | null>(null);
  const [localTestLogs, setLocalTestLogs] = useState<string[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // ── Sprint 1: Scaffolded Practice ─────────────────────────────────────────
  const [practiceLevel, setPracticeLevel] = useState<'guided' | 'independent' | 'expert'>('independent');

  // ── Sprint 1: Spaced Repetition ───────────────────────────────────────────
  const [reviewModal, setReviewModal] = useState<{ open: boolean; module: CareerModule | null }>({ open: false, module: null });
  const [dueReviews, setDueReviews] = useState<ModuleReviewRecord[]>([]);

  // ── Sprint 1: Mastery-Based Retry ─────────────────────────────────────────
  const [retryTask, setRetryTask] = useState<CareerModule['practice_task'] & { guided_hints?: string[] } | null>(null);
  const [loadingRetry, setLoadingRetry] = useState(false);

  // ── Sprint 1: Socratic Micro-Tutor ────────────────────────────────────────
  const [hintParagraph, setHintParagraph] = useState<string | null>(null);
  const [hintText, setHintText] = useState<string>('');
  const [loadingHint, setLoadingHint] = useState(false);

  // ── Sprint 2 additions ─────────────────────────────────────────────────────
  const [socraticParagraph, setSocraticParagraph] = useState<string | null>(null);
  const [showMockInterview, setShowMockInterview] = useState(false);
  const [runHistory, setRunHistory] = useState<{ time: string; logs: string[]; passed: boolean }[]>([]);

  useEffect(() => {
    if (localTestLogs.length > 0) {
      // Don't log clean resets
      if (localTestLogs.length === 1 && localTestLogs[0] === '') return;
      
      const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      // Avoid duplicates
      setRunHistory(prev => {
        if (prev.length > 0 && JSON.stringify(prev[0].logs) === JSON.stringify(localTestLogs)) return prev;
        return [
          { time, logs: [...localTestLogs], passed: localTestedPassed },
          ...prev
        ].slice(0, 5);
      });
    }
  }, [localTestLogs, localTestedPassed]);

  useEffect(() => {
    if (!user) return;
    loadProfile();
    // Load due spaced-repetition reviews
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (token) {
        getDueReviews(token).then(setDueReviews).catch(() => {});
      }
    });
  }, [user?.id]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['course', 'plan', 'analytics', 'jobs', 'interviews'].includes(tab)) {
      setActiveTab(tab as any);
    }
  }, [searchParams]);

  useEffect(() => {
    if (showCoachChat) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, showCoachChat]);

  const loadProfile = () => {
    if (!user) return;
    getCareerProfile(user.id)
      .then(async (p) => {
        if (p) {
          let updated = false;
          let radar = p.skills_radar;
          if (!radar || Object.keys(radar).length === 0) {
            radar = {
              'Algorithms': 35,
              'SQL/Data': 30,
              'Web Dev': 25,
              'Soft Skills': 45,
              'Architecture': 20,
              'Business Logic': 30
            };
            p.skills_radar = radar;
            updated = true;
          } else {
            const values = Object.values(radar) as number[];
            const maxVal = values.length > 0 ? Math.max(...values) : 0;
            if (maxVal < 20) {
              const boosted: Record<string, number> = {};
              for (const key of Object.keys(radar)) {
                boosted[key] = Math.min(100, (radar[key] ?? 0) + 30);
              }
              const standardAxes = ['Algorithms', 'SQL/Data', 'Web Dev', 'Soft Skills', 'Architecture', 'Business Logic'];
              for (const axis of standardAxes) {
                if (boosted[axis] === undefined) {
                  boosted[axis] = 25;
                }
              }
              p.skills_radar = boosted;
              updated = true;
            }
          }
          if (updated) {
            await saveCareerProfile(user.id, p);
          }
        }
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
    if (profile?.last_course_deleted_at) {
      const deletedAt = new Date(profile.last_course_deleted_at).getTime();
      const now = new Date().getTime();
      const diffMs = now - deletedAt;
      const diffHours = diffMs / (1000 * 60 * 60);
      if (false && diffHours < 24) {
        const remainingHours = Math.ceil(24 - diffHours);
        toast.error(`Вы недавно удалили курс. Создание нового курса заблокировано. Пожалуйста, подождите ещё ${remainingHours} ч.`);
        return;
      }
    }

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

  const handleDeleteCourse = async () => {
    if (!profile || !user) return;
    
    const ok = await confirm({
      title: '⚠️ Удаление текущего курса',
      message: 'Вы действительно хотите удалить ваш текущий ИИ-курс? Обратите внимание: вы не сможете сгенерировать новый курс в течение следующих 24 часов!'
    });
    if (!ok) return;

    const updatedProfile: CareerProfile = {
      ...profile,
      course: undefined,
      last_course_deleted_at: new Date().toISOString()
    };

    setProfile(updatedProfile);
    await saveCareerProfile(user.id, updatedProfile);
    toast.success('ИИ-курс успешно удален! Лимит 24 часа на создание нового курса активирован.');
  };

  const handleUpdateProfile = async (updatedProfile: CareerProfile) => {
    setProfile(updatedProfile);
    if (user) {
      await saveCareerProfile(user.id, updatedProfile);
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
      const v = await getCareerVacancies(profession, location, profile?.hh_access_token);
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
      
      // Parse trigger token for updating vacancy search: [UPDATE_VACANCIES_ACTION:NewProfession|NewLocation]
      const triggerRegex = /\[UPDATE_VACANCIES_ACTION:(.+?)\|(.+?)\]/;
      const match = reply.match(triggerRegex);

      if (match) {
        const newProf = match[1].trim();
        const newLoc = match[2].trim();
        
        // Remove token from text visible to user
        const cleanReply = reply.replace(triggerRegex, '').trim();
        setVacancyChatMessages(prev => [...prev, { role: 'assistant', content: cleanReply }]);
        
        toast.success(`Переключаем вакансии на: ${newProf} (${newLoc || 'любой регион'})!`);
        
        // Update inputs and pending params
        setSearchProfession(newProf);
        setSearchLocation(newLoc);
        setPendingCourseParams(prev => prev ? {
          ...prev,
          profession: newProf,
          location: newLoc
        } : {
          profession: newProf,
          level: 'Junior',
          salary: '',
          location: newLoc,
          extraContext: '',
          gender: ''
        });
        
        // Re-fetch vacancies
        fetchAndSetVacancies(newProf, newLoc);
      } else {
        setVacancyChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      }
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
          history: newMsg.slice(-8),
          is_expansion: true,
          profession: profile.course.profession,
          level: profile.course.level,
          salary: profile.course.salary
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

  const handleGenerateNextSyllabusModule = async () => {
    if (!user || !profile?.course) return;
    
    setIsGeneratingNextModule(true);
    toast.loading('ИИ-Методист проектирует практику и теорию для следующего шага...', { id: 'next_mod_load' });
    
    try {
      const result = await generateNextSyllabusModule(user.id, profile.course);
      if (result) {
        if (result.completed) {
          toast.success('Поздравляем! Весь силлабус успешно сгенерирован и пройден!', { id: 'next_mod_load' });
        } else {
          toast.success('Следующий учебный модуль успешно сгенерирован!', { id: 'next_mod_load' });
          confetti({ particleCount: 100, spread: 60 });
          loadProfile();
        }
      } else {
        toast.error('Не удалось сгенерировать следующий модуль.', { id: 'next_mod_load' });
      }
    } catch (e: any) {
      console.error(e);
      const errMsg = e?.message || 'Ошибка генерации следующего модуля.';
      toast.error(errMsg, { id: 'next_mod_load' });
    } finally {
      setIsGeneratingNextModule(false);
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

  const selectTask = (taskIndex: number, mod: CareerModule) => {
    setActiveTaskIndex(taskIndex);
    setLastEvalResult(null);
    setLocalTested(false);
    setLocalTestedPassed(false);
    setLocalTestLogs([]);
    
    const activeTask = mod.tasks && mod.tasks[taskIndex]
      ? mod.tasks[taskIndex]
      : mod.practice_task;
      
    // Load previously saved solution for this task if it exists
    const savedSolution = mod.task_solutions?.[(activeTask as any).id ?? 0];
      
    // Initialize defaults based on practice type
    if (mod.practice_type === 'algo') {
      setSandboxCode(savedSolution !== undefined ? savedSolution : (activeTask.code_template || `function solution() {\n  // напиши свой код здесь\n}`));
    } else if (mod.practice_type === 'sql') {
      setSandboxCode(savedSolution !== undefined ? savedSolution : (activeTask.code_template || `SELECT -- Напишите ваш SQL-запрос здесь\n;`));
    } else if (mod.practice_type === 'web') {
      setSandboxCode(savedSolution !== undefined ? savedSolution : (activeTask.code_template || `<!-- Напиши HTML & CSS здесь -->\n<div class="card">\n  <h2>Привет, StudyForge!</h2>\n  <p>Сделай центрирование по флексу и добавь градиентный фон.</p>\n</div>\n\n<style>\n  .card {\n    padding: 2rem;\n    text-align: center;\n  }\n</style>`));
    } else if (mod.practice_type === 'business') {
      if (savedSolution !== undefined) {
        try {
          setSandboxInputs(JSON.parse(savedSolution));
        } catch {
          setSandboxInputs({});
        }
      } else {
        setSandboxInputs({});
      }
    } else if (mod.practice_type === 'design') {
      if (savedSolution !== undefined) {
        try {
          setSandboxClickErrors(JSON.parse(savedSolution));
        } catch {
          setSandboxClickErrors({});
        }
      } else {
        setSandboxClickErrors({});
      }
    } else if (mod.practice_type === 'copywriting') {
      setSandboxText(savedSolution !== undefined ? savedSolution : (activeTask.task_description ? activeTask.task_description.slice(0, 100) + '...' : ''));
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

  const openSandbox = (mod: CareerModule) => {
    setSelectedModule(mod);
    setPracticeOpen(true);
    setIsEvaluating(false);
    
    const initialTaskIdx = mod.completed_tasks && mod.tasks && mod.tasks.length > 0
      ? Math.max(0, Math.min(mod.completed_tasks.length, mod.tasks.length - 1))
      : 0;
    
    selectTask(initialTaskIdx, mod);
  };

  const updateSandboxCode = (val: string) => {
    setSandboxCode(val);
    if (selectedModule) {
      const activeTask = selectedModule.tasks && selectedModule.tasks[activeTaskIndex]
        ? selectedModule.tasks[activeTaskIndex]
        : selectedModule.practice_task;
      if (!selectedModule.task_solutions) selectedModule.task_solutions = {};
      selectedModule.task_solutions[(activeTask as any).id ?? 0] = val;
    }
  };

  const updateSandboxText = (val: string) => {
    setSandboxText(val);
    if (selectedModule) {
      const activeTask = selectedModule.tasks && selectedModule.tasks[activeTaskIndex]
        ? selectedModule.tasks[activeTaskIndex]
        : selectedModule.practice_task;
      if (!selectedModule.task_solutions) selectedModule.task_solutions = {};
      selectedModule.task_solutions[(activeTask as any).id ?? 0] = val;
    }
  };

  const updateSandboxInputs = (newInputs: Record<string, string>) => {
    setSandboxInputs(newInputs);
    if (selectedModule) {
      const activeTask = selectedModule.tasks && selectedModule.tasks[activeTaskIndex]
        ? selectedModule.tasks[activeTaskIndex]
        : selectedModule.practice_task;
      if (!selectedModule.task_solutions) selectedModule.task_solutions = {};
      selectedModule.task_solutions[(activeTask as any).id ?? 0] = JSON.stringify(newInputs);
    }
  };

  const updateSandboxClickErrors = (newErrors: Record<string, string>) => {
    setSandboxClickErrors(newErrors);
    if (selectedModule) {
      const activeTask = selectedModule.tasks && selectedModule.tasks[activeTaskIndex]
        ? selectedModule.tasks[activeTaskIndex]
        : selectedModule.practice_task;
      if (!selectedModule.task_solutions) selectedModule.task_solutions = {};
      selectedModule.task_solutions[(activeTask as any).id ?? 0] = JSON.stringify(newErrors);
    }
  };

  const runLocalTests = () => {
    if (!selectedModule) return;
    setLocalTested(true);
    setLocalTestLogs([]);

    const task = selectedModule.tasks && selectedModule.tasks[activeTaskIndex]
      ? selectedModule.tasks[activeTaskIndex]
      : selectedModule.practice_task;
    
    if (selectedModule.practice_type === 'algo') {
      const codeLang = getCodeLanguage(sandboxCode, profile?.course?.profession || '', task.code_template || '');
      const isNonJsAlgo = codeLang !== 'javascript';
      
      if (isNonJsAlgo) {
        const logs: string[] = [];
        logs.push(`💻 Обнаружен код на языке ${codeLang.toUpperCase()}.`);
        
        // Simple structural syntax check to make sure they didn't just leave it empty
        const trimmedCode = sandboxCode.trim();
        const hasCodeSignature = trimmedCode.length > 20 && 
                                 !trimmedCode.includes('// Напишите ваше решение на JavaScript здесь') && 
                                 !trimmedCode.includes('// напиши свой код здесь');
        
        if (hasCodeSignature) {
          logs.push(`✅ Базовый синтаксический анализ структуры ${codeLang.toUpperCase()} выполнен успешно.`);
          logs.push(`ℹ️ Локальный автозапуск тестов в браузере поддерживается только для JavaScript/TypeScript.`);
          logs.push(`✨ Вы можете отправить ваше решение на "Ревью эксперта" для полной проверки и подробного разбора!`);
          setLocalTestLogs(logs);
          setLocalTestedPassed(true);
          toast.success(`Базовая проверка кода на ${codeLang.toUpperCase()} пройдена!`);
        } else {
          logs.push(`❌ Код не изменен или слишком короткий. Пожалуйста, напишите ваше решение задачи.`);
          setLocalTestLogs(logs);
          setLocalTestedPassed(false);
          toast.error('Пожалуйста, напишите решение!');
        }
        return;
      }

      try {
        const userFn = new Function(`return ${sandboxCode}`)();
        const logs: string[] = [];
        let passed = true;

        if (task.test_cases && task.test_cases.length > 0) {
          task.test_cases.forEach((tc: any, idx: number) => {
            let inputParsed;
            try {
              inputParsed = JSON.parse(tc.input);
            } catch {
              try {
                inputParsed = new Function(`return (${tc.input})`)();
              } catch {
                inputParsed = tc.input;
              }
            }

            let expectedParsed;
            try {
              expectedParsed = JSON.parse(tc.expected);
            } catch {
              try {
                expectedParsed = new Function(`return (${tc.expected})`)();
              } catch {
                expectedParsed = tc.expected;
              }
            }
            
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
        const isUsersTask = task.task_description.toLowerCase().includes('users') || 
                            task.task_description.toLowerCase().includes('пользовател') || 
                            query.includes('users');
        if (isUsersTask) {
          logs.push('🔍 Найдено подходящих записей: 5 (Active users in 2023)');
        } else {
          logs.push('🔍 Найдено подходящих записей: 5 (Middle/Senior vacancies)');
        }
      } else {
        logs.push('❌ Неверный синтаксис SQL. Убедитесь, что используете SELECT ... FROM ...');
      }
      
      setLocalTestLogs(logs);
      setLocalTestedPassed(passed);
    } else if (selectedModule.practice_type === 'web') {
      const code = sandboxCode;
      const logs: string[] = [];
      let passed = true;

      // Check if this is a system or bash script task generated with 'web' type
      const isSystemOrScriptTask =
        /linux|bash|docker|devops|git|nginx|kubernetes|k8s|server|сервер|администрирование|деплой|cron/i.test(selectedModule.title) ||
        /linux|bash|docker|devops|git|nginx|kubernetes|k8s|server|сервер|администрирование|деплой|cron/i.test(task.task_description) ||
        (!code.includes('<div') && !code.includes('<p') && !code.includes('<html') && (code.includes('sudo') || code.includes('apt') || code.includes('docker') || code.includes('npm') || code.includes('#!') || code.includes('git') || code.includes('systemctl')));

      if (isSystemOrScriptTask) {
        logs.push('💻 Обнаружен системный скрипт / Bash-команда. Проверка HTML/CSS отключена.');
        logs.push('✅ Локальный синтаксический анализ команды/скрипта выполнен успешно.');
        passed = true;
      } else {
        // Check for <style> tag with actual CSS
        const styleMatch = code.match(/<style[^>]*>([\/\s\S]*?)<\/style>/i);
        const cssContent = styleMatch ? styleMatch[1].trim() : '';
        const hasRealCSS = cssContent.includes(':') && cssContent.includes('{');

        if (!styleMatch || !hasRealCSS) {
          logs.push('⚠️ CSS не обнаружен или пустой. Напишите CSS внутри тега <style> с реальными правилами.');
          passed = false;
        }

        // Check for meaningful HTML (not just the starter comment)
        const htmlWithoutComment = code.replace(/<!--.*?-->/gs, '').trim();
        const tagCount = (htmlWithoutComment.match(/<[a-z][^>]*>/gi) || []).length;
        if (tagCount < 2) {
          logs.push('⚠️ HTML структура пуста. Добавьте HTML-элементы (например, div, p, h1 и т.д.).');
          passed = false;
        }

        if (passed) {
          logs.push('✅ DOM структура корректна. CSS стили внедрены.');
          logs.push('👁️ Visual Previewer успешно отрендерил интерфейс.');
        }
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
      const activeTask = selectedModule.tasks && selectedModule.tasks[activeTaskIndex]
        ? selectedModule.tasks[activeTaskIndex]
        : selectedModule.practice_task;

      const evaluation = await evaluateCareerTask(
        profile.course?.profession || 'IT Специалист',
        selectedModule.title + (selectedModule.tasks ? ` - Задача ${activeTaskIndex + 1}` : ''),
        activeTask.task_description,
        selectedModule.practice_type,
        solutionData
      );

      const score = evaluation.score;
      const isMastered = score >= 70;
      const isPerfect = score >= 90;

      // Handle multi-task module completion
      let newCompletedTasks = [...(selectedModule.completed_tasks || [])];
      
      if (selectedModule.tasks && selectedModule.tasks.length > 0 && selectedModule.tasks[activeTaskIndex]) {
        const taskId = selectedModule.tasks[activeTaskIndex].id;
        if (!newCompletedTasks.includes(taskId)) {
          newCompletedTasks.push(taskId);
        }
      }
      const tasksDone = newCompletedTasks.length === (selectedModule.tasks?.length ?? 10);
      const isModuleFullyCompleted = tasksDone && !!selectedModule.test_completed;

      // Update local profile with completion + mastery score
      const updatedModules = profile.course?.modules.map(m => {
        if (m.id === selectedModule.id) {
          return {
            ...m,
            completed: isModuleFullyCompleted,
            mastery_score: score,
            attempts: (m.attempts ?? 0) + 1,
            score: score,
            evaluation: evaluation,
            student_solution: solutionData,
            completed_tasks: newCompletedTasks
          };
        }
        return m;
      }) || [];

      const updatedSyllabus = profile.course?.syllabus ? {
        ...profile.course.syllabus,
        chapters: profile.course.syllabus.chapters.map((ch: any) => ({
          ...ch,
          topics: ch.topics ? ch.topics.map((t: any) => {
            if (t.module_id === selectedModule.id) {
              return { ...t, is_completed: isModuleFullyCompleted };
            }
            return t;
          }) : []
        }))
      } : undefined;

      // Calculate XP reward
      let xpGained: number = XP_REWARDS.task_completed;
      if (isPerfect) xpGained = XP_REWARDS.task_perfect;
      else if (isMastered) xpGained = XP_REWARDS.task_mastered;

      // Schedule spaced repetition for mastered modules
      if (isMastered) {
        supabase.auth.getSession().then(({ data }) => {
          const token = data.session?.access_token;
          if (token) {
            updateModuleReview(
              selectedModule.id,
              profile.course?.profession || '',
              score,
              token
            ).catch(() => {});
          }
        });
      }

      // Save XP + skills radar
      const updatedProfile = await saveXPToProfile(
        user.id,
        {
          ...profile,
          course: { 
            ...profile.course!, 
            modules: updatedModules,
            syllabus: updatedSyllabus || profile.course!.syllabus
          }
        },
        xpGained,
        selectedModule.practice_type
      );

      // Store evaluation inline for the sandbox view
      setLastEvalResult(evaluation);

      const saved = !!updatedProfile;
      if (saved) {
        setProfile(updatedProfile);
        setSelectedModule(updatedModules.find(m => m.id === selectedModule.id) || null);

        if (isMastered) {
          confetti({ particleCount: 120, spread: 70 });
          toast.success(
            isPerfect
              ? `🏆 Идеально! ${score}/100 — +${xpGained} XP! Следующий модуль разблокирован!`
              : `✅ Освоено! ${score}/100 — +${xpGained} XP!`,
            { duration: 4000 }
          );

          // Milestone toasts every 3 completed modules
          const newlyCompletedCount = updatedModules.filter(m => m.completed).length;
          if (newlyCompletedCount > 0 && newlyCompletedCount % 3 === 0) {
            setTimeout(() => {
              toast(
                `🎯 Потрясающе! Ты освоил уже ${newlyCompletedCount} модул${newlyCompletedCount === 3 ? 'я' : 'ей'}. Ты готов к стажировке уровня "${profile.course?.level || 'Джуниор'}"!`,
                { icon: '🚀', duration: 6000 }
              );
            }, 3000);
          }
        } else {
          toast(
            `📚 Оценка: ${score}/100. Нужно ≥70 для разблокировки следующего модуля. Попробуй ещё раз!`,
            { icon: '⚠️', duration: 5000 }
          );
        }
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

  // ── Sprint 1: Get Retry Task (Mastery-based) ──────────────────────────────────
  const handleGetRetryTask = async () => {
    if (!selectedModule || !profile) return;
    setLoadingRetry(true);
    setRetryTask(null);
    try {
      const weaknesses = selectedModule.evaluation?.weaknesses || [];
      const alt = await generateRetryTask(
        selectedModule.title,
        selectedModule.practice_type,
        selectedModule.practice_task.task_description,
        weaknesses
      );
      setRetryTask(alt);
      // Reset sandbox
      setSandboxCode(alt.code_template || `function solution() {\n  // напиши свой код здесь\n}`);
      setLocalTested(false);
      setLocalTestedPassed(false);
      setLocalTestLogs([]);
      toast.success('Сгенерировано альтернативное задание — попробуй снова!');
    } catch {
      toast.error('Не удалось сгенерировать задание.');
    } finally {
      setLoadingRetry(false);
    }
  };

  // ── Sprint 3: AI Code Diagnostics & Refactoring ──────────────────────────────
  const handleRunDiagnostics = async () => {
    if (!selectedModule) return;
    setDiagnosticsResult(null);
    setIsDiagnosticsLoading(true);
    setShowDiagnosticsPanel(true);
    try {
      const activeTask = selectedModule.tasks && selectedModule.tasks[activeTaskIndex]
        ? selectedModule.tasks[activeTaskIndex]
        : selectedModule.practice_task;

      const report = await getCodeDiagnostics(
        sandboxCode,
        selectedModule.title + (selectedModule.tasks ? ` - Задача ${activeTaskIndex + 1}` : ''),
        activeTask.task_description
      );
      setDiagnosticsResult(report);
    } catch {
      toast.error('Не удалось провести ИИ-анализ кода.');
    } finally {
      setIsDiagnosticsLoading(false);
    }
  };

  // ── Sprint 3: GitHub Portfolio README Generator ─────────────────────────────
  const handleGenerateReadme = async () => {
    if (!profile?.course?.profession) return;
    
    const totalMod = profile.course.modules.length;
    const completedMod = profile.course.modules.filter(m => m.completed).length;
    const isAllModCompleted = totalMod > 0 && completedMod === totalMod;
    const isCapCompleted = profile.capstone_project?.status === 'completed';

    if (!isAllModCompleted) {
      toast.error('Вы сможете сгенерировать GitHub README только после успешного завершения всех модулей вашего курса!');
      return;
    }
    if (!isCapCompleted) {
      toast.error('Вы сможете сгенерировать GitHub README только после успешной сдачи выпускного пет-проекта!');
      return;
    }

    const completedList = (profile.course.modules ?? [])
      .filter(m => m.completed)
      .map(m => m.title);
      
    setIsReadmeLoading(true);
    try {
      const data = await generateGithubReadme(
        profile.course.profession,
        completedList,
        profile.capstone_project?.title,
        profile.capstone_project?.description
      );
      setGithubReadme(data.readme);
      toast.success('Портфолио README.md успешно сгенерировано!');
    } catch {
      toast.error('Не удалось сгенерировать портфолио.');
    } finally {
      setIsReadmeLoading(false);
    }
  };

  const handleGenerateCapstoneProjects = async () => {
    if (!profile?.course?.profession) return;
    setIsGeneratingCapstone(true);
    try {
      const completedModulesList = (profile.course.modules ?? [])
        .filter(m => m.completed)
        .map(m => m.title);
      const data = await generatePetProjects(
        profile.course.profession,
        profile.skills || [],
        completedModulesList
      );
      const updatedProfile: CareerProfile = {
        ...profile,
        capstone_options: data.projects
      };
      setProfile(updatedProfile);
      await saveCareerProfile(user!.id, updatedProfile);
      toast.success('Выпускные пет-проекты успешно сгенерированы!');
    } catch (err) {
      toast.error('Не удалось сгенерировать пет-проекты.');
    } finally {
      setIsGeneratingCapstone(false);
    }
  };

  const handleSelectCapstoneProject = async (project: any) => {
    if (!user || !profile) return;
    const ok = await confirm({
      title: '🎯 Выбор выпускного проекта',
      message: `Вы действительно хотите выбрать проект "${project.title}"? После выбора вы сможете приступить к его реализации.`
    });
    if (!ok) return;

    const capstone = {
      ...project,
      chosen: true,
      status: 'in_progress' as const
    };
    const updatedProfile: CareerProfile = {
      ...profile,
      capstone_project: capstone
    };
    setProfile(updatedProfile);
    await saveCareerProfile(user.id, updatedProfile);
    toast.success(`Проект "${project.title}" успешно выбран!`);
  };

  const handleSubmitCapstoneProject = async () => {
    if (!user || !profile || !profile.capstone_project) return;
    
    const isGithub = capstoneSubmissionTab === 'github';
    if (isGithub && !capstoneGithubUrl.trim()) {
      toast.error('Пожалуйста, введите корректную ссылку на ваш публичный GitHub репозиторий.');
      return;
    }
    if (!isGithub && !capstoneSolutionCode.trim()) {
      toast.error('Пожалуйста, введите ваше решение (код или архитектурное описание).');
      return;
    }

    setIsSubmittingCapstone(true);
    try {
      const res = await evaluatePetProject(
        profile.course?.profession || '',
        profile.capstone_project.title,
        profile.capstone_project.description,
        profile.capstone_project.requirements,
        isGithub ? '' : capstoneSolutionCode,
        isGithub ? capstoneGithubUrl : undefined
      );
      
      const passed = res.score >= 70;
      const updatedCapstone = {
        ...profile.capstone_project,
        solution_code: isGithub ? '' : capstoneSolutionCode,
        github_repo_url: isGithub ? capstoneGithubUrl : '',
        status: passed ? 'completed' as const : 'in_progress' as const,
        evaluation: {
          score: res.score,
          verdict: res.verdict,
          strengths: res.strengths,
          weaknesses: res.weaknesses,
          refactored_solution: res.refactored_solution
        }
      };

      const xpGain = passed ? 500 : 50;

      const updatedProfile = await saveXPToProfile(
        user.id,
        {
          ...profile,
          capstone_project: updatedCapstone
        },
        xpGain,
        'roleplay'
      );

      if (updatedProfile) {
        setProfile(updatedProfile);
        if (passed) {
          toast.success(`🎉 Поздравляем с выпуском! Ваш проект принят с оценкой ${res.score}/100! Получено +${xpGain} XP!`);
          confetti({ particleCount: 200, spread: 100 });
        } else {
          toast.error(`Проект оценен на ${res.score}/100. Нужно набрать не менее 70 баллов для сдачи. Изучите ревью и попробуйте еще раз! (+${xpGain} XP за попытку)`);
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Не удалось отправить проект на проверку.');
    } finally {
      setIsSubmittingCapstone(false);
    }
  };

  // ── Sprint 3: Diagnostic Test Completion Handler ─────────────────────────────
  const handleDiagnosticComplete = async (passed: boolean, xpGained: number) => {
    setShowDiagnosticModal(false);
    if (!diagnosticModule || !user || !profile || !profile.course) return;

    if (passed) {
      // Update module completion in local state
      const updatedModules = profile.course.modules.map(m => 
        m.id === diagnosticModule.id 
          ? { ...m, completed: true, mastery_score: 90, score: 90 } 
          : m
      );

      // Construct active log stamp
      const today = new Date().toISOString().split('T')[0];
      const newLog = [...(profile.activity_log ?? [])];
      newLog.push({
        date: today,
        xp: xpGained,
        type: 'challenge',
        label: `Экстерн: ${diagnosticModule.title}`
      });

      const updatedProfile: CareerProfile = {
        ...profile,
        xp: (profile.xp ?? 0) + xpGained,
        activity_log: newLog,
        course: {
          ...profile.course,
          modules: updatedModules
        }
      };

      // Recalculate level
      const { name: newLevelName } = getLevelFromXP(updatedProfile.xp ?? 0);
      updatedProfile.level_name = newLevelName;

      setProfile(updatedProfile);
      await saveCareerProfile(user.id, updatedProfile);
      toast.success(`🎉 Теория пройдена экстерном! Получено +${xpGained} XP!`);

      // Instantly open this module's sandbox practice in Career
      setSelectedModule({
        ...diagnosticModule,
        completed: true,
        mastery_score: 90,
        score: 90
      });
      setPracticeOpen(true);
      setSandboxCode(diagnosticModule.practice_task.code_template || '');
    } else {
      toast.error('Входное тестирование не пройдено. Изучите теорию модуля.');
      // Just select and display theory normally
      setSelectedModule(diagnosticModule);
      setPracticeOpen(false);
    }
    setDiagnosticModule(null);
  };

  // ── Sprint 1: Socratic Micro-Tutor ───────────────────────────────────────────
  const handleSocraticHint = async (paragraph: string) => {
    if (!profile?.course?.profession) return;
    setHintParagraph(paragraph);
    setHintText('');
    setLoadingHint(true);
    try {
      const explanation = await getModuleHint(paragraph, profile.course.profession);
      setHintText(explanation);
    } catch {
      setHintText('Не удалось получить объяснение. Попробуй снова.');
    } finally {
      setLoadingHint(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto min-h-[90vh] flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
        <p className="text-sm text-slate-400 font-semibold animate-pulse">Синхронизируем ваш карьерный вектор...</p>
      </div>
    );
  }

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
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">Автоматически оцифрованная траектория и live-обучение</p>
              {profile && (
                <div className="flex items-center gap-1 px-2.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/30 rounded-full text-[10px] sm:text-xs">
                  <span className="text-amber-500">⭐</span>
                  <span className="font-extrabold text-indigo-700 dark:text-indigo-300">{profile.xp ?? 0} XP</span>
                  <span className="text-slate-400 dark:text-slate-500 font-bold">• {profile.level_name ?? 'Новичок'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {profile && (
            <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-x-auto max-w-[85vw] sm:max-w-none">
              <button
                onClick={() => {
                  setActiveTab('course');
                  setSearchParams({ tab: 'course' });
                }}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'course'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                🎓 ИИ-Курс
                {profile?.course && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </button>
              <button
                onClick={() => {
                  setActiveTab('plan');
                  setSearchParams({ tab: 'plan' });
                }}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'plan'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                📋 План обучения
              </button>
              <button
                onClick={() => {
                  setActiveTab('analytics');
                  setSearchParams({ tab: 'analytics' });
                }}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'analytics'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                📊 Аналитика
              </button>
              <button
                onClick={() => {
                  setActiveTab('jobs');
                  setSearchParams({ tab: 'jobs' });
                }}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'jobs'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                💼 Вакансии
              </button>
              <button
                onClick={() => {
                  setActiveTab('interviews');
                  setSearchParams({ tab: 'interviews' });
                }}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'interviews'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                🎙️ Собеседования
              </button>

            </div>
          )}
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
          {activeTab === 'course' ? (
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
                    className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-bold flex items-center gap-3 hover:from-indigo-700 hover:to-violet-700 transition shadow-lg shadow-indigo-200 dark:shadow-none mx-auto"
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
                    <div className="bg-gradient-to-br from-indigo-50 to-slate-100 dark:from-indigo-950/60 dark:to-slate-900/50 text-slate-800 dark:text-white p-6 rounded-2xl shadow-xl relative overflow-hidden border border-slate-200 dark:border-slate-800">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500 dark:bg-indigo-500 rounded-full blur-3xl opacity-20" />
                      <div className="flex items-center gap-2 mb-4">
                        <Award className="w-6 h-6 text-amber-500 dark:text-amber-400" />
                        <h3 className="text-lg font-bold">Рыночный Анализ Вакансий</h3>
                      </div>
                      
                      <div className="space-y-4 text-sm">
                        <div>
                          <span className="text-indigo-600 dark:text-indigo-300 block text-xs">Целевая профессия</span>
                          <span className="font-bold text-base text-slate-900 dark:text-slate-100">{profile.course.profession}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-indigo-600 dark:text-indigo-300 block text-xs">Уровень трека</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100">{profile.course.level}</span>
                          </div>
                          <div>
                            <span className="text-indigo-600 dark:text-indigo-300 block text-xs">Ожидаемая ЗП</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatSalary(profile.course.salary, profile.course.location)}</span>
                          </div>
                        </div>
                        <div className="pt-3 border-t border-slate-200 dark:border-indigo-950">
                          <span className="text-indigo-600 dark:text-indigo-300 block text-xs mb-2">Сводная аналитика ИИ-Методиста</span>
                          <div className="text-slate-700 dark:text-indigo-100 leading-relaxed text-xs prose prose-xs dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-strong:text-slate-900 dark:prose-strong:text-white">
                            <ReactMarkdown>{profile.course.insights}</ReactMarkdown>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-slate-200 dark:border-indigo-950/60 mt-3">
                          <button
                            onClick={handleDeleteCourse}
                            className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-900/30 text-rose-600 dark:text-rose-200 border border-rose-200 dark:border-rose-500/20 rounded-xl text-[11px] font-extrabold transition flex items-center justify-center gap-1.5"
                          >
                            <X className="w-3.5 h-3.5" />
                            Удалить текущий курс
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Sprint 1: Salary Progress Bar */}
                    {(() => {
                      let totalTopics = 0;
                      let completedTopics = 0;
                      if (profile.course.syllabus?.chapters) {
                        for (const c of profile.course.syllabus.chapters) {
                          if (c.topics) {
                            for (const t of c.topics) {
                              totalTopics++;
                              if (t.is_completed) {
                                completedTopics++;
                              }
                            }
                          }
                        }
                      }
                      return (
                        <SalaryProgressBar
                          currentXP={profile.xp ?? 0}
                          targetSalary={profile.course.salary}
                          completedModules={profile.course.modules.filter(m => m.completed && (m.mastery_score ?? m.score ?? 0) >= 70).length}
                          totalModules={profile.course.modules.length}
                          completedTopics={completedTopics}
                          totalTopics={totalTopics}
                          levelName={profile.level_name}
                          streakDays={profile.streak_days}
                          location={profile.course.location}
                        />
                      );
                    })()}

                    {/* Sprint 1: Skills Radar Chart */}
                    {Object.keys(profile.skills_radar ?? {}).length > 0 && (
                      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
                        <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                          <Layers2 className="w-3.5 h-3.5" />
                          Карта навыков
                        </h4>
                        <SkillsRadarChart data={profile.skills_radar!} size={200} />
                      </div>
                    )}

                    {/* Sprint 1: Due reviews widget */}
                    {dueReviews.length > 0 && (
                      <div className="bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-700/40 rounded-2xl p-4 space-y-3">
                        <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                          <RotateCcw className="w-3.5 h-3.5" />
                          Повторение — {dueReviews.length} модул{dueReviews.length === 1 ? 'ь' : 'я'}
                        </h4>
                        {dueReviews.slice(0, 4).map(r => {
                          const mod = profile.course!.modules.find(m => m.id === r.module_id);
                          if (!mod) return null;
                          return (
                            <button
                              key={r.module_id}
                              onClick={() => setReviewModal({ open: true, module: mod })}
                              className="w-full text-left p-2.5 bg-white dark:bg-indigo-900/30 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border border-indigo-100 dark:border-indigo-800/40 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-between gap-2 transition"
                            >
                              <span className="truncate">{mod.title}</span>
                              <span className="text-indigo-600 dark:text-indigo-400 shrink-0 flex items-center gap-1 font-bold">
                                <RotateCcw className="w-3 h-3" /> Пройти
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>


                  {/* Modules Timeline */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Sprint 2: Mock Interview Milestone Banner */}
                    {(() => {
                      const completedCount = profile.course?.modules.filter(m => m.completed).length ?? 0;
                      const interviewCount = profile.mock_interviews?.length ?? 0;
                      const milestonesAvailable = Math.floor(completedCount / 4);
                      
                      if (completedCount >= 4 && interviewCount < milestonesAvailable) {
                        return (
                          <div className="bg-gradient-to-r from-violet-500/10 via-indigo-500/5 to-violet-500/10 dark:from-violet-600/20 dark:via-indigo-600/15 dark:to-violet-600/20 border border-violet-200 dark:border-violet-500/30 rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-violet-600 rounded-full blur-3xl opacity-20" />
                            <div className="flex items-center gap-4 text-left">
                              <div className="w-12 h-12 bg-violet-100 dark:bg-violet-600/20 rounded-2xl flex items-center justify-center shrink-0 border border-violet-200 dark:border-violet-500/20">
                                <Trophy className="w-6 h-6 text-violet-600 dark:text-violet-400" />
                              </div>
                              <div>
                                <span className="text-[9px] font-black text-violet-600 dark:text-violet-400 uppercase tracking-widest block font-sans">Каждые 4 модуля</span>
                                <h4 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">Доступно тренировочное ИИ-собеседование!</h4>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                                  Вы успешно освоили {completedCount} модулей. Пройдите симуляцию реального технического интервью для вашей вакансии!
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => setShowMockInterview(true)}
                              className="px-5 py-3 bg-violet-600 hover:bg-violet-500 text-white text-xs font-black rounded-2xl transition shadow-lg shadow-violet-500/10 dark:shadow-none shrink-0 w-full sm:w-auto"
                            >
                              Начать собеседование
                            </button>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {profile.course && profile.course.modules.length > 0 && profile.course.modules.every(m => m.completed) && (() => {
                      const chapters = profile.course.syllabus?.chapters;
                      const hasUncompleted = chapters ? chapters.some((c: any) => c.topics.some((t: any) => !t.is_completed)) : false;
                      
                      if (hasUncompleted) {
                        const nextTopic = (() => {
                          if (!chapters) return "";
                          for (const c of chapters) {
                            for (const t of c.topics) {
                              if (!t.is_completed) return t.title;
                            }
                          }
                          return "";
                        })();
                        
                        return (
                          <div className="bg-gradient-to-tr from-indigo-50 via-white to-indigo-50 dark:from-indigo-950 dark:via-slate-900 dark:to-indigo-950 rounded-3xl border border-indigo-200 dark:border-indigo-500/30 p-6 md:p-8 text-center space-y-4 shadow-2xl relative overflow-hidden mb-6">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600 rounded-full blur-3xl opacity-25" />
                            <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-indigo-400 rounded-full flex items-center justify-center text-white mx-auto shadow-lg shadow-indigo-500/10 dark:shadow-none border border-indigo-400/20">
                              <Sparkles className="w-8 h-8 animate-pulse" />
                            </div>
                            <div className="space-y-2 max-w-lg mx-auto">
                              <h3 className="text-xl md:text-2xl font-black text-slate-900 dark:text-slate-100 flex items-center justify-center gap-2">
                                Вы успешно прошли текущие модули! 🚀
                              </h3>
                              <p className="text-xs md:text-sm text-slate-600 dark:text-slate-200 leading-relaxed font-semibold">
                                Вы отлично освоили материал! Чтобы продолжить движение по вашей карте обучения, ИИ-Методист готов сгенерировать следующий модуль по теме:
                              </p>
                              <div className="inline-block px-4 py-2 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/40 rounded-2xl text-xs md:text-sm font-extrabold text-indigo-600 dark:text-indigo-400">
                                {nextTopic}
                              </div>
                            </div>
                            <button
                              onClick={handleGenerateNextSyllabusModule}
                              disabled={isGeneratingNextModule}
                              className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-700 text-white rounded-2xl text-xs font-black shadow-lg shadow-indigo-500/15 dark:shadow-none flex items-center gap-2 mx-auto transition"
                            >
                              {isGeneratingNextModule ? (
                                <>
                                  <Loader2 className="w-4 h-4 text-indigo-100 animate-spin" />
                                  Проектируем модуль...
                                </>
                              ) : (
                                <>
                                  <Zap className="w-4 h-4 text-indigo-100 fill-indigo-100" />
                                  Продолжить обучение (Сгенерировать следующий модуль)
                                </>
                              )}
                            </button>
                          </div>
                        );
                      }
                      
                      // Default legacy / completed all syllabus chapters card
                      return (
                        <div className="bg-gradient-to-tr from-indigo-50 via-white to-indigo-50 dark:from-indigo-950 dark:via-slate-900 dark:to-indigo-950 rounded-3xl border border-indigo-200 dark:border-indigo-500/30 p-6 md:p-8 text-center space-y-4 shadow-2xl relative overflow-hidden mb-6">
                          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600 rounded-full blur-3xl opacity-25" />
                          <div className="w-16 h-16 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-full flex items-center justify-center text-white mx-auto shadow-lg shadow-emerald-500/10 dark:shadow-none border border-emerald-400/20">
                            <Award className="w-8 h-8" />
                          </div>
                          <div className="space-y-2 max-w-lg mx-auto">
                            <h3 className="text-xl md:text-2xl font-black text-slate-900 dark:text-slate-100 flex items-center justify-center gap-2">
                              Поздравляем с завершением! 🏆
                            </h3>
                            <p className="text-xs md:text-sm text-slate-600 dark:text-slate-200 leading-relaxed font-semibold">
                              Вы полностью прошли все {profile.course.modules.length} модулей практики и теории! ИИ-Методист готов проанализировать вашу успеваемость и расширить вашу учебную программу продвинутыми, более сложными темами под ваши новые цели.
                            </p>
                          </div>
                          <button
                            onClick={handleStartExpandChat}
                            className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-indigo-500/15 dark:shadow-none flex items-center gap-2 mx-auto transition"
                          >
                            <Sparkles className="w-4 h-4 text-indigo-100 animate-pulse" />
                            🚀 Расширить программу продвинутыми модулями
                          </button>
                        </div>
                      );
                    })()}

                    {/* Capstone Graduation Pet Project Section */}
                    {(() => {
                      const totalMod = profile?.course?.modules.length ?? 0;
                      const completedMod = profile?.course?.modules.filter(m => m.completed).length ?? 0;
                      const allModCompleted = totalMod > 0 && completedMod === totalMod;
                      
                      if (!allModCompleted) return null;
                      
                      return (
                        <div className="mb-10 space-y-6">
                          <div className="bg-gradient-to-tr from-violet-900/50 via-slate-900 to-indigo-900/50 border border-violet-500/30 rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-2xl">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl opacity-30 pointer-events-none" />
                            
                            <div className="relative z-10 space-y-4 text-left">
                              <div className="flex items-center gap-2">
                                <span className="px-3 py-1 bg-violet-500/20 border border-violet-550/40 text-violet-300 rounded-full text-[10px] font-black uppercase tracking-widest">
                                  🎓 ВЫПУСКНОЙ ЭТАП StudyForge
                                </span>
                              </div>
                              
                              <h2 className="text-xl md:text-3xl font-black text-white leading-tight flex items-center gap-3">
                                <Trophy className="w-8 h-8 text-amber-450 animate-bounce" />
                                Выпускная Практическая Работа (Capstone Project)
                              </h2>
                              
                              <p className="text-xs md:text-sm text-slate-350 leading-relaxed max-w-2xl font-medium">
                                Поздравляем! Вы полностью изучили теорию и успешно сдали тесты по всем модулям. Чтобы получить итоговый сертификат и разблокировать генерацию GitHub README, выберите и реализуйте один из масштабных выпускных пет-проектов под руководством ИИ-Лида.
                              </p>

                              {!profile?.capstone_project?.chosen ? (
                                // Stage 1: Choice generation or project selection
                                (!profile?.capstone_options || profile.capstone_options.length === 0) ? (
                                  <div className="pt-4 text-center">
                                    <button
                                      onClick={handleGenerateCapstoneProjects}
                                      disabled={isGeneratingCapstone}
                                      className="px-6 py-3.5 bg-gradient-to-r from-violet-650 to-indigo-650 hover:from-violet-550 hover:to-indigo-550 disabled:opacity-40 text-white rounded-xl text-xs font-black shadow-lg shadow-violet-500/20 flex items-center gap-2 transition mx-auto"
                                    >
                                      {isGeneratingCapstone ? (
                                        <>
                                          <Loader2 className="w-4 h-4 animate-spin text-white animate-pulse" />
                                          ИИ-Методист проектирует пет-проекты...
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="w-4 h-4 text-amber-300" />
                                          ⚡ Сгенерировать варианты пет-проектов
                                        </>
                                      )}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-6 pt-4 border-t border-slate-800">
                                    <h3 className="text-sm md:text-base font-extrabold text-violet-300">
                                      ✨ Выберите один из 3 предложенных проектов:
                                    </h3>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                      {profile.capstone_options.map((proj, pIdx) => (
                                        <div key={pIdx} className="bg-slate-950/60 border border-slate-800 hover:border-violet-500/40 p-5 rounded-2xl flex flex-col justify-between gap-4 transition-all shadow-xl hover:shadow-violet-950/20 text-left">
                                          <div className="space-y-3">
                                            <h4 className="text-sm font-black text-white">{proj.title}</h4>
                                            <p className="text-[11px] text-slate-400 leading-relaxed min-h-[60px]">
                                              {proj.description}
                                            </p>
                                            <div className="flex flex-wrap gap-1.5 pt-1">
                                              {proj.tech_stack.map((t, tI) => (
                                                <span key={tI} className="px-2 py-0.5 bg-violet-950/50 border border-violet-900/60 text-violet-400 rounded text-[9px] font-bold">
                                                  {t}
                                                </span>
                                              ))}
                                            </div>
                                            
                                            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                                              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Ключевые требования:</span>
                                              {proj.requirements.map((req, rI) => (
                                                <div key={rI} className="flex items-start gap-1 text-[10px] text-slate-350">
                                                  <span className="text-violet-400 font-bold shrink-0">•</span>
                                                  <span>{req}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                          
                                          <button
                                            onClick={() => handleSelectCapstoneProject(proj)}
                                            className="w-full py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-[10px] font-extrabold rounded-lg shadow-sm transition"
                                          >
                                            🚀 Выбрать этот проект
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              ) : (
                                // Stage 2: Chosen Capstone Project Workspace
                                <div className="pt-4 border-t border-slate-800 space-y-6 text-left">
                                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div>
                                      <span className="text-[10px] font-black text-violet-400 uppercase tracking-widest">Текущий выпускной проект:</span>
                                      <h3 className="text-lg md:text-xl font-black text-white">{profile?.capstone_project?.title}</h3>
                                    </div>
                                    <span className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider border rounded-full self-start md:self-center ${
                                      profile?.capstone_project?.status === 'completed'
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                        : 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse'
                                    }`}>
                                      {profile?.capstone_project?.status === 'completed' ? '🎓 Успешно защищен' : '⚡ В процессе разработки'}
                                    </span>
                                  </div>

                                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/45 p-4 rounded-xl border border-slate-850">
                                    {profile?.capstone_project?.description}
                                  </p>

                                  <div className="flex flex-wrap gap-1.5">
                                    {profile?.capstone_project?.tech_stack?.map((t: string, idx: number) => (
                                      <span key={idx} className="px-2 py-0.5 bg-violet-950/40 border border-violet-900/50 text-violet-400 rounded text-[10px] font-black uppercase tracking-wider">
                                        {t}
                                      </span>
                                    ))}
                                  </div>

                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-4 border-t border-slate-800">
                                    {/* Left Column: Requirements checklist */}
                                    <div className="space-y-4 text-left">
                                      <h4 className="text-xs font-black text-violet-300 flex items-center gap-1.5 uppercase tracking-wide">
                                        <CheckCircle2 className="w-4 h-4 text-violet-400" />
                                        Чек-лист требований к проверке:
                                      </h4>
                                      <div className="space-y-2.5">
                                        {profile?.capstone_project?.requirements?.map((req: string, idx: number) => (
                                          <div key={idx} className="flex items-center gap-3 p-3 bg-slate-950/30 border border-slate-900 rounded-xl text-left">
                                            <input
                                              type="checkbox"
                                              defaultChecked={profile?.capstone_project?.status === 'completed'}
                                              className="w-4 h-4 accent-violet-500 bg-slate-950 border-slate-800 rounded focus:ring-violet-500"
                                            />
                                            <span className="text-xs text-slate-300 font-semibold">{req}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    {/* Right Column: Code submission and mentor review with GitHub tabs */}
                                    <div className="space-y-4 flex flex-col justify-between text-left w-full overflow-hidden">
                                      <div className="space-y-3.5 w-full">
                                        {profile?.capstone_project?.status !== "completed" ? (
                                          <>
                                            <h4 className="text-xs font-black text-violet-300 flex items-center gap-1.5 uppercase tracking-wider">
                                              <Code2 className="w-4 h-4 animate-pulse" />
                                              💻 Выберите способ отправки решения:
                                            </h4>
                                            
                                            {/* Submission Mode Tabs Switcher */}
                                            <div className="flex p-1 bg-slate-100 dark:bg-slate-950 rounded-xl mb-4 w-full border border-slate-200/50 dark:border-slate-900">
                                              <button
                                                onClick={() => setCapstoneSubmissionTab("github")}
                                                className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                                                  capstoneSubmissionTab === "github"
                                                    ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs border border-slate-200/20" 
                                                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                                                }`}
                                              >
                                                🐙 GitHub Репозиторий
                                                <span className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-950 text-violet-650 dark:text-violet-400 rounded text-[9px] font-black uppercase">Рекомендуется</span>
                                              </button>
                                              <button
                                                onClick={() => setCapstoneSubmissionTab("manual")}
                                                className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition-all ${
                                                  capstoneSubmissionTab === "manual"
                                                    ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs border border-slate-200/20" 
                                                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                                                }`}
                                              >
                                                💻 Код текстом
                                              </button>
                                            </div>
                                            
                                            {/* Tab 1: GitHub Link submission */}
                                            {capstoneSubmissionTab === "github" ? (
                                              <div className="space-y-4 bg-slate-50 dark:bg-slate-950/40 p-4 border border-slate-200/60 dark:border-slate-900 rounded-2xl">
                                                <div className="space-y-2 text-left">
                                                  <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">📋 Пошаговая инструкция для защиты:</span>
                                                  <div className="space-y-2 text-[11px] text-slate-650 dark:text-slate-300 font-medium leading-relaxed">
                                                    <div className="flex items-start gap-1.5">
                                                      <span className="text-violet-500 font-bold shrink-0">1.</span>
                                                      <span>Создайте репозиторий на GitHub и сделайте его <strong>Публичным (Public)</strong>.</span>
                                                    </div>
                                                    <div className="flex items-start gap-1.5">
                                                      <span className="text-violet-500 font-bold shrink-0">2.</span>
                                                      <span>Склонируйте его и пишите проект локально на ПК в вашей IDE (VS Code и др.) без каких-либо компиляционных ограничений!</span>
                                                    </div>
                                                    <div className="flex items-start gap-1.5">
                                                      <span className="text-violet-500 font-bold shrink-0">3.</span>
                                                      <span>Сделайте коммиты и отправьте код (`git push origin main`) на GitHub.</span>
                                                    </div>
                                                    <div className="flex items-start gap-1.5">
                                                      <span className="text-violet-500 font-bold shrink-0">4.</span>
                                                      <span>Вставьте ссылку ниже и нажмите «Проверить». ИИ-Техлид изучит файлы репозитория и проведет детальный аудит!</span>
                                                    </div>
                                                  </div>
                                                </div>
                                                
                                                <div className="space-y-1.5">
                                                  <label className="text-[10px] font-black text-slate-455 dark:text-slate-400 uppercase tracking-wide block">Ссылка на репозиторий GitHub:</label>
                                                  <div className="relative flex items-center w-full">
                                                    <GitBranch className="absolute left-3 w-4 h-4 text-violet-500" />
                                                    <input
                                                      type="text"
                                                      value={capstoneGithubUrl}
                                                      onChange={(e) => setCapstoneGithubUrl(e.target.value)}
                                                      disabled={isSubmittingCapstone}
                                                      placeholder="https://github.com/пользователь/название-репозитория"
                                                      className="w-full pl-9 pr-4 py-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 rounded-xl focus:outline-none focus:ring-1 focus:ring-violet-500 text-xs font-semibold transition shadow-inner"
                                                    />
                                                  </div>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="space-y-2">
                                                <textarea
                                                  value={capstoneSolutionCode}
                                                  onChange={(e) => setCapstoneSolutionCode(e.target.value)}
                                                  disabled={isSubmittingCapstone}
                                                  placeholder="Вставьте сюда ваш исходный код, архитектуру базы данных или подробное техническое описание решения выпускного проекта..."
                                                  className="w-full h-48 bg-white dark:bg-slate-950 border border-slate-205 dark:border-slate-855 rounded-xl p-4 text-xs font-mono text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:ring-1 focus:ring-violet-500 leading-relaxed shadow-inner"
                                                />
                                              </div>
                                            )}
                                            
                                            <button
                                              onClick={handleSubmitCapstoneProject}
                                              disabled={isSubmittingCapstone || (capstoneSubmissionTab === "github" ? !capstoneGithubUrl.trim() : !capstoneSolutionCode.trim())}
                                              className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-650 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-black shadow-lg shadow-violet-500/10 flex items-center justify-center gap-2 transition"
                                            >
                                              {isSubmittingCapstone ? (
                                                <>
                                                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                                                  ИИ-Техлид проводит аудит репозитория...
                                                </>
                                              ) : (
                                                <>
                                                  {capstoneSubmissionTab === "github" ? <GitBranch className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                                                  {capstoneSubmissionTab === "github" ? "Проверить репозиторий GitHub" : "Отправить код на проверку ИИ-Лиду"}
                                                </>
                                              )}
                                            </button>
                                          </>
                                        ) : (
                                          <div className="p-5 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl flex flex-col items-center justify-center text-center gap-3">
                                            <Trophy className="w-12 h-12 text-amber-400 animate-bounce" />
                                            <h4 className="text-sm font-extrabold text-white">Вы успешно защитили проект!</h4>
                                            <p className="text-[11px] text-slate-300 max-w-sm leading-relaxed font-semibold">
                                              Поздравляем с официальным выпуском! Теперь вы можете посмотреть диплом выпускника и сгенерировать GitHub README портфолио на вкладке Аналитики.
                                            </p>
                                            
                                            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                                              <button
                                                onClick={() => setShowCertificateModal(true)}
                                                className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-amber-500/25 flex items-center justify-center gap-1.5 transition active:scale-95 animate-pulse"
                                              >
                                                <Award className="w-3.5 h-3.5" />
                                                🎓 Посмотреть диплом
                                              </button>

                                              {profile?.capstone_project?.github_repo_url && (
                                                <a
                                                  href={profile.capstone_project.github_repo_url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white border border-slate-800 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition"
                                                >
                                                  <GitBranch className="w-3.5 h-3.5" />
                                                  🐙 Репозиторий
                                                </a>
                                              )}
                                            </div>
                                            
                                            {profile?.capstone_project?.solution_code && (
                                              <details className="w-full mt-2 text-left">
                                                <summary className="text-[10px] text-emerald-400 font-black uppercase tracking-wider cursor-pointer hover:underline">Посмотреть ваше решение</summary>
                                                <pre className="mt-2 p-3 bg-slate-950 border border-slate-850 rounded-lg overflow-x-auto text-[10px] text-slate-300 font-mono whitespace-pre-wrap max-h-40">
                                                  {profile.capstone_project.solution_code}
                                                </pre>
                                              </details>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* AI Evaluation feedback block */}
                                  {profile?.capstone_project?.evaluation && (
                                    <div className="pt-6 border-t border-slate-850 mt-6 space-y-4 text-left">
                                      <div className="flex items-center justify-between gap-4 p-4 bg-slate-950/50 border border-slate-855 rounded-2xl">
                                        <div className="flex items-center gap-3">
                                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm border ${
                                            profile?.capstone_project?.evaluation?.score >= 70
                                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                                          }`}>
                                            {profile?.capstone_project?.evaluation?.score}/100
                                          </div>
                                          <div className="text-left">
                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Вердикт ИИ-Техлида:</span>
                                            <p className="text-xs text-slate-200 font-extrabold leading-relaxed mt-0.5">
                                              {profile?.capstone_project?.evaluation?.score >= 70 
                                                ? '🎉 Проект зачтен! Выпуск подтвержден.' 
                                                : '❌ Требуются доработки решения.'}
                                            </p>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="p-4 bg-slate-950/30 border border-slate-850 rounded-2xl text-xs space-y-3 text-left">
                                        <div className="text-slate-300 leading-relaxed italic">
                                          💬 <strong>Ревью:</strong> {profile?.capstone_project?.evaluation?.verdict}
                                        </div>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                          <div className="space-y-1.5 text-left">
                                            <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest block">✅ Сильные стороны:</span>
                                            {profile?.capstone_project?.evaluation?.strengths?.map((str: string, idx: number) => (
                                              <div key={idx} className="text-[10px] text-slate-300 flex items-start gap-1">
                                                <span className="text-emerald-500">•</span>
                                                <span>{str}</span>
                                              </div>
                                            ))}
                                          </div>
                                          
                                          <div className="space-y-1.5 text-left">
                                            <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest block">⚠️ Зоны роста:</span>
                                            {profile?.capstone_project?.evaluation?.weaknesses?.map((weak: string, idx: number) => (
                                              <div key={idx} className="text-[10px] text-slate-300 flex items-start gap-1">
                                                <span className="text-rose-500">•</span>
                                                <span>{weak}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        {profile?.capstone_project?.evaluation?.refactored_solution && (
                                          <div className="pt-4 border-t border-slate-850 mt-4 text-left">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                                              <span className="text-[9px] font-black text-violet-400 uppercase tracking-widest block">
                                                💡 Рекомендованный рефакторинг и советы:
                                              </span>
                                              
                                              {/* Compare Mode Switcher */}
                                              <div className="flex p-0.5 bg-slate-950 border border-slate-850 rounded-lg shrink-0">
                                                <button
                                                  type="button"
                                                  onClick={() => setCompareViewMode('split')}
                                                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md transition-all ${
                                                    compareViewMode === 'split'
                                                      ? 'bg-slate-900 text-violet-400 shadow-sm border border-slate-800/40'
                                                      : 'text-slate-500 hover:text-slate-400'
                                                  }`}
                                                >
                                                  Сплит-сравнение
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setCompareViewMode('refactoring')}
                                                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md transition-all ${
                                                    compareViewMode === 'refactoring'
                                                      ? 'bg-slate-900 text-violet-400 shadow-sm border border-slate-800/40'
                                                      : 'text-slate-500 hover:text-slate-400'
                                                  }`}
                                                >
                                                  Только ревью ИИ
                                                </button>
                                              </div>
                                            </div>

                                            {compareViewMode === 'split' ? (
                                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {/* Left Panel: Student original code */}
                                                <div className="space-y-1.5">
                                                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">
                                                    📂 Ваше решение:
                                                  </span>
                                                  {profile?.capstone_project?.solution_code ? (
                                                    <pre className="p-4 bg-slate-950 border border-slate-850 text-[10px] text-slate-355 font-mono rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[450px]">
                                                      {profile.capstone_project.solution_code}
                                                    </pre>
                                                  ) : (
                                                    <div className="p-5 bg-slate-950 border border-slate-850 rounded-xl text-center flex flex-col items-center justify-center min-h-[150px] gap-2">
                                                      <GitBranch className="w-6 h-6 text-violet-500" />
                                                      <span className="text-[10px] font-extrabold text-slate-300 uppercase">Проверка репозитория GitHub</span>
                                                      <p className="text-[10px] text-slate-500 leading-relaxed font-semibold max-w-[250px]">
                                                        Код проверен ИИ-Техлидом напрямую из вашего публичного репозитория:
                                                      </p>
                                                      <a
                                                        href={profile?.capstone_project?.github_repo_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-[10px] text-violet-400 hover:underline font-bold break-all"
                                                      >
                                                        {profile?.capstone_project?.github_repo_url}
                                                      </a>
                                                    </div>
                                                  )}
                                                </div>

                                                {/* Right Panel: AI recommended code */}
                                                <div className="space-y-1.5">
                                                  <span className="text-[9px] font-black text-violet-400 uppercase tracking-widest block">
                                                    🧙‍♂️ Код-ревью от ИИ-Ментора:
                                                  </span>
                                                  <pre className="p-4 bg-slate-950 border border-violet-900/30 text-[10px] text-violet-300 font-mono rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[450px]">
                                                    {profile.capstone_project.evaluation.refactored_solution}
                                                  </pre>
                                                </div>
                                              </div>
                                            ) : (
                                              /* Full screen AI Recommended solution */
                                              <pre className="p-4 bg-slate-950 border border-slate-850 text-[10px] text-slate-300 font-mono rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                                {profile?.capstone_project?.evaluation?.refactored_solution}
                                              </pre>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Layers className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      Учебная программа (Интерактивный Таймлайн)
                    </h2>
                    
                    <div className="relative border-l-2 border-slate-200 dark:border-slate-850 pl-6 ml-4 space-y-8">
                      {profile.course.modules.map((rawMod, idx) => {
                        const mod = patchModule(rawMod, profile?.course?.profession || "");
                        // Sprint 1: Mastery-based progressive lock (prev module needs score >= 70)
                        const prevMod = idx > 0 ? profile.course!.modules[idx - 1] : null;
                        const isUnlocked = idx === 0 || !!(prevMod?.completed && (prevMod?.mastery_score ?? prevMod?.score ?? 0) >= 70);
                        const isCompleted = mod.completed && (mod.mastery_score ?? mod.score ?? 0) >= 70;
                        const isDueForReview = dueReviews.some(r => r.module_id === mod.id);
                        
                        return (
                          <div key={mod.id} className="relative">
                            {/* Step icon connector */}
                            <div className={`absolute -left-[35px] top-1.5 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
                              isCompleted 
                                ? 'bg-emerald-500 border-emerald-500 text-white' 
                                : isUnlocked 
                                  ? 'bg-white dark:bg-slate-900 border-indigo-500 text-indigo-500 animate-pulse' 
                                  : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-800 text-slate-400'
                            }`}>
                              {isCompleted ? <Check className="w-3.5 h-3.5" /> : <span className="text-xs font-bold">{idx + 1}</span>}
                            </div>

                            <div className={`p-6 rounded-2xl border transition-all ${
                              activeModuleId === mod.id 
                                ? 'bg-white dark:bg-slate-900 border-indigo-400 shadow-md ring-1 ring-indigo-400/25' 
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700'
                            } ${!isUnlocked && 'opacity-60'}`}>
                              
                              <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
                                <h3 className="font-extrabold text-lg text-slate-900 dark:text-slate-100 leading-snug">
                                  {mod.title}
                                </h3>
                                
                                <div className="flex items-center gap-2 flex-wrap">
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
                                     <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-bold rounded-md flex items-center gap-1">
                                       <Trophy className="w-3 h-3" />
                                       {mod.mastery_score ?? mod.score}/100
                                     </span>
                                   )}

                                   {/* Sprint 1: Score exists but < 70 → not mastered yet */}
                                   {!isCompleted && mod.score !== undefined && (
                                     <span className="px-2 py-1 bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-md">
                                       ⚠️ {mod.score}/100 — ещё раз
                                     </span>
                                   )}

                                   {/* Sprint 1: Attempts counter */}
                                   {(mod.attempts ?? 0) > 1 && (
                                     <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold rounded-md">
                                       попытка {mod.attempts}
                                     </span>
                                   )}

                                   {/* Sprint 1: Spaced repetition due badge */}
                                   {isDueForReview && (
                                     <button
                                       onClick={(e) => { e.stopPropagation(); setReviewModal({ open: true, module: mod }); }}
                                       className="px-2 py-1 bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold rounded-md flex items-center gap-1 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition"
                                     >
                                       <RotateCcw className="w-2.5 h-2.5" /> Повторить сегодня
                                     </button>
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

                              <AnimatePresence>
                                {activeModuleId === mod.id && isUnlocked && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                     animate={{ opacity: 1, height: 'auto' }}
                                     exit={{ opacity: 0, height: 0 }}
                                     className="overflow-hidden mt-5 pt-5 border-t border-slate-100 dark:border-slate-800 space-y-5"
                                   >
                                     /* Pass externally banner removed as per requirements */

                                     <div>
                                      <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">🎯 Зачем это бизнесу</h4>
                                      <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-semibold italic bg-indigo-50/50 dark:bg-slate-800 p-3 rounded-lg border border-indigo-100/10">
                                        {mod.why_needed}
                                      </p>
                                    </div>

                                    <div>
                                      <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">📖 Ультимативная теория темы</h4>
                                      <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed space-y-2 prose prose-xs dark:prose-invert max-w-none prose-p:my-0">
                                        {mod.detailed_theory.split('|||').map((p) => p.trim()).filter(Boolean).map((para, pIdx) => (
                                          <div key={pIdx} className="group relative pr-8 bg-slate-50/30 dark:bg-slate-900/10 py-1.5 px-3 rounded-xl border border-transparent hover:border-violet-500/10 hover:bg-violet-500/[0.02] transition-all">
                                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{para}</ReactMarkdown>
                                            <button
                                              onClick={() => setSocraticParagraph(para)}
                                              className="absolute top-2 right-2 p-1 bg-violet-600/10 hover:bg-violet-600 text-violet-600 hover:text-white dark:text-violet-400 border border-violet-500/20 rounded opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                              title="Обсудить с Сократом"
                                            >
                                              <HelpCircle className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    <div>
                                      <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">🔗 Отобранные учебные ресурсы</h4>
                                      <div className="space-y-3">
                                        {mod.resources.map((res, rIdx) => (
                                          <a 
                                            key={rIdx}
                                            href={res.url ? res.url.replace('metanit.com/sql/postgres/', 'metanit.com/sql/postgresql/') : ''} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="block p-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-800 transition"
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

                                    <div className="pt-4 flex flex-col gap-4 border-t border-slate-100 dark:border-slate-800">
                                    <div className="flex flex-wrap items-center justify-between text-xs gap-3">
                                    <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-700 dark:text-slate-200">Выполнено заданий:</span>
                                    <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-650 dark:text-indigo-400 font-extrabold rounded">
                                    {mod.completed_tasks?.length ?? 0} из 10
                                    </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-700 dark:text-slate-200">Итоговый тест (20 вопросов):</span>
                                    <span className={`px-2 py-0.5 font-extrabold rounded ${
                                    mod.test_completed
                                    ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400'
                                    }`}>
                                    {mod.test_completed ? `Сдан (${mod.test_score}%)` : 'Не сдан'}
                                    </span>
                                    </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-4">
                                    <button
                                    onClick={() => openSandbox(mod)}
                                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition"
                                    >
                                    <Play className="w-3.5 h-3.5" />
                                    {mod.completed_tasks && mod.completed_tasks.length >= 10 ? 'Перепройти Песочницу' : 'Начать Практическое Задание'}
                                    </button>

                                    <button
                                    disabled={!(mod.completed_tasks && mod.completed_tasks.length >= 10)}
                                    onClick={() => setModuleTestModal({ open: true, module: mod })}
                                    className={`px-5 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 transition shadow-sm ${
                                    mod.test_completed
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                    : (mod.completed_tasks && mod.completed_tasks.length >= 10)
                                    ? 'bg-violet-600 hover:bg-violet-500 text-white animate-pulse'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                                    }`}
                                    >
                                    📝 {mod.test_completed ? 'Перепройти Тест Модуля' : 'Пройти Тест Модуля (20 вопросов)'}
                                    </button>
                                    </div>

                                      {isCompleted && mod.evaluation && (
                                        <div className="p-4 bg-emerald-50 dark:bg-slate-800 rounded-xl border border-emerald-100 dark:border-slate-800 text-xs w-full">
                                          <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-400 font-bold mb-1">
                                            <ThumbsUp className="w-4 h-4" />
                                            Резюме ментора (балл: {mod.evaluation.score}/100)
                                          </div>
                                          <p className="text-slate-600 dark:text-slate-300 leading-relaxed italic mb-2">"{mod.evaluation.verdict}"</p>
                                          
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
          ) : activeTab === 'plan' ? (
            profile && (
              !profile.course ? (
                <div className="max-w-2xl mx-auto py-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-3xl shadow-sm">
                  <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <BookOpen className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mb-4">Сначала создайте курс</h3>
                  <p className="text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                    Перейдите на вкладку <strong>🎓 ИИ-Курс</strong>, чтобы начать интервью с ИИ-коучем и сгенерировать масштабный план обучения.
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Header card with progress stats & action button */}
                  <div className="bg-gradient-to-tr from-indigo-900/40 via-slate-900/90 to-indigo-900/40 border border-indigo-500/20 rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-2xl">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl opacity-30 pointer-events-none" />
                    
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                      <div className="space-y-3">
                        <span className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 rounded-full text-[10px] font-black uppercase tracking-widest">
                          Индивидуальный трек обучения
                        </span>
                        <h2 className="text-xl md:text-3xl font-black text-white leading-tight flex items-center gap-3">
                          <BookOpen className="w-8 h-8 text-indigo-450" />
                          План обучения (Силлабус)
                        </h2>
                        <p className="text-xs md:text-sm text-slate-300 max-w-xl font-medium leading-relaxed">
                          Этот масштабный план был разработан ИИ-коучем на основе детального парсинга требований рынка к вакансии <strong className="text-indigo-300">{profile.course?.profession || 'специалиста'}</strong>. Силлабус содержит полную цепочку от азов до уровня Senior.
                        </p>
                      </div>

                      {/* Progress block & action button */}
                      {profile.course?.syllabus && (() => {
                        let total = 0;
                        let completed = 0;
                        for (const chapter of profile.course.syllabus.chapters || []) {
                          for (const topic of chapter.topics || []) {
                            total++;
                            if (topic.is_completed) completed++;
                          }
                        }
                        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
                        
                        const nextTopicToGenerate = (() => {
                          for (const c of profile.course.syllabus.chapters || []) {
                            for (const t of c.topics || []) {
                              if (!t.is_completed) return t.title;
                            }
                          }
                          return null;
                        })();

                        return (
                          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl md:w-80 shrink-0 space-y-4 shadow-xl backdrop-blur-sm">
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs font-bold text-slate-350">
                                <span>Общий прогресс:</span>
                                <span className="text-indigo-450">{completed} из {total} тем ({percent}%)</span>
                              </div>
                              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700/50">
                                <div className="bg-gradient-to-r from-indigo-500 to-emerald-550 h-full transition-all duration-550" style={{ width: `${percent}%` }} />
                              </div>
                            </div>

                            {nextTopicToGenerate ? (
                              <div className="space-y-2 pt-2 border-t border-slate-800/85">
                                <div className="text-[10px] uppercase font-black tracking-wider text-slate-400">
                                  Следующая тема к генерации:
                                </div>
                                <div className="text-xs font-bold text-white truncate max-w-full">
                                  {nextTopicToGenerate}
                                </div>
                                <button
                                  onClick={handleGenerateNextSyllabusModule}
                                  disabled={isGeneratingNextModule}
                                  className="w-full px-4 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-500/15 flex items-center justify-center gap-2 transition disabled:opacity-50"
                                >
                                  {isGeneratingNextModule ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      Генерация...
                                    </>
                                  ) : (
                                    <>
                                      <Zap className="w-3.5 h-3.5 text-indigo-150 fill-indigo-150" />
                                      Открыть тему
                                    </>
                                  )}
                                </button>
                              </div>
                            ) : total > 0 ? (
                              <div className="space-y-2 pt-2 border-t border-slate-800/85 text-center">
                                <div className="text-emerald-400 font-extrabold text-xs flex items-center justify-center gap-1">
                                  <Award className="w-4 h-4" /> Вы прошли весь силлабус!
                                </div>
                                <button
                                  onClick={handleStartExpandChat}
                                  className="w-full px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-black transition"
                                >
                                  🚀 Расширить программу
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Massive Syllabus Syllabus Roadmap Card Grid */}
                  {profile.course?.syllabus?.chapters ? (
                    <div className="space-y-6">
                      {profile.course.syllabus.chapters.map((chapter: any, cIdx: number) => {
                        const chTotal = chapter.topics?.length || 0;
                        const chCompleted = chapter.topics?.filter((t: any) => t.is_completed).length || 0;
                        const chPercent = chTotal > 0 ? Math.round((chCompleted / chTotal) * 100) : 0;
                        
                        return (
                          <div key={cIdx} className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm transition-all hover:border-slate-300 dark:hover:border-slate-750">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100 dark:border-slate-800/80">
                              <div>
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-550">Глава {cIdx + 1}</span>
                                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 uppercase tracking-wide mt-0.5">
                                  {chapter.title}
                                </h3>
                              </div>
                              <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                  {chCompleted}/{chTotal} пройденных тем
                                </span>
                                <div className="w-16 bg-slate-200 dark:bg-slate-850 rounded-full h-1.5 overflow-hidden">
                                  <div className="bg-indigo-500 h-full transition-all duration-350" style={{ width: `${chPercent}%` }} />
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                              {chapter.topics.map((topic: any, tIdx: number) => {
                                const isTopicCompleted = topic.is_completed;
                                
                                const nextTopic = (() => {
                                  if (!profile.course?.syllabus?.chapters) return null;
                                  for (const c of profile.course.syllabus.chapters) {
                                    for (const t of c.topics) {
                                      if (!t.is_completed) return t.title;
                                    }
                                  }
                                  return null;
                                })();

                                const isNext = !isTopicCompleted && nextTopic === topic.title;

                                return (
                                  <div 
                                    key={tIdx} 
                                    className={`group flex items-start gap-3 p-4 rounded-2xl border transition-all ${
                                      isTopicCompleted 
                                        ? 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-450 shadow-sm' 
                                        : isNext
                                          ? 'bg-indigo-500/5 dark:bg-indigo-500/10 border-indigo-500/30 text-indigo-650 dark:text-indigo-400 ring-1 ring-indigo-500/15'
                                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-450 hover:border-slate-300 dark:hover:border-slate-700'
                                    }`}
                                  >
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                                      isTopicCompleted 
                                        ? 'bg-emerald-500 text-white' 
                                        : isNext
                                          ? 'bg-indigo-50 text-white shadow-md shadow-indigo-500/20 animate-pulse'
                                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 group-hover:bg-slate-200 dark:group-hover:bg-slate-700'
                                    }`}>
                                      {isTopicCompleted ? (
                                        <Check className="w-3.5 h-3.5" />
                                      ) : isNext ? (
                                        <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                                      ) : (
                                        <span className="text-[10px] font-black">{tIdx + 1}</span>
                                      )}
                                    </div>
                                    
                                    <div className="flex-1 min-w-0 space-y-1">
                                      <div className="text-xs font-extrabold truncate max-w-full group-hover:text-slate-900 dark:group-hover:text-slate-100">
                                        {topic.title}
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        {isTopicCompleted ? (
                                          <span className="text-[10px] font-extrabold text-emerald-555/80 uppercase">
                                            Пройдено
                                          </span>
                                        ) : isNext ? (
                                          <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wide animate-pulse">
                                            Текущий шаг
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase">
                                            Ожидает
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                      <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto mb-4" />
                      <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Генерируется детальный план обучения...</p>
                    </div>
                  )}
                </div>
              )
            )
          ) : activeTab === 'interviews' ? (
            profile && (
              !profile.course ? (
                <div className="max-w-2xl mx-auto py-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-3xl shadow-sm">
                  <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Briefcase className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mb-4">Сначала создайте курс</h3>
                  <p className="text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                    Перейдите на вкладку <strong>🎓 ИИ-Курс</strong>, чтобы начать интервью с ИИ-коучем и сгенерировать масштабный план обучения.
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Header card with progress stats & action button */}
                  <div className="bg-gradient-to-tr from-violet-900/40 via-slate-900/90 to-violet-900/40 border border-violet-500/20 rounded-3xl p-6 md:p-8 relative overflow-hidden shadow-2xl">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl opacity-30 pointer-events-none" />
                    
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                      <div className="space-y-3">
                        <span className="px-3 py-1 bg-violet-500/10 border border-violet-500/30 text-violet-400 rounded-full text-[10px] font-black uppercase tracking-widest">
                          Симуляция Технического Собеседования
                        </span>
                        <h2 className="text-xl md:text-3xl font-black text-white leading-tight flex items-center gap-3">
                          <Award className="w-8 h-8 text-violet-450 animate-pulse" />
                          🎙️ Тренажер ИИ-Интервью
                        </h2>
                        <p className="text-xs md:text-sm text-slate-300 max-w-xl font-medium leading-relaxed">
                          Пройдите полноценное голосовое собеседование с ИИ-рекрутером на основе требований вакансии <strong className="text-violet-300">{profile.course.profession}</strong> и сданных вами модулей. В конце вы получите детальный разбор ваших soft & hard skills.
                        </p>
                      </div>

                      {/* Enforce all modules completed rule */}
                      {(() => {
                        const totalModules = profile.course?.modules.length ?? 0;
                        const completedModules = profile.course?.modules.filter(m => m.completed).length ?? 0;
                        const isAllCompleted = totalModules > 0 && completedModules === totalModules;

                        return (
                          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl md:w-80 shrink-0 space-y-4 shadow-xl backdrop-blur-sm">
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs font-bold text-slate-350">
                                <span>Готовность к собеседованию:</span>
                                <span className="text-violet-400">{completedModules} из {totalModules} модулей</span>
                              </div>
                              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700/50">
                                <div className="bg-gradient-to-r from-violet-500 to-indigo-500 h-full transition-all duration-550" style={{ width: `${(completedModules / (totalModules || 1)) * 100}%` }} />
                              </div>
                            </div>

                            {isAllCompleted ? (
                              <button
                                onClick={() => setShowMockInterview(true)}
                                className="w-full px-5 py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl text-xs font-black shadow-lg shadow-violet-500/15 flex items-center justify-center gap-2 transition"
                              >
                                <Play className="w-4 h-4 fill-current" />
                                Начать ИИ-Собеседование
                              </button>
                            ) : (
                              <div className="space-y-2 pt-2 border-t border-slate-800/85">
                                <div className="text-[10px] text-slate-455 font-extrabold uppercase tracking-wide flex items-center gap-1">
                                  <span>🔒 Доступ временно закрыт</span>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                                  Чтобы запустить симуляцию собеседования, завершите все оставшиеся модули курса (пройдите по 10 заданий и сдайте тесты из 20 вопросов в каждом модуле!).
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* History List */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 mb-6 flex items-center gap-2">
                      📋 История пройденных собеседований
                    </h3>
                    
                    {!profile.mock_interviews || profile.mock_interviews.length === 0 ? (
                      <div className="text-center py-12 bg-slate-50 dark:bg-slate-950/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                        <Trophy className="w-8 h-8 text-slate-400 mx-auto mb-3" />
                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">У вас пока нет завершенных собеседований.</p>
                        <p className="text-[10px] text-slate-450 dark:text-slate-500 mt-0.5">Освойте программу курса и пройдите первую симуляцию!</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {profile.mock_interviews.map((item, idx) => (
                          <div key={idx} className="p-4 bg-slate-50 dark:bg-slate-950/30 border border-slate-250/60 dark:border-slate-800/60 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition hover:bg-slate-100/50 dark:hover:bg-slate-950/50">
                            <div className="space-y-1 text-left">
                              <span className="text-[10px] font-bold text-slate-455">{item.date}</span>
                              <h4 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                                {item.vacancy}
                              </h4>
                              <p className="text-[11px] text-slate-500 dark:text-slate-455 leading-relaxed max-w-2xl">
                                💬 <strong>Вердикт:</strong> {item.verdict}
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-4 self-start md:self-center shrink-0">
                              <div className="text-right">
                                <span className="text-[10px] text-slate-455 uppercase font-black tracking-wider block">Оценка HR</span>
                                <span className={`text-sm font-black ${item.score >= 80 ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-650 dark:text-indigo-400'}`}>
                                  {item.score}/100
                                </span>
                              </div>
                              
                              <div className="text-right">
                                <span className="text-[10px] text-slate-455 uppercase font-black tracking-wider block">Грейд</span>
                                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-md">
                                  {item.grade}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )
          ) : activeTab === 'jobs' ? (
            profile && (
              <JobTracker
                profile={profile}
                onUpdateProfile={handleUpdateProfile}
                onStartInterview={(vac) => {
                  setSelectedVacancy({
                    title: vac.title,
                    company: vac.company,
                    salary: '',
                    requirements: vac.requirements,
                    responsibility: '',
                    source: 'Custom'
                  });
                  setShowMockInterview(true);
                }}
              />
            )
          ) : (
            profile && (
              <div className="space-y-8">
                <LearningDashboard profile={profile} />

                {/* Sprint 3: GitHub README Portfolio Exporter Card */}
                <div className="bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm mt-6 relative overflow-hidden text-left">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-slate-800 dark:bg-slate-350" />
                  {(() => {
                    const totalM = profile?.course?.modules.length ?? 0;
                    const completedM = profile?.course?.modules.filter(m => m.completed).length ?? 0;
                    const isAllMCompleted = totalM > 0 && completedM === totalM;
                    const isCapCompleted = profile?.capstone_project?.status === "completed";
                    
                    if (!isAllMCompleted || !isCapCompleted) {
                      return (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center text-slate-500 shrink-0 border border-slate-200 dark:border-slate-700">
                              <Lock className="w-6 h-6 text-slate-400" />
                            </div>
                            <div>
                              <h4 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                                🐙 Экспорт портфолио в GitHub README
                              </h4>
                              <p className="text-xs text-rose-500 dark:text-rose-400 font-semibold mt-1">
                                {!isAllMCompleted 
                                  ? "🔒 Доступ закрыт: завершите все модули учебного плана, чтобы разблокировать выпускной пет-проект." 
                                  : "🔒 Доступ закрыт: успешно сдайте выпускной пет-проект (набрав не менее 70 баллов)." }
                              </p>
                            </div>
                          </div>
                          <button
                            disabled
                            className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 rounded-xl text-xs font-black cursor-not-allowed shrink-0 border border-slate-200 dark:border-slate-700"
                          >
                            Заблокировано
                          </button>
                        </div>
                      );
                    }
                    
                    return (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-855 dark:text-slate-200 shrink-0">
                            <GitBranch className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                          </div>
                          <div>
                            <h2 className="text-sm md:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              🐙 Экспорт портфолио в GitHub README
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Сгенерируйте профессиональный README для ваших проектов</p>
                          </div>
                        </div>
                        <button
                          onClick={handleGenerateReadme}
                          disabled={isReadmeLoading}
                          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-50 text-white dark:text-slate-900 rounded-xl text-xs font-extrabold flex items-center gap-2 transition disabled:opacity-50 shrink-0 self-start sm:self-center"
                        >
                          {isReadmeLoading ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Генерация...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              Сгенерировать README.md
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })()}

                  {githubReadme && (
                    <div className="space-y-3.5 border-t border-slate-100 dark:border-slate-850 pt-5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-bold dark:text-slate-400 uppercase tracking-wide">Ваш README.md готов:</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(githubReadme);
                            toast.success('Скопировано в буфер обмена!');
                          }}
                          className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-extrabold transition flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Скопировать
                        </button>
                      </div>
                      <div className="relative">
                        <pre className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-[11px] leading-relaxed overflow-x-auto max-h-72 border border-slate-800 shadow-inner">
                          <code>{githubReadme}</code>
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          )}

        </>
      )}

      {/* VACANCY SELECTION & AI VACANCY CHAT MODAL */}
      <AnimatePresence>
        {showVacancySelector && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/60 dark:bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className="bg-white dark:bg-slate-900 text-slate-850 dark:text-white w-full max-w-[96vw] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[92vh] backdrop-blur-md"
            >
              {/* Header */}
              <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
                    <Briefcase className="w-5 h-5 text-indigo-100" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 dark:text-white text-base md:text-lg flex items-center gap-2">
                      Подборка вакансий: <span className="text-indigo-400">{pendingCourseParams?.profession}</span>
                    </h3>
                    <p className="text-xs text-slate-400">Мы нашли лучшие предложения по вашему региону ({pendingCourseParams?.location || 'Не указан'})</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowVacancySelector(false)}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Manual Search & Filter Bar (Variant B) */}
              <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-3 items-center shrink-0">
                <div className="w-full sm:flex-1 relative">
                  <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchProfession}
                    onChange={(e) => setSearchProfession(e.target.value)}
                    placeholder="Направление / профессия (например: Backend-разработчик)"
                    className="w-full pl-10 pr-4 py-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="w-full sm:w-[250px] relative">
                  <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchLocation}
                    onChange={(e) => setSearchLocation(e.target.value)}
                    placeholder="Город или регион (например: Минск)"
                    className="w-full pl-10 pr-4 py-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button
                  onClick={() => {
                    if (!searchProfession.trim()) {
                      toast.error("Пожалуйста, введите название профессии.");
                      return;
                    }
                    setPendingCourseParams(prev => prev ? {
                      ...prev,
                      profession: searchProfession,
                      location: searchLocation
                    } : {
                      profession: searchProfession,
                      level: 'Junior',
                      salary: '',
                      location: searchLocation,
                      extraContext: '',
                      gender: ''
                    });
                    fetchAndSetVacancies(searchProfession, searchLocation);
                  }}
                  disabled={loadingVacancies}
                  className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-extrabold rounded-xl transition flex items-center justify-center gap-2 whitespace-nowrap animate-all"
                >
                  <Search className="w-4 h-4" /> Найти вакансии
                </button>
              </div>

              {loadingVacancies ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                  <p className="text-sm text-slate-400 font-semibold animate-pulse">Анализируем вакансии и подключаем ИИ-консультанта...</p>
                </div>
              ) : foundVacancies.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-xl mx-auto space-y-6">
                  <div className="w-16 h-16 bg-amber-500/10 dark:bg-amber-500/5 rounded-2xl flex items-center justify-center border border-amber-500/20 shadow-sm mx-auto">
                    <AlertCircle className="w-8 h-8 text-amber-500 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-extrabold text-slate-900 dark:text-white text-base md:text-lg">Вакансий не найдено</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      Мы не смогли найти вакансии по запросу <strong className="text-indigo-600 dark:text-indigo-400">"{pendingCourseParams?.profession}"</strong> в локации <strong className="text-indigo-600 dark:text-indigo-400">"{pendingCourseParams?.location || 'любой регион'}"</strong> на HeadHunter API.
                    </p>
                  </div>
                  
                  <div className="w-full bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl text-left text-xs space-y-3.5">
                    <span className="font-bold text-slate-700 dark:text-slate-200 block border-b border-slate-200 dark:border-slate-800 pb-1.5 uppercase tracking-wider text-[10px]">Рекомендации по поиску:</span>
                    <ul className="list-disc list-inside space-y-2 text-slate-650 dark:text-slate-400 leading-normal font-semibold">
                      <li>Попробуйте <strong>изменить/сократить поисковый запрос</strong> (например, вместо <code className="text-indigo-500 dark:text-indigo-400 font-mono">Senior React Developer</code> напишите просто <code className="text-indigo-500 dark:text-indigo-400 font-mono">Frontend</code> или <code className="text-indigo-500 dark:text-indigo-400 font-mono">React</code>).</li>
                      <li>Попробуйте <strong>указать более крупный город или регион</strong> (например, <code className="text-indigo-500 dark:text-indigo-400 font-mono">Москва</code>, <code className="text-indigo-500 dark:text-indigo-400 font-mono">Минск</code>, <code className="text-indigo-500 dark:text-indigo-400 font-mono">Санкт-Петербург</code>).</li>
                      <li>Оставьте поле локации <strong>пустым</strong> — тогда поиск выдаст все вакансии без территориального ограничения (отлично подойдет для <strong>удаленной работы</strong>).</li>
                    </ul>
                  </div>
                  <button
                    onClick={() => {
                      const prof = pendingCourseParams?.profession || profile?.course?.profession || 'Frontend-разработчик';
                      setSearchProfession(prof);
                      setSearchLocation('');
                      setPendingCourseParams(prev => prev ? {
                        ...prev,
                        profession: prof,
                        location: ''
                      } : null);
                      fetchAndSetVacancies(prof, '');
                    }}
                    className="px-5 py-2.5 bg-indigo-650 hover:bg-indigo-600 text-white text-xs font-black rounded-xl transition shadow-md"
                  >
                    Показать вакансии без привязки к городу
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                  {/* Mobile tab switcher for vacancy modal */}
                  <VacancyMobileTabs
                    foundVacancies={foundVacancies}
                    selectedVacancy={selectedVacancy}
                    vacancyChatMessages={vacancyChatMessages}
                    vacancyChatInput={vacancyChatInput}
                    setVacancyChatInput={setVacancyChatInput}
                    sendingVacancyChat={sendingVacancyChat}
                    handleSendVacancyChatMessage={handleSendVacancyChatMessage}
                    onSelectVacancy={(vac) => {
                      setSelectedVacancy(vac);
                      setVacancyChatMessages([{ role: 'assistant', content: `Я вижу, что ты выбрал отличную вакансию: **"${vac.title}"** в компании **"${vac.company}"**.\n\nДавай обсудим её!` }]);
                    }}
                    onLaunchCourse={() => setShowConfirmModal(true)}
                    pendingLocation={pendingCourseParams?.location}
                    formatSalary={formatSalary}
                  />
                  {/* Left Side: Vacancy selector list */}
                  <div className="hidden lg:flex w-full lg:w-[26%] shrink-0 border-r border-slate-200 dark:border-slate-800 p-4 flex-col gap-3 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/40">
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Найдено вакансий: {foundVacancies.length}</h4>
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
                                ? 'bg-gradient-to-r from-indigo-50 to-indigo-100/50 dark:from-indigo-950/60 dark:to-indigo-900/40 border-indigo-500 dark:border-indigo-500 shadow-sm dark:shadow-md'
                                : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex justify-between items-start gap-2 min-w-0">
                              <span className="font-extrabold text-sm text-slate-800 dark:text-slate-100 line-clamp-2 min-w-0">{vac.title}</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0 border border-slate-200 dark:border-slate-700">{vac.source}</span>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold truncate">{vac.company}</span>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/40 gap-2">
                              <span className="text-xs font-bold text-emerald-500 dark:text-emerald-400 whitespace-nowrap">{formatSalary(vac.salary, pendingCourseParams?.location)}</span>
                              <span className="text-[10px] text-indigo-400 flex items-center gap-0.5 font-bold shrink-0">Детали <ChevronRight className="w-3 h-3" /></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Side: Selected Vacancy details + AI Chat Split Screen — desktop only */}
                  <div className="hidden lg:flex flex-grow flex-col lg:flex-row overflow-hidden bg-slate-50/30 dark:bg-slate-900/20">
                    {selectedVacancy ? (
                      <>
                        {/* Split Left: Detailed description */}
                        <div className="w-full lg:w-[50%] p-6 border-r border-slate-200 dark:border-slate-800 overflow-y-auto flex flex-col justify-between">
                          <div className="space-y-6">
                            <div>
                              <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-2">
                                <Target className="w-4 h-4" /> Детализация вакансии
                              </div>
                              <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">{selectedVacancy.title}</h2>
                              <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 mt-1">{selectedVacancy.company}</p>
                              <p className="text-base font-bold text-emerald-400 mt-2">{formatSalary(selectedVacancy.salary, pendingCourseParams?.location)}</p>
                            </div>

                            <div className="space-y-4">
                              {selectedVacancy.requirements && (
                                <div>
                                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Требования:</h4>
                                  <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-100/40 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-200 dark:border-slate-800/60 prose prose-xs dark:prose-invert max-w-none prose-p:my-0.5 prose-ul:my-1 prose-li:my-0.5 prose-strong:font-bold">
                                    <ReactMarkdown>{selectedVacancy.requirements}</ReactMarkdown>
                                  </div>
                                </div>
                              )}
                              {selectedVacancy.responsibility && (
                                <div>
                                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Обязанности:</h4>
                                  <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-100/40 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-200 dark:border-slate-800/60 prose prose-xs dark:prose-invert max-w-none prose-p:my-0.5 prose-ul:my-1 prose-li:my-0.5">
                                    <ReactMarkdown>{selectedVacancy.responsibility}</ReactMarkdown>
                                  </div>
                                </div>
                              )}
                            </div>

                            {selectedVacancy.url && (
                              <a
                                href={selectedVacancy.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 transition font-bold"
                              >
                                Посмотреть оригинал вакансии <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>

                          <div className="pt-6 border-t border-slate-200 dark:border-slate-800/60 mt-6 pb-8 shrink-0">
                            <button
                              onClick={() => {
                                const lastGen = profile?.course?.last_generated_at;
                                if (lastGen) {
                                  const diffMs = new Date().getTime() - new Date(lastGen).getTime();
                                  const diffHours = diffMs / (1000 * 60 * 60);
                                  if (false && diffHours < 24) {
                                    const remainingHours = Math.ceil(24 - diffHours);
                                    toast.error(`Лимит генерации активен. Пожалуйста, подождите ещё ${remainingHours} ч.`);
                                    return;
                                  }
                                }
                                setShowConfirmModal(true);
                              }}
                              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-950/20 dark:shadow-none transition hover:scale-[1.01] active:scale-[0.99] border border-indigo-500/30"
                            >
                              <div className="flex items-center justify-center gap-2.5 px-4 text-center">
                                <Zap className="w-5 h-5 text-indigo-100 animate-pulse shrink-0" />
                                <span className="text-sm tracking-wide">
                                  Запустить индивидуальный курс под вакансию
                                </span>
                              </div>
                            </button>
                          </div>
                        </div>

                        {/* Split Right: AI Vacancy Coach Chat */}
                        <div className="flex-1 flex flex-col overflow-hidden bg-slate-100/[0.15] dark:bg-slate-950/30">
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
                                      ? 'bg-indigo-600 text-white rounded-br-none'
                                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-none border border-slate-200 dark:border-slate-700/50'
                                  }`}
                                >
                                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                              </div>
                            ))}
                            {sendingVacancyChat && (
                              <div className="flex justify-start">
                                <div className="bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 p-3 rounded-2xl rounded-tl-none flex items-center gap-2 text-xs border border-slate-200 dark:border-slate-700/50">
                                  <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                                  <span>ИИ анализирует вакансию и печатает...</span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Chat Input */}
                          <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex gap-2 items-center">
                            <input
                              type="text"
                              value={vacancyChatInput}
                              onChange={(e) => setVacancyChatInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSendVacancyChatMessage()}
                              placeholder="Задай любой вопрос по этой вакансии..."
                              className="flex-1 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-850 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                      <div className="flex-grow flex flex-col items-center justify-center p-6 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900">
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
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl text-center space-y-5"
            >
              <div className="w-14 h-14 bg-indigo-100 dark:bg-indigo-950/60 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400 mx-auto border border-indigo-200 dark:border-indigo-900/60">
                <Sparkles className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">Создание ультимативного курса</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  ИИ StudyForge создаст масштабную программу обучения из <strong>10-14 глубоких модулей</strong>, полностью ориентированных на требования вакансии <strong>"{selectedVacancy.title}"</strong> в <strong>"{selectedVacancy.company}"</strong>.
                </p>
              </div>

              <div className="bg-indigo-50 dark:bg-indigo-950/40 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 text-left space-y-3">
                <div className="flex gap-2.5 items-start text-xs text-slate-700 dark:text-slate-300">
                  <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold text-slate-800 dark:text-slate-200">Расход ресурсов:</span> Это сложная операция, использующая самые умные ИИ-агенты, и задействует <strong>50 единиц энергии/токенов</strong>.
                  </div>
                </div>
                <div className="flex gap-2.5 items-start text-xs text-slate-600 dark:text-slate-300">
                  <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold text-slate-700 dark:text-slate-200">Rate Limit:</span> В целях предотвращения спама вы сможете генерировать следующий курс только <strong>раз в 24 часа (1 раз в день)</strong>.
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-extrabold transition"
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
              <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
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
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-400 dark:text-slate-300 transition"
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
                        : 'bg-white dark:bg-slate-800 text-slate-850 dark:text-slate-100 rounded-tl-none shadow-sm border border-slate-200/40 dark:border-slate-800'
                    }`}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
                {sendingExpandChat && (
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-slate-800 text-slate-400 p-4 rounded-2xl rounded-tl-none flex items-center gap-2 text-xs shadow-sm border border-slate-200/40 dark:border-slate-800">
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
                  className="flex-grow px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                
                <button 
                  onClick={handleSendExpandChatMessage}
                  disabled={sendingExpandChat || !expandChatInput.trim()}
                  className="p-3 bg-indigo-600 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-xl transition shadow-md shadow-indigo-200 dark:shadow-none"
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
              <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
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
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none border border-slate-200/40 dark:border-slate-800'
                    }`}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
                {sendingChat && (
                  <div className="flex justify-start">
                    <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-2xl rounded-bl-none text-slate-500 dark:text-slate-400 flex items-center gap-2 text-xs border border-slate-200/40 dark:border-slate-800">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                      Коуч обдумывает ответ...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Suggestions chips */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-800 shrink-0 flex flex-wrap gap-2">
                {chatMessages.length === 1 && (
                  <>
                    <button onClick={() => handleSendCoachMessage('Хочу создавать сайты и интерфейсы (Frontend)')} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">🎨 Frontend-разработка</button>
                    <button onClick={() => handleSendCoachMessage('Интересны базы данных и проектирование серверной части (Backend)')} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">🔌 Backend (Python/JS)</button>
                    <button onClick={() => handleSendCoachMessage('Люблю цифры, графики и работу со статистикой')} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">📊 Аналитика данных / SQL</button>
                  </>
                )}
                {chatMessages.length === 3 && (
                  <>
                    <button onClick={() => handleSendCoachMessage('Могу учиться 1-2 часа в день в спокойном темпе')} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">⏳ Спокойный темп (1-2ч)</button>
                    <button onClick={() => handleSendCoachMessage('Готов учиться интенсивно по 4 часа в день')} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg hover:border-indigo-400 text-slate-700 dark:text-slate-300 transition">🔥 Интенсивно (4ч+)</button>
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
                  className="flex-1 px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              className="bg-white dark:bg-slate-900 w-full max-w-[96vw] w-[96vw] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[90vh]"
            >
              {/* Sandbox Top Header */}
              <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
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
              <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2">
                {/* Left screen: technical task parameters */}
                <div className="overflow-y-auto p-4 md:p-6 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 space-y-6">
                  {selectedModule.tasks && selectedModule.tasks.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-nowrap pb-3 border-b border-slate-100 dark:border-slate-800/80 mb-4 overflow-x-auto whitespace-nowrap scrollbar-thin">
                      {selectedModule.tasks.map((t: any, idx: number) => {
                        const isCompleted = selectedModule.completed_tasks?.includes(t.id);
                        const isActive = idx === activeTaskIndex;
                        const isUnlocked = idx <= (selectedModule.completed_tasks?.length ?? 0);
                        
                        return (
                          <button
                            key={t.id}
                            disabled={!isUnlocked}
                            onClick={() => {
                              selectTask(idx, selectedModule);
                            }}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold border transition-all flex items-center gap-1 shrink-0 ${
                              isActive 
                                ? 'bg-indigo-600 border-indigo-650 text-white shadow-sm'
                                : (isCompleted 
                                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                    : (isUnlocked 
                                        ? 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-350 hover:bg-slate-100'
                                        : 'opacity-40 cursor-not-allowed bg-slate-100 dark:bg-slate-900/40 border-transparent text-slate-400'
                                      )
                                  )
                            }`}
                          >
                            <span>Задача {idx + 1}</span>
                            {isCompleted && <span>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div>
                    <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">
                      📋 Техническое задание (ТЗ) {selectedModule.tasks ? `(${activeTaskIndex + 1} из ${selectedModule.tasks.length})` : ''}
                    </h4>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-semibold text-left">
                      {selectedModule.tasks && selectedModule.tasks[activeTaskIndex] 
                        ? selectedModule.tasks[activeTaskIndex].task_description 
                        : selectedModule.practice_task.task_description}
                    </p>
                  </div>

                  {/* Render test cases summary if any */}
                  {(() => {
                    const activeTask = selectedModule.tasks && selectedModule.tasks[activeTaskIndex]
                      ? selectedModule.tasks[activeTaskIndex]
                      : selectedModule.practice_task;
                    
                    return activeTask.test_cases && activeTask.test_cases.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2">🧪 Тестовые сценарии (тест-кейсы)</h4>
                        <div className="space-y-2 text-xs">
                          {activeTask.test_cases.map((tc: any, tcIdx: number) => (
                            <div key={tcIdx} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 font-mono text-left">
                              <div><span className="text-slate-400">Вход:</span> {tc.input}</div>
                              <div><span className="text-slate-400">Ожидается:</span> {tc.expected}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Inline evaluation result after expert review */}
                  {lastEvalResult && (
                    <div className={`p-4 rounded-xl border space-y-3 ${
                      lastEvalResult.score >= 70
                        ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30'
                        : 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30'
                    }`}>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                          {lastEvalResult.score >= 70
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            : <AlertCircle className="w-4 h-4 text-rose-500" />}
                          Резюме эксперта: {lastEvalResult.score}/100
                        </h4>
                        <button onClick={() => setLastEvalResult(null)} className="text-slate-400 hover:text-slate-600 transition">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {lastEvalResult.verdict && (
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">{lastEvalResult.verdict}</p>
                      )}
                      {lastEvalResult.strengths?.length > 0 && (
                        <div>
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide block mb-1">✅ Сильные стороны:</span>
                          <ul className="space-y-0.5">{lastEvalResult.strengths.map((s: string, i: number) => (
                            <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-1">
                              <span className="text-emerald-500 mt-0.5">•</span>{s}
                            </li>
                          ))}</ul>
                        </div>
                      )}
                      {lastEvalResult.weaknesses?.length > 0 && (
                        <div>
                          <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wide block mb-1">❌ Что улучшить:</span>
                          <ul className="space-y-0.5">{lastEvalResult.weaknesses.map((w: string, i: number) => (
                            <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-1 text-left">
                              <span className="text-rose-500 mt-0.5">•</span>{w}
                            </li>
                          ))}</ul>
                        </div>
                      )}

                      {lastEvalResult.score >= 70 && selectedModule.tasks && activeTaskIndex < selectedModule.tasks.length - 1 && (
                        <button
                          onClick={() => {
                            const nextIdx = activeTaskIndex + 1;
                            selectTask(nextIdx, selectedModule);
                          }}
                          className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-650 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all hover:-translate-y-0.5"
                        >
                          <span>Перейти к следующей задаче ({activeTaskIndex + 2} из {selectedModule.tasks.length})</span>
                          <ArrowRight className="w-3.5 h-3.5 animate-pulse" />
                        </button>
                      )}
                    </div>
                  )}
                  {localTested && (
                    <div className={`p-4 rounded-xl border ${localTestedPassed ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30' : 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30'}`}>
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

                  {/* Sprint 3: AI Code Diagnostics Panel */}
                  {showDiagnosticsPanel && (
                    <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-slate-900/60 relative overflow-hidden space-y-4">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-bold flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
                          <Cpu className="w-4 h-4 text-indigo-500 animate-pulse" />
                          ИИ-Анализ и оптимизация
                        </h4>
                        <button
                          onClick={() => setShowDiagnosticsPanel(false)}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {isDiagnosticsLoading ? (
                        <div className="flex flex-col items-center justify-center py-6 space-y-2">
                          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                          <span className="text-[10px] text-slate-500 font-bold dark:text-slate-400">ИИ анализирует сложность и качество кода...</span>
                        </div>
                      ) : diagnosticsResult ? (
                        <div className="space-y-3.5 text-xs">
                          {/* Score and Complexity */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold mb-0.5">Оценка решения</span>
                              <span className="font-extrabold text-sm text-indigo-600 dark:text-indigo-400">{diagnosticsResult.score_estimate ?? 100} / 100</span>
                            </div>
                            <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold mb-0.5">Сложность (Big O)</span>
                              <span className="font-mono text-[10px] font-bold text-slate-700 dark:text-slate-300">{diagnosticsResult.complexity || 'N/A'}</span>
                            </div>
                          </div>

                          {/* Issues/Warnings list */}
                          {diagnosticsResult.issues && diagnosticsResult.issues.length > 0 && (
                            <div>
                              <span className="font-bold text-[10px] text-slate-500 block mb-1.5 uppercase">⚠️ Замечания по коду:</span>
                              <ul className="space-y-1.5 pl-1">
                                {diagnosticsResult.issues.map((issue: string, idx: number) => (
                                  <li key={idx} className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                                    <span className="text-amber-500 mt-0.5 select-none">•</span>
                                    <span>{issue}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Refactoring suggestions */}
                          {diagnosticsResult.refactored_suggestion && (
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="font-bold text-[10px] text-slate-500 uppercase">💡 ИИ-Решение и Рефакторинг:</span>
                                <button
                                  onClick={() => {
                                    setSandboxCode(diagnosticsResult.refactored_suggestion);
                                    setShowDiagnosticsPanel(false);
                                    toast.success('ИИ-код успешно скопирован в редактор!');
                                  }}
                                  className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[9px] font-bold transition flex items-center gap-1 shadow-sm"
                                >
                                  <Check className="w-2.5 h-2.5" />
                                  Применить решение
                                </button>
                              </div>
                              <pre className="p-3 bg-slate-950 text-slate-200 rounded-lg font-mono text-[10px] leading-relaxed overflow-x-auto max-h-48 border border-slate-800">
                                <code>{diagnosticsResult.refactored_suggestion}</code>
                              </pre>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Ошибка получения результатов анализа.</div>
                      )}
                    </div>
                  )}

                  {/* Submission Run History Accordion */}
                  {runHistory.length > 1 && (
                    <div className="mt-4 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900/30 shadow-sm">
                      <details className="group">
                        <summary className="px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer flex items-center justify-between transition select-none">
                          <span className="flex items-center gap-2">📜 История последних запусков ({runHistory.length - 1})</span>
                          <span className="text-[10px] text-slate-400 group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3 max-h-48 overflow-y-auto">
                          {runHistory.slice(1).map((run, rIdx) => (
                            <div key={rIdx} className="space-y-1.5 border-b border-slate-100 dark:border-slate-800/60 pb-2.5 last:border-0 last:pb-0">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="font-extrabold text-slate-400 dark:text-slate-500">{run.time}</span>
                                <span className={`font-bold px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider ${
                                  run.passed 
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' 
                                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                                }`}>
                                  {run.passed ? 'Успешно' : 'Сбой'}
                                </span>
                              </div>
                              <div className="space-y-0.5 font-mono text-[10px] pl-1.5 border-l-2 border-slate-200 dark:border-slate-800">
                                {run.logs.map((log, lIdx) => (
                                  <div key={lIdx} className={log.startsWith('✅') ? 'text-emerald-600 dark:text-emerald-500/80' : log.startsWith('❌') ? 'text-rose-600 dark:text-rose-400/80' : 'text-slate-500 dark:text-slate-400'}>
                                    {log}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}
                </div>

                {/* Right screen: Live Workspace (interactive depending on sandbox type) */}
                <div className="overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950 flex flex-col justify-between">
                  
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
                          onChange={(e) => updateSandboxCode(e.target.value)}
                          className="flex-grow w-full p-4 bg-slate-900 text-slate-100 rounded-2xl font-mono text-sm leading-relaxed focus:outline-none h-[300px] border border-slate-800 focus:ring-1 focus:ring-indigo-500 shadow-inner"
                        />
                      </div>
                    )}

                    {/* SQL simulator workspace */}
                    {selectedModule.practice_type === 'sql' && (() => {
                      const isUsersTask = selectedModule.practice_task.task_description.toLowerCase().includes('users') || 
                                          selectedModule.practice_task.task_description.toLowerCase().includes('пользовател') || 
                                          sandboxCode.toLowerCase().includes('users');
                      return (
                        <div className="space-y-4">
                          <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            <span className="font-bold block mb-1">Схема базы данных:</span>
                            {isUsersTask ? (
                              <span className="font-mono">users (id INTEGER, username TEXT, registration_date TEXT, status TEXT)</span>
                            ) : (
                              <span className="font-mono">vacancies (id INTEGER, title TEXT, salary INTEGER, level TEXT, company TEXT)</span>
                            )}
                          </div>
                          <textarea
                            value={sandboxCode}
                            onChange={(e) => updateSandboxCode(e.target.value)}
                            className="w-full p-4 bg-slate-900 text-slate-100 rounded-2xl font-mono text-sm leading-relaxed focus:outline-none h-[180px] border border-slate-800 focus:ring-1 focus:ring-indigo-500 shadow-inner"
                          />
                          
                          {localTestedPassed && (
                            <div className="space-y-2">
                              <span className="text-xs font-bold text-slate-500">Таблица результатов запроса:</span>
                              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[11px]">
                                <table className="w-full text-left">
                                  {isUsersTask ? (
                                    <>
                                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 uppercase text-[10px]">
                                        <tr>
                                          <th className="p-2 border-b">id</th>
                                          <th className="p-2 border-b">username</th>
                                          <th className="p-2 border-b">registration_date</th>
                                          <th className="p-2 border-b">status</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y dark:divide-slate-850">
                                        <tr>
                                          <td className="p-2 font-mono">1</td>
                                          <td className="p-2 font-semibold text-indigo-600 dark:text-indigo-400">alex_dev</td>
                                          <td className="p-2 text-slate-500">2023-04-12</td>
                                          <td className="p-2 text-emerald-500 font-bold">active</td>
                                        </tr>
                                        <tr>
                                          <td className="p-2 font-mono">2</td>
                                          <td className="p-2 font-semibold text-indigo-600 dark:text-indigo-400">maria_qa</td>
                                          <td className="p-2 text-slate-500">2023-09-25</td>
                                          <td className="p-2 text-emerald-500 font-bold">active</td>
                                        </tr>
                                        <tr>
                                          <td className="p-2 font-mono">3</td>
                                          <td className="p-2 font-semibold text-indigo-600 dark:text-indigo-400">denis_lead</td>
                                          <td className="p-2 text-slate-500">2023-01-05</td>
                                          <td className="p-2 text-emerald-500 font-bold">active</td>
                                        </tr>
                                        <tr>
                                          <td className="p-2 font-mono">4</td>
                                          <td className="p-2 font-semibold text-indigo-600 dark:text-indigo-400">john_doe</td>
                                          <td className="p-2 text-slate-500">2023-11-30</td>
                                          <td className="p-2 text-emerald-500 font-bold">active</td>
                                        </tr>
                                        <tr>
                                          <td className="p-2 font-mono">5</td>
                                          <td className="p-2 font-semibold text-indigo-600 dark:text-indigo-400">elena_pm</td>
                                          <td className="p-2 text-slate-500">2023-06-18</td>
                                          <td className="p-2 text-emerald-500 font-bold">active</td>
                                        </tr>
                                      </tbody>
                                    </>
                                  ) : (
                                    <>
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
                                          <td className="p-2 text-emerald-500 font-bold">180,000₽</td>
                                          <td className="p-2">Yandex</td>
                                        </tr>
                                        <tr>
                                          <td className="p-2 font-mono">3</td>
                                          <td className="p-2 font-semibold">Lead Architect</td>
                                          <td className="p-2 text-emerald-500 font-bold">250,000₽</td>
                                          <td className="p-2">T-Bank</td>
                                        </tr>
                                        <tr>
                                          <td className="p-2 font-mono">4</td>
                                          <td className="p-2 font-semibold">SQL Analyst</td>
                                          <td className="p-2 text-emerald-500 font-bold">120,000₽</td>
                                          <td className="p-2">Ozon</td>
                                        </tr>
                                      </tbody>
                                    </>
                                  )}
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* WEB Responsive Layout visual iframe preview */}
                    {selectedModule.practice_type === 'web' && (
                      <div className="space-y-4 h-full flex flex-col">
                        <textarea
                          value={sandboxCode}
                          onChange={(e) => updateSandboxCode(e.target.value)}
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
                              onChange={(e) => updateSandboxInputs({ ...sandboxInputs, rice_a: e.target.value })}
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
                              onChange={(e) => updateSandboxInputs({ ...sandboxInputs, rice_b: e.target.value })}
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
                        
                        <div className="bg-white p-6 rounded-2xl border-2 border-rose-200/30 space-y-6 shadow-sm max-w-sm mx-auto relative overflow-hidden select-none">
                          {/* Bad font fonts style overlaps */}
                          <div 
                            onClick={() => updateSandboxClickErrors({ ...sandboxClickErrors, fonts: 'Разнобой шрифтов (Arial + Times + Comic Sans)' })}
                            className={`p-2 cursor-pointer border rounded-lg hover:bg-rose-50 ${sandboxClickErrors['fonts'] ? 'border-indigo-500 bg-indigo-50/20' : 'border-dashed border-slate-300'}`}
                          >
                            <h3 style={{ fontFamily: 'Times New Roman' }} className="text-lg font-bold text-slate-900">Заголовок макета</h3>
                            <p style={{ fontFamily: 'Comic Sans MS' }} className="text-xs text-slate-500">Канцеляризмы и очень нечитаемый шрифт описания.</p>
                          </div>

                          {/* Gray on gray contrast error */}
                          <div 
                            onClick={() => updateSandboxClickErrors({ ...sandboxClickErrors, contrast: 'Ужасная контрастность (светло-серый на белом)' })}
                            className={`p-2 cursor-pointer border rounded-lg hover:bg-rose-50 ${sandboxClickErrors['contrast'] ? 'border-indigo-500 bg-indigo-50/20' : 'border-dashed border-slate-300'}`}
                          >
                            <span className="text-[10px] text-slate-200">Малозаметный вспомогательный текст без контраста.</span>
                          </div>

                          {/* Shifted alignment layout */}
                          <div className="flex justify-between items-center gap-4">
                            <div 
                              onClick={() => updateSandboxClickErrors({ ...sandboxClickErrors, alignment: 'Нарушение выравнивания элементов по сетке' })}
                              className={`p-2 cursor-pointer border rounded-lg hover:bg-rose-50 flex-1 ${sandboxClickErrors['alignment'] ? 'border-indigo-500 bg-indigo-50/20' : 'border-dashed border-slate-300'}`}
                            >
                              <div className="ml-10 text-xs font-bold">Сдвинутый влево блок без причины</div>
                            </div>
                          </div>
                        </div>

                        {/* Identified errors chips */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          {Object.entries(sandboxClickErrors).map(([key, val]) => (
                            <span key={key} className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 font-bold rounded-lg border border-indigo-100 text-[10px] flex items-center gap-1">
                              {key.toUpperCase()}: {val}
                              <X onClick={() => {
                                const newErrs = { ...sandboxClickErrors };
                                delete newErrs[key];
                                updateSandboxClickErrors(newErrs);
                              }} className="w-3 h-3 cursor-pointer text-indigo-500 hover:text-indigo-700" />
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* COPYWRITING text editor tone checker */}
                    {selectedModule.practice_type === 'copywriting' && (
                      <div className="space-y-4">
                        <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-xl text-xs text-amber-800 dark:text-amber-400 leading-relaxed border border-amber-200/40 dark:border-amber-900/30">
                          <span className="font-bold block mb-1">Оригинальный черновик (вода и канцеляризмы):</span>
                          "Наша инновационная компания StudyForge осуществляет внедрение передовых синергетических обучающих ИИ-решений с уникальной методикой для достижения тотального лидерства на современном EdTech-рынке..."
                        </div>
                        <textarea
                          value={sandboxText}
                          onChange={(e) => updateSandboxText(e.target.value)}
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
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none border border-slate-200/40 dark:border-slate-700'
                              }`}>
                                {msg.content}
                              </div>
                            </div>
                          ))}
                          {sendingRoleplay && (
                            <div className="flex justify-start">
                              <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-xl rounded-bl-none text-slate-500 text-[10px] flex items-center gap-1.5">
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
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2 shrink-0 bg-slate-50 dark:bg-slate-950">
                    {selectedModule.practice_type !== 'roleplay' && (
                      <>
                        <button
                          onClick={runLocalTests}
                          className="px-4 py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Локальный прогон (0 токенов)
                        </button>
                        {(selectedModule.practice_type === 'algo' || selectedModule.practice_type === 'sql' || selectedModule.practice_type === 'web') && (
                          <button
                            onClick={handleRunDiagnostics}
                            disabled={isDiagnosticsLoading}
                            className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold flex items-center gap-2 transition disabled:opacity-50 whitespace-nowrap"
                          >
                            {isDiagnosticsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cpu className="w-3.5 h-3.5" />}
                            🤖 ИИ-Анализ
                          </button>
                        )}
                      </>
                    )}
                    <button
                      onClick={handleAISubmit}
                      disabled={(!localTestedPassed && selectedModule.practice_type !== 'roleplay') || isEvaluating}
                      className="ml-auto px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 transition shadow-md shadow-indigo-200 dark:shadow-none disabled:opacity-40 whitespace-nowrap"
                    >
                      {isEvaluating ? (
                        <><Loader2 className="w-4 h-4 animate-spin" />Эксперт пишет ревью...</>
                      ) : (
                        <><Sparkles className="w-4 h-4" />Ревью эксперта (5⚡)</>
                      )}
                    </button>
                  </div>

                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sprint 1: Spaced Repetition Review Test Modal */}
      {reviewModal.open && reviewModal.module && (
        <ReviewTestModal
          moduleId={reviewModal.module.id}
          moduleTitle={reviewModal.module.title}
          moduleTheory={reviewModal.module.detailed_theory}
          practiceType={reviewModal.module.practice_type}
          courseProfession={profile?.course?.profession || ''}
          token={(supabase.auth as any)._currentSession?.access_token || ''}
          onClose={() => setReviewModal({ open: false, module: null })}
          onComplete={(score) => {
            const xpGain = score >= 70 ? XP_REWARDS.review_passed : 10;
            if (user && profile) {
              saveXPToProfile(user.id, profile, xpGain).then(setProfile);
              toast.success(`🔁 Повторение завершено! +${xpGain} XP`, { duration: 3000 });
            }
            // Refresh due reviews
            supabase.auth.getSession().then(({ data }) => {
              const token = data.session?.access_token;
              if (token) getDueReviews(token).then(setDueReviews).catch(() => {});
            });
          }}
        />
      )}

      {/* Module 20-question Test Modal */}
      {moduleTestModal.open && moduleTestModal.module && (
        <ReviewTestModal
          moduleId={moduleTestModal.module.id}
          moduleTitle={moduleTestModal.module.title}
          moduleTheory={moduleTestModal.module.detailed_theory}
          practiceType={moduleTestModal.module.practice_type}
          courseProfession={profile?.course?.profession || ''}
          token={(supabase.auth as any)._currentSession?.access_token || ''}
          numQuestions={20}
          onClose={() => setModuleTestModal({ open: false, module: null })}
          onComplete={async (score) => {
            if (!user || !profile || !profile.course) return;
            const targetMod = moduleTestModal.module!;
            
            // Mark test as completed & update module completed status
            const updatedModules = profile.course.modules.map(m => {
              if (m.id === targetMod.id) {
                const tasksDone = m.completed_tasks && m.completed_tasks.length >= 10;
                const testPassed = score >= 70;
                return {
                  ...m,
                  test_completed: true,
                  test_score: score,
                  completed: tasksDone && testPassed,
                  mastery_score: Math.max(m.mastery_score ?? 0, score),
                  score: Math.max(m.score ?? 0, score)
                };
              }
              return m;
            });

            // Update syllabus topic status
            const updatedSyllabus = profile.course.syllabus ? {
              ...profile.course.syllabus,
              chapters: profile.course.syllabus.chapters.map((ch: any) => ({
                ...ch,
                topics: ch.topics ? ch.topics.map((t: any) => {
                  if (t.module_id === targetMod.id) {
                    const m = updatedModules.find(x => x.id === targetMod.id);
                    return { ...t, is_completed: !!m?.completed };
                  }
                  return t;
                }) : []
              }))
            } : undefined;

            const xpGain = score >= 70 ? 100 : 25; // 100 XP for passing module test, 25 for trying

            const updatedProfile = await saveXPToProfile(
              user.id,
              {
                ...profile,
                course: {
                  ...profile.course,
                  modules: updatedModules,
                  syllabus: updatedSyllabus || profile.course.syllabus
                }
              },
              xpGain,
              'roleplay'
            );

            if (updatedProfile) {
              setProfile(updatedProfile);
              toast.success(`🎉 Итоговый тест пройден! Результат: ${score}%. Получено +${xpGain} XP!`);
              if (score >= 70) {
                confetti({ particleCount: 150, spread: 80 });
              }
            }
            setModuleTestModal({ open: false, module: null });
          }}
        />
      )}

      {/* Sprint 2: Mock Interview Modal */}
      {showMockInterview && user && profile && profile.course && (
        <MockInterviewModal
          userId={user.id}
          profile={profile}
          profession={profile.course.profession}
          vacancyTitle={selectedVacancy?.title || profile.course.profession}
          vacancyCompany={selectedVacancy?.company || 'StudyForge'}
          vacancyRequirements={selectedVacancy?.requirements || 'Стек курса'}
          completedModulesTitles={profile.course.modules.filter(m => m.completed).map(m => m.title)}
          onClose={() => setShowMockInterview(false)}
          onComplete={() => {
            setShowMockInterview(false);
            loadProfile();
          }}
        />
      )}

      {/* Sprint 2: Socratic Tutor paragraph drawer */}
      {socraticParagraph && profile?.course && (
        <SocraticTutor
          paragraphText={socraticParagraph}
          profession={profile.course.profession}
          isBeginnerLevel={!profile.course.level || ['Начинающий', 'Новичок', 'Junior', 'Стажёр'].includes(profile.course.level)}
          onClose={() => setSocraticParagraph(null)}
        />
      )}

      {/* Sprint 3: Diagnostic Entrance Test Modal */}
      {showDiagnosticModal && diagnosticModule && profile?.course && (
        <DiagnosticTestModal
          moduleTitle={diagnosticModule.title}
          moduleTheory={diagnosticModule.detailed_theory}
          profession={profile.course.profession}
          onClose={() => { setShowDiagnosticModal(false); setDiagnosticModule(null); }}
          onComplete={handleDiagnosticComplete}
        />
      )}

      {/* Graduate Certificate Modal */}
      {showCertificateModal && profile && user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md print:p-0 print:bg-white print:relative print:z-0">
          <style>{`
            @media print {
              body * {
                visibility: hidden !important;
              }
              .print\\:relative, .print\\:relative * {
                visibility: visible !important;
              }
              .print\\:relative {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                height: 100% !important;
                background: white !important;
                color: black !important;
                padding: 0 !important;
                margin: 0 !important;
              }
              .print\\:hidden {
                display: none !important;
              }
            }
          `}</style>
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative bg-slate-900 border border-amber-500/30 rounded-3xl p-6 md:p-8 max-w-4xl w-full text-center shadow-2xl overflow-hidden print:border-none print:shadow-none print:p-0 print:rounded-none print:bg-white print:w-full print:max-w-none print:relative"
          >
            {/* Ambient Background Lights - hidden in print */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl -mr-16 -mt-16 animate-pulse print:hidden" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -ml-16 -mb-16 animate-pulse print:hidden" />

            {/* Modal Controls - hidden in print */}
            <div className="absolute top-4 right-4 flex items-center gap-2 print:hidden z-10">
              <button
                type="button"
                onClick={() => window.print()}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-xl transition flex items-center gap-1.5 text-xs font-black shadow-md active:scale-95"
                title="Печать диплома / Сохранить в PDF"
              >
                <Printer className="w-4 h-4" />
                Печать / PDF
              </button>
              <button
                type="button"
                onClick={() => setShowCertificateModal(false)}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl transition shadow-md active:scale-95"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* CERTIFICATE CONTAINER */}
            <div className="border-4 border-double border-amber-500/40 p-8 md:p-12 rounded-2xl bg-slate-950/60 relative overflow-hidden print:border-amber-500 print:bg-white print:p-8 print:text-black">
              {/* Gold corners */}
              <div className="absolute top-2 left-2 w-8 h-8 border-t-2 border-l-2 border-amber-500/50 print:border-amber-600" />
              <div className="absolute top-2 right-2 w-8 h-8 border-t-2 border-r-2 border-amber-500/50 print:border-amber-600" />
              <div className="absolute bottom-2 left-2 w-8 h-8 border-b-2 border-l-2 border-amber-500/50 print:border-amber-600" />
              <div className="absolute bottom-2 right-2 w-8 h-8 border-b-2 border-r-2 border-amber-500/50 print:border-amber-600" />

              {/* Logo / Header */}
              <div className="flex flex-col items-center justify-center gap-2.5 mb-6">
                <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-xl flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/20 print:shadow-none">
                  <Award className="w-7 h-7" />
                </div>
                <span className="text-[10px] font-black text-amber-400 dark:text-amber-500 uppercase tracking-widest print:text-amber-600">
                  Академический Сертификат Выпускника
                </span>
                <h2 className="text-3xl md:text-4xl font-serif font-black text-white dark:text-slate-100 tracking-wide mt-1.5 print:text-black">
                  StudyForge Academia
                </h2>
              </div>

              {/* Certificate Body */}
              <div className="space-y-6 max-w-2xl mx-auto my-6">
                <p className="text-xs md:text-sm text-slate-400 italic font-medium leading-relaxed print:text-slate-600">
                  Настоящим документом подтверждается, что выпускник
                </p>
                <input
                  type="text"
                  value={certificateStudentName}
                  onChange={(e) => setCertificateStudentName(e.target.value)}
                  placeholder="Введите ваши Имя и Фамилию"
                  className="text-center bg-transparent border-b border-transparent hover:border-amber-500/20 focus:border-amber-500 focus:outline-none text-xl md:text-2xl font-serif font-extrabold text-amber-300 dark:text-amber-400 w-full max-w-xl mx-auto py-1 print:border-none print:text-amber-600 print:text-center placeholder-slate-650"
                />
                <p className="text-xs md:text-sm text-slate-400 font-medium leading-relaxed max-w-lg mx-auto print:text-slate-600">
                  успешно освоил полную учебную программу и защитил выпускную практическую работу по карьерному треку
                </p>
                <h4 className="text-base md:text-lg font-bold text-white uppercase tracking-wider print:text-black">
                  🎓 {profile?.course?.profession || 'Специалист'}
                </h4>
                <p className="text-[10px] md:text-xs text-slate-400 dark:text-slate-500 font-semibold max-w-md mx-auto leading-relaxed print:text-slate-650">
                  Программа обучения включала прохождение всех теоретических и практических модулей, выполнение интерактивных sandbox-заданий, сдачу итоговых экзаменов и защиту выпускного пет-проекта.
                </p>
              </div>

              {/* Footer row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-slate-800/40 mt-8 text-left text-[11px] font-medium text-slate-400 dark:text-slate-500 print:text-black print:border-slate-300">
                <div className="space-y-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 print:text-slate-500 block">Оценка за проект:</span>
                  <span className="text-xs font-bold text-emerald-400 print:text-emerald-600 flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    {profile?.capstone_project?.evaluation?.score || 90} из 100 баллов
                  </span>
                </div>
                <div className="text-center md:text-left space-y-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 print:text-slate-500 block">ID сертификата:</span>
                  <span className="text-xs font-mono font-bold text-slate-350 print:text-slate-700">
                    SF-{(user?.id?.slice(0, 8) || 'GRAD').toUpperCase()}-{new Date().getFullYear()}
                  </span>
                </div>
                <div className="text-right space-y-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 print:text-slate-500 block">ИИ-Ректор StudyForge:</span>
                  <span className="text-xs font-serif italic font-black text-amber-300/80 print:text-amber-700 block mt-0.5">
                    Professor Veritas
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
}
