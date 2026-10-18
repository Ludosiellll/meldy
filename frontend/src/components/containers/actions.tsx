import { useNavigate } from 'react-router-dom';
import type { ContainerSummary, DayPlan } from '../../types/container';
import { containerErrorText, deleteSubject } from '../../api/containers';
import { safeStart } from './planLines';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { HeadAction } from './PageHead';
import * as copy from './copy';
import { SETTINGS } from './copyImport';
import { QUIZ } from '../quiz/copyQuiz';
import { STUDIO } from '../studio/copyStudio';
import { firstSession, isAuthor, minutesOf, sessionHref, studyHref, subjectTitle } from './model';
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
 * The exam's «⋯» (decision 44, the critique's I9): the author's «Пригласить группу», «Ключи» (always, with what waits),
 * «Студия» (spec 2026-10-18 §47.6: /exams/c/<id>/studio), «Контрольные» (spec 2026-10-16 §2.1:
 * /exams/c/<id>/quizzes), «Время в день», «Добавить предмет», «Настройки»,
 * «Удалить»; a member's «Время в день», «Настройки» and «Выйти из экзамена» (usability check m1: the way out was only at the bottom of «Настройки»). On a computer the same items are
 * the row of white pills under the meta, «Удалить» and «Выйти из экзамена» as quiet links. «Время в день», «Удалить»
 * and «Выйти из экзамена» are the settings page's sections (package D3a: /exams/c/<id>/settings#minutes, #delete and
 * #leave, which opens its confirm), «Пригласить группу» its invite (?invite=1).
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

export function examActions(summary: ContainerSummary): HeadAction[] {
  const links = examLinks(summary.id);
  if (!isAuthor(summary.role)) {
    return [
      { key: 'minutes', label: copy.MENU_MINUTES, to: links.minutes },
      { key: 'settings', label: copy.MENU_SETTINGS, to: links.settings },
      { key: 'leave', label: SETTINGS.leave, to: links.leave, danger: true },
    ];
  }
  const waiting = summary.subjects.reduce((sum, subject) => sum + subject.no_key, 0) + (summary.owner?.doubts_open ?? 0);
  return [
    { key: 'invite', label: copy.MENU_INVITE, to: links.invite },
    { key: 'keys', label: waiting > 0 ? copy.menuKeysWaiting(waiting) : copy.MENU_KEYS, to: links.keys },
    // «Студия» (spec 2026-10-18 §47.6, release 47.2) in place of «Конструктор»: the test built like a site; its «Список»
    // is the constructor's cards (the old /build address still opens them). It stays after «Ключи» for a test too
    // (release 47, M11): the summary does not tell a test from an exam — «Новый тест» makes one subject without a date,
    // and an import without a date, topics or lectures reads the same.
    { key: 'studio', label: STUDIO.label, to: `/exams/c/${summary.id}/studio` },
    { key: 'quizzes', label: QUIZ.names, to: `/exams/c/${summary.id}/quizzes` },
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
