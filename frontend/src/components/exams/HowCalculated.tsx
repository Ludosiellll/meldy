import type { ReactNode } from 'react';
import type { LayoutShares, ShareResult } from '../../lib/exams/ticketMath';
import { pluralRu } from '../conversation/visuals';
import { NBSP } from './sheetModel';

const GROUP_WORDS: Record<number, string> = { 2: 'пар', 3: 'троек', 4: 'четвёрок' };

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

function RandomFormulas({ share, extraLabel }: { share: Extract<ShareResult, { mode: 'random' }>; extraLabel?: string }) {
  const { q, n, k, all, none } = share;
  if (q <= 1) {
    return (
      <>
        <Formula label={`${k} из ${n}, примерно ${percentOf(k, n)}`}>
          {extraLabel && <span className="ex-w">{extraLabel}</span>}
          <Frac top={number(k)} bottom={number(n)} />
          <span className="ex-op" data-approx="">{approxSign(k, n)}</span>
          <span className="ex-res">{percentOf(k, n)}</span>
        </Formula>
        {!extraLabel && (
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
      <Formula label={`Сочетания из ${k} по ${q}, делённые на сочетания из ${n} по ${q}: ${all.num} из ${all.den}, примерно ${percentOf(all.num, all.den)}`}>
        {extraLabel && <span className="ex-w">{extraLabel}</span>}
        <Frac top={<Comb q={q} n={k} />} bottom={<Comb q={q} n={n} />} />
        <span className="ex-op">=</span>
        <Frac top={number(all.num)} bottom={number(all.den)} />
        <span className="ex-op" data-approx="">{approxSign(all.num, all.den)}</span>
        <span className="ex-res">{percentOf(all.num, all.den)}</span>
      </Formula>
      {!extraLabel && (
        <>
          <Formula small label={`Хотя бы один: 1 минус ${none.num} из ${none.den}, примерно ${percentOf(none.den - none.num, none.den)}`}>
            <span className="ex-w">хотя бы один:</span>
            <span>1</span>
            <span className="ex-op">−</span>
            <Frac top={number(none.num)} bottom={number(none.den)} />
            <span className="ex-op" data-approx="">{approxSign(none.den - none.num, none.den)}</span>
            <span className="ex-res">{percentOf(none.den - none.num, none.den)}</span>
          </Formula>
          <p className="ex-fine">
            {number(all.num)} — столько {groups} можно составить из {k} {genitive(k, 'вопроса', 'вопросов')}, которые есть в
            лекциях; {number(all.den)} — из всех {n}; {number(none.num)} — из {rest} {genitive(rest, 'остального', 'остальных')}.
          </p>
        </>
      )}
    </>
  );
}

function SectionsFormulas({ share }: { share: Extract<ShareResult, { mode: 'sections' }> }) {
  const parts = share.sections;
  const product = (pick: (part: { n: number; k: number }) => number) =>
    parts.map((part, index) => (
      <span key={part.section} className="ex-comb">
        {index > 0 && <span className="ex-op">×</span>}
        <Frac top={pick(part)} bottom={part.n} />
      </span>
    ));
  return (
    <>
      <Formula label={`Произведение долей разделов: ${share.all.num} из ${share.all.den}, примерно ${percentOf(share.all.num, share.all.den)}`}>
        {product((part) => part.k)}
        <span className="ex-op" data-approx="">{approxSign(share.all.num, share.all.den)}</span>
        <span className="ex-res">{percentOf(share.all.num, share.all.den)}</span>
      </Formula>
      <Formula small label={`Хотя бы один: примерно ${percentOf(share.atLeastOne.num, share.atLeastOne.den)}`}>
        <span className="ex-w">хотя бы один:</span>
        <span>1</span>
        <span className="ex-op">−</span>
        {product((part) => part.n - part.k)}
        <span className="ex-op" data-approx="">{approxSign(share.atLeastOne.num, share.atLeastOne.den)}</span>
        <span className="ex-res">{percentOf(share.atLeastOne.num, share.atLeastOne.den)}</span>
      </Formula>
      <p className="ex-fine">
        Из каждого раздела берётся один случайный вопрос.{' '}
        {parts.map((part, index) => `${index > 0 ? '; ' : ''}в разделе ${part.section} в лекциях есть ${part.k} из ${part.n}`).join('')}.
      </p>
    </>
  );
}

function FixedFormulas({ share }: { share: Extract<ShareResult, { mode: 'fixed' }> }) {
  return (
    <>
      <p className="ex-stmt">
        <b>{share.allCount}</b> из {share.tickets} {pluralRu(share.tickets, ['билета', 'билетов', 'билетов'])} — все вопросы есть в
        лекциях; хотя бы один — <b>{share.anyCount}</b> из {share.tickets}.
      </p>
      <p className="ex-fine">Считаем по списку билетов кафедры: каждый билет проверяется целиком, без случайных пар.</p>
    </>
  );
}

function sharesFormulas(result: ShareResult, extraLabel?: string): ReactNode {
  if (!result.ok) return <p className="ex-fine">{result.reason}</p>;
  if (result.mode === 'random') return <RandomFormulas share={result} extraLabel={extraLabel} />;
  if (result.mode === 'sections') return <SectionsFormulas share={result} />;
  return <FixedFormulas share={result} />;
}

interface HowCalculatedProps {
  shares: LayoutShares;
  open: boolean;
  onToggle: () => void;
  id: string;
  /** A sentence in front of the link, on one line with it (the compact column on phones). */
  lead?: ReactNode;
}

/**
 * «Как считается»: the exact formula behind the ticket share (C²₂₄ / C²₄₀ = 276 / 780 ≈ 35 %), the
 * product for one question per section, a direct count for known tickets, and the upper bound
 * when some questions were checked only by words.
 */
export default function HowCalculated({ shares, open, onToggle, id, lead }: HowCalculatedProps) {
  const high = shares.isRange && shares.high.ok && shares.high.mode === 'random' ? shares.high : null;
  const toggle = (
    <button type="button" className="sf-link" aria-expanded={open} aria-controls={id} onClick={onToggle}>
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
      {open && (
        <div className="ex-calc" id={id}>
          {shares.fallbackReason && <p className="ex-fine">{shares.fallbackReason} Поэтому считаем как для случайных билетов.</p>}
          {sharesFormulas(shares.low)}
          {high && (
            <>
              <p className="ex-fine" style={{ marginTop: 14 }}>
                Если вопросы, проверенные только по словам, тоже есть в лекциях:
              </p>
              {sharesFormulas(high, 'не больше')}
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
