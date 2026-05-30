import React from 'react';
import { motion } from 'framer-motion';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid 
} from 'recharts';
import { 
  Trophy, Flame, Zap, Briefcase, Calendar, TrendingUp, HelpCircle 
} from 'lucide-react';
import { CareerProfile, getLevelFromXP } from '../api/career';

interface LearningDashboardProps {
  profile: CareerProfile;
}

export default function LearningDashboard({ profile }: LearningDashboardProps) {
  const currentXP = profile.xp ?? 0;
  const completedModules = profile.course?.modules.filter(m => m.completed).length ?? 0;
  const totalModules = profile.course?.modules.length ?? 0;
  const streakDays = profile.streak_days ?? 0;

  // 1. Calculate Activity Heatmap for the last 30 days
  const get30DaysActivity = () => {
    const days = [];
    const today = new Date();
    
    // Map existing activity log
    const activityMap: Record<string, number> = {};
    if (profile.activity_log) {
      profile.activity_log.forEach(act => {
        activityMap[act.date] = (activityMap[act.date] ?? 0) + act.xp;
      });
    }

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const xp = activityMap[dateStr] ?? 0;
      
      // Calculate color level (0-4)
      let level = 0;
      if (xp > 0 && xp <= 30) level = 1;
      else if (xp > 30 && xp <= 70) level = 2;
      else if (xp > 70 && xp <= 120) level = 3;
      else if (xp > 120) level = 4;

      days.push({
        date: dateStr,
        dayLabel: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
        xp,
        level
      });
    }
    return days;
  };

  const heatmapDays = get30DaysActivity();

  // 2. Prepare Grades Progress Chart (completed modules)
  const getChartData = () => {
    const data = (profile.course?.modules ?? [])
      .filter(m => m.completed && m.score !== undefined)
      .map((m, idx) => ({
        index: idx + 1,
        title: m.title,
        score: m.score ?? 0
      }));

    // If no completed modules, return empty indicator
    if (data.length === 0) {
      return [];
    }
    return data;
  };

  const chartData = getChartData();

  // 3. Velocity estimation
  const getLearningVelocity = () => {
    if (completedModules === 0) return 0;
    const activeDays = streakDays || 1;
    // ratio: modules per week
    const velocityRatio = completedModules / (activeDays / 7 || 1);
    // average calculation: 1.5 modules per week is average
    const pctDiff = Math.round((velocityRatio / 1.5 - 1) * 100);
    return Math.min(150, Math.max(-80, pctDiff));
  };

  const velocityDiff = getLearningVelocity();

  // 4. Job Readiness Index Calculation
  const getJobReadiness = () => {
    const progressRatio = totalModules > 0 ? completedModules / totalModules : 0;
    
    const completedWithScore = (profile.course?.modules ?? []).filter(m => m.completed && m.score !== undefined);
    const avgScore = completedWithScore.length > 0
      ? completedWithScore.reduce((sum, m) => sum + (m.score ?? 0), 0) / completedWithScore.length
      : 0;

    const xpFactor = Math.min(currentXP / 2000, 1);
    const streakFactor = Math.min(streakDays / 15, 1);

    const readiness = (progressRatio * 35) + ((avgScore / 100) * 35) + (xpFactor * 20) + (streakFactor * 10);
    return Math.min(100, Math.round(readiness));
  };

  const jobReadiness = getJobReadiness();

  const getEmploymentForecast = () => {
    if (completedModules === totalModules && totalModules > 0) {
      return 'Готов к офферу! 🚀';
    }
    if (completedModules === 0) {
      return 'Начните практику';
    }
    const daysPerModule = 3;
    const remainingDays = (totalModules - completedModules) * daysPerModule;
    const forecastDate = new Date();
    forecastDate.setDate(forecastDate.getDate() + remainingDays);
    return forecastDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  };

  const employmentForecast = getEmploymentForecast();

  const getHeatmapColor = (level: number) => {
    switch (level) {
      case 1: return 'bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/40 text-indigo-600 dark:text-indigo-400';
      case 2: return 'bg-indigo-100 dark:bg-indigo-900 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-200';
      case 3: return 'bg-indigo-500 dark:bg-indigo-600 border border-indigo-400 dark:border-indigo-500 text-white';
      case 4: return 'bg-violet-500 border border-violet-400 text-white shadow-[0_0_10px_rgba(139,92,246,0.15)] animate-pulse';
      default: return 'bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-900 text-slate-400 dark:text-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top dashboard row cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {/* Job readiness Index */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Индекс трудоустройства</span>
            <Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="my-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-800 dark:text-slate-100">{jobReadiness}%</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">готовность</span>
          </div>
          <div className="h-1.5 bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden w-full">
            <motion.div 
              className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${jobReadiness}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
          <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-2 font-bold leading-relaxed">
            {jobReadiness >= 80 ? '🔥 Превосходные шансы на оффер! Пора откликаться.' : 
             jobReadiness >= 50 ? '🛡️ Хорошие базовые знания. Дожмите курс!' : 
             '📚 Решайте задачи песочницы для роста индекса.'}
          </p>
        </div>

        {/* Forecast card */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Оффер прогнозируется</span>
            <Calendar className="w-4 h-4 text-slate-500" />
          </div>
          <div className="my-3">
            <p className="text-lg font-black text-slate-800 dark:text-slate-100 capitalize">{employmentForecast}</p>
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-slate-850 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-bold">
            <span>Профессия:</span>
            <span className="text-slate-600 dark:text-slate-300 truncate max-w-[120px]">{profile.course?.profession ?? 'IT специалист'}</span>
          </div>
        </div>

        {/* Velocity card */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Темп обучения (Velocity)</span>
            <TrendingUp className="w-4 h-4 text-slate-500" />
          </div>
          <div className="my-3 flex items-baseline gap-1">
            <span className={`text-2xl font-black ${velocityDiff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {velocityDiff >= 0 ? `+${velocityDiff}%` : `${velocityDiff}%`}
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold">к среднему</span>
          </div>
          <p className="text-[9px] text-slate-500 dark:text-slate-500 leading-relaxed font-bold">
            {velocityDiff >= 20 ? '🏃‍♂️ Вы учитесь быстрее большинства студентов!' : 
             velocityDiff >= 0 ? '🚶‍♂️ Отличный стабильный темп прохождения модулей.' : 
             '🐌 Советуем проходить практику регулярнее.'}
          </p>
        </div>

        {/* Streak card */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Активный стрик</span>
            <Flame className="w-4 h-4 text-orange-500 dark:text-orange-400" />
          </div>
          <div className="my-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-orange-500 dark:text-orange-400">{streakDays}</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase">дней подряд</span>
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-slate-850 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-bold">
            <span>Рекорд:</span>
            <span className="text-slate-600 dark:text-slate-300 font-black">{Math.max(streakDays, 7)} дн.</span>
          </div>
        </div>
      </div>

      {/* Graphs split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recharts scores over time */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 lg:col-span-2 space-y-4 shadow-sm">
          <div>
            <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">Динамика успеваемости</span>
            <h4 className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Оценки за практические аттестации ИИ-методиста</h4>
          </div>
          
          <div className="h-64 w-full text-xs">
            {completedModules === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                <HelpCircle className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Здесь появится график ваших оценок</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 max-w-xs">Пройдите практику вашего первого учебного модуля и отправьте ее на ревью.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="scoreColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.08)" />
                  <XAxis dataKey="index" stroke="#94a3b8" fontSize={9} fontWeight="bold" />
                  <YAxis stroke="#94a3b8" fontSize={9} fontWeight="bold" domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }}
                    labelStyle={{ color: '#94a3b8', fontSize: '9px', fontWeight: 'bold' }}
                    itemStyle={{ color: '#fff', fontSize: '10px', fontWeight: 'extrabold' }}
                    formatter={(value: any, name: any, props: any) => [
                      `${value}% (${props.payload.title})`, 'Балл ИИ'
                    ]}
                  />
                  <Area type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#scoreColor)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* GitHub-style Heatmap widget */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-col justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">Тепловая карта активности</span>
            <h4 className="text-xs text-slate-500 dark:text-slate-400">Набранный XP за последние 30 дней</h4>
          </div>

          {/* Grid render */}
          <div className="grid grid-cols-6 gap-2 sm:gap-2.5 my-6 max-w-[220px] sm:max-w-[240px] mx-auto">
            {heatmapDays.map((day, idx) => (
              <div
                key={idx}
                title={`${day.dayLabel}: +${day.xp} XP`}
                className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-[9px] font-black cursor-pointer transition-all hover:scale-105 hover:brightness-105 ${getHeatmapColor(day.level)}`}
              >
                {day.xp > 0 ? day.xp : ''}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-between text-[8px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider border-t border-slate-100 dark:border-slate-850 pt-3">
            <span>Меньше</span>
            <div className="flex gap-1">
              <div className="w-2.5 h-2.5 rounded bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-900" />
              <div className="w-2.5 h-2.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/40" />
              <div className="w-2.5 h-2.5 rounded bg-indigo-100 dark:bg-indigo-900 border border-indigo-200 dark:border-indigo-700" />
              <div className="w-2.5 h-2.5 rounded bg-indigo-500 dark:bg-indigo-600 border border-indigo-400 dark:border-indigo-500" />
              <div className="w-2.5 h-2.5 rounded bg-violet-500 border border-violet-400" />
            </div>
            <span>Больше</span>
          </div>
        </div>
      </div>
    </div>
  );
}
