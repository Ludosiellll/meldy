import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DRAFT_WORDS, isDraftQuestion } from '../../lib/studio/checker';
import { insertBlock, newBlock, removeBlock } from '../../lib/studio/doc';
import { typingKey } from '../../lib/studio/history';
import type { TestItem } from '../../types/container';
import type { DocBlock, TestDoc } from '../../types/testDoc';
import { typeOf } from '../test/buildModel';
import DocView, { type DocEditApi } from './DocView';
import BlockMenu from './BlockMenu';
import { STUDIO, type Panel } from './copyStudio';
import { UiIcon } from './icons';
import Palette, { EntryIcon, entryLabel, paletteEntry, type PaletteEntry } from './Palette';
import { canHover, revealBlock } from './phone';
import Sheet from './Sheet';
import { draggingFiles, pictureFiles, targetKey, uploadDocPicture, uploadPreset, type PictureTarget, type UploadStage } from './pictures';
import type { PresetId } from './presets';
import { reducedMotion } from './useDark';
import type { Studio } from './useStudio';

/**
 * «Холст» (spec §47.6): the palette on the left, the page in the middle as the participant will see it (DocView in
 * edit mode, in a computer's or a phone's frame), the settings on the right (`side`). On a phone the palette and the
 * settings are sheets from the bottom.
 *
 * Blocks move by dragging (dnd-kit: the pointer on the handle, or the keyboard — Space on the handle, ↑ ↓, Space; a
 * line shows where the block lands), by «Выше / Ниже» and Alt+↑ / Alt+↓. Delete removes the selected block (a question
 * asks first: its answers go), Ctrl+D copies it, Enter starts typing in its text, ↑ ↓ go to the block above / below.
 * Ctrl+Z brings everything back (the page's own keys, StudioPage).
 *
 * The author's own pictures (owner, 2026-10-19): a picture pasted anywhere in the studio (Ctrl+V / ⌘V) becomes a
 * picture block after the selected block — or fills the selected picture block that has none yet, or goes into the
 * picture field the focus is in (PictureField takes it first); picture files dragged from the computer onto the page
 * become picture blocks where the line shows. A file dropped anywhere else in the studio is caught, so the browser never
 * leaves the page to open it. Every upload goes through pictures.ts (a phone's photo made to fit), its line («Уменьшаю
 * фото…», «Загружаю картинку…») and its words of failure kept per picture; a failure never takes the old picture away.
 */

const END = 'slot:end';
/** At most this many pictures from one drop or paste (each its own block). */
const PICTURES_AT_ONCE = 10;

/** The dragged chip under the pointer (where it was grabbed), not at the block's own corner. */
const toCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent || !('clientX' in activatorEvent)) return transform;
  const event = activatorEvent as PointerEvent;
  return { ...transform, x: transform.x + event.clientX - draggingNodeRect.left - 20, y: transform.y + event.clientY - draggingNodeRect.top - 22 };
};
type Confirm = { blockId: string; number: number } | null;
type Menu = { anchor: HTMLElement; index: number; replace?: string } | null;

/** The field typed in first when a block is opened with Enter. */
const MAIN_FIELD: Partial<Record<DocBlock['type'], string>> = { cover: 'title', heading: 'text', text: 'text', note: 'text', image: 'caption', video: 'caption', page: 'title' };

/** One quiet line near the selected block (spec §47.6 «рядом с выбранным блоком — одна уместная подсказка»). */
export function hintFor(block: DocBlock, doc: TestDoc, rows: ReadonlyMap<string, TestItem>, phone = false): string {
  switch (block.type) {
    case 'heading':
      // A phone has no Alt and no Ctrl: the buttons above the block do the same.
      return phone ? STUDIO.hints.headingTouch : STUDIO.hints.heading;
    case 'page':
      return doc.layout === 'pages' ? STUDIO.hints.pageOn : STUDIO.hints.pageOff;
    case 'question': {
      const item = rows.get(block.item_id);
      if (!item) return STUDIO.gone;
      // Each kind is asked for what it has: a short answer has no options, «верно / неверно» has a statement.
      const kind = typeOf(item);
      if (isDraftQuestion(item)) return kind === 'short' ? STUDIO.hints.questionDraftShort : kind === 'truefalse' ? STUDIO.hints.questionDraftTrueFalse : STUDIO.hints.questionDraft;
      if (item.correct.length === 0 && item.answers.length === 0) return STUDIO.hints.questionNoKey;
      if (block.required && doc.layout === 'one_by_one') return STUDIO.hints.questionRequired;
      return kind === 'short' ? STUDIO.hints.questionShort : STUDIO.hints.question;
    }
    default:
      return STUDIO.hints[block.type];
  }
}

