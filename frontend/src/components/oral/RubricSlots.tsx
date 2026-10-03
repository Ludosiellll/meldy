import { useRef } from 'react';
import { Mark, PencilBrace, PencilUnder, seedFrom } from '../marks';
import { anchorWordIndexes, markedRuns, words } from '../../lib/oral/rubricMatch';
import { pointSource } from '../../lib/oral/oralPersistence';
import type { RubricMaterial, RubricPoint } from '../../lib/oral/oralApi';

/** «…отношение процентного изменения» — a quote cut from the middle of a sentence starts with «…». */
export function quoteText(quote: string): string {
  const text = quote.trim();
  const first = text.match(/\p{L}/u)?.[0] ?? '';
  const midSentence = first !== '' && first === first.toLowerCase() && first !== first.toUpperCase();
  return midSentence && !text.startsWith('…') ? `…${text}` : text;
}

/** A piece of text with the anchor words of a point underlined in pencil (redesign spec 4). */
export function UnderlinedText({ text, anchors, seed }: { text: string; anchors: string[][]; seed: number }) {
  const marked = anchors.length > 0 ? anchorWordIndexes(anchors, words(text)) : new Set<number>();
  if (marked.size === 0) return <>{text}</>;
  const runs = markedRuns(text, marked);
  let index = 0;
  return (
    <>
      {runs.map((run, position) =>
        run.marked ? (
          <PencilUnder key={position} seed={seed + (index += 1) * 7}>
            {run.text}
          </PencilUnder>
        ) : (
          <span key={position}>{run.text}</span>
        ),
      )}
    </>
  );
}

interface RubricSlotsProps {
  points: RubricPoint[];
  materials: RubricMaterial[];
  /** Rows shown as named (live marks during the answer). */
  named: ReadonlySet<string>;
  /** The row the examiner asked about: a pencil brace and «вопрос экзаменатора». */
  asked: string | null;
  /** Stable seed of the marks (the question id). */
  seed: string;
  /** Said by screen readers: «Пункт 2 назван: прямой проход». */
  announcement: string;
}

/**
 * The rubric points on the answer sheet (contracts §7.2, redesign spec 5.11). A closed row is a
 * number and a dotted line — its title is not in the page at all until the point is named, so it
 * cannot prompt the answer. A named row gets a tick and the lecture's own words (a quote cut by
 * code), with the words that matched underlined. Marks only add. The examiner's row gets a brace
 * and keeps its title hidden: the question already says what it is about.
 */
export default function RubricSlots({ points, materials, named, asked, seed, announcement }: RubricSlotsProps) {
  // Rows named before this sheet appeared (a restored answer) are drawn still; new ones are drawn in.
  const initial = useRef<ReadonlySet<string> | null>(null);
  if (initial.current === null) initial.current = new Set(named);

  return (
    <>
      <ol className="or-pts" aria-label="Пункты эталона">
        {points.map((point, index) => {
          const number = index + 1;
          const isNamed = named.has(point.id);
          const isAsked = asked === point.id;
          const fresh = isNamed && !initial.current?.has(point.id);
          const markSeed = seedFrom(seed, point.id);
          if (!isNamed) {
            return (
              <li
                key={point.id}
                className="or-pt"
                data-point={point.id}
                aria-label={isAsked ? `Пункт ${number} не назван, об этом спросил экзаменатор` : `Пункт ${number}, ещё не назван`}
              >
                <span className="or-pt-m" />
                <span className="or-pt-n" aria-hidden="true">
                  {number}
                </span>
                <span className="or-pt-blank" aria-hidden="true" />
                {isAsked ? (
                  <span className="or-pt-src or-pt-asked">
                    <PencilBrace seed={markSeed + 3} animate />
                    <span className="sf-pnote">вопрос экзаменатора</span>
                  </span>
                ) : (
                  <span />
                )}
              </li>
            );
          }
          const source = pointSource(point, { materials });
          return (
            <li key={point.id} className="or-pt" data-point={point.id} data-named="" data-fresh={fresh ? '' : undefined}>
              <span className="or-pt-m">
                <Mark kind="tick" seed={markSeed} animate={fresh} />
                <span className="sr-only">{`Пункт ${number} назван.`}</span>
              </span>
              <span className="or-pt-n" aria-hidden="true">
                {number}
              </span>
              <span className="or-pt-t">
                «<UnderlinedText text={quoteText(point.source_quote)} anchors={point.anchors} seed={markSeed + 11} />»
              </span>
              {isAsked ? (
                <span className="or-pt-src or-pt-asked">
                  <PencilBrace seed={markSeed + 3} animate />
                  <span className="sf-pnote">вопрос экзаменатора</span>
                </span>
              ) : (
                <span className="or-pt-src sf-pnote">{source.fragments}</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
