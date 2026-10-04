import { useMemo, useRef, type ReactElement } from 'react';
import { READY_NOTES, SHEET_TOTALS } from '../content';
import { blur, flag, opacity, put, text, useEls, useFrame } from '../engine';
import { drawBurst, drawDust, drawRing, makeBurst, makeDust } from '../particles';
import { Kinetic, ParticleCanvas } from '../parts';
import { clamp, ease, mix, rng, seg } from '../timeline';

const COLS = 8;
const ROWS = 5;
const LINE = 'M150 965 L420 880 L590 905 L820 762 L1000 792 L1230 604 L1410 640 L1640 420 L1770 300';
const LINE_AT = 3380;
const LINE_DUR = 760;

const NOTE_ICONS: Record<string, ReactElement> = {
  green: <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  blue: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <rect x="4" y="6" width="10" height="11" rx="2" />
      <path d="M7 3h9a2 2 0 0 1 2 2v9" strokeLinecap="round" />
    </g>
  ),
  yellow: <path d="M15 6H8a4 4 0 0 0 0 8h6M12 11l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  sky: <path d="M5 6h10M5 10h10M5 14h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
};

/**
 * 8 · Chapter 04, «Готовность». In the dark: «Не перечитывай — вспоминай.» Forty questions light up
 * as they are learned, the day's news floats around, and a glowing line climbs to the top.
 */
