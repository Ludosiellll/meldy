import { useId, useState } from 'react';
import { ChevronDown, CircleAlert, Link2 } from 'lucide-react';

interface SourceReferencesProps {
  ids?: string[];
  sources?: { id: string; text: string }[];
  compact?: boolean;
}

export default function SourceReferences({ ids, sources = [], compact = false }: SourceReferencesProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  if (!ids?.length) {
    if (!sources.length) return null;
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 ${compact ? 'mt-2' : ''}`} title="Для этого результата не найден точный фрагмент исходника">
        <CircleAlert className="h-3.5 w-3.5" />Без ссылки на исходник
      </span>
    );
  }

  const sourceMap = new Map(sources.map(source => [source.id, source.text]));

  return (
    <div className={compact ? 'mt-2' : ''}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="inline-flex min-h-7 items-center gap-1.5 rounded-md text-[11px] font-medium text-slate-500 transition hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-slate-400 dark:hover:text-teal-300"
        aria-expanded={open}
        aria-controls={contentId}
      >
        <Link2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
        {compact ? ids.join(', ') : `Источники: ${ids.join(', ')}`}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={contentId} className="mt-2 space-y-2 rounded-lg bg-slate-100/70 p-3 dark:bg-slate-900/70">
          {ids.map(id => (
            <p key={id} className="text-xs leading-5 text-slate-600 dark:text-slate-400">
              <span className="font-mono text-[10px] font-semibold text-teal-700 dark:text-teal-300">{id}</span>{' '}
              {sourceMap.get(id) || 'Фрагмент исходника недоступен'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
