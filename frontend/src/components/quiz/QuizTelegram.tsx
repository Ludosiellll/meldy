import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { quizTelegramState, setQuizNotice, shareQuizToGroup } from '../../api/quizzes';
import PaperSelect from '../ui/PaperSelect';
import { dateTimeText } from '../../lib/quizzes/quizModel';
import { nb } from '../containers/copyImport';
import { QA_TELEGRAM } from './copyAuthor';
import type { QuizNotice, QuizTelegramState } from '../../types/quiz';
import './quizAuthor.css';

/**
 * Telegram on the author's results page (release 49, spec «Выпуск 49»: «автору — «Иванов сдал: 17 из 20» и итог по
 * закрытию; ссылку на контрольную — в группу одной кнопкой»; 20261105090100_quiz_telegram):
 * - «Сообщать о сдачах»: о каждой работе / сводкой раз в час / не сообщать (the default), with what each means — the
 *   pace limit, the quiet night, the close summary. Without a linked Telegram: «Подключить Telegram» (the profile's card);
 *   a stopped bot is said so.
 * - A button per group chat bound to the exam: the bot posts the link there within a minute (once a day a chat).
 * - «Поделиться в Telegram» (t.me/share): any chat, through the Telegram app, linked or not.
 * A server without the functions (an older one) shows the last link only.
 */

export interface QuizTelegramProps {
  quizId: string;
  url: string;
  title: string;
  closed: boolean;
}

const MODES: readonly QuizNotice[] = ['each', 'digest', 'off'];

export default function QuizTelegram({ quizId, url, title, closed }: QuizTelegramProps) {
  const [state, setState] = useState<QuizTelegramState | null>(null);
  const [saving, setSaving] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    quizTelegramState(quizId).then(
      (next) => {
        if (live) setState(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [quizId]);

  const choose = async (mode: QuizNotice) => {
    if (!state || busy.current || mode === state.notice) return;
    busy.current = true;
    setSaving(true);
    setFailed(false);
    const before = state;
    setState({ ...state, notice: mode });
    try {
      setState(await setQuizNotice(quizId, mode));
    } catch {
      setState(before);
      setFailed(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const share = async (chatId: number, groupTitle: string | null) => {
    if (busy.current) return;
    busy.current = true;
    setFailed(false);
    try {
      const result = await shareQuizToGroup(quizId, chatId);
      const name = result.title ?? groupTitle;
      setLine(
        result.status === 'queued'
          ? QA_TELEGRAM.shared(name)
          : result.status === 'already'
            ? QA_TELEGRAM.already(name)
            : result.status === 'closed'
              ? QA_TELEGRAM.closed
              : result.status === 'no_link'
                ? QA_TELEGRAM.noLink
                : QA_TELEGRAM.noGroup,
      );
      if (result.status === 'queued') {
        const at = new Date().toISOString();
        setState((current) => (current ? { ...current, groups: current.groups.map((g) => (g.chat_id === chatId ? { ...g, shared_at: at } : g)) } : current));
      }
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  };

  const anywhere = `https://t.me/share/url?${new URLSearchParams({ url, text: QA_TELEGRAM.shareText(title) }).toString()}`;
  const groups = state && state.linked && !state.blocked && !closed ? state.groups : [];
  const shares = groups.map((g) => g.shared_at).filter((at): at is string => Boolean(at)).sort();
  const lastShare = shares.length > 0 ? shares[shares.length - 1] : null;

  return (
    <section className="qa-tg" aria-label={QA_TELEGRAM.title}>
      {state ? (
        state.linked && !state.blocked ? (
          <div className="qa-tg-row">
            <span className="qa-sort-label" aria-hidden="true">
              {QA_TELEGRAM.notice}
            </span>
            <PaperSelect
              ariaLabel={QA_TELEGRAM.notice}
              value={state.notice}
              disabled={saving}
              options={MODES.map((mode) => ({ value: mode, label: QA_TELEGRAM.noticeOption(mode) }))}
              onChange={(mode) => void choose(mode)}
            />
          </div>
        ) : null
      ) : null}
      {state && state.linked && !state.blocked ? <p className="qa-hint qa-tg-hint">{nb(QA_TELEGRAM.noticeHint(state.notice))}</p> : null}
      {state && state.linked && state.blocked ? <p className="qa-hint qa-tg-hint">{QA_TELEGRAM.blocked}</p> : null}
      {state && !state.linked ? (
        <p className="qa-hint qa-tg-hint">
          {QA_TELEGRAM.notLinked}{' '}
          <Link className="sf-link" to="/profile#telegram">
            {QA_TELEGRAM.link}
          </Link>
        </p>
      ) : null}
      {!closed ? (
        <div className="qa-shares qa-tg-shares">
          {groups.map((group) => (
            <button key={group.chat_id} type="button" className="qa-share-b" onClick={() => void share(group.chat_id, group.title)}>
              {QA_TELEGRAM.toGroup(group.title)}
            </button>
          ))}
          <a className="qa-share-b" href={anywhere} target="_blank" rel="noopener noreferrer">
            {QA_TELEGRAM.shareAnywhere}
          </a>
        </div>
      ) : null}
      <p className="qa-announce" role="status">
        {failed ? QA_TELEGRAM.failed : line ?? (lastShare ? nb(QA_TELEGRAM.sharedBefore(dateTimeText(lastShare))) : '')}
      </p>
    </section>
  );
}
