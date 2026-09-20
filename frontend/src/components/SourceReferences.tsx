import { useState } from 'react';
import { ChevronDown, ShieldCheck, ShieldAlert } from 'lucide-react';

interface SourceReferencesProps {
  ids?: string[];
  sources?: { id: string; text: string }[];
  compact?: boolean;
}

export default function SourceReferences({ ids, sources = [], compact = false }: SourceReferencesProps) {
  const [open, setOpen] = useState(false);

  if (!ids?.length) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400" title="Для этого фрагмента не найдено точного совпадения с исходником">
        <ShieldAlert className="w-3 h-3" />Источник не найден
      </span>
    );
  }

  const sourceMap = new Map(sources.map(source => [source.id, source.text]));

  return (
    <div className={compact ? 'mt-2' : 'mt-3'}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
        aria-expanded={open}
      >
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        Источник: {ids.join(', ')}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l-2 border-emerald-200 dark:border-emerald-900/60 pl-3">
          {ids.map(id => (
            <p key={id} className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{id}</span>{' '}
              {sourceMap.get(id) || 'Фрагмент исходника недоступен'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
