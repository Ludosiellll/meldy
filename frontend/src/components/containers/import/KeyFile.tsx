import { useId, useRef } from 'react';
import { IMPORT, nb } from '../copyImport';
import type { ImportFile } from './importModel';

/**
 * The key kept in another file (owner, 2026-10-14: «что делать если ключи в другом файле а тест в другом?»): the
 * importer reads the key file beside the questions and takes the section of the test's variant («КЛЮЧ ОТВЕТОВ —
 * ВАРИАНТ 4» for «ТЕСТОВЫЙ ВАРИАНТ 4»). When no section fits (the test names another variant, or none and the key
 * file holds several), nothing is taken silently: the student picks one.
 */

export const KEY_FILE_ACCEPT =
  '.docx,.xlsx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown';

/** A link-styled button that opens the file chooser; the chosen file goes to `onFile`. */
export function KeyFileButton({ label, busy, onFile }: { label: string; busy: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="sf-link" disabled={busy} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={KEY_FILE_ACCEPT}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (chosen) onFile(chosen);
        }}
      />
    </>
  );
}

/** «Какой вариант взять?» with one choice per section of the key file, when the importer took none. */
export function KeyFileSections({ file, busy, onSection }: { file: ImportFile; busy: boolean; onSection: (index: number) => void }) {
  const id = useId();
  const keyFile = file.result.key_file;
  if (!keyFile || keyFile.used !== null || keyFile.sections.length === 0) return null;
  const warning = file.result.warnings.find((entry) => entry.code === 'key_file_variant');
  return (
    <div className="im-keyfile-choose" role="group" aria-labelledby={`${id}-q`}>
      {warning ? <p className="im-hint">{warning.message}</p> : null}
      <p id={`${id}-q`} className="im-hint" data-muted="">
        {IMPORT.keyFileChoose}
      </p>
      <p className="im-nokey-acts">
        {keyFile.sections.map((section, index) => (
          <button key={index} type="button" className="im-small" disabled={busy} onClick={() => onSection(index)}>
            {nb(IMPORT.keyFileSection(section.variant, index, section.count))}
          </button>
        ))}
      </p>
    </div>
  );
}

/** The key-file block of «Как в файле отмечен ответ?»: choose a file, see what was taken, change or remove it. */
export default function KeyFile({
  file,
  busy,
  onKeyFile,
  onSection,
}: {
  file: ImportFile;
  busy: boolean;
  onKeyFile: (file: File | null) => void;
  onSection: (index: number) => void;
}) {
  const id = useId();
  const keyFile = file.result.key_file ?? null;
  const used = keyFile && keyFile.used !== null ? keyFile.sections[keyFile.used] : null;
  const keyed = file.result.items.filter((item) => item.evidence === 'key_text').length;
  const total = file.result.items.filter((item) => item.options.length > 0).length;
  return (
    <div className="im-keyfile" role="group" aria-labelledby={`${id}-h`}>
      <p id={`${id}-h`} className="im-label">
        {IMPORT.keyFileLabel}
      </p>
      {file.keyFileName ? (
        <>
          <p className="im-subject-from">{file.keyFileName}</p>
          {used && !busy ? (
            <p className="im-hint" role="status">
              {nb(IMPORT.keyFileUsed(used.title, keyed, total))}
            </p>
          ) : null}
          <KeyFileSections file={file} busy={busy} onSection={onSection} />
          <p className="im-nokey-acts">
            <KeyFileButton label={IMPORT.keyFileOther} busy={busy} onFile={onKeyFile} />
            <button type="button" className="sf-link" data-muted="" disabled={busy} onClick={() => onKeyFile(null)}>
              {IMPORT.keyFileRemove}
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="im-hint" data-muted="">
            {IMPORT.keyFileHint}
          </p>
          <p className="im-nokey-acts">
            <KeyFileButton label={IMPORT.keyFilePick} busy={busy} onFile={onKeyFile} />
          </p>
        </>
      )}
    </div>
  );
}
