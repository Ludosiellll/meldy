import { useEffect, useState } from 'react';
import { fetchSheet } from '../../../api/cheatSheet';
import { fetchSheetEvents } from '../../../api/learning';
import { buildSheet, erasableNow, sheetHashes, type ErasableNow, type SheetCounts } from '../../../lib/exams/cheatSheet';

/** The exam's cheat sheet as «Сегодня» and the draw «Ждут подтверждения» need it. */
export interface SheetToday {
  /** «Шпаргалка: 39 строк осталось из 47» (spec 4.4). */
  counts: SheetCounts;
  /** «Можно стереть: N вопросов» (Сегодня-lite): the questions whose lines an answer erases now, and when the next ones can be. */
  erasable: ErasableNow;
}

/**
 * Reads the exam's sheet and its journal once and builds it as of now, with the sheet's own rules
 * (lib/exams/cheatSheet.ts): nothing written, no units. Null when the sheet has no line yet. Throws
 * when either cannot be read.
 */
export async function readSheetToday(examId: string, examDate: string | null = null): Promise<SheetToday | null> {
  const sheet = await fetchSheet(examId);
  const hashes = sheetHashes(sheet.questions);
  if (hashes.length === 0) return null;
  const events = await fetchSheetEvents(hashes);
  const now = Date.now();
  const built = buildSheet(sheet.questions, events, now, { examDate });
  if (built.counts.total === 0) return null;
  return { counts: built.counts, erasable: erasableNow(built, now) };
}

/**
 * The exam's cheat sheet for the exam card of «Сегодня»: how many lines are left (spec 4.4) and what an
 * answer can erase now (Сегодня-lite). Null while it is read, when the sheet has no line yet, and when it
 * cannot be read (the card then simply has no such lines).
 */
export function useSheetToday(examId: string | null, examDate: string | null = null): SheetToday | null {
  const [today, setToday] = useState<{ examId: string; today: SheetToday } | null>(null);
  useEffect(() => {
    if (!examId) return undefined;
    let alive = true;
    void (async () => {
      try {
        const read = await readSheetToday(examId, examDate);
        if (alive && read) setToday({ examId, today: read });
      } catch {
        // No lines on the card.
      }
    })();
    return () => {
      alive = false;
    };
  }, [examId, examDate]);
  return today && today.examId === examId ? today.today : null;
}
