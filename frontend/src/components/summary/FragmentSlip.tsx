import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { PencilUnder, seedFrom } from '../marks';
import { normalizeForMatch, wordStem } from '../conversation/visuals';
import { splitFragmentHeading } from '../../utils/fragmentText';
import { fragmentWord, underlineStems, type SourceFragment } from './fragmentModel';

/** Longer fragments open with «Показать целиком». */
const SLIP_LIMIT = 560;
/** Pencil underlines per slip: more turns the slip into a colouring book. */
const MAX_MARKS = 10;

/** The fragment text with the words that share a stem with the section underlined by pencil. */
function MarkedText({ text, stems, seedKey }: { text: string; stems: Set<string>; seedKey: string }) {
  if (stems.size === 0) return <>{text}</>;
  const parts = text.split(/([\p{L}\p{N}]+)/u);
  let count = 0;
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 1 && part.length >= 4 && count < MAX_MARKS && stems.has(wordStem(normalizeForMatch(part)))) {
          count += 1;
          return (
            <PencilUnder key={index} seed={seedFrom(seedKey, count)}>
              {part}
            </PencilUnder>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

interface FragmentSlipProps {
  id: string;
  text: string | undefined;
  /** Stems of the section (or term) the fragment stands by. */
  stems: string[];
  caption: string;
  onClose?: () => void;
  className?: string;
}

/** A cut-out fragment of the lecture: a caption on the desk, the fragment on paper (spec 5.3). */
export function FragmentSlip({ id, text, stems, caption, onClose, className = '' }: FragmentSlipProps) {
  const [whole, setWhole] = useState(false);
  useEffect(() => setWhole(false), [id]);
  const parts = text ? splitFragmentHeading(text) : null;
  const body = parts?.body ?? '';
  const long = body.length > SLIP_LIMIT;
  const shown = long && !whole ? `${body.slice(0, SLIP_LIMIT).replace(/\s+\S*$/, '')}…` : body;
  const marks = useMemo(() => underlineStems(text ?? '', stems), [text, stems]);

  return (
    <figure className={`sv-slipbox ${className}`.trim()} data-fragment={id}>
      <figcaption className="sv-caption">{caption}</figcaption>
      <blockquote className="sf-slip sv-slip">
        {text ? (
          <>
            {parts?.heading && <span className="sv-slip-head">{parts.heading}</span>}
            <MarkedText text={shown} stems={marks} seedKey={`${id}:${stems.length}`} />
          </>
        ) : (
          'Текст фрагмента недоступен.'
        )}
      </blockquote>
      {(long || onClose) && (
        <p className="sv-slip-actions">
          {long && (
            <button type="button" className="sf-link" data-muted="" onClick={() => setWhole((value) => !value)}>
              {whole ? 'Свернуть' : 'Показать целиком'}
            </button>
          )}
          {onClose && (
            <button type="button" className="sf-link" data-muted="" onClick={onClose}>
              Закрыть
            </button>
          )}
        </p>
      )}
    </figure>
  );
}

interface FragmentRefsProps {
  ids: string[];
  sources: SourceFragment[];
  stems: string[];
  /** margin: the links choose the fragment on the margin; inline: each link opens its slip below. */
  mode: 'margin' | 'inline';
  /** The fragment on the margin now (margin mode). */
  current?: string | null;
  onPick?: (id: string) => void;
  captionFor: (id: string) => string;
  compact?: boolean;
}

/** «фрагмент 1 · фрагмент 4» after a section or a term (spec 5.3: .sf-ref, 32 px high). */
export function FragmentRefs({ ids, sources, stems, mode, current = null, onPick, captionFor, compact = false }: FragmentRefsProps) {
  const [open, setOpen] = useState<string | null>(null);
  const slipId = useId();
  const textOf = (id: string) => sources.find((source) => source.id === id)?.text;
  if (ids.length === 0) return null;

  return (
    <div className={`sv-refs${compact ? ' sv-refs-compact' : ''}`}>
      <p className="sv-refline">
        {ids.map((id, index) => {
          const active = mode === 'margin' ? current === id : open === id;
          return (
            <Fragment key={id}>
              {index > 0 && <span aria-hidden="true"> · </span>}
              <button
                type="button"
                className="sf-ref sv-ref"
                data-active={active ? '' : undefined}
                // The number again in a small circle before the words (CSS ::before, not part of the text).
                data-n={fragmentWord(id).replace('фрагмент ', '')}
                aria-label={`Фрагмент лекции ${fragmentWord(id).replace('фрагмент ', '')}`}
                {...(mode === 'inline'
                  ? { 'aria-expanded': active, 'aria-controls': active ? slipId : undefined }
                  : { 'aria-pressed': active })}
                onClick={() => {
                  if (mode === 'margin') onPick?.(id);
                  else setOpen((value) => (value === id ? null : id));
                }}
              >
                {fragmentWord(id)}
              </button>
            </Fragment>
          );
        })}
      </p>
      {mode === 'inline' && open && (
        <div id={slipId}>
          <FragmentSlip id={open} text={textOf(open)} stems={stems} caption={captionFor(open)} onClose={() => setOpen(null)} className="sv-inline-slip" />
        </div>
      )}
    </div>
  );
}
