import { supabase } from '../lib/supabase';

export interface CareerProfile {
  skills: string[];
  professions: { title: string; match: number }[];
  resume_summary: string;
  projects: { title: string; description: string }[];
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

// Сгенерировать профиль через AI и сохранить в базу
export async function generateCareerProfile(userId: string, context: string): Promise<CareerProfile | null> {
  try {
    // 1. Вызов AI бэкенда
    const res = await fetch('/api/career/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materials_context: context })
    });
    
    if (!res.ok) {
      throw new Error('Не удалось сгенерировать карьерный профиль');
    }
    
    const profileData: CareerProfile = await res.json();
    
    // 2. Сохранение в Supabase (Upsert)
    const { error } = await supabase
      .from('career_profiles')
      .upsert({
        user_id: userId,
        profile_json: profileData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      
    if (error) {
      console.error('Error saving career profile:', error);
    }
    
    return profileData;
  } catch (error) {
    console.error('generateCareerProfile error:', error);
    return null;
  }
}
