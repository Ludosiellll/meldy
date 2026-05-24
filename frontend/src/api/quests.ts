import { supabase } from '../lib/supabase';

export type QuestType = 'daily' | 'weekly';
export type TargetType = 'analyze' | 'quiz' | 'chat' | 'mood' | 'exam' | 'review' | 'podcast';

// ── XP / Уровни ───────────────────────────────────────────────────────────────

export const LEVEL_THRESHOLDS = [
  0,    // Lv 1  — Новичок
  100,  // Lv 2  — Стажёр
  250,  // Lv 3  — Знаток
  500,  // Lv 4  — Эксперт
  900,  // Lv 5  — Профессор
  1400, // Lv 6  — Мастер
  2000, // Lv 7  — Академик
  3000, // Lv 8  — Легенда
];

export const LEVEL_NAMES = [
  'Новичок', 'Стажёр', 'Знаток', 'Эксперт',
  'Профессор', 'Мастер', 'Академик', 'Легенда',
];

export function calcLevel(xp: number): { level: number; name: string; currentXP: number; nextXP: number; progress: number } {
  let level = 0;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) { level = i + 1; break; }
  }
  const capped = Math.min(level, LEVEL_NAMES.length);
  const currentThresh = LEVEL_THRESHOLDS[capped - 1] ?? 0;
  const nextThresh = LEVEL_THRESHOLDS[capped] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + 1000;
  const progress = Math.min(100, Math.round(((xp - currentThresh) / (nextThresh - currentThresh)) * 100));
  return { level: capped, name: LEVEL_NAMES[capped - 1] ?? 'Легенда', currentXP: xp - currentThresh, nextXP: nextThresh - currentThresh, progress };
}

// ── Получение XP пользователя ──────────────────────────────────────────────────

export async function getUserXP(userId: string): Promise<number> {
  const { data } = await supabase
    .from('user_xp')
    .select('total_xp')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.total_xp ?? 0;
}

export async function addXP(userId: string, amount: number): Promise<number> {
  const current = await getUserXP(userId);
  const newXP = current + amount;
  await supabase.from('user_xp').upsert({ user_id: userId, total_xp: newXP }, { onConflict: 'user_id' });
  return newXP;
}

export async function recordStudyActivity(userId: string, cardsReviewed: number = 0, materialsAdded: number = 0) {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const { data: existing } = await supabase
      .from('study_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('study_sessions')
        .update({
          cards_reviewed: (existing.cards_reviewed || 0) + cardsReviewed,
          materials_added: (existing.materials_added || 0) + materialsAdded
        })
        .eq('id', existing.id);
    } else {
      const { error } = await supabase
        .from('study_sessions')
        .insert({
          user_id: userId,
          date: today,
          cards_reviewed: cardsReviewed,
          materials_added: materialsAdded
        });
      
      // Обрабатываем возможную гонку уникальности (Unique violation)
      if (error && error.code === '23505') {
        const { data: retryExisting } = await supabase
          .from('study_sessions')
          .select('*')
          .eq('user_id', userId)
          .eq('date', today)
          .maybeSingle();
        if (retryExisting) {
          await supabase
            .from('study_sessions')
            .update({
              cards_reviewed: (retryExisting.cards_reviewed || 0) + cardsReviewed,
              materials_added: (retryExisting.materials_added || 0) + materialsAdded
            })
            .eq('id', retryExisting.id);
        }
      }
    }
  } catch (e) {
    console.error("Error recording study activity:", e);
  }
}


// ── Достижения ─────────────────────────────────────────────────────────────────

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  xp: number;
  check: (stats: UserStats) => boolean;
}

interface UserStats {
  totalExams: number;
  totalReviews: number;
  totalAnalyze: number;
  streak: number;
  exam5Count: number;
  totalMistakesResolved: number;
  totalXP: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_exam',       title: 'Первая сессия',        description: 'Сдали первый AI-экзамен',          icon: 'award',  xp: 50,  check: s => s.totalExams >= 1 },
  { id: 'exam_perfectionist', title: 'Перфекционист',      description: 'Получили пятёрку на AI-экзамене',  icon: 'star',   xp: 75,  check: s => s.exam5Count >= 1 },
  { id: 'three_exams',      title: 'Опытный экзаменуемый', description: 'Сдали 3 экзамена',                 icon: 'trophy', xp: 100, check: s => s.totalExams >= 3 },
  { id: 'streak_3',         title: 'На волне',              description: '3 дня учёбы подряд',              icon: 'flame',  xp: 60,  check: s => s.streak >= 3 },
  { id: 'streak_7',         title: 'Недельный марафон',    description: '7 дней учёбы подряд',              icon: 'flame',  xp: 150, check: s => s.streak >= 7 },
  { id: 'first_analyze',    title: 'Лаборант знаний',       description: 'Загрузили первую лекцию',          icon: 'zap',    xp: 30,  check: s => s.totalAnalyze >= 1 },
  { id: 'five_analyze',     title: 'Архивариус',            description: 'Загрузили 5 лекций',              icon: 'book',   xp: 100, check: s => s.totalAnalyze >= 5 },
  { id: 'review_50',        title: 'Мастер карточек',       description: 'Повторили 50 карточек',            icon: 'brain',  xp: 120, check: s => s.totalReviews >= 50 },
  { id: 'mistakes_resolved', title: 'Работа над ошибками', description: 'Исправили 5 ошибок из дневника',   icon: 'check',  xp: 80,  check: s => s.totalMistakesResolved >= 5 },
  { id: 'xp_500',           title: 'Пятисотник',            description: 'Набрали 500 XP',                  icon: 'award',  xp: 50,  check: s => s.totalXP >= 500 },
  { id: 'xp_1000',          title: 'Тысячник',              description: 'Набрали 1000 XP',                 icon: 'award',  xp: 100, check: s => s.totalXP >= 1000 },
];

