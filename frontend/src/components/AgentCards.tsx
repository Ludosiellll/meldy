import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, Clock, FileText, HelpCircle, BookOpen, Sparkles, Mic, Compass } from 'lucide-react';
import { AgentStatus } from '../types';

function UnifiedProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Общий прогресс анализа</span>
        <span className="text-sm font-black text-indigo-600 tabular-nums">{value}%</span>
      </div>
      <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden p-[2px] border border-slate-200 shadow-inner">
        <motion.div
          className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-500 rounded-full shadow-sm"
          initial={{ width: '0%' }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

function AgentTimer({ status }: { status: string }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (status === 'running') {
      startRef.current = Date.now();
      const tick = () => {
        if (startRef.current) setElapsed((Date.now() - startRef.current) / 1000);
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frameRef.current);
    } else {
      cancelAnimationFrame(frameRef.current);
    }
  }, [status]);

  if (status === 'idle') return null;
  return status === 'done'
    ? <span className="text-xs text-emerald-600 font-bold tabular-nums">{elapsed.toFixed(1)}с</span>
    : <span className="text-xs text-slate-500 font-bold tabular-nums">{elapsed.toFixed(1)}с</span>;
}

export default function AgentCards({ agents, phase, isDemo }: { agents: AgentStatus[]; phase: string; isDemo?: boolean }) {
  const agentConfigs: Record<string, {
    label: string;
    icon: React.ElementType;
    color: string;
    bgColor: string;
    borderColor: string;
    glowColor: string;
    desc: { idle: string; running: string; done: string };
  }> = {
    summarizer: {
      label: 'Интеллектуальный Конспект',
      icon: FileText,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      borderColor: 'border-indigo-200',
      glowColor: 'shadow-indigo-500/5',
      desc: {
        idle: 'В очереди на структурирование...',
        running: 'Извлекаем ключевые мысли...',
        done: 'Конспект успешно сформирован'
      }
    },
    flashcards: {
      label: 'Флеш-Карточки',
      icon: BookOpen,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      glowColor: 'shadow-emerald-500/5',
      desc: {
        idle: 'Ожидание структурирования...',
        running: 'Генерируем карточки для интервального повторения...',
        done: 'Карточки готовы для запоминания'
      }
    },
    quiz: {
      label: 'Интерактивный Тест',
      icon: HelpCircle,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      glowColor: 'shadow-amber-500/5',
      desc: {
        idle: 'Ожидание анализа тем...',
        running: 'Создаем проверочные вопросы...',
        done: 'Тест с разбором ошибок готов'
      }
    },
    cheatsheet: {
      label: 'Шпаргалка',
      icon: Sparkles,
      color: 'text-rose-600',
      bgColor: 'bg-rose-50',
      borderColor: 'border-rose-200',
      glowColor: 'shadow-rose-500/5',
      desc: {
        idle: 'Ожидание сжатия материала...',
        running: 'Упаковываем сложные термины в ёмкие формулировки...',
        done: 'Шпаргалка собрана'
      }
    },
    podcast: {
      label: 'Аудио-подкаст',
      icon: Mic,
      color: 'text-violet-600',
      bgColor: 'bg-violet-50',
      borderColor: 'border-violet-200',
      glowColor: 'shadow-violet-500/5',
      desc: {
        idle: 'Ожидание генерации сценария...',
        running: 'Создаем текстовый скрипт для аудио-подкаста...',
        done: 'Подкаст озвучен и готов к прослушиванию'
      }
    },
    missions: {
      label: 'Учебные квесты',
      icon: Compass,
      color: 'text-cyan-600',
      bgColor: 'bg-cyan-50',
      borderColor: 'border-cyan-200',
      glowColor: 'shadow-cyan-500/5',
      desc: {
        idle: 'Ожидание построения целей...',
        running: 'Формируем индивидуальные миссии для лекции...',
        done: 'Квесты сгенерированы'
      }
    }
  };

  const doneCount = agents.filter(a => a.status === 'done').length;
  // Рассчитываем общий процент выполнения на основе фазы и количества выполненных агентов
  let pct = 0;
  if (phase === 'extracting') {
    pct = 10;
  } else {
    // В процессе анализа: 10% базовые за извлечение + пропорционально выполненным агентам (до 95%)
    pct = 10 + Math.round((doneCount / agents.length) * 85);
  }

  return (
    <div className="py-10 relative">
      {isDemo && (
        <span className="absolute top-0 right-0 px-2.5 py-1 rounded-md bg-amber-100 text-amber-700 text-xs font-black border border-amber-200 tracking-wide uppercase shadow-sm">
          ДЕМО
        </span>
      )}

      {/* Шапка прогресса */}
      <div className="flex flex-col items-center mb-10 text-center">
        <h2 className="text-3xl font-black text-slate-900 dark:text-slate-100 mb-3 tracking-tight">
          {phase === 'extracting' ? 'Извлечение текста из файла...' : 'Интеллектуальный анализ материала'}
        </h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium max-w-md mb-8 leading-relaxed">
          {phase === 'extracting'
            ? 'Пожалуйста, подождите. Мы считываем содержимое и подготавливаем данные для ИИ-агентов.'
            : `Нейросетевые агенты работают параллельно. Завершено: ${doneCount} из ${agents.length}`}
        </p>

        <UnifiedProgressBar value={pct} />
      </div>

      {/* Список Агентов без гонки */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
        {agents.map((agent, i) => {
          const config = agentConfigs[agent.id] || {
            label: agent.label,
            icon: FileText,
            color: 'text-indigo-600',
            bgColor: 'bg-indigo-50',
            borderColor: 'border-indigo-200',
            glowColor: 'shadow-indigo-500/5',
            desc: { idle: 'В очереди...', running: 'Обработка...', done: 'Готово' }
          };

          const IconComponent = config.icon;

          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`p-5 rounded-2xl border bg-white dark:bg-slate-900 flex flex-col justify-between transition-all duration-300 shadow-sm ${config.glowColor} ${
                agent.status === 'running'
                  ? `border-indigo-300 dark:border-indigo-500 ring-4 ring-indigo-50 dark:ring-indigo-950/30`
                  : agent.status === 'done'
                  ? `border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10`
                  : `border-slate-200 dark:border-slate-800 opacity-80`
              }`}
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border ${config.borderColor} ${config.bgColor} ${config.color} shadow-sm`}>
                    <IconComponent className="w-5 h-5 animate-pulse-slow" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">{config.label}</h3>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 min-h-[16px]">
                      {config.desc[agent.status]}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 self-start pt-1">
                  {agent.status === 'running' && (
                    <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                  )}
                  {agent.status === 'done' && (
                     <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  )}
                  {agent.status === 'idle' && (
                    <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <AgentTimer status={agent.status} />
                </div>
              </div>

              {/* Индикатор прогресса конкретного агента */}
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-3 shadow-inner">
                {agent.status === 'idle' && (
                  <div className="h-full bg-slate-200 dark:bg-slate-700 w-0" />
                )}
                {agent.status === 'running' && (
                  <motion.div
                    className={`h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full`}
                    initial={{ width: '0%' }}
                    animate={{ width: '90%' }}
                    transition={{ duration: 12, ease: 'easeOut' }}
                  />
                )}
                {agent.status === 'done' && (
                  <motion.div
                    className="h-full bg-emerald-500 rounded-full shadow-sm"
                    initial={{ width: '90%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 0.3 }}
                  />
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
