import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, Clock, Zap } from 'lucide-react';
import { AgentStatus } from '../types';

function CircularProgress({ value, size = 80, strokeWidth = 6 }: { value: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
      <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#4F46E5" strokeWidth={strokeWidth}
        strokeLinecap="round" strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }} transition={{ duration: 0.6, ease: 'easeOut' }} />
    </svg>
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
    ? <span className="text-xs text-emerald-500 tabular-nums">{elapsed.toFixed(1)}с ✓</span>
    : <span className="text-xs text-slate-400 tabular-nums">{elapsed.toFixed(1)}с</span>;
}

export default function AgentCards({ agents, phase, isDemo }: { agents: AgentStatus[]; phase: string; isDemo?: boolean }) {
  const barColors: Record<string, string> = {
    summarizer: 'bg-brand-500',
    flashcards: 'bg-emerald-500',
    quiz: 'bg-amber-500',
  };
  const trackColors: Record<string, string> = {
    summarizer: 'bg-brand-100',
    flashcards: 'bg-emerald-100',
    quiz: 'bg-amber-100',
  };
  const borderColors: Record<string, string> = {
    summarizer: 'border-brand-200',
    flashcards: 'border-emerald-200',
    quiz: 'border-amber-200',
  };
  const icons: Record<string, string> = { summarizer: '📝', flashcards: '🃏', quiz: '❓' };
  const statusText: Record<string, Record<string, string>> = {
    idle: { summarizer: 'Ожидание...', flashcards: 'Ожидание...', quiz: 'Ожидание...' },
    running: { summarizer: 'Составляю конспект...', flashcards: 'Генерирую карточки...', quiz: 'Создаю вопросы...' },
    done: { summarizer: 'Конспект готов', flashcards: 'Карточки готовы', quiz: 'Тест готов' },
  };

  // Гонка агентов — порядок финиша
  const doneOrderRef = useRef<string[]>([]);
  const prevDoneSet = useRef<Set<string>>(new Set());

  useEffect(() => {
    agents.forEach(a => {
      if (a.status === 'done' && !prevDoneSet.current.has(a.id)) {
        prevDoneSet.current.add(a.id);
        doneOrderRef.current.push(a.id);
      }
    });
  }, [agents]);
  const placeLabels = ['🏆 1й', '2й', '3й'];
  const donePlace: Record<string, string> = {};
  doneOrderRef.current.forEach((id, idx) => { donePlace[id] = placeLabels[idx]; });

  const doneCount = agents.filter(a => a.status === 'done').length;
  const pct = Math.round((doneCount / 3) * 100);

  return (
    <div className="py-10 relative">
      {isDemo && (
        <span className="absolute top-0 right-0 px-2.5 py-1 rounded-md bg-amber-100 text-amber-700 text-xs font-bold tracking-wide">
          ДЕМО
        </span>
      )}
      {/* Центральный прогресс */}
      <div className="flex flex-col items-center mb-10">
        <div className="relative mb-3">
          <CircularProgress value={pct} size={80} strokeWidth={6} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-slate-800">{pct}%</span>
          </div>
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          {phase === 'extracting' ? 'Извлекаем текст из файла...' : 'Анализируем материал...'}
        </h2>
        <p className="text-slate-500 text-sm">
          {phase === 'extracting'
            ? 'Подготавливаем данные для анализа'
            : `${doneCount} из 3 агентов завершили работу`}
        </p>
      </div>

      {/* Гонка агентов */}
      <div className="mb-8">
        <div className="flex items-center gap-1.5 mb-3">
          <Zap className="w-3 h-3 text-slate-400" />
          <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Гонка агентов</span>
        </div>
        <div className="space-y-2">
          {agents.map(agent => (
            <div key={agent.id} className="flex items-center gap-2">
              <div className="w-[90px] flex items-center gap-1.5 shrink-0">
                <span className="text-sm">{icons[agent.id]}</span>
                <span className="text-xs font-medium text-slate-700 truncate">{agent.label}</span>
              </div>
              <div className={'flex-1 h-3 rounded-full overflow-hidden ' + trackColors[agent.id]}>
                {agent.status === 'idle' && (
                  <div className={'h-full rounded-full w-0 ' + barColors[agent.id]} />
                )}
                {agent.status === 'running' && (
                  <motion.div
                    className={'h-full rounded-full ' + barColors[agent.id]}
                    initial={{ width: '0%' }}
                    animate={{ width: '88%' }}
                    transition={{ duration: 8, ease: 'easeOut' }}
                  />
                )}
                {agent.status === 'done' && (
                  <motion.div
                    className={'h-full rounded-full ' + barColors[agent.id]}
                    initial={{ width: '88%', opacity: 0.5 }}
                    animate={{ width: '100%', opacity: 1 }}
                    transition={{ width: { duration: 0.3 }, opacity: { duration: 0.2 } }}
                  />
                )}
              </div>
              <div className="w-[60px] text-right shrink-0">
                {agent.status === 'done' && donePlace[agent.id] ? (
                  <span className={'text-xs font-bold tabular-nums ' + (donePlace[agent.id].startsWith('🏆') ? 'bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded' : 'text-slate-400')}>{donePlace[agent.id]}</span>
                ) : (
                  <AgentTimer status={agent.status} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Карточки агентов */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {agents.map((agent, i) => (
          <motion.div key={agent.id}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.12 }}
            className={'card p-6 border-2 transition-colors ' + borderColors[agent.id]}>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{icons[agent.id]}</span>
                <span className="font-semibold text-lg text-slate-900">{agent.label}</span>
              </div>
              {agent.status === 'running' && <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />}
              {agent.status === 'done' && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
              {agent.status === 'idle' && <Clock className="w-5 h-5 text-slate-300" />}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {statusText[agent.status]?.[agent.id] || 'Ожидание...'}
              </p>
              <AgentTimer status={agent.status} />
            </div>

            <div className={'h-2 rounded-full overflow-hidden ' + trackColors[agent.id]}>
              {agent.status === 'idle' && (
                <div className={'h-full rounded-full w-0 ' + barColors[agent.id]} />
              )}
              {agent.status === 'running' && (
                <motion.div
                  className={'h-full rounded-full ' + barColors[agent.id]}
                  initial={{ width: '0%' }}
                  animate={{ width: '92%' }}
                  transition={{ duration: 8, ease: 'easeInOut' }}
                />
              )}
              {agent.status === 'done' && (
                <motion.div
                  className={'h-full rounded-full ' + barColors[agent.id]}
                  initial={{ width: '92%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 0.4 }}
                />
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
