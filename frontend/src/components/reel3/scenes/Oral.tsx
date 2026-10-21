/**
 * Chapter «Билет вслух»: ticket 7 answered aloud — the answer's points light up as they are named, the examiner asks
 * about the missed one, the protocol line. Points: data/ticketExample.ts Q7. (What is left to learn follows in
 * Learn.tsx.)
 */
import { useRef } from 'react';
import { Q7 } from '../../../data/ticketExample';
import { flag, useEls, useFrame } from '../../reel/engine';
import { EXAMPLE, SAY } from '../../home3/copy3';
import { Say, Wave, appear, ease, seg } from '../kit3';
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
          {Q7.points.map((point) => (
            <p key={point.text} data-a="pt" className="r3-pt" style={{ opacity: 0 }}>
              <i />
              {withGlyphs(point.text)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
