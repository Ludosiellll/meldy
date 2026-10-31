/**
 * The pieces of the teacher's setup pages under /live (LiveSetupPage «Провести игру», ChallengeSetupPage «Соревнование
 * по ссылке»): a row with its label and hint, and a segmented choice (radio buttons as pills). Styles: host.css .lvs-*.
 */
import type { ReactNode } from 'react';

export interface SegProps<T extends string | number | boolean> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; text: string }>;
  onChange: (v: T) => void;
}

export function Seg<T extends string | number | boolean>({ label, value, options, onChange }: SegProps<T>) {
  return (
    <div className="lvs-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="lvs-row">
      <span className="lvs-row-label">
        {label}
        {hint ? <span className="lvs-hint">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}
