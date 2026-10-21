/**
 * The player's screens, state by state, against the fake server (lib/live/fake.ts) on vitest's fake clock: PIN, the
 * builder with locked parts, the lobby, countdown, open, «Ответ принят», right / wrong / frozen / thawed, the place, the
 * boss's angry phase, the final with the unlock, the review, «Поделиться», a lost network.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Final as FinalData, TopRow } from '../../../lib/live/types';
import { defaultLook } from '../../../lib/live/rules';
import { gapLine } from './Battle';
import { Final } from './Final';
import { PlayerApp } from './PlayerApp';
import type { PlayerController } from './controller';
import { obeyOffline } from './offline';
import type { PlayerPlatform } from './platform';
import { controller, fakeApi, keyOf, newRecorder, recordingPlatform, useGameClock, type FakeApi, type Recorder } from './testkit';

let api: FakeApi;
let rec: Recorder;
let platform: PlayerPlatform;
let ctl: PlayerController;

const main = () => document.querySelector('main.lp') as HTMLElement;
const gameState = () => main()?.getAttribute('data-state');
const answers = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button.lp-ans'));

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function until(cond: () => boolean, maxMs = 90_000) {
  for (let t = 0; t <= maxMs; t += 100) {
    if (cond()) return;
    await tick(100);
  }
  throw new Error('the screen never came');
}

async function mount(pin: string | null = '482913') {
  render(<PlayerApp ctl={ctl} platform={platform} shareUrl="https://ludosiel-studyforge.hf.space/" />);
  await act(async () => {
    await ctl.start({ pin });
  });
}

async function joinDemo() {
  await joinDemoAny();
  await until(() => gameState() === 'lobby');
}

/** Mounts, names and joins; the game may be in any state. */
async function joinDemoAny() {
  await mount();
  fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Дима' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
  });
}

/** Waits for the next question's open buttons and answers it: right, wrong, or not at all. */
async function play(how: 'right' | 'wrong' | 'none') {
  await until(() => answers().length > 0 && answers().every((b) => b.getAttribute('aria-disabled') !== 'true') && gameState() !== 'reveal');
  if (how === 'none') return;
  const key = keyOf(api, ctl.getSnapshot().game!.id);
  const pick = how === 'right' ? key : (key + 1) % answers().length;
  await act(async () => {
    fireEvent.click(answers()[pick]);
  });
}

beforeEach(() => {
  useGameClock();
  window.sessionStorage.clear();
  window.localStorage.clear();
  api = fakeApi();
  rec = newRecorder();
  platform = recordingPlatform(rec);
  ctl = controller(api, platform);
});

afterEach(() => {
  cleanup();
  ctl.dispose();
  vi.useRealTimers();
});

