import { useId, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { pictureFromFile, picturePath, uploadPicture } from '../../../api/itemPictures';
import { PICTURE_LIMITS, type BankPicture, type TestItem } from '../../../types/container';
import { EDITOR, letter, nb } from '../copyImport';
import ItemPictures, { type PictureSource } from '../ItemPictures';
import { draftOf, draftProblems, emptyDraft, explanationText, patchOf, removeOption, resetsProgress, EXPLANATION_COUNT_FROM, LIMITS, type Draft } from './editorModel';
import './keys.css';

/**
 * The author's editor of one question in «Вопросы и ключи» (spec 2026-10-16 part 1): the text (code shown as typed
 * when ticked), the pictures of the question and of each option (a file or Ctrl+V into the field; uploaded at once into
 * the exam's folder of the bucket, named by their sha256), the options with «верный» ticks (two or more make a
 * question with several answers), or the accepted forms of a short answer, and an optional explanation shown after an
 * answer (release 47; a counter near its limit). It says before saving when the change restarts the question for the
 * group (decision 15; an explanation never does) and when the question would have no key. The page saves: an
 * existing question through container_item_update, a new one through container_items_add (editorModel.ts).
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
}

export default function QuestionEditor({ containerId, item, context, group, busy = false, error = null, onSave, onCancel, upload = uploadPicture }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => (item ? draftOf(item) : emptyDraft()));
  const [local, setLocal] = useState<Record<string, BankPicture>>({});
  const [loading, setLoading] = useState(0);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<Target>('stem');

  const problems = draftProblems(draft);
  const patch = useMemo(() => (item ? patchOf(item, draft) : null), [item, draft]);
  const unchanged = Boolean(item) && patch === null;
  const resets = Boolean(item && patch && group && resetsProgress(item, patch));
  const noKey = !draft.short && draft.correct.length === 0 && draft.options.length >= 2;
  const explained = explanationText(draft).length;
  const canSave = !busy && loading === 0 && problems.length === 0 && !unchanged;

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
    const file = Array.from(event.clipboardData?.files ?? []).find((entry) => entry.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void addPicture(target, file);
  };

  const pick = (target: Target) => {
    targetRef.current = target;
    fileRef.current?.click();
  };

  const tick = (index: number) =>
    setDraft((current) => ({
      ...current,
      correct: current.correct.includes(index) ? current.correct.filter((at) => at !== index) : [...current.correct, index].sort((a, b) => a - b),
    }));

  const pictureRow = (target: Target, label: string) => {
    const list = picturesOf(target);
    if (list.length === 0) return null;
    return (
      <ul className="qe-pics" aria-label={label}>
        {list.map((path) => (
          <li key={path} className="qe-pic">
            <ItemPictures sources={[sourceOf(path)]} kind={target === 'stem' ? 'stem' : 'option'} />
            <button type="button" className="qe-pic-off" aria-label={EDITOR.removePicture} disabled={busy} onClick={() => setPictures(target, (paths) => paths.filter((p) => p !== path))}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <form
      className="kq qe"
      aria-label={EDITOR.label}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave(draft);
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
        rows={Math.min(12, Math.max(3, draft.stem.split('\n').length + 1))}
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
                    <input type="checkbox" checked={right} disabled={busy} aria-label={EDITOR.right(l)} onChange={() => tick(index)} />
                    <span className="qe-letter" aria-hidden="true">
                      {l}
                    </span>
                  </label>
                  <div className="qe-option-body">
                    <textarea
                      className="qe-text"
                      data-code={draft.code ? '' : undefined}
                      aria-label={EDITOR.option(l)}
                      value={option.text}
                      rows={Math.min(6, Math.max(1, option.text.split('\n').length, Math.ceil(option.text.length / 70)))}
                      maxLength={LIMITS.option + 100}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, options: current.options.map((entry, at) => (at === index ? { ...entry, text: event.target.value } : entry)) }))
                      }
                      onPaste={pasteInto(index)}
                    />
                    {pictureRow(index, EDITOR.option(l))}
                    <p className="qe-option-tools">
                      {right ? <span className="qe-right-word">{EDITOR.rightWord}</span> : null}
                      {roomFor(index) ? (
                        <button type="button" className="sf-link" data-muted="" disabled={busy} onClick={() => pick(index)}>
                          {EDITOR.addPicture}
                        </button>
                      ) : null}
                      {draft.options.length > LIMITS.optionsMin ? (
                        <button type="button" className="sf-link" data-muted="" aria-label={EDITOR.removeOption(l)} disabled={busy} onClick={() => setDraft((current) => removeOption(current, index))}>
                          {EDITOR.removeWord}
                        </button>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="qe-row">
            {draft.options.length < LIMITS.optionsMax ? (
              <button type="button" className="sf-link" disabled={busy} onClick={() => setDraft((current) => ({ ...current, options: [...current.options, { text: '', pictures: [] }] }))}>
                {EDITOR.addOption}
              </button>
            ) : null}
            <label className="qe-check">
              <input type="checkbox" checked={draft.keepOrder} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, keepOrder: event.target.checked }))} />
              <span>{EDITOR.keepOrder}</span>
            </label>
          </div>
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
        rows={Math.min(8, Math.max(2, draft.explanation.split('\n').length, Math.ceil(draft.explanation.length / 70)))}
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
        {problems.length === 0 && noKey ? <p className="kq-note qe-warn">{EDITOR.noKey}</p> : null}
        {resets ? <p className="kq-note qe-warn">{EDITOR.resets}</p> : null}
        {error ? (
          <p className="kq-note" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="qe-actions">
        <button type="submit" className="sf-primary" disabled={!canSave} aria-busy={busy || undefined}>
          {busy ? EDITOR.saving : item ? EDITOR.save : EDITOR.add}
        </button>
        <button type="button" className="sf-link" disabled={busy} onClick={onCancel}>
          {EDITOR.cancel}
        </button>
        {unchanged ? <span className="qe-same">{EDITOR.nothing}</span> : null}
      </div>
    </form>
  );
}
