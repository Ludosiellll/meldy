import { useCallback, useMemo, useRef, useState } from 'react';
import type { BankAiOffer, BankItem, BankParseResult } from '../../../types/container';
import { REVIEW } from '../copyImport';
import { keepSourceLines, needsLook, reviewCounts, reviewed, type ReviewCounts, type ReviewOp } from './reviewModel';

/**
 * The review screen's state (BankReview.tsx, or any page that shows a parse with its doubtful places): the parse the
 * fixes apply to, the fixes in order (undo takes the last back), the filter «Только сомнительные» and the model pass.
 *
 * The filter keeps the questions that needed a look when the screen opened (or after the model pass), so a fixed one
 * stays in place, marked as checked, and the list does not jump under the finger.
 */

export type AiStatus = 'idle' | 'running' | 'done' | 'failed';

export interface ShownItem {
  id: string;
  item: BankItem;
  /** A question after / before this one in the whole parse («Соединить со следующим», «Это вариант вопроса выше»). */
  hasNext: boolean;
  hasPrev: boolean;
}

export interface BankReview {
  result: BankParseResult;
  counts: ReviewCounts;
  shown: ShownItem[];
  only: boolean;
  setOnly: (only: boolean) => void;
  ops: readonly ReviewOp[];
  apply: (op: ReviewOp) => void;
  undo: () => void;
  ai: {
    offer: BankAiOffer | null;
    status: AiStatus;
    error: string | null;
    /** Units the last pass spent. */
    spent: number;
    run: (() => Promise<void>) | null;
  };
}

export interface ReviewOptions {
  /** Reads the file again with the model (POST /api/exams/parse-bank/ai); absent — the pass is not offered. */
  runAi?: () => Promise<BankParseResult>;
}

/** The questions the filter keeps: those that need a look and, after the model pass, those in the model's version. */
function lookIds(result: BankParseResult): Set<string> {
  return new Set(result.items.filter((item) => needsLook(item) || item.source === 'ai').map((item) => String(item.position)));
}

/** The words for a failed pass: the server's own line (a 4xx with its detail), else ours. */
export function aiErrorLine(error: unknown): string {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : '';
  const status = (error as { status?: unknown } | null)?.status;
  const message = error instanceof Error ? error.message.trim() : '';
  if (code === 'ai_busy' || status === 429) return message && /[а-яё]/i.test(message) ? message : REVIEW.aiBusy;
  if (typeof status === 'number' && status >= 400 && status < 500 && message && /[а-яё]/i.test(message)) return message;
  return REVIEW.aiFailed;
}

export function useBankReview(initial: BankParseResult, options: ReviewOptions = {}): BankReview {
  const [base, setBase] = useState(initial);
  const [ops, setOps] = useState<ReviewOp[]>([]);
  const [look, setLook] = useState(() => lookIds(initial));
  const [only, setOnly] = useState(() => lookIds(initial).size > 0);
  const [ai, setAi] = useState<{ status: AiStatus; error: string | null; spent: number }>({ status: 'idle', error: null, spent: 0 });
  const running = useRef(false);

  const applied = useMemo(() => reviewed(base, ops), [base, ops]);
  const counts = useMemo(() => reviewCounts(applied.result), [applied]);
  const shown = useMemo(() => {
    const out: ShownItem[] = [];
    applied.result.items.forEach((item, index) => {
      const id = applied.ids[index];
      const root = id.replace(/\+*$/, '');
      if (only && !look.has(root) && !needsLook(item)) return;
      out.push({ id, item, hasNext: index + 1 < applied.result.items.length, hasPrev: index > 0 });
    });
    return out;
  }, [applied, look, only]);

  const apply = useCallback((op: ReviewOp) => setOps((list) => [...list, op]), []);
  const undo = useCallback(() => setOps((list) => list.slice(0, -1)), []);

  const runAi = options.runAi;
  const run = useCallback(async () => {
    if (!runAi || running.current) return;
    running.current = true;
    setAi((state) => ({ ...state, status: 'running', error: null }));
    try {
      const next = keepSourceLines(await runAi(), base);
      setBase(next);
      setOps([]);
      const ids = lookIds(next);
      // after the pass the list shows what still needs a look and what the model read differently
      setLook(ids);
      setOnly(ids.size > 0);
      setAi({ status: 'done', error: null, spent: next.ai?.units ?? 0 });
    } catch (error) {
      setAi((state) => ({ ...state, status: 'failed', error: aiErrorLine(error) }));
    } finally {
      running.current = false;
    }
  }, [runAi, base]);

  const offer = base.ai ? null : base.ai_offer ?? null;
  return {
    result: applied.result,
    counts,
    shown,
    only,
    setOnly,
    ops,
    apply,
    undo,
    ai: { offer, status: ai.status, error: ai.error, spent: ai.spent, run: runAi && offer && offer.questions > 0 ? run : null },
  };
}
