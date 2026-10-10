import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ContainerSummary, DayPlan, PlanInput } from '../../types/container';
import { containerErrorText, deleteContainer, deleteSubject } from '../../api/containers';
import { startLabel } from '../../lib/containers/words';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { HeadAction } from './PageHead';
import { MinutesSheet } from './Sheets';
import * as copy from './copy';
import { firstSession, isAuthor, minutesOf, oralCount, sessionHref, studyHref, type Figure } from './model';
import { resumeCounts, type SavedSession } from './sessionStore';

/** Where the page's one blue pill leads and what it says: a session to continue, or the next session of the plan. */
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
  if (session.kind === 'ai_check') return { href, label: copy.ANSWER_ALOUD(Math.min(3, session.ids.length)) };
  return { href, label: safeStart(session.ids.length, wide ? minutesOf(session.estSec) : null, null) };
}

function safeStart(count: number, minutes: number | null, resume: { done: number; of: number } | null): string {
  try {
    return startLabel(count, minutes, resume);
  } catch {
    return copy.glue(resume ? `Продолжить: ещё ${copy.q(Math.max(1, count))}` : `Начать: ${copy.q(count)}`);
  }
}

/**
 * The exam's «⋯» (decision 44, the critique's I9): the author's «Пригласить группу», «Ключи» (always, with what waits),
 * «Время в день», «Добавить предмет», «Настройки», «Удалить»; a member's «Время в день» and «Настройки». On a computer
 * the same items are the row of white pills under the meta.
 */
export function useExamActions(p: {
  containerId: string;
  summary: ContainerSummary;
  input: PlanInput | null;
  figure: Figure;
  nextDateText: string | null;
  reload: () => void;
}): { actions: HeadAction[]; openMinutes: () => void; remove: () => void; dialogs: ReactNode } {
  const { containerId, summary, input, figure, nextDateText, reload } = p;
  const navigate = useNavigate();
  const { confirm, alert } = useConfirm();
  const [minutesOpen, setMinutesOpen] = useState(false);
  const author = isAuthor(summary.role);
  const waiting = summary.subjects.reduce((sum, subject) => sum + subject.no_key, 0) + (summary.owner?.doubts_open ?? 0);

  const remove = async () => {
    const oral = summary.subjects.filter((subject) => oralCount(subject) > 0).length;
    const ok = await confirm({
      title: copy.DELETE_TITLE,
      message: copy.deleteMessage(oral),
      confirmText: copy.DELETE_CONFIRM,
      cancelText: copy.CANCEL,
      type: 'danger',
    });
    if (!ok) return;
    try {
      await deleteContainer(containerId);
      navigate('/exams', { replace: true });
    } catch (error) {
      await alert({ title: copy.DELETE_TITLE, message: containerErrorText(error) });
    }
  };

  const actions: HeadAction[] = author
    ? [
        { key: 'invite', label: copy.MENU_INVITE, to: `/exams/c/${containerId}/settings?invite=1` },
        { key: 'keys', label: waiting > 0 ? copy.menuKeysWaiting(waiting) : copy.MENU_KEYS, to: `/exams/c/${containerId}/keys` },
        { key: 'minutes', label: copy.MENU_MINUTES, onSelect: () => setMinutesOpen(true) },
        { key: 'add', label: copy.MENU_ADD_SUBJECT, to: `/exams/import?from=c:${containerId}` },
        { key: 'settings', label: copy.MENU_SETTINGS, to: `/exams/c/${containerId}/settings` },
        { key: 'delete', label: copy.MENU_DELETE, onSelect: () => void remove(), danger: true },
      ]
    : [
        { key: 'minutes', label: copy.MENU_MINUTES, onSelect: () => setMinutesOpen(true) },
        { key: 'settings', label: copy.MENU_SETTINGS, to: `/exams/c/${containerId}/settings` },
      ];

  const dialogs = minutesOpen ? (
    <MinutesSheet
      containerId={containerId}
      settings={summary.settings}
      input={input}
      total={figure.total}
      dateText={nextDateText}
      onClose={() => setMinutesOpen(false)}
      onSaved={reload}
    />
  ) : null;

  return { actions, openMinutes: () => setMinutesOpen(true), remove: () => void remove(), dialogs };
}

/**
 * A subject's own «⋯» inside an exam of several subjects: the author's «Ключи», «Обновить из файла», «Настройки» and
 * «Убрать предмет»; a member's «Настройки».
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
    ...(summary.subjects.length > 1 ? [{ key: 'remove', label: copy.MENU_REMOVE_SUBJECT, onSelect: () => void removeSubject(), danger: true }] : []),
  ];
}
