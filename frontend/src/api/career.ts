import { supabase } from '../lib/supabase';

export interface CareerCourse {
  profession: string;
  salary: string;
  level: string;
  insights: string;
  modules: CareerModule[];
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
    code_template?: string;
    test_cases?: { input: string; expected: string }[];
    non_code_options?: string[];
    non_code_correct?: string;
    explanation: string;
  };
  completed?: boolean;
  score?: number;
  evaluation?: {
    score: number;
    verdict: string;
    strengths: string[];
    weaknesses: string[];
    refactored_solution?: string;
  };
  student_solution?: string;
}

export interface CareerProfile {
  skills: string[];
  professions: { title: string; match: number }[];
  resume_summary: string;
  projects: { title: string; description: string }[];
  course?: CareerCourse;
}

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
  extraContext?: string
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
        extra_context: extraContext || ""
      })
    });
    
    if (!res.ok) {
      throw new Error('Ошибка генерации курса');
    }
    
    const courseData: CareerCourse = await res.json();
    
    // Подгружаем текущий профиль, внедряем курс и сохраняем
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
