import { useMemo, useRef } from 'react';
import { REVIEW_COLUMNS } from '../content';
import { blur, opacity, put, useEls, useFrame } from '../engine';
import { Kinetic, TypeLabel } from '../parts';
import { clamp, ease, mix, rng, seg } from '../timeline';

const COLS_LEFT = 150;
const COLS_TOP = 330;
const COL_STEP = 413;
const COL_W = 380;

/** The month under the columns: today is the 12th; the columns are days 12, 13, 15 and 19. */
const TODAY = 11;
const COLUMN_DAYS = [11, 12, 14, 18];
const MONTH = { left: 330, top: 210, cell: 168, row: 128.8, gap: 14 };
const cellRect = (index: number) => ({
  x: MONTH.left + (index % 7) * (MONTH.cell + MONTH.gap),
  y: MONTH.top + Math.floor(index / 7) * (MONTH.row + MONTH.gap),
});

/** Where the missed point of the previous scene was (its row on the answer sheet). */
const FROM = { x: 1510, y: 447 };

const BAR_COLORS = ['#2869DD', '#F4C45B', '#8ACB97', '#A9C8F7', '#F3A9C4'];

/**
 * 7 · Chapter 03, «Повторение». The missed point lands as a card for tomorrow; cards fill the days
 * they come back on; the week shrinks into the month, and the month flies off into the dark.
 */
