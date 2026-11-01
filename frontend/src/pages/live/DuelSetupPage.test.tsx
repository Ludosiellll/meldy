/**
 * /live/duel (docs/live/DUEL.md): the setup of «Дуэль» from a finished challenge run or a game played in this tab — the
 * source's token is read on this device and sent in the body (never an item id, never the token in an address), the
 * name and the character, «Готово» creates the duel and opens /d/<code> with the device's new token kept for it.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDuelApi } from '../../lib/duel/api';
import { duelToken } from '../../lib/duel/token';
import { LiveError } from '../../lib/live/types';
import type { DuelApi, DuelState } from '../../lib/duel/types';
import { DSETUP } from '../../components/duel/copy';
import DuelSetupPage from './DuelSetupPage';

const RUN_TOKEN = 'R'.repeat(43);
const PLAYER_TOKEN = 'P'.repeat(43);

function made(code: string): DuelState {
  return {
    now: new Date().toISOString(),
    rev: 3,
    duel: { code, title: 'Т', q_count: 3, time_s: 20, speed: true, stage: 'lobby', qi: -1, round: 1, path: `/d/${code}`, url: '', expires_at: null, wait_until: null },
    me: { seat: 1, name: 'Лена', look: { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' }, dmg: 0, right: 0, streak: 0, best: 0, frozen: false, ready: false, next: false, rematch: false },
    other: null,
    question: null,
    answer: null,
    result: null,
    track: [],
    final: null,
    rematch: null,
    match: { round: 1, me: 0, other: 0, draws: 0 },
  };
}

function api(create: DuelApi['create']): DuelApi {
  const refuse = () => Promise.reject(new LiveError('unknown'));
  return { kind: 'fake', create, info: refuse, join: refuse, state: refuse, ready: refuse, answer: refuse, next: refuse, rematch: refuse, review: refuse, practice: refuse };
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/live/duel" element={<DuelSetupPage />} />
        <Route path="/d/:code" element={<p>Дуэль открыта</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  setDuelApi(null);
  cleanup();
});

describe('a duel on the questions of a finished challenge', () => {
  it('this browser has no run of it: it says where the duel opens', () => {
    mount('/live/duel?ch=abcdefghjkmn');
    expect(screen.getByRole('alert').textContent).toBe(DSETUP.noTokenChallenge);
  });

  it('the token of the run goes in the body; the new duel opens with its own token kept', async () => {
    window.localStorage.setItem('meldy.challenge.abcdefghjkmn', RUN_TOKEN);
    const create = vi.fn(async () => made('npqrstvwxyz2'));
    setDuelApi(api(create));
    mount('/live/duel?ch=abcdefghjkmn');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DSETUP.next }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Лена' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [source, settings, name, token] = create.mock.calls[0] as unknown as [unknown, unknown, string, string];
    expect(source).toEqual({ challenge: 'abcdefghjkmn', token: RUN_TOKEN });
    expect(settings).toEqual({});
    expect(name).toBe('Лена');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(RUN_TOKEN);
    expect(duelToken('npqrstvwxyz2')).toBe(token);
    expect(screen.getByText('Дуэль открыта')).toBeInTheDocument();
  });
});

describe('a duel on the questions of a game played in this tab', () => {
  it('the token of the player in this tab, «Без спешки» asked', async () => {
    window.sessionStorage.setItem('meldy.live.player.g-1', PLAYER_TOKEN);
    const create = vi.fn(async () => made('npqrstvwxyz3'));
    setDuelApi(api(create));
    mount('/live/duel?g=g-1');
    await act(async () => {
      fireEvent.click(screen.getAllByRole('radio', { name: DSETUP.on })[0]);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DSETUP.next }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Имя в игре'), { target: { value: 'Миша' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    });
    const [source, settings] = create.mock.calls[0] as unknown as [unknown, unknown];
    expect(source).toEqual({ game: 'g-1', token: PLAYER_TOKEN });
    expect(settings).toEqual({ calm: true, speed: false });
  });

  it('another tab: no token, no duel', () => {
    mount('/live/duel?g=g-2');
    expect(screen.getByRole('alert').textContent).toBe(DSETUP.noTokenGame);
  });
});
