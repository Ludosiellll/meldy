import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Mark, PencilBrace, PencilUnder, seedFrom } from '../marks';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { HERO_PAGE, TICKET, fragmentOf, type TicketPoint } from './lecture';
import { NBSP, ty } from './typo';
import './TicketAnswer.css';

export const TICKET_COPY = {
  heading: 'Ответ на билет',
  lead: ty('У каждого пункта эталона — дословная цитата из ваших лекций, её сверяет код. Строка открывается, когда вы называете пункт. Если вы пропустили пункт, экзаменатор задаст один вопрос — прежде всего о главном.'),
  caption: ty(`Пример на лекции «${HERO_PAGE.title}»`),
  ticket: { strong: 'Случайный билет', rest: ty(`${NBSP}· вопрос 1 из 2`) },
  /** The answer sheet's header: rows open by key words while you answer; the protocol judges after. */
  during: ty(`Во время ответа${NBSP}· по ключевым словам`),
  asked: 'вопрос экзаменатора',
  examiner: 'Экзаменатор',
  protocol: 'Протокол ответа',
  covered: 'раскрыт',
};

/** Marks of this example are seeded by the point, so they look the same on every render. */
const SEED = 'landing-ticket';
/** Share of the asked row that has to be in view before the brace is drawn. */
const IN_VIEW = 0.95;

type BraceDraw = 'wait' | 'draw' | 'still';

/** «фрагмент 3», never broken before its number. */
function fragmentLabel(n: number) {
  return `фрагмент${NBSP}${n}`;
}

/** A quote cut from the middle of a sentence starts with «…», as on the answer sheet. */
export function cutQuote(quote: string) {
  const text = quote.trim();
  const first = text.match(/\p{L}/u)?.[0] ?? '';
  const midSentence = first !== '' && first === first.toLowerCase() && first !== first.toUpperCase();
  return midSentence ? `…${text}` : text;
}

