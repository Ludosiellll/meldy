/**
 * «Дуэль» on its screens (/d/<code>) with a scripted server: no key and no answer of the other seat before the close
 * (only «ответил»), the reveal under the question with both verdicts and the marks of who picked what, the other seat's
 * rude text masked, the final («Победа», the cards, the plain link to the next round once both pressed «Ещё раз»), the
 * lobby's invite with the link and the QR, the wait for a seat away, «Места заняты».
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveError } from '../../lib/live/types';
import { dropDuelToken } from '../../lib/duel/token';
import type { DuelApi, DuelState } from '../../lib/duel/types';
import { DuelApp } from './DuelApp';
import { DuelController } from './controller';
import { DU } from './copy';

const CODE = 'abcdefghjkmn';
const NEXT = 'npqrstvwxyz2';
const TOKEN = 'T'.repeat(43);
const look = { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' } as const;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const plain = (t: string | null | undefined) => (t ?? '').replace(/ /g, ' ');

function base(): DuelState {
  return {
    now: iso(0),
    rev: 7,
    duel: { code: CODE, title: 'Базы данных', q_count: 3, time_s: 20, speed: true, stage: 'play', qi: 0, round: 1, path: `/d/${CODE}`, url: `https://x/d/${CODE}`, expires_at: null, wait_until: null },
    me: { seat: 1, name: 'Аня', look: { ...look }, dmg: 0, right: 0, streak: 0, best: 0, frozen: false, ready: true, next: false, rematch: false },
    other: { seat: 2, name: 'Боря', look: { ...look }, dmg: 0, right: 0, streak: 0, frozen: false, ready: true, present: true, answered: true, next: false, rematch: false },
    question: { qi: 0, text: 'Какая команда отменяет транзакцию?', options: ['COMMIT', 'ROLLBACK', 'GRANT', 'SAVEPOINT'], shown_at: iso(-5000), opens_at: iso(-2000), closes_at: iso(18000) },
    answer: { choice: 0, elapsed_ms: 1500 },
    result: null,
    track: [],
    final: null,
    rematch: null,
    match: { round: 1, me: 0, other: 0, draws: 0 },
  };
}

function scripted(st: DuelState, over: Partial<DuelApi> = {}): DuelApi {
  const refuse = () => Promise.reject(new LiveError('unknown'));
  return {
    kind: 'fake',
    create: refuse,
    info: refuse,
    join: refuse,
    state: async () => st,
    ready: refuse,
    answer: refuse,
    next: refuse,
    rematch: refuse,
    review: refuse,
    practice: refuse,
    ...over,
  };
}

async function mount(st: DuelState, over: Partial<DuelApi> = {}, moveTo = vi.fn()) {
  window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
  const ctl = new DuelController({ api: scripted(st, over), moveTo, route: () => 'direct' });
  const view = render(
    <MemoryRouter>
      <DuelApp ctl={ctl} signInHref="/login" exitHref="/games" />
    </MemoryRouter>,
  );
  await act(async () => {
    await ctl.start(CODE);
  });
  return { ctl, view, moveTo };
}

beforeEach(() => {
  window.localStorage.clear();
  dropDuelToken(CODE);
  dropDuelToken(NEXT);
});
afterEach(() => {
  cleanup();
});

describe('a question before its close', () => {
  it('shows the own answer, the other seat only as «ответил», no key and no reveal', async () => {
    const { view, ctl } = await mount(base());
    const text = plain(view.container.textContent);
    expect(screen.getByRole('heading', { name: 'Какая команда отменяет транзакцию?' })).toBeInTheDocument();
    expect(text).toContain(DU.q.sent);
    expect(text).toContain(DU.q.otherAnswered);
    expect(text).not.toContain('Верный ответ');
    expect(view.container.querySelector('.du-reveal')).toBeNull();
    expect(view.container.querySelector('.lp-ans[data-mark]')).toBeNull();
    expect(view.container.querySelector('.du-track li[data-mark="now"]')).not.toBeNull();
    expect(view.container.querySelector('.du-tag')).toBeNull();
    // both names and scores on the board, the other seat facing this one
    expect(view.container.querySelectorAll('.du-side')).toHaveLength(2);
    expect(view.container.querySelector('.du-side[data-side="other"] .du-face-left')).not.toBeNull();
    ctl.dispose();
  });
});

describe('the reveal', () => {
  it('sits under the question: both verdicts, the key, who picked what', async () => {
    const st = base();
    st.question = { ...st.question!, closed_at: iso(-500), reveal_until: iso(6500) };
    st.answer = { choice: 0, elapsed_ms: 1500 };
    st.result = {
      qi: 0,
      key: 1,
      explanation: 'ROLLBACK отменяет транзакцию.',
      me: { correct: false, none: false, dmg: 0, thawed: false, frozen: true, elapsed_ms: 1500, share: 0, choice: 0 },
      other: { correct: true, none: false, dmg: 96, thawed: false, frozen: false, elapsed_ms: 2400, share: 1, choice: 1 },
    };
    st.other!.dmg = 96;
    st.track = [{ qi: 0, me: 'wrong', other: 'right', me_dmg: 0, other_dmg: 96 }];
    const { view, ctl } = await mount(st);
    const reveal = view.container.querySelector('.du-reveal')!;
    expect(reveal).not.toBeNull();
    // not a sheet over the options: inside the question's column, after the answers
    expect(reveal.closest('.du-main')).not.toBeNull();
    expect(reveal.compareDocumentPosition(view.container.querySelector('.du-answers')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(view.container.querySelector('.lp-sheet')).toBeNull();
    const text = plain(reveal.textContent);
    expect(text).toContain(`${DU.reveal.wrong} · ${DU.reveal.frozen}`);
    expect(text).toContain(DU.reveal.right);
    expect(text).toContain('+96');
    expect(text).toContain('Верный ответ: Б · ROLLBACK');
    expect(text).toContain('ROLLBACK отменяет транзакцию.');
    expect(plain(view.container.querySelector('.lp-ans[data-mark="key"]')?.textContent)).toContain('ROLLBACK');
    expect(plain(view.container.querySelector('.lp-ans[data-mark="wrong"]')?.textContent)).toContain('COMMIT');
    expect(plain(view.container.querySelector('.du-tag[data-who="me"]')?.textContent)).toBe(DU.reveal.mine);
    expect(plain(view.container.querySelector('.du-tag[data-who="other"]')?.textContent)).toBe(DU.reveal.theirs('Боря'));
    expect(screen.getByRole('button', { name: DU.reveal.next })).toBeInTheDocument();
    expect(view.container.querySelectorAll('.du-track li[data-mark="right"]')).toHaveLength(1);
    ctl.dispose();
  });

  it('the rude text of the other seat comes masked: «ответ скрыт»', async () => {
    const st = base();
    st.question = { qi: 0, kind: 'short', text: 'Столица России', options: [], shown_at: iso(-5000), opens_at: iso(-2000), closes_at: iso(-100), closed_at: iso(-50), reveal_until: iso(6900) };
    st.answer = { typed: 'Москва', elapsed_ms: 1500 };
    st.result = {
      qi: 0,
      key: -1,
      kind: 'short',
      forms: ['Москва'],
      me: { correct: true, none: false, dmg: 97, thawed: false, frozen: false, elapsed_ms: 1500, share: 1, typed: 'Москва' },
      other: { correct: false, none: false, dmg: 0, thawed: false, frozen: true, elapsed_ms: 3000, share: 0, masked: true },
    };
    const { view, ctl } = await mount(st);
    const text = plain(view.container.querySelector('.du-reveal')?.textContent);
    expect(text).toContain(DU.reveal.masked);
    expect(text).toContain('«Москва»');
    ctl.dispose();
  });
});

describe('the wait and the final', () => {
  it('a seat away between questions: the minute it has', async () => {
    const st = base();
    st.duel = { ...st.duel, stage: 'wait', wait_until: iso(45_000) };
    st.question = { ...st.question!, closed_at: iso(-20_000), reveal_until: iso(-13_000) };
    st.other!.present = false;
    st.result = { qi: 0, key: 1, me: null, other: null };
    const { view, ctl } = await mount(st);
    const wait = view.container.querySelector('.du-wait')!;
    expect(plain(wait.textContent)).toContain(DU.wait.title);
    expect(plain(wait.textContent)).toMatch(/Осталось 0:4[45]/);
    expect(plain(view.container.querySelector('.du-side[data-side="other"]')?.textContent)).toContain(DU.lobby.away);
    ctl.dispose();
  });

  it('«Победа», both cards, «Разбор и ошибки», «Ещё раз», «Выйти»', async () => {
    const st = base();
    st.duel = { ...st.duel, stage: 'final' };
    st.final = { reason: 'done', ended_at: iso(0), winner: 'me' };
    st.rematch = { me: false, other: true, code: null, round: 2, possible: true };
    st.me.dmg = 210;
    st.me.right = 3;
    st.other!.dmg = 120;
    st.track = [0, 1, 2].map((qi) => ({ qi, me: 'right' as const, other: 'wrong' as const, me_dmg: 70, other_dmg: 40 }));
    const { view, ctl } = await mount(st);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DU.final.won);
    expect(view.container.querySelectorAll('.du-card')).toHaveLength(2);
    expect(plain(view.container.querySelector('.du-card[data-won]')?.textContent)).toContain('210');
    expect(screen.getByRole('button', { name: DU.final.review })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DU.final.again })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: DU.final.exit })).toHaveAttribute('href', '/games');
    expect(plain(view.container.textContent)).toContain(DU.final.againOther);
    ctl.dispose();
  });

  it('both pressed «Ещё раз»: a plain link to the next duel, and the move', async () => {
    const st = base();
    st.duel = { ...st.duel, stage: 'final' };
    st.final = { reason: 'done', ended_at: iso(0), winner: null };
    st.me.rematch = true;
    st.other!.rematch = true;
    st.rematch = { me: true, other: true, code: NEXT, round: 2, possible: true };
    const { moveTo, ctl } = await mount(st);
    expect(moveTo).toHaveBeenCalledWith(NEXT);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DU.final.draw);
    expect(screen.getByRole('link', { name: `/d/${NEXT}` })).toHaveAttribute('href', `/d/${NEXT}`);
    ctl.dispose();
  });

  it('the one who left: «Поражение» and why', async () => {
    const st = base();
    st.duel = { ...st.duel, stage: 'final' };
    st.final = { reason: 'left', ended_at: iso(0), winner: 'other' };
    st.rematch = { me: false, other: false, code: null, round: 2, possible: true };
    const { view, ctl } = await mount(st);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DU.final.lost);
    expect(plain(view.container.textContent)).toContain(DU.final.reason.leftLost);
    ctl.dispose();
  });
});

describe('the lobby and a full link', () => {
  it('alone in the lobby: the invite link, the QR, «Готов»', async () => {
    const st = base();
    st.duel = { ...st.duel, stage: 'lobby', qi: -1, expires_at: iso(86_000_000) };
    st.other = null;
    st.question = null;
    st.answer = null;
    st.me.ready = false;
    const { view, ctl } = await mount(st);
    expect(screen.getByRole('heading', { name: DU.lobby.invite })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR-код ссылки' })).toBeInTheDocument();
    expect(plain(view.container.querySelector('.du-link')?.textContent)).toContain(`/d/${CODE}`);
    expect(screen.getByRole('button', { name: DU.lobby.ready })).toBeEnabled();
    ctl.dispose();
  });

  it('«Места заняты» for a third device', async () => {
    const info = { code: CODE, title: 'Базы данных', q_count: 3, time_s: 20, speed: true, stage: 'lobby' as const, round: 1, players: [], full: true };
    const ctl = new DuelController({ api: scripted(base(), { info: async () => info }) });
    render(
      <MemoryRouter>
        <DuelApp ctl={ctl} signInHref="/login" exitHref="/" />
      </MemoryRouter>,
    );
    await act(async () => {
      await ctl.start(CODE);
    });
    expect(screen.getByRole('heading', { name: DU.full.title })).toBeInTheDocument();
    ctl.dispose();
  });
});
