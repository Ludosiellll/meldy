import type { PasteGuard } from './usePasteGuard';

/**
 * The line under an answer field that says why a paste was refused («Чистый ответ», Н7): a status line,
 * shown like the room's other notices only while there is something to say, and the field's description
 * while it is there.
 */
export default function PasteNotice({ guard }: { guard: Pick<PasteGuard, 'notice' | 'noticeId'> }) {
  if (!guard.notice) return null;
  return (
    <p id={guard.noticeId} className="or-paste-note" role="status">
      {guard.notice}
    </p>
  );
}
