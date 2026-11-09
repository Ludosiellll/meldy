import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { MessageCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useConfirm } from '../../contexts/ConfirmContext';
import { cancelDeletion, deletionStatus, requestDeletion } from '../../api/account';
import { SUPPORT_LABEL, SUPPORT_NOTE, supportUrl } from '../../lib/support';

/** Days within which a requested account is deleted (by hand, by the author of Meldy). */
export const DELETION_DAYS = 7;

export const ACCOUNT = {
  title: 'Аккаунт и данные',
  privacy: 'Данные и приватность',
  privacyNote: 'Что Meldy хранит, кто это видит и как это удалить.',
  open: 'Открыть',
  support: SUPPORT_LABEL,
  supportNote: SUPPORT_NOTE,
  supportGo: 'Открыть Telegram',
  remove: 'Удалить аккаунт',
  removeNote: `Лекции, экзамены, ответы и сам аккаунт. Удаляем в течение ${DELETION_DAYS} дней после запроса.`,
  removeGo: 'Запросить удаление',
  confirmTitle: 'Запросить удаление аккаунта?',
  confirmText: `Удалятся ваши лекции, экзамены, ответы и сам аккаунт. Экзамен, которым вы поделились с группой, пропадёт и у участников. Удаляем в течение ${DELETION_DAYS} дней; до этого запрос можно отменить здесь же.`,
  confirmGo: 'Запросить удаление',
  cancel: 'Отмена',
  requested: (day: string) => `Запрос на удаление отправлен ${day}. Аккаунт удалим в течение ${DELETION_DAYS} дней.`,
  takeBack: 'Отменить запрос',
  requestedToast: 'Запрос на удаление отправлен.',
  takenBackToast: 'Запрос на удаление отменён.',
  failedToast: 'Не получилось. Попробуйте ещё раз.',
} as const;

/** «9 ноября» of an ISO time, in the device's zone. */
function dayOf(iso: string): string {
  return format(new Date(iso), 'd MMMM', { locale: ru });
}

/**
 * «Профиль» → «Аккаунт и данные» (audit of 07.11: the app had no way to ask for one's account to be deleted, no page
 * about its data and no way to write about a problem; the owner, 09.11). Three rows: the page «Данные и приватность»,
 * the bot's support chat, and the request to delete the account — a request, not a button that deletes: there is no
 * backup to undo a wrong press, so the author of Meldy deletes by hand and the request can be taken back until then.
 * A database without the request's functions shows the first two rows only.
 */
export default function AccountData() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { confirm } = useConfirm();
  // undefined — not read yet or not readable (no row); null — no open request; a string — the open request's time
  const [requestedAt, setRequestedAt] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    deletionStatus().then(
      (status) => {
        if (alive) setRequestedAt(status.requestedAt);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [userId]);

  if (!userId) return null;

  const ask = async () => {
    if (busy) return;
    const yes = await confirm({ title: ACCOUNT.confirmTitle, message: ACCOUNT.confirmText, confirmText: ACCOUNT.confirmGo, cancelText: ACCOUNT.cancel, type: 'danger' });
    if (!yes) return;
    setBusy(true);
    try {
      const status = await requestDeletion();
      setRequestedAt(status.requestedAt ?? new Date().toISOString());
      toast.success(ACCOUNT.requestedToast);
    } catch {
      toast.error(ACCOUNT.failedToast);
    } finally {
      setBusy(false);
    }
  };

  const takeBack = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cancelDeletion();
      setRequestedAt(null);
      toast.success(ACCOUNT.takenBackToast);
    } catch {
      toast.error(ACCOUNT.failedToast);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ac-card ac-rise" aria-labelledby="profile-account-title">
      <h2 id="profile-account-title" className="ac-card-h">
        {ACCOUNT.title}
      </h2>
      <div className="ac-row">
        <span className="ac-row-i" aria-hidden="true">
          <ShieldCheck />
        </span>
        <div className="ac-row-text">
          <p className="ac-row-t">{ACCOUNT.privacy}</p>
          <p className="ac-row-d">{ACCOUNT.privacyNote}</p>
        </div>
        <Link className="ac-btn ac-row-btn" to="/privacy" aria-label={`${ACCOUNT.open}: ${ACCOUNT.privacy}`}>
          {ACCOUNT.open}
        </Link>
      </div>
      <div className="ac-row">
        <span className="ac-row-i" aria-hidden="true">
          <MessageCircle />
        </span>
        <div className="ac-row-text">
          <p className="ac-row-t">{ACCOUNT.support}</p>
          <p className="ac-row-d">{ACCOUNT.supportNote}</p>
        </div>
        <a className="ac-btn ac-row-btn" href={supportUrl()} target="_blank" rel="noreferrer">
          {ACCOUNT.supportGo}
        </a>
      </div>
      {requestedAt === undefined ? null : (
        <div className="ac-row">
          <span className="ac-row-i" aria-hidden="true">
            <Trash2 />
          </span>
          <div className="ac-row-text">
            <p className="ac-row-t">{ACCOUNT.remove}</p>
            <p className="ac-row-d" role={requestedAt ? 'status' : undefined}>
              {requestedAt ? ACCOUNT.requested(dayOf(requestedAt)) : ACCOUNT.removeNote}
            </p>
          </div>
          {requestedAt ? (
            <button type="button" className="ac-btn ac-row-btn" disabled={busy} onClick={() => void takeBack()}>
              {ACCOUNT.takeBack}
            </button>
          ) : (
            <button type="button" className="ac-btn ac-row-btn ac-btn--danger" disabled={busy} onClick={() => void ask()}>
              {ACCOUNT.removeGo}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
