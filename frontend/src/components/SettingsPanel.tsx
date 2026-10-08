import { useId } from 'react';
import { AnalysisSettings } from '../types';
import { FileText, Layers, HelpCircle, Zap, MessagesSquare, Check } from 'lucide-react';
import { pluralRu } from './conversation/visuals';

interface Props {
  settings: AnalysisSettings;
  onChange: (s: AnalysisSettings) => void;
  /** Nothing can be changed (the demo text is analysed with its own settings); the caller says why. */
  disabled?: boolean;
}

const detailLabels: Record<string, string> = { brief: 'Краткий', medium: 'Средний', detailed: 'Подробный' };
const diffLabels: Record<string, string> = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', mixed: 'Смешанный' };
const typeLabels: Record<string, string> = { multiple: 'Выбор ответа', truefalse: 'Верно / Неверно' };

/** Pills in one white track (the landing's «Готовлюсь к…»): the chosen one is the ink pill. */
function SegmentedControl({ options, value, onChange, disabled }: { options: { key: string; label: string }[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="ac-seg">
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          disabled={disabled}
          className={value === o.key ? 'ac-seg-btn font-medium' : 'ac-seg-btn'}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What a lecture can be made into, in the student's words (finding LIB-8: «Модули для генерации», «Флеш-карточки
 * для быстрого интервального повторения» were the program's words). The podcast is «Подкаст» (decision 1).
 */
const AGENTS = [
  { id: 'summarizer', label: 'Конспект', desc: 'Главное по разделам и словарь терминов', icon: FileText, tone: 'b' },
  { id: 'flashcards', label: 'Карточки', desc: 'Вопрос — ответ, для повторения по дням', icon: Layers, tone: 'y' },
  { id: 'quiz', label: 'Тест', desc: 'Вопросы с вариантами и объяснением ошибок', icon: HelpCircle, tone: 'g' },
  { id: 'cheatsheet', label: 'Выжимка', desc: 'Главное на одну страницу, повторить перед экзаменом', icon: Zap, tone: 'p' },
  { id: 'podcast', label: 'Подкаст', desc: 'Два ведущих обсуждают лекцию, на экране — схемы и термины', icon: MessagesSquare, tone: 's' },
];

/**
 * «конспект, 6 карточек и тест из 5 вопросов»: what the analysis will make with these settings, in the order of
 * the list (the folded «Что подготовить» of the upload page).
 */
export function settingsSummary(settings: AnalysisSettings): string {
  const on = new Set(settings.enabledAgents || []);
  const parts: string[] = [];
  // A number never parts from its word («6 карточек», «из 5 вопросов»).
  const nb = ' ';
  if (on.has('summarizer')) {
    parts.push(settings.summaryDetail === 'brief' ? 'краткий конспект' : settings.summaryDetail === 'detailed' ? 'подробный конспект' : 'конспект');
  }
  if (on.has('flashcards')) parts.push(`${settings.flashcardCount}${nb}${pluralRu(settings.flashcardCount, ['карточка', 'карточки', 'карточек'])}`);
  if (on.has('quiz')) {
    const kind = settings.quizType === 'truefalse' ? ' «верно или неверно»' : '';
    parts.push(`тест из${nb}${settings.quizCount}${nb}${pluralRu(settings.quizCount, ['вопроса', 'вопросов', 'вопросов'])}${kind}`);
  }
  if (on.has('cheatsheet')) parts.push('выжимка');
  if (on.has('podcast')) parts.push('подкаст');
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`;
}

/**
 * What to prepare from a material (Meldy 2026-10-04): cards with a round check, pill segments and blue sliders.
 * Styles .ac-mod / .ac-seg / .ac-range in styles/legacy.css.
 */
export default function SettingsPanel({ settings, onChange, disabled = false }: Props) {
  const set = (patch: Partial<AnalysisSettings>) => {
    if (!disabled) onChange({ ...settings, ...patch });
  };
  const ids = useId();

  const toggleAgent = (id: string, isChecked: boolean) => {
    const current = settings.enabledAgents || [];
    const next = isChecked ? current.filter(agentId => agentId !== id) : [...current, id];
    if (next.length > 0) {
      set({ enabledAgents: next });
    }
  };

  return (
    <div className="ac-settings" data-disabled={disabled ? '' : undefined}>
      <div>
        <span className="ac-settings-h" id={`${ids}-modules`}>Что сделать из лекции</span>
        <div className="ac-mods" role="group" aria-labelledby={`${ids}-modules`}>
          {AGENTS.map(agent => {
            const isChecked = (settings.enabledAgents || []).includes(agent.id);
            const Icon = agent.icon;

            return (
              <div
                key={agent.id}
                role="checkbox"
                aria-checked={isChecked}
                aria-disabled={disabled || undefined}
                tabIndex={disabled ? -1 : 0}
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

      {/* Подробность конспекта */}
      {settings.enabledAgents?.includes('summarizer') && (
        <div className="ac-set">
          <span className="ac-set-l">Подробность конспекта</span>
          <SegmentedControl
            options={Object.entries(detailLabels).map(([k, v]) => ({ key: k, label: v }))}
            value={settings.summaryDetail}
            onChange={v => set({ summaryDetail: v as any })}
            disabled={disabled}
          />
        </div>
      )}

      {/* Количество карточек */}
      {settings.enabledAgents?.includes('flashcards') && (
        <div className="ac-set">
          <label htmlFor={`${ids}-cards`} className="ac-set-l">Карточек: {settings.flashcardCount}</label>
          <input
            id={`${ids}-cards`}
            type="range"
            min={3}
            max={12}
            value={settings.flashcardCount}
            onChange={e => set({ flashcardCount: +e.target.value })}
            disabled={disabled}
            className="ac-range"
          />
          <div className="ac-range-ends" aria-hidden="true"><span>3</span><span>12</span></div>
        </div>
      )}

      {/* Параметры проверочного теста */}
      {settings.enabledAgents?.includes('quiz') && (
        <>
          <div className="ac-set">
            <label htmlFor={`${ids}-quiz`} className="ac-set-l">Вопросов в тесте: {settings.quizCount}</label>
            <input
              id={`${ids}-quiz`}
              type="range"
              min={3}
              max={10}
              value={settings.quizCount}
              onChange={e => set({ quizCount: +e.target.value })}
              disabled={disabled}
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
              disabled={disabled}
            />
          </div>

          <div className="ac-set">
            <span className="ac-set-l">Вопросы теста</span>
            <SegmentedControl
              options={Object.entries(typeLabels).map(([k, v]) => ({ key: k, label: v }))}
              value={settings.quizType}
              onChange={v => set({ quizType: v as any })}
              disabled={disabled}
            />
          </div>
        </>
      )}
    </div>
  );
}
