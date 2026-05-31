import { supabase } from '../lib/supabase';

export interface CareerCourse {
  profession: string;
  salary: string;
  level: string;
  insights: string;
  modules: CareerModule[];
  location?: string;
  syllabus?: SyllabusData;
  last_generated_at?: string;
}

export interface SyllabusTopic {
  title: string;
  is_completed: boolean;
  module_id?: string;
}

export interface SyllabusChapter {
  title: string;
  topics: SyllabusTopic[];
}

export interface SyllabusData {
  chapters: SyllabusChapter[];
}

export interface CareerModule {
  id: string;
  title: string;
  description: string;
  why_needed: string;
  detailed_theory: string;
  resources: { title: string; url: string; description: string }[];
  practice_type: 'algo' | 'sql' | 'web' | 'business' | 'design' | 'copywriting' | 'roleplay';
  practice_task: {
    task_description: string;
    origin_interview_questions?: string;
    code_template?: string;
    test_cases?: { input: string; expected: string }[];
    non_code_options?: string[];
    non_code_correct?: string;
    explanation: string;
  };
  // Sprint 1: Scaffolded Practice
  practice_guided?: {
    hints: string[];
    simplified_template?: string;
  };
  practice_expert?: {
    constraint: string;
    bonus_description: string;
  };
  // Sprint 1: Project Threading
  project_thread_step?: string;
  // Progress tracking
  completed?: boolean;
  mastery_score?: number; // threshold 70+ to unlock next
  attempts?: number;
  score?: number;
  evaluation?: {
    score: number;
    verdict: string;
    strengths: string[];
    weaknesses: string[];
    refactored_solution?: string;
  };
  student_solution?: string;
  // Spaced Repetition
  review_due_at?: string;
  // Multi-task module support
  tasks?: {
    id: number;
    title: string;
    task_description: string;
    code_template?: string;
    test_cases?: { input: string; expected: string }[];
  }[];
  completed_tasks?: number[];
}

export interface VacancyRecord {
  id: string;
  url?: string;
  title: string;
  company: string;
  salary?: string;
  requirements?: string;
  skills: string[];
  status: 'selected' | 'applied' | 'test_task' | 'interview' | 'offer' | 'rejected';
  match_score?: number;
}

export interface CareerProfile {
  skills: string[];
  professions: { title: string; match: number }[]
  resume_summary: string;
  projects: { title: string; description: string }[];
  course?: CareerCourse;
  // Sprint 1: Gamification
  xp?: number;
  level_name?: string;
  streak_days?: number;
  last_activity_date?: string;
  skills_radar?: Record<string, number>; // e.g. { Algorithms: 72, SQL: 45 }
  total_attempts?: number;
  // Sprint 2 additions
  activity_log?: { date: string; xp: number; type: string; label: string }[];
  mock_interviews?: { date: string; vacancy: string; score: number; grade: string; verdict: string }[];
  // Sprint 3 additions
  vacancies?: VacancyRecord[];
  last_course_deleted_at?: string;
}

export interface ReviewQuestion {
  id: number;
  question: string;
  options: string[];
  correct: string;
  explanation: string;
}

export interface ModuleReviewRecord {
  module_id: string;
  course_profession: string;
  next_review_at: string;
  ease_factor: number;
  interval_days: number;
  repetition_count: number;
  last_score: number;
}

export const XP_REWARDS = {
  theory_read: 10,
  task_completed: 30,
  task_mastered: 50,       // score >= 70
  task_perfect: 75,        // score >= 90
  review_passed: 20,
  expert_completed: 60,
  streak_bonus: 25,
} as const;

// Получить профиль из базы данных
export async function getCareerProfile(userId: string): Promise<CareerProfile | null> {
  const { data, error } = await supabase
    .from('career_profiles')
    .select('profile_json')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('Error fetching career profile:', error);
    return null;
  }
  
  return data ? (data.profile_json as CareerProfile) : null;
}

