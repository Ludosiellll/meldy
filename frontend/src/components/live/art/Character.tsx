/**
 * A player's character: layers of SVG in one box. The expression switches by opacity (`data-face`), every move is a CSS
 * animation of transform on the wrapper (live-art.css) — the compositor plays it; no SVG part animates on its own.
 */
import { memo, type CSSProperties, type ReactElement } from 'react';
import type { Expression, Look } from '../../../lib/live/types';
import { BODY_PARTS, COLOUR_PARTS, OUTLINE, shade } from './parts';
import './live-art.css';

export type CharacterMove = 'idle' | 'bounce' | 'hit' | 'cheer' | 'none';

const EXPRESSIONS: readonly Expression[] = ['idle', 'happy', 'hurt', 'frozen'];

function Base({ look }: { look: Look }) {
  const B = BODY_PARTS[look.body];
  const col = COLOUR_PARTS[look.colour].value;
  const [fl, fr] = B.feet;
  const ay = B.fy + 16;
  const lx = 50 - B.hw - 3;
  const rx = 50 + B.hw + 3;
  return (
    <>
      <ellipse cx={fl} cy={88} rx={9} ry={5.5} fill={OUTLINE} />
      <ellipse cx={fr} cy={88} rx={9} ry={5.5} fill={OUTLINE} />
      <ellipse cx={lx} cy={ay} rx={6} ry={9} transform={`rotate(28 ${lx} ${ay})`} fill={col} stroke={OUTLINE} strokeWidth={3.2} />
      <ellipse cx={rx} cy={ay} rx={6} ry={9} transform={`rotate(-28 ${rx} ${ay})`} fill={col} stroke={OUTLINE} strokeWidth={3.2} />
      <path d={B.d} fill={col} stroke={OUTLINE} strokeWidth={3.6} strokeLinejoin="round" />
      <ellipse cx={33} cy={B.fy + 9} rx={5} ry={3.2} fill="#FF7E96" opacity={0.45} />
      <ellipse cx={67} cy={B.fy + 9} rx={5} ry={3.2} fill="#FF7E96" opacity={0.45} />
    </>
  );
}

function Eyes({ look, face }: { look: Look; face: Expression }) {
  const y = BODY_PARTS[look.body].fy;
  const col = COLOUR_PARTS[look.colour].value;
  const style = look.eyes;
  const xs = style === 'one' ? [50] : [39, 61];
  if (face === 'happy') {
    const w = style === 'one' ? 9 : 6;
    return (
      <>
        {xs.map((x) => (
          <path key={x} d={`M${x - w} ${y + 2}Q${x} ${y - w - 1} ${x + w} ${y + 2}`} fill="none" stroke={OUTLINE} strokeWidth={3.4} strokeLinecap="round" />
        ))}
      </>
    );
  }
  if (face === 'hurt') {
    return style === 'one' ? (
      <path d={`M42 ${y - 6}L58 ${y + 6}M58 ${y - 6}L42 ${y + 6}`} stroke={OUTLINE} strokeWidth={3.4} strokeLinecap="round" />
    ) : (
      <path d={`M34 ${y - 5}L43 ${y}L34 ${y + 5}M66 ${y - 5}L57 ${y}L66 ${y + 5}`} fill="none" stroke={OUTLINE} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
    );
  }
  const pupil = face === 'frozen' ? 0 : 1;
  if (style === 'dots') {
    return (
      <>
        {xs.map((x) => (
          <g key={x}>
            <circle cx={x} cy={y} r={4.6} fill={OUTLINE} />
            <circle cx={x + 1.4} cy={y - 1.6} r={1.3} fill="#fff" />
          </g>
        ))}
      </>
    );
  }
  if (style === 'one') {
    return (
      <>
        <circle cx={50} cy={y - 1} r={12} fill="#fff" stroke={OUTLINE} strokeWidth={3} />
        <circle cx={50 + pupil * 2} cy={y} r={5.6} fill={OUTLINE} />
        <circle cx={52 + pupil * 2} cy={y - 2.5} r={1.8} fill="#fff" />
      </>
    );
  }
  if (style === 'sleepy') {
    return (
      <>
        {xs.map((x) => (
          <g key={x}>
            <ellipse cx={x} cy={y} rx={7.4} ry={6.4} fill="#fff" stroke={OUTLINE} strokeWidth={2.8} />
            <circle cx={x + pupil} cy={y + 1.8} r={3.4} fill={OUTLINE} />
            <path d={`M${x - 8.6} ${y - 0.6}Q${x} ${y - 9} ${x + 8.6} ${y - 0.6}Z`} fill={col} stroke={OUTLINE} strokeWidth={2.8} strokeLinejoin="round" />
          </g>
        ))}
      </>
    );
  }
  return (
    <>
      {xs.map((x) => (
        <g key={x}>
          <circle cx={x} cy={y} r={7.6} fill="#fff" stroke={OUTLINE} strokeWidth={2.8} />
          <circle cx={x + pupil * 1.2} cy={y + 0.8} r={3.7} fill={OUTLINE} />
          <circle cx={x + 2.2} cy={y - 1.6} r={1.2} fill="#fff" />
          {style === 'glasses' && <circle cx={x} cy={y} r={10.5} fill="none" stroke={OUTLINE} strokeWidth={2.6} />}
        </g>
      ))}
      {style === 'glasses' && <path d={`M49.5 ${y - 1}H50.5`} stroke={OUTLINE} strokeWidth={2.6} />}
    </>
  );
}

