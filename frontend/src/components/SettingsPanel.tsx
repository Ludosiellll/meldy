import { AnalysisSettings } from '../types';

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
        <label className="text-sm font-black text-slate-900 dark:text-slate-100 mb-2.5 block">Модули для генерации</label>
        <div className="grid grid-cols-2 gap-2 mb-2 bg-slate-100/50 dark:bg-slate-900/30 p-3 rounded-xl border border-slate-200/50 dark:border-slate-800/40">
          {[
            { id: 'summarizer', label: '📝 Конспект' },
            { id: 'flashcards', label: '🃏 Карточки' },
            { id: 'quiz', label: '❓ Тест' },
            { id: 'cheatsheet', label: '⚡ Шпаргалка' },
            { id: 'podcast', label: '🎙️ Подкаст' },
            { id: 'missions', label: '🎮 Миссии' }
          ].map(agent => {
            const isChecked = (settings.enabledAgents || []).includes(agent.id);
            return (
              <label key={agent.id} className="flex items-center gap-2.5 px-2.5 py-1.5 hover:bg-slate-200/50 dark:hover:bg-slate-850/60 rounded-lg cursor-pointer transition select-none">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    const current = settings.enabledAgents || [];
                    const next = isChecked 
                      ? current.filter(id => id !== agent.id)
                      : [...current, agent.id];
                    if (next.length > 0) {
                      set({ enabledAgents: next });
                    }
                  }}
                  className="rounded border-slate-300 dark:border-slate-700 text-brand-650 focus:ring-brand-500 w-4 h-4 cursor-pointer"
                />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{agent.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Детализация конспекта</label>
        <SegmentedControl
          options={Object.entries(detailLabels).map(([k, v]) => ({ key: k, label: v }))}
          value={settings.summaryDetail}
          onChange={v => set({ summaryDetail: v as any })}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Количество карточек: {settings.flashcardCount}</label>
        <input type="range" min={3} max={12} value={settings.flashcardCount}
          onChange={e => set({ flashcardCount: +e.target.value })}
          className="w-full accent-brand-600" />
        <div className="flex justify-between text-xs text-slate-400 mt-1"><span>3</span><span>12</span></div>
      </div>

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
    </div>
  );
}
