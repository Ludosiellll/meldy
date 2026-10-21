import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listQuizzes: vi.fn() }));
vi.mock('../../api/quizzes', () => ({ listQuizzes: api.listQuizzes }));

import TestsView, { TestDoors, ViewSwitch } from './TestsView';
import { TESTS_VIEW } from './copyQuick';
import { LIVE_ENTRY } from '../test/gameEntry';
import { TEST_HOME } from '../test/copyTest';
import type { OverviewContainer } from '../../types/container';
import type { QuizListRow } from '../../types/quiz';

/* «Тесты» on «Экзамены» (UX audit of 21.10, P2; mockups m1, m4). */

function test(id: string, title: string, items: number, keyed = items): OverviewContainer {
  return {
    id, title, kind: 'test', exam_date: null, created_at: '2026-10-14T10:00:00Z', role: 'owner', items, items_updated_at: null,
    subjects: items > 0 ? [{ keyed, no_key: items - keyed }] : [], answers_today: 0, settings: null,
  } as OverviewContainer;
}

function quiz(id: string, patch: Partial<QuizListRow> = {}): QuizListRow {
  return {
    id, container_id: 'c-1', code: 'k7m2p9q4r8st', title: `Контрольная ${id}`, subject_ids: [], item_count: 12, same_set: true,
    shuffle_items: false, shuffle_options: true, time_limit_s: null, opens_at: null, closes_at: null, closed_at: null, attempts: 1,
    grading: 'best', allow_back: true, pass_percent: null, review: 'mistakes_then_answers', members_only: false, guests: true,
    cover_path: null, accent: 'blue', offer_practice: false, created_at: '', updated_at: '', state: 'open', started: true,
    people: 20, writing: 3, finished: 17, avg_percent: 71, ...patch,
  };
}

function renderView(tests: OverviewContainer[]) {
  return render(
    <MemoryRouter>
      <TestsView tests={tests} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.listQuizzes.mockReset();
});
afterEach(() => cleanup());

