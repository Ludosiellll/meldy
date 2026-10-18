import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ContainerSummary, DayPlan, PlanInput } from '../../types/container';
import { containerErrorText, deleteContainer, deleteSubject, leaveContainer } from '../../api/containers';
import { forgetBank } from '../../lib/containers/bankCache';
import { track } from '../../lib/telemetry';
import { safeStart } from './planLines';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { HeadAction } from './PageHead';
import * as copy from './copy';
import { SETTINGS } from './copyImport';
import { QUIZ } from '../quiz/copyQuiz';
import { STUDIO } from '../studio/copyStudio';
import { REMOVE_TEST } from '../test/copyTest';
import InviteExam from './group/InviteExam';
import MinutesDialog from './MinutesDialog';
import { firstSession, isAuthor, isOwnTest, minutesOf, sessionHref, studyHref, subjectTitle } from './model';
import { resumeCounts, type SavedSession } from './sessionStore';

/**
 * Where the page's one blue pill leads and what it says: a session to continue, or the next session of the plan. On
 * the exam's page, when more than one subject has work today, the pill names the subject — «Начать: Базы данных — 17
 * вопросов», as the end of a session says «Дальше: …» (usability check, m3); a subject's own page never needs to.
 */
export function startTarget(p: {
  containerId: string;
  summary: ContainerSummary;
  plan: DayPlan | null;
  saved: SavedSession | null;
  subjectId?: string | null;
  wide: boolean;
  /** A session started on a subject's page comes back to it («Готово»). */
  back?: 's' | null;
}): { href: string; label: string } | null {
  const { containerId, summary, plan, saved, subjectId, wide, back = null } = p;
  if (saved && (!subjectId || saved.subjectId === subjectId)) {
    const { done, of } = resumeCounts(saved);
    return { href: studyHref(containerId, { resume: 1, back }), label: safeStart(of - done, null, { done, of }) };
  }
  const session = firstSession(plan, subjectId);
  if (!session) return null;
  const href = sessionHref(containerId, summary, session, back);
  if (!href) return null;
  const count = session.kind === 'ai_check' ? Math.min(3, session.ids.length) : session.ids.length;
  const working = new Set((plan?.sessions ?? []).filter((entry) => entry.ids.length > 0).map((entry) => entry.subjectId));
  const title = !subjectId && working.size > 1 ? subjectTitle(summary, session.subjectId) : '';
  if (title) return { href, label: session.kind === 'ai_check' ? copy.aloudSubject(title, count) : copy.startSubject(title, count) };
  return { href, label: safeStart(count, wide ? minutesOf(session.estSec) : null, null, session.kind) };
}

/**
 * The settings page's sections (package D3a): /exams/c/<id>/settings#minutes, #delete and #leave (which opens its
 * confirm), «Пригласить группу» its invite (?invite=1), «Кто вошёл» its members (?who=1#group). The exam's page acts in
 * place (release 47.3); the addresses stay for the bot, «План по дням» and the links of other pages.
 */
export function examLinks(containerId: string): { settings: string; minutes: string; remove: string; leave: string; invite: string; keys: string } {
  const settings = `/exams/c/${containerId}/settings`;
  return {
    settings,
    minutes: `${settings}#minutes`,
    remove: `${settings}#delete`,
    leave: `${settings}#leave`,
    invite: `${settings}?invite=1`,
    keys: `/exams/c/${containerId}/keys`,
  };
}

/** What the exam's page does in place (release 47.3): without one, the item leads to the settings page's section. */
export interface ExamHandlers {
  invite?: () => void;
  minutes?: () => void;
  remove?: () => void;
  leave?: () => void;
}

/** An item that does its thing in place when the page gives a handler, else leads to its section of «Настройки». */
function act(key: string, label: string, to: string, handler: (() => void) | undefined, extra: Partial<HeadAction> = {}): HeadAction {
  return handler ? { key, label, onSelect: handler, haspopup: 'dialog', ...extra } : { key, label, to, ...extra };
}

/**
 * The exam's «⋯» (decision 44, the critique's I9; release 47.3, owner 18.10: «Удалить» and the others only led to
 * «Настройки» — «нужно чтобы они сразу давали возможность сделать то, чего ты хочешь»). The author's «Пригласить группу»
 * (the invite dialog), «Вопросы и ключи» (with what waits), «Контрольные» — the computer's three pills, the most used —
 * then in «Ещё» «Студия», «Время в день» (a dialog), «Добавить предмет», «Настройки» and «Удалить» (its confirm, here);
 * a member's «Время в день», «Настройки» and «Выйти из экзамена» (its confirm, here). On a phone all of them are the
 * round «⋯».
 */
