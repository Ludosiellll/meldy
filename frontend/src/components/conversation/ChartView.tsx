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
const TICK_FONT = 11;
/** Средняя ширина символа подписи оси при 11px Inter (кириллица). */
const TICK_CHAR_WIDTH = 6.1;
const VALUE_FONT = 12.5;
/** Подпись значения обведена цветом фона, чтобы линия графика её не перечёркивала. */
const HALO = { stroke: 'var(--sf-surface)', strokeWidth: 4, strokeLinejoin: 'round', paintOrder: 'stroke' } as const;

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

const CLOCK = /^(\d{1,2})[:.](\d{2})$/;

/**
 * true, если подписи оси — числа с неравным шагом («20 мин, 1 час, 9 часов»):
 * линия рисует точки через равные промежутки, и об этом надо сказать.
 * Подписи-категории без чисел («Январь», «Февраль») и ровные ряды («2020, 2021»,
 * «6:00, 9:00 … 21:00, 0:00» — время суток через полночь) — в масштабе.
 */
export function axisNotToScale(labels: string[]): boolean {
  const trimmed = labels.map(label => label.trim());
  if (trimmed.length > 1 && trimmed.every(label => CLOCK.test(label))) {
    const minutes: number[] = [];
    for (const label of trimmed) {
      const [, hours, mins] = CLOCK.exec(label) as RegExpExecArray;
      let value = Number(hours) * 60 + Number(mins);
      // Время после полуночи идёт дальше по оси, а не назад.
      while (minutes.length && value <= minutes[minutes.length - 1]) value += 24 * 60;
      minutes.push(value);
    }
    return !equalSteps(minutes);
  }
  const parsed = trimmed.map(label => {
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
  return !equalSteps(items.map(item => item.value));
}

function equalSteps(values: number[]): boolean {
  const steps = values.slice(1).map((value, index) => value - values[index]);
  const step = steps[0] ?? 0;
  return steps.every(value => Math.abs(value - step) <= 1e-9 * Math.max(1, Math.abs(step)));
}

/** «%» пишется у каждого значения, остальные единицы — в заголовке («Выручка, млн ₽»). */
export function isPercentUnit(unit: string | undefined): boolean {
  return (unit ?? '').trim() === '%';
}

/** Примечания под графиком (без подписи об источнике). */
export function chartNotes(visual: ChartVisual): string[] {
  return visual.kind === 'line' && axisNotToScale(visual.data.map(point => point.label))
    ? ['Интервалы по оси не в масштабе']
    : [];
}

/** Две круглые отметки внутри (min, max) — для шкалы, которая начинается не с нуля. */
function gridValues(min: number, max: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const exponent = Math.floor(Math.log10(span));
  for (let exp = exponent - 2; exp <= exponent + 1; exp += 1) {
    for (const multiplier of [1, 2, 2.5, 5]) {
      const step = multiplier * 10 ** exp;
      const first = Math.ceil((min + span * 0.1) / step) * step;
      const values: number[] = [];
      for (let value = first; value < max - span * 0.1; value += step) values.push(Math.round(value * 1e6) / 1e6);
      if (values.length === 2) return values;
    }
  }
  return [];
}

export interface ChartScale {
  min: number;
  max: number;
  /** Шкала начинается с нуля: тогда под линией можно закрасить площадь. */
  fromZero: boolean;
  /** Отметки шкалы, если она начинается не с нуля (иначе обрезанная шкала невидима). */
  grid: number[];
}

/**
 * Шкала графика. Столбцы всегда растут от нуля. Линия начинается с нуля, если
 * значения неотрицательные и разброс большой (самое малое не больше 60% самого
 * большого): иначе 21% выглядели бы как «почти ничего». Узкий разброс (91–95%)
 * и отрицательные значения получают шкалу по данным с запасом и подписанными
 * отметками, чтобы было видно, что ноль не внизу.
 */
export function chartScale(kind: ChartVisual['kind'], values: number[]): ChartScale {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (kind === 'bar') return { min: Math.min(0, low), max: Math.max(0, high), fromZero: true, grid: [] };
  if (low >= 0 && high > 0 && low <= 0.6 * high) return { min: 0, max: high * 1.12, fromZero: true, grid: [] };
  const pad = (high - low) * 0.18 || Math.abs(high) * 0.1 || 1;
  const min = low >= 0 && low - pad < 0 ? 0 : low - pad;
  const max = high + pad;
  return { min, max, fromZero: min === 0, grid: min === 0 ? [] : gridValues(min, max) };
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
  const percent = isPercentUnit(unit);
  const values = data.map(point => point.value);
  const scale = chartScale(kind, values);
  const span = scale.max - scale.min || 1;
  const plotTop = PAD_TOP;
  const plotBottom = chartHeight - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;
  const y = (value: number) => plotTop + ((scale.max - value) / span) * plotHeight;
  const baseY = scale.fromZero ? y(0) : plotBottom;
  const band = (width - PAD_X * 2) / data.length;
  const centerX = (index: number) => PAD_X + band * index + band / 2;
  const barWidth = Math.max(6, Math.min(24, band * 0.6));
  const labelChars = Math.max(4, Math.floor((band - 6) / TICK_CHAR_WIDTH));
  const valueText = (value: number) => `${formatChartValue(value)}${percent ? '%' : ''}`;
  const suffix = unit && !percent ? ` ${unit}` : '';

  const minIndex = values.indexOf(Math.min(...values));
  const maxIndex = values.indexOf(Math.max(...values));
  const showValue = (index: number) =>
    kind === 'bar' || data.length <= 6 || index === 0 || index === data.length - 1 || index === minIndex || index === maxIndex;

  /** Подпись значения: над точкой, а у «ямы» линии — под ней, если там есть место. */
  const valueLabelY = (index: number) => {
    const vy = y(data[index].value);
    if (kind === 'bar') return data[index].value < 0 ? vy + 15 : vy - 9;
    const previous = data[index - 1]?.value;
    const next = data[index + 1]?.value;
    const valley = previous !== undefined && next !== undefined && data[index].value < previous && data[index].value < next;
    return valley && vy + 19 + 6 < plotBottom ? vy + 19 : vy - 9;
  };

  // Подпись отметки шкалы не должна лечь на подпись крайней точки: слева, иначе справа, иначе без неё.
  const clashes = (gridY: number, index: number) => {
    if (!showValue(index)) return false;
    const labelY = valueLabelY(index);
    return Math.abs(gridY - 4 - labelY) < 14;
  };
  const gridSide = (value: number): 'start' | 'end' | null => {
    const gridY = y(value);
    if (!clashes(gridY, 0)) return 'start';
    if (!clashes(gridY, data.length - 1)) return 'end';
    return null;
  };

  const description = data.map(point => `${point.label}: ${valueText(point.value)}${suffix}`).join('; ');
  const linePoints = data.map((point, index) => `${centerX(index)},${y(point.value)}`).join(' ');
  const areaPath =
    kind === 'line' && scale.fromZero
      ? `M${centerX(0)},${baseY} ${data.map((point, index) => `L${centerX(index)},${y(point.value)}`).join(' ')} L${centerX(data.length - 1)},${baseY} Z`
      : null;

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={chartHeight}
        viewBox={`0 0 ${width} ${chartHeight}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="block max-w-full overflow-visible"
        data-chart-scale={scale.fromZero ? 'zero' : 'data'}
      >
        <title id={titleId}>{`${visual.title}${unit ? ` (${unit})` : ''}`}</title>
        <desc id={descId}>{description}</desc>

        {scale.grid.map(value => {
          const gridY = y(value);
          const side = gridSide(value);
          return (
            <g key={`grid-${value}`} data-chart-grid="">
              <line
                x1={PAD_X}
                x2={width - PAD_X}
                y1={gridY}
                y2={gridY}
                style={{ stroke: 'var(--sf-line)' }}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              {side && (
                <text
                  x={side === 'start' ? PAD_X : width - PAD_X}
                  y={gridY - 4}
                  textAnchor={side}
                  fontSize={TICK_FONT}
                  style={{ fill: 'var(--sf-muted)', fontVariantNumeric: 'tabular-nums', ...HALO }}
                >
                  {valueText(value)}
                </text>
              )}
            </g>
          );
        })}

        {scale.fromZero && (
          <line
            x1={PAD_X}
            x2={width - PAD_X}
            y1={baseY}
            y2={baseY}
            style={{ stroke: 'color-mix(in srgb, var(--sf-ink) 22%, var(--sf-surface))' }}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        )}

        {areaPath && <path d={areaPath} style={{ fill: 'color-mix(in srgb, var(--sf-accent-fg) 10%, transparent)' }} />}

        {kind === 'line' && (
          <polyline
            points={linePoints}
            fill="none"
            style={{ stroke: 'var(--sf-accent-fg)' }}
            strokeWidth={2.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {data.map((point, index) => {
          const cx = centerX(index);
          const vy = y(point.value);
          const tickLines = wrapLabel(point.label, labelChars, 2);
          return (
            <g key={`${point.label}-${index}`}>
              {kind === 'bar' ? (
                <path d={barPath(cx - barWidth / 2, barWidth, vy, baseY)} style={{ fill: 'var(--sf-accent-fg)' }}>
                  <title>{`${point.label}: ${valueText(point.value)}${suffix}`}</title>
                </path>
              ) : (
                <circle cx={cx} cy={vy} r={4} strokeWidth={2} style={{ fill: 'var(--sf-accent-fg)', stroke: 'var(--sf-surface)' }}>
                  <title>{`${point.label}: ${valueText(point.value)}${suffix}`}</title>
                </circle>
              )}
              {showValue(index) && (
                <text
                  x={cx}
                  y={valueLabelY(index)}
                  textAnchor="middle"
                  fontSize={VALUE_FONT}
                  fontWeight={600}
                  data-chart-value=""
                  style={{ fill: 'var(--sf-ink)', fontVariantNumeric: 'tabular-nums', ...HALO }}
                >
                  {valueText(point.value)}
                </text>
              )}
              <text x={cx} y={plotBottom + 18} textAnchor="middle" fontSize={TICK_FONT} style={{ fill: 'var(--sf-muted)' }}>
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
    </div>
  );
}