describe('TestsView', () => {
  it('a test’s card shows its контрольные with «Показать ссылку» and «Открыть результаты»', async () => {
    api.listQuizzes.mockResolvedValue([quiz('q-1'), quiz('q-2', { state: 'closed', writing: 0, finished: 24 }), quiz('q-3')]);
    renderView([test('c-1', 'Кислоты и основания', 12)]);
    const card = (await screen.findByRole('link', { name: 'Кислоты и основания' })).closest('li')!;
    expect(card).toHaveTextContent('12 вопросов');
    const rows = await within(card).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link', { name: TESTS_VIEW.link })).toHaveAttribute('href', '/exams/c/c-1/quizzes/q-1/link');
    expect(within(rows[0]).getByRole('link', { name: TESTS_VIEW.results })).toHaveAttribute('href', '/exams/c/c-1/quizzes/q-1');
    expect(rows[0]).toHaveTextContent('Пишут 3');
    expect(rows[0]).toHaveTextContent('Сдали 17');
    // A closed one has no link to hand out.
    expect(within(rows[1]).queryByRole('link', { name: TESTS_VIEW.link })).toBeNull();
    expect(within(card).getByRole('link', { name: /^Ещё 1/ })).toHaveAttribute('href', '/exams/c/c-1');
    expect(card).toHaveTextContent('3 контрольные');
  });

  it('a test not sent yet offers «Отправить по ссылке»', async () => {
    api.listQuizzes.mockResolvedValue([]);
    renderView([test('c-2', 'Входной тест', 8)]);
    expect(await screen.findByText(TESTS_VIEW.notSent)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: TESTS_VIEW.send })).toHaveAttribute('href', '/exams/c/c-2/quizzes/new?all=1&design=1');
  });

  it('every test offers «Провести игру» by the test page’s rule: the game’s setup for that test', async () => {
    api.listQuizzes.mockImplementation(async (id: string) => (id === 'c-1' ? [quiz('q-1'), quiz('q-2'), quiz('q-3')] : []));
    renderView([test('c-1', 'Кислоты и основания', 12), test('c-2', 'Входной тест', 8)]);
    const sent = (await screen.findByRole('link', { name: 'Кислоты и основания' })).closest('li')!;
    expect(await within(sent).findByRole('link', { name: LIVE_ENTRY.host })).toHaveAttribute('href', '/live/new?c=c-1');
    // Beside «Ещё 1 контрольная», under the контрольные.
    expect(within(sent).getByRole('link', { name: LIVE_ENTRY.host }).closest('.tv-foot')).toContainElement(within(sent).getByRole('link', { name: /^Ещё 1/ }));
    // Not sent yet: beside «Отправить по ссылке».
    const fresh = screen.getByRole('link', { name: 'Входной тест' }).closest('li')!;
    const game = await within(fresh).findByRole('link', { name: LIVE_ENTRY.host });
    expect(game).toHaveAttribute('href', '/live/new?c=c-2');
    expect(game.parentElement).toContainElement(within(fresh).getByRole('link', { name: TESTS_VIEW.send }));
    expect(LIVE_ENTRY.host).toBe('Провести игру');
  });

  it('«Провести игру» waits, with the test page’s reason, while no question has its key, or there is none', async () => {
    api.listQuizzes.mockResolvedValue([]);
    renderView([test('c-3', 'Без ключей', 6, 0), test('c-4', 'Пустой', 0)]);
    const noKey = (await screen.findByRole('link', { name: 'Без ключей' })).closest('li')!;
    const shut = await within(noKey).findByRole('button', { name: LIVE_ENTRY.host });
    expect(shut).toBeDisabled();
    expect(shut).toHaveAccessibleDescription(TEST_HOME.sendWhyKey);
    const empty = screen.getByRole('link', { name: 'Пустой' }).closest('li')!;
    expect(await within(empty).findByRole('button', { name: LIVE_ENTRY.host })).toHaveAccessibleDescription(TEST_HOME.sendWhyEmpty);
    expect(screen.queryByRole('link', { name: LIVE_ENTRY.host })).toBeNull();
  });

  it('a read that failed offers «Повторить»', async () => {
    api.listQuizzes.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([quiz('q-1')]);
    renderView([test('c-1', 'Кислоты и основания', 12)]);
    fireEvent.click(await screen.findByRole('button', { name: TESTS_VIEW.retry }));
    expect(await screen.findByRole('link', { name: TESTS_VIEW.link })).toBeInTheDocument();
  });

  it('no test yet: one line that leads to the quick one', () => {
    renderView([]);
    expect(screen.getByText(TESTS_VIEW.empty)).toBeInTheDocument();
    expect(api.listQuizzes).not.toHaveBeenCalled();
  });

  it('«?» there opens the «Тесты» chapter (the view says which chapter it is)', () => {
    renderView([]);
    expect(document.querySelector('[data-guide-chapter="tests"]')).not.toBeNull();
  });
});

describe('TestDoors and ViewSwitch', () => {
  it('two doors, each with its line: the quick one is the blue pill', () => {
    render(
      <MemoryRouter>
        <TestDoors />
      </MemoryRouter>,
    );
    const quick = screen.getByRole('link', { name: TESTS_VIEW.quick });
    expect(quick).toHaveAttribute('href', '/tests/quick');
    expect(quick).toHaveClass('sf-primary');
    expect(quick).toHaveAccessibleDescription(TESTS_VIEW.quickNote);
    const studio = screen.getByRole('link', { name: TESTS_VIEW.studio });
    expect(studio).toHaveAttribute('href', '/tests/new');
    expect(studio).toHaveAccessibleDescription(TESTS_VIEW.studioNote);
  });

  it('the switch says which list is shown and the counts', () => {
    const onChange = vi.fn();
    render(<ViewSwitch view="exams" exams={3} tests={2} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Экзамены 3' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Тесты 2' }));
    expect(onChange).toHaveBeenCalledWith('tests');
    cleanup();
    render(<ViewSwitch view="tests" exams={null} tests={0} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Экзамены' })).toHaveAttribute('aria-pressed', 'false');
  });
});
