import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  ANSWER_TEXT_CONSENT_TEXT,
  onAnswerTextConsent,
  readAnswerTextConsent,
  setAnswerTextConsent,
  type AnswerTextConsent as Consent,
} from '../../lib/oral/answerTexts';
import { glue } from './sheetModel';

export const CONSENT_GRANTED_LINE = 'Спасибо! Тексты ответов будут сохраняться. Выключить можно в профиле.';
export const CONSENT_DECLINED_LINE = 'Хорошо, тексты ответов не сохраняются. Передумаете — включите в профиле.';
export const CONSENT_FAILED_LINE = 'Не удалось сохранить выбор. Попробуйте ещё раз.';
/**
 * A phone's ask: the request and the two terms of the full text (lib/oral/answerTexts.ts) — no name with the texts,
 * deleted in «Профиль» — in one sentence. The phone's first short ask had lost the terms (critics' round, 2026-10-08).
 */
export const CONSENT_SHORT_ASK = 'Помогите проверить точность Meldy: разрешите сохранять текст ответов — без имени, удалить можно в профиле.';

/**
 * The one question about keeping answer texts (plan 2026-10-07, «Текст ответа с согласия») on the exam
 * page: shown until the student answers it once, «Разрешить» or «Нет, спасибо»; «Профиль» changes the answer
 * later. Nothing is shown while the consent is read, when it cannot be read (the table not there yet, no
 * network) or once it is answered. `ready` — the page has laid out what is above (the sheet's paper), so the
 * question at the bottom never pushes anything. `short` — a phone: one quiet sentence with its terms and the two
 * choices (10_Project/Phone_Declutter_2026-10-08).
 */
export default function AnswerTextConsent({ ready = true, short = false }: { ready?: boolean; short?: boolean }) {
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
      <p className="ex-note ex-consent" data-quiet="" role="status">
        {glue(chosen === 'granted' ? CONSENT_GRANTED_LINE : CONSENT_DECLINED_LINE)}
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

  if (short) {
    return (
      <section className="ex-consent" data-short="" aria-label="Тексты ответов для проверки точности">
        <p>
          {glue(CONSENT_SHORT_ASK)}{' '}
          {/* The two choices apart, without a «·» between them. */}
          <span className="ex-consent-acts">
            <button type="button" className="sf-link" disabled={busy} onClick={() => void choose(true)}>
              Разрешить
            </button>{' '}
            <button type="button" className="sf-link" data-muted="" disabled={busy} onClick={() => void choose(false)}>
              Нет, спасибо
            </button>
          </span>
        </p>
        {failed && <p role="alert">{CONSENT_FAILED_LINE}</p>}
      </section>
    );
  }

  return (
    <section className="ex-note ex-consent" aria-label="Тексты ответов для проверки точности">
      {/* glue: «Имя к» never ends a line, «в профиле» stays together (a 1440 page broke after «к»). */}
      <span>{glue(ANSWER_TEXT_CONSENT_TEXT)}</span>
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