// Сохранить профиль в базу данных (Supabase Upsert)
export async function saveCareerProfile(userId: string, profile: CareerProfile): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('career_profiles')
      .upsert({
        user_id: userId,
        profile_json: profile,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Error saving career profile:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('saveCareerProfile exception:', error);
    return false;
  }
}

// Сгенерировать профиль через AI и сохранить в базу
export async function generateCareerProfile(userId: string, context: string): Promise<CareerProfile | null> {
  try {
    const res = await fetch('/api/career/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materials_context: context })
    });
    
    if (!res.ok) {
      throw new Error('Не удалось сгенерировать карьерный профиль');
    }
    
    const profileData: CareerProfile = await res.json();
    
    // Сохранение в Supabase
    await saveCareerProfile(userId, profileData);
    
    return profileData;
  } catch (error) {
    console.error('generateCareerProfile error:', error);
    return null;
  }
}

// Сгенерировать персональный курс на основе HH вакансий с демографической адаптацией
export async function generateCareerCourse(
  userId: string,
  profession: string,
  level: string,
  salary: string,
  userMaterials: string,
  location?: string,
  age?: number,
  gender?: string,
  extraContext?: string,
  vacancyContext?: string
): Promise<CareerCourse | null> {
  try {
    const res = await fetch('/api/career/course', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profession,
        level,
        salary,
        user_materials: userMaterials,
        location: location || "",
        age: age || null,
        gender: gender || "",
        extra_context: extraContext || "",
        vacancy_context: vacancyContext || ""
      })
    });
    
    if (!res.ok) {
      throw new Error('Ошибка генерации курса');
    }
    
    const courseData: CareerCourse = await res.json();
    
    // Подгружаем текущий профиль, внедряем курс и сохраняем
    courseData.last_generated_at = new Date().toISOString();
    
    const currentProfile = await getCareerProfile(userId);
    if (currentProfile) {
      currentProfile.course = courseData;
      await saveCareerProfile(userId, currentProfile);
    } else {
      // Если профиля еще нет, создаем базовый заглушечный с курсом
      const newProfile: CareerProfile = {
        skills: [],
        professions: [{ title: profession, match: 100 }],
        resume_summary: `Нацелен на освоение профессии ${profession} (уровень ${level}).`,
        projects: [],
        course: courseData
      };
      await saveCareerProfile(userId, newProfile);
    }
    
    return courseData;
  } catch (error) {
    console.error('generateCareerCourse error:', error);
    return null;
  }
}

// Расширить курс продвинутыми модулями
export async function expandCareerCourse(
  userId: string,
  currentCourse: CareerCourse,
  additionalFocus: string,
  extraContext?: string
): Promise<CareerModule[] | null> {
  try {
    const res = await fetch('/api/career/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_course: currentCourse,
        additional_focus: additionalFocus,
        extra_context: extraContext || ""
      })
    });
    
    if (!res.ok) {
      throw new Error('Ошибка расширения курса');
    }
    
    const data = await res.json();
    const newModules: CareerModule[] = data.new_modules || [];
    
    if (newModules.length > 0) {
      const currentProfile = await getCareerProfile(userId);
      if (currentProfile && currentProfile.course) {
        currentProfile.course.modules = [...currentProfile.course.modules, ...newModules];
        currentProfile.course.last_generated_at = new Date().toISOString();
        await saveCareerProfile(userId, currentProfile);
      }
    }
    
    return newModules;
  } catch (error) {
    console.error('expandCareerCourse error:', error);
    return null;
  }
}

// Сгенерировать следующий модуль по силлабусу
export async function generateNextSyllabusModule(
  userId: string,
  currentCourse: CareerCourse
): Promise<{ completed: boolean; course: CareerCourse } | null> {
  try {
    const res = await fetch('/api/career/next_module', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        current_course: currentCourse
      })
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Ошибка генерации следующего модуля по силлабусу');
    }
    
    const data = await res.json();
    const updatedCourse: CareerCourse = data.course;
    
    if (updatedCourse) {
      const currentProfile = await getCareerProfile(userId);
      if (currentProfile) {
        currentProfile.course = updatedCourse;
        await saveCareerProfile(userId, currentProfile);
      }
    }
    
    return {
      completed: data.completed,
      course: updatedCourse
    };
  } catch (error) {
    console.error('generateNextSyllabusModule error:', error);
    throw error;
  }
}

