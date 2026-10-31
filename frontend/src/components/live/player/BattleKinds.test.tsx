/**
 * The phone's question of the new kinds (CONTRACT §3): ticks and «Ответить» for several right answers (the count is
 * said), a field and «Ответить» for a text answer; the reveal marks every right option, says «Частично верно» for a
 * share, and shows the accepted answer and the answers typed most often. The review of these kinds, with the author's
 * explanation and «Тренировать ошибки».
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerState, Question } from '../../../lib/live/types';
import { Battle } from './Battle';
import type { PlayerController } from './controller';
import { ReviewScreen } from './ReviewScreen';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const look = { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' } as const;

function stateOf(q: Question, over: Partial<PlayerState> = {}): PlayerState {
  return {
    rev: 5, now: new Date().toISOString(), state: 'open', mode: 'boss', qi: q.qi, q_count: 5, time_s: 20, speed: true, players: 4, answered: 0,
    question: q, boss: { hp: 900, hp_max: 1100, phase: 0, defeated: false }, top: null,
    me: { player_id: 'p1', name: 'Дима', look, dmg: 0, streak: 0, best: 0, frozen: false, place: 1, choice: null },
    result: null, final: null, crowd: null, ...over,
  };
}

function question(over: Partial<Question>): Question {
  const now = Date.now();
  return { qi: 1, text: 'Какие буквы гласные?', options: ['a', 'b', 'c', 'd'], opens_at: new Date(now - 2000).toISOString(), closes_at: new Date(now + 18000).toISOString(), phase: 0, picture: null, ...over };
}

function ctlStub() {
  return { answer: vi.fn(), answerPicks: vi.fn(), answerText: vi.fn(), picture: undefined } as unknown as PlayerController & {
    answer: ReturnType<typeof vi.fn>;
    answerPicks: ReturnType<typeof vi.fn>;
    answerText: ReturnType<typeof vi.fn>;
  };
}

function battle(ctl: PlayerController, st: PlayerState, pick: Parameters<typeof Battle>[0]['pick'] = null) {
  return render(<Battle ctl={ctl} st={st} question={st.question!} pick={pick} answered={null} hpFrom={null} frozenBefore={false} late={false} offsetMs={0} look={look} haptic={() => {}} />);
}

describe('several right answers', () => {
  it('ticks and «Ответить»: the count is said, a tap ticks, the set goes once', () => {
    const ctl = ctlStub();
    const q = question({ kind: 'multiple', multi: 2 });
    const view = battle(ctl, stateOf(q));
    expect(view.container.querySelector('.lp-multi')?.textContent).toBe('Верных: 2 — отметьте все');
    const send = view.getByRole('button', { name: 'Ответить' });
    expect(send).toHaveProperty('disabled', true);
    const opts = view.container.querySelectorAll('.lp-ans');
    fireEvent.click(opts[2]);
    fireEvent.click(opts[0]);
    fireEvent.click(opts[3]);
    fireEvent.click(opts[3]);
    expect(opts[0].getAttribute('aria-pressed')).toBe('true');
    expect(opts[3].getAttribute('aria-pressed')).toBe('false');
    expect(ctl.answer).not.toHaveBeenCalled();
    fireEvent.click(send);
    expect(ctl.answerPicks).toHaveBeenCalledWith([0, 2]);
  });

  it('at the phone\'s zero what is ticked goes by itself', () => {
    vi.useFakeTimers();
    const ctl = ctlStub();
    const now = Date.now();
    const q = question({ kind: 'multiple', multi: 2, opens_at: new Date(now - 18000).toISOString(), closes_at: new Date(now + 1000).toISOString() });
    const view = battle(ctl, stateOf(q));
    fireEvent.click(view.container.querySelectorAll('.lp-ans')[1]);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(ctl.answerPicks).toHaveBeenCalledWith([1]);
  });

  it('the reveal: every right option marked, the own wrong tick crossed, «Частично верно» with its share', () => {
    const ctl = ctlStub();
    const q = question({ kind: 'multiple', multi: 2 });
    const result = { qi: 1, key: 0, keys: [0, 2], counts: [3, 1, 2, 0], right: 1, healed: 0, phase_changed: null, correct: false, none: false, dmg: 49, thawed: false, frozen: false, picks: [0, 1], share: 0, typed: undefined };
    const view = battle(ctl, stateOf(q, { state: 'reveal', result: { ...result, picks: [2], share: 0.5 } }), { qi: 1, choice: -1, picks: [2], status: 'accepted', elapsedMs: 1000, order: 1 });
    const opts = view.container.querySelectorAll('.lp-ans');
    expect([...opts].map((o) => o.getAttribute('data-mark'))).toEqual(['key', null, 'key', null]);
    expect(view.container.querySelector('#lp-sheet-title')?.textContent).toBe('Частично верно');
    expect(view.container.querySelector('.lp-sheet')?.textContent).toContain('Верных отмечено: 1 из 2');
    expect(view.container.querySelector('.lp-sheet')?.textContent).toContain('−49');
    cleanup();
    const wrong = battle(ctl, stateOf(q, { state: 'reveal', result: { ...result, dmg: 0 } }), { qi: 1, choice: -1, picks: [0, 1], status: 'accepted', elapsedMs: 1000, order: 1 });
    expect([...wrong.container.querySelectorAll('.lp-ans')].map((o) => o.getAttribute('data-mark'))).toEqual(['key', 'wrong', 'key', null]);
    expect(wrong.container.querySelector('.lp-sheet')?.textContent).toContain('Верные ответы: А\u00a0·\u00a0a, В\u00a0·\u00a0c');
  });
});

describe('a text answer', () => {
  it('a field and «Ответить»; the text goes as typed', () => {
    const ctl = ctlStub();
    const q = question({ kind: 'short', options: [], text: 'Столица России?' });
    const view = battle(ctl, stateOf(q));
    expect(view.container.querySelectorAll('.lp-ans')).toHaveLength(0);
    const field = view.getByLabelText('Ваш ответ на вопрос');
    const send = view.getByRole('button', { name: 'Ответить' });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.change(field, { target: { value: 'Москва' } });
    fireEvent.click(send);
    expect(ctl.answerText).toHaveBeenCalledWith('Москва');
  });

  it('the reveal: what was typed, the accepted answer, the answers typed most often', () => {
    const ctl = ctlStub();
    const q = question({ kind: 'short', options: [], text: 'Столица России?' });
    const result = { qi: 1, key: -1, counts: [], right: 2, healed: 0, phase_changed: null, correct: false, none: false, dmg: 0, thawed: false, frozen: true, forms: ['Москва'], tops: [{ text: 'питер', n: 2, ok: false }, { text: 'москва', n: 1, ok: true }], typed: 'Питер' };
    const view = battle(ctl, stateOf(q, { state: 'reveal', result }), { qi: 1, choice: -1, text: 'Питер', status: 'accepted', elapsedMs: 900, order: 2 });
    const sheet = view.container.querySelector('.lp-sheet')!.textContent!;
    expect(sheet).toContain('Вы написали: «Питер»');
    expect(sheet).toContain('Верный ответ: Москва');
    expect(sheet).toContain('Чаще писали: «питер» 2 раза, «москва» 1 раз');
  });
});

describe('the review of the new kinds', () => {
  const items = [
    { qi: 0, text: 'Гласные?', options: ['a', 'b', 'c'], key: 0, choice: null, correct: false, kind: 'multiple' as const, keys: [0, 2], picks: [0], share: 0.5, explanation: 'a и c — гласные' },
    { qi: 1, text: 'Столица?', options: [], key: -1, choice: null, correct: false, kind: 'short' as const, forms: ['Москва', 'г. Москва'], typed: 'Питер' },
    { qi: 2, text: 'Один', options: ['x', 'y'], key: 1, choice: 1, correct: true },
  ];

  it('every right option, the own ticks, «Частично»; the text and the accepted forms; the explanation', () => {
    const view = render(<ReviewScreen ctl={{} as PlayerController} review={{ items }} error={null} standalone back="final" />);
    const li = view.container.querySelectorAll('.lp-rv-item');
    expect(li[0].querySelector('.lp-rv-badge')?.textContent).toBe('Частично');
    expect([...li[0].querySelectorAll('.lp-rv-opt')].map((o) => o.getAttribute('data-key'))).toEqual(['true', 'false', 'true']);
    expect(li[0].querySelector('.lp-rv-explain')?.textContent).toBe('Пояснениеa и c — гласные');
    expect(li[1].textContent).toContain('Вы написали: «Питер»');
    expect(li[1].textContent).toContain('Верный ответ: Москва, г. Москва');
    expect(li[2].querySelector('.lp-rv-explain')).toBeNull();
  });

  it('«Тренировать ошибки»: the count, the press, the sign-in way, done', () => {
    const practiceMistakes = vi.fn();
    const ctl = { practiceMistakes } as unknown as PlayerController;
    const view = render(<ReviewScreen ctl={ctl} review={{ items }} error={null} standalone back="final" practice={{ status: 'idle' }} signInHref="/login?next=x" />);
    expect(view.container.querySelector('.lp-rv-practice')?.textContent).toContain('2 вопроса вернутся в тренировку экзамена');
    fireEvent.click(view.getByRole('button', { name: 'Тренировать ошибки' }));
    expect(practiceMistakes).toHaveBeenCalled();
    view.rerender(<ReviewScreen ctl={ctl} review={{ items }} error={null} standalone back="final" practice={{ status: 'signin' }} signInHref="/login?next=x" />);
    expect(view.getByRole('link', { name: 'Войти и тренировать' }).getAttribute('href')).toBe('/login?next=x');
    view.rerender(<ReviewScreen ctl={ctl} review={{ items }} error={null} standalone back="final" practice={{ status: 'signin' }} signInHref={null} />);
    expect(view.container.querySelector('.lp-rv-practice')?.textContent).toContain('на сайте Meldy');
    view.rerender(<ReviewScreen ctl={ctl} review={{ items }} error={null} standalone back="final" practice={{ status: 'done', containerId: 'c-9', saved: 2 }} signInHref={null} />);
    expect(view.getByRole('link', { name: 'Открыть экзамен' }).getAttribute('href')).toBe('/exams/c/c-9');
  });
});
