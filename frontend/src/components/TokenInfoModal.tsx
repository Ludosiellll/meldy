import { X, Zap, Crown, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { FREE_DAILY_LIMIT } from '../api/limits';
import { useNavigate } from 'react-router-dom';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  usedTokens: number;
  isPro?: boolean;
}

export default function TokenInfoModal({ isOpen, onClose, usedTokens, isPro }: Props) {
  const navigate = useNavigate();
  const remaining = Math.max(0, FREE_DAILY_LIMIT - usedTokens);
  const percentage = Math.max(0, (remaining / FREE_DAILY_LIMIT) * 100);

  if (!isOpen) return null;

  if (isPro) {
    return (
      <AnimatePresence>
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-4 sm:px-0">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={onClose}
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800"
          >
            {/* Header */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-6 text-center relative border-b border-slate-100 dark:border-slate-800">
              <button 
                onClick={onClose}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 bg-white dark:bg-slate-800 rounded-full shadow-sm transition"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-16 h-16 bg-gradient-to-tr from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-[0_0_15px_rgba(251,191,36,0.5)] transform rotate-3">
                <Crown className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white mb-2">PRO Академик</h2>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-bold border border-emerald-200 dark:border-emerald-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                АКТИВЕН
              </div>
            </div>

            {/* Info */}
            <div className="p-6 space-y-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              <p className="text-center font-medium">
                У вас безлимитный доступ к нейросетям. Энергия больше не заканчивается! ⚡
              </p>
              
              <ul className="space-y-3 mt-4">
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>Безлимитная генерация тестов и карточек</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>Приоритетные подкасты без очереди</span>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>Экзамен с ИИ-профессором</span>
                </li>
              </ul>
            </div>

            {/* CTA */}
            <div className="p-6 pt-2 bg-slate-50 dark:bg-slate-900">
              <button 
                onClick={onClose}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition"
              >
                Супер!
              </button>
            </div>
          </motion.div>
        </div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex items-center justify-center px-4 sm:px-0">
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          onClick={onClose}
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800"
        >
          {/* Header */}
          <div className="bg-slate-50 dark:bg-slate-800/50 p-6 text-center relative border-b border-slate-100 dark:border-slate-800">
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 bg-white dark:bg-slate-800 rounded-full shadow-sm transition"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner transform rotate-3">
              <Zap className="w-8 h-8 text-amber-500 fill-amber-500" />
            </div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white">Энергия ИИ</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Осталось на сегодня</p>
            <div className="text-4xl font-black text-slate-800 dark:text-slate-100 mt-2 flex items-center justify-center gap-1">
              {remaining} <span className="text-xl text-slate-400 font-bold">/ {FREE_DAILY_LIMIT}</span>
            </div>
          </div>

          {/* Progress */}
          <div className="px-6 pt-6 pb-2">
            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-2 shadow-inner border border-slate-200/50 dark:border-slate-700/50">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
                className={`h-full rounded-full ${percentage <= 0 ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-gradient-to-r from-amber-400 to-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]'}`}
              />
            </div>
            {percentage <= 0 && (
              <p className="text-xs font-bold text-rose-500 text-center animate-pulse">Энергия исчерпана!</p>
            )}
          </div>

          {/* Info */}
          <div className="p-6 pt-2 space-y-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            <p>
              Энергия расходуется на создание конспектов, генерацию тестов и общение с ИИ. 
            </p>
            <div className="flex items-center gap-2 p-3 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 rounded-xl font-medium border border-indigo-100 dark:border-indigo-900">
              <Zap className="w-5 h-5 shrink-0" />
              <span>Бесплатная энергия восстанавливается каждую полночь по Москве.</span>
            </div>
          </div>

          {/* CTA */}
          <div className="p-6 pt-0 bg-slate-50 dark:bg-slate-900">
            <button 
              onClick={() => {
                onClose();
                navigate('/pricing');
              }}
              className="w-full relative group overflow-hidden rounded-2xl p-[2px]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600 rounded-2xl opacity-70 group-hover:opacity-100 transition duration-300 animate-pulse" />
              <div className="relative bg-white dark:bg-slate-900 rounded-[14px] px-6 py-3 transition group-hover:bg-opacity-0">
                <div className="flex items-center justify-center gap-2 group-hover:text-white transition-colors text-slate-800 dark:text-slate-100 font-bold">
                  <Crown className="w-5 h-5 text-amber-500 group-hover:text-white transition-colors" />
                  Получить Безлимит (PRO)
                </div>
              </div>
            </button>
            <button 
              onClick={onClose}
              className="w-full mt-3 px-6 py-3 text-slate-500 dark:text-slate-400 font-semibold hover:text-slate-800 dark:hover:text-slate-200 transition"
            >
              Понятно
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
