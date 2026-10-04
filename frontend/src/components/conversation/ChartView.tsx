import { useId } from 'react';
import type { ChartVisual } from './types';
import { useElementWidth } from './useElementWidth';
import { wrapLabel } from './diagramLayout';

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatChartValue(value: number): string {
  return numberFormat.format(value);
}

/* Линия на листе (спека 5.7): чернилами, без заливки; значения Onest 16/600, подписи оси 15 приглушённые. */
const PAD_TOP = 30;
const PAD_BOTTOM = 52;
const PAD_X = 10;
const TICK_FONT = 15;
const TICK_LINE = 19;
/** Средняя ширина символа подписи оси: Onest 15, кириллица (замер 0,575 em). */
const TICK_CHAR_WIDTH = 8.8;
const VALUE_FONT = 16;
const LINE_HEIGHT_MAX = 236;
const LINE_HEIGHT_MIN = 180;
const INK_LINE = 'color-mix(in srgb, var(--sf-ink) 72%, transparent)';
/** Подпись значения обведена цветом бумаги, чтобы линия графика её не перечёркивала. */
const HALO = { stroke: 'var(--ph-paper)', strokeWidth: 4, strokeLinejoin: 'round', paintOrder: 'stroke' } as const;

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

/** Где столбик начинается и какой он длины, в долях ширины дорожки; zero — где ноль (если есть отрицательные). */
export function barSpans(values: number[]): { spans: { start: number; size: number }[]; zero: number | null } {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  return {
    spans: values.map(value => ({ start: (Math.min(value, 0) - min) / span, size: Math.abs(value) / span })),
    zero: min < 0 ? (0 - min) / span : null,
  };
}

