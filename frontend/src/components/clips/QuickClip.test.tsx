import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StepClip from './StepClip';
import { STEP_CLIPS } from './index';
import { QUICK, QUICK_LINK, TESTS_VIEW } from '../quick/copyQuick';
import { STUDIO } from '../studio/copyStudio';

/* «Быстрая контрольная» as a how-to clip (UX audit of 21.10, P4): the teacher's first card of the first run. */

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the quick test’s clip', () => {
  it('shows the screens in their own words: the door, the questions found, the tap, the link', () => {
    const { container } = render(<StepClip clip={STEP_CLIPS.quick} active={false} />);
    const words = container.textContent ?? '';
    for (const word of [TESTS_VIEW.quick, TESTS_VIEW.studio, QUICK.title, QUICK.tapRight, QUICK.submit, QUICK_LINK.ready, QUICK_LINK.copy]) {
      expect(words).toContain(word);
    }
  });

  it('its lines are short and say what to press', () => {
    const captions = STEP_CLIPS.quick.steps.map((step) => step.caption);
    expect(captions).toEqual([
      'Откройте «Тесты» и нажмите «Быстрая контрольная».',
      'Вставьте вопросы из Word или из чата.',
      'Нажмите на верный вариант, если он не отмечен.',
      'Нажмите «Получить ссылку». Ссылка и QR-код готовы.',
    ]);
    for (const caption of captions) expect(caption).not.toMatch(/—|·/);
  });
});

describe('«Как ученик пишет» of the teacher’s first run', () => {
  it('starts at the student’s phone: the studio’s «Отправить по ссылке» is not the quick test’s way', () => {
    const captions = STEP_CLIPS.quizStudent.steps.map((step) => step.caption);
    expect(captions).toEqual(STEP_CLIPS.quizLink.steps.slice(1).map((step) => step.caption));
    expect(captions.join(' ')).not.toContain(STUDIO.send);
    expect(STEP_CLIPS.quizStudent.steps[0].at).toBe(0);
    expect(STEP_CLIPS.quizStudent.total).toBeLessThan(STEP_CLIPS.quizLink.total);
    for (const step of STEP_CLIPS.quizStudent.steps) expect(step.still).toBeLessThan(STEP_CLIPS.quizStudent.total);
  });
});
