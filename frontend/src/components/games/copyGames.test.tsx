import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CHASE_NAME, GAMES, GAMES_PATH, PLAY_PATH } from './copyGames';
import TodayGames from './TodayGames';
import { MODE } from '../live/host/copy';
import { STAND } from '../live/stand/copy';

afterEach(cleanup);

/** Every sentence a person reads on «Игры», the picker and the row on «Сегодня». */
function sentences(): string[] {
  const texts = [GAMES.lede, GAMES.hero.text, GAMES.modesNote, GAMES.pick.lede, GAMES.pick.empty, GAMES.today.text, ...GAMES.modes.map((mode) => mode.text)];
  return texts.flatMap((text) => text.split(/(?<=[.?])\s+/));
}

describe('the words of «Игры» (the plain-words rules of 21.10)', () => {
  it('name the games and the buttons as the game itself does', () => {
    expect(GAMES.modes.map((mode) => mode.name)).toEqual([MODE.name, STAND.name, CHASE_NAME]);
    expect(CHASE_NAME).toBe('Убеги от Дедлайна');
    // The quick test's door says what its own page says.
    expect(GAMES.pick.quick).toBe('Быстрая контрольная');
    expect(GAMES_PATH).toBe('/games');
    expect(PLAY_PATH).toBe('/play');
  });

  it('are short plain sentences: no «!», no dashes between words, no colons, no «не X, а Y», no slogans', () => {
    for (const sentence of sentences()) {
      expect(sentence, sentence).not.toMatch(/!|\s—\s|:|…/);
      expect(sentence, sentence).not.toMatch(/\bне [а-яё]+, а\b/i);
      expect(sentence, sentence).not.toMatch(/уникальн|невероятн|революц|магия|легко и просто|в один клик/i);
      expect(sentence.length, sentence).toBeLessThanOrEqual(130);
    }
  });
});

describe('the row on «Сегодня» on a phone', () => {
  it('leads to «Игры» and, one tap away, to the game by its code', () => {
    render(
      <MemoryRouter>
        <TodayGames />
      </MemoryRouter>,
    );
    const row = screen.getByRole('group', { name: 'Игры' });
    expect(within(row).getByRole('link', { name: /Игры.*Игра на проекторе/ })).toHaveAttribute('href', '/games');
    expect(within(row).getByRole('link', { name: 'Войти по коду' })).toHaveAttribute('href', '/play');
    expect(within(row).getAllByRole('link')).toHaveLength(2);
    // No blue pill: the page's one is the exam's.
    expect(row.querySelector('.sf-primary')).toBeNull();
  });
});
