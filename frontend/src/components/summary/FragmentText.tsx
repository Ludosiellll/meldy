import { Fragment, useMemo, useState } from 'react';
import { PencilUnder, seedFrom } from '../marks';
import { normalizeForMatch, wordStem } from '../conversation/visuals';
import { splitFragmentHeading } from '../../utils/fragmentText';
import { underlineStems } from './fragmentModel';
import MathText, { MathPiece, shortenPieces, splitMath, type TextPiece } from './MathText';

/** Longer fragments open with «Показать целиком». */
export const SLIP_LIMIT = 560;
/** Pencil underlines per slip: more turns the slip into a colouring book. */
const MAX_MARKS = 10;

/**
 * The fragment text with the words that share a stem with the section underlined by pencil, and its formulas
 * ($…$ from a web page) drawn as the конспект draws them (QA 2026-10-11: the panel showed «$\triangle ABC$»).
 */
export function MarkedText({ pieces, stems, seedKey }: { pieces: TextPiece[]; stems: Set<string>; seedKey: string }) {
  let count = 0;
  return (
    <>
      {pieces.map((piece, pieceIndex) => {
        if (piece.kind === 'math') return <MathPiece key={pieceIndex} piece={piece} />;
        if (stems.size === 0) return <Fragment key={pieceIndex}>{piece.value}</Fragment>;
        const parts = piece.value.split(/([\p{L}\p{N}]+)/u);
        return (
          <Fragment key={pieceIndex}>
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
          </Fragment>
        );
      })}
    </>
  );
}

interface FragmentTextProps {
  id: string;
  text: string | undefined;
  /** Stems of what opened the fragment (a section, a term, a card): the slip underlines the ones it shares. */
  stems: readonly string[];
  /** The whole text at once, no «Показать целиком». */
  whole?: boolean;
}

/**
 * A cut-out fragment of the lecture on warm paper (spec 5.3): its own heading on a line of its own, the shared words
 * underlined, a long one cut at a word (never inside a formula) with «Показать целиком» under it. Keyed by the
 * fragment, so another fragment opens from its start.
 */
export function FragmentText({ id, text, stems, whole: always = false }: FragmentTextProps) {
  const [whole, setWhole] = useState(false);
  const parts = text ? splitFragmentHeading(text) : null;
  const body = parts?.body ?? '';
  const pieces = useMemo(() => splitMath(body), [body]);
  const long = !always && body.length > SLIP_LIMIT;
  const shown = long && !whole ? shortenPieces(pieces, SLIP_LIMIT) : pieces;
  const marks = useMemo(() => underlineStems(text ?? '', stems), [text, stems]);

  return (
    <>
      <blockquote className="sf-slip fp-slip" data-fragment={id}>
        {text ? (
          <>
            {parts?.heading && (
              <span className="sv-slip-head" data-fragment-heading="">
                <MathText text={parts.heading} />
              </span>
            )}
            <MarkedText pieces={shown} stems={marks} seedKey={`${id}:${stems.length}`} />
          </>
        ) : (
          'Текст фрагмента недоступен.'
        )}
      </blockquote>
      {long && (
        <p className="fp-acts">
          <button type="button" className="sf-link" data-muted="" onClick={() => setWhole((value) => !value)}>
            {whole ? 'Свернуть' : 'Показать целиком'}
          </button>
        </p>
      )}
    </>
  );
}