export async function checkAndAwardAchievements(userId: string): Promise<AchievementDef[]> {
  // Получаем уже полученные достижения
  const { data: existing } = await supabase
    .from('user_achievements')
    .select('achievement_id')
    .eq('user_id', userId);
  const earnedIds = new Set((existing ?? []).map(e => e.achievement_id));

  // Собираем статистику
  const [examsRes, sessRes, matsRes, mistakesRes, xp] = await Promise.all([
    supabase.from('exam_sessions').select('score').eq('user_id', userId).eq('status', 'completed'),
    supabase.from('study_sessions').select('date, cards_reviewed').eq('user_id', userId).order('date', { ascending: false }),
    supabase.from('materials').select('id').eq('user_id', userId),
    supabase.from('mistake_diary').select('is_resolved').eq('user_id', userId).eq('is_resolved', true),
    getUserXP(userId),
  ]);

  const exams = examsRes.data ?? [];
  const sessions = sessRes.data ?? [];
  const materials = matsRes.data ?? [];

  // Считаем стрик
  const dates = new Set(sessions.map((s: any) => s.date));
  let streak = 0;
  let d = new Date();
  while (dates.has(d.toISOString().split('T')[0])) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  const stats: UserStats = {
    totalExams: exams.length,
    totalReviews: sessions.reduce((a: number, s: any) => a + (s.cards_reviewed ?? 0), 0),
    totalAnalyze: materials.length,
    streak,
    exam5Count: exams.filter((e: any) => e.score >= 85).length,
    totalMistakesResolved: (mistakesRes.data ?? []).length,
    totalXP: xp,
  };

  // Находим новые достижения
  const newAchievements: AchievementDef[] = [];
  for (const ach of ACHIEVEMENTS) {
    if (!earnedIds.has(ach.id) && ach.check(stats)) {
      newAchievements.push(ach);
      await supabase.from('user_achievements').insert({ user_id: userId, achievement_id: ach.id });
      await addXP(userId, ach.xp);
    }
  }

  return newAchievements;
}

// ── Квесты ─────────────────────────────────────────────────────────────────────

export async function getQuestsWithProgress(userId: string) {
  const { data: quests, error: qErr } = await supabase.from('quests').select('*');
  if (qErr || !quests) return [];

  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff)).toISOString().split('T')[0];

  const { data: progress, error: pErr } = await supabase
    .from('user_quest_progress')
    .select('*')
    .eq('user_id', userId);

  if (pErr) return quests.map(q => ({ ...q, progress: 0, is_completed: false }));

  return quests.map(q => {
    const resetDate = q.type === 'daily' ? today : monday;
    const prog = progress?.find(p => p.quest_id === q.id && p.reset_at === resetDate);
    return { ...q, current_count: prog?.current_count || 0, is_completed: prog?.is_completed || false, reset_at: resetDate };
  });
}

export async function updateQuestProgress(userId: string, targetType: TargetType, increment: number = 1): Promise<boolean> {
  const { data: targetQuests } = await supabase.from('quests').select('*').eq('target_type', targetType);
  if (!targetQuests || targetQuests.length === 0) return false;

  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff)).toISOString().split('T')[0];

  let anyCompleted = false;

  for (const quest of targetQuests) {
    const resetAt = quest.type === 'daily' ? today : monday;
    const { data: existing } = await supabase
      .from('user_quest_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('quest_id', quest.id)
      .eq('reset_at', resetAt)
      .maybeSingle();

    if (existing) {
      if (existing.is_completed) continue;
      const newCount = existing.current_count + increment;
      const isCompleted = newCount >= quest.target_count;
      if (isCompleted) anyCompleted = true;
      await supabase
        .from('user_quest_progress')
        .update({ current_count: newCount, is_completed: isCompleted, completed_at: isCompleted ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (isCompleted) await addXP(userId, quest.xp_reward ?? 20);
    } else {
      const isCompleted = increment >= quest.target_count;
      if (isCompleted) anyCompleted = true;
      await supabase.from('user_quest_progress').insert({
        user_id: userId, quest_id: quest.id, current_count: increment,
        is_completed: isCompleted, completed_at: isCompleted ? new Date().toISOString() : null, reset_at: resetAt,
      });
      if (isCompleted) await addXP(userId, quest.xp_reward ?? 20);
    }
  }

  return anyCompleted;
}
