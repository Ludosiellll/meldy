import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ContainerData, Loadable } from '../../lib/containers/hooks';
import type { GroupSummary } from '../../types/groupSummary';

/**
 * The group's summary without names (owner, 2026-11-09; docs/answers-privacy.md). The author of an exam with 5 members
 * or more reads one quiet line under the rows — «Группа: на этой неделе занимались 6 из 19, в среднем выучено 40 %.
 * Подробнее» — and «Подробнее» opens the sheet «Группа». Fewer members: nothing, and no read. A failed read: nothing,
 * quietly. The place of the line is kept while the read is out, so nothing moves when it comes. A member who joined
 * under the old promise reads once that the author now sees the group's numbers.
 */
const mocks = vi.hoisted(() => ({
  state: null as unknown,
  userId: 'user-1',
  fetchGroupSummary: vi.fn(),
}));

vi.mock('../../lib/containers/hooks', () => ({ useContainerData: () => mocks.state }));
vi.mock('../../lib/containers/plan', async (original) => (await import('../../components/containers/testkit/engine')).planModule(original));
vi.mock('../../lib/containers/session', async (original) => (await import('../../components/containers/testkit/engine')).sessionModule(original));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.userId }, loading: false }) }));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(), alert: vi.fn() }) }));
vi.mock('../../components/guide/GuideContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/guide/GuideContext')>()),
  useGuide: () => ({ start: vi.fn() }),
}));
vi.mock('../../api/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/telegram')>()),
  fetchTelegramState: vi.fn(async () => null),
}));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  fetchGroupSummary: mocks.fetchGroupSummary,
  oralSync: vi.fn(async () => ({ container_id: '', oral: [] })),
}));

import ContainerPage from './ContainerPage';
import { resetGroupSummaryForTests } from '../../components/containers/GroupLine';
import { GROUP_NOTE_JOINED_BEFORE } from '../../components/containers/sessionStore';
import * as copy from '../../components/containers/copy';
import { CONTAINER, ORAL_EXAM, SUBJECT_ORAL, containerData, subject, summary } from '../../components/containers/testkit/fixtures';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const page = () => plain(document.body.textContent);
const nm = (text: string) => (name: string) => plain(name) === text;

function loaded(data: ContainerData, extra: Partial<Loadable<ContainerData>> = {}): Loadable<ContainerData> {
  return { data, loading: false, offline: false, unavailable: false, error: null, reload: vi.fn(), ...extra };
}

