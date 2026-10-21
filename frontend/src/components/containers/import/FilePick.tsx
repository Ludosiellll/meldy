import { useId, useRef, useState, type DragEvent } from 'react';
import { useSessionDraft } from '../../../lib/urlState';
import { IMPORT, nb } from '../copyImport';
import { ACCEPT } from './readFiles';

/**
 * Step 1 of the import page (Concept 1 §3.2, the design table): «Выбрать файлы» (several at once), «Вставить список
 * текстом», the formats; a file can be dropped on the card. On a computer a quiet side column says what Meldy does
 * with a file. A phone gets one line about files from Telegram, by its system (spec decision 34).
 */

export type Platform = 'android' | 'iphone' | 'other';

export function platformOf(userAgent: string, touchPoints = 0): Platform {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && touchPoints > 1)) return 'iphone';
  return 'other';
}

export function telegramHint(platform: Platform): string | null {
  if (platform === 'android') return IMPORT.tgAndroid;
  if (platform === 'iphone') return IMPORT.tgIphone;
  return null;
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** «Вставить список текстом» as it is: the field open, what is in it. */
interface Paste {
  open: boolean;
  text: string;
}
const NO_PASTE: Paste = { open: false, text: '' };

function isPaste(value: unknown): value is Paste {
  const paste = value as Paste | null;
  return Boolean(paste && typeof paste === 'object' && typeof paste.open === 'boolean' && typeof paste.text === 'string');
}

interface Props {
  phone: boolean;
  side: boolean;
  platform: Platform;
  onFiles: (files: File[]) => void;
  onText: (text: string) => void;
  /** «Обновить из файла»: its own heading and line instead of the new exam's. */
  title?: string;
  lede?: string;
  /** The list being pasted is kept in this tab under this key until «Разобрать» (lib/urlState.ts drafts). */
  draftKey?: string;
}

export default function FilePick({ phone, side, platform, onFiles, onText, title = IMPORT.dropTitle, lede, draftKey }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [paste, setPaste, forgetPaste] = useSessionDraft(draftKey ?? null, NO_PASTE, isPaste);
  const { open: pasting, text } = paste;
  const setPasting = (open: boolean) => setPaste((current) => ({ ...current, open }));
  const setText = (next: string) => setPaste((current) => ({ ...current, text: next }));
  const [emptyTried, setEmptyTried] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pasteId = useId();
  const hint = telegramHint(platform);

  const drop = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      setDragging(false);
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    },
  };

  return (
    <section className="im-pick" data-drag={dragging ? '' : undefined} aria-label={title} {...drop}>
      <div className="im-pick-main">
        {!phone ? <h2 className="im-pick-h">{title}</h2> : null}
        <p className="im-pick-sub">{nb(lede ?? (phone ? IMPORT.lede : IMPORT.dropLede))}</p>
        {pasting ? (
          <div className="im-paste">
            <label className="im-label" htmlFor={pasteId}>
              {IMPORT.pasteLabel}
            </label>
            <textarea
              id={pasteId}
              ref={pasteRef}
              className="im-paste-field"
              placeholder={IMPORT.pastePlaceholder}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                if (event.target.value.trim()) setEmptyTried(false);
              }}
            />
            {emptyTried ? (
              <p className="im-hint" role="status">
                {IMPORT.pasteEmpty}
              </p>
            ) : null}
            <div className="im-pick-acts">
              <button
                type="button"
                className="sf-primary"
                onClick={() => {
                  if (!text.trim()) {
                    setEmptyTried(true);
                    pasteRef.current?.focus();
                    return;
                  }
                  onText(text);
                  forgetPaste();
                }}
              >
                {IMPORT.pasteGo}
              </button>
              <button type="button" className="sf-link" data-muted="" onClick={() => setPasting(false)}>
                {IMPORT.pasteCancel}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="im-pick-acts">
              <button type="button" className="sf-primary" onClick={() => inputRef.current?.click()}>
                {IMPORT.pick}
              </button>
              <button
                type="button"
                className="sf-link"
                onClick={() => {
                  setPasting(true);
                  window.setTimeout(() => pasteRef.current?.focus(), 0);
                }}
              >
                {IMPORT.pasteLink}
              </button>
            </div>
            <p className="im-pick-fmt">{nb(IMPORT.formats)}</p>
            {hint ? <p className="im-pick-tg">{hint}</p> : null}
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          aria-label={IMPORT.pick}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) onFiles(files);
          }}
        />
      </div>
      {side ? (
        <aside className="im-pick-side" aria-label={IMPORT.sideTitle}>
          <h3 className="im-pick-side-h">{IMPORT.sideTitle}</h3>
          {IMPORT.side.map((line) => (
            <p key={line} className="im-pick-side-p">
              {nb(line)}
            </p>
          ))}
        </aside>
      ) : null}
      {dragging ? (
        <p className="im-drop" aria-hidden="true">
          {IMPORT.dropping}
        </p>
      ) : null}
    </section>
  );
}

/** «Добавить ещё файл» on the reading list and the preview: the same picker, a quiet link. */
export function AddFileLink({ onFiles, label = IMPORT.addFile }: { onFiles: (files: File[]) => void; label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="sf-link" onClick={() => inputRef.current?.click()}>
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        aria-label={label}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}
