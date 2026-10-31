import { useEffect, useRef, type Ref } from 'react';
import { KINDS } from './copyKinds';

/** «Число» (release 48): one field, the decimal keyboard on a phone, the unit after the number (muted, outside the value). */
export function NumberField({
  id,
  value,
  unit,
  onChange,
  onSubmit,
  readOnly = false,
  invalid = false,
  state,
}: {
  id: string;
  value: string;
  unit?: string | null;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  readOnly?: boolean;
  invalid?: boolean;
  state?: 'right' | 'wrong';
}) {
  return (
    <form
      className="ct-short kd-number"
      data-state={state}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <label htmlFor={id}>{KINDS.numberLabel}</label>
      <span className="kd-number-box">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          maxLength={200}
          value={value}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={unit ? `${id}-unit` : undefined}
          onChange={(event) => onChange?.(event.target.value)}
        />
        {unit ? (
          <span className="kd-unit" id={`${id}-unit`}>
            {unit}
          </span>
        ) : null}
      </span>
    </form>
  );
}

export const ESSAY_MAX = 6000;

/** «Развёрнутый ответ» (release 48): a field that grows with the answer, the count of characters under it. */
export function EssayField({
  id,
  value,
  onChange,
  readOnly = false,
  invalid = false,
  fieldRef,
}: {
  id: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  invalid?: boolean;
  fieldRef?: Ref<HTMLTextAreaElement>;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const node = own.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(640, Math.max(160, node.scrollHeight + 2))}px`;
  }, [value]);
  return (
    <div className="ct-short kd-essay">
      <label htmlFor={id}>{KINDS.essayLabel}</label>
      <textarea
        id={id}
        ref={(node) => {
          own.current = node;
          if (typeof fieldRef === 'function') fieldRef(node);
          else if (fieldRef && typeof fieldRef === 'object') (fieldRef as { current: HTMLTextAreaElement | null }).current = node;
        }}
        value={value}
        maxLength={ESSAY_MAX}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-count`}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <p className="kd-count" id={`${id}-count`}>
        {KINDS.essayCount([...value].length, ESSAY_MAX)}
      </p>
    </div>
  );
}
