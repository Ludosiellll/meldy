/**
 * Chapters «Билет вслух» and «Шпаргалка»: ticket 7 answered aloud — the answer's points light up as they are named,
 * the examiner asks about the missed one, the protocol line; then question 7's lines on the cheat sheet, half-gone
 * after Monday and gone after Wednesday (named on two different days). Points: data/sheetExample.ts Q7.
 */
import { useRef } from 'react';
import { Q7 } from '../../../data/sheetExample';
import { flag, put, useEls, useFrame } from '../../reel/engine';
import { EXAMPLE, SAY } from '../../home3/copy3';
import { Count, Say, Wave, appear, ease, seg } from '../kit3';
import { withGlyphs } from '../../home3/glyphs';

const SPOKEN =
  'Выручка — это цена, умноженная на количество. Если спрос эластичный, при снижении цены выручка растёт. При единичной эластичности она не меняется.';
/** When each point is named: 1, 2 and 4 in the answer, 3 after the examiner's question. */
const NAMED = [1700, 2700, 3600, 6150];

export function TicketScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    appear(one('ticket'), l, 100, 450, 18);
    appear(one('live'), l, 600, 380, 10, 4150);
    const shown = Math.round(SPOKEN.length * ease.linear(seg(l, 900, 3100)));
    const live = one('text');
    const text = SPOKEN.slice(0, shown);
    if (live && live.textContent !== text) live.textContent = text;
    all('pt').forEach((pt, index) => {
      appear(pt, l, 900 + index * 120, 380, 8);
      flag(pt, index === 2 ? 'is-after' : 'is-ok', l >= NAMED[index]);
    });
    appear(one('ask'), l, 4420, 420, 14, 6650);
    appear(one('proto'), l, 6920, 420, 10);
  });
  return (
    <div ref={root} className="r3-scene">
      <Say text={SAY.ticket[0]} at={300} until={4000} />
      <Say text={SAY.ticket[1]} at={4300} />
      <div className="r3-ui">
        <div data-a="ticket" className="r3-card r3-ticket" style={{ opacity: 0 }}>
          <span className="r3-flag r3-flag--y">Билет 7</span>
          <p className="r3-stem">{EXAMPLE.question}</p>
        </div>
        <div data-a="live" className="r3-card r3-live" style={{ opacity: 0 }}>
          <span className="r3-mic r3-mic--s">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </span>
          <Wave at={900} until={4000} bars={10} className="r3-wave--s" />
          <p data-a="text" className="r3-live-t" />
        </div>
        <div data-a="ask" className="r3-ask" style={{ opacity: 0 }}>
          <b>Экзаменатор</b>
          {EXAMPLE.examinerAsk}
          <Wave at={5000} until={6300} bars={10} className="r3-wave--ask" />
        </div>
        <div data-a="proto" className="r3-proto" style={{ opacity: 0 }}>
          <i />
          {EXAMPLE.protocol}
        </div>
        <div className="r3-pts">
          {Q7.lines.map((line) => (
            <p key={line.text} data-a="pt" className="r3-pt" style={{ opacity: 0 }}>
              <i />
              {withGlyphs(line.text)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The sheet's map: one square a line; a few change on Monday and on Wednesday. */
const MAP = Array.from({ length: 96 }, (_, i) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  const r = x - Math.floor(x);
  return r < 0.45 ? 'gone' : r < 0.6 ? 'once' : 'fresh';
});
const MONDAY = 1200;
const WEDNESDAY = 3200;

export function SheetScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    appear(one('card'), l, 100, 450, 20);
    const lines = all('line');
    lines.forEach((line, index) => {
      appear(line, l, 400 + index * 110, 360, 8);
      const once = index < 2 ? l >= MONDAY && l < WEDNESDAY : index === 3 && l >= WEDNESDAY;
      const gone = index < 2 && l >= WEDNESDAY;
      flag(line, 'is-once', once);
      flag(line, 'is-gone', gone);
    });
    all('strike').forEach((strike, index) => {
      put(strike, 'transform', `scaleX(${index < 2 ? ease.inOut(seg(l, WEDNESDAY, 420)).toFixed(3) : '0'})`);
    });
    flag(one('date'), 'is-later', l >= WEDNESDAY - 700);
    all('cell').forEach((cell, index) => {
      if (index % 9 === 4) flag(cell, 'is-once', l >= MONDAY && l < WEDNESDAY);
      if (index % 9 === 4) flag(cell, 'is-gone', l >= WEDNESDAY);
    });
  });
  return (
    <div ref={root} className="r3-scene is-flip">
      <Say text={SAY.sheet[0]} at={300} />
      <div className="r3-ui">
        <div data-a="card" className="r3-card r3-sheet" style={{ opacity: 0 }}>
          <div className="r3-sheet-top">
            <span className="r3-flag r3-flag--p">Шпаргалка</span>
            <span data-a="date" className="r3-meta r3-two">
              <span>Пн, 20 октября</span>
              <span>Ср, 22 октября</span>
            </span>
          </div>
          <p className="r3-sheet-count">
            <b>
              <Count from={741} to={739} at={WEDNESDAY + 100} dur={260} />
            </b>
            <span>из 898 осталось</span>
          </p>
          <span className="r3-map" aria-hidden="true">
            {MAP.map((state, index) => (
              <i key={index} data-a="cell" className={`is-${state}`} />
            ))}
          </span>
          <p className="r3-sheet-q">7. {EXAMPLE.question}</p>
          {Q7.lines.map((line) => (
            <p key={line.text} data-a="line" className="r3-sl" style={{ opacity: 0 }}>
              <i />
              <span>
                {withGlyphs(line.text)}
                <b data-a="strike" className="r3-strike" />
              </span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
