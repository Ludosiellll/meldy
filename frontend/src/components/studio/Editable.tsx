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
 *
 * A text that is still the words its block started with (`starter`, lib/studio/doc.ts BLOCK_WORDS: «Заметка»,
 * «Заголовок»…) opens selected whole, so the first key typed replaces it (live check of release 47.2: a new note took
 * «Заметка 47.2» after its own word, «ЗаметкаЗаметка 47.2»); «/» then asks for the block menu as in an empty block. Any
 * other text opens with the cursor at its end.
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
  /** The words the block started with: while the value is still them, editing starts with them selected. */
  starter?: string;
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

/**
 * The field as high as its words. Words only added can only make it higher: it is measured as it stands (one read of the
 * layout, no write when the height stays). Otherwise it is let go first, so it can get lower.
 */
function fit(field: HTMLTextAreaElement, grew = false) {
  if (!grew) field.style.height = 'auto';
  const height = field.scrollHeight;
  if (height > 0 && field.style.height !== `${height}px`) field.style.height = `${height}px`;
}

/** `after` is `before` with words put in at one place, nothing taken away (a key typed, a paste without a selection). */
function onlyAdded(before: string, after: string): boolean {
  if (after.length <= before.length) return false;
  let head = 0;
  while (head < before.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  return head + tail === before.length;
}

/** The value is still the block's own first words (and nothing else is typed yet). */
const isStarter = (value: string, starter: string | undefined) => starter !== undefined && starter !== '' && value === starter;

export default function Editable({ value, onChange, label, as: Tag = 'div', className, rich = false, multiline = false, max, placeholder, starter, active, onActivate, onDone, onSlash }: EditableProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [linking, setLinking] = useState<{ start: number; end: number } | null>(null);
  const [href, setHref] = useState('https://');
  const [bad, setBad] = useState(false);
  const linkId = useId();
  // The selection to restore after a mark changed the words.
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  // The height follows the words and the width only (the smoothness audit of 20.10: it was measured at every render, the
  // field let go to `auto` and back — a forced layout of the page each time).
  const fitted = useRef<string | null>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) {
      fitted.current = null;
      return;
    }
    if (fitted.current !== value) {
      const before = fitted.current;
      fitted.current = value;
      fit(field, before !== null && onlyAdded(before, value));
    }
    const selection = pendingSelection.current;
    if (selection) {
      pendingSelection.current = null;
      field.setSelectionRange(selection.start, selection.end);
    }
  });
  useEffect(() => {
    const field = fieldRef.current;
    if (!active || !field || typeof ResizeObserver === 'undefined') return undefined;
    let width = field.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (field.offsetWidth === width) return;
      width = field.offsetWidth;
      fit(field);
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (!active) {
      setLinking(null);
      return;
    }
    const field = fieldRef.current;
    if (field && document.activeElement !== field) {
      field.focus({ preventScroll: true });
      const end = field.value.length;
      // The block's own first words are taken whole: typing replaces them.
      field.setSelectionRange(isStarter(field.value, starter) ? 0 : end, end);
    }
    // Only on the start of editing: the words typed since are the author's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const field = event.currentTarget;
    // An empty block, or one still holding its own first words, all of them selected (typing would replace them).
    const blank = field.value === '' || (isStarter(field.value, starter) && field.selectionStart === 0 && field.selectionEnd === field.value.length);
    if (event.key === '/' && onSlash && blank && !ctrl && !event.altKey) {
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