function renderPage(state: Loadable<ContainerData>) {
  mocks.state = state;
  // No matchMedia: «not a phone», «a computer».
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
  return render(
    <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}`]}>
      <Routes>
        <Route path="/exams/c/:id" element={<ContainerPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const group = (members: number): Parameters<typeof summary>[0] => ({ owner: { members, doubts_open: 0, links: [] } });
const numbers = (overrides: Partial<NonNullable<GroupSummary['numbers']>> = {}, members = 19): GroupSummary => ({
  members,
  min_members: 5,
  paused_until: null,
  numbers: {
    studied_7d: 6,
    studied_prev_7d: 16,
    studied_ever: 17,
    learned_pct: 40,
    hard_topics: [
      { subject: 'Базы данных', topic: '3.2 Индексы', answers: 320, wrong_pct: 41 },
      { subject: 'Компьютерные сети', topic: null, answers: 96, wrong_pct: 33 },
    ],
    ...overrides,
  },
});
/** The visible notes under the rows (the kept place of a line still being read is not one). */
const notes = () => Array.from(document.querySelectorAll<HTMLElement>('.ct-notes .ct-note:not([data-wait])')).map((node) => plain(node.textContent));
const LINE = 'Группа: на этой неделе занимались 6 из 19, в среднем выучено 40 %.';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mocks.userId = 'user-1';
  mocks.fetchGroupSummary.mockReset().mockResolvedValue(numbers());
  resetGroupSummaryForTests();
});

afterEach(() => {
  cleanup();
});

describe('the author’s line about the group', () => {
  it('19 members: one quiet line under the rows with «Подробнее», read once', async () => {
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    const more = await screen.findByRole('button', { name: 'Подробнее' });
    expect(mocks.fetchGroupSummary).toHaveBeenCalledTimes(1);
    expect(mocks.fetchGroupSummary).toHaveBeenCalledWith(CONTAINER);
    const line = more.closest('.ct-note') as HTMLElement;
    expect(plain(line.textContent)).toBe(`${LINE} Подробнее`);
    // A note of the page like the others: no card, no heading, no button of its own on the page.
    expect(line.parentElement?.className).toBe('ct-notes');
    expect(more.className).toBe('sf-link');
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the numbers are glued to their words: «6 из 19» and «40 %» never break', async () => {
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    const more = await screen.findByRole('button', { name: 'Подробнее' });
    const text = (more.closest('.ct-note') as HTMLElement).textContent ?? '';
    expect(text).toContain(`6${NB}из${NB}19`);
    expect(text).toContain(`40${NB}%`);
  });

  it('nobody this week: the line says so in words', async () => {
    mocks.fetchGroupSummary.mockResolvedValue(numbers({ studied_7d: 0, learned_pct: 12 }));
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    await screen.findByRole('button', { name: 'Подробнее' });
    expect(notes()).toContain('Группа: на этой неделе не занимался никто из 19, в среднем выучено 12 %. Подробнее');
  });

  it('one of them, and no share to say: «занимался 1 из 5.»', async () => {
    mocks.fetchGroupSummary.mockResolvedValue(numbers({ studied_7d: 1, learned_pct: null }, 5));
    renderPage(loaded(containerData({ summary: summary(group(5)) })));
    await screen.findByRole('button', { name: 'Подробнее' });
    expect(notes()).toContain('Группа: на этой неделе занимался 1 из 5. Подробнее');
  });

  it('is the last of the quiet lines, after what waits for the author', async () => {
    const subjects = summary().subjects.map((entry, index) => (index === 0 ? { ...entry, no_key: 4 } : entry));
    renderPage(loaded(containerData({ summary: summary({ subjects, owner: { members: 19, doubts_open: 2, links: [] } }) })));
    await screen.findByRole('button', { name: 'Подробнее' });
    const shown = notes();
    expect(shown[shown.length - 1]).toBe(`${LINE} Подробнее`);
    expect(shown.length).toBeGreaterThan(2);
  });

  it('a one-subject exam is the subject’s page: the same line there', async () => {
    const solo = summary({ subjects: [subject()], owner: { members: 19, doubts_open: 0, links: [] } });
    renderPage(loaded(containerData({ summary: solo })));
    await screen.findByRole('button', { name: 'Подробнее' });
    expect(document.querySelector('[data-view="subject"]')).not.toBeNull();
    expect(notes()).toContain(`${LINE} Подробнее`);
  });
});

describe('«Подробнее»: the sheet «Группа»', () => {
  it('says the three counts, the share, the hard topics and that there are no names', async () => {
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    const more = await screen.findByRole('button', { name: 'Подробнее' });
    fireEvent.click(more);
    const sheet = screen.getByRole('dialog', { name: 'Группа' });
    const rows = within(sheet).getAllByRole('listitem').map((row) => plain(row.textContent));
    expect(rows).toEqual([
      'Занимались на этой неделе: 6 из 19',
      'Неделей раньше: 16 из 19',
      'Хотя бы раз: 17 из 19',
      'В среднем выучено: 40 %',
      'Базы данных: 3.2 Индексы — 41 % неверных ответов из 320',
      'Компьютерные сети — 33 % неверных ответов из 96',
    ]);
    expect(within(sheet).getByRole('heading', { name: nm('Трудные темы за последние 30 дней') })).toBeTruthy();
    expect(plain(sheet.textContent)).toContain('Сводка без имён: чьи это ответы, не видно никому.');
    // The exam has no oral part: nothing is said about one.
    expect(plain(sheet.textContent)).not.toContain('Устные');
    // Nothing to do in it but read and close.
    expect(within(sheet).getAllByRole('button').map((button) => button.textContent)).toEqual(['Закрыть']);
    expect(within(sheet).queryByRole('link')).toBeNull();
  });

  it('closes by «Закрыть» and by Escape, and the focus comes back to «Подробнее»', async () => {
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    const more = await screen.findByRole('button', { name: 'Подробнее' });
    more.focus();
    fireEvent.click(more);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Группа' })).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('too few answers for a topic: it says so in place of the list', async () => {
    mocks.fetchGroupSummary.mockResolvedValue(numbers({ hard_topics: [] }));
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }));
    const sheet = screen.getByRole('dialog', { name: 'Группа' });
    expect(plain(sheet.textContent)).toContain('Пока мало ответов, чтобы назвать трудные темы.');
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(4);
  });

  it('a one-subject exam names a topic without the subject; no share learned — no such row', async () => {
    mocks.fetchGroupSummary.mockResolvedValue(
      numbers({ learned_pct: null, hard_topics: [{ subject: 'Программирование на C#', topic: '2.3 Методы', answers: 48, wrong_pct: 52 }, { subject: 'Программирование на C#', topic: null, answers: 40, wrong_pct: 30 }] }),
    );
    renderPage(loaded(containerData({ summary: summary({ subjects: [subject()], owner: { members: 19, doubts_open: 0, links: [] } }) })));
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }));
    const rows = within(screen.getByRole('dialog', { name: 'Группа' })).getAllByRole('listitem').map((row) => plain(row.textContent));
    expect(rows).toEqual([
      'Занимались на этой неделе: 6 из 19',
      'Неделей раньше: 16 из 19',
      'Хотя бы раз: 17 из 19',
      '2.3 Методы — 52 % неверных ответов из 48',
      'Программирование на C# — 30 % неверных ответов из 40',
    ]);
  });

  it('an exam with an oral subject: the sheet says oral answers are not in the numbers', async () => {
    const subjects = [...summary().subjects, subject({ id: SUBJECT_ORAL, position: 5, title: 'Устный', keyed: 0, topics: [], topic_titles: [], oral: { exam_id: ORAL_EXAM, questions: 20 } })];
    renderPage(loaded(containerData({ summary: summary({ subjects, owner: { members: 19, doubts_open: 0, links: [] } }) })));
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }));
    expect(plain(screen.getByRole('dialog', { name: 'Группа' }).textContent)).toContain('Сводка без имён: чьи это ответы, не видно никому. Устные ответы в неё не входят.');
  });
});

describe('the pause after the author removed a member', () => {
  const PAUSED = 'Сводка группы снова появится 16 ноября: состав группы менялся.';
  const paused = (members = 18): GroupSummary => ({ members, min_members: 5, numbers: null, paused_until: '2026-11-16' });

  it('one quiet line says when the summary comes back and why; no numbers, no «Подробнее», no sheet', async () => {
    mocks.fetchGroupSummary.mockResolvedValue(paused());
    renderPage(loaded(containerData({ summary: summary(group(18)) })));
    await waitFor(() => expect(notes()).toContain(PAUSED));
    const shown = notes();
    expect(shown[shown.length - 1]).toBe(PAUSED);
    expect(page()).not.toContain('Группа:');
    expect(page()).not.toContain('занимал');
    expect(screen.queryByRole('button', { name: 'Подробнее' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-wait]')).toBeNull();
    // A line of the page like the others, with nothing to press.
    const line = Array.from(document.querySelectorAll<HTMLElement>('.ct-notes .ct-note')).find((node) => plain(node.textContent) === PAUSED);
    expect(line?.querySelector('button, a')).toBeNull();
    // The day stays with its month.
    expect(line?.textContent).toContain(`16${NB}ноября`);
  });

  it('the member removed while the numbers were on the page: they give way to the pause, and come back with the member', async () => {
    // A new element each time: the same one again would not draw the page anew.
    const route = () => (
      <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}`]}>
        <Routes>
          <Route path="/exams/c/:id" element={<ContainerPage />} />
        </Routes>
      </MemoryRouter>
    );
    const view = renderPage(loaded(containerData({ summary: summary(group(19)) })));
    await screen.findByRole('button', { name: 'Подробнее' });
    // «Убрать»: the page reads its summary again with 18 members, and the group's numbers are asked for anew.
    mocks.fetchGroupSummary.mockResolvedValue(paused());
    mocks.state = loaded(containerData({ summary: summary(group(18)) }));
    view.rerender(route());
    await waitFor(() => expect(notes()).toContain(PAUSED));
    expect(screen.queryByRole('button', { name: 'Подробнее' })).toBeNull();
    // «Вернуть»: 19 again, and the numbers as they were.
    mocks.fetchGroupSummary.mockResolvedValue(numbers());
    mocks.state = loaded(containerData({ summary: summary(group(19)) }));
    view.rerender(route());
    await waitFor(() => expect(notes()).toContain(`${LINE} Подробнее`));
    expect(notes()).not.toContain(PAUSED);
    expect(mocks.fetchGroupSummary).toHaveBeenCalledTimes(3);
  });

  it('the sheet open when the pause comes: it closes with the numbers', async () => {
    const view = renderPage(loaded(containerData({ summary: summary(group(19)) })));
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее' }));
    expect(screen.getByRole('dialog', { name: 'Группа' })).toBeTruthy();
    mocks.fetchGroupSummary.mockResolvedValue(paused());
    mocks.state = loaded(containerData({ summary: summary(group(18)) }));
    view.rerender(
      <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}`]}>
        <Routes>
          <Route path="/exams/c/:id" element={<ContainerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(notes()).toContain(PAUSED));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a one-subject exam says the pause on the subject’s page', async () => {
    mocks.fetchGroupSummary.mockResolvedValue(paused());
    renderPage(loaded(containerData({ summary: summary({ subjects: [subject()], owner: { members: 18, doubts_open: 0, links: [] } }) })));
    await waitFor(() => expect(notes()).toContain(PAUSED));
    expect(document.querySelector('[data-view="subject"]')).not.toBeNull();
  });
});

describe('fewer than five, a failure, a member: nothing on the page', () => {
  it.each([0, 1, 4])('%i members: no line and no read', async (members) => {
    renderPage(loaded(containerData({ summary: summary(group(members)) })));
    await act(async () => {});
    expect(mocks.fetchGroupSummary).not.toHaveBeenCalled();
    expect(page()).not.toContain('Группа:');
    expect(screen.queryByRole('button', { name: 'Подробнее' })).toBeNull();
    expect(document.querySelector('[data-wait]')).toBeNull();
  });

  it('the server gives no numbers (the group fell under five since the page was read): no line', async () => {
    mocks.fetchGroupSummary.mockResolvedValue({ members: 4, min_members: 5, numbers: null, paused_until: null });
    renderPage(loaded(containerData({ summary: summary(group(5)) })));
    await waitFor(() => expect(mocks.fetchGroupSummary).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(page()).not.toContain('Группа:');
    expect(document.querySelector('[data-wait]')).toBeNull();
  });

  it('the read fails: no line, no error, the page as it was', async () => {
    mocks.fetchGroupSummary.mockRejectedValue(new Error('network'));
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    await waitFor(() => expect(mocks.fetchGroupSummary).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(page()).not.toContain('Группа');
    expect(screen.queryByRole('button', { name: 'Подробнее' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[data-wait]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Аккредитация' })).toBeTruthy();
    // Not asked again and again on its own.
    expect(mocks.fetchGroupSummary).toHaveBeenCalledTimes(1);
  });

  it('a member of a group of 19 never asks for it', async () => {
    renderPage(loaded(containerData({ summary: summary({ role: 'member', owner: null }) })));
    await act(async () => {});
    expect(mocks.fetchGroupSummary).not.toHaveBeenCalled();
    expect(page()).not.toContain('Группа:');
  });

  it('an exam of oral subjects only has no numbers to give: no read', async () => {
    const oral = subject({ id: SUBJECT_ORAL, title: 'Устный', keyed: 0, topics: [], topic_titles: [], oral: { exam_id: ORAL_EXAM, questions: 20 } });
    renderPage(loaded(containerData({ summary: summary({ subjects: [oral, subject({ keyed: 0, topics: [] })], owner: { members: 19, doubts_open: 0, links: [] } }) })));
    await act(async () => {});
    expect(mocks.fetchGroupSummary).not.toHaveBeenCalled();
  });

  it('without network (the page is drawn from the device): no read, no place kept', async () => {
    renderPage(loaded(containerData({ summary: summary(group(19)) }), { offline: true }));
    await act(async () => {});
    expect(mocks.fetchGroupSummary).not.toHaveBeenCalled();
    expect(document.querySelector('[data-wait]')).toBeNull();
  });
});

describe('nothing moves when the line comes', () => {
  it('its place is kept from the first paint, hidden from sight and from a screen reader, and the answer fills it', async () => {
    let answer: (value: GroupSummary) => void = () => undefined;
    mocks.fetchGroupSummary.mockReturnValue(new Promise<GroupSummary>((resolve) => { answer = resolve; }));
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    const place = document.querySelector<HTMLElement>('.ct-notes .ct-note[data-wait]');
    expect(place).not.toBeNull();
    expect(place?.getAttribute('aria-hidden')).toBe('true');
    // The same words with the numbers not known yet: as many lines as the real one takes at any width.
    expect(plain(place?.textContent)).toBe('Группа: на этой неделе занимались – из 19, в среднем выучено – %. Подробнее');
    expect(place?.querySelector('button, a')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Подробнее' })).toBeNull();
    const before = document.querySelectorAll('.ct-notes > *').length;
    await act(async () => answer(numbers()));
    expect(document.querySelector('[data-wait]')).toBeNull();
    expect(document.querySelectorAll('.ct-notes > *').length).toBe(before);
    expect(notes()).toContain(`${LINE} Подробнее`);
  });

  it('coming back to the page shows the last numbers at once and reads them again only when they are old', async () => {
    const first = renderPage(loaded(containerData({ summary: summary(group(19)) })));
    await screen.findByRole('button', { name: 'Подробнее' });
    first.unmount();
    renderPage(loaded(containerData({ summary: summary(group(19)) })));
    // No kept place, no wait: the line is there in the first paint.
    expect(document.querySelector('[data-wait]')).toBeNull();
    expect(notes()).toContain(`${LINE} Подробнее`);
    expect(mocks.fetchGroupSummary).toHaveBeenCalledTimes(1);
  });

  it('a member removed or come in (the count on the page changed): the numbers are read again', async () => {
    const view = renderPage(loaded(containerData({ summary: summary(group(19)) })));
    await screen.findByRole('button', { name: 'Подробнее' });
    mocks.fetchGroupSummary.mockResolvedValue(numbers({ studied_7d: 5 }, 18));
    mocks.state = loaded(containerData({ summary: summary(group(18)) }));
    view.rerender(
      <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}`]}>
        <Routes>
          <Route path="/exams/c/:id" element={<ContainerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(notes()).toContain('Группа: на этой неделе занимались 5 из 18, в среднем выучено 40 %. Подробнее'));
    expect(mocks.fetchGroupSummary).toHaveBeenCalledTimes(2);
  });
});