export function examActions(summary: ContainerSummary, handlers: ExamHandlers = {}): HeadAction[] {
  const links = examLinks(summary.id);
  if (!isAuthor(summary.role)) {
    return [
      act('minutes', copy.MENU_MINUTES, links.minutes, handlers.minutes),
      { key: 'settings', label: copy.MENU_SETTINGS, to: links.settings },
      act('leave', SETTINGS.leave, links.leave, handlers.leave, { danger: true }),
    ];
  }
  const waiting = summary.subjects.reduce((sum, subject) => sum + subject.no_key, 0) + (summary.owner?.doubts_open ?? 0);
  return [
    act('invite', copy.MENU_INVITE, links.invite, handlers.invite),
    { key: 'keys', label: waiting > 0 ? copy.menuKeysWaiting(waiting) : copy.MENU_KEYS, to: links.keys },
    { key: 'quizzes', label: QUIZ.names, to: `/exams/c/${summary.id}/quizzes` },
    // «Студия» (spec 2026-10-18 §47.6, release 47.2) in place of «Конструктор»: the test built like a site; its «Список»
    // is the constructor's cards (the old /build address still opens them).
    { key: 'studio', label: STUDIO.label, to: `/exams/c/${summary.id}/studio` },
    act('minutes', copy.MENU_MINUTES, links.minutes, handlers.minutes),
    { key: 'add', label: copy.MENU_ADD_SUBJECT, to: `/exams/import?from=c:${summary.id}` },
    { key: 'settings', label: copy.MENU_SETTINGS, to: links.settings },
    act('delete', copy.MENU_DELETE, links.remove, handlers.remove, { danger: true }),
  ];
}

/**
 * The «⋯» of the author's own test (release 47.3): «Настройки», «Вопросы и ключи», «Пригласить группу» and «Удалить» —
 * the page's own buttons («Открыть студию», «Отправить по ссылке») stand beside it; no plan, so no «Время в день».
 */
export function testActions(summary: ContainerSummary, handlers: ExamHandlers = {}): HeadAction[] {
  const links = examLinks(summary.id);
  const waiting = summary.subjects.reduce((sum, subject) => sum + subject.no_key, 0) + (summary.owner?.doubts_open ?? 0);
  return [
    { key: 'settings', label: copy.MENU_SETTINGS, to: links.settings },
    { key: 'keys', label: waiting > 0 ? copy.menuKeysWaiting(waiting) : copy.MENU_KEYS, to: links.keys },
    act('invite', copy.MENU_INVITE, links.invite, handlers.invite),
    act('delete', copy.MENU_DELETE, links.remove, handlers.remove, { danger: true }),
  ];
}

/** «Удалить» says the same here and in «Настройки»: the exam's words, or the test's. */
export function removeWords(summary: ContainerSummary): { title: string; ask: string; yes: string; done: string } {
  if (isOwnTest(summary)) return { title: REMOVE_TEST.title, ask: REMOVE_TEST.ask(summary.title), yes: REMOVE_TEST.yes, done: REMOVE_TEST.done(summary.title) };
  return {
    title: SETTINGS.remove,
    ask: SETTINGS.removeAsk(summary.title, summary.subjects.some((subject) => subject.oral)),
    yes: SETTINGS.removeYes,
    done: copy.examDeleted(summary.title),
  };
}

/** The line «Экзамены» says after a delete or a way out from the exam's page (location.state.notice). */
export interface ExamsNotice {
  notice: string;
}

/**
 * The exam's actions with their dialogs (release 47.3): «Пригласить группу» opens the invite over the page, «Время в
 * день» the minutes (saved as chosen; the page's plan is read again), «Удалить» and «Выйти из экзамена» their confirm
 * (the settings page's words); done, the way leads to «Экзамены» with a line of what happened. While members are in,
 * «Удалить» says to remove them first, with «Кто вошёл». `dialogs` goes on the page.
 */
