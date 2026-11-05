import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref, type RefObject } from 'react';
import { isPictureFile, pictureFromFile, picturePath, uploadPicture } from '../../../api/itemPictures';
import { PICTURE_LIMITS, type BankPicture, type TestItem } from '../../../types/container';
import { EDITOR, letter, nb } from '../copyImport';
import ItemPictures, { type PictureSource } from '../ItemPictures';
import {
  appendOption,
  draftChanged,
  draftOf,
  draftProblems,
  emptyDraft,
  explanationText,
  kindForced,
  patchOf,
  removeOption,
  resetsProgress,
  switchKind,
  tickOnly,
  toggleTick,
  EXPLANATION_COUNT_FROM,
  LIMITS,
  type Draft,
  type DraftProblem,
} from './editorModel';
import { createDraftStore, DraftInput, DraftText, useDraft, useDrawn, type DraftStore } from './draftStore';
import KindFields, { PartialCheck } from './KindFields';
import { KIND_NAMES } from '../../kinds/copyKinds';
import './keys.css';

/** The kinds a new question can be (release 48 adds the last five; «Выбор из вариантов» holds one or several). */
const KIND_CHOICES = ['choice', 'short', 'number', 'order', 'match', 'cloze', 'essay'] as const;
type KindChoice = (typeof KIND_CHOICES)[number];
const kindChoiceOf = (draft: Draft): KindChoice => draft.kind ?? (draft.short ? 'short' : 'choice');

/**
 * The author's editor of one question in «Вопросы и ключи» (spec 2026-10-16 part 1) and «Конструктор» (release 47):
 * the text (code shown as typed when ticked), the pictures of the question and of each option (a file or Ctrl+V into
 * the field; uploaded at once into the exam's folder of the bucket, named by their sha256), the options as compact rows
 * (a tick, the letter, the field, a picture button and «×»; Enter goes to the next option or adds one after the last,
 * Shift+Enter breaks the line) with a live line of what is ticked and what the student does, or the accepted forms of
 * a short answer, and an optional explanation shown with the key (release 47; a counter near its limit). The fields
 * grow with their text. It says before saving when the change restarts the question for the group (decision 15; an
 * explanation never does) and when the question would have no key. The page saves: an existing question through
 * container_item_update, a new one through container_items_add (editorModel.ts). A page that guards changes not saved
 * hears of them (`onDirty`) and asks about them inside the editor (`unsaved`: «Сохранить» / «Не сохранять»); a page
 * with a «Сохранить» of its own (the studio's top bar, Ctrl+S, «Сохранить и выйти») presses this one through `handle`.
 */

type Target = 'stem' | number;

/** What a page may ask of the editor (the studio's «Сохранить» for everything, Ctrl+S, «Сохранить и выйти»). */
export interface EditorHandle {
  /**
   * The editor's «Сохранить», with its checks and its lines: true once nothing is left unsaved (nothing was, or the
   * page's save of it went through); false when the editor stopped it (a problem shown, a picture still loading, a save
   * already on its way) or the page's save failed (its error shown in the editor).
   */
  save: () => Promise<boolean>;
}

