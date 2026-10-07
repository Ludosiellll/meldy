import { useEffect, useId, useRef, useState } from 'react';
import { fetchSheet } from '../../../api/cheatSheet';
import type { SheetQuestion } from '../../../lib/exams/cheatSheet';
import { blockNumber } from '../../../lib/exams/cheatSheet';
import { copyText } from '../../../lib/clipboard';
import { groupLinkFor, joinUrl, type GroupLink } from '../../../lib/groups/groupLinks';
import { questionOfDay, questionOfDayMessage } from '../../../lib/groups/questionOfDay';
import { track } from '../../../lib/telemetry';
import { localDateKey } from '../../../utils/streak';
import { glue } from '../sheetModel';
import FitTextarea from './FitTextarea';
import './questionOfDay.css';

/**
 * «Скопировать вопрос дня» (plan 2026-10-07, week 2: «„вопрос дня“ вручную в беседе группы»): for the author of an
 * exam with an open group link, a short message for the group's chat — the exam, today's question of its list,
 * «Ответить в Meldy: <ссылка>» (lib/groups/questionOfDay.ts, the link: lib/groups/groupLinks.ts). Nothing at all for anyone else: no open link, a
 * classmate's copy (its links are not theirs), a sheet without answer points.
 *
 * The link is secret to the author and Meldy keeps only its hash, so the message carries it only when this device
 * has the code of an open link (made here, or opened here from the chat). Otherwise the button copies the message
 * without the link and says why.
 *
 * - `today`: a quiet line in the exam card of «Сегодня», under «Напоминать каждый день»;
 * - `invite`: a part of «Пригласить группу», with the message to read before copying.
 */

export type QuestionOfDaySource = 'today' | 'invite';

interface Props {
  examId: string;
  examTitle: string;
  /** The exam's sheet questions when the page has read them already; otherwise read here. */
  questions?: readonly SheetQuestion[] | null;
  from: QuestionOfDaySource;
  /** The code of an open link the page holds right now (just made in «Пригласить группу»), kept here or not. */
  knownCode?: string | null;
  /** Told once it is known whether the part shows («Пригласить группу» keeps its right column for it). */
  onShown?: (shown: boolean) => void;
}

const COPIED_MS = 2500;
export const NO_LINK_NOTE =
  'Ссылки группы на этом устройстве нет: Meldy хранит только её отпечаток. Откройте ссылку из беседы здесь — и Meldy её запомнит.';

function ChatIcon() {
  return (
    <svg className="qd-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.5L7 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />
      <path d="M8 10h8M8 13.5h5" />
    </svg>
  );
}

export default function QuestionOfDay({ examId, examTitle, questions, from, knownCode = null, onShown }: Props) {
  const ids = useId();
  const noteId = `${ids}-note`;
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [link, setLink] = useState<GroupLink | null>(null);
  const [read, setRead] = useState<readonly SheetQuestion[] | null>(null);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const [day, setDay] = useState(() => localDateKey());

  useEffect(() => {
    let alive = true;
    setLink(null);
    groupLinkFor(examId).then(
      (value) => {
        if (alive) setLink(value);
      },
      () => {
        if (alive) setLink({ active: false, code: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [examId]);

  // The sheet only when the page has not read it and there is an open link to ask the group with.
  useEffect(() => {
    if (questions || !link?.active) return undefined;
    let alive = true;
    fetchSheet(examId).then(
      (sheet) => {
        if (alive) setRead(sheet.questions);
      },
      () => {
        if (alive) setRead([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [examId, questions, link?.active]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const list = questions ?? read;
  const today = link?.active && list ? questionOfDay(list, examId, day) : null;
  // Known: no open link, or the list read (with or without today's question).
  const settled = link !== null && (!link.active || list !== null);
  const shown = today !== null;
  useEffect(() => {
    if (settled) onShown?.(shown);
  }, [settled, shown, onShown]);

  if (!link?.active || !list) return null;
  if (!today) return null;
  const code = link.code ?? knownCode;
  const url = code ? joinUrl(code) : null;
  const message = questionOfDayMessage({ title: examTitle, question: today, url });

  const copy = async () => {
    // A page left open past midnight asks with the new day's question.
    const now = localDateKey();
    const question = now === day ? today : questionOfDay(list, examId, now) ?? today;
    if (now !== day) setDay(now);
    const text = questionOfDayMessage({ title: examTitle, question, url });
    const done = await copyText(text, fieldRef.current);
    track('group_question_copied', { from, link: url !== null, copied: done });
    if (done) {
      setManual(null);
      setCopied(true);
      setStatus(
        url
          ? `Скопировано: вопрос ${blockNumber(question)} и ссылка группы. Вставьте сообщение в беседу.`
          : `Скопировано без ссылки: вопрос ${blockNumber(question)}. Вставьте сообщение в беседу.`,
      );
    } else {
      setManual(text);
      setStatus('Не получилось скопировать: выделите текст и скопируйте его сами.');
    }
  };

  const label = url ? 'Скопировать вопрос дня' : 'Скопировать вопрос дня без ссылки';

  if (from === 'invite') {
    return (
      <section className="ig-qd" aria-labelledby={`${ids}-h`}>
        <h3 id={`${ids}-h`} className="ig-h3">
          Вопрос дня
        </h3>
        <p className="ig-qd-lede">{glue('Каждый день — другой вопрос из списка, для беседы группы. Однокурсники ответят на него в своей копии.')}</p>
        <label className="sr-only" htmlFor={`${ids}-text`}>
          Вопрос дня для беседы группы
        </label>
        <FitTextarea id={`${ids}-text`} ref={fieldRef} className="ig-field ig-text" readOnly rows={4} value={message} />
        {url ? null : (
          <p className="ig-once" id={noteId}>
            {NO_LINK_NOTE}
          </p>
        )}
        <button type="button" className="ig-copy ig-copy-text" aria-describedby={url ? undefined : noteId} onClick={() => void copy()}>
          {copied ? 'Скопировано' : label}
        </button>
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
      </section>
    );
  }

  return (
    <div className="qd">
      <button type="button" className="qd-copy" aria-describedby={url ? undefined : noteId} onClick={() => void copy()}>
        <ChatIcon />
        <span>{copied ? 'Скопировано' : label}</span>
      </button>
      {url ? null : (
        <p className="qd-note" id={noteId}>
          {glue(NO_LINK_NOTE)}
        </p>
      )}
      <p className="qd-status" role="status" aria-live="polite">
        {status ? glue(status) : null}
      </p>
      {manual ? (
        <textarea
          ref={fieldRef}
          className="qd-manual"
          readOnly
          rows={4}
          value={manual}
          aria-label="Вопрос дня для беседы группы"
          onFocus={(event) => event.target.select()}
        />
      ) : null}
    </div>
  );
}
