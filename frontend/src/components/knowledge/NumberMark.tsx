import { memo, useMemo } from 'react';
import type { Readiness } from '../../lib/learning/readiness';
import { READINESS_MARK } from '../exams/marks';
import { PencilSvg, shape } from '../marks';
import { digitsWidth, textWidth } from './textMetrics';

/**
 * A question number with its readiness mark, as on the exam sheet: a ring (подтверждено), a line
 * under it (засчитано, не подтверждено), a wavy line (не засчитано), nothing (не проверялось).
 * Its box is computed from the digits (Literata tabular figures), so a card with ten numbers does not
 * measure ten elements. The mark is aria-hidden: say what it means next to it in words.
 */
interface NumberMarkProps {
  number: string;
  readiness: Readiness;
  seed: number;
  /** Font size of the number (px); the line is 20 px high. */
  size?: number;
  className?: string;
}

const LINE = 20;

export function numberWidth(number: string, size = 15): number {
  return Math.ceil(/^\d+$/.test(number) ? digitsWidth(number.length, 'serif400', size) : textWidth(number, 'serif400', size));
}

/** The room a number takes in a row: the ring needs 6 px on each side. */
export function numberBoxWidth(number: string, size = 15): number {
  return numberWidth(number, size) + 12;
}

function NumberMarkImpl({ number, readiness, seed, size = 15, className = '' }: NumberMarkProps) {
  const kind = READINESS_MARK[readiness];
  const textW = numberWidth(number, size);
  const box = useMemo(() => {
    if (!kind) return null;
    if (kind === 'ring') return { left: 0, top: -3, width: textW + 12, height: LINE + 6 };
    return { left: 4, top: LINE - (kind === 'under' ? 1 : 0), width: textW + 4, height: 6 };
  }, [kind, textW]);
  const paths = useMemo(
    () => (kind && box ? shape(kind, box.width, box.height, seed, kind === 'wave' ? { weight: 2.2, period: 7 } : { weight: kind === 'ring' ? 1.9 : 2 }) : []),
    [kind, box, seed],
  );
  return (
    <span className={`km-num ${className}`.trim()} style={{ width: textW + 12 }} data-mark={kind ?? undefined}>
      <span className="km-num-t" style={{ fontSize: size }}>
        {number}
      </span>
      {kind && box ? (
        <PencilSvg width={box.width} height={box.height} paths={paths} className="sf-textmark-ink" style={{ left: box.left, top: box.top }} kind={kind} />
      ) : null}
    </span>
  );
}

export const NumberMark = memo(NumberMarkImpl);

/** A wavy pencil line under a word: «по этому понятию есть открытая ошибка». */
export const WaveUnder = memo(function WaveUnder({ width, seed, className = '' }: { width: number; seed: number; className?: string }) {
  const w = Math.max(12, Math.round(width));
  const paths = useMemo(() => shape('wave', w, 6, seed, { weight: 1.9, period: 7 }), [w, seed]);
  return <PencilSvg width={w} height={6} paths={paths} className={`km-wave ${className}`.trim()} kind="wave" />;
});