describe('a member who came in under the old promise is told once', () => {
  const NOTE = 'Автор экзамена теперь видит общие цифры группы без имён: сколько человек занимается и какие темы трудные. Ваши ответы по-прежнему не видит никто.';
  const member = (overrides: Parameters<typeof summary>[0] = {}) => summary({ role: 'member', owner: null, first_plan_day: '2026-10-14', ...overrides });

  it('a quiet line of the page with «Понятно»: not a dialog, the last of the notes', async () => {
    renderPage(loaded(containerData({ summary: member({ key_changes_unseen: 2 }) })));
    const ok = screen.getByRole('button', { name: 'Понятно' });
    const line = ok.closest('.ct-note') as HTMLElement;
    expect(plain(line.textContent)).toBe(`${NOTE} Понятно`);
    expect(line.parentElement?.className).toBe('ct-notes');
    expect(screen.queryByRole('dialog')).toBeNull();
    const shown = notes();
    // After «Автор исправил ответ в 2 вопросах…» and the other lines of the page.
    expect(shown[shown.length - 1]).toBe(`${NOTE} Понятно`);
    expect(shown.some((text) => text.startsWith('Автор исправил ответ'))).toBe(true);
    expect(plain(copy.GROUP_MEMBER_NOTE)).toBe(NOTE);
  });

  it('«Понятно» takes it away for this account and this exam, on this device', async () => {
    const first = renderPage(loaded(containerData({ summary: member() })));
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    expect(page()).not.toContain('Автор экзамена теперь видит');
    first.unmount();
    // The same exam again: not said twice.
    const again = renderPage(loaded(containerData({ summary: member() })));
    expect(page()).not.toContain('Автор экзамена теперь видит');
    again.unmount();
    // Another exam of the same account: said there, once too.
    const other = renderPage(loaded(containerData({ summary: member({ id: '0b8f6e5e-1c2d-4e3f-8a9b-0c1d2e3f4a5b' }) })));
    expect(page()).toContain('Автор экзамена теперь видит');
    other.unmount();
    // Another account on this device, the first exam: said.
    mocks.userId = 'user-2';
    renderPage(loaded(containerData({ summary: member() })));
    expect(page()).toContain('Автор экзамена теперь видит');
  });

  it('stays until «Понятно»: a visit alone does not take it away', async () => {
    const first = renderPage(loaded(containerData({ summary: member() })));
    expect(page()).toContain('Автор экзамена теперь видит');
    first.unmount();
    renderPage(loaded(containerData({ summary: member() })));
    expect(page()).toContain('Автор экзамена теперь видит');
  });

  it('a one-subject exam (the subject’s page) says it too', async () => {
    renderPage(loaded(containerData({ summary: member({ subjects: [subject()] }) })));
    expect(document.querySelector('[data-view="subject"]')).not.toBeNull();
    expect(notes()).toContain(`${NOTE} Понятно`);
  });

  it('the author never reads it; a member who came in after the new words were on the invitation does not either', async () => {
    const author = renderPage(loaded(containerData({ summary: summary(group(19)) })));
    await screen.findByRole('button', { name: 'Подробнее' });
    expect(page()).not.toContain('Автор экзамена теперь видит');
    author.unmount();
    renderPage(loaded(containerData({ summary: member({ first_plan_day: GROUP_NOTE_JOINED_BEFORE }) })));
    expect(page()).not.toContain('Автор экзамена теперь видит');
    expect(mocks.fetchGroupSummary).toHaveBeenCalledTimes(1);
  });

  it('the day of coming in unknown: said (better twice than never)', async () => {
    renderPage(loaded(containerData({ summary: member({ first_plan_day: '' }) })));
    expect(page()).toContain('Автор экзамена теперь видит');
  });

  it('storage that refuses: the note is still said, and «Понятно» hides it for this visit', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      renderPage(loaded(containerData({ summary: member() })));
      fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
      expect(page()).not.toContain('Автор экзамена теперь видит');
    } finally {
      setItem.mockRestore();
    }
  });
});
