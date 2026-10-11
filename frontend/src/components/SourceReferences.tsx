import { useId, useState } from 'react';
import { splitFragmentHeading } from '../utils/fragmentText';
import MathText from './summary/MathText';
import './SourceReferences.css';

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
      <span className={`srf-none ${compact ? 'srf-compact' : ''}`} title="Для этого места не нашлось фрагмента лекции">
        без ссылки на фрагмент
      </span>
    );
  }

  const sourceMap = new Map(sources.map(source => [source.id, source.text]));
  const numbers = ids.map(fragmentNumber);
  const label = `${numbers.length === 1 ? 'фрагмент' : 'фрагменты'} ${numbers.join(', ')}`;

  return (
    <div className={compact ? 'srf srf-compact' : 'srf'}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="srf-button"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        aria-label={`Ближайшие фрагменты лекции: ${numbers.join(', ')}`}
      >
        {label}
      </button>
      {open && (
        <div id={contentId} className="srf-slips">
          {ids.map((id, index) => {
            const text = sourceMap.get(id);
            // A lecture heading keeps its own line (jury memo 12): «Фрагмент 4. Обучение нейронной сети»,
            // the fragment's text below. Without a heading the fragment reads exactly as before.
            const parts = text ? splitFragmentHeading(text) : null;
            return (
              <p key={`${id}-${index}`} className="srf-slip">
                <span className="srf-n">Фрагмент {fragmentNumber(id)}.</span>
                {/* Formulas of a page from the web ($…$) are drawn, not shown as LaTeX (QA 2026-10-11). */}
                {parts?.heading ? (
                  <>
                    <span className="srf-heading" data-fragment-heading="">
                      <MathText text={parts.heading} />
                    </span>
                    <span className="block">
                      <MathText text={parts.body} />
                    </span>
                  </>
                ) : text ? (
                  <MathText text={text} />
                ) : (
                  'Текст фрагмента недоступен.'
                )}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
