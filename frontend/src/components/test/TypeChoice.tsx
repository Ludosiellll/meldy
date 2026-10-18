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
}

export default function TypeChoice({ onPick, onCancel, quietLabel = false }: Props) {
  const labelId = useId();
  return (
    <div className="tb-types" role="group" aria-labelledby={labelId}>
      <p id={labelId} className={quietLabel ? 'sr-only' : 'tb-types-label'}>
        {BUILD.typeChoice}
      </p>
      <div className="tb-types-row">
        {BUILD_TYPES.map((type) => (
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
