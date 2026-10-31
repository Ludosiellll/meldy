/** Line icons of release 49's entries (the studio's icon set draws the same way: 24 × 24, 1.75 stroke). */
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function DownloadIcon({ className = 'st-ui-ico' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5M4.5 15.5v2a2.5 2.5 0 002.5 2.5h10a2.5 2.5 0 002.5-2.5v-2" {...line} />
    </svg>
  );
}

export function GenerateIcon({ className = 'st-ico' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4.5l1.6 4.4L16 10.5l-4.4 1.6L10 16.5l-1.6-4.4L4 10.5l4.4-1.6L10 4.5zM17.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" {...line} />
    </svg>
  );
}
