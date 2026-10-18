import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/containers', () => ({ containerErrorText: vi.fn(), deleteSubject: vi.fn() }));

import { examActions, examLinks } from './actions';
import { SETTINGS } from './copyImport';
import { CONTAINER, subject, summary } from './testkit/fixtures';

const settings = `/exams/c/${CONTAINER}/settings`;

describe('examActions: the exam’s «⋯»', () => {
  it('a member: «Время в день», «Настройки» and the way out, «Выйти из экзамена», at the leave confirm (usability check m1)', () => {
    const actions = examActions(summary({ role: 'member', owner: null }));
    expect(actions.map((action) => [action.key, action.label, action.to])).toEqual([
      ['minutes', 'Время в день', `${settings}#minutes`],
      ['settings', 'Настройки', settings],
      ['leave', SETTINGS.leave, `${settings}#leave`],
    ]);
    // Drawn as «Удалить» is for the author: after a line in the phone's menu, a quiet link on a computer.
    expect(actions[2].danger).toBe(true);
    expect(SETTINGS.leave).toBe('Выйти из экзамена');
  });

  it('the author: no way out, «Удалить» at the delete confirm', () => {
    const actions = examActions(summary({ owner: { members: 0, doubts_open: 0, links: [] } }));
    expect(actions.map((action) => action.key)).toEqual(['invite', 'keys', 'studio', 'quizzes', 'minutes', 'add', 'settings', 'delete']);
    // «Студия» (spec 2026-10-18 §47.6, release 47.2) in place of «Конструктор», beside «Вопросы и ключи»; a member has neither.
    expect(actions.find((action) => action.key === 'studio')).toMatchObject({ label: 'Студия', to: `/exams/c/${CONTAINER}/studio` });
    expect(actions.some((action) => action.key === 'build')).toBe(false);
    expect(actions.find((action) => action.key === 'quizzes')).toMatchObject({ label: 'Контрольные', to: `/exams/c/${CONTAINER}/quizzes` });
    expect(actions.find((action) => action.key === 'delete')?.to).toBe(`${settings}#delete`);
    expect(actions.some((action) => action.label === SETTINGS.leave)).toBe(false);
  });

  it('what «Новый тест» makes keeps the same order: the summary cannot tell a test from an exam (release 47, M11)', () => {
    // One subject «Вопросы» without a date, topics or lectures: an import without them looks exactly the same.
    const test = summary({
      exam_date: null,
      owner: { members: 0, doubts_open: 0, links: [] },
      subjects: [subject({ title: 'Вопросы', exam_date: null, oral: null, topic_titles: [], topics: [] })],
    });
    expect(examActions(test).map((action) => action.key)).toEqual(['invite', 'keys', 'studio', 'quizzes', 'minutes', 'add', 'settings', 'delete']);
  });

  it('examLinks names the settings page’s sections', () => {
    expect(examLinks(CONTAINER)).toEqual({
      settings,
      minutes: `${settings}#minutes`,
      remove: `${settings}#delete`,
      leave: `${settings}#leave`,
      invite: `${settings}?invite=1`,
      keys: `/exams/c/${CONTAINER}/keys`,
    });
  });
});
