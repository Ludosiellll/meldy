import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
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
import { DRAFT_WORDS, isDraftQuestion } from '../../lib/studio/checker';
import { insertBlock, newBlock, removeBlock } from '../../lib/studio/doc';
import { typingKey } from '../../lib/studio/history';
import type { TestItem } from '../../types/container';
import type { DocBlock, DocLayout, TestDoc } from '../../types/testDoc';
import { typeOf } from '../test/buildModel';
import { useCanvas, type CanvasStore } from './canvasStore';
import DocView, { type DocEditApi, type EditFrameProps, type EditGapProps } from './DocView';
import { ItemPercentsProvider, PercentChip } from './itemPercents';
import type { DocItem } from './docRun';
import BlockMenu from './BlockMenu';
import { STUDIO, type Panel } from './copyStudio';
import { uiIcon } from './icons';
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
 *
 * Smoothness (owner, 2026-10-20: «никаких пролагиваний… без потери качества»; audit of 20.10): a key typed re-rendered
 * 475 components (every block, 220 icons), a drag re-rendered every block at each step. Now the canvas's often-changing
 * facts — the chosen block, the text being typed in, the drop line, the question asking before it goes, the block under
 * the mouse — live in the page's CanvasStore, read by the one frame or gap they concern; the blocks are memo components
 * fed plain values (DocView EditBlock); the frame's bar and the gaps' «+» exist only where they show. A block is
 * dragged by its bar's handle (a dnd-kit draggable only there, so one or two exist, not thirty), over one target — the
 * page; the gap it would land in is worked out here from the blocks' places (measured once a drag starts) and goes to
 * the store, so a step of a drag re-renders the two gaps the line leaves and reaches. DndContext gets stable props and
 * a stable child (CanvasBody reads the page through CanvasData), so it does no work while typing.
 */

/** The one place things are dropped on: the page. */
const CANVAS = 'canvas';
/** At most this many pictures from one drop or paste (each its own block). */
const PICTURES_AT_ONCE = 10;
const POINTER_OPTIONS = { activationConstraint: { distance: 6 } };

/** The dragged chip under the pointer (where it was grabbed), not at the block's own corner. */
const toCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent || !('clientX' in activatorEvent)) return transform;
  const event = activatorEvent as PointerEvent;
  return { ...transform, x: transform.x + event.clientX - draggingNodeRect.left - 20, y: transform.y + event.clientY - draggingNodeRect.top - 22 };
};
const OVERLAY_MODIFIERS = [toCursor];
type Menu = { anchor: HTMLElement; index: number; replace?: string } | null;

/** The field typed in first when a block is opened with Enter. */
const MAIN_FIELD: Partial<Record<DocBlock['type'], string>> = { cover: 'title', heading: 'text', text: 'text', note: 'text', image: 'caption', video: 'caption', page: 'title' };

/** One quiet line near the selected block (spec §47.6 «рядом с выбранным блоком — одна уместная подсказка»). */
export function hintFor(block: DocBlock, doc: TestDoc, rows: ReadonlyMap<string, TestItem>, phone = false): string {
  return hintOf(block, doc.layout, block.type === 'question' ? rows.get(block.item_id) : undefined, phone);
}

/** hintFor from plain values: the block, the page's layout, its question's row (the frame has these). */
export function hintOf(block: DocBlock, layout: DocLayout, item: DocItem | undefined, phone = false): string {
  switch (block.type) {
    case 'heading':
      // A phone has no Alt and no Ctrl: the buttons above the block do the same.
      return phone ? STUDIO.hints.headingTouch : STUDIO.hints.heading;
    case 'page':
      return layout === 'pages' ? STUDIO.hints.pageOn : STUDIO.hints.pageOff;
    case 'question': {
      // On the canvas the rows are the exam's own (TestItem): all their fields are there.
      const row = item as TestItem | undefined;
      if (!row) return STUDIO.gone;
      // Each kind is asked for what it has: a short answer has no options, «верно / неверно» has a statement.
      const kind = typeOf(row);
      if (isDraftQuestion(row)) return kind === 'short' ? STUDIO.hints.questionDraftShort : kind === 'truefalse' ? STUDIO.hints.questionDraftTrueFalse : STUDIO.hints.questionDraft;
      if (row.correct.length === 0 && row.answers.length === 0 && row.kind !== 'essay') return STUDIO.hints.questionNoKey;
      if (block.required && layout === 'one_by_one') return STUDIO.hints.questionRequired;
      return kind === 'short' ? STUDIO.hints.questionShort : STUDIO.hints.question;
    }
    default:
      return STUDIO.hints[block.type];
  }
}

export function blockName(block: DocBlock, numbers: ReadonlyMap<string, number>): string {
  return block.type === 'question' ? STUDIO.questionNo(numbers.get(block.id) ?? 0) : STUDIO.types[block.type];
}

/** A function that keeps its identity and always calls the latest one given (a handler for memo children). */
function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/**
 * `on`, held a moment after it goes off: a bar or a «+» drawn only while it shows still fades out as before (its CSS
 * transition) instead of vanishing.
 */