export default function Review() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const days = useMemo(() => {
    const random = rng(71);
    return Array.from({ length: 35 }, (_, index) => {
      const column = COLUMN_DAYS.indexOf(index);
      const count = column >= 0 ? REVIEW_COLUMNS[column].cards.length : index < TODAY ? 0 : Math.floor(random() * 3.2);
      return {
        label: index < 31 ? String(index + 1) : String(index - 30),
        bars: Array.from({ length: Math.min(3, count) }, () => BAR_COLORS[Math.floor(random() * BAR_COLORS.length)]),
        dim: index >= 31,
      };
    });
  }, []);

  useFrame((l) => {
    opacity(one('bg'), seg(l, 100, 260));

    const head = one('head');
    const leave = ease.in(seg(l, 2420, 360));
    put(head, 'transform', `translate3d(0,${(-30 * leave).toFixed(1)}px,0)`);
    blur(head, leave * 14);
    opacity(head, 1 - leave);

    // Columns rise in, then each flies into its day of the month and fades.
    const backs = all('colbg');
    const heads = all('colh');
    const contents = all('colc');
    all('col').forEach((col, index) => {
      const rise = ease.brand(seg(l, 300 + index * 80, 650));
      const shrink = ease.inOut(seg(l, 2520 + index * 50, 720));
      const target = cellRect(COLUMN_DAYS[index]);
      const colX = COLS_LEFT + index * COL_STEP;
      put(
        col,
        'transform',
        `translate3d(${((target.x - colX) * shrink).toFixed(1)}px,${((target.y - COLS_TOP) * shrink).toFixed(1)}px,0) scale(${mix(1, MONTH.cell / COL_W, shrink).toFixed(4)})`,
      );
      opacity(col, 1 - seg(l, 2980 + index * 50, 260));
      opacity(contents[index], 1 - seg(l, 2470 + index * 50, 260));
      // The column itself rises in; its cards arrive on their own.
      for (const part of [backs[index], heads[index]]) {
        put(part, 'transform', `translate3d(0,${mix(70, 0, rise).toFixed(1)}px,0)`);
        opacity(part, clamp(rise * 1.6) * (part === heads[index] ? 1 - seg(l, 2470 + index * 50, 260) : 1));
        blur(part, (1 - rise) * 10);
      }
    });
    all('mini').forEach((mini, index) => {
      const p = seg(l, 950 + index * 95, 440);
      const turn = index % 2 === 0 ? -5 : 4;
      put(mini, 'transform', `translate3d(0,${mix(-46, 0, ease.back(p)).toFixed(1)}px,0) rotate(${mix(turn, 0, ease.brand(p)).toFixed(2)}deg)`);
      opacity(mini, clamp(p * 3));
    });

    // The missed point flies in from the answer sheet and lands for tomorrow.
    const hot = one('hot');
    const col = all('col')[1];
    if (hot && col) {
      const p = ease.brand(seg(l, 40, 900));
      const finalX = COLS_LEFT + col.offsetLeft + hot.offsetLeft + hot.offsetWidth / 2;
      const finalY = COLS_TOP + col.offsetTop + hot.offsetTop + hot.offsetHeight / 2;
      const lift = Math.sin(Math.PI * p) * 70;
      put(
        hot,
        'transform',
        `translate3d(${((FROM.x - finalX) * (1 - p)).toFixed(1)}px,${((FROM.y - finalY) * (1 - p) - lift).toFixed(1)}px,0) rotate(${mix(-7, 0, p).toFixed(2)}deg) scale(${mix(1.12, 1, p).toFixed(3)})`,
      );
      const pulseRing = seg(l, 900, 700);
      put(hot, 'box-shadow', `0 0 0 ${(22 * pulseRing).toFixed(1)}px rgba(40,105,221,${(0.25 * (1 - pulseRing)).toFixed(3)}), 0 20px 40px -26px rgba(40,105,221,0.8)`);
      opacity(hot, l >= 40 ? 1 : 0);
    }

    // The month: days appear around today, then the whole month tilts and flies past the camera.
    all('day').forEach((day, index) => {
      const distance = Math.abs(Math.floor(index / 7) - Math.floor(TODAY / 7)) + Math.abs((index % 7) - (TODAY % 7));
      const isColumn = COLUMN_DAYS.includes(index);
      const at = isColumn ? 3000 + COLUMN_DAYS.indexOf(index) * 50 : 2720 + distance * 42;
      const p = seg(l, at, 380);
      put(day, 'transform', `scale(${mix(0.86, 1, ease.back(p)).toFixed(3)})`);
      opacity(day, clamp(p * 2.5));
    });
    const month = one('month');
    const fly = ease.in(seg(l, 3330, 980));
    put(
      month,
      'transform',
      `perspective(1800px) translate3d(0,${(-70 * fly).toFixed(1)}px,${(260 * fly).toFixed(1)}px) rotateX(${(56 * fly).toFixed(2)}deg) rotateZ(${(-24 * fly).toFixed(2)}deg) scale(${(1 + 0.9 * fly).toFixed(3)})`,
    );
    blur(month, Math.max(0, fly - 0.5) * 26);
    opacity(one('dark'), ease.inOut(seg(l, 3500, 650)));
  });

  let miniIndex = 0;
  return (
    <div ref={root} className="mr-scene">
      <div data-a="bg" className="mr-layer mr-bg-light" />
      <div data-a="dark" className="mr-layer mr-bg-dark" style={{ opacity: 0 }} />
      <div data-a="head" className="mr-layer">
        <div className="mr-label-at">
          <TypeLabel text="Повторение" at={320} />
        </div>
        <h3 className="mr-display mr-head">
          <Kinetic text="Повторяй то, что забываешь." at={460} unit="letter" variant="drop" stagger={20} dur={620} accentFrom={3} />
        </h3>
      </div>
      <div className="mr-cols">
        {REVIEW_COLUMNS.map((column, index) => (
          <div key={column.title} data-a="col" className={`mr-col${index === 0 ? ' mr-col--today' : ''}`} style={{ left: index * COL_STEP, transformOrigin: '0 0' }}>
            <div data-a="colbg" className="mr-col-bg" />
            <div data-a="colh" className="mr-col-h">
              <i>{column.cards.length}</i>
              {column.title}
            </div>
            <div data-a="colc" className="mr-col-cards">
            {column.cards.map((card) => {
              if (card.from) {
                return (
                  <div key={card.text} data-a="hot" className="mr-mini mr-mini--hot" style={{ zIndex: 2 }}>
                    {card.text}
                    <small>{card.from}</small>
                  </div>
                );
              }
              miniIndex += 1;
              return (
                <div key={card.text} data-a="mini" className="mr-mini" data-order={miniIndex}>
                  {card.text}
                  <small>Микроэкономика</small>
                </div>
              );
            })}
            </div>
          </div>
        ))}
      </div>
      <div data-a="month" className="mr-month">
        {days.map((day, index) => (
          <div key={index} data-a="day" className={`mr-day${index === TODAY ? ' mr-day--today' : ''}`} style={{ opacity: 0, color: day.dim ? '#B5B9BF' : undefined }}>
            {day.label}
            <div className="mr-day-bars">
              {day.bars.map((color, bar) => (
                <i key={bar} style={{ background: color, width: `${92 - bar * 18}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
