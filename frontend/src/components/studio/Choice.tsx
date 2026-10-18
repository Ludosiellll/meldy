import { useId, type ReactNode } from 'react';

/**
 * One choice of a few (alignment, size, font, layout …): pills in a row, the chosen one dark, as the app's own
 * segmented pills. Each is a button with aria-pressed inside a labelled group; `wide` puts each on its own line with
 * its hint (the layouts).
 */
export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** A small drawing before the word (decoration: the word carries the meaning). */
  icon?: ReactNode;
  hint?: string;
  /** Inline style of the word (a font shown in itself). */
  style?: React.CSSProperties;
}

export default function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  wide = false,
  hideLabel = false,
}: {
  label: string;
  options: ReadonlyArray<ChoiceOption<T>>;
  value: T;
  onChange: (value: T) => void;
  wide?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="st-choice" data-wide={wide ? '' : undefined}>
      <p id={id} className={hideLabel ? 'sr-only' : 'st-field-label'}>
        {label}
      </p>
      <div className="st-choice-row" role="group" aria-labelledby={id}>
        {options.map((option) => {
          const hinted = wide && option.hint;
          return (
            <button
              key={option.value}
              type="button"
              className="st-choice-opt"
              aria-pressed={option.value === value}
              aria-label={hinted ? option.label : undefined}
              aria-describedby={hinted ? `${id}-${option.value}` : undefined}
              onClick={() => onChange(option.value)}
            >
              {option.icon ? <span className="st-choice-ico">{option.icon}</span> : null}
              <span className="st-choice-word" style={option.style}>
                {option.label}
              </span>
              {hinted ? (
                <span className="st-choice-hint" id={`${id}-${option.value}`}>
                  {option.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