function useLinger(on: boolean, ms = 220): boolean {
  const [, recheck] = useReducer((n: number) => n + 1, 0);
  // When it went off, kept by the render that sees it go (no update of its own then: an update made while rendering
  // left the gap's store subscription deaf — the «+» stayed under a block no longer chosen).
  const until = useRef(0);
  const was = useRef(on);
  if (was.current && !on) until.current = Date.now() + ms;
  was.current = on;
  const held = !on && Date.now() < until.current;
  useEffect(() => {
    if (!held) return undefined;
    const timer = window.setTimeout(recheck, Math.max(0, until.current - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [held]);
  return on || held;
}

// ─────────────────────────── the frame, the gaps (memo components; their facts from the store)

/** What every frame and gap of the canvas can do: stable for the canvas's life. */
interface Actions {
  store: CanvasStore;
  phone: boolean;
  select: (id: string) => void;
  key: (blockId: string, event: KeyboardEvent<HTMLDivElement>) => void;
  copy: (blockId: string) => void;
  remove: (blockId: string) => void;
  move: (blockId: string, dir: -1 | 1) => void;
  confirm: (blockId: string, yes: boolean) => void;
  settings: () => void;
  plus: (index: number, anchor: HTMLElement) => void;
}
const ActionsContext = createContext<Actions | null>(null);
const useActions = () => useContext(ActionsContext) as Actions;

/** A frame's element, and dnd-kit's hand for it (its bar's, while the bar is there). */
interface FrameNode {
  el: HTMLDivElement | null;
  drag: ((el: HTMLElement | null) => void) | null;
}

interface BarProps {
  id: string;
  type: DocBlock['type'];
  node: RefObject<FrameNode>;
  name: string;
  index: number;
  count: number;
  selected: boolean;
}

/** A block's bar, drawn only while it shows (the chosen block, the block under the mouse), and a moment after. */
const BlockBar = memo(function BlockBar({ acts, ...props }: BarProps & { acts: boolean }) {
  const shown = useLinger(acts);
  return shown ? <DragBar {...props} /> : null;
});

/**
 * The bar itself: the handle is the block's dnd-kit draggable (the block's element measured, marked while it is dragged;
 * the role read out stays «sortable»), and its buttons, the icons plain elements.
 */
const DragBar = memo(function DragBar({ id, type, node, name, index, count, selected }: BarProps) {
  const a = useActions();
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id, data: { type }, attributes: { roleDescription: 'sortable' } });
  // On a first commit the frame's element comes after this component's layout effects: the frame hands it over then.
  useLayoutEffect(() => {
    const frame = node.current as FrameNode;
    frame.drag = setNodeRef;
    if (frame.el) setNodeRef(frame.el);
    return () => {
      if (frame.drag === setNodeRef) frame.drag = null;
    };
  }, [setNodeRef, node]);
  useLayoutEffect(() => {
    const el = node.current?.el;
    el?.toggleAttribute('data-dragging', isDragging);
    return () => el?.removeAttribute('data-dragging');
  }, [isDragging, node]);
  return (
    <div className="st-acts" role="toolbar" aria-label={name} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="st-act st-act-icon st-handle" aria-label={STUDIO.handle(name)} title={STUDIO.handle(name)} {...attributes} {...listeners} tabIndex={selected ? 0 : -1}>
        {uiIcon('grip')}
      </button>
      <span className="st-sep" aria-hidden="true" />
      {/* On a phone the words beside the icons are gone: the names stay (19.10: «Ctrl+D», «Delete» and no name were read out). */}
      {a.phone ? (
        <button type="button" className="st-act" aria-label={STUDIO.blockSettings} title={STUDIO.blockSettings} onClick={a.settings}>
          {uiIcon('sliders')}
          <span>{STUDIO.panels.block}</span>
        </button>
      ) : null}
      <button type="button" className="st-act" aria-label={STUDIO.copy} title={`${STUDIO.copy} · ${STUDIO.copyKeys}`} onClick={() => a.copy(id)}>
        {uiIcon('copy')}
        <span>{STUDIO.copy}</span>
      </button>
      <button type="button" className="st-act" aria-label={STUDIO.remove} title={`${STUDIO.remove} · ${STUDIO.removeKeys}`} onClick={() => a.remove(id)}>
        {uiIcon('trash')}
        <span>{STUDIO.remove}</span>
      </button>
      <button type="button" className="st-act st-act-icon" aria-label={STUDIO.up} title={`${STUDIO.up} · Alt+↑`} disabled={index === 0} onClick={() => a.move(id, -1)}>
        {uiIcon('up')}
      </button>
      <button type="button" className="st-act st-act-icon" aria-label={STUDIO.down} title={`${STUDIO.down} · Alt+↓`} disabled={index === count - 1} onClick={() => a.move(id, 1)}>
        {uiIcon('down')}
      </button>
    </div>
  );
});

const CanvasFrame = memo(function CanvasFrame({ block, index, count, number, item, layout, problem, busy, children }: EditFrameProps) {
  const a = useActions();
  const { store, phone } = a;
  const id = block.id;
  const selected = useCanvas(store, (state) => state.selected === id);
  const hovered = useCanvas(store, (state) => state.hovered === id);
  const editingHere = useCanvas(store, (state) => state.editing !== null && state.editing.startsWith(`${id}:`));
  const confirm = useCanvas(store, (state) => (state.confirm?.blockId === id ? state.confirm.number : null));
  const node = useRef<FrameNode>({ el: null, drag: null });
  const nodeRef = useCallback((el: HTMLDivElement | null) => {
    node.current.el = el;
    node.current.drag?.(el);
  }, []);
  const yesRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm !== null) yesRef.current?.focus();
  }, [confirm]);
  const name = block.type === 'question' ? STUDIO.questionNo(number) : STUDIO.types[block.type];
  const hint = selected ? hintOf(block, layout, item, phone) : null;
  return (
    <div
      ref={nodeRef}
      className="st-block"
      data-block={id}
      data-type={block.type}
      data-index={index}
      data-selected={selected ? '' : undefined}
      tabIndex={0}
      role="group"
      aria-label={`${index + 1} из ${count}: ${name}`}
      aria-busy={busy || undefined}
      onClick={() => {
        if (!selected) a.select(id);
      }}
      onFocus={(event) => {
        if (!selected && (event.target === event.currentTarget || !(event.target as HTMLElement).closest('.st-acts'))) a.select(id);
      }}
      onKeyDown={(event) => a.key(id, event)}
      // The bar shows for the block under the mouse, as on hover before (a device that hovers: the mouse a browser
      // fakes after a finger's scroll does not count); a finger never sets it.
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && canHover()) store.set({ hovered: id });
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') store.set((state) => (state.hovered === id ? { hovered: null } : {}));
      }}
    >
      <BlockBar id={id} type={block.type} node={node} name={name} index={index} count={count} acts={selected || hovered} selected={selected} />
      {children}
      {confirm !== null ? (
        <div className="st-confirm" role="alertdialog" aria-label={STUDIO.removeQuestion(confirm)} onClick={(event) => event.stopPropagation()}>
          <p>{STUDIO.removeQuestion(confirm)}</p>
          <p className="st-confirm-acts">
            <button ref={yesRef} type="button" className="st-confirm-yes" onClick={() => a.confirm(id, true)}>
              {STUDIO.removeYes}
            </button>
            <button type="button" className="sf-link" data-muted="" onClick={() => a.confirm(id, false)}>
              {STUDIO.removeNo}
            </button>
          </p>
        </div>
      ) : null}
      {problem && !editingHere ? (
        <p className="st-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {hint ? <p className="st-hint">{hint}</p> : null}
      {block.type === 'question' && !hint ? <PercentChip itemId={block.item_id} /> : null}
    </div>
  );
});