export default function Ready() {
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<SVGPathElement>(null);
  const { one, all } = useEls(root);
  const dust = useMemo(() => makeDust(81, 90, 1920, 1080), []);
  const burst = useMemo(() => makeBurst(82, { count: 60, colors: ['#F4C45B', '#A9C8F7', '#ffffff', '#2869DD'], near: 360, far: 940, dashes: 0.85, size: [2, 4.5] }), []);
  const tiles = useMemo(() => {
    const kinds: Array<'ok' | 'half' | 'none'> = [
      ...Array<'ok'>(SHEET_TOTALS.ok).fill('ok'),
      ...Array<'half'>(SHEET_TOTALS.half).fill('half'),
      ...Array<'none'>(SHEET_TOTALS.no).fill('none'),
    ];
    const random = rng(83);
    for (let i = kinds.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    return kinds;
  }, []);
  const head = { x: 150, y: 965 };

  useFrame((l) => {
    opacity(root.current, seg(l, 0, 380));

    const title = one('head');
    const up = ease.brand(seg(l, 1480, 620));
    put(title, 'transform', `translate3d(0,${(-262 * up).toFixed(1)}px,0) scale(${mix(1, 0.54, up).toFixed(4)})`);

    const dim = 1 - 0.84 * ease.inOut(seg(l, LINE_AT - 80, 320));
    // The grid of the exam's questions: outlines first, then the wave of learned ones.
    let ok = 0;
    let half = 0;
    all('tile').forEach((tile, index) => {
      const row = Math.floor(index / COLS);
      const col = index % COLS;
      const appear = seg(l, 1760 + (row + col) * 30, 320);
      const fillAt = 2330 + (row + col) * 52;
      const filled = l >= fillAt && tiles[index] !== 'none';
      if (filled && tiles[index] === 'ok') ok += 1;
      if (filled && tiles[index] === 'half') half += 1;
      flag(tile, 'is-ok', filled && tiles[index] === 'ok');
      flag(tile, 'is-half', filled && tiles[index] === 'half');
      const bounce = filled ? seg(l, fillAt, 420) : 0;
      const scale = appear < 1 ? mix(0.5, 1, ease.back(appear)) : 1 + 0.16 * Math.sin(Math.PI * bounce) * (1 - bounce);
      put(tile, 'transform', `scale(${scale.toFixed(3)})`);
      opacity(tile, clamp(appear * 2) * dim);
      const glow = filled ? 1 - seg(l, fillAt, 700) : 0;
      const color = tiles[index] === 'ok' ? '138,203,151' : '244,196,91';
      put(tile, 'box-shadow', glow > 0.01 ? `0 0 ${(40 * glow).toFixed(1)}px rgba(${color},${(0.75 * glow).toFixed(3)})` : 'none');
    });
    const legend = one('legend');
    opacity(legend, seg(l, 2300, 400) * dim);
    text(one('n-ok'), String(ok));
    text(one('n-half'), String(half));
    text(one('n-none'), String(SHEET_TOTALS.no));

    all('note').forEach((note, index) => {
      const spot = READY_NOTES[index];
      const p = seg(l, 2700 + index * 170, 700);
      const drift = Math.sin((l + index * 700) / 820) * 7;
      put(note, 'transform', `translate3d(${spot.x.toFixed(0)}px,${(spot.y + drift).toFixed(1)}px,0) translate(-50%,-50%) scale(${mix(0.6, 1, ease.spring(p)).toFixed(3)})`);
      opacity(note, clamp(p * 3) * dim);
      blur(note, (1 - ease.out(p)) * 8);
    });

    // The climbing line, its glow and its bright head.
    const draw = ease.inOut(seg(l, LINE_AT, LINE_DUR));
    for (const path of all('path')) put(path, 'stroke-dashoffset', (1 - draw).toFixed(4));
    const path = line.current;
    if (path && typeof path.getTotalLength === 'function') {
      try {
        const point = path.getPointAtLength(path.getTotalLength() * draw);
        head.x = point.x;
        head.y = point.y;
      } catch {
        // No geometry (tests): the head stays at the start.
      }
    }
    const dot = one('dot');
    const flash = ease.in(seg(l, 4180, 380));
    put(dot, 'transform', `translate3d(${head.x.toFixed(1)}px,${head.y.toFixed(1)}px,0) scale(${(1 + flash * 9).toFixed(3)})`);
    opacity(dot, draw > 0 ? 1 : 0);
    const label = one('label');
    put(label, 'transform', `translate3d(${(head.x - 250).toFixed(1)}px,${(head.y - 62).toFixed(1)}px,0)`);
    opacity(label, seg(l, LINE_AT + 420, 260) * (1 - seg(l, 4150, 150)));
  });

  const draw = (ctx: CanvasRenderingContext2D, l: number) => {
    drawDust(ctx, dust, l + 9000, 1920, 1080, '#ffffff', 0.85);
    drawRing(ctx, 960, 540, 40, 620, seg(l, 220, 1200), '#2869DD', 2.4, 0.7);
    drawRing(ctx, 960, 540, 40, 900, seg(l, 420, 1500), '#F4C45B', 1.6, 0.4);
    drawBurst(ctx, burst, 960, 540, l - 260, 1300);
  };

  return (
    <div ref={root} className="mr-scene mr-bg-dark mr-ready">
      <ParticleCanvas draw={draw} />
      <div data-a="head" className="mr-ready-head">
        <p className="mr-display">
          <Kinetic text="Не перечитывай —" at={330} stagger={170} dur={820} />
        </p>
        <p className="mr-display">
          <Kinetic text="вспоминай." at={760} stagger={120} dur={820} accentFrom={0} />
        </p>
      </div>
      <div className="mr-grid">
        {tiles.map((kind, index) => (
          <span key={index} data-a="tile" className="mr-tile" data-kind={kind} />
        ))}
      </div>
      <div data-a="legend" className="mr-legend">
        <span>
          <i style={{ background: 'var(--green)' }} />
          готово <b data-a="n-ok">0</b>
        </span>
        <span>
          <i style={{ background: 'var(--yellow)' }} />
          почти <b data-a="n-half">0</b>
        </span>
        <span>
          <i style={{ border: '2px solid rgba(255,255,255,.4)' }} />
          впереди <b data-a="n-none">0</b>
        </span>
      </div>
      {READY_NOTES.map((note) => (
        <span key={note.text} data-a="note" className={`mr-note mr-note--${note.tone}`}>
          <i>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {NOTE_ICONS[note.tone]}
            </svg>
          </i>
          {note.text}
        </span>
      ))}
      <svg className="mr-line" viewBox="0 0 1920 1080" aria-hidden="true">
        <defs>
          <linearGradient id="mr-line-g" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#2869DD" />
            <stop offset="0.55" stopColor="#F4C45B" />
            <stop offset="1" stopColor="#FFFFFF" />
          </linearGradient>
        </defs>
        <path data-a="path" className="mr-line-glow" d={LINE} pathLength={1} stroke="#F4C45B" strokeOpacity="0.55" strokeWidth="26" strokeDasharray="1" strokeDashoffset="1" />
        <path ref={line} data-a="path" d={LINE} pathLength={1} stroke="url(#mr-line-g)" strokeWidth="8" strokeDasharray="1" strokeDashoffset="1" />
      </svg>
      <span data-a="dot" className="mr-line-head" />
      <span data-a="label" className="mr-line-label">
        готовность
      </span>
    </div>
  );
}
