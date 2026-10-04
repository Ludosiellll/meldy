import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import './paperSelect.css';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list' | 'role'>;

interface PaperSuggestInputProps extends InputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Words to offer under the field (the subjects of the lectures). */
  suggestions: readonly string[];
  /** How many to show at once. */
  limit?: number;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
}

/** Suggestions for a typed text: those that start with it first, then those that contain it; never the text itself. */
export function matchSuggestions(suggestions: readonly string[], typed: string, limit = 8): string[] {
  const needle = normalize(typed);
  const unique = Array.from(new Set(suggestions.map((item) => item.trim()).filter(Boolean)));
  if (!needle) return unique.slice(0, limit);
  const starts = unique.filter((item) => normalize(item).startsWith(needle) && normalize(item) !== needle);
  const contains = unique.filter((item) => !normalize(item).startsWith(needle) && normalize(item).includes(needle));
  return [...starts, ...contains].slice(0, limit);
}

/**
 * A text field with suggestions under it, in the paper style of PaperSelect, instead of the browser's
 * <datalist> popup (white and grey in the dark theme). The text stays free: a suggestion only fills it.
 * Keyboard as in a combobox with a list: arrows choose, Enter takes the chosen one, Esc closes.
 */
export default function PaperSuggestInput({ value, onValueChange, suggestions, limit = 8, onKeyDown, onFocus, onBlur, className, ...rest }: PaperSuggestInputProps) {
  const id = useId();
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const items = open ? matchSuggestions(suggestions, value, limit) : [];
  const shown = open && items.length > 0;

  useEffect(() => {
    setActive(-1);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const take = (item: string) => {
    onValueChange(item);
    setOpen(false);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else if (items.length > 0) setActive((index) => (index + 1) % items.length);
      return;
    }
    if (event.key === 'ArrowUp' && shown) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? items.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter' && shown && active >= 0) {
      event.preventDefault();
      take(items[active]);
      return;
    }
    if (event.key === 'Escape' && shown) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') setOpen(false);
  };

  return (
    <span ref={rootRef} className={`ps-root ps-suggest${className ? ` ${className}` : ''}`}>
      <input
        {...rest}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={onFocus}
        // A click opens the list (as the browser's own suggestions do); focus from the keyboard does not.
        onClick={() => setOpen(true)}
        onBlur={(event) => {
          onBlur?.(event);
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={onKey}
      />
      {shown && (
        <span id={listId} role="listbox" aria-label="Подсказки" className="ps-list">
          {items.map((item, index) => (
            <span
              key={item}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              data-active={index === active ? '' : undefined}
              className="ps-option"
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => take(item)}
            >
              <span className="ps-label">{item}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