interface Props {
  containerId: string;
  /** null — a new question. */
  item: TestItem | null;
  context: string;
  /** The exam has members: a change of the key restarts the question for them too. */
  group: boolean;
  busy?: boolean;
  /** The page's line after a failed save. */
  error?: string | null;
  /** The page's save; a promise of false when it failed (`handle.save` then answers false). */
  onSave: (draft: Draft) => void | Promise<unknown>;
  onCancel: () => void;
  /** Puts a picture into the bucket (tests replace it). */
  upload?: (path: string, picture: BankPicture) => Promise<'kept' | 'refused'>;
  /** A new question of «Конструктор»: the blue pill saves it and opens a blank one of the same kind; «Сохранить» stays beside it. */
  onSaveNext?: (draft: Draft) => void;
  /** «Верно / неверно»: one tick at a time, the two options fixed and without pictures. */
  trueFalse?: boolean;
  /** The line when no option is ticked, in the page's words (EDITOR.noKey by default). */
  noKeyNote?: string;
  /** Told when the editor starts or stops holding changes not saved (editorModel.draftChanged). */
  onDirty?: (dirty: boolean) => void;
  /** The page asks what to do with the changes before it goes on: the line, «Сохранить» and «Не сохранять». */
  unsaved?: string | null;
  onDiscard?: () => void;
  /** The page's way to press «Сохранить» (EditorHandle). */
  handle?: Ref<EditorHandle>;
  /** A draft the page kept for this question (the editor mounted again elsewhere): taken instead of the question's own. */
  initialDraft?: Draft | null;
  /** Told of every change of the draft (the page keeps it while it differs from the question). */
  onDraft?: (draft: Draft) => void;
}

const GROWS = 'textarea.qe-text';

/**
 * Fields as tall as their text (resize none): the height is the scroll height. All the writes come first, then all
 * the reads, then the writes again, so a keystroke lays the page out once (smoothness audit 20.10: a key in the
 * constructor's question laid it out six times — the width, the page's scroll before and after, each field). A field
 * is set to its natural height to be measured with its old height held under it as a margin: the page below does not
 * move up meanwhile, so the window keeps its scroll without reading it.
 */
function grow(fields: readonly HTMLTextAreaElement[]) {
  if (fields.length === 0) return;
  for (const field of fields) {
    const held = field.style.height;
    if (held) field.style.marginBottom = held;
    field.style.height = 'auto';
  }
  const heights = fields.map((field) => field.scrollHeight);
  fields.forEach((field, index) => {
    field.style.removeProperty('margin-bottom');
    if (heights[index] > 0) field.style.height = `${heights[index]}px`;
    else field.style.removeProperty('height');
  });
}

/**
 * Fields typed in, grown without laying the page out again (release 49: a key in «Ключи» laid it out three times — the
 * browser's own edit, this read after a write, the frame): the scroll height is read first, while the page is still
 * laid out from the key's edit, and the height is written only when the text no longer fits. A field never gets shorter
 * here; that needs its natural height (grow) and waits for a pause in the typing (SHRINK_AFTER_MS).
 */
function growTyped(fields: readonly HTMLTextAreaElement[]) {
  if (fields.length === 0) return;
  const heights = fields.map((field) => field.scrollHeight);
  fields.forEach((field, index) => {
    const held = Number.parseFloat(field.style.height);
    if (heights[index] > 0 && !(heights[index] <= held)) field.style.height = `${heights[index]}px`;
  });
}

/** A pause in the typing after which the fields typed in take their natural height again (they may have got shorter). */
const SHRINK_AFTER_MS = 400;

function PictureIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7.4" cy="8.2" r="1.5" fill="currentColor" />
      <path d="M3.5 14.5l4.2-3.8 2.8 2.4 2.6-2.3 3.4 3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** What the editor says of a draft: its problems, whether it changed the question, restarts it, holds changes. */
interface Facts {
  problems: DraftProblem[];
  /** An existing question the draft leaves as it is (editorModel.patchOf: nothing to send). */
  unchanged: boolean;
  /** The change restarts the question for the group (decision 15). */
  resets: boolean;
  /** Something not saved (editorModel.draftChanged). */
  dirty: boolean;
  /** The explanation's length as saved. */
  explained: number;
  /** A choice question with nothing ticked. */
  noKey: boolean;
}
type ReadFacts = (draft: Draft) => Facts;

