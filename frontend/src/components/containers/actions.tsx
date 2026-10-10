import { useNavigate } from 'react-router-dom';
import type { ContainerSummary, DayPlan } from '../../types/container';
import { containerErrorText, deleteSubject } from '../../api/containers';
import { safeStart } from './planLines';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { HeadAction } from './PageHead';
import * as copy from './copy';
import { firstSession, isAuthor, minutesOf, sessionHref, studyHref } from './model';
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
  const count = session.kind === 'ai_check' ? Math.min(3, session.ids.length) : session.ids.length;
  return { href, label: safeStart(count, wide ? minutesOf(session.estSec) : null, null, session.kind) };
}

/**
 * The exam's «⋯» (decision 44, the critique's I9): the author's «Пригласить группу», «Ключи» (always, with what waits),
 * «Время в день», «Добавить предмет», «Настройки», «Удалить»; a member's «Время в день» and «Настройки». On a computer
 * the same items are the row of white pills under the meta. «Время в день» and «Удалить» are the settings page's
 * sections (package D3a: /exams/c/<id>/settings#minutes and #delete), «Пригласить группу» its invite (?invite=1).
 */
export function examLinks(containerId: string): { settings: string; minutes: string; remove: string; invite: string; keys: string } {
  const settings = `/exams/c/${containerId}/settings`;
  return { settings, minutes: `${settings}#minutes`, remove: `${settings}#delete`, invite: `${settings}?invite=1`, keys: `/exams/c/${containerId}/keys` };
}

export function examActions(summary: ContainerSummary): HeadAction[] {
  const links = examLinks(summary.id);
  if (!isAuthor(summary.role)) {
    return [
      { key: 'minutes', label: copy.MENU_MINUTES, to: links.minutes },
      { key: 'settings', label: copy.MENU_SETTINGS, to: links.settings },
    ];
  }
  const waiting = summary.subjects.reduce((sum, subject) => sum + subject.no_key, 0) + (summary.owner?.doubts_open ?? 0);
  return [
    { key: 'invite', label: copy.MENU_INVITE, to: links.invite },
    { key: 'keys', label: waiting > 0 ? copy.menuKeysWaiting(waiting) : copy.MENU_KEYS, to: links.keys },
    { key: 'minutes', label: copy.MENU_MINUTES, to: links.minutes },
    { key: 'add', label: copy.MENU_ADD_SUBJECT, to: `/exams/import?from=c:${summary.id}` },
    { key: 'settings', label: copy.MENU_SETTINGS, to: links.settings },
    { key: 'delete', label: copy.MENU_DELETE, to: links.remove, danger: true },
  ];
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
