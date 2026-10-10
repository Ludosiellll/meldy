import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GuideClip from './GuideClip';
import { GUIDE_CLIPS } from './clips';
import { GUIDE_CHAPTERS } from './chapters';
import { CLIP, EX, EXAMS_CLIP, EXAMS_EXAMPLE, EXAMS_PLAN, EXAMS_QUESTION } from './scenes';
import { daysAhead, planDay } from '../../lib/containers/plan';
import { dayRowText, shownMinutes, startLabel } from '../../lib/containers/words';
import { minutesLines } from '../containers/import/minutesLines';
import { titleText } from '../containers/planLines';
import { metaDay } from '../containers/model';
import * as copy from '../containers/copy';
import { IMPORT, KEY_WORDS } from '../containers/copyImport';
import type { PlanInput } from '../../types/container';

/* The guide's «Экзамены» clip: the exam as a new student meets it, from «Новый экзамен» to the first answer. */

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const NB = '\u00a0';
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const stage = () => document.querySelector('.gd-stage') as HTMLElement;
const one = (name: string) => document.querySelector(`[data-a="${name}"]`) as HTMLElement;
const all = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-a="${name}"]`));
const seen = (el: HTMLElement) => el.style.opacity === '1';
const gone = (el: HTMLElement) => el.style.opacity === '0';

/** The example file as the plan engine gets it after «Сохранить»: 400 questions of one subject with a key, nothing answered. */
function exampleInput(): PlanInput {
  const subjectId = 'subj-micro';
  return {
    v: 1,
    now: Date.parse(`${EXAMS_EXAMPLE.today}T12:00:00+03:00`),
    tz: 'Europe/Minsk',
    containerId: 'c-example',
    budgetMin: EXAMS_EXAMPLE.minutes,
    studyWeekdays: 127,
    firstPlanDay: EXAMS_EXAMPLE.today,
    subjects: [{ id: subjectId, title: EXAMS_EXAMPLE.subject, date: EXAMS_EXAMPLE.date }],
    items: Array.from({ length: EXAMS_EXAMPLE.questions }, (_, i) => ({ id: `q${i + 1}`, s: subjectId, f: 't' as const, tp: 1, o: i + 1 })),
    today: { firstAt: null, doneSec: 0, newDone: {} },
    pace: null,
    ai: null,
    examQuestions: EXAMS_EXAMPLE.questions,
  };
}

/** The clip frozen for export: `seek` moves it to a moment. */
function renderExport() {
  window.__MELDY_GUIDE_EXPORT__ = true;
  render(<GuideClip chapter="exams" active />);
  return (t: number) => {
    void window.__meldyGuideClip?.seek(t);
  };
}

beforeEach(() => {
  // jsdom lays nothing out: the box is 480 px wide here.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
  stubReducedMotion(false);
});
afterEach(() => {
  cleanup();
  delete window.__MELDY_GUIDE_EXPORT__;
  vi.unstubAllGlobals();
});

describe('the «Экзамены» clip', () => {
  it('is the chapter’s, longer than the others: three screens, from the file to the first answer', () => {
    expect(GUIDE_CHAPTERS.find((chapter) => chapter.id === 'exams')!.title).toBe('Экзамены');
    const clip = GUIDE_CLIPS.exams;
    expect(clip.total).toBe(EXAMS_CLIP);
    expect(clip.total).toBeGreaterThan(CLIP);
    expect(GUIDE_CLIPS.today.total).toBe(CLIP);
    // The still frame: «План по дням» open with every row in, before it goes.
    expect(clip.poster).toBeGreaterThan(EX.days + 330 + 4 * 100 + 380);
    expect(clip.poster).toBeLessThan(EX.daysOut);
    expect(clip.poster).toBeLessThan(clip.total - 760);
  });

  it('plays on the 4:3 stage scaled to the box, every word the screens’ own', () => {
    render(<GuideClip chapter="exams" active />);
    expect(stage()).toHaveAttribute('aria-hidden', 'true');
    expect(stage().style.transform).toBe(`scale(${480 / 1440})`);
    const words = plain(stage().textContent);
    // «Новый экзамен»: the drop card, the drop, the reading, what was found and the key, the date and the minutes.
    for (const line of [
      IMPORT.title,
      IMPORT.dropTitle,
      IMPORT.dropLede,
      IMPORT.pick,
      IMPORT.dropping,
      IMPORT.reading(1),
      IMPORT.readingWait,
      IMPORT.found(1, EXAMS_EXAMPLE.questions),
      `${IMPORT.rowTest(EXAMS_EXAMPLE.questions)} · ${KEY_WORDS.bold}`,
      IMPORT.date,
      EXAMS_EXAMPLE.dateField,
      IMPORT.minutes,
      IMPORT.minuteOption(EXAMS_EXAMPLE.minutes),
      IMPORT.save,
      IMPORT.saving,
    ]) {
      expect(words).toContain(plain(line));
    }
    // The exam's page: today's plan, «План по дням» up to the date, «Начать».
    for (const line of [EXAMS_PLAN.meta, EXAMS_PLAN.title.join(''), EXAMS_PLAN.start, copy.PLAN_BY_DAYS, copy.daysMinutesRow(30), ...EXAMS_PLAN.days]) {
      expect(words).toContain(plain(line));
    }
    // The «занятие»: the counter, the question and its options, the verdict.
    for (const line of [copy.counter(1, 20), EXAMS_QUESTION.stem, ...EXAMS_QUESTION.options, copy.DONT_KNOW, copy.TAG_RIGHT, copy.VERDICT_RIGHT, copy.NEXT, copy.FINISH]) {
      expect(words).toContain(plain(line));
    }
    expect(words).toContain(plain([EXAMS_EXAMPLE.subject, copy.fileNo(EXAMS_QUESTION.no), copy.topicNo(EXAMS_QUESTION.topic)].join(' · ')));
    // The old oral ticket is not what a new student meets here any more, nor its «Проверено» stamp: success is the
    // screen's own verdict («Верно.») in its own rows — no stamp, no burst of particles, no pencil, no grade words.
    expect(words).not.toMatch(/Тянуть билет|Отвечать голосом|Проверено|Билет 12/i);
    expect(words).not.toMatch(/засчитан|зачтено|отлично|молодец|оценка/i);
    expect(document.querySelector('[class*="stamp"], [class*="confetti"], [class*="burst"], [class*="pencil"], [class*="hatch"], [class*="erase"], canvas')).toBeNull();
    // Russian typesetting: «ёлочки», no «!».
    expect(words).not.toMatch(/[!"]/);
  });

  it('shows the plan the study engine makes for the example file: the title, «Начать», the days, the minutes, the date', () => {
    const input = exampleInput();
    const plan = planDay(input);
    expect(plan.state).toBe('study');
    expect(titleText(plan)).toBe(EXAMS_PLAN.title.join(''));
    const first = plan.sessions.find((session) => session.kind === 'answer')!;
    expect(startLabel(first.ids.length, shownMinutes(first.estSec), null)).toBe(EXAMS_PLAN.start);
    expect(daysAhead(input, plan).map((row) => dayRowText(row))).toEqual(EXAMS_PLAN.days);
    expect(minutesLines(input, EXAMS_EXAMPLE.minutes)?.line).toBe(EXAMS_PLAN.need);
    // The minutes the import page offers first are the smallest that are enough: the ones the clip shows.
    expect(minutesLines(input, 60)?.option).toBe(EXAMS_EXAMPLE.minutes);
    expect(copy.metaLine(metaDay([EXAMS_EXAMPLE.date], EXAMS_EXAMPLE.today).text, EXAMS_EXAMPLE.questions, null)).toBe(EXAMS_PLAN.meta);
    expect(plain(EXAMS_PLAN.meta)).toBe('1 ноября, через 22 дня · 400 вопросов');
    expect(EXAMS_QUESTION.options[EXAMS_QUESTION.right]).toBe('Дефицит');
  });

  it('goes screen by screen: the statement, the drop, what was found, the plan by days, the question answered', () => {
    const seek = renderExport();
    const ui = one('ui');
    const say = document.querySelector('.fm-say') as HTMLElement;
    seek(1000);
    expect(say.textContent).toContain('Загрузите');
    seek(EX.drag + 200);
    expect(seen(one('dropping'))).toBe(true);
    seek(EX.found + 600);
    expect(seen(one('found'))).toBe(true);
    expect(gone(one('reading'))).toBe(true);
    expect(gone(say)).toBe(true);
    seek(EX.save + 180);
    expect(seen(one('saveb'))).toBe(true);
    expect(gone(one('savea'))).toBe(true);
    seek(EX.days + 1200);
    expect(gone(one('import'))).toBe(true);
    expect(seen(one('pagein'))).toBe(true);
    expect(seen(one('sheet'))).toBe(true);
    expect(all('dayrow').every(seen)).toBe(true);
    seek(EX.answer - 200);
    expect(gone(one('page'))).toBe(true);
    expect(seen(one('room'))).toBe(true);
    expect(all('opt').some((opt) => opt.classList.contains('is-right'))).toBe(false);
    seek(EX.answer + 900);
    expect(all('opt')[EXAMS_QUESTION.right]).toHaveClass('is-right');
    expect(seen(one('tag'))).toBe(true);
    expect(seen(one('bar'))).toBe(true);
    expect(gone(one('dontknow'))).toBe(true);
    expect(seen(ui)).toBe(true);
  });

  it('starts and ends on empty paper, so the loop is seamless, and a second pass shows the first screen again', () => {
    const seek = renderExport();
    const { total } = GUIDE_CLIPS.exams;
    const ui = one('ui');
    seek(0);
    expect(gone(ui)).toBe(true);
    seek(total - 40);
    expect(gone(ui)).toBe(true);
    seek(EX.found + 600);
    expect(seen(one('import'))).toBe(true);
    expect(gone(one('pagein'))).toBe(true);
    expect(gone(one('room'))).toBe(true);
    expect(seen(one('strip'))).toBe(true);
  });

  it('with reduced motion waits on its still frame, the plan by days, until «Смотреть»', () => {
    stubReducedMotion(true);
    render(<GuideClip chapter="exams" active />);
    expect(document.querySelector('.gd-box')).toHaveAttribute('data-playing', 'false');
    expect(seen(one('sheet'))).toBe(true);
    expect(all('dayrow').every(seen)).toBe(true);
    expect(seen(one('ui'))).toBe(true);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    });
    expect(document.querySelector('.gd-box')).toHaveAttribute('data-playing', 'true');
  });
});
