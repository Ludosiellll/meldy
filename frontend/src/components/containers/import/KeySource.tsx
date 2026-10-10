import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IMPORT, KEY_WORDS, nb, SIGNAL_WORDS } from '../copyImport';
import { signalCounts, type ImportFile, type KeySignal } from './importModel';

/**
 * «Как в файле отмечен ответ?» for one file (Concept 1 §3.2, «Отмечен по-другому?»): the way Meldy found, another
 * mark of the file (counted from its `format_signals`; switching re-reads nothing — the importer sent every option's
 * marks), «Первый вариант всегда верный», «Ответы в файле не отмечены». Below, «Ключ отдельным списком» (spec
 * decision 34, student critique В4): the key sent apart («1 – б, 2 – а…») goes back to the importer as key_text.
 */

interface Props {
  file: ImportFile;
  signal: KeySignal;
  busy: boolean;
  focusKeyText: boolean;
  onSignal: (signal: KeySignal) => void;
  onKeyText: (text: string) => void;
  onClose: () => void;
}

export default function KeySource({ file, signal, busy, focusKeyText, onSignal, onKeyText, onClose }: Props) {
  const groupId = useId();
  const keyId = useId();
  const keyRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(file.keyText);
  const [emptyTried, setEmptyTried] = useState(false);
  useEffect(() => {
    if (focusKeyText) keyRef.current?.focus();
  }, [focusKeyText]);
  useEffect(() => setText(file.keyText), [file.keyText]);

  const result = file.result;
  const found = Object.entries(result.key_source ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const choices: Array<{ value: KeySignal; label: string }> = [
    { value: 'auto', label: found ? `${IMPORT.keyAuto}: ${KEY_WORDS[found === 'checkbox' ? 'marker' : found] ?? KEY_WORDS.none}` : IMPORT.keyAuto },
    ...signalCounts(result)
      .filter((entry) => entry.n > 0 || signal === entry.signal)
      .map((entry) => ({ value: entry.signal as KeySignal, label: `${SIGNAL_WORDS[entry.signal]} — ${entry.n}` })),
    { value: 'first_option', label: IMPORT.keyFirst },
    { value: 'none', label: IMPORT.keyNone },
  ];
  const keyTextItems = result.items.filter((item) => item.evidence === 'key_text').length;
  const choiceItems = result.items.filter((item) => item.options.length > 0).length;
  const keyWarnings = result.warnings.filter((warning) => warning.code === 'key_text_unused');

  return (
    <section className="im-keysrc" aria-labelledby={`${groupId}-h`}>
      <button type="button" className="sf-link im-back" onClick={onClose}>
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
        {IMPORT.back}
      </button>
      <h2 id={`${groupId}-h`} className="im-subject-h">
        {IMPORT.keyTitle}
      </h2>
      <p className="im-subject-from">{file.name}</p>
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
            {IMPORT.keyClose}
          </button>
        </div>
      </div>
    </section>
  );
}