describe('player screens on the fake server', () => {
  it('PIN: six digits, then the builder', async () => {
    await mount(null);
    expect(screen.getByRole('heading', { name: 'Битва с монстром' })).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Дальше' });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText('PIN игры'), { target: { value: '482913' } });
    expect(screen.getByLabelText('PIN игры')).toHaveValue('482 913');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    expect(screen.getByRole('heading', { name: 'Ваш персонаж' })).toBeInTheDocument();
  });

  it('builder: four parts; locked hats and colours shown locked and saying how they open', async () => {
    await mount();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Тело', 'Цвет', 'Глаза', 'Шапка']);
    fireEvent.click(screen.getByRole('tab', { name: 'Шапка' }));
    const crown = screen.getByRole('button', { name: 'Корона, закрыто: место в тройке' });
    expect(crown).toHaveAttribute('data-locked', 'true');
    expect(screen.getByRole('button', { name: 'Рожки, закрыто: оттаять 3 раза за игру' })).toBeInTheDocument();
    fireEvent.click(crown);
    expect(screen.getByText('Корона откроется: место в тройке.')).toBeInTheDocument();
    expect(crown).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Наушники' }));
    expect(screen.getByRole('button', { name: 'Наушники' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Цвет' }));
    expect(screen.getByRole('button', { name: 'Графит, закрыто: серия из 5 верных ответов' })).toBeInTheDocument();
    expect(rec.haptics).toEqual(['warning', 'select']);
  });

  it('lobby: «Вы в игре», the players, the PIN, the crowd and «Изменить персонажа»', async () => {
    await joinDemo();
    expect(screen.getByRole('heading', { name: 'Вы в игре' })).toBeInTheDocument();
    expect(screen.getByText('Играют 4')).toBeInTheDocument();
    expect(document.querySelector('.lp-row')?.textContent?.replace(/\u00a0/g, ' ')).toContain('PIN 482 913');
    // The crowd comes a frame after the screen (a transition).
    await until(() => document.querySelectorAll('.lp-crowd .lv-char').length === 3, 2000);
    expect(screen.getByRole('button', { name: 'Изменить персонажа' })).toBeInTheDocument();
  });

  it('countdown: the question and the options are there, the buttons wait; then they open', async () => {
    await joinDemo();
    await until(() => gameState() === 'countdown');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBeTruthy();
    expect(answers()).toHaveLength(4);
    expect(answers().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(document.querySelector('.lp-answers')).toHaveAttribute('data-wait', 'true');
    expect(document.querySelectorAll('.lp-cd > span')).toHaveLength(3);
    // The accessible name says the letter, the colour, the shape and the text.
    expect(answers()[0].getAttribute('aria-label')).toMatch(/^А, синий треугольник: .+/);
    expect(answers()[2].getAttribute('aria-label')).toMatch(/^В, зелёный круг: .+/);
    await until(() => answers().every((b) => b.getAttribute('aria-disabled') !== 'true'));
    expect(rec.haptics).toContain('go');
    expect(screen.getByText('Отвечайте быстрее — урон больше')).toBeInTheDocument();
  });

  it('a tap: «Ответ принят» at once, the chosen button stands out, the others fade', async () => {
    await joinDemo();
    await play('right');
    expect(screen.getByText('Ответ принят.')).toBeInTheDocument();
    const chosen = answers().filter((b) => b.dataset.look === 'chosen');
    expect(chosen).toHaveLength(1);
    expect(answers().filter((b) => b.dataset.look === 'dim')).toHaveLength(3);
    expect(answers().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(rec.haptics).toContain('tap');
  });

  it('right: «Верно», the damage, the streak and the time; the key marked; then the place', async () => {
    await joinDemo();
    await play('right');
    await until(() => gameState() === 'reveal');
    const sheet = document.querySelector('.lp-sheet') as HTMLElement;
    expect(within(sheet).getByRole('status').textContent).toBe('Верно');
    expect(within(sheet).getByText(/^−\d+$/)).toBeInTheDocument();
    expect(within(sheet).getByText('урона Дедлайну')).toBeInTheDocument();
    expect(within(sheet).getByText('Серия 1')).toBeInTheDocument();
    expect(sheet.textContent?.replace(/\u00a0/g, ' ')).toMatch(/\d,\d с/);
    expect(answers().find((b) => b.dataset.mark === 'key')?.getAttribute('aria-label')).toMatch(/, верный ответ$/);
    await tick(1500);
    expect(rec.haptics).toEqual(expect.arrayContaining(['success', 'hit']));
    await until(() => gameState() === 'leaderboard');
    expect(screen.getByText('Больше всех урона')).toBeInTheDocument();
    expect(screen.getByText(/^Вы \d+-й по урону из 4$/)).toBeInTheDocument();
    expect(document.querySelectorAll('.lp-top5 li').length).toBeGreaterThan(0);
  });

  it('wrong: «Неверно», the key in words, frozen; next question frozen; a right answer thaws', async () => {
    await joinDemo();
    await play('wrong');
    await until(() => gameState() === 'reveal');
    expect(screen.getByText('Неверно')).toBeInTheDocument();
    expect(screen.getByText(/^Верный ответ:/)).toBeInTheDocument();
    expect(screen.getByText('Дедлайн заморозил вас. Ответьте верно на следующий вопрос, чтобы оттаять.')).toBeInTheDocument();
    expect(answers().find((b) => b.dataset.mark === 'wrong')?.getAttribute('aria-label')).toMatch(/, ваш ответ, неверный$/);
    await tick(1500);
    expect(rec.haptics).toEqual(expect.arrayContaining(['error', 'freeze']));
    await until(() => gameState() === 'countdown');
    expect(screen.getByText('Вы заморожены. Ответьте верно, чтобы оттаять. Урона в этом вопросе не будет.')).toBeInTheDocument();
    await play('right');
    await until(() => gameState() === 'reveal');
    expect(screen.getByText('Верно — оттаяли')).toBeInTheDocument();
    expect(screen.getByText('Урона в этом вопросе нет: вы были заморожены. Со следующего вопроса бьёте как все.')).toBeInTheDocument();
  });

  it('the boss gets angry: the banner at the reveal, its rule at the next question', async () => {
    await joinDemo();
    let seen = false;
    for (let q = 0; q < 4 && !seen; q += 1) {
      await play('right');
      await until(() => gameState() === 'reveal');
      if (ctl.getSnapshot().state?.result?.phase_changed === 1) {
        await tick(2000);
        expect(screen.getByText('Дедлайн злится')).toBeInTheDocument();
        expect(screen.getByText('Теперь замораживает и тех, кто не успел ответить.')).toBeInTheDocument();
        await until(() => gameState() === 'countdown');
        expect(screen.getByText('Дедлайн злится: кто не успел — тоже замёрзнет.')).toBeInTheDocument();
        seen = true;
      }
      await until(() => gameState() === 'countdown' || gameState() === 'podium');
    }
    expect(seen).toBe(true);
  });

  it('victory: the final with the place, the unlock, «Разбор ошибок» and «Поделиться»', async () => {
    await joinDemo();
    for (let q = 0; q < 6; q += 1) {
      await until(() => gameState() === 'countdown' || gameState() === 'podium');
      if (gameState() === 'podium') break;
      await play('right');
      await until(() => gameState() === 'reveal');
    }
    await until(() => gameState() === 'podium');
    expect(screen.getByRole('heading', { name: 'Дедлайн повержен' })).toBeInTheDocument();
    expect(screen.getByText('Новая шапка: корона')).toBeInTheDocument();
    expect(screen.getByText(/За место в тройке\. Чтобы открытое оставалось у вас/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    });
    expect(rec.shares).toHaveLength(1);
    expect(rec.shares[0]).toMatchObject({ title: 'Дедлайн повержен', url: 'https://ludosiel-studyforge.hf.space/' });
    expect(rec.shares[0].text).toMatch(/^\d+-е место из 4, урон \d+, верных ответов \d из \d\.$/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Разбор ошибок' }));
    });
    expect(screen.getByRole('heading', { name: 'Разбор' })).toBeInTheDocument();
    expect(document.querySelectorAll('.lp-rv-item').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ваш ответ, верный').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Назад к итогу' }));
    expect(screen.getByRole('heading', { name: 'Дедлайн повержен' })).toBeInTheDocument();
  });

  it('no answer in the first questions: «Не успели» and the streak starts again', async () => {
    await joinDemo();
    await play('none');
    await until(() => gameState() === 'reveal', 40_000);
    expect(screen.getByText('Не успели')).toBeInTheDocument();
    expect(screen.getByText('Серия начнётся заново со следующего верного ответа.')).toBeInTheDocument();
  });

  it('a lost network: the line says so and goes when it is back', async () => {
    ctl.dispose();
    ctl = controller(obeyOffline(api), platform);
    await joinDemo();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Нет связи. Переподключаемся…');
    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await until(() => !document.querySelector('.lp-link'));
    online.mockRestore();
  });

  it('PIN: a wrong PIN is said on the PIN screen; the character comes only for a game that exists', async () => {
    await mount(null);
    fireEvent.change(screen.getByLabelText('PIN игры'), { target: { value: '111111' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    expect(screen.getByRole('alert').textContent?.replace(/\u00a0/g, ' ')).toBe('Игры с PIN 111 111 нет. Проверьте цифры у ведущего.');
    expect(screen.getByRole('heading', { name: 'Битва с монстром' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ваш персонаж' })).toBeNull();
  });

  it('after the tap, the wait: the answer\'s order, how many answered, the streak at stake', async () => {
    await joinDemo();
    await play('right');
    await until(() => !!document.querySelector('.lp-wait'));
    const wait = document.querySelector('.lp-wait') as HTMLElement;
    expect(wait.dataset.mode).toBe('answered');
    expect(wait.textContent).toMatch(/Ваш ответ пришёл (первым|вторым|третьим|\d+-м)/);
    expect(wait.textContent).toMatch(/Ответили \d из 4/);
    expect((wait.querySelector('.lp-wait__bar > i') as HTMLElement).style.transform).toMatch(/^scaleX\(/);
  });

  it('time up: «Время вышло» at once and the buttons wait; at the reveal the counter shows no number', async () => {
    await joinDemo();
    await play('none');
    await until(() => document.querySelector('.lp-wait')?.getAttribute('data-mode') === 'up', 40_000);
    expect(gameState()).toBe('open');
    expect(document.querySelector('.lp-wait__h')?.textContent).toBe('Время вышло');
    expect(screen.getByText('В этот раз без ответа')).toBeInTheDocument();
    expect(document.querySelector('.lp-sec')?.textContent).toBe('0');
    expect(answers().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    await until(() => gameState() === 'reveal');
    expect(document.querySelector('.lp-sec')?.textContent).toBe('');
    // The class's result, not a call to answer faster.
    expect(document.querySelector('.lp-me-text')?.textContent).toMatch(/^Верно ответили \d из 4$/);
  });

  it('the late joiner\'s reveal: no verdict for a question they could not answer', async () => {
    const other = controller(api, recordingPlatform(newRecorder()));
    await act(async () => {
      await other.start({ pin: '482913' });
      other.setName('Лена');
      await other.confirm();
    });
    await until(() => other.getSnapshot().state?.state === 'open');
    window.sessionStorage.clear();
    await joinDemoAny();
    await until(() => gameState() === 'reveal', 40_000);
    const sheet = document.querySelector('.lp-sheet') as HTMLElement;
    expect(sheet.classList.contains('lp-sheet--seen')).toBe(true);
    expect(within(sheet).getByRole('status').textContent).toBe('Следующий\u00a0— ваш');
    expect(screen.queryByText('Не успели')).toBeNull();
    other.dispose();
  });

  it('joined during a question: one plain line, every button waits, a tap does nothing, no passing line', async () => {
    const other = controller(api, recordingPlatform(newRecorder()));
    await act(async () => {
      await other.start({ pin: '482913' });
      other.setName('Лена');
      await other.confirm();
    });
    await until(() => other.getSnapshot().state?.state === 'open');
    window.sessionStorage.clear();
    await joinDemoAny();
    await until(() => gameState() === 'open');
    expect(screen.getByText(/^Вы вошли во время вопроса/).parentElement?.textContent?.replace(/\u00a0/g, ' ')).toBe('Вы вошли во время вопроса — играете со следующего');
    expect(answers().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    await act(async () => {
      fireEvent.click(answers()[0]);
    });
    expect(ctl.getSnapshot().pick).toBeNull();
    expect(document.querySelector('.lp-notice')).toBeNull();
    expect(screen.queryByText(/Ответ не успел/)).toBeNull();
    other.dispose();
  });

  it('the place after a question says the gap to the next one up', async () => {
    await joinDemo();
    await play('right');
    await until(() => gameState() === 'leaderboard');
    expect(document.querySelector('.lp-place__gap')?.textContent).toMatch(/впереди/i);
  });

  it('ended by the host mid-game: «Игра закончилась», the damage and place, «Разбор», «Войти по PIN»', async () => {
    await joinDemo();
    await play('right');
    await until(() => gameState() === 'reveal');
    await until(() => gameState() === 'countdown');
    const g = api.peek(ctl.getSnapshot().game!.id)!;
    await act(async () => {
      await api.end(g.id, g.hostToken);
    });
    await until(() => gameState() === 'ended');
    expect(screen.getByRole('heading', { name: 'Игра закончилась' })).toBeInTheDocument();
    expect(screen.queryByText('Ждём ведущего…')).toBeNull();
    await until(() => /1\s+из\s+1/.test(document.querySelector('.lp-stats3')?.textContent ?? ''));
    expect(document.querySelector('.lp-stats3')?.textContent).toMatch(/урона/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Разбор' }));
    });
    expect(screen.getByRole('heading', { name: 'Разбор' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад к итогу' }));
    expect(screen.getByRole('heading', { name: 'Игра закончилась' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Войти по PIN' }));
    expect(screen.getByRole('heading', { name: 'Битва с монстром' })).toBeInTheDocument();
  });

  it('ended by the host in the lobby: «Игра закончилась», no review to open', async () => {
    await joinDemo();
    const g = api.peek(ctl.getSnapshot().game!.id)!;
    await act(async () => {
      await api.end(g.id, g.hostToken);
    });
    await until(() => gameState() === 'ended');
    expect(screen.getByRole('heading', { name: 'Игра закончилась' })).toBeInTheDocument();
    expect(screen.getByText('Ведущий закончил игру до первого вопроса.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Разбор' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Войти по PIN' })).toBeInTheDocument();
  });

  it('a passing line and the lost network sit together over the boss\'s row, not over the answers', async () => {
    ctl.dispose();
    ctl = controller(obeyOffline(api), platform);
    await joinDemo();
    await until(() => gameState() === 'countdown' || gameState() === 'open');
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    const float = document.querySelector('.lp-float') as HTMLElement;
    expect(float).not.toBeNull();
    expect(float.querySelector('.lp-link')).toHaveTextContent('Нет связи. Переподключаемся…');
    expect(document.querySelector('.lp-answers .lp-link, .lp-answers .lp-notice')).toBeNull();
    online.mockRestore();
  });
});

describe('the final', () => {
  const look = defaultLook('Дима');
  const row = (id: string, name: string, dmg: number): TopRow => ({ player_id: id, name, look: defaultLook(name), dmg, move: 0 });
  const top = [row('a', 'Миша', 764), row('me', 'Дима', 632), row('c', 'Аня', 630), row('d', 'Даша', 625)];
  const final = (over: Partial<FinalData> = {}): FinalData => ({ won: true, place: 2, dmg: 632, best: 5, right: 6, accuracy_pct: 73, unlocked_now: [], ...over });
  function show(f: FinalData, p: PlayerPlatform, guest = true) {
    render(
      <Final
        ctl={ctl}
        platform={p}
        final={f}
        boss={{ hp: 0, hp_max: 1000, phase: 2, defeated: true }}
        look={look}
        players={23}
        asked={7}
        guest={guest}
        top={top}
        meId="me"
        gameId="g"
        token={() => 'T'.repeat(43)}
        shareUrl="https://ludosiel-studyforge.hf.space/play"
        haptic={() => undefined}
      />,
    );
  }

  it('the podium: 2nd · 1st · 3rd with the own step, the place big, damage, right answers, best streak', () => {
    show(final(), platform);
    const cols = Array.from(document.querySelectorAll('.lp-podium__col'));
    expect(cols.map((c) => c.getAttribute('data-place'))).toEqual(['2', '1', '3']);
    expect(cols.find((c) => c.getAttribute('data-me') === 'true')?.textContent).toContain('Вы');
    expect(screen.getByRole('img', { name: 'Тройка по урону: 1. Миша, 2. Дима (вы), 3. Аня' })).toBeInTheDocument();
    expect(document.querySelector('.lp-result__place')?.textContent).toBe('2-е местоиз 23 по урону');
    expect(document.querySelector('.lp-stats3')?.textContent?.replace(/\u00a0/g, ' ')).toBe('урона632верных6 из 7лучшая серия5');
    // No line starts with a dash: a no-break space before it.
    expect(document.querySelector('.lp-final__class')?.textContent).toBe('Верных ответов у класса\u00a0— 73\u00a0%.');
  });

  it('a web guest in the top three: the crown stays with an account, so the nudge is for the next game', () => {
    show(final(), { ...platform, kind: 'web' });
    expect(screen.getByText('За тройку даётся корона')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти в Meldy' })).toHaveAttribute('href', '/login?next=%2Fplay');
    cleanup();
    show(final({ place: 5 }), { ...platform, kind: 'web' });
    expect(screen.queryByText('За тройку даётся корона')).toBeNull();
    cleanup();
    show(final(), { ...platform, kind: 'telegram' }, false);
    expect(screen.queryByText('За тройку даётся корона')).toBeNull();
  });

  it('the share: plain words with the result, the site\'s /play, no token', async () => {
    show(final(), platform);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    });
    expect(rec.shares[0]).toMatchObject({ title: 'Дедлайн повержен', text: '2-е место из 23, урон 632, верных ответов 6 из 7.', url: 'https://ludosiel-studyforge.hf.space/play' });
  });
});

describe('the gap to the next place', () => {
  const r = (id: string, name: string, dmg: number): TopRow => ({ player_id: id, name, look: defaultLook(name), dmg, move: 0 });
  const top = [r('a', 'Лиза', 420), r('b', 'Илья', 300), r('me', 'Дима', 150), r('d', 'Аня', 150), r('e', 'Оля', 90)];
  it('names the one above (2nd to 6th), the lead when 1st, nothing further down', () => {
    expect(gapLine(top, { player_id: 'me', place: 3, dmg: 150 })).toBe('Илья впереди на\u00a0150 урона');
    expect(gapLine(top, { player_id: 'd', place: 4, dmg: 150 })).toBe('Дима впереди при равном уроне');
    expect(gapLine(top, { player_id: 'a', place: 1, dmg: 420 })).toBe('Впереди всех на\u00a0120 урона');
    expect(gapLine(top, { player_id: 'x', place: 6, dmg: 80 })).toBe('Оля впереди на\u00a010 урона');
    expect(gapLine(top, { player_id: 'y', place: 9, dmg: 10 })).toBeNull();
    expect(gapLine(null, { player_id: 'me', place: 3, dmg: 150 })).toBeNull();
  });
});

describe('the player\'s styles', () => {
  // Vitest stubs CSS imports (even ?raw): the file is read from disk (Node's fs; the app has no Node types).
  let css = '';
  beforeAll(async () => {
    const fsName = 'node:fs';
    const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(path: string, encoding: string): string };
    const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
    css = fs.readFileSync(`${cwd}/src/components/live/player/player.css`, 'utf8');
  });

  it('animates only transform and opacity', () => {
    const keyframes = css.match(/@keyframes[^{]+\{([\s\S]*?\}\s*)\}/g) ?? [];
    expect(keyframes.length).toBeGreaterThan(5);
    for (const block of keyframes) {
      const props = Array.from(block.matchAll(/([a-z-]+)\s*:/g)).map((m) => m[1]);
      for (const p of props) expect(['transform', 'opacity']).toContain(p);
    }
    const transitions = Array.from(css.matchAll(/transition:\s*([^;]+);/g)).map((m) => m[1]);
    for (const t of transitions) for (const part of t.split(',')) expect(part.trim().split(/\s+/)[0]).toMatch(/^(transform|opacity|none)$/);
  });

  it('the passing line is not pinned to the bottom (it covered the 4th answer)', () => {
    expect(css).not.toMatch(/\.lp-notice \{[^}]*bottom:/);
    expect(css).toMatch(/\.lp-float \{[^}]*top:/);
  });

  it('buttons are 56 px or more; reduced motion stills everything', () => {
    expect(css).toMatch(/\.lp-btn \{[^}]*min-height: 56px/);
    expect(css).toMatch(/\.lp-ans \{[^}]*min-height: clamp\(60px/);
    expect(css).toMatch(/\.lp-opt \{[^}]*min-height: 56px/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