// Отправить сообщение ИИ карьерному коучу
export async function sendCareerChat(
  message: string,
  history: { role: string; content: string }[]
): Promise<string> {
  const res = await fetch('/api/career/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history })
  });
  
  if (!res.ok) {
    throw new Error('Ошибка диалога с коучем');
  }
  
  const data = await res.json();
  return data.reply;
}

// Оценить задание студента экспертным ИИ-методистом
export interface EvaluationResult {
  score: number;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  refactored_solution?: string;
}

export async function evaluateCareerTask(
  profession: string,
  moduleTitle: string,
  taskDescription: string,
  practiceType: string,
  studentSolution: string
): Promise<EvaluationResult> {
  const res = await fetch('/api/career/evaluate_task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profession,
      module_title: moduleTitle,
      task_description: taskDescription,
      practice_type: practiceType,
      student_solution: studentSolution
    })
  });
  
  if (!res.ok) {
    throw new Error('Ошибка оценки решения');
  }
  
  return await res.json();
}

export interface VacancyItem {
  title: string;
  company: string;
  salary: string;
  requirements: string;
  responsibility: string;
  url?: string;
  source: string;
}

export async function getCareerVacancies(
  profession: string,
  location?: string
): Promise<VacancyItem[]> {
  const res = await fetch('/api/career/vacancies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profession,
      location: location || ""
    })
  });
  
  if (!res.ok) {
    throw new Error('Ошибка получения вакансий');
  }
  
  return await res.json();
}

export async function sendVacancyChat(
  message: string,
  history: { role: string; content: string }[],
  vacancy: VacancyItem
): Promise<string> {
  const res = await fetch('/api/career/vacancy_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history,
      vacancy_title: vacancy.title,
      vacancy_company: vacancy.company,
      vacancy_requirements: vacancy.requirements,
      vacancy_responsibility: vacancy.responsibility
    })
  });
  
  if (!res.ok) {
    throw new Error('Ошибка отправки сообщения');
  }
  
  const data = await res.json();
  return data.reply;
}

// ── Sprint 1: Spaced Repetition ────────────────────────────────────────────────

export async function generateReviewTest(
  moduleId: string,
  moduleTitle: string,
  moduleTheory: string,
  practiceType: string
): Promise<{ questions: ReviewQuestion[] }> {
  const res = await fetch('/api/career/review_test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module_id: moduleId,
      module_title: moduleTitle,
      module_theory: moduleTheory,
      practice_type: practiceType,
    }),
  });
  if (!res.ok) throw new Error('Ошибка генерации теста повторения');
  return res.json();
}

export async function updateModuleReview(
  moduleId: string,
  courseProfession: string,
  score: number,
  token: string
): Promise<ModuleReviewRecord & { next_review_at: string }> {
  const res = await fetch('/api/career/update_review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ module_id: moduleId, course_profession: courseProfession, score }),
  });
  if (!res.ok) throw new Error('Ошибка обновления расписания повторений');
  return res.json();
}

export async function getDueReviews(token: string): Promise<ModuleReviewRecord[]> {
  const res = await fetch('/api/career/due_reviews', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}

// ── Sprint 1: Mastery-Based Retry ─────────────────────────────────────────────

export async function generateRetryTask(
  moduleTitle: string,
  practiceType: string,
  originalTask: string,
  weaknesses: string[]
): Promise<CareerModule['practice_task'] & { guided_hints?: string[] }> {
  const res = await fetch('/api/career/retry_task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module_title: moduleTitle,
      practice_type: practiceType,
      original_task: originalTask,
      weaknesses,
    }),
  });
  if (!res.ok) throw new Error('Ошибка генерации альтернативного задания');
  return res.json();
}

