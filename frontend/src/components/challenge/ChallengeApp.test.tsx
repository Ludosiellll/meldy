/**
 * «Соревнование в своё время» on the player's screens (/s/<code>), against the in-page fake with the server's rules
 * (lib/challenge/api, rules.ts): the intro, the name and the character, «Готовы?», each kind of question with its
 * explanation after it, the key never before the answer, the time that runs out by the server's clock, the final with
 * the place, the table with the own row, the review and «Тренировать ошибки» for a guest; «Без спешки», a closed
 * challenge and an unknown link.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeChallengeApi } from '../../lib/challenge/api';
import { ChallengeApp } from './ChallengeApp';
import { ChallengeController } from './controller';
import { CH } from './copy';

/** The screen's text with its no-break spaces read as spaces. */
const plain = (t: string | null | undefined) => (t ?? '').replace(/\u00a0/g, ' ');

let clock = 0;
const now = () => Date.now() + clock;

beforeEach(() => {
  clock = 0;
  window.localStorage.clear();
});
afterEach(cleanup);

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function mount(code = 'demxchamp123', api = createFakeChallengeApi({ readyMs: 0, now })) {
  const ctl = new ChallengeController({ api });
  const view = render(<ChallengeApp ctl={ctl} signInHref="/login?next=%2Fs%2Fdemxchamp123%3Fpractice%3D1" />);
  await act(async () => {
    await ctl.start(code);
  });
  return { ctl, view, api };
}

async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
  await flush();
}

/** Through the intro, the character and «Готовы?» to the first question. */
async function toFirstQuestion(name = 'Лена') {
  await click(CH.intro.start);
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: name } });
  });
  await click('Готово');
  expect(screen.getByRole('heading', { name: CH.ready.title })).toBeInTheDocument();
  await click(CH.ready.go);
}

describe('a guest plays a challenge through', () => {
  it('intro, character, every kind with its explanation, the final with the place, the table, the review', async () => {
    const { view } = await mount();
    expect(screen.getByRole('heading', { name: 'Базы данных' })).toBeInTheDocument();
    expect(plain(view.container.textContent)).toContain('5 вопросов · 20 секунд на вопрос');
    expect(plain(view.container.textContent)).toContain('Уже прошли: 3 человека');
    expect(plain(view.container.textContent)).toContain(CH.intro.speed);
    await toFirstQuestion();

    // 1. one right option: no key on the screen before the answer
    expect(screen.getByRole('heading', { name: 'Какая команда отменяет транзакцию?' })).toBeInTheDocument();
    expect(plain(view.container.textContent)).not.toContain('Верный ответ');
    expect(view.container.querySelector('[data-mark]')).toBeNull();
    await click(/ROLLBACK/);
    let sheet = view.container.querySelector('.lc-sheet')!;
    expect(within(sheet as HTMLElement).getByRole('status').textContent).toBe(CH.sheet.right);
    expect(plain(sheet.textContent)).toMatch(/\+\d+/);
    expect(plain(sheet.textContent)).toContain('ROLLBACK отменяет все изменения');
    expect(plain(sheet.textContent)).toContain(CH.sheet.explanation);
    expect(plain(view.container.querySelector('.lp-ans[data-mark="key"]')?.textContent)).toContain('ROLLBACK');
    await click(CH.sheet.next);

    // 2. several right answers: ticks, then «Ответить»
    expect(plain(view.container.textContent)).toContain('Верных: 2');
    await click(/INSERT/);
    await click(/UPDATE/);
    await click('Ответить');
    sheet = view.container.querySelector('.lc-sheet')!;
    expect(plain(sheet.querySelector('[role="status"]')?.textContent)).toBe(CH.sheet.right);
    expect(plain(sheet.textContent)).toContain('DML меняет данные');
    await click(CH.sheet.next);

    // 3. a text answer: case and a trailing dot do not matter (the study's rule)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Ваш ответ на вопрос'), { target: { value: 'sql.' } });
    });
    await click('Ответить');
    sheet = view.container.querySelector('.lc-sheet')!;
    expect(plain(sheet.querySelector('[role="status"]')?.textContent)).toBe(CH.sheet.right);
    expect(plain(sheet.textContent)).toContain('Верный ответ: SQL');
    await click(CH.sheet.next);

    // 4. a number on the keypad
    for (const d of ['1', '0', '2', '4']) await click(d);
    await click('Ответить');
    sheet = view.container.querySelector('.lc-sheet')!;
    expect(plain(sheet.querySelector('[role="status"]')?.textContent)).toBe(CH.sheet.right);
    expect(plain(sheet.textContent)).toContain('1024');
    await click(CH.sheet.next);

    // 5. wrong: the key, the freeze, «Итог»
    await click(/Транзакция выполняется целиком/);
    sheet = view.container.querySelector('.lc-sheet')!;
    expect(plain(sheet.querySelector('[role="status"]')?.textContent)).toBe(CH.sheet.wrong);
    expect(plain(sheet.textContent)).toContain('Верный ответ: Б · Параллельные транзакции не мешают друг другу');
    expect(plain(sheet.textContent)).toContain(CH.sheet.frozenNow);
    await click(CH.sheet.final);

    // the final: the place among the four who finished
    expect(plain(screen.getByRole('heading', { level: 1 }).textContent)).toMatch(/Дедлайн (повержен|устоял)/);
    expect(plain(view.container.querySelector('.lp-result__place')?.textContent)).toMatch(/^\d-е местоиз 4$/);
    expect(plain(view.container.querySelector('.lp-stats3')?.textContent)).toContain('4 из 5');

    // the table: the own row among the others
    await click(CH.final.board);
    expect(screen.getByRole('heading', { name: CH.board.title })).toBeInTheDocument();
    const rows = view.container.querySelectorAll('.lc-row');
    expect(rows).toHaveLength(4);
    expect(plain(view.container.querySelector('.lc-row[data-me="true"]')?.textContent)).toContain('Лена · вы');
    expect(plain(rows[0].textContent)).toContain('1');
    await click(CH.board.back);

    // the review and «Тренировать ошибки»: a guest is asked to sign in and comes back here
    await click(CH.final.review);
    expect(screen.getByRole('heading', { name: 'Разбор' })).toBeInTheDocument();
    expect(view.container.querySelectorAll('.lp-rv-item')).toHaveLength(5);
    expect(plain(view.container.textContent)).toContain('Верно 4 из 5. Здесь только вопросы, которые вы видели.');
    expect(plain(view.container.textContent)).toContain('I — isolation, изоляция.');
    await click('Тренировать ошибки');
    expect(screen.getByRole('link', { name: 'Войти и тренировать' })).toHaveAttribute('href', '/login?next=%2Fs%2Fdemxchamp123%3Fpractice%3D1');
  });

  it('comes back to the same run on this device, and cannot start a second one', async () => {
    const api = createFakeChallengeApi({ readyMs: 0, now });
    const first = await mount('demxchamp123', api);
    await toFirstQuestion('Тимофей');
    first.ctl.dispose();
    cleanup();
    const again = await mount('demxchamp123', api);
    expect(again.view.container.querySelector('.lc-battle')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Какая команда отменяет транзакцию?' })).toBeInTheDocument();
    expect(plain(again.view.container.textContent)).not.toContain(CH.intro.start);
  });
});

