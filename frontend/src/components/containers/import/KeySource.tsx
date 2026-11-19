import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import PaperSelect from '../../ui/PaperSelect';
import { IMPORT, KEY_PHRASES, nb, SIGNAL_WORDS } from '../copyImport';
import { signalCounts, type ImportFile, type KeySignal } from './importModel';
import KeyFile from './KeyFile';

/**
 * «Где в файле верные ответы?» for one file (Concept 1 §3.2, «Указать, где в файле ответы»): one sentence of what
 * Meldy found, then the choice — the way Meldy found, another mark of the file (counted from its `format_signals`;
 * switching re-reads nothing — the importer sent every option's marks), «Верный всегда первый вариант», «В файле
 * ответы не отмечены» — and «Готово» right under it (owner 19.11: «не понятно что от тебя требуют, да и снизу не
 * видно кнопок» — the screen was a title, the radios and two more blocks, its buttons under the fold). The key kept
 * apart is one line that opens: a key file (KeyFile.tsx: its section of this test's variant goes with the
 * questions) or the key as a list («1 – б, 2 – а…», spec decision 34, student critique В4: it goes back to the
 * importer as key_text).
 *
 * A subject made of variants (owner, 2026-11-04): the mark and the key file go to every variant (each takes its own
 * section of the key file); the key list goes to the variant chosen above it.
 */

interface Props {
  file: ImportFile;
  signal: KeySignal;
  busy: boolean;
  focusKeyText: boolean;
  onSignal: (signal: KeySignal) => void;
  onKeyText: (text: string) => void;
  onKeyFile: (file: File | null) => void;
  onKeySection: (index: number) => void;
  onClose: () => void;
  /** The files of a subject made of variants (this one among them), and a pick of another one. */
  variants?: ReadonlyArray<{ id: string; label: string }>;
  onVariant?: (fileId: string) => void;
}

export default function KeySource({ file, signal, busy, focusKeyText, onSignal, onKeyText, onKeyFile, onKeySection, onClose, variants, onVariant }: Props) {
  const groupId = useId();
  const keyId = useId();
  const keyRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(file.keyText);
  const [emptyTried, setEmptyTried] = useState(false);
  // The key kept apart: shut until asked for, open when there is one already (or the page came for the list).
  const [apart, setApart] = useState(() => focusKeyText || Boolean(file.keyText.trim()) || Boolean(file.keyFileName));
  useEffect(() => {
    if (focusKeyText) setApart(true);
  }, [focusKeyText]);
  // the list's field takes the focus once its block is open (a field of a shut block cannot)
  useEffect(() => {
    if (focusKeyText && apart) keyRef.current?.focus();
  }, [focusKeyText, apart]);
  useEffect(() => setText(file.keyText), [file.keyText]);

  const result = file.result;
  const found = Object.entries(result.key_source ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const choices: Array<{ value: KeySignal; label: string }> = [
    { value: 'auto', label: IMPORT.keyAuto },
    ...signalCounts(result)
      .filter((entry) => entry.n > 0 || signal === entry.signal)
      .map((entry) => ({ value: entry.signal as KeySignal, label: IMPORT.keySignal(SIGNAL_WORDS[entry.signal], entry.n) })),
    { value: 'first_option', label: IMPORT.keyFirst },
    { value: 'none', label: IMPORT.keyNone },
  ];
  const keyTextItems = result.items.filter((item) => item.evidence === 'key_text').length;
  const choiceItems = result.items.filter((item) => item.options.length > 0).length;
  const keyWarnings = result.warnings.filter((warning) => warning.code === 'key_text_unused');
  const how = found ? KEY_PHRASES[found === 'checkbox' ? 'marker' : found] ?? null : null;

  return (
    <section className="im-keysrc" aria-labelledby={`${groupId}-h`}>
      <button type="button" className="sf-link im-back" onClick={onClose}>
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
        {IMPORT.back}
      </button>
      <h2 id={`${groupId}-h`} className="im-subject-h">
        {IMPORT.keyTitle}
      </h2>
      {variants && variants.length > 1 && onVariant ? (
        <div className="im-keysrc-variant">
          <p className="im-hint" data-muted="">
            {nb(IMPORT.keyVariants(variants.length))}
          </p>
          <span className="im-label">{IMPORT.keyVariantPick}</span>
          <PaperSelect
            ariaLabel={IMPORT.keyVariantPick}
            value={file.id}
            options={variants.map((variant) => ({ value: variant.id, label: variant.label }))}
            onChange={onVariant}
            disabled={busy}
          />
          <p className="im-subject-from">{file.name}</p>
        </div>
      ) : (
        <p className="im-subject-from">{file.name}</p>
      )}
      <p className="im-keysrc-lede">{nb(how ? IMPORT.keyLedeFound(how) : IMPORT.keyLedeNone)}</p>
      <div className="im-radios" role="radiogroup" aria-labelledby={`${groupId}-h`}>
        {choices.map((choice) => (
          <label key={choice.value} className="im-radio">
            <input
              type="radio"
              name={`${groupId}-signal`}
              value={choice.value}
              checked={signal === choice.value}
              disabled={busy}
              onChange={() => onSignal(choice.value)}
            />
            <span>{nb(choice.label)}</span>
          </label>
        ))}
      </div>
      <p className="im-keysrc-done">
        <button type="button" className="im-small" disabled={busy} onClick={onClose}>
          {busy ? IMPORT.rereading : IMPORT.keyClose}
        </button>
      </p>

      <details className="im-apart" open={apart} onToggle={(event) => setApart(event.currentTarget.open)}>
        <summary>{IMPORT.keyApart}</summary>
        <KeyFile file={file} busy={busy} onKeyFile={onKeyFile} onSection={onKeySection} />

        <div className="im-keytext">
          <label className="im-label" htmlFor={keyId}>
            {IMPORT.keyListLabel}
          </label>
          <textarea
            id={keyId}
            ref={keyRef}
            className="im-keytext-field"
            placeholder={IMPORT.keyListPlaceholder}
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              if (event.target.value.trim()) setEmptyTried(false);
            }}
          />
          <p className="im-hint" data-muted="">
            {emptyTried ? IMPORT.keyListEmpty : IMPORT.keyListHint}
          </p>
          {file.keyText.trim() && !busy ? (
            <p className="im-hint" role="status">
              {keyWarnings.length ? keyWarnings.map((warning) => warning.message).join(' ') : IMPORT.keyListResult(keyTextItems, choiceItems)}
            </p>
          ) : null}
          <div className="im-keytext-acts">
            <button
              type="button"
              className="im-small"
              disabled={busy}
              onClick={() => {
                if (!text.trim()) {
                  setEmptyTried(true);
                  keyRef.current?.focus();
                  return;
                }
                onKeyText(text);
              }}
            >
              {busy ? IMPORT.rereading : IMPORT.keyListGo}
            </button>
            <button type="button" className="sf-link" data-muted="" onClick={onClose}>
              {IMPORT.keyBack}
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
