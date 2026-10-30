/**
 * The projector with a real test's question (20261030090000_live_pictures.sql): five or six tiles with the letters Д and
 * Е and their shapes; the question's picture big over the arena while the class counts down, then beside the tiles, big
 * again on a click; an option's picture in its tile. And the fake server's pictures: only once the question was shown.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeServer, fakePicture, PICTURE_QUESTIONS } from '../../../lib/live/fake';
import type { Question } from '../../../lib/live/types';
import { OPTION_STYLES, optionLabel } from '../player/options';
import { QuestionPanel } from './Panel';

afterEach(cleanup);

const five: Question = {
  qi: 0,
  text: 'Какая связь между таблицами показана на схеме?',
  options: ['Один к одному', 'Один ко многим', 'Многие ко многим', 'Связи нет', 'Рекурсивная'],
  opens_at: '',
  closes_at: '',
  phase: 0,
  picture: null,
  pictures: { stem: ['c/er.png'], options: [[], [], [], [], ['c/loop.png']] },
};

function panel(extra: Partial<Parameters<typeof QuestionPanel>[0]> = {}) {
  const now = Date.now();
  return render(
    <QuestionPanel
      question={five}
      result={null}
      players={12}
      answered={0}
      opensAt={now + 3000}
      closesAt={now + 23000}
      pictures={{ stem: 'blob:er', options: [undefined, undefined, undefined, undefined, 'blob:loop'], any: true }}
      {...extra}
    />,
  );
}

describe('the question panel with a picture and five options', () => {
  it('five tiles with А…Д; the option\'s picture in its tile', () => {
    const view = panel({ countdown: true });
    const section = view.container.querySelector('.lvh-question')!;
    expect(section).toHaveAttribute('data-n', '5');
    expect(section).toHaveAttribute('data-pic');
    const tiles = [...view.container.querySelectorAll('.lvh-tile')];
    expect(tiles.map((t) => t.querySelector('.lvh-tile-badge b')?.textContent)).toEqual(['А', 'Б', 'В', 'Г', 'Д']);
    expect(tiles[4].querySelector('.lvh-tile-pic img')).toHaveAttribute('src', 'blob:loop');
    expect(tiles[0].querySelector('.lvh-tile-pic')).toBeNull();
  });

  it('big over the arena while the class counts down, beside the tiles once open; a click shows it big again', () => {
    const view = panel({ countdown: true });
    const stage = view.container.querySelector('.lvh-pic-stage')!;
    expect(stage).toHaveAttribute('data-on');
    expect(stage.querySelector('img')).toHaveAttribute('src', 'blob:er');
    view.rerender(
      <QuestionPanel
        question={five}
        result={null}
        players={12}
        answered={0}
        opensAt={Date.now()}
        closesAt={Date.now() + 20000}
        pictures={{ stem: 'blob:er', options: [undefined, undefined, undefined, undefined, 'blob:loop'], any: true }}
        countdown={false}
      />,
    );
    expect(view.container.querySelector('.lvh-pic-stage')).not.toHaveAttribute('data-on');
    const figure = screen.getByRole('button', { name: 'Рисунок к вопросу: показать крупно' });
    expect(figure.querySelector('img')).toHaveAttribute('src', 'blob:er');
    fireEvent.click(figure);
    expect(figure).toHaveAttribute('aria-pressed', 'true');
    expect(view.container.querySelector('.lvh-pic-stage')).toHaveAttribute('data-on');
    fireEvent.click(view.container.querySelector('.lvh-pic-stage')!);
    expect(view.container.querySelector('.lvh-pic-stage')).not.toHaveAttribute('data-on');
  });

  it('a picture that did not come says so in its place', () => {
    const view = panel({ pictures: { stem: false, options: [], any: true } });
    expect(view.container.querySelector('.lvh-q-figure')?.textContent).toBe('Рисунок не загрузился');
  });

  it('a question without pictures: the panel as before', () => {
    const view = panel({ question: { ...five, options: five.options.slice(0, 4), pictures: undefined }, pictures: { stem: undefined, options: [], any: false } });
    expect(view.container.querySelector('.lvh-question')).not.toHaveAttribute('data-pic');
    expect(view.container.querySelector('.lvh-pic-stage')).toBeNull();
    expect(view.container.querySelector('.lvh-q-figure')).toBeNull();
  });
});

describe('the phone\'s six options', () => {
  it('Д and Е with their own colour and shape; an option with a picture says so', () => {
    expect(OPTION_STYLES.map((o) => o.letter)).toEqual(['А', 'Б', 'В', 'Г', 'Д', 'Е']);
    expect(optionLabel(4, 'Рекурсивная')).toBe('Д, оранжевый пятиугольник: Рекурсивная');
    expect(optionLabel(5, 'CLEAR', true)).toBe('Е, фиолетовый шестиугольник: CLEAR, с рисунком');
  });
});

const DIMA = 'Dima'.padEnd(43, 'x');
const NOBODY = 'Nobody'.padEnd(43, 'y');

describe('the fake server\'s pictures', () => {
  it('drawn for fake paths only', () => {
    expect(fakePicture('fake:er')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(fakePicture('fake:nope')).toBeNull();
    expect(fakePicture('c/a.png')).toBeNull();
  });

  it('a picture only once its question was shown, and only for this game\'s host or players', async () => {
    const server = createFakeServer({ bots: 0, latencyMs: 0, demoPin: null, questions: PICTURE_QUESTIONS });
    const game = await server.create({ container_id: 'c', subject_ids: ['s'], count: 5 }, { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: false });
    await server.join(game.pin, 'Дима', DIMA, null);
    await expect(server.picture!(game.game_id, game.host_token, 'fake:er')).rejects.toThrow();
    await act(async () => {
      await server.next(game.game_id, game.host_token, 'lobby');
    });
    const host = await server.hostState(game.game_id, game.host_token);
    const q = 'question' in host ? host.question : null;
    expect(q?.pictures?.stem).toEqual(['fake:er']);
    expect(q?.options).toHaveLength(5);
    await expect(server.picture!(game.game_id, game.host_token, 'fake:er')).resolves.toMatch(/^data:image/);
    await expect(server.picture!(game.game_id, DIMA, 'fake:er')).resolves.toMatch(/^data:image/);
    await expect(server.picture!(game.game_id, NOBODY, 'fake:er')).rejects.toThrow();
    // the chart question has not been shown yet
    await expect(server.picture!(game.game_id, game.host_token, 'fake:down')).rejects.toThrow();
  });
});