describe('the server’s clock', () => {
  it('the time runs out: the server grades it as none, then the key and the explanation', async () => {
    const { ctl, view } = await mount();
    await toFirstQuestion();
    clock = 25_000;
    await act(async () => {
      await ctl.refresh();
    });
    await flush();
    const sheet = view.container.querySelector('.lc-sheet')!;
    expect(plain(sheet.querySelector('[role="status"]')?.textContent)).toBe(CH.sheet.none);
    expect(plain(sheet.textContent)).toContain('Верный ответ: А · ROLLBACK');
    expect(plain(sheet.textContent)).toContain('ROLLBACK отменяет все изменения');
  });
});

describe('the challenge’s own cases', () => {
  it('«Без спешки» says so and promises no ice', async () => {
    const api = createFakeChallengeApi({ readyMs: 0, now });
    const made = await api.create({ container_id: 'c', subject_ids: ['s'], count: 5 }, { time_s: 30, speed: false, calm: true, deadline: new Date(Date.now() + 86_400_000).toISOString() });
    const { view } = await mount(made.code, api);
    expect(plain(view.container.textContent)).toContain(CH.intro.calm);
    expect(plain(view.container.textContent)).toContain(CH.intro.calmBoss);
    await toFirstQuestion();
    expect(plain(view.container.querySelector('.lp-me-text')?.textContent)).toBe(CH.q.calm);
    await click(/COMMIT/);
    expect(plain(view.container.querySelector('.lc-sheet')?.textContent)).toContain(CH.sheet.calmMiss);
  });

  it('a closed challenge shows its table, not «Начать»', async () => {
    const api = createFakeChallengeApi({ readyMs: 0, now });
    const mine = await api.mine();
    await api.close(mine[0].challenge_id);
    const { view } = await mount('demxchamp123', api);
    expect(plain(view.container.textContent)).toContain(CH.intro.overTitle);
    expect(plain(view.container.textContent)).toContain(CH.intro.overClosed);
    expect(screen.queryByRole('button', { name: CH.intro.start })).toBeNull();
    await click(CH.intro.board);
    expect(view.container.querySelectorAll('.lc-row')).toHaveLength(3);
  });

  it('one who joined but never started, after the close: the intro says it is over', async () => {
    const api = createFakeChallengeApi({ readyMs: 0, now });
    const first = await mount('demxchamp123', api);
    await click(CH.intro.start);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Поздний' } });
    });
    await click('Готово');
    expect(screen.getByRole('heading', { name: CH.ready.title })).toBeInTheDocument();
    first.ctl.dispose();
    cleanup();
    await api.close((await api.mine())[0].challenge_id);
    const again = await mount('demxchamp123', api);
    expect(plain(again.view.container.textContent)).toContain(CH.intro.overTitle);
    expect(screen.queryByRole('button', { name: CH.ready.go })).toBeNull();
  });

  it('an unknown link and a link of no shape say so', async () => {
    const { view } = await mount('zzzzzzzzzzzz');
    expect(plain(view.container.textContent)).toContain(CH.gone.noLink.title);
    cleanup();
    const bad = await mount('../x');
    expect(plain(bad.view.container.textContent)).toContain(CH.gone.noLink.title);
  });

  it('a rude name is refused before the run is made', async () => {
    const { api } = await mount();
    await click(CH.intro.start);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Су-ка' } });
    });
    await click('Готово');
    expect(screen.getByRole('alert').textContent).toBe(CH.builder.rude);
    expect((await api.info('demxchamp123')).playing).toBe(0);
  });
});
