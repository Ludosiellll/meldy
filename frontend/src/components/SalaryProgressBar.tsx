import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';
import { getLevelFromXP } from '../api/career';

interface SalaryProgressBarProps {
  currentXP: number;
  targetSalary: string; // e.g. "150 000 ₽"
  completedModules: number;
  totalModules: number;
  completedTopics?: number;
  totalTopics?: number;
  levelName?: string;
  streakDays?: number;
  className?: string;
  location?: string;
}

export default function SalaryProgressBar({
  currentXP,
  targetSalary,
  completedModules,
  totalModules,
  completedTopics = 0,
  totalTopics = 0,
  levelName,
  streakDays = 0,
  className = '',
  location,
}: SalaryProgressBarProps) {
  const progressRatio = totalTopics > 0 
    ? completedTopics / totalTopics 
    : (totalModules > 0 ? completedModules / totalModules : 0);

  const pct = Math.min(100, Math.round(progressRatio * 100));

  const { name: xpLevel, progress: xpProgress, nextThreshold } = getLevelFromXP(currentXP);

  // Milestones along the bar
  const milestones = [
    { pct: 25, label: 'Стажировка' },
    { pct: 50, label: 'Джун-позиции' },
    { pct: 75, label: 'Мидл-рассмотрение' },
    { pct: 100, label: 'Цель' },
  ];

  return (
    <div className={`bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-4 shadow-sm ${className}`}>
      {/* Top row: level + streak */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-50 dark:bg-indigo-600/30 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Карьерный прогресс</p>
            <p className="text-xs font-extrabold text-slate-800 dark:text-slate-100">{levelName ?? xpLevel}</p>
          </div>
        </div>
        {streakDays > 0 && (
          <div className="flex items-center gap-1 px-2.5 py-1 bg-orange-500/15 rounded-full border border-orange-500/30">
            <span className="text-sm">🔥</span>
            <span className="text-xs font-extrabold text-orange-600 dark:text-orange-400">{streakDays}д.</span>
          </div>
        )}
      </div>

      {/* Learning Progress display */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] text-slate-500 font-semibold">Текущий прогресс</p>
          <p className="text-lg font-black text-slate-800 dark:text-slate-100">
            {pct}%
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-500 font-semibold">Всего тем</p>
          <p className="text-lg font-black text-indigo-600 dark:text-indigo-400">
            {totalTopics > 0 ? `${completedTopics} / ${totalTopics}` : `${completedModules} / ${totalModules}`}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative">
        <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden relative">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 relative"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          >
            {/* Shimmer */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
          </motion.div>
        </div>

        {/* Milestone markers */}
        {milestones.map(m => (
          <div
            key={m.pct}
            className="absolute top-0 flex flex-col items-center"
            style={{ left: `${m.pct}%`, transform: 'translateX(-50%)' }}
          >
            <div className={`w-1 h-3 ${pct >= m.pct ? 'bg-indigo-500 dark:bg-indigo-300' : 'bg-slate-300 dark:bg-slate-600'} rounded-full`} />
          </div>
        ))}
      </div>

      {/* Milestone labels */}
      <div className="relative h-5">
        {milestones.map(m => (
          <div
            key={m.pct}
            className="absolute flex flex-col items-center"
            style={{ left: `${m.pct}%`, transform: 'translateX(-50%)' }}
          >
            <p className={`text-[9px] font-bold whitespace-nowrap ${pct >= m.pct ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-600'}`}>
              {m.label}
            </p>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800/60">
        <p className="text-[10px] text-slate-500 font-semibold">
          Пройдено: <span className="text-slate-700 dark:text-slate-300 font-bold">{completedModules}/{totalModules} модулей</span>
        </p>
        <p className="text-[10px] text-slate-500 font-semibold">
          XP: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{currentXP}</span>
        </p>
      </div>

      {/* XP Level progress */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{xpLevel}</p>
          <p className="text-[10px] text-slate-500">→ {nextThreshold} XP</p>
        </div>
        <div className="h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${xpProgress}%` }}
            transition={{ duration: 0.8, delay: 0.3 }}
          />
        </div>
      </div>
    </div>
  );
}
