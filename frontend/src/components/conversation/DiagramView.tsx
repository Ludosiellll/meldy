import { useId, useMemo, type CSSProperties } from 'react';
import type { DiagramVisual } from './types';
import { fitDiagram, type DiagramLayout, type LayoutEdge, type Point } from './diagramLayout';
import { useElementWidth } from './useElementWidth';

/** Рёбра на экране — 1,6 px, шеврон — 9 px, при любом уменьшении через viewBox. */
const EDGE_PX = 1.6;
const CHEVRON_PX = 9;
const CHEVRON_ANGLE = 0.45;
const HALO_PX = 4;

/** Проявление в начале реплики (спека 3.7): слова 150 мс, линии 250 мс, слои через 80 мс, всего ≤ 600 мс. */
export const REVEAL = { totalMs: 600, nodeMs: 150, edgeMs: 250, edgeLagMs: 100, stepMs: 80 } as const;

/** Шаг между слоями: 80 мс, но так, чтобы последняя линия дорисовалась за 600 мс. */
export function revealStep(maxLayer: number): number {
  if (maxLayer <= 0) return 0;
  return Math.min(REVEAL.stepMs, (REVEAL.totalMs - REVEAL.edgeLagMs - REVEAL.edgeMs) / maxLayer);
}

/**
 * Корень схемы — единственный узел, в который ничего не ведёт (у схемы одно начало);
 * у круговорота и у схемы с несколькими началами корня нет.
 */
export function rootNodeId(visual: Pick<DiagramVisual, 'nodes' | 'edges'>): string | null {
  const incoming = new Set(visual.edges.map(edge => edge.to));
  const outgoing = new Set(visual.edges.map(edge => edge.from));
  const sources = visual.nodes.filter(node => !incoming.has(node.id) && outgoing.has(node.id));
  return sources.length === 1 ? sources[0].id : null;
}

/** Конец линии и направление, в котором она в него входит. */
function lineEnd(edge: LayoutEdge): { end: Point; dx: number; dy: number } {
  const points = edge.points;
  const end = edge.curve ? edge.curve[3] : points[points.length - 1];
  let from = edge.curve ? edge.curve[2] : points[points.length - 2] ?? points[0];
  if (Math.hypot(end.x - from.x, end.y - from.y) < 0.5) from = points[Math.max(0, points.length - 3)] ?? from;
  return { end, dx: end.x - from.x, dy: end.y - from.y };
}

/** Открытый шеврон на конце линии: острие ровно в её конце. */
export function chevronPath(edge: LayoutEdge, size: number): string {
  const { end, dx, dy } = lineEnd(edge);
  const angle = Math.atan2(dy, dx);
  const arm = (turn: number) => ({ x: end.x + Math.cos(angle + Math.PI + turn) * size, y: end.y + Math.sin(angle + Math.PI + turn) * size });
  const a = arm(-CHEVRON_ANGLE);
  const b = arm(CHEVRON_ANGLE);
  const f = (value: number) => Math.round(value * 10) / 10;
  return `M${f(a.x)},${f(a.y)}L${f(end.x)},${f(end.y)}L${f(b.x)},${f(b.y)}`;
}

function delay(ms: number): CSSProperties | undefined {
  return ms > 0 ? { animationDelay: `${Math.round(ms)}ms` } : undefined;
}

export interface DiagramViewProps {
  visual: DiagramVisual;
  /** Сколько места у схемы на листе по высоте, px (без него — сколько нужно). */
  maxHeight?: number;
  /** Проявить схему по слоям (новая реплика, без prefers-reduced-motion). */
  reveal?: boolean;
}

/**
 * Схема на листе (спека 5.7, шаг А): узлы — слова Literata без рамок, корень — полужирный,
 * рёбра — кривые чернилами 60 % со стрелкой-шевроном, подписи рёбер — прямым начертанием
 * приглушённым цветом. Раскладка — layoutDiagram, место — правило fitDiagram: уменьшение
 * через viewBox не мельче 16/14 px, иначе кегль 16 и лист растёт, иначе прокрутка листа.
 */
