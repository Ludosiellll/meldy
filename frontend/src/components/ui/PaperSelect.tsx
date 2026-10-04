import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import './paperSelect.css';

export interface PaperSelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface PaperSelectProps<T extends string | number> {
  value: T;
  options: ReadonlyArray<PaperSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Выпадающий список в языке «Бумажного стола» вместо системного <select>: слово с карандашной
 * чертой, под ним — листок с вариантами. Клавиатура как у списка: стрелки, Home/End, первая
 * буква, Enter/пробел выбирают, Esc закрывает и возвращает фокус.
 */
export default function PaperSelect<T extends string | number>(props: PaperSelectProps<T>) {
  const { value, options, onChange, ariaLabel, disabled } = props;
  const id = useId();
  const listId = `${id}-list`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const typed = useRef({ text: '', at: 0 });

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const current = options[selectedIndex];

  const enabledFrom = useCallback(
    (start: number, step: 1 | -1): number => {
      for (let i = 0, index = start; i < options.length; i += 1, index += step) {
        const wrapped = (index + options.length) % options.length;
        if (!options[wrapped]?.disabled) return wrapped;
      }
      return start;
    },
    [options],
  );

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  const openList = (index = selectedIndex) => {
    if (disabled || options.length === 0) return;
    setActive(options[index]?.disabled ? enabledFrom(index, 1) : index);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const list = listRef.current;
    if (button && list && typeof window !== 'undefined') {
      const rect = button.getBoundingClientRect();
      const height = list.offsetHeight || 0;
      setAbove(rect.bottom + height + 12 > window.innerHeight && rect.top - height - 12 > 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  // Фокус всегда на кнопке (шаблон select-only combobox): стрелки двигают выделение в листке.
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => enabledFrom(index + 1, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => enabledFrom(index - 1, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(enabledFrom(0, 1));
        return;
      case 'End':
        event.preventDefault();
        setActive(enabledFrom(options.length - 1, -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'Tab':
        close(false);
        return;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const now = Date.now();
          typed.current = { text: now - typed.current.at < 700 ? typed.current.text + event.key : event.key, at: now };
          const needle = typed.current.text.toLocaleLowerCase('ru-RU');
          const found = options.findIndex(
            (option) => !option.disabled && option.label.toLocaleLowerCase('ru-RU').startsWith(needle),
          );
          if (found >= 0) setActive(found);
        }
    }
  };

  return (
    <span ref={rootRef} className={`ps-root${props.className ? ` ${props.className}` : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className="ps-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        data-value={String(value)}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKey}
      >
        <span className="ps-value">{current?.label ?? ''}</span>
        <ChevronDown aria-hidden="true" strokeWidth={2} className="ps-chevron" data-open={open ? '' : undefined} />
      </button>
      {/* span, а не ul/li: список стоит и внутри абзаца («В билете [2] вопроса»), где ul недопустим. */}
      {open && (
        <span
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="ps-list"
          data-above={above ? '' : undefined}
        >
          {options.map((option, index) => {
            const selected = index === selectedIndex;
            return (
              <span
                key={String(option.value)}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                data-index={index}
                data-active={index === active ? '' : undefined}
                className="ps-option"
                onPointerMove={() => !option.disabled && setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span className="ps-label">{option.label}</span>
                {selected && (
                  <svg className="ps-tick" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8.6 6.4 12 13 4.6" />
                  </svg>
                )}
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}