/** The words on the drop line while a file from the computer is over the page. */
function fileLine(on: boolean): ReactNode {
  return on ? (
    <span className="st-gap-file" aria-hidden="true">
      {uiIcon('upload')}
      <span>{STUDIO.canvasDrop}</span>
    </span>
  ) : null;
}

/**
 * The gap before a block: the line where a dragged block or a file lands, and «+». The «+» exists under the chosen
 * block (reachable by Tab, seen on a touch screen) and under the mouse — nowhere else (the audit: thirty invisible «+»
 * were laid out and painted at every change).
 */
const CanvasGap = memo(function CanvasGap({ index, before }: EditGapProps) {
  const a = useActions();
  const drop = useCanvas(a.store, (state) => state.slot === index);
  const file = useCanvas(a.store, (state) => state.fileSlot === index);
  const next = useCanvas(a.store, (state) => before !== null && state.selected === before);
  const [hover, setHover] = useState(false);
  const plus = useLinger(next || hover);
  return (
    <div
      className="st-gap"
      data-drop={drop || file ? '' : undefined}
      data-file={file ? '' : undefined}
      data-next={next ? '' : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && canHover()) setHover(true);
      }}
      onPointerLeave={() => {
        if (hover) setHover(false);
      }}
    >
      {fileLine(file)}
      {plus ? (
        <button type="button" className="st-plus" aria-label={STUDIO.addHere} title={STUDIO.addHere} tabIndex={next ? 0 : -1} onClick={(event) => a.plus(index, event.currentTarget)}>
          {uiIcon('plus')}
        </button>
      ) : null}
    </div>
  );
});

const CanvasEndGap = memo(function CanvasEndGap({ index, empty }: { index: number; empty: boolean }) {
  const a = useActions();
  const drop = useCanvas(a.store, (state) => state.slot === index);
  const file = useCanvas(a.store, (state) => state.fileSlot === index);
  return (
    <div className="st-gap st-gap-end" data-drop={drop || file ? '' : undefined} data-file={file ? '' : undefined} data-empty={empty ? '' : undefined}>
      {fileLine(file)}
      {empty || file ? null : (
        <button type="button" className="st-plus st-plus-end" onClick={(event) => a.plus(index, event.currentTarget)}>
          {uiIcon('plus')}
          <span>{STUDIO.addBlock}</span>
        </button>
      )}
    </div>
  );
});

/**
 * Focus and scroll after a change: the block to focus (and to bring to the middle, if it is new) is kept here, and run
 * once the page shows it — after the canvas's render that came with the change, or (a choice made in the store, which
 * re-renders no page) after FocusAgent's, kicked for it. After a drop it waits a frame, so the drop paints first (the
 * smoothness audit of 20.10: the drop took 248–744 ms).
 */
interface FocusPlan {
  focus: string | null;
  reveal: string | null;
  late: boolean;
  kick: () => void;
}

function runPlan(plan: FocusPlan, scrollRef: RefObject<HTMLDivElement>) {
  const { focus, reveal, late } = plan;
  if (!focus && !reveal) return;
  plan.focus = null;
  plan.late = false;
  const run = () => {
    const root = scrollRef.current;
    if (focus) {
      const node = root?.querySelector<HTMLElement>(`[data-block="${focus}"]`);
      node?.focus({ preventScroll: true });
      if (reveal !== focus) node?.scrollIntoView?.({ block: 'nearest' });
    }
    // A block not on the page yet (a question still being made) is tried again at the next render.
    if (reveal && revealBlock(root, reveal) && plan.reveal === reveal) plan.reveal = null;
  };
  if (late) window.requestAnimationFrame(run);
  else run();
}