export default function DiagramView({ visual, maxHeight, reveal = false }: DiagramViewProps) {
  const [ref, measured] = useElementWidth<HTMLDivElement>(560);
  const reactId = useId().replace(/:/g, '');
  const titleId = `diagram-title-${reactId}`;
  const descId = `diagram-desc-${reactId}`;
  const room = maxHeight && maxHeight > 0 ? maxHeight : Number.POSITIVE_INFINITY;

  const fit = useMemo(() => fitDiagram(visual.nodes, visual.edges, measured, room), [visual.nodes, visual.edges, measured, room]);
  const layout: DiagramLayout = fit.layout;
  const root = useMemo(() => rootNodeId(visual), [visual]);

  const labelById = new Map(visual.nodes.map(node => [node.id, node.label]));
  const description = visual.edges
    .map(edge => `${labelById.get(edge.from)} → ${labelById.get(edge.to)}${edge.label ? ` (${edge.label})` : ''}`)
    .join('; ');

  // Толщины заданы на экране: в единицах схемы они делятся на масштаб viewBox.
  const px = (value: number) => value / fit.scale;
  const layerOf = new Map(layout.boxes.map(box => [box.id, box.layer]));
  const maxLayer = Math.max(0, ...layout.boxes.map(box => box.layer));
  const step = revealStep(maxLayer);
  const nodeDelay = (layer: number) => layer * step;
  const edgeDelay = (edge: LayoutEdge) => nodeDelay(layerOf.get(edge.from) ?? 0) + REVEAL.edgeLagMs;
  const endDelay = (edge: LayoutEdge) => edgeDelay(edge) + REVEAL.edgeMs - REVEAL.nodeMs / 2;

  return (
    // Схема ниже отведённого места стоит посередине листа, как на кадре talk-ink.
    <div
      ref={ref}
      className="cv-dgm"
      data-overflow={fit.overflow ? '' : undefined}
      style={Number.isFinite(room) && !fit.overflow ? { minHeight: Math.floor(room) } : undefined}
    >
      <svg
        width={Math.round(fit.width)}
        height={Math.round(fit.height)}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        data-diagram-kind={layout.kind}
        data-font={layout.fontSize}
        data-scale={Math.round(fit.scale * 1000) / 1000}
        data-reveal={reveal ? '' : undefined}
      >
        <title id={titleId}>{visual.title}</title>
        <desc id={descId}>{description}</desc>

        {layout.edges.map(edge => (
          <path
            key={edge.key}
            className="cv-edge"
            data-edge={edge.key}
            d={edge.d}
            pathLength={1}
            strokeWidth={px(EDGE_PX)}
            style={reveal ? delay(edgeDelay(edge)) : undefined}
          >
            {/* Подписи без свободного места на схеме нет — она остаётся в подсказке у линии. */}
            {edge.label && !edge.labelText && <title>{edge.label}</title>}
          </path>
        ))}
        {layout.edges.map(edge => (
          <path
            key={`arrow-${edge.key}`}
            className="cv-arrow"
            d={chevronPath(edge, px(CHEVRON_PX))}
            strokeWidth={px(EDGE_PX)}
            style={reveal ? delay(endDelay(edge)) : undefined}
          />
        ))}

        {layout.boxes.map(box => {
          const top = box.y + box.h / 2 - ((box.lines.length - 1) * layout.lineHeight) / 2;
          return (
            <text
              key={box.id}
              className="cv-node"
              data-node={box.id}
              data-root={box.id === root ? '' : undefined}
              x={box.x + box.w / 2}
              y={top}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={layout.fontSize}
              style={reveal ? delay(nodeDelay(box.layer)) : undefined}
            >
              {box.lines.map((line, index) => (
                <tspan key={index} x={box.x + box.w / 2} dy={index === 0 ? 0 : layout.lineHeight}>
                  {line}
                </tspan>
              ))}
              {box.lines.join(' ') !== box.label && <title>{box.label}</title>}
            </text>
          );
        })}

        {layout.edges
          .filter(edge => edge.labelText && edge.labelX !== undefined && edge.labelY !== undefined)
          .map(edge => (
            <text
              key={`label-${edge.key}`}
              className="cv-elabel"
              x={edge.labelX}
              y={edge.labelY}
              textAnchor={edge.labelAnchor ?? 'middle'}
              dominantBaseline="central"
              fontSize={layout.labelSize}
              strokeWidth={px(HALO_PX)}
              style={reveal ? delay(endDelay(edge)) : undefined}
            >
              {edge.labelText}
              {edge.labelText !== edge.label && <title>{edge.label}</title>}
            </text>
          ))}
      </svg>
    </div>
  );
}