export function useExamActions(p: {
  summary: ContainerSummary;
  planInput: PlanInput | null;
  reload: () => void;
  /** The author's own test: its four items (testActions). */
  test?: boolean;
}): { actions: HeadAction[]; dialogs: ReactNode } {
  const { summary, planInput, reload, test = false } = p;
  const navigate = useNavigate();
  const { confirm, alert } = useConfirm();
  const [inviting, setInviting] = useState(false);
  const [minutes, setMinutes] = useState(false);
  const containerId = summary.id;
  const toExams = (notice: string) => navigate('/exams', { replace: true, state: { notice } satisfies ExamsNotice });

  const membersFirst = async (n: number) => {
    const words = removeWords(summary);
    await alert({
      title: words.title,
      message: SETTINGS.hasMembers(n),
      confirmText: copy.MEMBERS_FIRST_OK,
      secondaryText: copy.MEMBERS_WHO,
      onSecondary: () => navigate(`/exams/c/${containerId}/settings?who=1#group`),
    });
  };
  const remove = async () => {
    const words = removeWords(summary);
    const members = summary.owner?.members ?? 0;
    if (members > 0) {
      await membersFirst(members);
      return;
    }
    const ok = await confirm({ title: words.title, message: words.ask, confirmText: words.yes, cancelText: SETTINGS.removeNo, type: 'danger' });
    if (!ok) return;
    try {
      await deleteContainer(containerId);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'MC009') {
        // Someone joined since the page was read: the group is read again, and the way to them is said.
        reload();
        await membersFirst(Math.max(1, members));
      } else {
        await alert({ title: words.title, message: containerErrorText(error), confirmText: copy.MEMBERS_FIRST_OK });
      }
      return;
    }
    try {
      await forgetBank(containerId);
    } catch {
      // The device's copy of the questions goes when the next overview no longer lists the exam.
    }
    track('container.deleted', { subjects: summary.subjects.length, from: 'page' });
    toExams(words.done);
  };
  const leave = async () => {
    const ok = await confirm({
      title: SETTINGS.leave,
      message: SETTINGS.leaveAsk(summary.title),
      confirmText: SETTINGS.leaveYes,
      cancelText: SETTINGS.removeNo,
      type: 'danger',
    });
    if (!ok) return;
    try {
      await leaveContainer(containerId);
    } catch (error) {
      await alert({ title: SETTINGS.leave, message: containerErrorText(error), confirmText: copy.MEMBERS_FIRST_OK });
      return;
    }
    toExams(copy.examLeft(summary.title));
  };

  const handlers: ExamHandlers = {
    invite: () => setInviting(true),
    minutes: () => setMinutes(true),
    remove: () => void remove(),
    leave: () => void leave(),
  };
  const actions = test ? testActions(summary, handlers) : examActions(summary, handlers);
  const dialogs = (
    <>
      {inviting ? <InviteExam summary={summary} onClose={() => setInviting(false)} onChanged={reload} /> : null}
      {minutes ? (
        <MinutesDialog
          containerId={containerId}
          settings={summary.settings}
          planInput={planInput}
          settingsHref={examLinks(containerId).settings}
          onClose={() => setMinutes(false)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
  return { actions, dialogs };
}

/**
 * A subject's own «⋯» inside an exam of several subjects: the author's «Ключи», «Обновить из файла», «Настройки» — the
 * computer's three pills — and «Убрать предмет» (its confirm, in «Ещё»); a member's «Настройки».
 */
export function useSubjectActions(p: { containerId: string; summary: ContainerSummary; subjectId: string; title: string }): HeadAction[] {
  const { containerId, summary, subjectId, title } = p;
  const navigate = useNavigate();
  const { confirm, alert } = useConfirm();
  if (!isAuthor(summary.role)) return [{ key: 'settings', label: copy.MENU_SETTINGS, to: `/exams/c/${containerId}/settings` }];
  const removeSubject = async () => {
    const ok = await confirm({
      title: copy.removeSubjectTitle(title),
      message: copy.REMOVE_SUBJECT_TEXT,
      confirmText: copy.REMOVE_SUBJECT_CONFIRM,
      cancelText: copy.CANCEL,
      type: 'danger',
    });
    if (!ok) return;
    try {
      await deleteSubject(subjectId);
      navigate(`/exams/c/${containerId}`, { replace: true });
    } catch (error) {
      await alert({ title: copy.removeSubjectTitle(title), message: containerErrorText(error) });
    }
  };
  return [
    { key: 'keys', label: copy.MENU_KEYS, to: `/exams/c/${containerId}/keys?s=${subjectId}` },
    { key: 'refresh', label: copy.MENU_REFRESH, to: `/exams/import?from=c:${containerId}&subject=${subjectId}` },
    { key: 'settings', label: copy.MENU_SETTINGS, to: `/exams/c/${containerId}/settings` },
    ...(summary.subjects.length > 1
      ? [{ key: 'remove', label: copy.MENU_REMOVE_SUBJECT, onSelect: () => void removeSubject(), danger: true, haspopup: 'dialog' as const }]
      : []),
  ];
}