const FocusAgent = memo(function FocusAgent({ agent, scrollRef }: { agent: RefObject<FocusPlan>; scrollRef: RefObject<HTMLDivElement> }) {
  const [, kick] = useReducer((n: number) => n + 1, 0);
  (agent.current as FocusPlan).kick = kick;
  useLayoutEffect(() => runPlan(agent.current as FocusPlan, scrollRef));
  return null;
});

/** The page as the one drop target (its scrolling element): its own small component, so a drag's start and end re-render it alone. */
const CanvasDrop = memo(function CanvasDrop({ target }: { target: RefObject<HTMLDivElement> }) {
  const { setNodeRef } = useDroppable({ id: CANVAS });
  // After the page's element in the tree: it is there when this runs.
  useLayoutEffect(() => setNodeRef(target.current), [setNodeRef, target]);
  return null;
});

/**
 * Where a dragged block would land, read out (as dnd-kit did over each block: «над местом 3 из 7»): the page is one
 * target now, so the words come from the gap worked out here. They are put into this live region as they are, not by a
 * render: a drag's step re-renders nothing for them.
 */
const DragSay = memo(function DragSay({ talk }: { talk: RefObject<(words: string) => void> }) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      (talk as { current: (words: string) => void }).current = (words) => {
        if (node && node.textContent !== words) node.textContent = words;
      };
    },
    [talk],
  );
  return <div ref={ref} className="sr-only" role="status" aria-live="assertive" aria-atomic="true" />;
});

// ─────────────────────────── the canvas

export interface WorkspaceProps {
  studio: Studio;
  containerId: string;
  dark: boolean;
  device: 'desktop' | 'phone';
  /** The screen is a phone: the palette and the settings are sheets. */
  phone: boolean;
  /** The page's canvas facts (the chosen block…): StudioPage's store. */
  store: CanvasStore;
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
  /** «Холст» is the view shown (kept mounted under «Список» and «Текст»: coming back is instant). */
  active?: boolean;
  /** Release 49: «Сгенерировать из лекции, текста или файла» at the end of the palette. */
  onGenerate?: () => void;
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

/** What CanvasBody shows: the page and everything around it, fresh at each render of the canvas. */
interface CanvasData {
  doc: TestDoc;
  rows: ReadonlyMap<string, TestItem>;
  dark: boolean;
  device: 'desktop' | 'phone';
  phone: boolean;
  active: boolean;
  disabled: boolean;
  editor: DocEditApi;
  scrollRef: RefObject<HTMLDivElement>;
  fileRef: RefObject<HTMLInputElement>;
  agent: RefObject<FocusPlan>;
  talk: RefObject<(words: string) => void>;
  palette: (entry: PaletteEntry) => void;
  generate?: () => void;
  sideNode: ReactNode;
  paletteOpen: boolean;
  sideOpen: boolean;
  sheetAway: boolean;
  closePalette: () => void;
  closeSide: () => void;
  panel: Panel;
  dragLabel: { entry: PaletteEntry | null; name: string } | null;
  menu: Menu;
  closeMenu: () => void;
  pickMenu: (entry: PaletteEntry) => void;
  undoNote: { name: string; doc: TestDoc | null } | null;
  undoRemove: () => void;
  fileEvents: {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
    onDragOver: (event: DragEvent<HTMLDivElement>) => void;
    onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
    onDrop: (event: DragEvent<HTMLDivElement>) => void;
  };
  canvasClick: (target: HTMLElement) => void;
  fileChosen: (file: File | undefined) => void;
}
const CanvasDataContext = createContext<CanvasData | null>(null);

/**
 * Everything under DndContext. It reads the page from CanvasData (not from props), so DndContext — a memo with stable
 * props — gets the same child at every render and does no work while typing.
 */
function CanvasBody() {
  const d = useContext(CanvasDataContext) as CanvasData;
  const a = useActions();
  const fileOver = useCanvas(a.store, (state) => state.fileSlot !== null);
  const { phone, device } = d;
  return (
    <>
      <div className="st-work" data-phone={phone ? '' : undefined} hidden={!d.active}>
        {phone ? null : (
          <aside className="st-col st-col-left" data-tour="palette" aria-label={STUDIO.palette}>
            <Palette disabled={d.disabled} onPick={d.palette} onGenerate={d.generate} />
          </aside>
        )}

        <section className="st-canvas" data-device={phone ? 'phone' : device} aria-label={STUDIO.canvas}>
          <div className="st-frame" data-device={phone ? 'fluid' : device}>
            <div
              ref={d.scrollRef}
              className="st-scroll"
              data-tour="canvas"
              data-file-over={fileOver ? '' : undefined}
              onDragEnter={d.fileEvents.onDragEnter}
              onDragOver={d.fileEvents.onDragOver}
              onDragLeave={d.fileEvents.onDragLeave}
              onDrop={d.fileEvents.onDrop}
              onClick={(event) => d.canvasClick(event.target as HTMLElement)}
            >
              <DocView mode="edit" doc={d.doc} items={d.rows} dark={d.dark} editor={d.editor} className="st-doc" />
            </div>
            <CanvasDrop target={d.scrollRef} />
          </div>
        </section>

        {phone ? null : (
          <aside className="st-col st-col-right st-side" aria-label={STUDIO.panelsLabel}>
            {d.sideNode}
          </aside>
        )}
      </div>
      <FocusAgent agent={d.agent} scrollRef={d.scrollRef} />
      <DragSay talk={d.talk} />

      {phone && d.active && d.paletteOpen ? (
        <Sheet title={STUDIO.palette} onClose={d.closePalette} away={d.sheetAway}>
          <Palette disabled={d.disabled} hint={false} onPick={d.palette} onGenerate={d.generate} />
        </Sheet>
      ) : null}
      {/* «Проверка теста» has its own title: the tabs of the settings are not shown over it (StudioPage, Side `tabs`). */}
      {phone && d.active && d.sideOpen ? (
        <Sheet title={d.panel === 'check' ? STUDIO.check : STUDIO.panelsLabel} onClose={d.closeSide} className="st-side">
          {d.sideNode}
        </Sheet>
      ) : null}

      <DragOverlay dropAnimation={null} modifiers={OVERLAY_MODIFIERS}>
        {d.dragLabel ? (
          <div className="st-ghost">
            {d.dragLabel.entry ? <EntryIcon entry={d.dragLabel.entry} /> : null}
            <span>{d.dragLabel.name}</span>
          </div>
        ) : null}
      </DragOverlay>

      {d.menu && d.active ? <BlockMenu anchor={d.menu.anchor} onClose={d.closeMenu} onPick={d.pickMenu} /> : null}

      {phone && d.active && d.undoNote ? (
        <div className="st-toast">
          <p className="st-toast-t">{STUDIO.removed(d.undoNote.name, true)}</p>
          <button type="button" className="st-toast-btn" onClick={d.undoRemove}>
            {STUDIO.undoRemove}
          </button>
        </div>
      ) : null}

      <input
        ref={d.fileRef}
        type="file"
        // image/* (on a phone: the photos); the helper redraws what the bucket does not take and names a HEIC the browser
        // cannot draw.
        accept="image/*"
        hidden
        data-studio-file=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          d.fileChosen(file);
        }}
      />
    </>
  );
}

