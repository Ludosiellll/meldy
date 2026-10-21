import type { ReactNode } from 'react';

/**
 * Texts that take turns in one place: all of them are laid out in one grid cell (home3.css .p3-swap), so the place
 * is as large as the largest and a change moves nothing around it. The ones not shown are hidden from screen readers.
 */
export default function Swap({ items, at, className = '' }: { items: readonly ReactNode[]; at: number; className?: string }) {
  return (
    <span className={`p3-swap ${className}`.trim()}>
      {items.map((item, index) => (
        <span key={index} className={index === at ? 'is-on' : index < at ? 'is-past' : undefined} aria-hidden={index === at ? undefined : true}>
          {item}
        </span>
      ))}
    </span>
  );
}
