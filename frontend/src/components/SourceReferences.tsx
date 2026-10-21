import { useFragmentPanel } from './summary/FragmentPanel';
import { fragmentNumber as numberOf } from './summary/fragmentModel';
import './SourceReferences.css';

interface SourceReferencesProps {
  ids?: string[];
  sources?: { id: string; text: string }[];
  compact?: boolean;
  /** Why these fragments, in plain words: the panel says it over the fragment. */
  note?: string;
  /** The words of the card or the question: the panel underlines the ones a fragment shares. */
  stems?: readonly string[];
}

/** 'S04' → '4': the student sees «фрагмент 4», never an internal id. */
function fragmentNumber(id: string): string {
  const match = /S0*(\d+)$/.exec(id.trim());
  return match ? match[1] : id;
}

/**
 * The lecture fragments nearest to a piece of the result (redesign spec 5.3): «фрагменты 1, 4» in
 * the body font and the pencil's blue. It opens the fragments in the fragment panel (summary/FragmentPanel.tsx, owner
 * 21.10), never inside the card: a card in a row of cards does not grow. No paperclip icon, no monospace ids, no tiny
 * type. The links are found by words, so they are «ближайшие», not quotes.
 */
export default function SourceReferences({ ids, sources = [], compact = false, note, stems = [] }: SourceReferencesProps) {
  const { open, current, panel } = useFragmentPanel();

  if (!ids?.length) {
    if (!sources.length) return null;
    return (
      <span className={`srf-none ${compact ? 'srf-compact' : ''}`} title="Для этого места не нашлось фрагмента лекции">
        без ссылки на фрагмент
      </span>
    );
  }

  const unique = Array.from(new Set(ids));
  const numbers = unique.map(fragmentNumber);
  const label = `${numbers.length === 1 ? 'фрагмент' : 'фрагменты'} ${numbers.join(', ')}`;
  const ordered = [...unique].sort((a, b) => (numberOf(a) ?? 0) - (numberOf(b) ?? 0));
  const textOf = (id: string) => sources.find((source) => source.id === id)?.text;

  return (
    <div className={compact ? 'srf srf-compact' : 'srf'}>
      <button
        type="button"
        onClick={(event) =>
          open({
            note,
            fragments: ordered.map((id) => ({ id, number: numberOf(id), text: textOf(id), stems })),
            current: ordered[0],
            returnTo: event.currentTarget,
          })
        }
        className="srf-button"
        aria-haspopup="dialog"
        aria-expanded={current !== null}
        aria-label={`Ближайшие фрагменты лекции: ${numbers.join(', ')}`}
      >
        {label}
      </button>
      {panel}
    </div>
  );
}
