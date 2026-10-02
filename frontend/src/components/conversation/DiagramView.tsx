import { useId, useMemo } from 'react';
import type { DiagramVisual } from './types';
import { layoutDiagram } from './diagramLayout';
import { useElementWidth } from './useElementWidth';

/** Линии и стрелки: спокойнее текста, но не тоньше 3:1 к фону в обеих темах. */
const EDGE_COLOR = 'color-mix(in srgb, var(--sf-ink) 52%, var(--sf-surface))';
const BOX_STROKE = 'color-mix(in srgb, var(--sf-ink) 38%, var(--sf-surface))';

export default function DiagramView({ visual }: { visual: DiagramVisual }) {
  const [ref, measured] = useElementWidth<HTMLDivElement>(560);
  const reactId = useId().replace(/:/g, '');
  const markerId = `diagram-arrow-${reactId}`;
  const titleId = `diagram-title-${reactId}`;
  const descId = `diagram-desc-${reactId}`;

  const layout = useMemo(
    () => layoutDiagram(visual.nodes, visual.edges, measured),
    [visual.nodes, visual.edges, measured],
  );

  const labelById = new Map(visual.nodes.map(node => [node.id, node.label]));
  const description = visual.edges
    .map(edge => `${labelById.get(edge.from)} → ${labelById.get(edge.to)}${edge.label ? ` (${edge.label})` : ''}`)
    .join('; ');

  return (
    <div ref={ref} className="w-full">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="block max-w-full overflow-visible"
        data-diagram-kind={layout.kind}
      >
        <title id={titleId}>{visual.title}</title>
        <desc id={descId}>{description}</desc>
        <defs>
          {/* Открытый шеврон: острие кончается ровно в конце линии. */}
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8.5"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="9"
            markerHeight="9"
            orient="auto-start-reverse"
          >
            <path
              d="M2.5,1.5 L8.5,5 L2.5,8.5"
              fill="none"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ stroke: EDGE_COLOR }}
            />
          </marker>
        </defs>

        {layout.edges.map(edge => (
          <path
            key={edge.key}
            d={edge.d}
            fill="none"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: EDGE_COLOR }}
            markerEnd={`url(#${markerId})`}
          />
        ))}

        {layout.boxes.map(box => {
          const textTop = box.y + box.h / 2 - ((box.lines.length - 1) * 17) / 2;
          return (
            <g key={box.id}>
              <rect
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                rx={4}
                strokeWidth={1}
                style={{ fill: 'var(--sf-surface)', stroke: BOX_STROKE }}
              />
              <text
                x={box.x + box.w / 2}
                y={textTop}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                style={{ fill: 'var(--sf-ink)' }}
              >
                {box.lines.map((line, index) => (
                  <tspan key={index} x={box.x + box.w / 2} dy={index === 0 ? 0 : 17}>
                    {line}
                  </tspan>
                ))}
                <title>{box.label}</title>
              </text>
            </g>
          );
        })}

        {layout.edges
          .filter(edge => edge.labelText && edge.labelX !== undefined && edge.labelY !== undefined)
          .map(edge => (
            <text
              key={`label-${edge.key}`}
              x={edge.labelX}
              y={edge.labelY}
              textAnchor={edge.labelAnchor ?? 'middle'}
              dominantBaseline="central"
              fontSize={11}
              strokeWidth={4}
              strokeLinejoin="round"
              paintOrder="stroke"
              style={{ fill: 'var(--sf-muted)', stroke: 'var(--sf-surface)' }}
            >
              {edge.labelText}
              <title>{edge.label}</title>
            </text>
          ))}
      </svg>
    </div>
  );
}
