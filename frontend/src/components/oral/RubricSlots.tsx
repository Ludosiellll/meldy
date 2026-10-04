import { useRef } from 'react';
import { Mark, PencilBrace, PencilUnder, seedFrom } from '../marks';
import { markedRuns, quoteMarks, rowQuoteGroups } from '../../lib/oral/rubricMatch';
import { pointSource } from '../../lib/oral/oralPersistence';
import type { RubricMaterial, RubricPoint } from '../../lib/oral/oralApi';

/** «…отношение процентного изменения» — a quote cut from the middle of a sentence starts with «…». */
export function quoteText(quote: string): string {
  const text = quote.trim();
  const first = text.match(/\p{L}/u)?.[0] ?? '';
  const midSentence = first !== '' && first === first.toLowerCase() && first !== first.toUpperCase();
  return midSentence && !text.startsWith('…') ? `…${text}` : text;
}

interface UnderlinedTextProps {
  text: string;
  anchors: string[][];
  seed: number;
  /** Only these anchor groups (the protocol underlines the same groups in the answer and the lecture). */
  groups?: ReadonlySet<number>;
  /** Draw the lines in (a row that has just opened, a fresh judgement); otherwise they are simply there. */
  animate?: boolean;
  delayMs?: number;
}

/**
 * A piece of text with a point's key words underlined in pencil (redesign spec 4): at most two lines,
 * the longest matches of two different groups first (redesign critique 4), never one under every word.
 */
export function UnderlinedText({ text, anchors, seed, groups, animate = false, delayMs = 0 }: UnderlinedTextProps) {
  const marked = anchors.length > 0 ? quoteMarks(anchors, text, groups) : new Set<number>();
  if (marked.size === 0) return <>{text}</>;
  const runs = markedRuns(text, marked);
  let index = 0;
  return (
    <>
      {runs.map((run, position) =>
        run.marked ? (
          <PencilUnder key={position} seed={seed + (index += 1) * 7} animate={animate} delayMs={delayMs}>
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
  /**
   * What the student said (final and interim words): a named row underlines only the words of the
   * group that named it, the same notion the transcript underlines — one pencil line per row.
   */
  said?: string;
}

/**
 * The rubric points on the answer sheet (contracts §7.2, redesign spec 5.11). A closed row is a
 * number and a dotted line — its title is not in the page at all until the point is named, so it
 * cannot prompt the answer. A named row gets a pencil dot — named by key words, not judged: no
 * tick-shaped mark appears before the evaluation, so nothing here looks like the protocol's «раскрыт»
 * (Jury_Check item 7) — and the lecture's own words (a quote cut by code), with the words that
 * matched underlined. Marks only add. The examiner's row gets a brace and keeps its title hidden:
 * the question already says what it is about.
 */
export default function RubricSlots({ points, materials, named, asked, seed, announcement, said }: RubricSlotsProps) {
  // Rows named before this sheet appeared (a restored answer) are drawn still; new ones are drawn in.
  const initial = useRef<ReadonlySet<string> | null>(null);
  if (initial.current === null) initial.current = new Set(named);

  return (
    <>
      <ol className="or-pts" aria-label="Пункты ответа">
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
          const quote = quoteText(point.source_quote);
          const groups = said === undefined ? undefined : rowQuoteGroups(point.anchors, said, quote);
          return (
            <li key={point.id} className="or-pt" data-point={point.id} data-named="" data-fresh={fresh ? '' : undefined}>
              <span className="or-pt-m or-pt-dot">
                {/* Provisional: a pencil dot, «named by key words». The tick, the cup, the dash and the cross are
                    the protocol's, after the check of the whole answer (Jury_Check item 7). */}
                <Mark kind="dot" seed={markSeed} animate={fresh} />
                <span className="sr-only">{`Пункт ${number} назван по ключевым словам.`}</span>
              </span>
              <span className="or-pt-n" aria-hidden="true">
                {number}
              </span>
              <span className="or-pt-t">
                «<UnderlinedText text={quote} anchors={point.anchors} groups={groups} seed={markSeed + 11} animate={fresh} />»
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
