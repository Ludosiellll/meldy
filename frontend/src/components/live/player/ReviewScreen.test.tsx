/** «Разбор» of a battle with movement rounds: a movement round says so, and the answer there is where one stood. */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerController } from './controller';
import { ReviewScreen } from './ReviewScreen';

afterEach(cleanup);

describe('the review of a mixed game', () => {
  it('marks the movement rounds: «Мини-игра», «вы стояли тут», «Не встали на ответ»', () => {
    const items = [
      { qi: 0, text: 'Кнопки', options: ['A', 'B'], key: 0, choice: 1, correct: false },
      { qi: 2, text: 'Арена', options: ['A', 'B', 'C'], key: 2, choice: 1, correct: false, stand: true },
      { qi: 5, text: 'Арена 2', options: ['A', 'B'], key: 0, choice: null, correct: false, stand: true },
    ];
    const view = render(<ReviewScreen ctl={{} as PlayerController} review={{ items }} error={null} standalone back="final" />);
    const li = view.container.querySelectorAll('.lp-rv-item');
    expect(li[0].textContent).not.toContain('Мини-игра');
    expect(li[0].textContent).toContain('ваш ответ');
    expect(li[1].querySelector('.lp-rv-mini')?.textContent).toBe('Мини-игра');
    expect(li[1].textContent).toContain('вы стояли тут');
    expect(li[2].textContent).toContain('Не встали на ответ');
    expect(view.container.querySelector('.lp-sub')?.textContent).toBe('Верно 0 из 3. Ключи\u00a0— только вопросов этой игры.');
  });
});
