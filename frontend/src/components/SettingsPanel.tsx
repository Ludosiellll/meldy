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
    <div className="flex flex-wrap bg-slate-100 rounded-lg p-1 gap-1">
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className={'flex-1 min-w-[80px] sm:min-w-0 px-2 sm:px-3 py-1.5 rounded-md text-sm transition ' + (value === o.key ? 'bg-white text-slate-900 font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
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
        <label className="text-sm font-medium text-slate-700 mb-2 block">Детализация конспекта</label>
        <SegmentedControl
          options={Object.entries(detailLabels).map(([k, v]) => ({ key: k, label: v }))}
          value={settings.summaryDetail}
          onChange={v => set({ summaryDetail: v as any })}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 mb-2 block">Количество карточек: {settings.flashcardCount}</label>
        <input type="range" min={3} max={12} value={settings.flashcardCount}
          onChange={e => set({ flashcardCount: +e.target.value })}
          className="w-full accent-brand-600" />
        <div className="flex justify-between text-xs text-slate-400 mt-1"><span>3</span><span>12</span></div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 mb-2 block">Количество вопросов: {settings.quizCount}</label>
        <input type="range" min={3} max={10} value={settings.quizCount}
          onChange={e => set({ quizCount: +e.target.value })}
          className="w-full accent-brand-600" />
        <div className="flex justify-between text-xs text-slate-400 mt-1"><span>3</span><span>10</span></div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 mb-2 block">Сложность теста</label>
        <SegmentedControl
          options={Object.entries(diffLabels).map(([k, v]) => ({ key: k, label: v }))}
          value={settings.quizDifficulty}
          onChange={v => set({ quizDifficulty: v as any })}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-700 mb-2 block">Тип вопросов</label>
        <SegmentedControl
          options={Object.entries(typeLabels).map(([k, v]) => ({ key: k, label: v }))}
          value={settings.quizType}
          onChange={v => set({ quizType: v as any })}
        />
      </div>
    </div>
  );
}
