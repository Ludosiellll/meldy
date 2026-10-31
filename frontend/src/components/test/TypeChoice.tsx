import { useId } from 'react';
import { BUILD_TYPES } from './buildModel';
import { BUILD, type BuildType } from './copyTest';

/**
 * «Какой вопрос добавить»: the four kinds as white pills, each with a small drawing of its answer (one circle ticked,
 * several boxes ticked, a line to write on, «В / Н»). The words carry the meaning; the drawings are decoration.
 */

function Glyph({ type }: { type: BuildType }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg className="tb-type-glyph" viewBox="0 0 24 24" aria-hidden="true">
      {type === 'single' ? (
        <>
          <circle cx="12" cy="12" r="8" {...common} />
          <circle cx="12" cy="12" r="3.5" fill="currentColor" />
        </>
      ) : type === 'multiple' ? (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" {...common} />
          <rect x="13.5" y="13.5" width="7" height="7" rx="2" {...common} />
          <path d="M5.3 7l1.4 1.4 2.4-2.6M15.3 17l1.4 1.4 2.4-2.6" {...common} />
        </>
      ) : type === 'short' ? (
        <>
          <rect x="3" y="7" width="18" height="10" rx="3" {...common} />
          <path d="M7.5 10v4" {...common} />
        </>
      ) : type === 'number' ? (
        <path d="M9.5 4.5L8 19.5M16 4.5l-1.5 15M4.5 9h15M4 15h15" {...common} />
      ) : type === 'order' ? (
        <>
          <path d="M9 6.5h11M9 12h11M9 17.5h11" {...common} />
          <path d="M4 5.5l1.2-.8v3.6M3.8 11c.4-.6 2.2-.7 2.2.5 0 .9-2.2 1.8-2.2 2.6h2.4M3.9 16.3c.5-.6 2.1-.5 2.1.4 0 .6-.7.8-1 .8.4 0 1.1.2 1.1.9 0 .9-1.7 1.1-2.3.4" {...common} />
        </>
      ) : type === 'match' ? (
        <>
          <circle cx="5" cy="7" r="1.8" {...common} />
          <circle cx="5" cy="17" r="1.8" {...common} />
          <circle cx="19" cy="7" r="1.8" {...common} />
          <circle cx="19" cy="17" r="1.8" {...common} />
          <path d="M6.8 7.6l10.4 8.8M6.8 16.4l10.4-8.8" {...common} />
        </>
      ) : type === 'cloze' ? (
        <>
          <path d="M3.5 9h5M16 9h4.5M3.5 15h3M14 15h6.5" {...common} />
          <rect x="9.5" y="6.5" width="5.5" height="5" rx="1.5" {...common} />
          <rect x="7.5" y="12.5" width="5.5" height="5" rx="1.5" {...common} />
        </>
      ) : type === 'essay' ? (
        <path d="M4 6.5h16M4 10.5h16M4 14.5h16M4 18.5h9" {...common} />
      ) : (
        <path d="M4.5 12.5l3 3 5-6.5M14 9l6 6M20 9l-6 6" {...common} />
      )}
    </svg>
  );
}

interface Props {
  onPick: (type: BuildType) => void;
  onCancel?: () => void;
  /** The words above already ask it (an empty test): the label is only read out. */
  quietLabel?: boolean;
  /** The kinds offered (the release-47 four by default). */
  types?: readonly BuildType[];
}

export default function TypeChoice({ onPick, onCancel, quietLabel = false, types = BUILD_TYPES }: Props) {
  const labelId = useId();
  return (
    <div className="tb-types" role="group" aria-labelledby={labelId}>
      <p id={labelId} className={quietLabel ? 'sr-only' : 'tb-types-label'}>
        {BUILD.typeChoice}
      </p>
      <div className="tb-types-row">
        {types.map((type) => (
          <button key={type} type="button" className="tb-type" data-type={type} onClick={() => onPick(type)}>
            <Glyph type={type} />
            <span>{BUILD.types[type]}</span>
          </button>
        ))}
        {onCancel ? (
          <button type="button" className="sf-link tb-types-cancel" data-muted="" onClick={onCancel}>
            {BUILD.cancel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
