import { useId, useState } from 'react';

interface SourceReferencesProps {
  ids?: string[];
  sources?: { id: string; text: string }[];
  compact?: boolean;
}

/** 'S04' → '4': the student sees «фрагмент 4», never an internal id. */
function fragmentNumber(id: string): string {
  const match = /S0*(\d+)$/.exec(id.trim());
  return match ? match[1] : id;
}

/**
 * The lecture fragments nearest to a piece of the result (redesign spec 5.3): «фрагменты 1, 4» in
 * the body font and the pencil's blue, opening the fragments' own text. No paperclip icon, no
 * monospace ids, no tiny type. The links are found by words, so they are «ближайшие», not quotes.
 */
export default function SourceReferences({ ids, sources = [], compact = false }: SourceReferencesProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  if (!ids?.length) {
    if (!sources.length) return null;
    return (
      <span className={`inline-block text-[15px] leading-[22px] text-[var(--sf-muted)] ${compact ? 'mt-2' : ''}`} title="Для этого места не нашлось фрагмента лекции">
        без ссылки на фрагмент
      </span>
    );
  }

  const sourceMap = new Map(sources.map(source => [source.id, source.text]));
  const numbers = ids.map(fragmentNumber);
  const label = `${numbers.length === 1 ? 'фрагмент' : 'фрагменты'} ${numbers.join(', ')}`;

  return (
    <div className={compact ? 'mt-2' : ''}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="inline-flex min-h-8 items-center text-[15px] font-medium leading-[22px] text-[var(--ph-pencil-desk,var(--sf-accent-fg))] underline decoration-1 underline-offset-4 [text-decoration-color:color-mix(in_srgb,currentColor_35%,transparent)] transition-colors hover:[text-decoration-color:currentColor] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`Ближайшие фрагменты лекции: ${numbers.join(', ')}`}
      >
        {label}
      </button>
      {open && (
        <div id={contentId} className="mt-2 space-y-3">
          {ids.map((id, index) => (
            <p key={`${id}-${index}`} className="max-w-[36em] text-[15px] leading-[22px] text-[var(--sf-ink)]">
              <span className="mr-1.5 font-medium text-[var(--sf-muted)]">Фрагмент {fragmentNumber(id)}.</span>
              {sourceMap.get(id) || 'Текст фрагмента недоступен.'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
