/**
 * The monster «Дедлайн» — an alarm clock; its brows are the clock's hands. Layers: bells (they shake on their own
 * wrapper), the body and face of each phase (cross-faded by opacity), the hurt face, a white flash for hits.
 * Moves are CSS animations of transform (live-art.css): `idle` breathes, `hit` shakes, `roar` before the counter-attack,
 * `fall` on defeat.
 */
import { memo, type CSSProperties } from 'react';
import type { BossPhase } from '../../../lib/live/types';
import { BOSS_COLOURS, OUTLINE, shade } from './parts';
import './live-art.css';

export type BossMove = 'idle' | 'hit' | 'roar' | 'fall' | 'none';

// The layers are memoised: a hit flips `hurt`, which only changes the layers' opacity, not their drawing.
const Body = memo(function Body({ phase }: { phase: BossPhase }) {
  const col = BOSS_COLOURS[phase];
  const dark = shade(col, 0.78);
  const arm = (d: string) => (
    <>
      <path d={d} fill="none" stroke={OUTLINE} strokeWidth={13} strokeLinecap="round" />
      <path d={d} fill="none" stroke={col} strokeWidth={6} strokeLinecap="round" />
    </>
  );
  return (
    <svg viewBox="0 0 240 240" aria-hidden="true">
      <ellipse cx={88} cy={220} rx={20} ry={11} fill={OUTLINE} />
      <ellipse cx={152} cy={220} rx={20} ry={11} fill={OUTLINE} />
      {arm('M60 170Q30 176 26 150')}
      {arm('M180 170Q210 176 214 150')}
      <circle cx={26} cy={146} r={11} fill={col} stroke={OUTLINE} strokeWidth={5} />
      <circle cx={214} cy={146} r={11} fill={col} stroke={OUTLINE} strokeWidth={5} />
      <circle cx={120} cy={132} r={88} fill={col} stroke={OUTLINE} strokeWidth={6} />
      <path d="M42 150A80 80 0 0 0 198 150A88 88 0 0 1 42 150Z" fill={dark} opacity={0.5} />
      <circle cx={120} cy={134} r={64} fill="#FFF6E5" stroke={OUTLINE} strokeWidth={5} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        const r1 = i % 3 === 0 ? 50 : 54;
        const r2 = 59;
        return <path key={i} d={`M${120 + r1 * Math.sin(a)} ${134 - r1 * Math.cos(a)}L${120 + r2 * Math.sin(a)} ${134 - r2 * Math.cos(a)}`} stroke={OUTLINE} strokeWidth={i % 3 === 0 ? 4.5 : 3} strokeLinecap="round" />;
      })}
    </svg>
  );
});

const Face = memo(function Face({ phase, hurt }: { phase: BossPhase; hurt: boolean }) {
  const tilt = [10, 16, 22][phase];
  return (
    <svg viewBox="0 0 240 240" aria-hidden="true">
      <path d={`M74 ${104 - tilt / 2}L114 ${104 + tilt / 2}`} stroke={OUTLINE} strokeWidth={8} strokeLinecap="round" />
      <path d={`M166 ${104 - tilt / 2}L126 ${104 + tilt / 2}`} stroke={OUTLINE} strokeWidth={8} strokeLinecap="round" />
      <circle cx={120} cy={104} r={5} fill={OUTLINE} />
      {hurt ? (
        <>
          <path d="M84 112L102 122L84 132M156 112L138 122L156 132" fill="none" stroke={OUTLINE} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M96 168Q120 156 144 168" fill="none" stroke={OUTLINE} strokeWidth={7} strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx={95} cy={124} rx={13} ry={15} fill="#fff" stroke={OUTLINE} strokeWidth={5} />
          <circle cx={99} cy={127} r={6.5} fill={OUTLINE} />
          <ellipse cx={145} cy={124} rx={13} ry={15} fill="#fff" stroke={OUTLINE} strokeWidth={5} />
          <circle cx={141} cy={127} r={6.5} fill={OUTLINE} />
          <path d="M88 158Q120 190 152 158Z" fill={OUTLINE} stroke={OUTLINE} strokeWidth={5} strokeLinejoin="round" />
          <path d="M98 161L104 170L110 162M130 162L136 170L142 161" fill="#fff" />
        </>
      )}
    </svg>
  );
});

const Bells = memo(function Bells() {
  return (
    <svg viewBox="0 0 240 240" aria-hidden="true">
      <path d="M66 58L52 40M174 58L188 40" stroke={OUTLINE} strokeWidth={6} strokeLinecap="round" />
      <path d="M24 52A34 34 0 0 1 84 22Z" fill="#F4C45B" stroke={OUTLINE} strokeWidth={5.5} strokeLinejoin="round" />
      <path d="M216 52A34 34 0 0 0 156 22Z" fill="#F4C45B" stroke={OUTLINE} strokeWidth={5.5} strokeLinejoin="round" />
      <rect x={110} y={30} width={20} height={18} rx={6} fill={OUTLINE} />
    </svg>
  );
});

export interface BossProps {
  size: number;
  phase: BossPhase;
  hurt?: boolean;
  move?: BossMove;
  /** Change the key to replay a hit flash. */
  flashKey?: number;
  className?: string;
  style?: CSSProperties;
}

export function Boss({ size, phase, hurt = false, move = 'idle', flashKey, className, style }: BossProps) {
  const phases: BossPhase[] = [0, 1, 2];
  return (
    <div className={`lv-boss${className ? ` ${className}` : ''}`} style={{ width: size, height: size, ...style }} role="img" aria-label="Дедлайн" data-phase={phase}>
      <div className={`lv-boss__grow lv-boss__grow--p${phase}`}>
        <div className={`lv-boss__in lv-boss-move-${move}`}>
          <div className={`lv-boss__bells${phase === 2 ? ' lv-boss__bells--ring' : ''}`}>
            <Bells />
          </div>
          {phases.map((p) => (
            <div key={`b${p}`} className="lv-boss__layer" style={{ opacity: p === phase ? 1 : 0 }}>
              <Body phase={p} />
            </div>
          ))}
          {phases.map((p) => (
            <div key={`f${p}`} className="lv-boss__layer" style={{ opacity: !hurt && p === phase ? 1 : 0 }}>
              <Face phase={p} hurt={false} />
            </div>
          ))}
          <div className="lv-boss__layer" style={{ opacity: hurt ? 1 : 0 }}>
            <Face phase={phase} hurt />
          </div>
          <div key={flashKey ?? 0} className={`lv-boss__layer lv-boss__flash${flashKey ? ' lv-boss__flash--on' : ''}`}>
            <svg viewBox="0 0 240 240" aria-hidden="true">
              <circle cx={120} cy={132} r={91} fill="#fff" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
