import { useCallback, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { PASTE_REFUSED, pasteAllowed, wordCount } from '../../lib/oral/pasteGuard';

export interface PasteGuard {
  /** PASTE_REFUSED after a refused paste or drop, until the student types again; else null. */
  notice: string | null;
  /** Refused pastes and drops so far: each one brings the line under the field into view again. */
  refusals: number;
  /** The id of the line under the field that says it (the field's aria-describedby while it is shown). */
  noticeId: string;
  /** Call on every change the student makes: the line goes away once they type. */
  clear: () => void;
  /** Spread on the answer's <textarea>. */
  fieldProps: {
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
    onDrop: (event: DragEvent<HTMLTextAreaElement>) => void;
    onDragStart: () => void;
    onDragEnd: () => void;
    'aria-describedby'?: string;
  };
}

function textOf(data: DataTransfer | null | undefined): string {
  if (!data) return '';
  return data.getData('text/plain') || data.getData('text') || '';
}

/**
 * «Чистый ответ» on an answer field (lib/oral/pasteGuard.ts): a paste or a drop of more than 8 words is
 * refused and the line under the field says why; shorter ones go in as usual. Text dragged from the
 * field itself (moving one's own words) is not a paste. `onRefused` gets the refused text's word count.
 */
export function usePasteGuard(onRefused?: (words: number) => void): PasteGuard {
  const [refused, setRefused] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const ownDrag = useRef(false);
  const noticeId = useId();

  const judge = useCallback(
    (text: string, event: { preventDefault: () => void }) => {
      if (pasteAllowed(text)) {
        setRefused(false);
        return;
      }
      event.preventDefault();
      setRefused(true);
      setRefusals((count) => count + 1);
      onRefused?.(wordCount(text));
    },
    [onRefused],
  );

  const clear = useCallback(() => setRefused(false), []);

  const fieldProps = useMemo(
    () => ({
      onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => judge(textOf(event.clipboardData), event),
      onDrop: (event: DragEvent<HTMLTextAreaElement>) => {
        if (ownDrag.current) {
          ownDrag.current = false;
          return;
        }
        judge(textOf(event.dataTransfer), event);
      },
      onDragStart: () => {
        ownDrag.current = true;
      },
      onDragEnd: () => {
        ownDrag.current = false;
      },
      ...(refused ? { 'aria-describedby': noticeId } : {}),
    }),
    [judge, refused, noticeId],
  );

  return { notice: refused ? PASTE_REFUSED : null, refusals, noticeId, clear, fieldProps };
}