export default function Workspace({
  studio,
  containerId,
  dark,
  device,
  phone,
  store,
  onSelect,
  panel,
  onPanel,
  side,
  empty,
  paletteOpen,
  onPaletteOpen,
  sideOpen,
  onSideOpen,
  active = true,
  onGenerate,
}: WorkspaceProps) {
  const { doc, rows } = studio;
  // The ids keep their array while the order is the same (the keyboard's drag reads them; a key typed changes nothing).
  const idsKey = doc.blocks.map((block) => block.id).join(' ');
  const ids = useMemo(() => (idsKey ? idsKey.split(' ') : []), [idsKey]);
  const numbers = useMemo(() => {
    const out = new Map<string, number>();
    for (const block of doc.blocks) if (block.type === 'question' && rows.has(block.item_id)) out.set(block.id, out.size + 1);
    return out;
  }, [doc.blocks, rows]);
  const [menu, setMenu] = useState<Menu>(null);
  const [dragId, setDragId] = useState<UniqueIdentifier | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRect = useRef<DOMRect | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pictureTarget = useRef<PictureTarget | null>(null);
  /** Uploads under way and the words of failed ones, by targetKey. */
  const [uploads, setUploads] = useState<Readonly<Record<string, UploadStage>>>({});
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  /** After a removal on a touch screen: the line with «Вернуть», while the page is the page that removal made. */
  const [undoNote, setUndoNote] = useState<{ name: string; doc: TestDoc | null } | null>(null);
  // Set only when it changes (a same-value update after every key typed still cost a commit of its own).
  useEffect(() => {
    if (!undoNote) return;
    if (undoNote.doc === null) setUndoNote({ ...undoNote, doc });
    else if (undoNote.doc !== doc) setUndoNote(null);
  }, [doc, undoNote]);
  useEffect(() => {
    if (!undoNote) return;
    const timer = window.setTimeout(() => setUndoNote(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undoNote]);
  const selectedNow = () => store.get().selected;
  const setEditingKey = (key: string | null) => store.set({ editing: key });
  const setConfirm = (confirm: { blockId: string; number: number } | null) => store.set({ confirm });

  // Focus follows a move, a copy, a removal: the block (or its neighbour) once the page shows it. A block just added is
  // brought to the middle of the screen (`reveal`): on a phone `nearest` left it under the bottom bar.
  const agent = useRef<FocusPlan>({ focus: null, reveal: null, late: false, kick: () => undefined });
  useLayoutEffect(() => runPlan(agent.current, scrollRef));
  const focusBlock = (id: string | null, late = false) => {
    agent.current.focus = id;
    agent.current.late = agent.current.late || late;
    agent.current.kick();
  };
  const revealNew = (id: string) => {
    agent.current.reveal = id;
    agent.current.kick();
  };

  const indexOf = (id: string | null) => (id ? doc.blocks.findIndex((block) => block.id === id) : -1);
  const afterSelected = () => {
    const at = indexOf(selectedNow());
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
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const uploadFile = (target: PictureTarget, file: Blob) => {
    if (uploadsRef.current[targetKey(target)]) return;
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
  // question editor's texts, a picture field); the preview is not the page; «Список» and «Текст» are not the canvas.
  const pasteRef = useRef<(event: ClipboardEvent) => void>(() => undefined);
  pasteRef.current = (event: ClipboardEvent) => {
    if (!active || event.defaultPrevented || studio.busy !== null) return;
    const files = pictureFiles(event.clipboardData?.files);
    if (files.length === 0) return;
    const from = event.target instanceof Element ? event.target : null;
    if (from?.closest('.st-preview')) return;
    event.preventDefault();
    const chosen = doc.blocks[indexOf(selectedNow())];
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
  const fileGone = useCallback(() => {
    fileDepth.current = 0;
    store.set({ fileSlot: null });
  }, [store]);

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
  }, [fileGone]);
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
    store.set({ fileSlot: slotAtY(event.clientY) });
  };
  const fileOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer) || dragId !== null || event.defaultPrevented) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = studio.busy !== null ? 'none' : 'copy';
    store.set({ fileSlot: slotAtY(event.clientY) });
  };
  const fileLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingFiles(event.dataTransfer)) return;
    fileDepth.current = Math.max(0, fileDepth.current - 1);
    if (fileDepth.current === 0) store.set({ fileSlot: null });
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

  const onKey = (blockId: string, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    const at = indexOf(blockId);
    const block = doc.blocks[at];
    if (!block) return;
    const mod = event.ctrlKey || event.metaKey;
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
    } else if (event.key === 'Escape' && store.get().confirm) {
      event.preventDefault();
      setConfirm(null);
    }
  };

  // ─────────────────────────── dragging ───────────────────────────

  /**
   * The keyboard's drag goes block by block (↑ ↓), then past the last one: the place it is over (an index of the blocks,
   * their number for the end) is kept here — the page's blocks are of any height, so a guess by distance would skip or
   * stick.
   */
  const keyTarget = useRef<number | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const keyboardCoordinates: KeyboardCoordinateGetter = useCallback((event, { context, currentCoordinates }) => {
    if (event.code !== 'ArrowDown' && event.code !== 'ArrowUp') return undefined;
    event.preventDefault();
    const list = idsRef.current;
    const from = keyTarget.current ?? list.indexOf(String(context.active?.id ?? ''));
    const at = Math.max(0, Math.min(list.length, (from < 0 ? 0 : from) + (event.code === 'ArrowDown' ? 1 : -1)));
    keyTarget.current = at;
    const root = scrollRef.current;
    const node = at === list.length ? root?.querySelector<HTMLElement>('.st-gap-end') : root?.querySelector<HTMLElement>(`[data-block="${list[at]}"]`);
    const rect = node?.getBoundingClientRect();
    return rect ? { x: rect.left, y: rect.top } : currentCoordinates;
  }, []);
  const keyboardOptions = useMemo(() => ({ coordinateGetter: keyboardCoordinates, scrollBehavior: reducedMotion() ? ('auto' as const) : ('smooth' as const) }), [keyboardCoordinates]);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTIONS), useSensor(KeyboardSensor, keyboardOptions));

  /** The pointer, as dnd-kit last saw it (null for the keyboard). */
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  // Over the page, or nowhere: outside the page a drop is no drop (the palette, the settings).
  const collision: CollisionDetection = useCallback(({ pointerCoordinates, droppableContainers }) => {
    pointerAt.current = pointerCoordinates;
    const page = droppableContainers.find((entry) => entry.id === CANVAS);
    if (!page) return [];
    const rect = canvasRect.current;
    const p = pointerCoordinates;
    if (p && rect && (p.x < rect.left || p.x > rect.right || p.y < rect.top || p.y > rect.bottom)) return [];
    return [{ id: page.id, data: { droppableContainer: page, value: 0 } }];
  }, []);

  /**
   * The blocks' middles in the window, measured once a drag is on its way (after the dragged block was chosen, which
   * makes the gap under it taller), with the scroll of the page then; the scroll since is followed by its own events.
   */
  const places = useRef<{ mids: number[]; scroller: Element | null; top: number } | null>(null);
  const scrolled = useRef(0);
  const followScroll = useCallback((event: Event) => {
    const scroller = places.current?.scroller;
    if (scroller && (event.target === scroller || (event.target === document && scroller === document.scrollingElement))) scrolled.current = scroller.scrollTop;
  }, []);
  const stopFollowing = useCallback(() => document.removeEventListener('scroll', followScroll, { capture: true }), [followScroll]);
  useEffect(() => stopFollowing, [stopFollowing]);
  /** The gap under the pointer: before the first block whose middle is below it. */
  const pointerSlot = (y: number): number => {
    if (!places.current) {
      const scroller = phone ? document.scrollingElement : scrollRef.current;
      const frames = scrollRef.current?.querySelectorAll<HTMLElement>('.st-block[data-index]') ?? [];
      const mids = Array.from(frames, (frame) => {
        const rect = frame.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      places.current = { mids, scroller, top: scroller?.scrollTop ?? 0 };
      scrolled.current = places.current.top;
    }
    const { mids, top } = places.current;
    const shift = scrolled.current - top;
    for (let at = 0; at < mids.length; at += 1) if (y < mids[at] - shift) return at;
    return mids.length;
  };

  /** The gap the dragged thing would land in: 0 — before the first block, blocks.length — after the last; null — outside. */
  const slotOf = (event: DragMoveEvent): number | null => {
    if (!event.over) return null;
    const id = event.active.id;
    const fresh = paletteEntry(id) !== null;
    const from = fresh ? -1 : ids.indexOf(String(id));
    const key = keyTarget.current;
    // The keyboard: a block takes the place of the one it is over (below it when coming from above).
    if (key !== null) return fresh || key >= ids.length ? key : key > from ? key + 1 : key;
    const pointer = pointerAt.current;
    if (!pointer) return fresh ? null : from;
    return pointerSlot(pointer.y);
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

  /** The place (from 1) a dragged thing would take at gap `at`, and the number of places. */
  const placeAt = (dragged: UniqueIdentifier, at: number): [number, number] => {
    const fresh = paletteEntry(dragged) !== null;
    const count = doc.blocks.length + (fresh ? 1 : 0);
    const from = fresh ? -1 : ids.indexOf(String(dragged));
    const index = fresh || at <= from ? at : at - 1;
    return [Math.min(index, count - 1) + 1, count];
  };
  /** The gap last worked out (kept after the drop: the words of the end are said after it). */
  const lastSlot = useRef<number | null>(null);
  const talk = useRef<(words: string) => void>(() => undefined);
  const say = {
    start: useEvent((id: UniqueIdentifier) => STUDIO.dnd.start(nameOf(id))),
    over: (id: UniqueIdentifier, at: number | null) => {
      if (at === null) return STUDIO.dnd.outside;
      const [place, count] = placeAt(id, at);
      return STUDIO.dnd.over(place, count);
    },
    end: useEvent((id: UniqueIdentifier, over: UniqueIdentifier | null) => {
      const at = lastSlot.current;
      return over === null || at === null ? STUDIO.dnd.cancel(nameOf(id)) : STUDIO.dnd.end(nameOf(id), placeAt(id, at)[0]);
    }),
    cancel: useEvent((id: UniqueIdentifier) => STUDIO.dnd.cancel(nameOf(id))),
  };
  const accessibility = useMemo(() => {
    // Where it would land is said by DragSay, from the gap (the page is one target: dnd-kit's «over» stays the same).
    const announcements: Announcements = {
      onDragStart: ({ active: dragged }) => say.start(dragged.id),
      onDragOver: () => undefined,
      onDragEnd: ({ active: dragged, over }) => say.end(dragged.id, over ? over.id : null),
      onDragCancel: ({ active: dragged }) => say.cancel(dragged.id),
    };
    return { announcements, screenReaderInstructions: { draggable: STUDIO.dnd.instructions } };
    // The speakers are stable (useEvent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDragStart = useEvent((event: DragStartEvent) => {
    const id = event.active.id;
    keyTarget.current = null;
    pointerAt.current = null;
    places.current = null;
    lastSlot.current = paletteEntry(id) ? null : ids.indexOf(String(id));
    canvasRect.current = scrollRef.current?.getBoundingClientRect() ?? null;
    document.addEventListener('scroll', followScroll, { capture: true, passive: true });
    setDragId(id);
    store.set({ slot: null, editing: null });
    if (!paletteEntry(id)) onSelect(String(id));
  });
  /**
   * A block dragged by finger out of the «Блоки» sheet: the sheet steps away at once, so the page and the line where
   * the block lands are seen (it is closed when the drag ends; until then the dragged item stays mounted).
   */
  const sheetAway = phone && dragId !== null && paletteEntry(dragId) !== null;
  // The line goes to the store: the two gaps it leaves and reaches re-render, nothing else.
  const onDragMove = useEvent((event: DragMoveEvent) => {
    const id = event.active.id;
    const at = slotOf(event);
    if (at !== lastSlot.current) {
      lastSlot.current = at;
      talk.current?.(say.over(id, at));
    }
    const shown = still(id, at) ? null : at;
    if (store.get().slot === shown) return;
    store.set({ slot: shown });
    // A keyboard drag keeps the line where the block will land in sight.
    if (shown !== null && keyTarget.current !== null) {
      window.requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>('.st-gap[data-drop]')?.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }));
    }
  });
  const dragDone = () => {
    keyTarget.current = null;
    places.current = null;
    stopFollowing();
    setDragId(null);
    store.set({ slot: null });
  };
  const onDragEnd = useEvent((event: DragEndEvent) => {
    const at = slotOf(event);
    lastSlot.current = at;
    const id = event.active.id;
    dragDone();
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
    // The drop paints first; the focus and the scroll come a frame later.
    focusBlock(String(id), true);
  });
  const onDragCancel = useEvent((event: { active: { id: UniqueIdentifier } }) => {
    dragDone();
    if (phone && paletteEntry(event.active.id)) onPaletteOpen(false);
  });
  // Only the page scrolls while something is dragged over it (not the palette, not the window).
  const autoScroll = useMemo(() => ({ threshold: { x: 0, y: 0.12 }, canScroll: (element: Element) => element === scrollRef.current || (phone && element === document.scrollingElement) }), [phone]);

  // ─────────────────────────── the page ───────────────────────────

  /** A failure's words; a picture block left without its picture is told it is not saved so (live check of 47.4). */
  function noteOf(target: PictureTarget): string | null {
    const note = notes[targetKey(target)] ?? null;
    if (!note || target.kind !== 'image') return note;
    const block = doc.blocks.find((entry) => entry.id === target.blockId);
    return block?.type === 'image' && !block.path ? `${note} ${STUDIO.pictureNotSaved}` : note;
  }

  // The latest of everything the stable editor and actions read (they are called while this render's page is shown).
  const live = useRef({ uploads, noteOf, problems: studio.problems, busy: studio.busy, empty });
  live.current = { uploads, noteOf, problems: studio.problems, busy: studio.busy, empty };

  const selectAction = useEvent((id: string) => {
    if (selectedNow() !== id) onSelect(id);
  });
  const keyAction = useEvent(onKey);
  const copyAction = useEvent((id: string) => void copy(id));
  const removeAction = useEvent((id: string) => {
    const block = doc.blocks.find((entry) => entry.id === id);
    if (block) askRemove(block);
  });
  const moveAction = useEvent(moveBy);
  const confirmAction = useEvent((id: string, yes: boolean) => {
    if (yes) removeNow(id);
    else {
      setConfirm(null);
      focusBlock(id);
    }
  });
  const settingsAction = useEvent(() => {
    onPanel('block');
    onSideOpen(true);
  });
  const plusAction = useEvent((index: number, anchor: HTMLElement) => setMenu({ anchor, index }));
  const actions = useMemo<Actions>(
    () => ({ store, phone, select: selectAction, key: keyAction, copy: copyAction, remove: removeAction, move: moveAction, confirm: confirmAction, settings: settingsAction, plus: plusAction }),
    [store, phone, selectAction, keyAction, copyAction, removeAction, moveAction, confirmAction, settingsAction, plusAction],
  );

  const setEditing = useEvent((key: string | null, how?: 'blur' | 'enter' | 'escape') => {
    setEditingKey(key);
    const chosen = selectedNow();
    if (!key && (how === 'enter' || how === 'escape') && chosen) focusBlock(chosen);
  });
  const changeText = useEvent((blockId: string, patch: Record<string, unknown>, field: string) => {
    studio.change((current) => ({ ...current, blocks: current.blocks.map((block) => (block.id === blockId ? ({ ...block, ...patch } as DocBlock) : block)) }), typingKey(blockId, field));
  });
  const slash = useEvent((blockId: string, anchor: HTMLElement) => setMenu({ anchor, index: indexOf(blockId), replace: blockId }));
  const pickImage = useEvent((blockId: string) => pickPicture({ kind: 'image', blockId }));
  const dropPicture = useEvent((blockId: string, file: Blob) => uploadFile({ kind: 'image', blockId }, file));
  const editor = useMemo<DocEditApi>(
    () => ({
      Frame: CanvasFrame,
      Gap: CanvasGap,
      EndGap: CanvasEndGap,
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEditing: (key) => useCanvas(store, (state) => state.editing === key),
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useSelected: (blockId) => useCanvas(store, (state) => state.selected === blockId),
      setEditing,
      change: changeText,
      slash,
      pickImage,
      dropPicture,
      pictureStage: (blockId) => live.current.uploads[`image:${blockId}`] ?? null,
      pictureNote: (blockId) => live.current.noteOf({ kind: 'image', blockId }),
      problemOf: (blockId) => live.current.problems.get(blockId) ?? null,
      busyId: () => live.current.busy,
      touch: phone,
      get empty() {
        return live.current.empty;
      },
    }),
    [store, phone, setEditing, changeText, slash, pickImage, dropPicture],
  );

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

  const palettePick = useEvent((entry: PaletteEntry) => void add(entry, afterSelected()));
  const closePalette = useEvent(() => onPaletteOpen(false));
  const closeSide = useEvent(() => onSideOpen(false));
  const closeMenu = useEvent(() => setMenu(null));
  const pickMenu = useEvent((entry: PaletteEntry) => {
    if (!menu) return;
    const { index, replace } = menu;
    setMenu(null);
    void add(entry, index, replace);
  });
  const undoRemove = useEvent(() => {
    setUndoNote(null);
    studio.undo();
  });
  const canvasClick = useEvent((target: HTMLElement) => {
    if (!target.closest('.st-block, .st-gap, .st-start')) {
      onSelect(null);
      setEditingKey(null);
    }
  });
  const fileChosen = useEvent((file: File | undefined) => {
    const target = pictureTarget.current;
    if (file && target) uploadFile(target, file);
  });
  const fileEvents = useMemo(
    () => ({ onDragEnter: (event: DragEvent<HTMLDivElement>) => events.current.enter(event), onDragOver: (event: DragEvent<HTMLDivElement>) => events.current.over(event), onDragLeave: (event: DragEvent<HTMLDivElement>) => events.current.leave(event), onDrop: (event: DragEvent<HTMLDivElement>) => events.current.drop(event) }),
    [],
  );
  const events = useRef({ enter: fileEnter, over: fileOver, leave: fileLeave, drop: fileDrop });
  events.current = { enter: fileEnter, over: fileOver, leave: fileLeave, drop: fileDrop };

  // The palette's «Сгенерировать…»: on a phone its sheet closes first (release 49).
  const generate = useMemo(
    () => (onGenerate ? () => {
      if (phone) onPaletteOpen(false);
      onGenerate();
    } : undefined),
    [onGenerate, onPaletteOpen, phone],
  );
  const dragEntry = dragId !== null ? paletteEntry(dragId) : null;
  const dragBlock = dragId !== null && !dragEntry ? doc.blocks.find((block) => block.id === dragId) ?? null : null;
  const data: CanvasData = {
    doc,
    rows,
    dark,
    device,
    phone,
    active,
    disabled: studio.busy !== null,
    editor,
    scrollRef,
    fileRef,
    agent,
    talk,
    palette: palettePick,
    generate,
    sideNode: active && (!phone || sideOpen) ? side(sideApi) : null,
    paletteOpen,
    sideOpen,
    sheetAway,
    closePalette,
    closeSide,
    panel,
    dragLabel: dragEntry ? { entry: dragEntry, name: entryLabel(dragEntry) } : dragBlock ? { entry: null, name: blockName(dragBlock, numbers) } : null,
    menu,
    closeMenu,
    pickMenu,
    undoNote,
    undoRemove,
    fileEvents,
    canvasClick,
    fileChosen,
  };
  // DndContext's child: one element for the canvas's life (with the questions' percents of release 49 around it).
  const body = useMemo(() => <ItemPercentsProvider containerId={containerId}><CanvasBody /></ItemPercentsProvider>, [containerId]);

  return (
    <ActionsContext.Provider value={actions}>
      <CanvasDataContext.Provider value={data}>
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragOver={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
          accessibility={accessibility}
          autoScroll={autoScroll}
        >
          {body}
        </DndContext>
      </CanvasDataContext.Provider>
    </ActionsContext.Provider>
  );
}