export function blockName(block: DocBlock, numbers: ReadonlyMap<string, number>): string {
  return block.type === 'question' ? STUDIO.questionNo(numbers.get(block.id) ?? 0) : STUDIO.types[block.type];
}

interface FrameProps {
  block: DocBlock;
  index: number;
  count: number;
  name: string;
  selected: boolean;
  phone: boolean;
  problem: string | null;
  hint: string | null;
  confirm: Confirm;
  busy: boolean;
  onSelect: () => void;
  onKey: (event: KeyboardEvent<HTMLDivElement>) => void;
  onCopy: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onConfirm: (yes: boolean) => void;
  onSettings: () => void;
  children: ReactNode;
}

function Frame({ block, index, count, name, selected, phone, problem, hint, confirm, busy, onSelect, onKey, onCopy, onRemove, onMove, onConfirm, onSettings, children }: FrameProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id: block.id, data: { type: block.type } });
  const yesRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) yesRef.current?.focus();
  }, [confirm]);
  return (
    <div
      ref={setNodeRef}
      className="st-block"
      data-block={block.id}
      data-type={block.type}
      data-index={index}
      data-selected={selected ? '' : undefined}
      data-dragging={isDragging ? '' : undefined}
      tabIndex={0}
      role="group"
      aria-label={`${index + 1} из ${count}: ${name}`}
      aria-busy={busy || undefined}
      onClick={onSelect}
      onFocus={(event) => {
        if (!selected && (event.target === event.currentTarget || !(event.target as HTMLElement).closest('.st-acts'))) onSelect();
      }}
      onKeyDown={onKey}
    >
      <div className="st-acts" role="toolbar" aria-label={name} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="st-act st-act-icon st-handle" aria-label={STUDIO.handle(name)} title={STUDIO.handle(name)} {...attributes} {...listeners} tabIndex={selected ? 0 : -1}>
          <UiIcon name="grip" />
        </button>
        <span className="st-sep" aria-hidden="true" />
        {/* On a phone the words beside the icons are gone: the names stay (19.10: «Ctrl+D», «Delete» and no name were read out). */}
        {phone ? (
          <button type="button" className="st-act" aria-label={STUDIO.blockSettings} title={STUDIO.blockSettings} onClick={onSettings}>
            <UiIcon name="sliders" />
            <span>{STUDIO.panels.block}</span>
          </button>
        ) : null}
        <button type="button" className="st-act" aria-label={STUDIO.copy} title={`${STUDIO.copy} · ${STUDIO.copyKeys}`} onClick={onCopy}>
          <UiIcon name="copy" />
          <span>{STUDIO.copy}</span>
        </button>
        <button type="button" className="st-act" aria-label={STUDIO.remove} title={`${STUDIO.remove} · ${STUDIO.removeKeys}`} onClick={onRemove}>
          <UiIcon name="trash" />
          <span>{STUDIO.remove}</span>
        </button>
        <button type="button" className="st-act st-act-icon" aria-label={STUDIO.up} title={`${STUDIO.up} · Alt+↑`} disabled={index === 0} onClick={() => onMove(-1)}>
          <UiIcon name="up" />
        </button>
        <button type="button" className="st-act st-act-icon" aria-label={STUDIO.down} title={`${STUDIO.down} · Alt+↓`} disabled={index === count - 1} onClick={() => onMove(1)}>
          <UiIcon name="down" />
        </button>
      </div>
      {children}
      {confirm ? (
        <div className="st-confirm" role="alertdialog" aria-label={STUDIO.removeQuestion(confirm.number)} onClick={(event) => event.stopPropagation()}>
          <p>{STUDIO.removeQuestion(confirm.number)}</p>
          <p className="st-confirm-acts">
            <button ref={yesRef} type="button" className="st-confirm-yes" onClick={() => onConfirm(true)}>
              {STUDIO.removeYes}
            </button>
            <button type="button" className="sf-link" data-muted="" onClick={() => onConfirm(false)}>
              {STUDIO.removeNo}
            </button>
          </p>
        </div>
      ) : null}
      {problem ? (
        <p className="st-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {selected && hint ? <p className="st-hint">{hint}</p> : null}
    </div>
  );
}

/** The words on the drop line while a file from the computer is over the page. */
function FileDrop({ on }: { on: boolean }) {
  return on ? (
    <span className="st-gap-file" aria-hidden="true">
      <UiIcon name="upload" />
      <span>{STUDIO.canvasDrop}</span>
    </span>
  ) : null;
}

function Gap({ index, drop, file, reachable, onPlus }: { index: number; drop: boolean; file: boolean; reachable: boolean; onPlus: (index: number, anchor: HTMLElement) => void }) {
  return (
    <div className="st-gap" data-drop={drop || file ? '' : undefined} data-file={file ? '' : undefined} data-next={reachable ? '' : undefined}>
      <FileDrop on={file} />
      <button type="button" className="st-plus" aria-label={STUDIO.addHere} title={STUDIO.addHere} tabIndex={reachable ? 0 : -1} onClick={(event) => onPlus(index, event.currentTarget)}>
        <UiIcon name="plus" />
      </button>
    </div>
  );
}

function EndGap({ index, drop, file, empty, onPlus }: { index: number; drop: boolean; file: boolean; empty: boolean; onPlus: (index: number, anchor: HTMLElement) => void }) {
  const { setNodeRef } = useDroppable({ id: END });
  return (
    <div ref={setNodeRef} className="st-gap st-gap-end" data-drop={drop || file ? '' : undefined} data-file={file ? '' : undefined} data-empty={empty ? '' : undefined}>
      <FileDrop on={file} />
      {empty || file ? null : (
        <button type="button" className="st-plus st-plus-end" onClick={(event) => onPlus(index, event.currentTarget)}>
          <UiIcon name="plus" />
          <span>{STUDIO.addBlock}</span>
        </button>
      )}
    </div>
  );
}

export interface WorkspaceProps {
  studio: Studio;
  containerId: string;
  dark: boolean;
  device: 'desktop' | 'phone';
  /** The screen is a phone: the palette and the settings are sheets. */
  phone: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  /** The settings column (or sheet) of the selected block and the page. */
  side: (api: SideApi) => ReactNode;
  /** The start of an empty test (EmptyStart). */
  empty: ReactNode;
  paletteOpen: boolean;
  onPaletteOpen: (open: boolean) => void;
  sideOpen: boolean;
  onSideOpen: (open: boolean) => void;
}

/** What the settings get from the canvas: pictures go through its file field and its uploads. */
export interface SideApi {
  /** Opens the files (on a phone, the photos) for this picture. */
  pickPicture: (target: PictureTarget) => void;
  /** A file dropped or pasted into a picture field. */
  uploadFile: (target: PictureTarget, file: Blob) => void;
  usePreset: (target: PictureTarget, id: PresetId) => void;
  /** What this picture's upload is doing, or null. */
  stageOf: (target: PictureTarget) => UploadStage | null;
  /** Why this picture's last upload failed, or null. */
  noteOf: (target: PictureTarget) => string | null;
  /** A touch screen: no dragging of files, no Ctrl+V; the button opens the photos. */
  touch: boolean;
  removeBlock: (blockId: string) => void;
}

export default function Workspace({
  studio,
  containerId,
  dark,
  device,
  phone,
  selected,
  onSelect,
  panel,
  onPanel,
  side,
  empty,
  paletteOpen,
  onPaletteOpen,
  sideOpen,
  onSideOpen,
}: WorkspaceProps) {
  const { doc, rows } = studio;
  const ids = useMemo(() => doc.blocks.map((block) => block.id), [doc.blocks]);
  const numbers = useMemo(() => {
    const out = new Map<string, number>();
    for (const block of doc.blocks) if (block.type === 'question' && rows.has(block.item_id)) out.set(block.id, out.size + 1);
    return out;
  }, [doc.blocks, rows]);
  const [editing, setEditingKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [dragId, setDragId] = useState<UniqueIdentifier | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRect = useRef<DOMRect | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pictureTarget = useRef<PictureTarget | null>(null);
  /** Uploads under way and the words of failed ones, by targetKey. */
  const [uploads, setUploads] = useState<Readonly<Record<string, UploadStage>>>({});
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  /** The gap a file from the computer would land in while it is dragged over the page. */
  const [fileSlot, setFileSlot] = useState<number | null>(null);
  /** After a removal on a touch screen: the line with «Вернуть», while the page is the page that removal made. */
  const [undoNote, setUndoNote] = useState<{ name: string; doc: TestDoc | null } | null>(null);
  useEffect(() => {
    setUndoNote((note) => (!note ? note : note.doc === null ? { ...note, doc } : note.doc === doc ? note : null));
  }, [doc]);
  useEffect(() => {
    if (!undoNote) return;
    const timer = window.setTimeout(() => setUndoNote(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undoNote]);

  // Focus follows a move, a copy, a removal: the block (or its neighbour) after the next render. A block just added is
  // brought to the middle of the screen (`reveal`): on a phone `nearest` left it under the bottom bar.
  const refocus = useRef<string | null>(null);
  const reveal = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id) {
      refocus.current = null;
      const node = scrollRef.current?.querySelector<HTMLElement>(`[data-block="${id}"]`);
      node?.focus({ preventScroll: true });
      if (reveal.current !== id) node?.scrollIntoView?.({ block: 'nearest' });
    }
    const shown = reveal.current;
    if (shown && revealBlock(scrollRef.current, shown)) reveal.current = null;
  });
  const focusBlock = (id: string | null) => {
    refocus.current = id;
  };
  const revealNew = (id: string) => {
    reveal.current = id;
  };

  const indexOf = useCallback((id: string | null) => (id ? doc.blocks.findIndex((block) => block.id === id) : -1), [doc.blocks]);
  const afterSelected = () => {
    const at = indexOf(selected);
    return at < 0 ? doc.blocks.length : at + 1;
  };

  // ─────────────────────────── adding ───────────────────────────

  const pickPicture = (target: PictureTarget) => {
    pictureTarget.current = target;
    fileRef.current?.click();
  };

  const setPicture = (target: PictureTarget, path: string) => {
    if (target.kind === 'background') studio.change((current) => ({ ...current, theme: { ...current.theme, background: { kind: 'image', path, dim: current.theme.background.kind === 'image' ? current.theme.background.dim : 40 } } }));
    else if (target.kind === 'band') {
      studio.change((current) => ({
        ...current,
        results: { ...current.results, bands: current.results.bands.map((band, at) => (at === target.index ? { ...band, image: path } : band)) },
      }));
    } else {
      studio.change((current) => ({
        ...current,
        blocks: current.blocks.map((block) =>
          block.id !== target.blockId ? block : block.type === 'image' ? { ...block, path } : block.type === 'cover' ? { ...block, image: path } : block,
        ),
      }));
    }
  };

  /** One picture's upload: its line while it runs, then the picture — or its words, the old picture kept. */
  const upload = async (target: PictureTarget, run: (onStage: (stage: UploadStage) => void) => Promise<{ path: string } | { note: string }>) => {
    const key = targetKey(target);
    const stageIs = (stage: UploadStage) => setUploads((current) => ({ ...current, [key]: stage }));
    // Read, then (when it has to) shrink, then send: never «Загружаю» before «Уменьшаю».
    stageIs('read');
    setNotes(({ [key]: _gone, ...rest }) => rest);
    const result = await run(stageIs);
    setUploads(({ [key]: _done, ...rest }) => rest);
    if ('path' in result) setPicture(target, result.path);
    else setNotes((current) => ({ ...current, [key]: result.note }));
  };
  const uploadFile = (target: PictureTarget, file: Blob) => {
    if (uploads[targetKey(target)]) return;
    void upload(target, (onStage) => uploadDocPicture(containerId, file, onStage));
  };

  /** Pictures from a drop or the clipboard as new picture blocks from `index` on, each uploading into its own block. */
  const insertPictures = (files: readonly File[], index: number) => {
    let at = index;
    let first: DocBlock | null = null;
    for (const file of files.slice(0, PICTURES_AT_ONCE)) {
      const block = studio.insert('image', at);
      if (!block) break;
      first ??= block;
      at += 1;
      uploadFile({ kind: 'image', blockId: block.id }, file);
    }
    if (!first) return;
    setEditingKey(null);
    onSelect(first.id);
    onPanel('block');
    focusBlock(first.id);
    revealNew(first.id);
  };

  // Ctrl+V / ⌘V with a picture, anywhere in the studio: a field that took it already said so (defaultPrevented: the
  // question editor's texts, a picture field); the preview is not the page.
  const pasteRef = useRef<(event: ClipboardEvent) => void>(() => undefined);
  pasteRef.current = (event: ClipboardEvent) => {
    if (event.defaultPrevented || studio.busy !== null) return;
    const files = pictureFiles(event.clipboardData?.files);
    if (files.length === 0) return;
    const from = event.target instanceof Element ? event.target : null;
    if (from?.closest('.st-preview')) return;
    event.preventDefault();
    const chosen = doc.blocks[indexOf(selected)];
    if (chosen?.type === 'image' && !chosen.path && files.length === 1) uploadFile({ kind: 'image', blockId: chosen.id }, files[0]);
    else insertPictures(files, afterSelected());
  };
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => pasteRef.current(event);
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  // Files from the computer over the page: the line shows the gap under the pointer (before the block whose middle is
  // below it), the drop puts the pictures there. dragenter / dragleave come for every child: counted.
  const fileDepth = useRef(0);
  const fileGone = () => {
    fileDepth.current = 0;
    setFileSlot(null);
  };

  // A file dropped where nothing takes it would make the browser open it and leave the studio: such a drop is refused.
  // A drop anywhere, or a drag that leaves the window, takes the page's drop line away.
  useEffect(() => {
    const refuse = (event: globalThis.DragEvent) => {
      if (event.type === 'drop') fileGone();
      if (event.defaultPrevented || !draggingFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    const left = (event: globalThis.DragEvent) => {
      const out = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
      if (!event.relatedTarget && out) fileGone();
    };
    window.addEventListener('dragover', refuse);
    window.addEventListener('drop', refuse);
    document.addEventListener('dragleave', left);
    return () => {
      window.removeEventListener('dragover', refuse);
      window.removeEventListener('drop', refuse);
      document.removeEventListener('dragleave', left);
    };
  }, []);
  const slotAtY = (y: number): number => {
    const frames = scrollRef.current?.querySelectorAll<HTMLElement>('.st-block[data-index]') ?? [];
    for (const frame of Array.from(frames)) {
      const rect = frame.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return Number(frame.dataset.index);
    }
    return doc.blocks.length;
  };
  const fileEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer) || dragId !== null) return;
    event.preventDefault();
    fileDepth.current += 1;
    setFileSlot(slotAtY(event.clientY));
  };
  const fileOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer) || dragId !== null || event.defaultPrevented) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = studio.busy !== null ? 'none' : 'copy';
    const next = slotAtY(event.clientY);
    setFileSlot((current) => (current === next ? current : next));
  };
  const fileLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer)) return;
    fileDepth.current = Math.max(0, fileDepth.current - 1);
    if (fileDepth.current === 0) setFileSlot(null);
  };
  const fileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer)) return;
    fileGone();
    if (event.defaultPrevented) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    const pictures = pictureFiles(files);
    if (studio.busy !== null || files.length === 0) return;
    // Not one picture among them: a block still comes, and says why it is empty.
    insertPictures(pictures.length > 0 ? pictures : files.slice(0, 1), slotAtY(event.clientY));
  };

  const add = async (entry: PaletteEntry, index: number, replace?: string) => {
    onPaletteOpen(false);
    if (entry.kind === 'question') {
      const block = await studio.addQuestion(entry.type, index);
      if (!block) return;
      if (replace) studio.change((current) => removeBlock(current, replace));
      onSelect(block.id);
      onPanel('block');
      focusBlock(block.id);
      revealNew(block.id);
      if (phone) onSideOpen(true);
      return;
    }
    let block: DocBlock | null;
    if (replace) {
      block = newBlock(entry.type);
      const made = block;
      studio.change((current) => insertBlock(removeBlock(current, replace), made, index));
    } else block = studio.insert(entry.type, index);
    if (!block) return;
    onSelect(block.id);
    onPanel('block');
    revealNew(block.id);
    const field = MAIN_FIELD[block.type];
    // A picture's first step is the author's own file; a video's, its link (the field on the block).
    if (block.type === 'image') pickPicture({ kind: 'image', blockId: block.id });
    else if (block.type === 'video') {
      // Its link field takes the focus on a computer; a phone is not given a keyboard it did not ask for (live check of 47.4).
      const id = block.id;
      if (!phone && canHover()) window.setTimeout(() => scrollRef.current?.querySelector<HTMLInputElement>(`[data-block="${id}"] .dv-video-put input`)?.focus({ preventScroll: true }), 0);
      else focusBlock(id);
    } else if (field && block.type !== 'cover') setEditingKey(`${block.id}:${field}`);
    else focusBlock(block.id);
  };

  // ─────────────────────────── the frame's keys and actions ───────────────────────────

  const askRemove = (block: DocBlock) => {
    if (block.type === 'question' && rows.has(block.item_id)) {
      setConfirm({ blockId: block.id, number: numbers.get(block.id) ?? 0 });
      return;
    }
    removeNow(block.id);
  };
  const removeNow = (id: string) => {
    const at = indexOf(id);
    const gone = doc.blocks[at];
    const neighbour = doc.blocks[at + 1] ?? doc.blocks[at - 1] ?? null;
    setConfirm(null);
    studio.remove(id, phone);
    onSelect(neighbour?.id ?? null);
    focusBlock(neighbour?.id ?? null);
    // A touch screen has no Ctrl+Z: «Вернуть» stands over the bar until the page changes again.
    if (phone && gone) setUndoNote({ name: STUDIO.types[gone.type], doc: null });
  };
  const moveBy = (id: string, dir: -1 | 1) => {
    const at = indexOf(id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= doc.blocks.length) return;
    studio.move(id, to);
    focusBlock(id);
  };
  const copy = async (id: string) => {
    const made = await studio.duplicate(id);
    if (made) {
      onSelect(made.id);
      focusBlock(made.id);
    }
  };
  const startEditing = (block: DocBlock) => {
    const field = MAIN_FIELD[block.type];
    if (field) setEditingKey(`${block.id}:${field}`);
    else if (block.type === 'question') {
      onPanel('block');
      if (phone) onSideOpen(true);
      window.setTimeout(() => {
        const stem = document.querySelector<HTMLTextAreaElement | HTMLInputElement>('.st-side .qe-stem, .st-sheet .qe-stem');
        if (!stem) return;
        stem.focus();
        // The palette's words of a new question are taken whole, as a new block's: typing replaces them.
        if (stem.value === DRAFT_WORDS.stem || stem.value === DRAFT_WORDS.statement) stem.setSelectionRange?.(0, stem.value.length);
      }, 0);
    }
  };

  const onKey = (block: DocBlock) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    const at = indexOf(block.id);
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveBy(block.id, event.key === 'ArrowUp' ? -1 : 1);
    } else if (mod && !event.altKey && (event.key.toLowerCase() === 'd' || event.key.toLowerCase() === 'в')) {
      event.preventDefault();
      void copy(block.id);
    } else if (!mod && !event.altKey && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      askRemove(block);
    } else if (!mod && event.key === 'Enter') {
      event.preventDefault();
      startEditing(block);
    } else if (!mod && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const next = doc.blocks[at + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!next) return;
      event.preventDefault();
      onSelect(next.id);
      focusBlock(next.id);
    } else if (event.key === 'Escape' && confirm) {
      event.preventDefault();
      setConfirm(null);
    }
  };

  // ─────────────────────────── dragging ───────────────────────────

  /**
   * The keyboard's drag goes block by block (↑ ↓), then past the last one: the place it is over is kept here and the
   * collision takes it as it is — the page's blocks are of any height, so a guess by distance would skip or stick.
   */
  const keyTarget = useRef<UniqueIdentifier | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const keyboardCoordinates: KeyboardCoordinateGetter = useCallback((event, { context, currentCoordinates }) => {
    if (event.code !== 'ArrowDown' && event.code !== 'ArrowUp') return undefined;
    event.preventDefault();
    const order: UniqueIdentifier[] = [...idsRef.current, END];
    const from = order.indexOf(keyTarget.current ?? context.active?.id ?? '');
    const at = Math.max(0, Math.min(order.length - 1, (from < 0 ? 0 : from) + (event.code === 'ArrowDown' ? 1 : -1)));
    keyTarget.current = order[at];
    const rect = context.droppableRects.get(order[at]);
    return rect ? { x: rect.left, y: rect.top } : currentCoordinates;
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, scrollBehavior: reducedMotion() ? 'auto' : 'smooth' }),
  );

  const collision: CollisionDetection = useCallback((args) => {
    const pointer = args.pointerCoordinates;
    if (!pointer && keyTarget.current !== null) {
      const container = args.droppableContainers.find((entry) => entry.id === keyTarget.current);
      if (container) return [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
    }
    const rect = canvasRect.current;
    if (pointer && rect && (pointer.x < rect.left || pointer.x > rect.right || pointer.y < rect.top || pointer.y > rect.bottom)) return [];
    return closestCenter(args);
  }, []);

  /** The gap the dragged thing would land in: 0 — before the first block, blocks.length — after the last. */
  const slotOf = (event: DragMoveEvent): number | null => {
    const { active, over } = event;
    if (!over) return null;
    if (over.id === END) return doc.blocks.length;
    const overAt = ids.indexOf(String(over.id));
    if (overAt < 0) return null;
    if (!paletteEntry(active.id)) {
      const from = ids.indexOf(String(active.id));
      if (from === overAt) return from;
      return overAt > from ? overAt + 1 : overAt;
    }
    const rect = active.rect.current.translated;
    if (!rect) return overAt;
    return rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2 ? overAt + 1 : overAt;
  };
  /** The slot does not move the block (its own place). */
  const still = (id: UniqueIdentifier | null, at: number | null) => {
    if (at === null || id === null || paletteEntry(id)) return false;
    const from = ids.indexOf(String(id));
    return at === from || at === from + 1;
  };

  const nameOf = (id: UniqueIdentifier) => {
    const entry = paletteEntry(id);
    if (entry) return entryLabel(entry);
    const block = doc.blocks.find((entry2) => entry2.id === id);
    return block ? blockName(block, numbers) : '';
  };

  /** The place (from 1) and the number of places a dragged thing is over: a block takes the place of the one it is over. */
  const placeOf = (active: UniqueIdentifier, over: UniqueIdentifier): [number, number] => {
    const fresh = paletteEntry(active) !== null;
    const count = doc.blocks.length + (fresh ? 1 : 0);
    const at = over === END ? count - 1 : ids.indexOf(String(over));
    return [at + 1, count];
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => STUDIO.dnd.start(nameOf(active.id)),
    onDragOver: ({ active, over }) => {
      if (!over) return STUDIO.dnd.outside;
      const [place, count] = placeOf(active.id, over.id);
      return STUDIO.dnd.over(place, count);
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return STUDIO.dnd.cancel(nameOf(active.id));
      return STUDIO.dnd.end(nameOf(active.id), placeOf(active.id, over.id)[0]);
    },
    onDragCancel: ({ active }) => STUDIO.dnd.cancel(nameOf(active.id)),
  };

  const onDragStart = (event: DragStartEvent) => {
    keyTarget.current = null;
    canvasRect.current = scrollRef.current?.getBoundingClientRect() ?? null;
    setDragId(event.active.id);
    setSlot(null);
    setEditingKey(null);
    if (!paletteEntry(event.active.id)) onSelect(String(event.active.id));
  };
  /**
   * A block dragged by finger out of the «Блоки» sheet: the sheet steps away at once, so the page and the line where
   * the block lands are seen (it is closed when the drag ends; until then the dragged item stays mounted).
   */
  const sheetAway = phone && dragId !== null && paletteEntry(dragId) !== null;
  const onDragMove = (event: DragMoveEvent) => {
    const next = slotOf(event);
    setSlot((current) => (current === next ? current : next));
  };
  const onDragEnd = (event: DragEndEvent) => {
    const at = slotOf(event);
    keyTarget.current = null;
    const id = event.active.id;
    setDragId(null);
    setSlot(null);
    if (phone && paletteEntry(id)) onPaletteOpen(false);
    if (at === null) return;
    const entry = paletteEntry(id);
    if (entry) {
      void add(entry, at);
      return;
    }
    const from = ids.indexOf(String(id));
    const to = at > from ? at - 1 : at;
    if (from < 0 || to === from) return;
    studio.move(String(id), to);
    focusBlock(String(id));
  };

  const shownSlot = dragId !== null && !still(dragId, slot) ? slot : null;

  // A keyboard drag keeps the line where the block will land in sight.
  useEffect(() => {
    if (shownSlot === null || keyTarget.current === null) return;
    scrollRef.current?.querySelector<HTMLElement>('.st-gap[data-drop]')?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [shownSlot]);

  // ─────────────────────────── the page ───────────────────────────

  const selectedIndex = indexOf(selected);
  const editor: DocEditApi = {
    selected,
    editing,
    uploading: Object.keys(uploads).find((key) => key.startsWith('image:'))?.slice(6) ?? null,
    pictureStage: (blockId) => uploads[`image:${blockId}`] ?? null,
    pictureNote: (blockId) => noteOf({ kind: 'image', blockId }),
    dropPicture: (blockId, file) => uploadFile({ kind: 'image', blockId }, file),
    touch: phone,
    setEditing: (key, how) => {
      setEditingKey(key);
      if (!key && (how === 'enter' || how === 'escape') && selected) focusBlock(selected);
    },
    change: (blockId, patch, field) => {
      studio.change((current) => ({ ...current, blocks: current.blocks.map((block) => (block.id === blockId ? ({ ...block, ...patch } as DocBlock) : block)) }), typingKey(blockId, field));
    },
    slash: (blockId, anchor) => setMenu({ anchor, index: indexOf(blockId), replace: blockId }),
    pickImage: (blockId) => pickPicture({ kind: 'image', blockId }),
    empty,
    frame: (block, index, node) => {
      const isEditing = editing?.startsWith(`${block.id}:`) ?? false;
      const problem = studio.problems.get(block.id) ?? null;
      return (
        <Frame
          key={block.id}
          block={block}
          index={index}
          count={doc.blocks.length}
          name={blockName(block, numbers)}
          selected={selected === block.id}
          phone={phone}
          problem={isEditing ? null : problem}
          hint={selected === block.id ? hintFor(block, doc, rows, phone) : null}
          confirm={confirm?.blockId === block.id ? confirm : null}
          busy={studio.busy === block.id}
          onSelect={() => {
            if (selected !== block.id) onSelect(block.id);
          }}
          onKey={onKey(block)}
          onCopy={() => void copy(block.id)}
          onRemove={() => askRemove(block)}
          onMove={(dir) => moveBy(block.id, dir)}
          onConfirm={(yes) => {
            if (yes) removeNow(block.id);
            else {
              setConfirm(null);
              focusBlock(block.id);
            }
          }}
          onSettings={() => {
            onPanel('block');
            onSideOpen(true);
          }}
        >
          {node}
        </Frame>
      );
    },
    gap: (index) =>
      index === doc.blocks.length ? (
        <EndGap key="end" index={index} drop={shownSlot === index} file={fileSlot === index} empty={doc.blocks.length === 0} onPlus={(at, anchor) => setMenu({ anchor, index: at })} />
      ) : (
        <Gap
          key={`gap-${index}`}
          index={index}
          drop={shownSlot === index}
          file={fileSlot === index}
          reachable={selectedIndex >= 0 && index === selectedIndex + 1}
          onPlus={(at, anchor) => setMenu({ anchor, index: at })}
        />
      ),
  };

  /** A failure's words; a picture block left without its picture is told it is not saved so (live check of 47.4). */
  function noteOf(target: PictureTarget): string | null {
    const note = notes[targetKey(target)] ?? null;
    if (!note || target.kind !== 'image') return note;
    const block = doc.blocks.find((entry) => entry.id === target.blockId);
    return block?.type === 'image' && !block.path ? `${note} ${STUDIO.pictureNotSaved}` : note;
  }

  const sideApi: SideApi = {
    pickPicture,
    uploadFile,
    usePreset: (target, id) => {
      if (!uploads[targetKey(target)]) void upload(target, () => uploadPreset(containerId, id, target.kind === 'background' ? 'background' : 'cover'));
    },
    stageOf: (target) => uploads[targetKey(target)] ?? null,
    noteOf,
    touch: phone,
    removeBlock: (id) => {
      const block = doc.blocks.find((entry) => entry.id === id);
      if (block) askRemove(block);
    },
  };

  const disabled = studio.busy !== null;
  const dragEntry = dragId !== null ? paletteEntry(dragId) : null;
  const dragBlock = dragId !== null && !dragEntry ? doc.blocks.find((block) => block.id === dragId) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={(event) => {
        keyTarget.current = null;
        setDragId(null);
        setSlot(null);
        if (phone && paletteEntry(event.active.id)) onPaletteOpen(false);
      }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: STUDIO.dnd.instructions } }}
      // Only the page scrolls while something is dragged over it (not the palette, not the window).
      autoScroll={{ threshold: { x: 0, y: 0.12 }, canScroll: (element) => element === scrollRef.current || (phone && element === document.scrollingElement) }}
    >
      <div className="st-work" data-phone={phone ? '' : undefined}>
        {phone ? null : (
          <aside className="st-col st-col-left" data-tour="palette" aria-label={STUDIO.palette}>
            <Palette disabled={disabled} onPick={(entry) => void add(entry, afterSelected())} />
          </aside>
        )}

        <section className="st-canvas" data-device={phone ? 'phone' : device} aria-label={STUDIO.canvas}>
          <div className="st-frame" data-device={phone ? 'fluid' : device}>
            <div
              ref={scrollRef}
              className="st-scroll"
              data-tour="canvas"
              data-file-over={fileSlot !== null ? '' : undefined}
              onDragEnter={fileEnter}
              onDragOver={fileOver}
              onDragLeave={fileLeave}
              onDrop={fileDrop}
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('.st-block, .st-gap, .st-start')) {
                  onSelect(null);
                  setEditingKey(null);
                }
              }}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <DocView mode="edit" doc={doc} items={rows} dark={dark} editor={editor} className="st-doc" />
              </SortableContext>
            </div>
          </div>
        </section>

        {phone ? null : (
          <aside className="st-col st-col-right st-side" aria-label={STUDIO.panelsLabel}>
            {side(sideApi)}
          </aside>
        )}
      </div>

      {phone && paletteOpen ? (
        <Sheet title={STUDIO.palette} onClose={() => onPaletteOpen(false)} away={sheetAway}>
          <Palette disabled={disabled} hint={false} onPick={(entry) => void add(entry, afterSelected())} />
        </Sheet>
      ) : null}
      {/* «Проверка теста» has its own title: the tabs of the settings are not shown over it (StudioPage, Side `tabs`). */}
      {phone && sideOpen ? (
        <Sheet title={panel === 'check' ? STUDIO.check : STUDIO.panelsLabel} onClose={() => onSideOpen(false)} className="st-side">
          {side(sideApi)}
        </Sheet>
      ) : null}

      <DragOverlay dropAnimation={null} modifiers={[toCursor]}>
        {dragEntry || dragBlock ? (
          <div className="st-ghost">
            {dragEntry ? <EntryIcon entry={dragEntry} /> : null}
            <span>{dragEntry ? entryLabel(dragEntry) : dragBlock ? blockName(dragBlock, numbers) : ''}</span>
          </div>
        ) : null}
      </DragOverlay>

      {menu ? (
        <BlockMenu
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onPick={(entry) => {
            const { index, replace } = menu;
            setMenu(null);
            void add(entry, index, replace);
          }}
        />
      ) : null}

      {phone && undoNote ? (
        <div className="st-toast">
          <p className="st-toast-t">{STUDIO.removed(undoNote.name, true)}</p>
          <button
            type="button"
            className="st-toast-btn"
            onClick={() => {
              setUndoNote(null);
              studio.undo();
            }}
          >
            {STUDIO.undoRemove}
          </button>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        // image/* (on a phone: the photos); the helper redraws what the bucket does not take and names a HEIC the browser
        // cannot draw.
        accept="image/*"
        hidden
        data-studio-file=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const target = pictureTarget.current;
          if (file && target) uploadFile(target, file);
        }}
      />
    </DndContext>
  );
}