function Mouth({ look, face }: { look: Look; face: Expression }) {
  const y = BODY_PARTS[look.body].fy + 11;
  if (face === 'happy') {
    return (
      <>
        <path d={`M42 ${y - 2}Q50 ${y + 12} 58 ${y - 2}Z`} fill={OUTLINE} stroke={OUTLINE} strokeWidth={2.4} strokeLinejoin="round" />
        <ellipse cx={50} cy={y + 4.2} rx={3.6} ry={2} fill="#FF8C9E" />
      </>
    );
  }
  if (face === 'hurt') return <path d={`M42 ${y + 2}q2 -3 4 0t4 0t4 0t4 0`} fill="none" stroke={OUTLINE} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />;
  if (face === 'frozen') return <circle cx={50} cy={y + 2} r={3} fill="none" stroke={OUTLINE} strokeWidth={2.6} />;
  return <path d={`M44.5 ${y}Q50 ${y + 5.5} 55.5 ${y}`} fill="none" stroke={OUTLINE} strokeWidth={3} strokeLinecap="round" />;
}

export function Hat({ look }: { look: Look }): ReactElement | null {
  const { top: T, hw } = BODY_PARTS[look.body];
  const s = { stroke: OUTLINE, strokeLinejoin: 'round' as const };
  switch (look.hat) {
    case 'cap':
      return (
        <>
          <path d={`M30 ${T + 6}Q32 ${T - 16} 52 ${T - 16}Q70 ${T - 15} 71 ${T + 5}Z`} fill="#E5533D" strokeWidth={3.2} {...s} />
          <path d={`M60 ${T + 2}H86Q89 ${T + 4} 85 ${T + 8}H58Z`} fill="#E5533D" strokeWidth={3.2} {...s} />
          <circle cx={51} cy={T - 16} r={2.6} fill={OUTLINE} />
        </>
      );
    case 'beanie':
      return (
        <>
          <path d={`M28 ${T + 8}Q30 ${T - 22} 50 ${T - 22}Q70 ${T - 22} 72 ${T + 8}Z`} fill="#9B87F0" strokeWidth={3.2} {...s} />
          <rect x={26} y={T + 1} width={48} height={10} rx={5} fill="#F7F7F3" stroke={OUTLINE} strokeWidth={3.2} />
          <circle cx={50} cy={T - 24} r={7} fill="#F7F7F3" stroke={OUTLINE} strokeWidth={3.2} />
        </>
      );
    case 'phones':
      return (
        <>
          <path d={`M${50 - hw - 1} ${T + 22}Q${50 - hw + 2} ${T - 16} 50 ${T - 16}Q${50 + hw - 2} ${T - 16} ${50 + hw + 1} ${T + 22}`} fill="none" stroke={OUTLINE} strokeWidth={6} strokeLinecap="round" />
          <rect x={50 - hw - 8} y={T + 14} width={14} height={22} rx={6} fill="#E5533D" stroke={OUTLINE} strokeWidth={3.2} />
          <rect x={50 + hw - 6} y={T + 14} width={14} height={22} rx={6} fill="#E5533D" stroke={OUTLINE} strokeWidth={3.2} />
        </>
      );
    case 'flower':
      return (
        <>
          <path d={`M60 ${T + 2}Q62 ${T - 6} 66 ${T - 10}`} fill="none" stroke={OUTLINE} strokeWidth={3} />
          {[0, 72, 144, 216, 288].map((a) => {
            const r = ((a - 90) * Math.PI) / 180;
            return <circle key={a} cx={66 + 7 * Math.cos(r)} cy={T - 14 + 7 * Math.sin(r)} r={5.4} fill="#fff" stroke={OUTLINE} strokeWidth={2.6} />;
          })}
          <circle cx={66} cy={T - 14} r={4.4} fill="#F4C45B" stroke={OUTLINE} strokeWidth={2.6} />
        </>
      );
    case 'antenna':
      return (
        <>
          <path d={`M50 ${T + 1}V${T - 16}`} stroke={OUTLINE} strokeWidth={3.4} strokeLinecap="round" />
          <circle cx={50} cy={T - 20} r={6} fill="#F4C45B" stroke={OUTLINE} strokeWidth={3.2} />
        </>
      );
    case 'bow':
      return (
        <>
          <path d={`M62 ${T + 1}L52 ${T - 9}L52 ${T + 9}Z M62 ${T + 1}L72 ${T - 9}L72 ${T + 9}Z`} fill="#F2709C" strokeWidth={3} {...s} />
          <circle cx={62} cy={T + 1} r={3.8} fill="#F2709C" stroke={OUTLINE} strokeWidth={3} />
        </>
      );
    case 'crown':
      return (
        <>
          <path d={`M33 ${T + 5}V${T - 13}L42 ${T - 4}L50 ${T - 17}L58 ${T - 4}L67 ${T - 13}V${T + 5}Z`} fill="#F4C45B" strokeWidth={3.2} {...s} />
          <circle cx={50} cy={T - 3} r={2.6} fill="#E5533D" />
        </>
      );
    case 'grad':
      return (
        <>
          <path d={`M36 ${T - 4}V${T + 6}Q50 ${T + 12} 64 ${T + 6}V${T - 4}Z`} fill={OUTLINE} />
          <path d={`M50 ${T - 20}L80 ${T - 9}L50 ${T + 2}L20 ${T - 9}Z`} fill="#2B3240" strokeWidth={3} {...s} />
          <path d={`M50 ${T - 9}L74 ${T - 4}V${T + 10}`} fill="none" stroke="#F4C45B" strokeWidth={2.6} strokeLinecap="round" />
          <circle cx={74} cy={T + 12} r={3} fill="#F4C45B" />
        </>
      );
    case 'horns':
      return <path d={`M34 ${T + 6}Q28 ${T - 8} 36 ${T - 14}Q36 ${T - 4} 44 ${T + 2}Z M66 ${T + 6}Q72 ${T - 8} 64 ${T - 14}Q64 ${T - 4} 56 ${T + 2}Z`} fill="#FFF2D6" strokeWidth={3} {...s} />;
    default:
      return null;
  }
}

