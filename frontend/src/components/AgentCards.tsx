import { Check, Loader2, X } from 'lucide-react';
import type { AgentStatus, SectionName } from '../types';
import { SECTION_ACCUSATIVE, isSectionName } from '../utils/analysisSections';

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
  if (status === 'running') {
    return <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-[var(--sf-accent-fg)] motion-reduce:animate-none" />;
  }
  if (status === 'done') return <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--sf-accent-fg)]" />;
  if (status === 'failed') return <X aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--sf-muted)]" />;
  return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sf-line)]" />;
}

/**
 * Ход анализа: какие разделы готовятся, какие готовы и какие не получились.
 * Под прогрессом — простая «Отменить», без сохранения и без списания.
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
    <section className="mx-auto max-w-xl py-10 text-[var(--sf-ink)]" aria-labelledby="analysis-progress-heading">
      <h2 id="analysis-progress-heading" className="text-2xl font-semibold leading-tight tracking-[-0.01em]">
        {heading}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--sf-muted)]" aria-live="polite">
        {extracting
          ? statusNote || 'Достаём текст из источника, обычно это несколько секунд.'
          : `Завершено ${finished} из ${total}. Разделы готовятся одновременно.`}
      </p>
      {isDemo && (
        <p className="mt-1 text-sm text-[var(--sf-muted)]">Демо-текст: лимит не списывается.</p>
      )}

      <div
        className="mt-6 h-1 w-full overflow-hidden rounded-full bg-[var(--sf-line)]"
        role="progressbar"
        aria-label="Ход анализа"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className="h-full rounded-full bg-[var(--sf-accent)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="mt-6 divide-y divide-[var(--sf-line)] border-y border-[var(--sf-line)]" aria-label="Разделы">
        {agents.map(agent => (
          <li key={agent.id} className="flex min-h-[48px] items-center justify-between gap-4 py-2.5">
            <span className="text-base">{agent.label}</span>
            <span className="flex items-center gap-2 text-sm text-[var(--sf-muted)]">
              <StatusMark status={agent.status} />
              {STATUS_TEXT[agent.status]}
            </span>
          </li>
        ))}
      </ul>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-6 inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-[var(--sf-muted)] transition-colors hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]"
        >
          Отменить
        </button>
      )}
    </section>
  );
}