/** The facts of a draft, worked out once for each change (the lines that read them each pick their own answer). */
function factsReader(item: TestItem | null, group: boolean): ReadFacts {
  let last: { draft: Draft; facts: Facts } | null = null;
  return (draft) => {
    if (last && last.draft === draft) return last.facts;
    const patch = item ? patchOf(item, draft) : null;
    const facts: Facts = {
      problems: draftProblems(draft),
      unchanged: Boolean(item) && patch === null,
      resets: Boolean(item && patch && group && resetsProgress(item, patch)),
      dirty: item ? patch !== null : draftChanged(null, draft),
      explained: explanationText(draft).length,
      noKey: !draft.kind && !draft.short && draft.correct.length === 0 && draft.options.length >= 2,
    };
    last = { draft, facts };
    return facts;
  };
}

/** What stops «Сохранить», what the change does, the page's error: renders when one of them changes, not at each key. */
function Notes({ store, facts, noKeyNote, error }: { store: DraftStore; facts: ReadFacts; noKeyNote: string; error: string | null }) {
  const problemWords = useDraft(store, (draft) => facts(draft).problems.join(' '));
  const noKey = useDraft(store, (draft) => facts(draft).noKey);
  const resets = useDraft(store, (draft) => facts(draft).resets);
  const problems = problemWords ? (problemWords.split(' ') as DraftProblem[]) : [];
  return (
    <div className="qe-notes" aria-live="polite">
      {problems.map((problem) => (
        <p key={problem} className="kq-note qe-problem">
          {EDITOR.problems[problem]}
        </p>
      ))}
      {problems.length === 0 && noKey ? <p className="kq-note qe-warn">{noKeyNote}</p> : null}
      {resets ? <p className="kq-note qe-warn">{EDITOR.resets}</p> : null}
      {error ? (
        <p className="kq-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** «Пояснение»: its length counted (and read out) near the limit; only then does a key render the counter. */
function ExplanationField({ id, store, facts, busy, onTyped }: { id: string; store: DraftStore; facts: ReadFacts; busy: boolean; onTyped: () => void }) {
  const counted = useDraft(store, (draft) => {
    const length = facts(draft).explained;
    return length >= EXPLANATION_COUNT_FROM ? length : -1;
  });
  return (
    <>
      <DraftText
        store={store}
        path="explanation"
        id={`${id}-explanation`}
        className="qe-text qe-explanation"
        rows={2}
        maxLength={LIMITS.explanation + 200}
        disabled={busy}
        aria-describedby={counted >= 0 ? `${id}-explanation-count` : undefined}
        aria-invalid={counted > LIMITS.explanation ? true : undefined}
        onTyped={onTyped}
      />
      {counted >= 0 ? (
        <p id={`${id}-explanation-count`} className="qe-count" data-over={counted > LIMITS.explanation ? '' : undefined}>
          {EDITOR.explanationCount(counted, LIMITS.explanation)}
        </p>
      ) : null}
    </>
  );
}

interface ActionsProps {
  id: string;
  store: DraftStore;
  facts: ReadFacts;
  /** The draft the editor last had when the question came (or changed): «Ничего не изменилось» waits for a change. */
  base: Draft;
  /** Nothing on its way (a save, a picture). */
  open: boolean;
  busy: boolean;
  item: boolean;
  saveNext: boolean;
  unsaved: string | null;
  guardRef: RefObject<HTMLButtonElement>;
  discardRef: RefObject<HTMLButtonElement>;
  onSave: () => void;
  onCancel: () => void;
  onDiscard?: () => void;
}

/** The editor's buttons: «Сохранить» on while the draft can go, «Ничего не изменилось» for a change taken back. */
function Actions({ id, store, facts, base, open, busy, item, saveNext, unsaved, guardRef, discardRef, onSave, onCancel, onDiscard }: ActionsProps) {
  const ready = useDraft(store, (draft) => {
    const now = facts(draft);
    return now.problems.length === 0 && !now.unchanged;
  });
  const nothing = useDraft(store, (draft) => draft !== base && facts(draft).unchanged);
  const canSave = open && ready;
  const saving = busy ? EDITOR.saving : null;
  if (unsaved) {
    // The page waits for an answer about the changes: save them and go on, or leave them and go on.
    return (
      <div className="qe-unsaved" role="group" aria-labelledby={`${id}-unsaved`}>
        <p id={`${id}-unsaved`} className="qe-unsaved-text">
          {nb(unsaved)}
        </p>
        <div className="qe-actions">
          <button ref={guardRef} type="submit" className="sf-primary" disabled={!canSave} aria-busy={busy || undefined}>
            {saving ?? EDITOR.save}
          </button>
          <button ref={discardRef} type="button" className="sf-link" disabled={busy} onClick={onDiscard}>
            {EDITOR.discard}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="qe-actions">
      <button type="submit" className="sf-primary" disabled={!canSave} aria-busy={busy || undefined}>
        {saving ?? (saveNext ? EDITOR.saveNext : item ? EDITOR.save : EDITOR.add)}
      </button>
      {saveNext ? (
        <button type="button" className="sf-secondary" disabled={!canSave} onClick={onSave}>
          {EDITOR.save}
        </button>
      ) : null}
      <button type="button" className="sf-link" disabled={busy} onClick={onCancel}>
        {EDITOR.cancel}
      </button>
      {nothing ? <span className="qe-same">{EDITOR.nothing}</span> : null}
    </div>
  );
}

export default function QuestionEditor({
  containerId,
  item,
  context,
  group,
  busy = false,
  error = null,
  onSave,
  onCancel,
  upload = uploadPicture,
  onSaveNext,
  trueFalse = false,
  noKeyNote = EDITOR.noKey,
  onDirty,
  unsaved = null,
  onDiscard,
  handle,
  initialDraft = null,
  onDraft,
}: Props) {
  const id = useId();
  // The draft lives in a store (draftStore.tsx): the editor renders for a change it draws, never for a key typed.
  const [store] = useState(() => createDraftStore(initialDraft ?? (item ? draftOf(item) : emptyDraft())));
  useDrawn(store);
  const draft = store.get();
  const setDraft = store.update;
  const [local, setLocal] = useState<Record<string, BankPicture>>({});
  const [loading, setLoading] = useState(0);
  /**
   * What became of the picture just picked, said under the control that took it (the question's «Добавить картинку» or
   * the option's picture button) and brought into view: «Загружаем картинку…», or why it was not taken, as an error.
   * Live check of 47.4: the refusal of a HEIC stood above «Сохранить», 500–580 px away, in plain text — the author saw
   * nothing happen.
   */
  const [pictureNote, setPictureNote] = useState<{ target: Target; text: string; bad: boolean } | null>(null);
  const pictureNoteRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<Target>('stem');
  const guardRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  /** The option field that takes the focus after the next render (Enter added it). */
  const focusOption = useRef<number | null>(null);

  const facts = useMemo(() => factsReader(item, group), [item, group]);
  // «Ничего не изменилось» answers a change taken back, so it waits for the author's first change: not on a fresh
  // editor, and not right after «Сохранить» where the page keeps the editor open on the question as saved (the studio's
  // panel: the draft then equals the question, and the line read as if the save had been lost — phone audit 47.3).
  // The question as the editor reads it; a page may hand over a new object of the same question on every render.
  const itemStamp = useMemo(() => (item ? JSON.stringify(draftOf(item)) : ''), [item]);
  const [base, setBase] = useState(() => ({ stamp: itemStamp, draft }));
  if (base.stamp !== itemStamp) setBase({ stamp: itemStamp, draft });
  const open = !busy && loading === 0;
  /** «Сохранить» may go now: nothing on its way, no problem, a change to send. */
  const canSave = () => {
    const now = facts(store.get());
    return open && now.problems.length === 0 && !now.unchanged;
  };

  // The page hears of changes not saved (its guard and the browser's «Покинуть сайт?»), and of the draft itself: at
  // every change of the draft (keys typed too), from the store.
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const toldDirty = useRef<boolean | null>(null);
  const tellDirty = useRef(() => {
    const dirty = factsRef.current(store.get()).dirty;
    if (dirty === toldDirty.current) return;
    toldDirty.current = dirty;
    onDirtyRef.current?.(dirty);
  }).current;
  useEffect(
    () =>
      store.subscribe(() => {
        onDraftRef.current?.(store.get());
        tellDirty();
      }),
    [store, tellDirty],
  );
  // The question it was opened on changed (saved): the draft may hold nothing new any more.
  useEffect(() => tellDirty(), [facts, tellDirty]);
  useEffect(
    () => () => {
      toldDirty.current = false;
      onDirtyRef.current?.(false);
    },
    [],
  );

  // Every field as tall as its text: after a change only the field whose text (or face) changed — the one being typed
  // in — and every field when the column's width changes (a phone turned) or the fonts come. The width is the
  // observer's report, never read from the page.
  // A field whose text changed with its face kept (typed in) only grows at once (growTyped); the rest — a new field, a
  // new face, a forced pass — are sized in full. The fields typed in are sized in full after a pause, to get shorter.
  // A key typed sizes the fields from the field's own change (the editor does not render for it); a change the editor
  // draws sizes them after its render.
  const sized = useRef(new WeakMap<HTMLTextAreaElement, string>());
  const typedSince = useRef(new Set<HTMLTextAreaElement>());
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeAll = (force = false) => {
    const form = formRef.current;
    if (!form) return;
    const due: HTMLTextAreaElement[] = [];
    const typed: HTMLTextAreaElement[] = [];
    form.querySelectorAll<HTMLTextAreaElement>(GROWS).forEach((field) => {
      const face = `${field.dataset.code ?? ''}:`;
      const stamp = `${face}${field.value}`;
      const was = sized.current.get(field);
      if (!force && was === stamp) return;
      sized.current.set(field, stamp);
      if (!force && was?.startsWith(face) && field.style.height) typed.push(field);
      else due.push(field);
    });
    growTyped(typed);
    grow(due);
    if (typed.length === 0) return;
    for (const field of typed) typedSince.current.add(field);
    if (shrinkTimer.current !== null) clearTimeout(shrinkTimer.current);
    shrinkTimer.current = setTimeout(() => {
      shrinkTimer.current = null;
      const fields = [...typedSince.current].filter((field) => field.isConnected);
      typedSince.current.clear();
      grow(fields);
    }, SHRINK_AFTER_MS);
  };
  const sizeAllRef = useRef(sizeAll);
  sizeAllRef.current = sizeAll;
  const typedIn = useRef(() => sizeAllRef.current()).current;
  useLayoutEffect(() => sizeAll());
  useEffect(
    () => () => {
      if (shrinkTimer.current !== null) clearTimeout(shrinkTimer.current);
    },
    [],
  );
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // The first report is the width the fields were just sized at.
    let width: number | null = null;
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const next = Math.round(entries[entries.length - 1]?.contentRect.width ?? 0);
            if (width === null || next === width) {
              width = next;
              return;
            }
            width = next;
            sizeAllRef.current(true);
          })
        : null;
    observer?.observe(form);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) sizeAllRef.current(true);
    });
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const at = focusOption.current;
    if (at === null) return;
    focusOption.current = null;
    formRef.current?.querySelector<HTMLTextAreaElement>(`[data-option="${at}"]`)?.focus();
  });

  // The page presses «Сохранить» (EditorHandle): the same checks as the button; what stops it is shown where it is.
  const pressSave = useRef<() => Promise<boolean>>(async () => true);
  pressSave.current = async () => {
    const now = store.get();
    if (!facts(now).dirty) return true;
    if (!canSave()) {
      formRef.current?.querySelector('.qe-notes')?.scrollIntoView?.({ block: 'nearest' });
      return false;
    }
    const result = await onSave(now);
    return result !== false;
  };
  useImperativeHandle(handle, () => ({ save: () => pressSave.current() }), []);

  // The page asks about the changes: the answer's first button takes the focus (it brings the line into view).
  useEffect(() => {
    if (!unsaved) return;
    (guardRef.current && !guardRef.current.disabled ? guardRef.current : discardRef.current)?.focus();
  }, [unsaved]);

  const sourceOf = (path: string): PictureSource => (local[path] ? { picture: local[path] } : { path });
  const picturesOf = (target: Target) => {
    const now = store.get();
    return target === 'stem' ? now.stemPictures : now.options[target]?.pictures ?? [];
  };
  const roomFor = (target: Target) => picturesOf(target).length < (target === 'stem' ? PICTURE_LIMITS.stem : PICTURE_LIMITS.option);

  const setPictures = (target: Target, change: (list: string[]) => string[]) =>
    setDraft((current) =>
      target === 'stem'
        ? { ...current, stemPictures: change(current.stemPictures) }
        : { ...current, options: current.options.map((option, at) => (at === target ? { ...option, pictures: change(option.pictures) } : option)) },
    );

  const addPicture = async (target: Target, file: Blob) => {
    if (!roomFor(target)) return;
    const refuse = (text: string) => setPictureNote({ target, text, bad: true });
    setPictureNote({ target, text: EDITOR.uploading, bad: false });
    setLoading((n) => n + 1);
    try {
      const made = await pictureFromFile(file);
      if (made === 'type') return refuse(EDITOR.pictureType);
      if (made === 'size') return refuse(EDITOR.pictureSize);
      if (made === 'heic') return refuse(EDITOR.pictureHeic);
      const path = picturePath(containerId, made.id, made.picture.type);
      if (!path) return refuse(EDITOR.pictureType);
      if ((await upload(path, made.picture)) !== 'kept') return refuse(EDITOR.pictureFailed);
      setLocal((current) => ({ ...current, [path]: made.picture }));
      setPictures(target, (list) => (list.includes(path) ? list : [...list, path]));
      setPictureNote((current) => (current && current.target === target && !current.bad ? null : current));
    } catch {
      refuse(EDITOR.pictureFailed);
    } finally {
      setLoading((n) => n - 1);
    }
  };

  // The line about a picture is where the author looks: brought into view, clear of the bars at the top and bottom.
  useEffect(() => {
    if (!pictureNote) return;
    let calm = false;
    try {
      calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    } catch {
      calm = false;
    }
    pictureNoteRef.current?.scrollIntoView?.({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }, [pictureNote]);
  const pictureLine = (target: Target) =>
    pictureNote && pictureNote.target === target ? (
      <p
        ref={pictureNoteRef}
        className="kq-note qe-pic-note"
        data-bad={pictureNote.bad ? '' : undefined}
        data-muted={pictureNote.bad ? undefined : ''}
        role={pictureNote.bad ? 'alert' : 'status'}
      >
        {pictureNote.text}
      </p>
    ) : null;

  /** A picture pasted into a field goes to that field's question or option; pasted words stay words. */
  const pasteInto = (target: Target) => (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (target !== 'stem' && trueFalse) return;
    const file = Array.from(event.clipboardData?.files ?? []).find(isPictureFile);
    if (!file) return;
    event.preventDefault();
    void addPicture(target, file);
  };

  const pick = (target: Target) => {
    targetRef.current = target;
    fileRef.current?.click();
  };

  /** Enter in an option: the next option, or a new one after the last (the explanation when no more fit); Shift+Enter breaks the line. */
  const optionKey = (index: number) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const form = formRef.current;
    const count = store.get().options.length;
    if (index < count - 1) {
      form?.querySelector<HTMLTextAreaElement>(`[data-option="${index + 1}"]`)?.focus();
    } else if (!trueFalse && count < LIMITS.optionsMax) {
      focusOption.current = index + 1;
      setDraft(appendOption);
    } else {
      document.getElementById(`${id}-explanation`)?.focus();
    }
  };

  const pictureRow = (target: Target, label: string) => {
    const list = picturesOf(target);
    if (list.length === 0) return null;
    return (
      <ul className="qe-pics" aria-label={label}>
        {list.map((path) => (
          <li key={path} className="qe-pic">
            <ItemPictures sources={[sourceOf(path)]} kind={target === 'stem' ? 'stem' : 'option'} />
            <button type="button" className="qe-pic-off" aria-label={EDITOR.removePicture} disabled={busy} onClick={() => setPictures(target, (paths) => paths.filter((p) => p !== path))}>
              <CrossIcon />
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const several = !trueFalse && Boolean(draft.multiple);

  return (
    <form
      ref={formRef}
      className="kq qe"
      aria-label={EDITOR.label}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave()) return;
        const now = store.get();
        if (onSaveNext && !unsaved) onSaveNext(now);
        else onSave(now);
      }}
      // Ctrl+Enter (⌘+Enter) in any field: the blue pill's step, without tabbing past every option's buttons.
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
        event.preventDefault();
        formRef.current?.requestSubmit();
      }}
    >
      <p className="kq-context">{nb(context)}</p>

      {!item && !trueFalse ? (
        <fieldset className="qe-kind" data-many="">
          <legend className="sr-only">{EDITOR.label}</legend>
          {KIND_CHOICES.map((choice) => (
            <label key={choice} className="qe-kind-option">
              <input
                type="radio"
                name={`${id}-kind`}
                checked={kindChoiceOf(draft) === choice}
                onChange={() =>
                  setDraft((current) =>
                    choice === 'choice' || choice === 'short'
                      ? current.kind
                        ? switchKind(current, choice)
                        : { ...current, short: choice === 'short', correct: choice === 'short' ? [] : current.correct }
                      : switchKind(current, choice),
                  )
                }
              />
              <span>{choice === 'choice' ? EDITOR.kindChoice : choice === 'short' ? EDITOR.kindShort : KIND_NAMES[choice]}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <label className="qe-label" htmlFor={`${id}-stem`}>
        {EDITOR.stem}
      </label>
      <DraftText
        store={store}
        path="stem"
        id={`${id}-stem`}
        className="qe-text qe-stem"
        data-code={draft.code ? '' : undefined}
        rows={2}
        maxLength={LIMITS.stem + 200}
        disabled={busy}
        onTyped={typedIn}
        onPaste={pasteInto('stem')}
      />
      {pictureRow('stem', EDITOR.pictures)}
      <div className="qe-row">
        {roomFor('stem') ? (
          <button type="button" className="sf-link" disabled={busy} onClick={() => pick('stem')}>
            {EDITOR.addPictureFull}
          </button>
        ) : null}
        <label className="qe-check">
          <input type="checkbox" checked={draft.code} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.checked }))} />
          <span>{EDITOR.code}</span>
        </label>
      </div>
      {pictureLine('stem')}

      {draft.kind ? (
        <KindFields id={id} store={store} draft={draft} busy={busy} setDraft={setDraft} />
      ) : draft.short ? (
        <>
          <label className="qe-label" htmlFor={`${id}-forms`}>
            {EDITOR.forms}
          </label>
          <DraftInput store={store} path="forms" id={`${id}-forms`} className="kq-input" disabled={busy} />
        </>
      ) : (
        <>
          <p className="qe-label" id={`${id}-options`}>
            {EDITOR.options}
          </p>
          <ol className="qe-options" aria-labelledby={`${id}-options`}>
            {draft.options.map((_, index) => {
              const l = letter(index);
              const right = draft.correct.includes(index);
              return (
                <li key={index} className="qe-option" data-key={right ? '' : undefined}>
                  <label className="qe-right">
                    <input
                      type={trueFalse ? 'radio' : 'checkbox'}
                      name={trueFalse ? `${id}-key` : undefined}
                      checked={right}
                      disabled={busy}
                      aria-label={EDITOR.right(l)}
                      onChange={() => setDraft((current) => (trueFalse ? tickOnly(current, index) : toggleTick(current, index)))}
                    />
                    <span className="qe-letter" aria-hidden="true">
                      {l}
                    </span>
                  </label>
                  <div className="qe-option-body">
                    <DraftText
                      store={store}
                      path={`option:${index}`}
                      className="qe-text"
                      data-option={index}
                      data-code={draft.code ? '' : undefined}
                      aria-label={EDITOR.option(l)}
                      rows={1}
                      maxLength={LIMITS.option + 100}
                      disabled={busy}
                      enterKeyHint="next"
                      onKeyDown={optionKey(index)}
                      onTyped={typedIn}
                      onPaste={pasteInto(index)}
                    />
                    {pictureRow(index, EDITOR.option(l))}
                    {pictureLine(index)}
                  </div>
                  <span className="qe-option-tools">
                    {!trueFalse && roomFor(index) ? (
                      <button type="button" className="qe-icon" aria-label={EDITOR.optionPicture(l)} title={EDITOR.optionPicture(l)} disabled={busy} onClick={() => pick(index)}>
                        <PictureIcon />
                      </button>
                    ) : null}
                    {!trueFalse && draft.options.length > LIMITS.optionsMin ? (
                      <button
                        type="button"
                        className="qe-icon"
                        aria-label={EDITOR.removeOption(l)}
                        title={EDITOR.removeOption(l)}
                        disabled={busy}
                        onClick={() => setDraft((current) => removeOption(current, index))}
                      >
                        <CrossIcon />
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="qe-kind-line">
            <p aria-live="polite">{nb(EDITOR.ticked(draft.correct, several, !trueFalse && kindForced(draft)))}</p>
            {several && draft.correct.length === 1 ? (
              <button type="button" className="sf-link" data-muted="" disabled={busy} onClick={() => setDraft((current) => ({ ...current, multiple: false }))}>
                {EDITOR.makeSingle}
              </button>
            ) : null}
          </div>
          {several && !trueFalse ? (
            <PartialCheck id={id} kind="multiple" checked={Boolean(draft.partial)} busy={busy} onChange={(on) => setDraft((current) => ({ ...current, partial: on }))} />
          ) : null}
          {trueFalse ? null : (
            <div className="qe-row">
              {draft.options.length < LIMITS.optionsMax ? (
                <button
                  type="button"
                  className="sf-link"
                  disabled={busy}
                  onClick={() => {
                    focusOption.current = store.get().options.length;
                    setDraft(appendOption);
                  }}
                >
                  {EDITOR.addOption}
                </button>
              ) : null}
              <label className="qe-check">
                <input type="checkbox" checked={draft.keepOrder} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, keepOrder: event.target.checked }))} />
                <span>{EDITOR.keepOrder}</span>
              </label>
            </div>
          )}
        </>
      )}

      <p className="qe-hint">{EDITOR.pasteHint}</p>

      <label className="qe-label" htmlFor={`${id}-explanation`}>
        {EDITOR.explanation}
      </label>
      <ExplanationField id={id} store={store} facts={facts} busy={busy} onTyped={typedIn} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void addPicture(targetRef.current, file);
        }}
      />

      <Notes store={store} facts={facts} noKeyNote={noKeyNote} error={error} />

      <Actions
        id={id}
        store={store}
        facts={facts}
        base={base.draft}
        open={open}
        busy={busy}
        item={Boolean(item)}
        saveNext={Boolean(onSaveNext)}
        unsaved={unsaved}
        guardRef={guardRef}
        discardRef={discardRef}
        onSave={() => onSave(store.get())}
        onCancel={onCancel}
        onDiscard={onDiscard}
      />
    </form>
  );
}
