import { useId } from 'react';
import { AnalysisSettings } from '../types';
import { FileText, Layers, HelpCircle, Zap, MessagesSquare, Check } from 'lucide-react';

interface Props {
  settings: AnalysisSettings;
  onChange: (s: AnalysisSettings) => void;
}

const detailLabels: Record<string, string> = { brief: 'Краткий', medium: 'Средний', detailed: 'Подробный' };
const diffLabels: Record<string, string> = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', mixed: 'Смешанный' };
const typeLabels: Record<string, string> = { multiple: 'Выбор ответа', truefalse: 'Верно / Неверно' };

/** Pills in one white track (the landing's «Готовлюсь к…»): the chosen one is the ink pill. */
function SegmentedControl({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ac-seg">
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={value === o.key ? 'ac-seg-btn font-medium' : 'ac-seg-btn'}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const AGENTS = [
  { id: 'summarizer', label: 'Конспект', desc: 'Структурированные тезисы, темы и словарь терминов', icon: FileText, tone: 'b' },
  { id: 'flashcards', label: 'Карточки', desc: 'Флеш-карточки для быстрого интервального повторения', icon: Layers, tone: 'y' },
  { id: 'quiz', label: 'Тест', desc: 'Интерактивный тест с подробным разбором ошибок', icon: HelpCircle, tone: 'g' },
  { id: 'cheatsheet', label: 'Шпаргалка', desc: 'Самая главная выжимка лекции для быстрой проверки', icon: Zap, tone: 'p' },
  { id: 'podcast', label: 'Разговор', desc: 'Два ведущих обсуждают материал, на экране — схемы и термины', icon: MessagesSquare, tone: 's' },
];

/**
 * What to prepare from a material (Meldy 2026-10-04): module cards with a round check, pill segments
 * and blue sliders. Styles .ac-mod / .ac-seg / .ac-range in styles/legacy.css.
 */
export default function SettingsPanel({ settings, onChange }: Props) {
  const set = (patch: Partial<AnalysisSettings>) => onChange({ ...settings, ...patch });
  const ids = useId();

  const toggleAgent = (id: string, isChecked: boolean) => {
    const current = settings.enabledAgents || [];
    const next = isChecked ? current.filter(agentId => agentId !== id) : [...current, id];
    if (next.length > 0) {
      set({ enabledAgents: next });
    }
  };

  return (
    <div className="ac-settings">
      <div>
        <span className="ac-settings-h" id={`${ids}-modules`}>Модули для генерации</span>
        <div className="ac-mods" role="group" aria-labelledby={`${ids}-modules`}>
          {AGENTS.map(agent => {
            const isChecked = (settings.enabledAgents || []).includes(agent.id);
            const Icon = agent.icon;

            return (
              <div
                key={agent.id}
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                onClick={() => toggleAgent(agent.id, isChecked)}
                onKeyDown={event => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    toggleAgent(agent.id, isChecked);
                  }
                }}
                className="ac-mod"
                data-on={isChecked ? '' : undefined}
              >
                <div className="ac-mod-top">
                  <span className={`ac-mod-i ac-mod-i--${agent.tone}`} aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="ac-mod-tick" aria-hidden="true">
                    {isChecked && <Check />}
                  </span>
                </div>
                <span className="ac-mod-t">{agent.label}</span>
                <span className="ac-mod-d">{agent.desc}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Детализация конспекта */}
      {settings.enabledAgents?.includes('summarizer') && (
        <div className="ac-set">
          <span className="ac-set-l">Детализация конспекта</span>
          <SegmentedControl
            options={Object.entries(detailLabels).map(([k, v]) => ({ key: k, label: v }))}
            value={settings.summaryDetail}
            onChange={v => set({ summaryDetail: v as any })}
          />
        </div>
      )}

      {/* Количество карточек */}
      {settings.enabledAgents?.includes('flashcards') && (
        <div className="ac-set">
          <label htmlFor={`${ids}-cards`} className="ac-set-l">Количество карточек: {settings.flashcardCount}</label>
          <input
            id={`${ids}-cards`}
            type="range"
            min={3}
            max={12}
            value={settings.flashcardCount}
            onChange={e => set({ flashcardCount: +e.target.value })}
            className="ac-range"
          />
          <div className="ac-range-ends" aria-hidden="true"><span>3</span><span>12</span></div>
        </div>
      )}

      {/* Параметры проверочного теста */}
      {settings.enabledAgents?.includes('quiz') && (
        <>
          <div className="ac-set">
            <label htmlFor={`${ids}-quiz`} className="ac-set-l">Количество вопросов: {settings.quizCount}</label>
            <input
              id={`${ids}-quiz`}
              type="range"
              min={3}
              max={10}
              value={settings.quizCount}
              onChange={e => set({ quizCount: +e.target.value })}
              className="ac-range"
            />
            <div className="ac-range-ends" aria-hidden="true"><span>3</span><span>10</span></div>
          </div>

          <div className="ac-set">
            <span className="ac-set-l">Сложность теста</span>
            <SegmentedControl
              options={Object.entries(diffLabels).map(([k, v]) => ({ key: k, label: v }))}
              value={settings.quizDifficulty}
              onChange={v => set({ quizDifficulty: v as any })}
            />
          </div>

          <div className="ac-set">
            <span className="ac-set-l">Тип вопросов</span>
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
