import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STUDIO } from './copyStudio';
import { ENTRIES, EntryIcon, entryLabel, type PaletteEntry } from './Palette';

/**
 * The block menu (spec §47.6 «"/" в пустой строке — быстрое меню блоков»): opened by «/» in an empty text block or by
 * the «+» between blocks. A field filters by name as you type; ↑ ↓ choose, Enter puts the block, Escape closes. It
 * opens under the place it was called from and stays on the screen.
 */

interface Props {
  anchor: HTMLElement;
  onPick: (entry: PaletteEntry) => void;
  onClose: () => void;
}

const norm = (text: string) => text.toLowerCase().replace(/ё/g, 'е').trim();

export default function BlockMenu({ anchor, onPick, onClose }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  const shown = useMemo(() => {
    const words = norm(query);
    return words ? ENTRIES.filter((entry) => norm(entryLabel(entry)).includes(words)) : [...ENTRIES];
  }, [query]);
  useEffect(() => setAt(0), [query]);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const box = boxRef.current?.getBoundingClientRect();
    const width = box?.width || 288;
    const height = box?.height || 360;
    const viewW = window.innerWidth || 1024;
    const viewH = window.innerHeight || 768;
    let top = rect.bottom + 8;
    if (top + height > viewH - 12) top = Math.max(12, rect.top - height - 8);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, viewW - width - 12));
    setPlace({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (boxRef.current && event.target instanceof Node && !boxRef.current.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const choose = (entry: PaletteEntry | undefined) => {
    if (entry) onPick(entry);
  };

  return createPortal(
    <div
      ref={boxRef}
      className="st-menu"
      role="dialog"
      aria-label={STUDIO.blockMenu}
      style={place ? { top: place.top, left: place.left } : { visibility: 'hidden', top: 0, left: 0 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          setAt((n) => (shown.length ? (n + 1) % shown.length : 0));
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setAt((n) => (shown.length ? (n - 1 + shown.length) % shown.length : 0));
        } else if (event.key === 'Enter') {
          event.preventDefault();
          choose(shown[at]);
        }
      }}
    >
      <input
        className="st-menu-find"
        value={query}
        autoFocus
        placeholder={STUDIO.blockMenu}
        aria-label={STUDIO.blockMenu}
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={shown[at] ? `${id}-${at}` : undefined}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="st-menu-list" id={`${id}-list`} role="listbox" aria-label={STUDIO.blockMenu}>
        {shown.map((entry, index) => (
          <li
            key={`${entry.kind}:${entry.type}`}
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === at}
            className="st-menu-item"
            data-group-start={index > 0 && shown[index - 1].kind !== entry.kind ? '' : undefined}
            onMouseEnter={() => setAt(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(entry)}
          >
            <EntryIcon entry={entry} />
            <span>{entryLabel(entry)}</span>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
