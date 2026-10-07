import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  ANSWER_TEXT_CONSENT_TEXT,
  onAnswerTextConsent,
  readAnswerTextConsent,
  setAnswerTextConsent,
  type AnswerTextConsent as Consent,
} from '../../lib/oral/answerTexts';

export const CONSENT_GRANTED_LINE = 'Спасибо! Тексты ответов будут сохраняться. Выключить можно в профиле.';
export const CONSENT_DECLINED_LINE = 'Хорошо, тексты ответов не сохраняются. Передумаете — включите в профиле.';
export const CONSENT_FAILED_LINE = 'Не удалось сохранить выбор. Попробуйте ещё раз.';

/**
 * The one question about keeping answer texts (plan 2026-10-07, «Текст ответа с согласия») on the exam
 * page: shown until the student answers it once, «Разрешить» or «Нет, спасибо»; «Профиль» changes the answer
 * later. Nothing is shown while the consent is read, when it cannot be read (the table not there yet, no
 * network) or once it is answered. `ready` — the page has laid out what is above (the sheet's paper), so the
 * question at the bottom never pushes anything.
 */
export default function AnswerTextConsent({ ready = true }: { ready?: boolean }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [consent, setConsent] = useState<Consent | null>(null);
  const [chosen, setChosen] = useState<'granted' | 'declined' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    readAnswerTextConsent(userId).then(
      (value) => {
        if (alive) setConsent(value);
      },
      () => {
        if (alive) setConsent(null);
      },
    );
    const stop = onAnswerTextConsent((who, value) => {
      if (alive && who === userId) setConsent(value);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [userId]);

  if (!userId || !ready) return null;
  if (chosen) {
    return (
      <p className="ex-note" data-quiet="" role="status">
        {chosen === 'granted' ? CONSENT_GRANTED_LINE : CONSENT_DECLINED_LINE}
      </p>
    );
  }
  if (consent !== 'unknown') return null;

  const choose = async (granted: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await setAnswerTextConsent(userId, granted);
      setChosen(granted ? 'granted' : 'declined');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ex-note" aria-label="Тексты ответов для проверки точности">
      <span>{ANSWER_TEXT_CONSENT_TEXT}</span>
      <button type="button" className="sf-link" disabled={busy} onClick={() => void choose(true)}>
        Разрешить
      </button>
      <button type="button" className="sf-link" data-muted="" disabled={busy} onClick={() => void choose(false)}>
        Нет, спасибо
      </button>
      {failed && <span role="alert">{CONSENT_FAILED_LINE}</span>}
    </section>
  );
}
