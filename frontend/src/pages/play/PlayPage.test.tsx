/** /play on the site: the PIN from the address or typed, kept in the address; no Telegram anything. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveApi } from '../../lib/live/api';
import { fakeApi, useGameClock } from '../../components/live/player/testkit';
import PlayPage from './PlayPage';

let where = '';
function Where() {
  const loc = useLocation();
  where = `${loc.pathname}${loc.search}`;
  return null;
}

async function open(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/play" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
}

beforeEach(() => {
  useGameClock();
  window.sessionStorage.clear();
  window.localStorage.clear();
  setLiveApi(fakeApi());
});

afterEach(() => {
  cleanup();
  setLiveApi(null);
  vi.useRealTimers();
});

describe('/play', () => {
  it('a link with the PIN opens the builder; the page is the game\'s', async () => {
    await open('/play?pin=482913');
    expect(screen.getByRole('heading', { name: 'Ваш персонаж' })).toBeInTheDocument();
    expect(document.title).toBe('Битва с монстром — Meldy');
    expect(document.documentElement).not.toHaveClass('tg-mode');
    expect(window.Telegram).toBeUndefined();
  });

  it('a typed PIN goes into the address (a reload comes back to it)', async () => {
    await open('/play?fake=1');
    fireEvent.change(screen.getByLabelText('PIN игры'), { target: { value: '482913' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    });
    expect(where).toBe('/play?fake=1&pin=482913');
    fireEvent.click(screen.getByRole('button', { name: 'Другой PIN' }));
    expect(screen.getByRole('heading', { name: 'Битва с монстром' })).toBeInTheDocument();
  });

  it('joins and keeps the token in this tab only (sessionStorage)', async () => {
    await open('/play?pin=482913');
    fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Дима' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByRole('heading', { name: 'Вы в игре' })).toBeInTheDocument();
    const keys = Object.keys(window.sessionStorage).filter((k) => k.startsWith('meldy.live.player.'));
    expect(keys).toHaveLength(1);
    expect(Object.keys(window.localStorage).some((k) => k.startsWith('meldy.live.player.'))).toBe(false);
  });
});
