import { Check, Loader2, X } from 'lucide-react';
import type { AgentStatus, SectionName } from '../types';
import { SECTION_ACCUSATIVE, isSectionName } from '../utils/analysisSections';
import './AgentCards.css';

const STATUS_TEXT: Record<AgentStatus['status'], string> = {
  idle: 'В очереди',
  running: 'Готовим…',
  done: 'Готово',
  failed: 'Не получилось',
};

function joinRu(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

function StatusMark({ status }: { status: AgentStatus['status'] }) {
  if (status === 'running') return <Loader2 aria-hidden="true" className="ag-icon ag-spin" />;
  if (status === 'done') return <Check aria-hidden="true" className="ag-icon" />;
  if (status === 'failed') return <X aria-hidden="true" className="ag-icon" />;
  return <span aria-hidden="true" className="ag-dot" />;
}

/**
 * Ход анализа: какие разделы готовятся, какие готовы и какие не получились — строки со статусами-пилюлями
 * в белом окне на синей панели (язык Meldy 2026-10-04). Под прогрессом — простая «Отменить», без
 * сохранения и без списания.
 */
export default function AgentCards({
  agents,
  phase,
  isDemo,
  onCancel,
  statusNote,
}: {
  agents: AgentStatus[];
  phase: string;
  isDemo?: boolean;
  onCancel?: () => void;
  /** Сообщение сервера о долгом шаге (расшифровка медиа, загрузка страницы). */
  statusNote?: string;
}) {
  const total = agents.length;
  const finished = agents.filter(agent => agent.status === 'done' || agent.status === 'failed').length;
  const extracting = phase === 'extracting';
  const pct = extracting ? 6 : Math.round(10 + (total > 0 ? (finished / total) * 85 : 0));
  const names = agents.map(agent => (isSectionName(agent.id) ? SECTION_ACCUSATIVE[agent.id as SectionName] : agent.label.toLowerCase()));
  const heading = extracting ? 'Читаем текст…' : `Готовим ${joinRu(names)}`;

  return (
    <section className="ag" aria-labelledby="analysis-progress-heading">
      <div className="ag-card">
        <h2 id="analysis-progress-heading" className="ag-h2">
          {heading}
        </h2>
        <p className="ag-lede" aria-live="polite">
          {extracting
            ? statusNote || 'Достаём текст из источника, обычно это несколько секунд.'
            : `Завершено ${finished} из ${total}. Разделы готовятся одновременно.`}
        </p>
        {isDemo && <p className="ag-demo">Демо-текст: лимит не списывается.</p>}

        <div
          className="ag-bar"
          role="progressbar"
          aria-label="Ход анализа"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="ag-bar-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="ag-panel">
          <ul className="ag-list" aria-label="Разделы">
            {agents.map(agent => (
              <li key={agent.id} className="ag-row">
                <span className="ag-name">{agent.label}</span>
                <span className="ag-status" data-status={agent.status}>
                  <StatusMark status={agent.status} />
                  {STATUS_TEXT[agent.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {onCancel && (
          <button type="button" onClick={onCancel} className="sf-secondary ag-cancel">
            Отменить
          </button>
        )}
      </div>
    </section>
  );
}
