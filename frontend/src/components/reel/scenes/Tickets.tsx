import { useRef } from 'react';
import { SHEET_ROWS, SHEET_TOTALS, TICKET } from '../content';
import { blur, opacity, put, text, useEls, useFrame } from '../engine';
import { Counter, Cursor, Kinetic, Pill, Status, TypeLabel } from '../parts';
import { clamp, ease, mix, pulse, seg } from '../timeline';

const ROW_H = 64;
const VIEW_H = 512;
const MAX_SCROLL = SHEET_ROWS.length * ROW_H - VIEW_H;
const SCROLL_AT = 1150;
const SCROLL_DUR = 1300;

function scrollAt(l: number) {
  return MAX_SCROLL * ease.inOut(seg(l, SCROLL_AT, SCROLL_DUR));
}

/** When the list scroll first shows row `index` near the bottom of the sheet. */
function inView(index: number) {
  const need = index * ROW_H - (VIEW_H - ROW_H - 40);
  if (need <= 0) return 0;
  let lo = SCROLL_AT;
  let hi = SCROLL_AT + SCROLL_DUR;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (scrollAt(mid) < need) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Each row's mark appears when the row is in view: the first ones in turn, then with the scroll. */
export const MARK_AT = SHEET_ROWS.map((_, index) => Math.max(880 + Math.min(index, 7) * 48, inView(index) + 30));

/** How many rows of a status are marked at scene time `l` (smooth, for the rolling counter). */
function marked(l: number, status?: string) {
  let sum = 0;
  SHEET_ROWS.forEach((row, index) => {
    if (!status || row.status === status) sum += clamp((l - MARK_AT[index]) / 140);
  });
  return sum;
}

const CLICK = 3280;
export const TICKETS_CURSOR = [
  { at: 2500, x: 1990, y: 1160 },
  { at: 3150, x: 1612, y: 884 },
  { at: 3700, x: 1640, y: 900 },
];

/**
 * 5 · Chapter 01, «Билеты». The exam list lands as a sheet and every question gets its mark
 * against the student's lectures while the counter runs to 24 of 40; then a ticket is drawn.
 */
export default function Tickets() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);

  useFrame((l) => {
    opacity(root.current, seg(l, 40, 280));
    const cam = one('cam');
    const enter = ease.brand(seg(l, 0, 420));
    const push = mix(1, 1.03, ease.sine(seg(l, 400, 4300)));
    put(cam, 'transform', `scale(${(mix(1.12, 1, enter) * push).toFixed(4)})`);
    blur(cam, (1 - enter) * 12);
    opacity(cam, seg(l, 0, 260));

    // The sheet swings in from the right in perspective and keeps a slight angle.
    const sheet = one('sheet');
    const swing = (at: number) => ease.brand(seg(at, 150, 1000));
    const p = swing(l);
    const speed = Math.abs(p - swing(l - 16)) * 520;
    const sway = Math.sin(l / 1300) * 0.8;
    put(
      sheet,
      'transform',
      `translate3d(${mix(560, 0, p).toFixed(1)}px,${mix(50, 0, p).toFixed(1)}px,0) rotateY(${(mix(-44, -8, p) + sway).toFixed(2)}deg) rotateX(${mix(9, 2.5, p).toFixed(2)}deg)`,
    );
    opacity(sheet, seg(l, 150, 220));
    blur(sheet, Math.min(12, speed * 0.5));

    // The list scrolls under the marks.
    const scroll = scrollAt(l);
    const scrollSpeed = Math.abs(scroll - scrollAt(l - 16));
    const list = one('list');
    put(list, 'transform', `translate3d(0,${(-scroll).toFixed(1)}px,0)`);
    blur(list, Math.min(3.5, scrollSpeed * 0.08));
    all('st').forEach((chip, index) => {
      const q = seg(l, MARK_AT[index], 300);
      put(chip, 'transform', `scale(${(q <= 0 ? 0.4 : ease.back(q)).toFixed(3)})`);
      opacity(chip, clamp(q * 3));
    });
    const counts = { ok: marked(l, 'ok'), half: marked(l, 'half'), no: marked(l, 'no') };
    text(one('n-ok'), String(Math.round(counts.ok)));
    text(one('n-half'), String(Math.round(counts.half)));
    text(one('n-no'), String(Math.round(counts.no)));

    // The pill is hovered, pressed, and a ticket flies out of it to the middle of the stage.
    const pill = one('pill');
    const hover = ease.brand(seg(l, 3020, 300));
    const press = pulse(l, CLICK - 60, 260);
    put(pill, 'transform', `scale(${(1 - 0.05 * press).toFixed(3)})`);
    put(one('pill-dot'), 'transform', `translate3d(${(6 * hover).toFixed(2)}px,0,0)`);
    const veil = one('veil');
    opacity(veil, ease.inOut(seg(l, CLICK + 40, 420)) * 0.82);
    const ticket = one('ticket');
    const draw = ease.brand(seg(l, CLICK + 40, 700));
    const rush = ease.in(seg(l, 4020, 400));
    const x = mix(1612 - 960, 0, draw);
    const y = mix(884 - 540, 0, draw);
    put(
      ticket,
      'transform',
      `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) perspective(1400px) rotateX(${mix(72, 0, draw).toFixed(2)}deg) rotate(${mix(0, -3, draw).toFixed(2)}deg) scale(${(mix(0.16, 1, draw) * mix(1, 2.6, rush)).toFixed(3)})`,
    );
    opacity(ticket, l >= CLICK + 40 ? clamp(seg(l, CLICK + 40, 120)) * (1 - seg(l, 4300, 140)) : 0);
    blur(ticket, rush * 18);
  });

  return (
    <div ref={root} className="mr-scene mr-bg-light">
      <div data-a="cam" className="mr-layer">
        <div className="mr-abs" style={{ left: 154, top: 236 }}>
          <TypeLabel text="Билеты" at={280} />
        </div>
        <div className="mr-tk-count">
          <Counter from={0} to={SHEET_TOTALS.ok} at={0} dur={1} value={(l) => marked(l, 'ok')} />
        </div>
        <div className="mr-tk-of">
          <Kinetic text={`из ${SHEET_ROWS.length} вопросов`} at={1150} unit="letter" variant="drop" stagger={26} dur={620} />
        </div>
        <div className="mr-tk-in">
          <Kinetic text="уже есть в твоих лекциях." at={1700} stagger={95} accentFrom={2} />
        </div>

        <div className="mr-persp">
          <div data-a="sheet" className="mr-card mr-sheet">
            <div className="mr-sheet-h">
              <b>Микроэкономика</b>
              <span>{SHEET_ROWS.length} вопросов · 12 лекций</span>
            </div>
            <div className="mr-sheet-view">
              <div data-a="list" className="mr-sheet-list">
                {SHEET_ROWS.map((row, index) => (
                  <div key={row.title} className="mr-row">
                    <span className="mr-num">{index + 1}</span>
                    <span className="mr-row-t">{row.title}</span>
                    <Status kind={row.status} name="st" />
                  </div>
                ))}
              </div>
            </div>
            <div className="mr-sheet-foot">
              <span className="mr-st mr-st--ok">
                <i />
                есть <b data-a="n-ok">0</b>
              </span>
              <span className="mr-st mr-st--half">
                <i />
                частично <b data-a="n-half">0</b>
              </span>
              <span className="mr-st mr-st--no">
                <i />
                нет <b data-a="n-no">0</b>
              </span>
              <Pill name="pill">Тянуть билет</Pill>
            </div>
          </div>
        </div>

        <div data-a="veil" className="mr-veil" />
        <div data-a="ticket" className="mr-ticket">
          <b>{TICKET.name}</b>
          <p>{TICKET.question}</p>
          <small>{TICKET.subject} · 3 вопроса</small>
        </div>
        <Cursor keys={TICKETS_CURSOR} clicks={[CLICK]} from={2500} to={3900} />
      </div>
    </div>
  );
}
