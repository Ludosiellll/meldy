import { useId } from 'react';
import type { ChartVisual } from './types';
import { useElementWidth } from './useElementWidth';
import { wrapLabel } from './diagramLayout';

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatChartValue(value: number): string {
  return numberFormat.format(value);
}

const PAD_TOP = 26;
const PAD_BOTTOM = 42;
const PAD_X = 8;
const RADIUS = 4;

/** Столбец со скруглённым концом данных и прямым основанием. */
function barPath(x: number, width: number, valueY: number, baseY: number): string {
  const height = Math.abs(baseY - valueY);
  if (height < 0.5) return `M${x},${baseY}H${x + width}`;
  const r = Math.min(RADIUS, width / 2, height);
  if (valueY <= baseY) {
    return `M${x},${baseY}V${valueY + r}Q${x},${valueY} ${x + r},${valueY}H${x + width - r}Q${x + width},${valueY} ${x + width},${valueY + r}V${baseY}Z`;
  }
  return `M${x},${baseY}V${valueY - r}Q${x},${valueY} ${x + r},${valueY}H${x + width - r}Q${x + width},${valueY} ${x + width},${valueY - r}V${baseY}Z`;
}

/**
 * true, если подписи оси — числа с неравным шагом («20 мин, 1 час, 9 часов»):
 * линия рисует точки через равные промежутки, и об этом надо сказать.
 * Подписи-категории без чисел («Январь», «Февраль») и ровные ряды («2020, 2021») — в масштабе.
 */
export function axisNotToScale(labels: string[]): boolean {
  const parsed = labels.map(label => {
    const match = /[-+]?\d+(?:[.,]\d+)?/.exec(label);
    if (!match) return null;
    return {
      value: Number(match[0].replace(',', '.')),
      rest: (label.slice(0, match.index) + label.slice(match.index + match[0].length)).trim().toLowerCase(),
    };
  });
  if (parsed.every(item => item === null)) return false;
  if (parsed.some(item => item === null)) return true;
  const items = parsed as { value: number; rest: string }[];
  if (items.some(item => item.rest !== items[0].rest)) return true;
  const steps = items.slice(1).map((item, index) => item.value - items[index].value);
  const step = steps[0] ?? 0;
  return steps.some(value => Math.abs(value - step) > 1e-9 * Math.max(1, Math.abs(step)));
}

export default function ChartView({ visual }: { visual: ChartVisual }) {
  const [ref, measured] = useElementWidth<HTMLDivElement>(560);
  const reactId = useId().replace(/:/g, '');
  const titleId = `chart-title-${reactId}`;
  const descId = `chart-desc-${reactId}`;

  const width = Math.max(260, measured);
  // На телефоне график ниже, чтобы рядом поместились субтитры.
  const chartHeight = width < 420 ? 200 : 236;
  const { data, kind, unit } = visual;
  const values = data.map(point => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  let minValue: number;
  let maxValue: number;
  if (kind === 'bar') {
    // Столбцы всегда растут от нуля, иначе высоты врут.
    minValue = Math.min(0, low);
    maxValue = Math.max(0, high);
  } else {
    // Линия показывает изменение: шкала по диапазону данных с небольшим запасом.
    const pad = (high - low) * 0.18 || Math.abs(high) * 0.1 || 1;
    minValue = low >= 0 && low - pad < 0 ? 0 : low - pad;
    maxValue = high + pad;
  }
  const span = maxValue - minValue || 1;
  const plotTop = PAD_TOP;
  const plotBottom = chartHeight - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;
  const y = (value: number) => plotTop + ((maxValue - value) / span) * plotHeight;
  const baseY = kind === 'bar' ? y(0) : plotBottom;
  const band = (width - PAD_X * 2) / data.length;
  const centerX = (index: number) => PAD_X + band * index + band / 2;
  const barWidth = Math.max(6, Math.min(24, band * 0.6));
  const labelChars = Math.max(4, Math.floor((band - 6) / 6.6));
  const suffix = unit ? ` ${unit}` : '';

  const minIndex = values.indexOf(Math.min(...values));
  const maxIndex = values.indexOf(Math.max(...values));
  const showValue = (index: number) =>
    kind === 'bar' || data.length <= 6 || index === 0 || index === data.length - 1 || index === minIndex || index === maxIndex;

  const description = data.map(point => `${point.label}: ${formatChartValue(point.value)}${suffix}`).join('; ');
  const linePoints = data.map((point, index) => `${centerX(index)},${y(point.value)}`).join(' ');

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={chartHeight}
        viewBox={`0 0 ${width} ${chartHeight}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="block max-w-full overflow-visible"
      >
        <title id={titleId}>{`${visual.title}${unit ? ` (${unit})` : ''}`}</title>
        <desc id={descId}>{description}</desc>

        <line
          x1={PAD_X}
          x2={width - PAD_X}
          y1={baseY}
          y2={baseY}
          style={{ stroke: 'var(--sf-line)' }}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />

        {kind === 'line' && (
          <polyline
            points={linePoints}
            fill="none"
            style={{ stroke: 'var(--sf-accent-fg)' }}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {data.map((point, index) => {
          const cx = centerX(index);
          const vy = y(point.value);
          const negative = point.value < 0;
          const labelY = kind === 'bar' && negative ? vy + 15 : vy - 9;
          const tickLines = wrapLabel(point.label, labelChars, 2);
          return (
            <g key={`${point.label}-${index}`}>
              {kind === 'bar' ? (
                <path d={barPath(cx - barWidth / 2, barWidth, vy, baseY)} style={{ fill: 'var(--sf-accent-fg)' }}>
                  <title>{`${point.label}: ${formatChartValue(point.value)}${suffix}`}</title>
                </path>
              ) : (
                <circle
                  cx={cx}
                  cy={vy}
                  r={4.5}
                  strokeWidth={2}
                  style={{ fill: 'var(--sf-accent-fg)', stroke: 'var(--sf-surface)' }}
                >
                  <title>{`${point.label}: ${formatChartValue(point.value)}${suffix}`}</title>
                </circle>
              )}
              {showValue(index) && (
                <text
                  x={cx}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  style={{ fill: 'var(--sf-ink)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatChartValue(point.value)}
                </text>
              )}
              <text x={cx} y={plotBottom + 18} textAnchor="middle" fontSize={11.5} style={{ fill: 'var(--sf-muted)' }}>
                {tickLines.map((line, lineIndex) => (
                  <tspan key={lineIndex} x={cx} dy={lineIndex === 0 ? 0 : 14}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      {kind === 'line' && axisNotToScale(data.map(point => point.label)) && (
        <p className="mt-1 text-xs text-[var(--sf-muted)]">Интервалы по оси не в масштабе</p>
      )}
    </div>
  );
}
