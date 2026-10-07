import { useEffect, useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { useConfirm } from '../../contexts/ConfirmContext';
import {
  ANSWER_TEXT_CONSENT_TEXT,
  countAnswerTexts,
  deleteAnswerTexts,
  onAnswerTextConsent,
  readAnswerTextConsent,
  setAnswerTextConsent,
  type AnswerTextConsent,
} from '../../lib/oral/answerTexts';

export const TEXTS_ON_TOAST = 'Тексты ответов будут сохраняться.';
export const TEXTS_OFF_TOAST = 'Тексты новых ответов не сохраняются.';
export const TEXTS_DELETED_TOAST = 'Сохранённые тексты ответов удалены.';
export const CHOICE_FAILED_TOAST = 'Не удалось сохранить выбор. Попробуйте ещё раз.';
export const DELETE_FAILED_TOAST = 'Не удалось удалить тексты. Попробуйте ещё раз.';

/**
 * «Профиль»: whether the texts of answers are kept for the accuracy check (plan 2026-10-07), and deleting
 * the kept ones. Never answered reads as off. Hidden when the consent cannot be read (the table not
 * there yet): there is nothing to switch.
 */
export default function AnswerTextsSetting() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { confirm } = useConfirm();
  const [consent, setConsent] = useState<AnswerTextConsent | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    readAnswerTextConsent(userId).then(
      (value) => {
        if (alive) setConsent(value);
      },
      () => {
        if (alive) setUnavailable(true);
      },
    );
    countAnswerTexts(userId).then(
      (value) => {
        if (alive) setCount(value);
      },
      () => undefined,
    );
    const stop = onAnswerTextConsent((who, value) => {
      if (alive && who === userId) setConsent(value);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [userId]);

  if (!userId || unavailable) return null;
  const on = consent === 'granted';

  const toggle = async () => {
    setBusy(true);
    try {
      await setAnswerTextConsent(userId, !on);
      setConsent(on ? 'declined' : 'granted');
      toast.success(on ? TEXTS_OFF_TOAST : TEXTS_ON_TOAST);
    } catch {
      toast.error(CHOICE_FAILED_TOAST);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const yes = await confirm({
      title: 'Удалить сохранённые тексты ответов?',
      message: 'Удалятся только тексты. Ответы, протоколы и шпаргалка останутся.',
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      type: 'danger',
    });
    if (!yes) return;
    setBusy(true);
    try {
      await deleteAnswerTexts(userId);
      setCount(0);
      toast.success(TEXTS_DELETED_TOAST);
    } catch {
      toast.error(DELETE_FAILED_TOAST);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ac-card ac-rise" aria-labelledby="profile-answers-title">
      <h2 id="profile-answers-title" className="ac-card-h">
        Проверка точности Meldy
      </h2>
      <div className="ac-row">
        <span className={`ac-row-i ${on ? 'ac-row-i--on' : ''}`} aria-hidden="true">
          <FileText />
        </span>
        <div className="ac-row-text">
          <p className="ac-row-t" id="profile-answers-switch">
            Сохранять текст ответов
          </p>
          <p className="ac-row-d">{ANSWER_TEXT_CONSENT_TEXT}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="profile-answers-switch"
          disabled={busy || consent === null}
          onClick={() => void toggle()}
          className={`ac-btn ac-row-btn ${consent === null ? 'ac-btn--quiet' : on ? 'ac-btn--ok' : 'ac-btn--blue'}`}
        >
          {consent === null ? 'Загрузка...' : on ? 'Включено' : 'Выключено'}
        </button>
      </div>
      {count !== null && count > 0 && (
        <div className="ac-row">
          <span className="ac-row-i" aria-hidden="true">
            <Trash2 />
          </span>
          <div className="ac-row-text">
            <p className="ac-row-d">Сохранено текстов ответов: {count}.</p>
          </div>
          <button type="button" className="ac-btn ac-row-btn ac-btn--danger" disabled={busy} onClick={() => void remove()}>
            Удалить
          </button>
        </div>
      )}
    </section>
  );
}
