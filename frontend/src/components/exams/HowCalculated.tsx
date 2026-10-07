import type { ReactNode } from 'react';
import type { FixedShare, LayoutShares, RandomShare, SectionsShare, ShareResult } from '../../lib/exams/ticketMath';
import { pluralRu } from '../conversation/visuals';
import { NBSP } from './sheetModel';

const GROUP_WORDS: Record<number, string> = { 2: 'пар', 3: 'троек', 4: 'четвёрок' };

/** Which bound a block of formulas is: the shares as marked, or the upper bound with unknown questions counted in. */
type Bound = 'marked' | 'upper';

function number(value: number): string {
  return value.toLocaleString('ru-RU').replace(/\s/g, NBSP);
}

/** «≈» unless the share is a whole percent exactly. */
function approxSign(num: number, den: number): '=' | '≈' {
  return den > 0 && (num * 100) % den === 0 ? '=' : '≈';
}

function percentOf(num: number, den: number): string {
  return `${den > 0 ? Math.round((num / den) * 100) : 0}${NBSP}%`;
}

function genitive(count: number, singular: string, plural: string): string {
  return count % 10 === 1 && count % 100 !== 11 ? singular : plural;
}

/** «7, 9 и 5». */
function listWords(items: Array<string | number>): string {
  const words = items.map(String);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} и ${words[words.length - 1]}`;
}

/** C with the ticket size above and the pool size below: C²₂₄ (spec 2.2 #11). */
function Comb({ q, n }: { q: number; n: number }) {
  return (
    <span className="ex-comb" aria-label={`число сочетаний из ${n} по ${q}`}>
      C
      <span className="ex-ix" aria-hidden="true">
        <span>{q}</span>
        <span>{n}</span>
      </span>
    </span>
  );
}

function Frac({ top, bottom, label }: { top: ReactNode; bottom: ReactNode; label?: string }) {
  return (
    <span className="ex-frac" aria-label={label}>
      <span>{top}</span>
      <span>{bottom}</span>
    </span>
  );
}

function Formula({ children, small = false, label }: { children: ReactNode; small?: boolean; label: string }) {
  return (
    <p className="ex-formula" data-small={small ? '' : undefined} role="math" aria-label={label}>
      {children}
    </p>
  );
}

/** The words in front of the formula of tickets without «есть»; «частично» counts as «нет» there. */
const NONE_WORDS = 'ни одного с отметкой «есть»:';
const PARTIAL_AS_NO = 'вопросы «частично» здесь считаются как «нет»';

function RandomFormulas({ share, bound }: { share: RandomShare; bound: Bound }) {
  const { q, n, k, all, none } = share;
  const upper = bound === 'upper';
  if (q <= 1) {
    return (
      <>
        <Formula label={`${upper ? 'Не больше: ' : ''}${k} из ${n}, примерно ${percentOf(k, n)}`}>
          {upper && <span className="ex-w">не больше</span>}
          <Frac top={number(k)} bottom={number(n)} />
          <span className="ex-op" data-approx="">{approxSign(k, n)}</span>
          <span className="ex-res">{percentOf(k, n)}</span>
        </Formula>
        {!upper && (
          <p className="ex-fine">
            Билет — один вопрос, поэтому доля билетов та же, что и доля вопросов: {k} из {n}.
          </p>
        )}
      </>
    );
  }
  const rest = n - k;
  const groups = GROUP_WORDS[q] ?? 'наборов';
  return (
    <>
      <Formula
        label={`${upper ? 'Не больше: с' : 'С'}очетания из ${k} по ${q}, делённые на сочетания из ${n} по ${q}: ${all.num} из ${all.den}, примерно ${percentOf(all.num, all.den)}`}
      >
        {upper && <span className="ex-w">не больше</span>}
        <Frac top={<Comb q={q} n={k} />} bottom={<Comb q={q} n={n} />} />
        <span className="ex-op">=</span>
        <Frac top={number(all.num)} bottom={number(all.den)} />
        <span className="ex-op" data-approx="">{approxSign(all.num, all.den)}</span>
        <span className="ex-res">{percentOf(all.num, all.den)}</span>
      </Formula>
      <Formula
        small
        label={`Ни одного вопроса с отметкой «есть»: ${upper ? 'не меньше: ' : ''}сочетания из ${rest} по ${q}, делённые на сочетания из ${n} по ${q}: ${none.num} из ${none.den}, примерно ${percentOf(none.num, none.den)}`}
      >
        <span className="ex-w">{NONE_WORDS}</span>
        {upper && <span className="ex-w">не меньше</span>}
        <Frac top={<Comb q={q} n={rest} />} bottom={<Comb q={q} n={n} />} />
        <span className="ex-op">=</span>
        <Frac top={number(none.num)} bottom={number(none.den)} />
        <span className="ex-op" data-approx="">{approxSign(none.num, none.den)}</span>
        <span className="ex-res">{percentOf(none.num, none.den)}</span>
      </Formula>
      {!upper && (
        <p className="ex-fine">
          {number(all.num)} — столько {groups} можно составить из {k} {genitive(k, 'вопроса', 'вопросов')}, которые есть в
          лекциях; {number(all.den)} — из всех {n}; {number(none.num)} — из {rest} {genitive(rest, 'остального', 'остальных')}: {PARTIAL_AS_NO}.
        </p>
      )}
    </>
  );
}

function SectionsFormulas({ share, bound }: { share: SectionsShare; bound: Bound }) {
  const parts = share.sections;
  const upper = bound === 'upper';
  const product = (pick: (part: { n: number; k: number }) => number) =>
    parts.map((part, index) => (
      <span key={part.section} className="ex-comb">
        {index > 0 && <span className="ex-op">×</span>}
        <Frac top={pick(part)} bottom={part.n} />
      </span>
    ));
  return (
    <>
      <Formula
        label={`${upper ? 'Не больше: п' : 'П'}роизведение долей разделов: ${share.all.num} из ${share.all.den}, примерно ${percentOf(share.all.num, share.all.den)}`}
      >
        {upper && <span className="ex-w">не больше</span>}
        {product((part) => part.k)}
        <span className="ex-op" data-approx="">{approxSign(share.all.num, share.all.den)}</span>
        <span className="ex-res">{percentOf(share.all.num, share.all.den)}</span>
      </Formula>
      <Formula
        small
        label={`Ни одного вопроса с отметкой «есть»: ${upper ? 'не меньше: ' : ''}произведение долей остальных вопросов разделов: ${share.none.num} из ${share.none.den}, примерно ${percentOf(share.none.num, share.none.den)}`}
      >
        <span className="ex-w">{NONE_WORDS}</span>
        {upper && <span className="ex-w">не меньше</span>}
        {product((part) => part.n - part.k)}
        <span className="ex-op" data-approx="">{approxSign(share.none.num, share.none.den)}</span>
        <span className="ex-res">{percentOf(share.none.num, share.none.den)}</span>
      </Formula>
      {!upper && (
        <p className="ex-fine">
          Из каждого раздела берётся один случайный вопрос.{' '}
          {parts.map((part, index) => (index === 0 ? `В разделе ${part.section} в лекциях есть ${part.k} из ${part.n}` : `, в разделе ${part.section} — ${part.k} из ${part.n}`)).join('')};{' '}
          {listWords(parts.map((part) => part.n - part.k))} — остальные вопросы этих разделов: {PARTIAL_AS_NO}.
        </p>
      )}
    </>
  );
}

function FixedFormulas({ share, bound }: { share: FixedShare; bound: Bound }) {
  const without = share.tickets - share.anyCount;
  const tickets = pluralRu(share.tickets, ['билета', 'билетов', 'билетов']);
  if (bound === 'upper') {
    return (
      <p className="ex-stmt">
        Не больше <b>{share.allCount}</b> из {share.tickets} {tickets} — все вопросы есть в лекциях; ни одного вопроса с отметкой «есть» — не
        меньше чем в <b>{without}</b> из {share.tickets}.
      </p>
    );
  }
  return (
    <>
      <p className="ex-stmt">
        <b>{share.allCount}</b> из {share.tickets} {tickets} — все вопросы есть в лекциях; ни одного вопроса с отметкой «есть» — в{' '}
        <b>{without}</b> из {share.tickets}.
      </p>
      <p className="ex-fine">Считаем по списку билетов кафедры: каждый билет проверяется целиком, без случайных пар. Вопросы «частично» здесь считаются как «нет».</p>
    </>
  );
}

function sharesFormulas(result: ShareResult, bound: Bound): ReactNode {
  if (!result.ok) return <p className="ex-fine">{result.reason}</p>;
  if (result.mode === 'random') return <RandomFormulas share={result} bound={bound} />;
  if (result.mode === 'sections') return <SectionsFormulas share={result} bound={bound} />;
  return <FixedFormulas share={result} bound={bound} />;
}

/** «Если вопросы, проверенные только по словам, тоже есть в лекциях:» (and the questions not checked yet). */
export function upperBoundLead(unknown?: { unverified: number; unmapped: number }): string {
  const onlyUnmapped = unknown && unknown.unverified === 0 && unknown.unmapped > 0;
  const both = unknown && unknown.unverified > 0 && unknown.unmapped > 0;
  if (onlyUnmapped) return 'Если ещё не сверенные вопросы тоже есть в лекциях:';
  if (both) return 'Если вопросы, проверенные только по словам, и ещё не сверенные тоже есть в лекциях:';
  return 'Если вопросы, проверенные только по словам, тоже есть в лекциях:';
}

interface HowCalculatedProps {
  shares: LayoutShares;
  open: boolean;
  onToggle: () => void;
  id: string;
  /** A sentence in front of the link, on one line with it (the compact column on phones). */
  lead?: ReactNode;
  /** Right under the link, open or closed (the formula opens below it): the action line of peak 1. */
  after?: ReactNode;
  /** The full assumption as the first line of the formula (the low window shows the short caveat). */
  assumption?: string;
  /** What is still unknown, for the words of the upper bound. */
  unknown?: { unverified: number; unmapped: number };
}

/**
 * «Как считается»: the exact formula behind the ticket share (C²₂₄ / C²₄₀ = 276 / 780 ≈ 35 %) and
 * behind «ни одного вопроса с отметкой «есть»» (C²₁₆ / C²₄₀ = 120 / 780 ≈ 15 %, «частично» counted
 * as «нет»), the product for one question per section, a direct count for known tickets, and the
 * upper bound when some questions were checked only by words or are not checked yet.
 */
export default function HowCalculated({ shares, open, onToggle, id, lead, after, assumption, unknown }: HowCalculatedProps) {
  const high = shares.isRange && shares.high.ok ? shares.high : null;
  // aria-controls only while the formula is there: collapsed, it is not rendered (QA 2026-10-07).
  const toggle = (
    <button type="button" className="sf-link" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
      Как считается
    </button>
  );
  return (
    <div className="ex-how">
      {lead ? (
        // Phones: one line «Это доля билетов, а не вероятность сдать. Как считается» (redesign critique 10).
        <p className="ex-caveat" data-inline="">
          {lead} {toggle}
        </p>
      ) : (
        toggle
      )}
      {after}
      {open && (
        <div className="ex-calc" id={id}>
          {assumption && <p className="ex-fine ex-calc-assume">{assumption}</p>}
          {shares.fallbackReason && <p className="ex-fine">{shares.fallbackReason} Поэтому считаем как для случайных билетов.</p>}
          {sharesFormulas(shares.low, 'marked')}
          {high && (
            <>
              <p className="ex-fine" style={{ marginTop: 14 }}>
                {upperBoundLead(unknown)}
              </p>
              {sharesFormulas(high, 'upper')}
            </>
          )}
          {shares.low.ok && shares.low.mode === 'random' && shares.low.q > 1 && (
            <p className="ex-fine">Вопросы в билете считаем разными и случайными: так устроен список, когда билеты неизвестны.</p>
          )}
        </div>
      )}
    </div>
  );
}
