/**
 * The author's «Соревнования по ссылке» on «Игры» and the test's page: each row says whether it is open (until when) or
 * over, how many finished and play now, and who leads, and opens the challenge's page; nothing while the server has no
 * such list (a site ahead of its database).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setChallengeApi } from '../../lib/challenge/api';
import type { ChallengeApi, MineItem } from '../../lib/challenge/types';
import { LiveError } from '../../lib/live/types';
import ChallengeList, { challengeMeta } from './ChallengeList';
import { CLIST } from './copyAuthor';

afterEach(() => {
  cleanup();
  setChallengeApi(null);
});
const look = { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' } as const;
const item = (over: Partial<MineItem>): MineItem => ({
  code: 'k7m2p9q4r8st', title: 'Базы данных', q_count: 5, time_s: 20, speed: true, deadline: '2026-11-03T20:59:00.000Z', state: 'open', over: null,
  finished: 3, playing: 1, challenge_id: 'ch1', container_id: 'c1', path: '/s/k7m2p9q4r8st', created_at: '2026-10-31T10:00:00.000Z',
  leader: { name: 'Аня', look, dmg: 512 }, ...over,
});

async function mount(mine: ChallengeApi['mine'], props: { showEmpty?: boolean } = {}) {
  setChallengeApi({ kind: 'fake', mine } as unknown as ChallengeApi);
  const view = render(
    <MemoryRouter>
      <ChallengeList {...props} />
    </MemoryRouter>,
  );
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  return view;
}

describe('the list of challenges', () => {
  it('rows: open until, finished, playing, the leader; each to its page', async () => {
    await mount(vi.fn(async () => [item({}), item({ challenge_id: 'ch2', title: 'Сети', state: 'over', over: 'deadline', playing: 0, leader: null, finished: 0 })]));
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/live/challenge/ch1', '/live/challenge/ch2']);
    expect(links[0].textContent).toContain('прошли 3 · играют 1 · первое место: Аня');
    expect(links[1].textContent).toContain(`${CLIST.over} · прошли 0`);
  });

  it('says what the section is for when there is none yet, and shows nothing without the server’s list', async () => {
    const empty = await mount(vi.fn(async () => []), { showEmpty: true });
    expect(empty.container.textContent).toContain(CLIST.empty);
    cleanup();
    const quiet = await mount(vi.fn(async () => []));
    expect(quiet.container.textContent).toBe('');
    cleanup();
    const missing = await mount(vi.fn(async () => Promise.reject(new LiveError('unknown', 'PGRST202', 404))), { showEmpty: true });
    expect(missing.container.textContent).toBe('');
  });

  it('the meta line in words', () => {
    expect(challengeMeta(item({ playing: 0, leader: null })).replace(/\u00a0/g, ' ')).toMatch(/^открыто до 3 ноября, \d\d:\d\d · прошли 3$/);
  });
});
