import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { pictureFromFile, picturePath, uploadPicture } from '../../../api/itemPictures';
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
  tickOnly,
  toggleTick,
  EXPLANATION_COUNT_FROM,
  LIMITS,
  type Draft,
} from './editorModel';
import './keys.css';

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
 * hears of them (`onDirty`) and asks about them inside the editor (`unsaved`: «Сохранить» / «Не сохранять»).
 */

type Target = 'stem' | number;

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
  onSave: (draft: Draft) => void;
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
}

const GROWS = 'textarea.qe-text';

/** A field as tall as its text (resize none): the height is its scroll height, the page keeps its place. */
function grow(field: HTMLTextAreaElement) {
  const y = typeof window !== 'undefined' ? window.scrollY : 0;
  field.style.height = 'auto';
  const height = field.scrollHeight;
  if (height > 0) field.style.height = `${height}px`;
  else field.style.removeProperty('height');
  if (typeof window !== 'undefined' && window.scrollY !== y) window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
}

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
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => (item ? draftOf(item) : emptyDraft()));
  const [local, setLocal] = useState<Record<string, BankPicture>>({});
  const [loading, setLoading] = useState(0);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<Target>('stem');
  const guardRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  /** The option field that takes the focus after the next render (Enter added it). */
  const focusOption = useRef<number | null>(null);

  const problems = draftProblems(draft);
  const patch = useMemo(() => (item ? patchOf(item, draft) : null), [item, draft]);
  const unchanged = Boolean(item) && patch === null;
  const resets = Boolean(item && patch && group && resetsProgress(item, patch));
  const noKey = !draft.short && draft.correct.length === 0 && draft.options.length >= 2;
  const explained = explanationText(draft).length;
  const canSave = !busy && loading === 0 && problems.length === 0 && !unchanged;
  const dirty = useMemo(() => draftChanged(item, draft), [item, draft]);

  // The page hears of changes not saved (its guard and the browser's «Покинуть сайт?»).
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  // Every field as tall as its text, after each change and when the column's width changes (a phone turned, fonts in).
  const sized = useRef(new WeakMap<HTMLTextAreaElement, string>());
  const sizeAll = (force = false) => {
    const form = formRef.current;
    if (!form) return;
    const width = form.clientWidth;
    form.querySelectorAll<HTMLTextAreaElement>(GROWS).forEach((field) => {
      const stamp = `${width}:${field.dataset.code ?? ''}:${field.value}`;
      if (!force && sized.current.get(field) === stamp) return;
      sized.current.set(field, stamp);
      grow(field);
    });
  };
  const sizeAllRef = useRef(sizeAll);
  sizeAllRef.current = sizeAll;
  useLayoutEffect(() => sizeAll());
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let width = form.clientWidth;
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (form.clientWidth === width) return;
            width = form.clientWidth;
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

  // The page asks about the changes: the answer's first button takes the focus (it brings the line into view).
  useEffect(() => {
    if (!unsaved) return;
    (guardRef.current && !guardRef.current.disabled ? guardRef.current : discardRef.current)?.focus();
  }, [unsaved]);

  const sourceOf = (path: string): PictureSource => (local[path] ? { picture: local[path] } : { path });
  const picturesOf = (target: Target) => (target === 'stem' ? draft.stemPictures : draft.options[target]?.pictures ?? []);
  const roomFor = (target: Target) => picturesOf(target).length < (target === 'stem' ? PICTURE_LIMITS.stem : PICTURE_LIMITS.option);

  const setPictures = (target: Target, change: (list: string[]) => string[]) =>
    setDraft((current) =>
      target === 'stem'
        ? { ...current, stemPictures: change(current.stemPictures) }
        : { ...current, options: current.options.map((option, at) => (at === target ? { ...option, pictures: change(option.pictures) } : option)) },
    );

  const addPicture = async (target: Target, file: Blob) => {
    if (!roomFor(target)) return;
    setPictureNote(null);
    setLoading((n) => n + 1);
    try {
      const made = await pictureFromFile(file);
      if (made === 'type') return setPictureNote(EDITOR.pictureType);
      if (made === 'size') return setPictureNote(EDITOR.pictureSize);
      const path = picturePath(containerId, made.id, made.picture.type);
      if (!path) return setPictureNote(EDITOR.pictureType);
      if ((await upload(path, made.picture)) !== 'kept') return setPictureNote(EDITOR.pictureFailed);
      setLocal((current) => ({ ...current, [path]: made.picture }));
      setPictures(target, (list) => (list.includes(path) ? list : [...list, path]));
    } catch {
      setPictureNote(EDITOR.pictureFailed);
    } finally {
      setLoading((n) => n - 1);
    }
  };

  /** A picture pasted into a field goes to that field's question or option; pasted words stay words. */
  const pasteInto = (target: Target) => (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (target !== 'stem' && trueFalse) return;
    const file = Array.from(event.clipboardData?.files ?? []).find((entry) => entry.type.startsWith('image/'));
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
    if (index < draft.options.length - 1) {
      form?.querySelector<HTMLTextAreaElement>(`[data-option="${index + 1}"]`)?.focus();
    } else if (!trueFalse && draft.options.length < LIMITS.optionsMax) {
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
  const saving = busy ? EDITOR.saving : null;

  return (
    <form
      ref={formRef}
      className="kq qe"
      aria-label={EDITOR.label}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        if (onSaveNext && !unsaved) onSaveNext(draft);
        else onSave(draft);
      }}
      // Ctrl+Enter (⌘+Enter) in any field: the blue pill's step, without tabbing past every option's buttons.
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
        event.preventDefault();
        formRef.current?.requestSubmit();
      }}
    >
      <p className="kq-context">{nb(context)}</p>

      {!item ? (
        <fieldset className="qe-kind">
          <legend className="sr-only">{EDITOR.label}</legend>
          {[false, true].map((short) => (
            <label key={String(short)} className="qe-kind-option">
              <input type="radio" name={`${id}-kind`} checked={draft.short === short} onChange={() => setDraft((current) => ({ ...current, short, correct: short ? [] : current.correct }))} />
              <span>{short ? EDITOR.kindShort : EDITOR.kindChoice}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <label className="qe-label" htmlFor={`${id}-stem`}>
        {EDITOR.stem}
      </label>
      <textarea
        id={`${id}-stem`}
        className="qe-text qe-stem"
        data-code={draft.code ? '' : undefined}
        value={draft.stem}
        rows={2}
        maxLength={LIMITS.stem + 200}
        disabled={busy}
        onChange={(event) => setDraft((current) => ({ ...current, stem: event.target.value }))}
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

      {draft.short ? (
        <>
          <label className="qe-label" htmlFor={`${id}-forms`}>
            {EDITOR.forms}
          </label>
          <input id={`${id}-forms`} className="kq-input" value={draft.forms} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, forms: event.target.value }))} />
        </>
      ) : (
        <>
          <p className="qe-label" id={`${id}-options`}>
            {EDITOR.options}
          </p>
          <ol className="qe-options" aria-labelledby={`${id}-options`}>
            {draft.options.map((option, index) => {
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
                    <textarea
                      className="qe-text"
                      data-option={index}
                      data-code={draft.code ? '' : undefined}
                      aria-label={EDITOR.option(l)}
                      value={option.text}
                      rows={1}
                      maxLength={LIMITS.option + 100}
                      disabled={busy}
                      enterKeyHint="next"
                      onKeyDown={optionKey(index)}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, options: current.options.map((entry, at) => (at === index ? { ...entry, text: event.target.value } : entry)) }))
                      }
                      onPaste={pasteInto(index)}
                    />
                    {pictureRow(index, EDITOR.option(l))}
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
          {trueFalse ? null : (
            <div className="qe-row">
              {draft.options.length < LIMITS.optionsMax ? (
                <button
                  type="button"
                  className="sf-link"
                  disabled={busy}
                  onClick={() => {
                    focusOption.current = draft.options.length;
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
      <textarea
        id={`${id}-explanation`}
        className="qe-text qe-explanation"
        value={draft.explanation}
        rows={2}
        maxLength={LIMITS.explanation + 200}
        disabled={busy}
        aria-describedby={explained >= EXPLANATION_COUNT_FROM ? `${id}-explanation-count` : undefined}
        aria-invalid={explained > LIMITS.explanation ? true : undefined}
        onChange={(event) => setDraft((current) => ({ ...current, explanation: event.target.value }))}
      />
      {explained >= EXPLANATION_COUNT_FROM ? (
        <p id={`${id}-explanation-count`} className="qe-count" data-over={explained > LIMITS.explanation ? '' : undefined}>
          {EDITOR.explanationCount(explained, LIMITS.explanation)}
        </p>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void addPicture(targetRef.current, file);
        }}
      />

      <div className="qe-notes" aria-live="polite">
        {loading > 0 ? <p className="kq-note" data-muted="">{EDITOR.uploading}</p> : null}
        {pictureNote ? (
          <p className="kq-note" role="alert">
            {pictureNote}
          </p>
        ) : null}
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

      {unsaved ? (
        // The page waits for an answer about the changes: save them and go on, or leave them and go on.
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
      ) : (
        <div className="qe-actions">
          <button type="submit" className="sf-primary" disabled={!canSave} aria-busy={busy || undefined}>
            {saving ?? (onSaveNext ? EDITOR.saveNext : item ? EDITOR.save : EDITOR.add)}
          </button>
          {onSaveNext ? (
            <button type="button" className="sf-secondary" disabled={!canSave} onClick={() => onSave(draft)}>
              {EDITOR.save}
            </button>
          ) : null}
          <button type="button" className="sf-link" disabled={busy} onClick={onCancel}>
            {EDITOR.cancel}
          </button>
          {unchanged ? <span className="qe-same">{EDITOR.nothing}</span> : null}
        </div>
      )}
    </form>
  );
}