export function IceBlock() {
  return (
    <svg viewBox="0 0 124 112" aria-hidden="true">
      <rect x={5} y={5} width={114} height={102} rx={20} fill="#CFEAFF" fillOpacity={0.72} stroke="#5FA4DD" strokeWidth={4} />
      <path d="M22 22h22M22 32h10M92 84h12M98 74h6" stroke="#fff" strokeWidth={5} strokeLinecap="round" />
    </svg>
  );
}

export interface CharacterProps {
  look: Look;
  /** Width and height in px (readable from 40 px up). */
  size: number;
  face?: Expression;
  /** Shows the ice block (and the frozen face, unless `face` says otherwise). */
  frozen?: boolean;
  move?: CharacterMove;
  /** Name under the character (the teacher's screen). */
  name?: string;
  /** The own character: the name on a dark pill. */
  me?: boolean;
  className?: string;
  style?: CSSProperties;
  /** A different phase for the idle sway, so a crowd does not move in step (ms). */
  phaseMs?: number;
  title?: string;
}

function box(children: ReactElement | ReactElement[] | null, cls: string, key?: string) {
  return (
    <svg key={key} viewBox="0 0 100 100" className={cls} aria-hidden="true" overflow="visible">
      {children}
    </svg>
  );
}

/**
 * The drawing itself (body, the four faces, hat, ice). Memoised on the look and the move: a change of face or ice only
 * flips the attributes of the outer box, so a crowd of 30 redraws nothing when one character is hit (the look must be
 * the same object for that — the teacher's screen keeps it).
 */
const Drawing = memo(function Drawing({ look, move }: { look: Look; move: CharacterMove }) {
  return (
    <div className={`lv-char__in lv-move-${move}`}>
      {box(<Base look={look} />, 'lv-char__base')}
      {EXPRESSIONS.map((e) =>
        box(
          <>
            <Eyes look={look} face={e} />
            <Mouth look={look} face={e} />
          </>,
          `lv-char__face lv-char__face--${e}`,
          e,
        ),
      )}
      {box(<Hat look={look} />, 'lv-char__hat')}
      <div className="lv-char__ice">
        <IceBlock />
      </div>
    </div>
  );
});

/** The decorative SVG layers have no names; the character's name (or `title`) is the accessible label. */
export function Character({ look, size, face, frozen = false, move = 'idle', name, me = false, className, style, phaseMs = 0, title }: CharacterProps) {
  const shown: Expression = face ?? (frozen ? 'frozen' : 'idle');
  return (
    <div
      className={`lv-char${me ? ' lv-char--me' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, ...style, ['--lv-delay' as string]: `${-phaseMs}ms` }}
      data-face={shown}
      data-frozen={frozen ? 'true' : 'false'}
      role={name || title ? 'img' : undefined}
      aria-label={name || title || undefined}
      aria-hidden={name || title ? undefined : true}
    >
      <Drawing look={look} move={move} />
      {name && <div className="lv-char__name">{name}</div>}
    </div>
  );
}

export { shade };
