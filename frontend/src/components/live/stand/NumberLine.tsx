/**
 * A number question's reveal on the projector (CONTRACT §15, 20261102090100_live_numbers.sql): a number line with the
 * right value (a green pin) and its tolerance (a green band), and where the class's answers fell — one stem per value,
 * its height the count (written beside its head), green inside the band, coral outside; answers far off the line are
 * counted at its ends. Used by the 3D projector (BattleHost) and the flat one (host/Panel). Pure SVG; the layout is
 * lib/live/numbers.ts.
 */
import { memo } from 'react';
import { numberLine } from '../../../lib/live/numbers';
import type { NumberSpread } from '../../../lib/live/types';

export interface NumberLineProps {
  forms: readonly string[];
  tolerance: number | string | null | undefined;
  unit: string | null | undefined;
  spread: NumberSpread | null | undefined;
  width: number;
  height?: number;
  /** The colours of a dark board (the 3D projector) or a light one (the flat projector). */
  tone?: 'dark' | 'light';
}

const OK = '#36c47c';
const BAD = '#ff8a7a';

export const NumberLine = memo(function NumberLine({ forms, tolerance, unit, spread, width, height = 150, tone = 'dark' }: NumberLineProps) {
  const view = numberLine(forms, tolerance, spread);
  if (!view || width < 120) return null;
  const ink = tone === 'dark' ? '#ffffff' : '#1d1b2e';
  const soft = tone === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(29,27,46,0.65)';
  const side = 34;
  const inner = width - side * 2;
  const X = (x: number) => side + x * inner;
  const axis = height - 34;
  const top = 34;
  const many = view.dots.length > 14;
  const labelled = new Set(
    [...view.dots]
      .sort((a, b) => b.n - a.n)
      .slice(0, many ? 5 : view.dots.length)
      .filter((d) => d.n >= 2)
      .map((d) => d.value),
  );
  const label = `Числовая прямая: верный ответ ${view.rights.map((r) => r.label).join(' или ')}${unit ? ` ${unit}` : ''}`;
  return (
    <svg className="lvnl" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {view.rights.map((r, i) =>
        r.to - r.from > 0 ? (
          <rect key={`b${i}`} x={X(r.from)} y={top - 6} width={Math.max(3, (r.to - r.from) * inner)} height={axis - top + 6} rx={4} fill={OK} opacity={0.24} />
        ) : null,
      )}
      <line x1={side - 10} x2={width - side + 10} y1={axis} y2={axis} stroke={soft} strokeWidth={2} />
      {view.ticks.map((t, i) => (
        <g key={`t${i}`}>
          <line x1={X(t.x)} x2={X(t.x)} y1={axis - 5} y2={axis + 5} stroke={soft} strokeWidth={2} />
          <text x={X(t.x)} y={axis + 24} fill={soft} fontSize={16} fontWeight={600} textAnchor="middle">
            {t.label}
          </text>
        </g>
      ))}
      {view.dots.map((d) => {
        const h = 10 + (axis - top - 16) * (d.n / view.top);
        const x = X(d.x);
        const colour = d.ok ? OK : BAD;
        return (
          <g key={d.value} className="lvnl-dot">
            <line x1={x} x2={x} y1={axis} y2={axis - h} stroke={colour} strokeWidth={4} strokeLinecap="round" />
            <circle cx={x} cy={axis - h} r={6.5} fill={colour} />
            {labelled.has(d.value) ? (
              <text x={x + 10} y={axis - h + 5} fill={ink} fontSize={15} fontWeight={800}>
                {d.n}
              </text>
            ) : null}
          </g>
        );
      })}
      {view.rights.map((r, i) => (
        <g key={`r${i}`}>
          <line x1={X(r.x)} x2={X(r.x)} y1={top - 4} y2={axis} stroke={OK} strokeWidth={3} />
          <path d={`M ${X(r.x) - 8} ${top - 14} L ${X(r.x) + 8} ${top - 14} L ${X(r.x)} ${top - 4} Z`} fill={OK} />
        </g>
      ))}
      {view.below > 0 ? (
        <text x={4} y={axis - 10} fill={BAD} fontSize={16} fontWeight={800}>
          ← {view.below}
        </text>
      ) : null}
      {view.above > 0 ? (
        <text x={width - 4} y={axis - 10} fill={BAD} fontSize={16} fontWeight={800} textAnchor="end">
          {view.above} →
        </text>
      ) : null}
    </svg>
  );
});
