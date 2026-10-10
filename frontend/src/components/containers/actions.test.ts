import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/containers', () => ({ containerErrorText: vi.fn(), deleteSubject: vi.fn() }));

import { examActions, examLinks } from './actions';
import { SETTINGS } from './copyImport';
import { CONTAINER, summary } from './testkit/fixtures';

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
    expect(actions.map((action) => action.key)).toEqual(['invite', 'keys', 'minutes', 'add', 'settings', 'delete']);
    expect(actions.find((action) => action.key === 'delete')?.to).toBe(`${settings}#delete`);
    expect(actions.some((action) => action.label === SETTINGS.leave)).toBe(false);
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
