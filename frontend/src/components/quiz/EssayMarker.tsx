import { useState } from 'react';
import type { TestItem } from '../../types/container';
import type { AttemptAnswer, EssayMark, EssayVerdict } from '../../types/quiz';
import { essayCheck, essayMark, EssayCheckError } from '../../api/quizzes';
import { EssayMarkLine } from '../kinds/KindBody';
import { KINDS } from '../kinds/copyKinds';
import '../kinds/kinds.css';

/**
 * The author marks a participant's essay (release 48, docs/kinds/CONTRACT.md §3.4): the answer as written, its mark
 * with the lecture's quote, «Проверить по лекциям» when the question has lectures (Meldy's examiner checks it and spends
 * the author's AI limit), and «Полно / Частично / Нет» — the author's word, which always wins. The score changes at once.
 */

const W = {
  check: 'Проверить по лекциям',
  checkAgain: 'Проверить ещё раз',
  checking: 'Проверяем по лекциям…',
  spends: 'Тратит лимит ИИ.',
  byHand: 'Лекции к вопросу не выбраны: оцените сами.',
  yourWord: 'Ваша оценка',
  clear: 'Снять оценку',
  failed: 'Оценка не сохранилась. Повторите.',
};

const VERDICTS: EssayVerdict[] = ['full', 'partial', 'none'];

export default function EssayMarker({
  attemptId,
  item,
  answer,
  onMarked,
}: {
  attemptId: string;
  item: TestItem;
  answer: AttemptAnswer;
  onMarked: (mark: EssayMark | null) => void;
}) {
  const [mark, setMark] = useState<EssayMark | null>(answer.mark ?? null);
  const [busy, setBusy] = useState<'check' | EssayVerdict | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lectures = (item.material_ids ?? []).length;
  const done = (next: EssayMark | null) => {
    setMark(next);
    onMarked(next);
  };
  const check = async () => {
    setBusy('check');
    setError(null);
    try {
      const result = await essayCheck(attemptId, item.id);
      done(result.mark ?? { verdict: result.verdict, quote: result.quote, source: 'ai' });
    } catch (caught) {
      setError(caught instanceof EssayCheckError ? caught.message : W.failed);
    } finally {
      setBusy(null);
    }
  };
  const set = async (verdict: EssayVerdict | null) => {
    setBusy(verdict ?? 'clear');
    setError(null);
    try {
      done(await essayMark(attemptId, item.id, verdict, verdict && mark?.source === 'ai' ? mark.quote : null));
    } catch {
      setError(W.failed);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="qa-essay">
      <blockquote className="qt-ressay">{answer.text}</blockquote>
      <EssayMarkLine mark={mark} pending={!mark} />
      <div className="qa-essay-tools">
        {lectures > 0 ? (
          <button type="button" className="sf-secondary qa-essay-check" disabled={busy !== null} onClick={() => void check()}>
            {busy === 'check' ? W.checking : mark?.source === 'ai' ? W.checkAgain : W.check}
          </button>
        ) : (
          <p className="qa-ans-line" data-muted="">
            {W.byHand}
          </p>
        )}
        {lectures > 0 ? <span className="qa-essay-cost">{W.spends}</span> : null}
      </div>
      <div className="qa-essay-word" role="group" aria-label={W.yourWord}>
        <span className="qa-essay-label">{W.yourWord}</span>
        {VERDICTS.map((verdict) => (
          <button
            key={verdict}
            type="button"
            className="qa-switch-b"
            aria-pressed={mark?.verdict === verdict && mark.source === 'author'}
            disabled={busy !== null}
            onClick={() => void set(verdict)}
          >
            {KINDS.verdicts[verdict]}
          </button>
        ))}
        {mark ? (
          <button type="button" className="sf-link" data-muted="" disabled={busy !== null} onClick={() => void set(null)}>
            {W.clear}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="qa-ans-line" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
