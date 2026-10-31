/**
 * The phone's keypad for a number question (CONTRACT §15, 20261102090100_live_numbers.sql): the number as typed with
 * the question's unit after it, digits, a comma, «−» (it turns the sign over), «⌫», and «Ответить». The phone's own
 * keyboard never opens (a battle screen has no room for it, and many phones' number keyboards have no minus or no
 * comma); a computer's keyboard types into the pad too. The server reads the text as the number rule does.
 */
import { memo, useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { numberText, padKeyOf, padPress, padReady, type PadKey } from '../../../lib/live/numbers';
import { KINDS } from './copy';

const ROWS: PadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['-', '0', ','],
];

const LABEL: Partial<Record<PadKey, string>> = { '-': KINDS.padMinus, ',': KINDS.padComma, back: KINDS.padBack };
const FACE: Partial<Record<PadKey, string>> = { '-': '\u2212', back: '⌫' };

export interface NumberPadProps {
  value: string;
  unit: string | null;
  /** The keys and «Ответить» take presses (the question is open, nothing sent yet). */
  enabled: boolean;
  onChange: (next: string) => void;
  onSend: () => void;
  onKey?: () => void;
}

export const NumberPad = memo(function NumberPad({ value, unit, enabled, onChange, onSend, onKey }: NumberPadProps) {
  const latest = useRef(value);
  latest.current = value;
  const press = useCallback(
    (key: PadKey) => {
      if (!enabled) return;
      const next = padPress(latest.current, key);
      if (next !== latest.current) {
        onKey?.();
        onChange(next);
      }
    },
    [enabled, onChange, onKey],
  );
  const ready = enabled && padReady(value);
  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // a computer's keyboard: digits, «,» or «.», «-», Backspace, Enter
  useEffect(() => {
    const onDoc = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Enter') {
        if (readyRef.current) {
          e.preventDefault();
          sendRef.current();
        }
        return;
      }
      const key = padKeyOf(e.key);
      if (key) {
        e.preventDefault();
        press(key);
      }
    };
    document.addEventListener('keydown', onDoc);
    return () => document.removeEventListener('keydown', onDoc);
  }, [press]);
  const stop = (e: KeyboardEvent<HTMLButtonElement>) => {
    // Enter or Space on a focused key presses that key (the button's own click), not «Ответить»
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  };
  const shown = value === '' ? null : numberText(value);
  return (
    <div className="lp-pad" data-off={enabled ? undefined : 'true'}>
      <div className="lp-pad__screen">
        <output className="lp-pad__value" aria-label={KINDS.padValue} aria-live="polite" data-empty={shown === null ? 'true' : undefined}>
          {shown ?? '0'}
        </output>
        {unit ? <span className="lp-pad__unit">{unit}</span> : null}
        <button type="button" className="lp-pad__key lp-pad__key--back" aria-label={LABEL.back} disabled={!enabled || value === ''} onClick={() => press('back')} onKeyDown={stop}>
          {FACE.back}
        </button>
      </div>
      <div className="lp-pad__keys" role="group" aria-label={KINDS.padLabel}>
        {ROWS.flat().map((key) => (
          <button
            key={key}
            type="button"
            className="lp-pad__key"
            data-key={key === '-' || key === ',' ? 'mark' : undefined}
            aria-label={LABEL[key]}
            disabled={!enabled}
            onClick={() => press(key)}
            onKeyDown={stop}
          >
            {FACE[key] ?? key}
          </button>
        ))}
      </div>
      <button type="button" className="lp-btn lp-btn--main lp-send" disabled={!ready} onClick={() => onSend()}>
        {KINDS.send}
      </button>
    </div>
  );
});
