import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface SkillsRadarChartProps {
  data: Record<string, number>; // axis -> value 0-100
  size?: number;
  className?: string;
}

const DEFAULT_AXES = ['Algorithms', 'SQL/Data', 'Web Dev', 'Soft Skills', 'Architecture', 'Business Logic'];
const COLORS = {
  fill: 'rgba(99, 102, 241, 0.25)',
  stroke: 'rgba(99, 102, 241, 0.85)',
  grid: 'rgba(100, 116, 139, 0.2)',
  label: '#94a3b8',
  dot: '#6366f1',
};

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad - Math.PI / 2),
    y: cy + r * Math.sin(angleRad - Math.PI / 2),
  };
}

export default function SkillsRadarChart({ data, size = 220, className = '' }: SkillsRadarChartProps) {
  // Determine axes: prefer axes from data (up to 6), fill with defaults
  const axes = Object.keys(data).length > 0
    ? Object.keys(data).slice(0, 6)
    : DEFAULT_AXES;

  const n = axes.length;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 30; // balanced radius with padded viewBox
  const levels = 4;
  const padX = 70; // large horizontal padding to accommodate long labels (e.g. Code Quality)
  const padY = 30; // vertical padding for labels

  // Compute angle for each axis
  const angle = (i: number) => (2 * Math.PI * i) / n;

  // Grid polygon points for each level
  const gridPolygon = (level: number) => {
    const r = (maxR * level) / levels;
    return Array.from({ length: n }, (_, i) => {
      const pt = polarToCartesian(cx, cy, r, angle(i));
      return `${pt.x},${pt.y}`;
    }).join(' ');
  };

  // Data polygon
  const dataPolygon = axes.map((axis, i) => {
    const val = Math.min(100, Math.max(0, data[axis] ?? 0));
    const r = (maxR * val) / 100;
    const pt = polarToCartesian(cx, cy, r, angle(i));
    return `${pt.x},${pt.y}`;
  }).join(' ');

  return (
    <div className={`flex flex-col items-center gap-3 px-4 ${className}`}>
      <svg
        width={size} height={size}
        viewBox={`-${padX} -${padY} ${size + 2 * padX} ${size + 2 * padY}`}
        overflow="visible"
        style={{ overflow: 'visible' }}
      >
        {/* Grid levels */}
        {Array.from({ length: levels }, (_, lv) => (
          <polygon
            key={lv}
            points={gridPolygon(lv + 1)}
            fill="none"
            stroke={COLORS.grid}
            strokeWidth={1}
          />
        ))}

        {/* Axis lines */}
        {axes.map((_, i) => {
          const outer = polarToCartesian(cx, cy, maxR, angle(i));
          return (
            <line
              key={i}
              x1={cx} y1={cy}
              x2={outer.x} y2={outer.y}
              stroke={COLORS.grid}
              strokeWidth={1}
            />
          );
        })}

        {/* Data polygon */}
        <motion.polygon
          points={dataPolygon}
          fill={COLORS.fill}
          stroke={COLORS.stroke}
          strokeWidth={2}
          strokeLinejoin="round"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        />

        {/* Data dots */}
        {axes.map((axis, i) => {
          const val = Math.min(100, Math.max(0, data[axis] ?? 0));
          const r = (maxR * val) / 100;
          const pt = polarToCartesian(cx, cy, r, angle(i));
          return (
            <motion.circle
              key={i}
              cx={pt.x} cy={pt.y} r={4}
              fill={COLORS.dot}
              stroke="#1e1b4b"
              strokeWidth={1.5}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4 + i * 0.05 }}
            />
          );
        })}

        {/* Axis labels */}
        {axes.map((axis, i) => {
          const labelR = maxR + 14;
          const pt = polarToCartesian(cx, cy, labelR, angle(i));
          const textAnchor =
            pt.x < cx - 8 ? 'end' : pt.x > cx + 8 ? 'start' : 'middle';
          // Split long labels into 2 lines
          const words = axis.split(/\s+/);
          const line1 = words.slice(0, Math.ceil(words.length / 2)).join(' ');
          const line2 = words.length > 1 ? words.slice(Math.ceil(words.length / 2)).join(' ') : null;
          return (
            <text
              key={i}
              x={pt.x}
              y={line2 ? pt.y : pt.y + 4}
              textAnchor={textAnchor}
              fontSize={9}
              fill={COLORS.label}
              fontWeight="600"
              fontFamily="Inter, system-ui, sans-serif"
            >
              <tspan x={pt.x} dy="0">{line1}</tspan>
              {line2 && <tspan x={pt.x} dy="11">{line2}</tspan>}
            </text>
          );
        })}
      </svg>

      {/* Legend chips */}
      <div className="flex flex-wrap justify-center gap-1.5 px-2">
        {axes.map(axis => (
          <div key={axis} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: `hsl(${239 - (data[axis] ?? 0) * 0.5}, 80%, 60%)` }}
            />
            {axis}: <span className="text-slate-700 dark:text-slate-200">{data[axis] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
