import { useState } from 'react';
import type { TestItem } from '../../types/container';
import { containerErrorText, doubtKey, updateItem } from '../../api/containers';
import { Sheet } from './ui';
import * as copy from './copy';
import { shortNorm } from './model';
import './room.css';

/**
 * The room's top line (decision 41): on a phone only «7 из 20» (in the try «12 из 40 · 31:20») and the muted way out;
 * a computer adds the wordmark and the subject: «Meldy  Базы данных · 7 из 20».
 */
export function RoomBar({ long, short, exitLabel, onExit }: { long: string; short: string; exitLabel: string; onExit: () => void }) {
  return (
    <header className="sf-room-bar ct-roombar">
      <div className="ct-rb-left">
        <span className="ct-rb-mark" aria-hidden="true">
          Meldy
        </span>
        <span className="ct-rb-where">
          <span className="ct-rb-long">{long}</span>
          <span className="ct-rb-short">{short}</span>
        </span>
      </div>
      <button type="button" className="sf-link ct-rb-exit" data-muted="" onClick={onExit}>
        {exitLabel}
      </button>
    </header>
  );
}

/**
 * «Ключ неверный?» in place (the author; decision 14): the options in the file's order with the file's letters; a tap
 * on the right one changes the key (container_item_update, a new rev: everyone's count of this question starts again).
 * Several correct: tick and save. A short answer: the forms accepted now, and the student's own one to add.
 */
export function KeyFix({
  item,
  typed,
  group,
  onFixed,
  onCancel,
}: {
  item: TestItem;
  /** The short answer the student typed, to add to the key. */
  typed: string | null;
  group: boolean;
  onFixed: (patch: Pick<TestItem, 'correct' | 'answers' | 'rev'>) => void;
  onCancel: () => void;
}) {
  const [ticked, setTicked] = useState<number[]>(item.correct);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const no = item.file_no || String(item.position);

  const save = async (patch: { correct?: number[]; answers?: string[] }) => {
    if (busy) return;
    const same =
      (patch.correct && [...patch.correct].sort().join(',') === [...item.correct].sort().join(',')) ||
      (patch.answers && patch.answers.length === item.answers.length);
    if (same) {
      setDone(copy.KEY_SAME);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await updateItem(item.id, patch);
      setDone(copy.keyChanged(group));
      onFixed({ correct: patch.correct ?? item.correct, answers: patch.answers ?? item.answers, rev: result.rev });
    } catch (failure) {
      setError(containerErrorText(failure) || copy.SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (item.kind === 'short') {
    const accepted = item.answers.map(shortNorm);
    const own = typed && shortNorm(typed) !== '' && !accepted.includes(shortNorm(typed)) ? typed.trim() : null;
    body = (
      <>
        <p>{copy.keyFixPromptShort(no)}</p>
        <ul className="ct-answers-list">
          {item.answers.map((answer) => (
            <li key={answer}>{answer}</li>
          ))}
        </ul>
        {own && !done ? (
          <div className="ct-panel-acts">
            <button type="button" className="sf-primary" aria-busy={busy || undefined} onClick={() => void save({ answers: [...item.answers, own].slice(0, 10) })}>
              {copy.ADD_YOUR_ANSWER}
            </button>
          </div>
        ) : null}
      </>
    );
  } else {
    const multiple = item.kind === 'multiple';
    body = (
      <>
        <p>{multiple ? copy.keyFixPromptMultiple(no) : copy.keyFixPrompt(no)}</p>
        <div className="ct-opts" role="group" aria-label="Варианты в порядке файла">
          {item.options.map((option, index) => {
            const on = ticked.includes(index);
            return (
              <button
                key={index}
                type="button"
                className="ct-opt"
                aria-pressed={on}
                data-state={!multiple && item.correct.includes(index) ? 'file' : undefined}
                disabled={busy || Boolean(done)}
                onClick={() => {
                  if (multiple) setTicked((list) => (on ? list.filter((value) => value !== index) : [...list, index]));
                  else void save({ correct: [index] });
                }}
              >
                <span className="ct-opt-l">{copy.OPTION_LETTERS[index] ?? String(index + 1)}</span>
                <span className="ct-opt-t">
                  {option}
                  {!multiple && item.correct.includes(index) ? <span className="ct-opt-tag">{copy.keyTag(item.key_source)}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
        {multiple && !done ? (
          <div className="ct-panel-acts">
            <button
              type="button"
              className="sf-primary"
              aria-busy={busy || undefined}
              disabled={ticked.length === 0}
              onClick={() => void save({ correct: [...ticked].sort((a, b) => a - b) })}
            >
              {copy.SAVE_KEY}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section className="ct-panel" aria-label={copy.KEY_WRONG}>
      {body}
      {done ? (
        <p className="ct-panel-done" role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="ct-sheet-error" role="alert">
          {error}
        </p>
      ) : null}
      {!done ? (
        <div className="ct-panel-acts">
          <button type="button" className="sf-link" data-muted="" onClick={onCancel}>
            {copy.CANCEL}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * «Сомневаюсь в ключе» (everyone; decisions 14, 37): an optional comment, then the question is set aside for this
 * student — it leaves their plan until the author decides (a member) or until they decide in «Ключи» (the author).
 */
export function DoubtSheet({
  item,
  proposed,
  author,
  onDone,
  onClose,
}: {
  item: TestItem;
  proposed: number[] | null;
  author: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const no = item.file_no || String(item.position);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await doubtKey(item.id, proposed && proposed.length > 0 ? proposed : undefined, note.trim() || undefined);
      setDone(true);
      onDone();
    } catch (failure) {
      setError(containerErrorText(failure) || copy.SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={copy.doubtTitle(no)}
      onClose={onClose}
      bare
      actions={
        done ? (
          <button type="button" className="sf-primary" onClick={onClose}>
            {copy.NEXT}
          </button>
        ) : (
          <>
            <button type="button" className="sf-primary" aria-busy={busy || undefined} onClick={() => void send()}>
              {copy.DOUBT_SEND}
            </button>
            <button type="button" className="sf-link" data-muted="" onClick={onClose}>
              {copy.CANCEL}
            </button>
          </>
        )
      }
    >
      {done ? (
        <p className="ct-sheet-status" role="status">
          {author ? copy.DOUBT_DONE_OWN : copy.DOUBT_DONE_MEMBER}
        </p>
      ) : (
        <>
          <p data-muted="">{author ? copy.DOUBT_OWN_TEXT : copy.DOUBT_MEMBER_TEXT}</p>
          {author ? null : (
            <label className="ct-field">
              {copy.DOUBT_NOTE_LABEL}
              <textarea value={note} maxLength={300} placeholder={copy.DOUBT_PLACEHOLDER} onChange={(event) => setNote(event.target.value)} />
            </label>
          )}
        </>
      )}
      {error ? (
        <p className="ct-sheet-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
