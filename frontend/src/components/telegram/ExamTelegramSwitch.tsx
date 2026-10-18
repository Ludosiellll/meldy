import { useEffect, useId, useState } from 'react';
import { containerErrorText, setExamRemind, telegramExams } from '../../api/containers';
import { fetchTelegramState } from '../../api/telegram';
import type { Uuid } from '../../types/container';

/**
 * «План в Telegram по этому экзамену» in the exam's «Настройки» (release 47; owner, 2026-10-18: «тяжело понять как
 * выключить их от определенного экзамена»): a switch, for the author and for a member, shown only when Telegram is linked
 * (telegram_link_state) and the server keeps the switch per exam (telegram_exams). It saves at once (exam_remind_set);
 * the profile's «Экзамены в плане» lists the same switches for every exam.
 */
export const EXAM_TELEGRAM_COPY = {
  label: 'План в Telegram по этому экзамену',
  on: 'Включено',
  off: 'Выключено',
  offNote: 'Бот не присылает план по этому экзамену. Другие экзамены — в профиле.',
} as const;

export default function ExamTelegramSwitch({ containerId }: { containerId: Uuid }) {
  const labelId = useId();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setOn(null);
    void (async () => {
      try {
        const link = await fetchTelegramState();
        if (!alive || !link?.linked) return;
        const exams = await telegramExams();
        const exam = exams?.find((entry) => entry.container_id === containerId);
        if (alive && exam) setOn(exam.tg_remind);
      } catch {
        // Unread: the switch is not shown (the profile has the same switch).
      }
    })();
    return () => {
      alive = false;
    };
  }, [containerId]);

  if (on === null) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await setExamRemind(containerId, !on);
      setOn(saved.tg_remind);
    } catch (failure) {
      setError(containerErrorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="im-field st-tg" id="settings-telegram">
      <div className="st-tg-row">
        <span className="im-label st-tg-label" id={labelId}>
          {EXAM_TELEGRAM_COPY.label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          // Saving, it keeps the focus (aria-disabled): a disabled button would drop it to the page.
          aria-disabled={busy || undefined}
          className="ac-switch"
          onClick={() => void toggle()}
        >
          <span className="ac-switch-box" aria-hidden="true" />
          <span>{on ? EXAM_TELEGRAM_COPY.on : EXAM_TELEGRAM_COPY.off}</span>
        </button>
      </div>
      {!on ? (
        <p className="im-hint" data-muted="">
          {EXAM_TELEGRAM_COPY.offNote}
        </p>
      ) : null}
      {error ? (
        <p className="im-hint" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
