import type { DocBlockType } from '../../types/testDoc';
import type { QuestionType } from './copyStudio';

/**
 * The studio's line icons (24 × 24, 1.8 stroke, round ends — as TypeChoice's glyphs). The words beside them carry the
 * meaning; an icon alone always has its name on the button (aria-label).
 */

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function BlockIcon({ type }: { type: Exclude<DocBlockType, 'question'> }) {
  return (
    <svg className="st-ico" viewBox="0 0 24 24" aria-hidden="true">
      {type === 'cover' ? (
        <>
          <rect x="3.5" y="4" width="17" height="16" rx="3" {...line} />
          <path d="M3.5 11h17" {...line} />
          <path d="M7.5 14.5h9M9.5 17h5" {...line} />
        </>
      ) : type === 'heading' ? (
        <path d="M6 5v14M18 5v14M6 12h12" {...line} />
      ) : type === 'text' ? (
        <path d="M4.5 6.5h15M4.5 10.5h15M4.5 14.5h15M4.5 18.5h9" {...line} />
      ) : type === 'image' ? (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="3" {...line} />
          <path d="M4 16.5l4.6-4.3 3.4 3 2.8-2.5 4.7 4.3" {...line} />
          <path d="M14.5 8.5h2" {...line} />
        </>
      ) : type === 'note' ? (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="3.5" {...line} />
          <path d="M8 10h8M8 14h5" {...line} />
        </>
      ) : type === 'divider' ? (
        <>
          <path d="M4 12h16" {...line} />
          <path d="M8 7.5h8M8 16.5h8" {...line} strokeOpacity=".45" />
        </>
      ) : (
        <>
          <path d="M6.5 3.5h7l4 4v13h-11z" {...line} />
          <path d="M13.5 3.5v4h4" {...line} />
          <path d="M9.5 14h5M12 11.5l2.5 2.5-2.5 2.5" {...line} />
        </>
      )}
    </svg>
  );
}

export function QuestionIcon({ type }: { type: QuestionType }) {
  return (
    <svg className="st-ico" viewBox="0 0 24 24" aria-hidden="true">
      {type === 'single' ? (
        <>
          <circle cx="12" cy="12" r="8" {...line} />
          <circle cx="12" cy="12" r="3.5" fill="currentColor" />
        </>
      ) : type === 'multiple' ? (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" {...line} />
          <rect x="13.5" y="13.5" width="7" height="7" rx="2" {...line} />
          <path d="M5.3 7l1.4 1.4 2.4-2.6M15.3 17l1.4 1.4 2.4-2.6" {...line} />
        </>
      ) : type === 'short' ? (
        <>
          <rect x="3" y="7" width="18" height="10" rx="3" {...line} />
          <path d="M7.5 10v4" {...line} />
        </>
      ) : (
        <path d="M4.5 12.5l3 3 5-6.5M14 9l6 6M20 9l-6 6" {...line} />
      )}
    </svg>
  );
}

type UiName =
  | 'undo'
  | 'redo'
  | 'phone'
  | 'desktop'
  | 'eye'
  | 'check'
  | 'copy'
  | 'trash'
  | 'up'
  | 'down'
  | 'grip'
  | 'plus'
  | 'close'
  | 'sliders'
  | 'list'
  | 'canvas'
  | 'text'
  | 'back';

export function UiIcon({ name, className = 'st-ui-ico' }: { name: UiName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {name === 'undo' ? (
        <path d="M9 7.5L5 11.5l4 4M5.5 11.5H15a4.5 4.5 0 010 9h-2.5" {...line} />
      ) : name === 'redo' ? (
        <path d="M15 7.5l4 4-4 4M18.5 11.5H9a4.5 4.5 0 000 9h2.5" {...line} />
      ) : name === 'phone' ? (
        <>
          <rect x="7" y="3" width="10" height="18" rx="2.6" {...line} />
          <path d="M11 17.5h2" {...line} />
        </>
      ) : name === 'desktop' ? (
        <>
          <rect x="3" y="4.5" width="18" height="12" rx="2.4" {...line} />
          <path d="M9 20h6M12 16.5V20" {...line} />
        </>
      ) : name === 'eye' ? (
        <>
          <path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z" {...line} />
          <circle cx="12" cy="12" r="2.8" {...line} />
        </>
      ) : name === 'check' ? (
        <>
          <path d="M4.5 12.5l4 4 9-10" {...line} />
        </>
      ) : name === 'copy' ? (
        <>
          <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" {...line} />
          <path d="M15.5 8.5V6.5a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2" {...line} />
        </>
      ) : name === 'trash' ? (
        <path d="M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7M10.5 10.5v5.5M13.5 10.5v5.5" {...line} />
      ) : name === 'up' ? (
        <path d="M12 18.5v-13M7 10.5l5-5 5 5" {...line} />
      ) : name === 'down' ? (
        <path d="M12 5.5v13M7 13.5l5 5 5-5" {...line} />
      ) : name === 'grip' ? (
        <>
          {[7, 12, 17].map((y) => (
            <g key={y}>
              <circle cx="9" cy={y} r="1.5" fill="currentColor" />
              <circle cx="15" cy={y} r="1.5" fill="currentColor" />
            </g>
          ))}
        </>
      ) : name === 'plus' ? (
        <path d="M12 5v14M5 12h14" {...line} />
      ) : name === 'close' ? (
        <path d="M6 6l12 12M18 6L6 18" {...line} />
      ) : name === 'sliders' ? (
        <path d="M5 7h9M18 7h1M5 17h3M12 17h7M14 4.5v5M8 14.5v5" {...line} />
      ) : name === 'list' ? (
        <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.5M4.5 12h.5M4.5 17h.5" {...line} />
      ) : name === 'canvas' ? (
        <>
          <rect x="4" y="3.5" width="16" height="17" rx="3" {...line} />
          <path d="M8 8h8M8 12h8M8 16h4" {...line} />
        </>
      ) : name === 'text' ? (
        <path d="M5 6.5h14M12 6.5v12M9 18.5h6" {...line} />
      ) : (
        <path d="M15 5.5L8.5 12l6.5 6.5" {...line} />
      )}
    </svg>
  );
}