/** Столбики: горизонтально, чернилами 55 %, значение справа, подпись слева; немного столбиков — посередине листа. */
function BarsView({ visual, description, maxHeight }: { visual: ChartVisual; description: string; maxHeight?: number }) {
  const percent = isPercentUnit(visual.unit);
  const { spans, zero } = barSpans(visual.data.map(point => point.value));
  return (
    <div className="cv-bars-room" style={maxHeight ? { minHeight: Math.floor(maxHeight) } : undefined}>
      <div
        className="cv-bars"
        role="img"
        aria-label={`${visual.title}${visual.unit ? ` (${visual.unit})` : ''}: ${description}`}
        data-many={visual.data.length > 5 ? '' : undefined}
        data-chart-scale="zero"
      >
        {visual.data.map((point, index) => (
          <div key={`${point.label}-${index}`} className="cv-bar-row" aria-hidden="true">
            <span className="cv-bar-label" title={point.label}>
              {point.label}
            </span>
            <span className="cv-bar-track">
              {zero !== null && <span className="cv-bar-zero" style={{ left: `${(zero * 100).toFixed(2)}%` }} />}
              <span
                className="cv-bar"
                data-chart-bar=""
                style={{ left: `${(spans[index].start * 100).toFixed(2)}%`, width: `${(spans[index].size * 100).toFixed(2)}%` }}
              />
            </span>
            <span className="cv-bar-value" data-chart-value="">
              {`${formatChartValue(point.value)}${percent ? '%' : ''}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Линия: чернилами, без заливки и без голубого; подписи значений — у крайних и особых точек. */
function LineView({ visual, description, maxHeight }: { visual: ChartVisual; description: string; maxHeight?: number }) {
  const [ref, measured] = useElementWidth<HTMLDivElement>(560);
  const reactId = useId().replace(/:/g, '');
  const titleId = `chart-title-${reactId}`;
  const descId = `chart-desc-${reactId}`;

  const width = Math.max(260, measured);
  const chartHeight = Math.max(LINE_HEIGHT_MIN, Math.min(LINE_HEIGHT_MAX, Math.floor(maxHeight ?? LINE_HEIGHT_MAX)));
  const { data, unit } = visual;
  const percent = isPercentUnit(unit);
  const values = data.map(point => point.value);
  const scale = chartScale('line', values);
  const span = scale.max - scale.min || 1;
  const plotTop = PAD_TOP;
  const plotBottom = chartHeight - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;
  const y = (value: number) => plotTop + ((scale.max - value) / span) * plotHeight;
  const baseY = scale.fromZero ? y(0) : plotBottom;
  const band = (width - PAD_X * 2) / data.length;
  const centerX = (index: number) => PAD_X + band * index + band / 2;
  const labelChars = Math.max(4, Math.floor((band - 6) / TICK_CHAR_WIDTH));
  const valueText = (value: number) => `${formatChartValue(value)}${percent ? '%' : ''}`;

  const minIndex = values.indexOf(Math.min(...values));
  const maxIndex = values.indexOf(Math.max(...values));
  const showValue = (index: number) =>
    data.length <= 6 || index === 0 || index === data.length - 1 || index === minIndex || index === maxIndex;

  /** Подпись значения: над точкой, а у «ямы» линии — под ней, если там есть место. */
  const valueLabelY = (index: number) => {
    const vy = y(data[index].value);
    const previous = data[index - 1]?.value;
    const next = data[index + 1]?.value;
    const valley = previous !== undefined && next !== undefined && data[index].value < previous && data[index].value < next;
    return valley && vy + 24 + 6 < plotBottom ? vy + 24 : vy - 12;
  };

  // Подпись отметки шкалы не должна лечь на подпись крайней точки: слева, иначе справа, иначе без неё.
  const clashes = (gridY: number, index: number) => {
    if (!showValue(index)) return false;
    return Math.abs(gridY - 5 - valueLabelY(index)) < 18;
  };
  const gridSide = (value: number): 'start' | 'end' | null => {
    const gridY = y(value);
    if (!clashes(gridY, 0)) return 'start';
    if (!clashes(gridY, data.length - 1)) return 'end';
    return null;
  };

  const linePoints = data.map((point, index) => `${centerX(index)},${y(point.value)}`).join(' ');

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={chartHeight}
        viewBox={`0 0 ${width} ${chartHeight}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="cv-chart"
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
                  y={gridY - 5}
                  textAnchor={side}
                  fontSize={TICK_FONT}
                  style={{ fill: 'var(--sf-muted)', fontFamily: 'var(--ph-sans)', fontVariantNumeric: 'tabular-nums', ...HALO }}
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
            style={{ stroke: 'color-mix(in srgb, var(--sf-ink) 30%, transparent)' }}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        )}

        <polyline points={linePoints} fill="none" style={{ stroke: INK_LINE }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {data.map((point, index) => {
          const cx = centerX(index);
          const vy = y(point.value);
          const tickLines = wrapLabel(point.label, labelChars, 2);
          return (
            <g key={`${point.label}-${index}`}>
              <circle cx={cx} cy={vy} r={4} strokeWidth={2} style={{ fill: 'var(--sf-ink)', stroke: 'var(--ph-paper)' }}>
                <title>{`${point.label}: ${valueText(point.value)}${unit && !percent ? ` ${unit}` : ''}`}</title>
              </circle>
              {showValue(index) && (
                <text
                  x={cx}
                  y={valueLabelY(index)}
                  textAnchor="middle"
                  fontSize={VALUE_FONT}
                  fontWeight={600}
                  data-chart-value=""
                  style={{ fill: 'var(--sf-ink)', fontFamily: 'var(--ph-sans)', fontVariantNumeric: 'tabular-nums', ...HALO }}
                >
                  {valueText(point.value)}
                </text>
              )}
              <text x={cx} y={plotBottom + 22} textAnchor="middle" fontSize={TICK_FONT} style={{ fill: 'var(--sf-muted)', fontFamily: 'var(--ph-sans)' }}>
                {tickLines.map((line, lineIndex) => (
                  <tspan key={lineIndex} x={cx} dy={lineIndex === 0 ? 0 : TICK_LINE}>
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

/**
 * График на листе «Разговора» (спека 5.7): столбики — горизонтальные полосы чернилами 55 %
 * (как .lp-bars лендинга), линия — чернилами без заливки. Голубого нет: синий на бумаге —
 * только карандаш Meldy.
 */
export default function ChartView({ visual, maxHeight }: { visual: ChartVisual; maxHeight?: number }) {
  const percent = isPercentUnit(visual.unit);
  const suffix = visual.unit && !percent ? ` ${visual.unit}` : '';
  const description = visual.data
    .map(point => `${point.label}: ${formatChartValue(point.value)}${percent ? '%' : ''}${suffix}`)
    .join('; ');
  if (visual.kind === 'bar') return <BarsView visual={visual} description={description} maxHeight={maxHeight} />;
  return <LineView visual={visual} description={description} maxHeight={maxHeight} />;
}
