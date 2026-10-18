import { useEffect, useId, useLayoutEffect, useRef, useState, type ElementType, type KeyboardEvent } from 'react';
import { chars, oneLine } from '../../lib/studio/doc';
import Rich from './Rich';
import { STUDIO } from './copyStudio';

/**
 * A text of the page edited where it stands (spec §47.6 «клик по тексту — правка на месте»): the words as the
 * participant sees them until a click (or Enter on the block), then a plain field with the same font in their place —
 * never HTML. A rich field (a text block, a note, a result message) keeps its three marks as typed, **жирный**,
 * *курсив* and [слова](https://…), and shows a small bar for them while it has the focus (Ctrl+B, Ctrl+I, Ctrl+K do
 * the same). A one-line field ends on Enter; a text field breaks the line. «/» in an empty text block asks the page for
 * the block menu (`onSlash`).
 */

export interface EditableProps {
  value: string;
  onChange: (value: string) => void;
  /** What the field is, read out: «Заголовок», «Подпись»… */
  label: string;
  as?: ElementType;
  className?: string;
  rich?: boolean;
  multiline?: boolean;
  max: number;
  /** Shown in place of an empty value while editing is possible. */
  placeholder?: string;
  active: boolean;
  onActivate: () => void;
  onDone: (how: 'blur' | 'enter' | 'escape') => void;
  onSlash?: (anchor: HTMLElement) => void;
}

type Mark = 'bold' | 'italic' | 'link';

/** The selection wrapped in a mark: «**…**», «*…*», «[…](address)». An empty selection gets the mark's word. */
export function wrapMark(value: string, start: number, end: number, mark: Mark, href = ''): { value: string; start: number; end: number } {
  const picked = value.slice(start, end) || (mark === 'link' ? 'ссылка' : mark === 'bold' ? 'жирный' : 'курсив');
  const open = mark === 'bold' ? '**' : mark === 'italic' ? '*' : '[';
  const close = mark === 'bold' ? '**' : mark === 'italic' ? '*' : `](${href})`;
  const next = `${value.slice(0, start)}${open}${picked}${close}${value.slice(end)}`;
  return { value: next, start: start + open.length, end: start + open.length + picked.length };
}

function fit(field: HTMLTextAreaElement) {
  field.style.height = 'auto';
  const height = field.scrollHeight;
  if (height > 0) field.style.height = `${height}px`;
}

export default function Editable({ value, onChange, label, as: Tag = 'div', className, rich = false, multiline = false, max, placeholder, active, onActivate, onDone, onSlash }: EditableProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [linking, setLinking] = useState<{ start: number; end: number } | null>(null);
  const [href, setHref] = useState('https://');
  const [bad, setBad] = useState(false);
  const linkId = useId();
  // The selection to restore after a mark changed the words.
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    fit(field);
    const selection = pendingSelection.current;
    if (selection) {
      pendingSelection.current = null;
      field.setSelectionRange(selection.start, selection.end);
    }
  });

  useEffect(() => {
    if (!active) {
      setLinking(null);
      return;
    }
    const field = fieldRef.current;
    if (field && document.activeElement !== field) {
      field.focus({ preventScroll: true });
      const end = field.value.length;
      field.setSelectionRange(end, end);
    }
  }, [active]);

  const set = (next: string) => onChange(multiline ? next : oneLine(next));

  const mark = (kind: Mark) => {
    const field = fieldRef.current;
    if (!field) return;
    if (kind === 'link') {
      setLinking({ start: field.selectionStart, end: field.selectionEnd });
      setHref('https://');
      setBad(false);
      return;
    }
    const made = wrapMark(field.value, field.selectionStart, field.selectionEnd, kind);
    if (chars(made.value) > max) return;
    pendingSelection.current = { start: made.start, end: made.end };
    set(made.value);
    field.focus({ preventScroll: true });
  };

  const putLink = () => {
    if (!linking) return;
    const address = href.trim();
    if (!/^https:\/\/\S+$/.test(address) || chars(address) > 300) {
      setBad(true);
      return;
    }
    const made = wrapMark(fieldRef.current?.value ?? value, linking.start, linking.end, 'link', address);
    setLinking(null);
    if (chars(made.value) > max) return;
    pendingSelection.current = { start: made.start, end: made.end };
    set(made.value);
    fieldRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (rich && ctrl && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      // The Russian layout's letters on the same keys: и (b), ш (i), л (k).
      const kind: Mark | null = key === 'b' || key === 'и' ? 'bold' : key === 'i' || key === 'ш' ? 'italic' : key === 'k' || key === 'л' ? 'link' : null;
      if (kind) {
        event.preventDefault();
        mark(kind);
        return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDone('escape');
      return;
    }
    if (event.key === 'Enter' && !multiline) {
      event.preventDefault();
      onDone('enter');
      return;
    }
    if (event.key === '/' && onSlash && event.currentTarget.value === '' && !ctrl && !event.altKey) {
      event.preventDefault();
      onSlash(event.currentTarget);
    }
  };

  if (!active) {
    const empty = value.trim() === '';
    return (
      <Tag className={className} data-empty={empty ? '' : undefined} onClick={onActivate}>
        {empty ? <span className="st-placeholder">{placeholder ?? label}</span> : rich ? <Rich text={value} /> : value}
      </Tag>
    );
  }

  return (
    <Tag className={className} data-editing="">
      {rich ? (
        <span className="st-marks" role="toolbar" aria-label={STUDIO.marksLabel} onMouseDown={(event) => event.preventDefault()}>
          {linking ? (
            <span className="st-marks-link">
              <input
                id={linkId}
                className="st-marks-href"
                type="url"
                inputMode="url"
                value={href}
                aria-label={STUDIO.linkAsk}
                aria-invalid={bad || undefined}
                autoFocus
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  setHref(event.target.value);
                  setBad(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    putLink();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setLinking(null);
                    fieldRef.current?.focus({ preventScroll: true });
                  }
                }}
              />
              <button type="button" className="st-mark st-mark-word" onClick={putLink}>
                {STUDIO.linkPut}
              </button>
              {bad ? (
                <span className="st-marks-bad" role="alert">
                  {STUDIO.linkBad}
                </span>
              ) : null}
            </span>
          ) : (
            <>
              <button type="button" className="st-mark" aria-label={STUDIO.marks.bold} title={`${STUDIO.marks.bold} · Ctrl+B`} onClick={() => mark('bold')}>
                <b aria-hidden="true">Ж</b>
              </button>
              <button type="button" className="st-mark" aria-label={STUDIO.marks.italic} title={`${STUDIO.marks.italic} · Ctrl+I`} onClick={() => mark('italic')}>
                <i aria-hidden="true">К</i>
              </button>
              <button type="button" className="st-mark st-mark-word" title={`${STUDIO.marks.link} · Ctrl+K`} onClick={() => mark('link')}>
                {STUDIO.marks.link}
              </button>
            </>
          )}
        </span>
      ) : null}
      <textarea
        ref={fieldRef}
        className="st-field"
        value={value}
        rows={1}
        aria-label={label}
        placeholder={placeholder}
        maxLength={max + 50}
        spellCheck
        onChange={(event) => set(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // The link's own field takes the focus for a moment: that is not the end of editing.
          const next = event.relatedTarget as HTMLElement | null;
          if (next && event.currentTarget.parentElement?.contains(next)) return;
          onDone('blur');
        }}
      />
    </Tag>
  );
}