// ── Sprint 1: Socratic Micro-Tutor ────────────────────────────────────────────

export async function getModuleHint(
  paragraphText: string,
  profession: string
): Promise<string> {
  const res = await fetch('/api/career/module_hint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paragraph_text: paragraphText, profession }),
  });
  if (!res.ok) throw new Error('Ошибка получения подсказки');
  const data = await res.json();
  return data.explanation;
}

// ── Sprint 1: XP & Level Management ──────────────────────────────────────────

const LEVEL_THRESHOLDS = [
  { name: 'Новичок', min: 0 },
  { name: 'Стажёр', min: 150 },
  { name: 'Джун', min: 400 },
  { name: 'Мидл', min: 900 },
  { name: 'Синьор', min: 1800 },
  { name: 'Легенда', min: 3500 },
];

export function getLevelFromXP(xp: number): { name: string; nextThreshold: number; progress: number } {
  let current = LEVEL_THRESHOLDS[0];
  let nextMin = LEVEL_THRESHOLDS[1].min;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i].min) {
      current = LEVEL_THRESHOLDS[i];
      nextMin = LEVEL_THRESHOLDS[i + 1]?.min ?? LEVEL_THRESHOLDS[i].min + 9999;
    }
  }
  const progress = Math.min(100, Math.round(((xp - current.min) / (nextMin - current.min)) * 100));
  return { name: current.name, nextThreshold: nextMin, progress };
}

export async function saveXPToProfile(userId: string, profile: CareerProfile, addedXP: number, practiceType?: string): Promise<CareerProfile> {
  const newXP = (profile.xp ?? 0) + addedXP;
  const levelInfo = getLevelFromXP(newXP);

  // Update skills_radar based on practice type
  const radar = { ...(profile.skills_radar ?? {}) };
  const RADAR_MAP: Record<string, string[]> = {
    algo: ['Algorithms', 'Problem Solving'],
    sql: ['SQL/Data'],
    web: ['Web Dev', 'Code Quality'],
    business: ['Business Logic', 'Strategy'],
    design: ['Visual Design', 'UX Research'],
    copywriting: ['Copywriting', 'Communication'],
    roleplay: ['Soft Skills', 'Communication'],
  };
  if (practiceType && RADAR_MAP[practiceType]) {
    for (const axis of RADAR_MAP[practiceType]) {
      radar[axis] = Math.min(100, (radar[axis] ?? 0) + 10);
    }
    radar['Soft Skills'] = Math.min(100, (radar['Soft Skills'] ?? 0) + 6);
  }

  // Update streak
  const today = new Date().toISOString().split('T')[0];
  const lastActivity = profile.last_activity_date;
  let streak = profile.streak_days ?? 0;
  if (lastActivity) {
    const diff = Math.floor((new Date(today).getTime() - new Date(lastActivity).getTime()) / 86400000);
    if (diff === 1) streak += 1;
    else if (diff > 1) streak = 1;
  } else {
    streak = 1;
  }

  const activityLog = [...(profile.activity_log ?? [])];
  if (addedXP > 0) {
    activityLog.push({
      date: today,
      xp: addedXP,
      type: practiceType ? `task_${practiceType}` : 'gamification',
      label: practiceType ? `Практика: ${practiceType}` : 'Получен XP бонус'
    });
  }

  const updated: CareerProfile = {
    ...profile,
    xp: newXP,
    level_name: levelInfo.name,
    skills_radar: radar,
    streak_days: streak,
    last_activity_date: today,
    total_attempts: (profile.total_attempts ?? 0) + 1,
    activity_log: activityLog,
  };

  await saveCareerProfile(userId, updated);
  return updated;
}


// ── Sprint 2: Mock Interview ──────────────────────────────────────────────────

export interface MockInterviewEvaluation {
  score: number;
  grade: string;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  interview_ready: boolean;
}

