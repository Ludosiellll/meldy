import { Fragment } from 'react';
import { usePhone } from '../../lib/usePhone';
import { useFragmentPanel } from './FragmentPanel';
import { fragmentNumber, fragmentWord, type SourceFragment } from './fragmentModel';

interface FragmentRefsProps {
  ids: string[];
  sources: SourceFragment[];
  /** Stems of the section (or term) the fragments stand by: the panel underlines the ones a fragment shares. */
  stems: string[];
  /** Why these fragments, in plain words: the panel says it over the fragment. */
  note: string;
  compact?: boolean;
}

/** The fragments in the order of their numbers: «фрагменты 7, 8», not «8, 7». */
function byNumber(ids: string[]): string[] {
  return [...ids].sort((a, b) => (fragmentNumber(a) ?? 0) - (fragmentNumber(b) ?? 0));
}

/** «фрагменты 2, 3»: the numbers of the fragments in words, without the «S» of their ids, in order. */
export function fragmentsLine(ids: string[]): string {
  const numbers = byNumber(ids).map((id) => String(fragmentNumber(id) ?? id));
  return `${numbers.length === 1 ? 'фрагмент' : 'фрагменты'} ${numbers.join(', ')}`;
}

/**
 * «фрагмент 1 · фрагмент 4» after a section or a term (spec 5.3: .sf-ref pills); on a phone one small line «фрагменты 2,
 * 3» (10_Project/Phone_Declutter_2026-10-08). Each opens the fragment panel (FragmentPanel.tsx, owner 21.10): nothing
 * opens inside the card, so a card never grows and its row never stretches. The panel has switches between the
 * fragments of the same section or term; the chip of the fragment on screen stays marked.
 */
export function FragmentRefs({ ids, sources, stems, note, compact = false }: FragmentRefsProps) {
  const phone = usePhone();
  const { open, current, panel } = useFragmentPanel();
  if (ids.length === 0) return null;
  const textOf = (id: string) => sources.find((source) => source.id === id)?.text;
  const ordered = byNumber(ids);
  const show = (id: string, from: HTMLElement) =>
    open({
      note,
      fragments: ordered.map((fragmentId) => ({ id: fragmentId, number: fragmentNumber(fragmentId), text: textOf(fragmentId), stems })),
      current: id,
      returnTo: from,
    });

  if (phone) {
    return (
      <div className={`sv-refs sv-refs-line${compact ? ' sv-refs-compact' : ''}`}>
        <button
          type="button"
          className="sf-link sv-refs-link"
          data-muted=""
          aria-haspopup="dialog"
          aria-expanded={current !== null}
          onClick={(event) => show(ordered[0], event.currentTarget)}
        >
          {fragmentsLine(ids)}
        </button>
        {panel}
      </div>
    );
  }

  return (
    <div className={`sv-refs${compact ? ' sv-refs-compact' : ''}`}>
      <p className="sv-refline">
        {ids.map((id, index) => {
          const active = current === id;
          const number = fragmentWord(id).replace('фрагмент ', '');
          return (
            <Fragment key={id}>
              {index > 0 && <span aria-hidden="true"> · </span>}
              <button
                type="button"
                className="sf-ref sv-ref"
                data-active={active ? '' : undefined}
                // The number again in a small circle before the words (CSS ::before, not part of the text).
                data-n={number}
                aria-label={`Фрагмент лекции ${number}`}
                aria-haspopup="dialog"
                aria-expanded={active}
                onClick={(event) => show(id, event.currentTarget)}
              >
                {fragmentWord(id)}
              </button>
            </Fragment>
          );
        })}
      </p>
      {panel}
    </div>
  );
}
