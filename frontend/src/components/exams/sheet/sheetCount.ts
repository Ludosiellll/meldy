import { useEffect, useState } from 'react';
import { fetchSheet } from '../../../api/cheatSheet';
import { fetchSheetEvents } from '../../../api/learning';
import { buildSheet, sheetHashes, type SheetCounts } from '../../../lib/exams/cheatSheet';

/**
 * How many lines of the exam's cheat sheet are left, for the exam card of «Сегодня» (spec 4.4):
 * the sheet and its journal read once, nothing written, no units. Null while it is read, when the
 * sheet has no line yet, and when it cannot be read (the card then simply has no such line).
 */
export function useSheetCount(examId: string | null, examDate: string | null = null): SheetCounts | null {
  const [counts, setCounts] = useState<{ examId: string; counts: SheetCounts } | null>(null);
  useEffect(() => {
    if (!examId) return undefined;
    let alive = true;
    void (async () => {
      try {
        const sheet = await fetchSheet(examId);
        const hashes = sheetHashes(sheet.questions);
        if (hashes.length === 0) return;
        const events = await fetchSheetEvents(hashes);
        if (!alive) return;
        const built = buildSheet(sheet.questions, events, Date.now(), { examDate });
        if (built.counts.total > 0) setCounts({ examId, counts: built.counts });
      } catch {
        // No line on the card.
      }
    })();
    return () => {
      alive = false;
    };
  }, [examId, examDate]);
  return counts && counts.examId === examId ? counts.counts : null;
}