export async function startMockInterview(
  profession: string,
  vacancyTitle: string,
  vacancyCompany: string,
  vacancyRequirements: string,
  completedModulesTitles: string[]
): Promise<{ session_id: string; initial_question: string }> {
  const res = await fetch('/api/career/mock_interview_start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profession,
      vacancy_title: vacancyTitle,
      vacancy_company: vacancyCompany,
      vacancy_requirements: vacancyRequirements,
      completed_modules_titles: completedModulesTitles,
    }),
  });
  if (!res.ok) throw new Error('Ошибка запуска собеседования');
  return res.json();
}

export async function respondMockInterview(
  profession: string,
  vacancyTitle: string,
  vacancyCompany: string,
  chatHistory: { role: string; content: string }[],
  studentAnswer: string
): Promise<{ next_question: string; is_finished: boolean }> {
  const res = await fetch('/api/career/mock_interview_respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profession,
      vacancy_title: vacancyTitle,
      vacancy_company: vacancyCompany,
      chat_history: chatHistory,
      student_answer: studentAnswer,
    }),
  });
  if (!res.ok) throw new Error('Ошибка отправки ответа интервьюеру');
  return res.json();
}

export async function evaluateMockInterview(
  profession: string,
  vacancyTitle: string,
  vacancyCompany: string,
  chatHistory: { role: string; content: string }[]
): Promise<MockInterviewEvaluation> {
  const res = await fetch('/api/career/mock_interview_evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profession,
      vacancy_title: vacancyTitle,
      vacancy_company: vacancyCompany,
      chat_history: chatHistory,
    }),
  });
  if (!res.ok) throw new Error('Ошибка оценки собеседования');
  return res.json();
}

// ── Sprint 2: Socratic Tutor ──────────────────────────────────────────────────

export async function sendSocraticChat(
  paragraphText: string,
  profession: string,
  message: string,
  chatHistory: { role: string; content: string }[],
  mode: 'explain' | 'socratic' = 'socratic',
  isBeginnerLevel: boolean = false
): Promise<string> {
  const res = await fetch('/api/career/socratic_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paragraph_text: paragraphText,
      profession,
      message,
      chat_history: chatHistory,
      mode,
      is_beginner: isBeginnerLevel,
    }),
  });
  if (!res.ok) throw new Error('Ошибка сократовского чата');
  const data = await res.json();
  return data.reply;
}

// ── Sprint 3 API Clients ──────────────────────────────────────────────────────

export async function parseVacancy(url: string): Promise<{
  title: string;
  company: string;
  salary: string;
  requirements: string;
  skills: string[];
}> {
  const res = await fetch('/api/career/parse_vacancy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error('Ошибка парсинга вакансии');
  return res.json();
}

export interface DiagnosticQuestion {
  question: string;
  options: string[];
  correct: string;
  explanation: string;
}

export async function getDiagnosticTest(
  moduleTitle: string,
  moduleTheory: string,
  profession: string
): Promise<{ questions: DiagnosticQuestion[] }> {
  const res = await fetch('/api/career/diagnostic_test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module_title: moduleTitle,
      module_theory: moduleTheory,
      profession,
    }),
  });
  if (!res.ok) throw new Error('Ошибка генерации диагностического теста');
  return res.json();
}

export interface CodeDiagnosticsResult {
  complexity: string;
  issues: string[];
  refactored_suggestion: string;
  score_estimate: number;
}

export async function getCodeDiagnostics(
  code: string,
  moduleTitle: string,
  taskDescription: string
): Promise<CodeDiagnosticsResult> {
  const res = await fetch('/api/career/code_diagnostics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      module_title: moduleTitle,
      task_description: taskDescription,
    }),
  });
  if (!res.ok) throw new Error('Ошибка диагностики кода');
  return res.json();
}

export async function generateGithubReadme(
  profession: string,
  completedModules: string[]
): Promise<{ readme: string }> {
  const res = await fetch('/api/career/github_readme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profession,
      completed_modules: completedModules,
    }),
  });
  if (!res.ok) throw new Error('Ошибка генерации README');
  return res.json();
}

