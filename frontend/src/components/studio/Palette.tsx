import { memo, type PointerEventHandler } from 'react';
import { PORT } from '../port/copyPort';
import { GenerateIcon } from '../port/portIcons';
import { useDraggable } from '@dnd-kit/core';
import type { DocBlockType } from '../../types/testDoc';
import { STUDIO, type QuestionType } from './copyStudio';
import { BlockIcon, QuestionIcon } from './icons';

/**
 * The palette of «Холст» (spec §47.6): the page's blocks and the four kinds of question. Each one is dragged onto the
 * page (dnd-kit, the pointer: the page shows where it lands), or pressed — the mouse or Enter — to stand after the
 * selected block. Keyboard users then move it with Alt+↑ / Alt+↓ or the handle (see Canvas.tsx).
 */

export type PageBlockType = Exclude<DocBlockType, 'question'>;
export type PaletteEntry = { kind: 'block'; type: PageBlockType } | { kind: 'question'; type: QuestionType };

export const BLOCK_KINDS: readonly PageBlockType[] = ['cover', 'heading', 'text', 'image', 'video', 'note', 'divider', 'page'];
export const QUESTION_KINDS: readonly QuestionType[] = ['single', 'multiple', 'truefalse', 'short', 'number', 'order', 'match', 'cloze', 'essay'];
/** The four kinds an empty test offers to start with (EmptyStart): the new kinds wait in the palette. */
export const FIRST_KINDS: readonly QuestionType[] = ['single', 'multiple', 'truefalse', 'short'];
export const ENTRIES: readonly PaletteEntry[] = [
  ...BLOCK_KINDS.map((type) => ({ kind: 'block' as const, type })),
  ...QUESTION_KINDS.map((type) => ({ kind: 'question' as const, type })),
];

const PREFIX = 'palette:';
export const paletteId = (entry: PaletteEntry) => `${PREFIX}${entry.kind}:${entry.type}`;
export function paletteEntry(id: string | number): PaletteEntry | null {
  const text = String(id);
  if (!text.startsWith(PREFIX)) return null;
  const [kind, type] = text.slice(PREFIX.length).split(':');
  return ENTRIES.find((entry) => entry.kind === kind && entry.type === type) ?? null;
}
export const entryLabel = (entry: PaletteEntry) => (entry.kind === 'block' ? STUDIO.types[entry.type] : STUDIO.qtypes[entry.type]);

/** A memo: a drag re-renders every item of the palette (its dnd-kit hook), not its icon. */
export const EntryIcon = memo(function EntryIcon({ entry }: { entry: PaletteEntry }) {
  return entry.kind === 'block' ? <BlockIcon type={entry.type} /> : <QuestionIcon type={entry.type} />;
});

function Item({ entry, disabled, onPick }: { entry: PaletteEntry; disabled: boolean; onPick: (entry: PaletteEntry) => void }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: paletteId(entry), disabled, data: { entry } });
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        className="st-pal-item"
        data-entry={`${entry.kind}:${entry.type}`}
        data-dragging={isDragging ? '' : undefined}
        aria-disabled={disabled || undefined}
        // The pointer drags; Enter and Space press the button (the keyboard's way is «after the selected block»).
        onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLButtonElement> | undefined}
        onClick={() => {
          if (!disabled) onPick(entry);
        }}
      >
        <EntryIcon entry={entry} />
        <span>{entryLabel(entry)}</span>
      </button>
    </li>
  );
}

function Palette({ disabled, onPick, hint = true, onGenerate }: { disabled: boolean; onPick: (entry: PaletteEntry) => void; hint?: boolean; onGenerate?: () => void }) {
  return (
    <div className="st-palette">
      <h2 className="st-side-h">{STUDIO.palette}</h2>
      {hint ? <p className="st-pal-hint">{STUDIO.paletteHint}</p> : null}
      <p className="st-pal-group" id="st-pal-blocks">
        {STUDIO.blocksGroup}
      </p>
      <ul className="st-pal-list" aria-labelledby="st-pal-blocks">
        {BLOCK_KINDS.map((type) => (
          <Item key={type} entry={{ kind: 'block', type }} disabled={disabled} onPick={onPick} />
        ))}
      </ul>
      <p className="st-pal-group" id="st-pal-questions">
        {STUDIO.questionsGroup}
      </p>
      <ul className="st-pal-list" aria-labelledby="st-pal-questions">
        {QUESTION_KINDS.map((type) => (
          <Item key={type} entry={{ kind: 'question', type }} disabled={disabled} onPick={onPick} />
        ))}
      </ul>
      {/* Release 49: questions from a lecture, a text or a file (components/port/GenerateSheet). */}
      {onGenerate ? (
        <button type="button" className="st-pal-item pt-pal-gen" aria-disabled={disabled || undefined} onClick={() => !disabled && onGenerate()}>
          <GenerateIcon />
          <span>{PORT.generateOpen}</span>
        </button>
      ) : null}
    </div>
  );
}

/** A memo: the canvas re-renders at every key typed, the palette has nothing to do with it. */
export default memo(Palette);