/** The words of `text` that start with one of `stems`, underlined in pencil; the rest as is. */
function underlined(text: string, stems: readonly string[], seed: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let count = 0;
  for (const match of text.matchAll(/\p{L}+/gu)) {
    const word = match[0];
    const at = match.index ?? 0;
    if (!stems.some(stem => word.toLowerCase().startsWith(stem))) continue;
    if (at > last) nodes.push(text.slice(last, at));
    count += 1;
    nodes.push(<PencilUnder key={at} seed={seed + count * 7}>{word}</PencilUnder>);
    last = at + word.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * The one pencil draw of the section: the brace by the asked row is drawn (250 ms) when the row
 * comes into view. Under reduced motion, or without IntersectionObserver, it is simply there.
 */
function useBraceDraw(target: RefObject<Element>, reduced: boolean): BraceDraw {
  const [state, setState] = useState<BraceDraw>(() => (reduced || typeof IntersectionObserver === 'undefined' ? 'still' : 'wait'));
  useEffect(() => {
    if (state !== 'wait') return;
    const element = target.current;
    if (reduced || !element || typeof IntersectionObserver === 'undefined') {
      setState('still');
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= IN_VIEW)) return;
      observer.disconnect();
      setState('draw');
    }, { threshold: [0, IN_VIEW], rootMargin: '0px 0px -12% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced, state, target]);
  return state;
}

interface RowProps {
  point: TicketPoint;
  number: number;
  asked: boolean;
  brace: BraceDraw;
  rowRef?: RefObject<HTMLLIElement>;
}

/**
 * A row of the answer sheet (redesign spec 5.11). A closed row is a number and a dotted line: its
 * point is not on the page, so it cannot prompt. A named row has the pencil dot (named by key words,
 * not yet judged) and the lecture's own words with their fragment.
 */
function SheetRow({ point, number, asked, brace, rowRef }: RowProps) {
  const seed = seedFrom(SEED, point.id);
  if (!point.named) {
    return (
      <li ref={rowRef} className="lp-tk-pt" data-point={point.id} data-closed="">
        <span className="sr-only">{asked ? `Пункт ${number} не назван, об этом спросил экзаменатор.` : `Пункт ${number} не назван.`}</span>
        <span className="lp-tk-m" />
        <span className="lp-tk-n" aria-hidden="true">{number}</span>
        <span className="lp-tk-blank" aria-hidden="true" />
        {asked ? (
          <span className="lp-tk-src lp-tk-asked" aria-hidden="true">
            <span className="lp-tk-brace" data-draw={brace}>
              <PencilBrace seed={seed + 3} animate={brace === 'draw'} />
            </span>
            <span className="sf-pnote">{TICKET_COPY.asked}</span>
          </span>
        ) : null}
      </li>
    );
  }
  return (
    <li className="lp-tk-pt" data-point={point.id} data-named="">
      <span className="lp-tk-m lp-tk-dot">
        <Mark kind="dot" seed={seed} />
      </span>
      <span className="lp-tk-n" aria-hidden="true">{number}</span>
      <span className="lp-tk-t">
        <span className="sr-only">{`Пункт ${number} назван: `}</span>
        <span className="lp-tk-quote">«{cutQuote(point.quote)}»</span>
      </span>
      <span className="lp-tk-src sf-pnote">{fragmentLabel(fragmentOf(point.quote))}</span>
    </li>
  );
}

/**
 * One point of the protocol after the answer (redesign spec 5.12): the tick of «раскрыт», what the
 * student said and the lecture's words, the same words underlined in both.
 */
function ProtocolPoint() {
  const index = TICKET.points.findIndex(point => point.id === TICKET.protocol.point);
  const point = TICKET.points[index];
  const number = index + 1;
  const fragment = fragmentLabel(fragmentOf(point.quote));
  const seed = seedFrom(SEED, point.id, 'protocol');
  return (
    <div className="sf-sheet lp-tk-proto">
      <p className="lp-tk-sh">{TICKET_COPY.protocol}</p>
      <div className="lp-tk-ppt" data-point={point.id}>
        <span className="lp-tk-m">
          <Mark kind="tick" seed={seed} />
        </span>
        <span className="lp-tk-n" aria-hidden="true">{number}</span>
        <div className="lp-tk-pbody">
          <p className="lp-tk-ptitle">
            <span className="sr-only">{`Пункт ${number}: `}</span>
            {point.title}
          </p>
          <p className="lp-tk-pst">
            {`${TICKET_COPY.covered} · `}
            <span className="sf-pnote">{fragment}</span>
          </p>
          <p className="lp-tk-q2" data-line="you">
            <span className="lp-tk-q2-label">Вы:</span>{' '}
            «{underlined(TICKET.protocol.said, TICKET.protocol.shared, seed + 17)}»
          </p>
          <p className="lp-tk-q2" data-line="lecture">
            <span className="lp-tk-q2-label">{`Лекция, ${fragment}:`}</span>{' '}
            «{underlined(cutQuote(point.quote), TICKET.protocol.shared, seed + 31)}»
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * «Ответ на билет»: one question of a ticket on the landing's lecture, in the app's own forms. The
 * card, then the answer sheet: four rows named during the answer, one closed with the brace of the
 * examiner's question; the question beside it; then one point of the protocol. Static: the only
 * motion is the brace, drawn once when its row comes into view.
 */
export default function TicketAnswer() {
  const reduced = usePrefersReducedMotion();
  const askedRef = useRef<HTMLLIElement>(null);
  const brace = useBraceDraw(askedRef, reduced);
  return (
    <div className="lp-tk">
      <h2 id="ticket-heading" className="lp-h2">{TICKET_COPY.heading}</h2>
      <p className="lp-lead lp-tk-lead">{TICKET_COPY.lead}</p>
      <figure className="lp-tk-ex">
        <div className="sf-index-card lp-tk-card">
          <p className="lp-tk-no">
            <b>{TICKET_COPY.ticket.strong}</b>
            {TICKET_COPY.ticket.rest}
          </p>
          <h3 className="lp-tk-question">{TICKET.question}</h3>
        </div>
        <div className="sf-sheet lp-tk-sheet">
          <p className="lp-tk-sh">{TICKET_COPY.during}</p>
          <ol className="lp-tk-pts" aria-label="Пункты эталона">
            {TICKET.points.map((point, index) => {
              const asked = point.id === TICKET.examiner.point;
              return (
                <SheetRow
                  key={point.id}
                  point={point}
                  number={index + 1}
                  asked={asked}
                  brace={brace}
                  rowRef={asked ? askedRef : undefined}
                />
              );
            })}
          </ol>
        </div>
        <div className="lp-tk-side">
          <div className="lp-tk-examiner">
            <p className="lp-tk-who">{TICKET_COPY.examiner}</p>
            <p className="lp-tk-ask">«{TICKET.examiner.question}»</p>
          </div>
          <ProtocolPoint />
        </div>
        <figcaption className="lp-tk-cap">{TICKET_COPY.caption}</figcaption>
      </figure>
    </div>
  );
}
