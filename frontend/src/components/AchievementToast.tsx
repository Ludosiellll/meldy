import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Star, Flame, Zap, BookOpen, Award, Brain, CheckCircle2, X } from 'lucide-react';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  xp: number;
}

interface Props {
  achievement: Achievement | null;
  onClose: () => void;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  trophy: Trophy,
  star: Star,
  flame: Flame,
  zap: Zap,
  book: BookOpen,
  award: Award,
  brain: Brain,
  check: CheckCircle2,
};

export default function AchievementToast({ achievement, onClose }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!achievement) return;
    setVisible(true);
    const t = setTimeout(() => { setVisible(false); setTimeout(onClose, 400); }, 4500);
    return () => clearTimeout(t);
  }, [achievement]);

  if (!achievement) return null;

  const Icon = ICON_MAP[achievement.icon] ?? Trophy;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: 80, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 80, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-4 bg-slate-900 border border-amber-400/30 rounded-2xl p-4 shadow-2xl shadow-amber-500/10 max-w-xs"
        >
          {/* Иконка достижения */}
          <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg">
            <Icon className="w-6 h-6 text-white" />
          </div>

          {/* Текст */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-0.5">
              🏆 Достижение разблокировано!
            </p>
            <p className="text-sm font-bold text-white truncate">{achievement.title}</p>
            <p className="text-xs text-slate-400 truncate">{achievement.description}</p>
            <div className="mt-1 inline-flex items-center gap-1 bg-indigo-500/20 border border-indigo-500/30 rounded-full px-2 py-0.5">
              <Zap className="w-3 h-3 text-indigo-400" />
              <span className="text-[10px] font-black text-indigo-300">+{achievement.xp} XP</span>
            </div>
          </div>

          {/* Кнопка закрыть */}
          <button
            onClick={() => { setVisible(false); setTimeout(onClose, 400); }}
            className="text-slate-600 hover:text-slate-400 transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Прогресс-бар автозакрытия */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full"
            initial={{ scaleX: 1, originX: 0 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: 4.5, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
