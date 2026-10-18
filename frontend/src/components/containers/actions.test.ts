import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/containers', () => ({ containerErrorText: vi.fn(), deleteSubject: vi.fn() }));

import { examActions, examLinks, removeWords, testActions } from './actions';
import { splitActions } from './PageHead';
import { REMOVE_TEST } from '../test/copyTest';
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
    expect(actions.map((action) => action.key)).toEqual(['invite', 'keys', 'quizzes', 'studio', 'minutes', 'add', 'settings', 'delete']);
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
    expect(examActions(test).map((action) => action.key)).toEqual(['invite', 'keys', 'quizzes', 'studio', 'minutes', 'add', 'settings', 'delete']);
  });

  it('acts in place when the page gives handlers (release 47.3): «Пригласить группу», «Время в день», «Удалить» are dialogs', () => {
    const handlers = { invite: vi.fn(), minutes: vi.fn(), remove: vi.fn(), leave: vi.fn() };
    const author = examActions(summary({ owner: { members: 0, doubts_open: 0, links: [] } }), handlers);
    for (const key of ['invite', 'minutes', 'delete']) {
      const action = author.find((entry) => entry.key === key)!;
      expect(action.to).toBeUndefined();
      expect(action.haspopup).toBe('dialog');
    }
    author.find((entry) => entry.key === 'delete')!.onSelect!();
    expect(handlers.remove).toHaveBeenCalledTimes(1);
    // «Настройки» stays a link.
    expect(author.find((entry) => entry.key === 'settings')?.to).toBe(settings);
    const member = examActions(summary({ role: 'member', owner: null }), handlers);
    member.find((entry) => entry.key === 'leave')!.onSelect!();
    expect(handlers.leave).toHaveBeenCalledTimes(1);
    expect(member.find((entry) => entry.key === 'leave')).toMatchObject({ danger: true, haspopup: 'dialog' });
  });

  it('a computer shows three pills — «Пригласить группу», «Вопросы и ключи», «Контрольные» — and the rest in «Ещё»', () => {
    const { shown, more } = splitActions(examActions(summary({ owner: { members: 0, doubts_open: 0, links: [] } })));
    expect(shown.map((action) => action.key)).toEqual(['invite', 'keys', 'quizzes']);
    expect(more.map((action) => action.key)).toEqual(['studio', 'minutes', 'add', 'settings', 'delete']);
    // A member's three: two pills, the way out in «Ещё» (a danger item is never a pill).
    const member = splitActions(examActions(summary({ role: 'member', owner: null })));
    expect(member.shown.map((action) => action.key)).toEqual(['minutes', 'settings']);
    expect(member.more.map((action) => action.key)).toEqual(['leave']);
    expect(splitActions(examActions(summary()), 0).shown).toEqual([]);
  });

  it('the author’s own test: «Настройки», «Вопросы и ключи», «Пригласить группу», «Удалить» — no plan, no «Время в день»', () => {
    const own = summary({ kind: 'test', exam_date: null, owner: { members: 0, doubts_open: 0, links: [] } });
    const actions = testActions(own);
    expect(actions.map((action) => action.key)).toEqual(['settings', 'keys', 'invite', 'delete']);
    expect(actions.map((action) => String(action.label).replace(/\u00a0/g, ' ').split(' · ')[0])).toEqual(['Настройки', 'Вопросы и ключи', 'Пригласить группу', 'Удалить']);
    expect(actions.find((action) => action.key === 'keys')?.to).toBe(`/exams/c/${CONTAINER}/keys`);
  });

  it('«Удалить» says the settings’ words: the exam’s, or the test’s for the author’s own test', () => {
    expect(removeWords(summary({ title: 'Сессия' }))).toEqual({
      title: SETTINGS.remove,
      ask: SETTINGS.removeAsk('Сессия', false),
      yes: SETTINGS.removeYes,
      done: 'Экзамен «Сессия» удалён.',
    });
    expect(removeWords(summary({ title: 'Кислоты', kind: 'test' }))).toEqual({
      title: REMOVE_TEST.title,
      ask: 'Удалить «Кислоты»? Вопросы, контрольные и их результаты пропадут.',
      yes: 'Удалить тест',
      done: 'Тест «Кислоты» удалён.',
    });
    // A member of a test leaves it; «Удалить» is the author's, with the exam's words when it is not their own test.
    expect(removeWords(summary({ title: 'Кислоты', kind: 'test', role: 'member' })).title).toBe(SETTINGS.remove);
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
