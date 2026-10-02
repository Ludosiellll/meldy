import { AnalysisSettings } from '../types';
import { FileText, Layers, HelpCircle, Zap, MessagesSquare, CheckCircle2 } from 'lucide-react';

interface Props {
  settings: AnalysisSettings;
  onChange: (s: AnalysisSettings) => void;
}

const detailLabels: Record<string, string> = { brief: 'Краткий', medium: 'Средний', detailed: 'Подробный' };
const diffLabels: Record<string, string> = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', mixed: 'Смешанный' };
const typeLabels: Record<string, string> = { multiple: 'Выбор ответа', truefalse: 'Верно / Неверно' };

function SegmentedControl({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap bg-slate-100 dark:bg-slate-900/50 rounded-lg p-1 gap-1">
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className={'flex-1 min-w-[80px] sm:min-w-0 px-2 sm:px-3 py-1.5 rounded-md text-sm transition ' + (value === o.key ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPanel({ settings, onChange }: Props) {
  const set = (patch: Partial<AnalysisSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className="space-y-5">
      <div>
        <label className="text-base font-black text-slate-900 dark:text-slate-100 mb-3.5 block">Модули для генерации</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 mb-6">
          {[
            { id: 'summarizer', label: 'Конспект', desc: 'Структурированные тезисы, темы и словарь терминов', icon: FileText, color: 'indigo' },
            { id: 'flashcards', label: 'Карточки', desc: 'Флеш-карточки для быстрого интервального повторения', icon: Layers, color: 'amber' },
            { id: 'quiz', label: 'Тест', desc: 'Интерактивный тест с подробным разбором ошибок', icon: HelpCircle, color: 'emerald' },
            { id: 'cheatsheet', label: 'Шпаргалка', desc: 'Самая главная выжимка лекции для быстрой проверки', icon: Zap, color: 'orange' },
            { id: 'podcast', label: 'Разговор', desc: 'Два ведущих обсуждают материал, на экране — схемы и термины', icon: MessagesSquare, color: 'accent' },
          ].map(agent => {
            const isChecked = (settings.enabledAgents || []).includes(agent.id);
            const Icon = agent.icon;
            
            // Theme mapping for high fidelity colors
            const themeClasses = {
              indigo: isChecked 
                ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/15' 
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900',
              amber: isChecked 
                ? 'border-amber-500 bg-amber-50/20 dark:bg-amber-950/15' 
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900',
              emerald: isChecked 
                ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/15' 
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900',
              orange: isChecked 
                ? 'border-orange-500 bg-orange-50/20 dark:bg-orange-950/15' 
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900',
              accent: isChecked 
                ? 'border-[var(--sf-accent)] bg-[var(--sf-accent-soft)]' 
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900',
              rose: isChecked 
                ? 'border-rose-500 bg-rose-50/20 dark:bg-rose-950/15' 
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900',
            }[agent.color as 'indigo' | 'amber' | 'emerald' | 'orange' | 'accent' | 'rose'];

            const iconColors = {
              indigo: 'text-indigo-600 dark:text-indigo-400 bg-indigo-100/70 dark:bg-indigo-950/40',
              amber: 'text-amber-600 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-950/40',
              emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/40',
              orange: 'text-orange-600 dark:text-orange-400 bg-orange-100/70 dark:bg-orange-950/40',
              accent: 'text-[var(--sf-accent)] bg-[var(--sf-accent-soft)]',
              rose: 'text-rose-600 dark:text-rose-400 bg-rose-100/70 dark:bg-rose-950/40',
            }[agent.color as 'indigo' | 'amber' | 'emerald' | 'orange' | 'accent' | 'rose'];

            return (
              <div
                key={agent.id}
                onClick={() => {
                  const current = settings.enabledAgents || [];
                  const next = isChecked 
                    ? current.filter(id => id !== agent.id)
                    : [...current, agent.id];
                  if (next.length > 0) {
                    set({ enabledAgents: next });
                  }
                }}
                className={`relative flex flex-col items-start p-4 rounded-xl border cursor-pointer select-none transition-all duration-300 hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.99] group shadow-sm hover:shadow-md ${themeClasses} ${!isChecked ? 'opacity-60 hover:opacity-100' : ''}`}
              >
                {/* Header info */}
                <div className="flex items-center justify-between w-full mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition shrink-0 ${iconColors}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  
                  {/* Custom checkbox badge */}
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-300 ${isChecked ? 'bg-indigo-650 dark:bg-indigo-500 border-indigo-650 dark:border-indigo-500 scale-100 shadow-sm shadow-indigo-500/10' : 'border-slate-300 dark:border-slate-700 bg-transparent scale-90'}`}>
                    {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                  </div>
                </div>

                {/* Text Content */}
                <span className="text-sm font-bold text-slate-850 dark:text-slate-100 mb-0.5">{agent.label}</span>
                <span className="text-[11px] font-medium leading-normal text-slate-450 dark:text-slate-500">{agent.desc}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Детализация конспекта */}
      {settings.enabledAgents?.includes('summarizer') && (
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Детализация конспекта</label>
          <SegmentedControl
            options={Object.entries(detailLabels).map(([k, v]) => ({ key: k, label: v }))}
            value={settings.summaryDetail}
            onChange={v => set({ summaryDetail: v as any })}
          />
        </div>
      )}

      {/* Количество карточек */}
      {settings.enabledAgents?.includes('flashcards') && (
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Количество карточек: {settings.flashcardCount}</label>
          <input type="range" min={3} max={12} value={settings.flashcardCount}
            onChange={e => set({ flashcardCount: +e.target.value })}
            className="w-full accent-brand-600" />
          <div className="flex justify-between text-xs text-slate-400 mt-1"><span>3</span><span>12</span></div>
        </div>
      )}

      {/* Параметры проверочного теста */}
      {settings.enabledAgents?.includes('quiz') && (
        <>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Количество вопросов: {settings.quizCount}</label>
            <input type="range" min={3} max={10} value={settings.quizCount}
              onChange={e => set({ quizCount: +e.target.value })}
              className="w-full accent-brand-600" />
            <div className="flex justify-between text-xs text-slate-400 mt-1"><span>3</span><span>10</span></div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Сложность теста</label>
            <SegmentedControl
              options={Object.entries(diffLabels).map(([k, v]) => ({ key: k, label: v }))}
              value={settings.quizDifficulty}
              onChange={v => set({ quizDifficulty: v as any })}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Тип вопросов</label>
            <SegmentedControl
              options={Object.entries(typeLabels).map(([k, v]) => ({ key: k, label: v }))}
              value={settings.quizType}
              onChange={v => set({ quizType: v as any })}
            />
          </div>
        </>
      )}
    </div>
  );
}
