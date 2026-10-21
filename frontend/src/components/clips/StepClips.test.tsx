import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StepClip, { stepAt, stepProgress } from './StepClip';
import { STEP_CLIPS } from './index';
import { STEP_H, STEP_W, type StepClipId } from './types';
import { FADE_IN, FADE_OUT } from './scenes/kit';
import { MOVE_EXAMPLE, MOVE_PLAN, MOVE_WORDS, MV } from './scenes/move';
import { STUDIO_EXAMPLE, ST } from './scenes/studio';
import { QUIZ_EXAMPLE, QUIZ_TABLE, QUIZ_WORDS, QZ } from './scenes/quizLink';
import { BOT_WORDS, BX } from './scenes/botExams';
import { daysAhead, planDay } from '../../lib/containers/plan';
import { lineText, shownMinutes, startLabel } from '../../lib/containers/words';
import { detailText, titleText } from '../containers/planLines';
import { quickDate } from '../containers/MoveExamDialog';
import * as copy from '../containers/copy';
import { NEW_TEST } from '../test/copyTest';
import { DOC, STUDIO } from '../studio/copyStudio';
import { QA_PEOPLE, QA_STATS } from '../quiz/copyAuthor';
import { RESULT, RUN, TAKE } from '../quiz/copyTake';
import type { PlanInput } from '../../types/container';
// The bot's own screens, as its snapshot tests keep them (supabase/functions/_shared/bot/fixtures/snapshots).
import settingsSnap from '../../../../supabase/functions/_shared/bot/fixtures/snapshots/settings.json?raw';
import examsSnap from '../../../../supabase/functions/_shared/bot/fixtures/snapshots/exams.json?raw';
import cardSnap from '../../../../supabase/functions/_shared/bot/fixtures/snapshots/card.json?raw';
import botWordsSource from '../../../../supabase/functions/_shared/bot/words.ts?raw';
import botExamsSource from '../../../../supabase/functions/_shared/bot/exams.ts?raw';

/* The how-to clips of release 47 (the owner, 18.10: «для новых функций тоже нужно сделать обучение с видео»). */

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

const NB = ' ';
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const one = (name: string) => document.querySelector(`[data-a="${name}"]`) as HTMLElement;
const seen = (el: HTMLElement) => el.style.opacity === '1';
const gone = (el: HTMLElement) => el.style.opacity === '0';
const stage = () => document.querySelector('.sc-stage') as HTMLElement;
const words = () => plain(stage().textContent);
const caption = () => plain(document.querySelector('.sc-cap-t')?.textContent);
const IDS = Object.keys(STEP_CLIPS) as StepClipId[];

/** The clip frozen for export: `seek` moves it to a moment. */
function renderExport(id: StepClipId) {
  window.__MELDY_STEP_EXPORT__ = true;
  render(<StepClip clip={STEP_CLIPS[id]} active />);
  return (t: number) => {
    act(() => {
      void window.__meldyStepClip?.seek(t);
    });
  };
}

/** A bot snapshot's text as the chat shows it: no tags, one entry a line. */
function snapLines(json: string, key: string): string[] {
  const snap = JSON.parse(json)[key] as { text: string };
  return plain(snap.text.replace(/<\/?b>/g, '')).split('\n');
}
function snapKeys(json: string, key: string): string[][] {
  const snap = JSON.parse(json)[key] as { keyboard: Array<Array<{ text: string }>> };
  return snap.keyboard.map((row) => row.map((button) => plain(button.text)));
}
/** The clip's lines with the bot's no-break spaces read as spaces (the snapshots keep them, the words are the same). */
const flat = (lines: readonly string[]) => lines.map((line) => plain(line));
const flatKeys = (rows: ReadonlyArray<readonly string[]>) => rows.map((row) => row.map((label) => plain(label)));

beforeEach(() => {
  // jsdom lays nothing out: the frame is 480 px wide here.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
  stubReducedMotion(false);
});
afterEach(() => {
  cleanup();
  delete window.__MELDY_STEP_EXPORT__;
  vi.unstubAllGlobals();
});

describe('the four clips: length, steps and lines', () => {
  it('are the features of release 47 and the quick test, each 8–14 s, its steps in order from the start', () => {
    // «quick» and «studioTour» (UX audit of 21.10): the teacher's first card and the studio's tour from the studio on.
    expect(IDS.sort()).toEqual(['botExams', 'move', 'quick', 'quizLink', 'studio', 'studioTour']);
    for (const id of IDS) {
      const { total, steps } = STEP_CLIPS[id];
      expect(total).toBeGreaterThanOrEqual(8000);
      expect(total).toBeLessThanOrEqual(14000);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      expect(steps[0].at).toBe(0);
      steps.forEach((step, index) => {
        const end = index + 1 < steps.length ? steps[index + 1].at : total;
        // A step is long enough to read its line (≥ 1.8 s) and its still is inside it, everything of it on screen.
        expect(end - step.at).toBeGreaterThanOrEqual(1800);
        expect(step.still).toBeGreaterThan(step.at);
        expect(step.still).toBeLessThan(end);
        expect(step.still).toBeLessThan(total - FADE_OUT);
        expect(step.still).toBeGreaterThan(FADE_IN);
      });
    }
    expect(STEP_CLIPS.studio.total).toBe(14000);
    expect(STEP_CLIPS.quizLink.total).toBe(14000);
    expect(STEP_CLIPS.move.total).toBe(10000);
    expect(STEP_CLIPS.botExams.total).toBe(14000);
    expect(STEP_CLIPS.quick.total).toBe(12500);
    expect(STEP_CLIPS.studioTour.total).toBe(14000 - 2900);
    // The tour's clip is «Свой тест» without its first step («Новый тест»).
    expect(STEP_CLIPS.studioTour.steps.map((step) => step.caption)).toEqual(STEP_CLIPS.studio.steps.slice(1).map((step) => step.caption));
  });

  it('say each step in one short line of plain Russian: «ёлочки», no «!», no emoji, nothing shouted', () => {
    for (const id of IDS) {
      for (const { caption: line } of STEP_CLIPS[id].steps) {
        expect(line.length).toBeLessThanOrEqual(56);
        expect(line).toMatch(/[.»]$/);
        expect(line).not.toMatch(/[!"✨🚀🎉]|\p{Extended_Pictographic}/u);
        expect(line).not.toMatch(/[A-Z]{3,}/);
        expect((line.match(/«/g) ?? []).length).toBe((line.match(/»/g) ?? []).length);
      }
    }
    expect(STEP_CLIPS.studio.steps.map((step) => step.caption)).toEqual([
      'Нажмите «Новый тест» и назовите тест.',
      'Перетащите «Заголовок» на страницу.',
      'Добавьте вопрос и отметьте верный ответ.',
      'Во вкладке «Оформление» выберите цвет.',
      '«Посмотреть как участник» — тест глазами ученика.',
    ]);
    expect(STEP_CLIPS.move.steps.map((step) => step.caption)).toEqual([
      'Экзамен перенесли? Нажмите «Перенести экзамен».',
      'Выберите новую дату и нажмите «Перенести».',
      'Готово: дата новая, план пересчитан.',
    ]);
  });

  it('play on a 16:10 stage scaled to the frame, the picture hidden from screen readers and the steps read as a list', () => {
    expect(STEP_W / STEP_H).toBe(1.6);
    for (const id of IDS) {
      render(<StepClip clip={STEP_CLIPS[id]} active />);
      expect(stage()).toHaveAttribute('aria-hidden', 'true');
      expect(stage().style.transform).toBe(`scale(${480 / 1440})`);
      const list = screen.getByRole('list', { name: 'Шаги ролика' });
      expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(STEP_CLIPS[id].steps.map((step) => step.caption));
      cleanup();
    }
  });
});

describe('the player', () => {
  it('shows the line of the step playing, its number, and the strip of the steps', () => {
    const seek = renderExport('move');
    const steps = STEP_CLIPS.move.steps;
    seek(steps[0].still);
    expect(caption()).toBe(steps[0].caption);
    expect(document.querySelector('.sc-count')).toHaveTextContent('1/3');
    seek(steps[1].at + 10);
    expect(caption()).toBe(steps[1].caption);
    expect(document.querySelector('.sc-count')).toHaveTextContent('2/3');
    const fills = Array.from(document.querySelectorAll<HTMLElement>('.sc-strip b'));
    expect(fills).toHaveLength(3);
    expect(fills[0].style.transform).toBe('scaleX(1.0000)');
    expect(fills[2].style.transform).toBe('scaleX(0.0000)');
    seek(steps[2].still);
    expect(caption()).toBe(steps[2].caption);
    expect(stepAt(steps, 0)).toBe(0);
    expect(stepAt(steps, MV.saved)).toBe(2);
    expect(stepProgress(steps, STEP_CLIPS.move.total, 2, STEP_CLIPS.move.total)).toBe(1);
  });

  it('pauses and plays with «Пауза» and «Смотреть»; «Следующий шаг» goes to the next step, from the last to the first', () => {
    render(<StepClip clip={STEP_CLIPS.studio} active />);
    const box = document.querySelector('.sc') as HTMLElement;
    expect(box).toHaveAttribute('data-playing', 'true');
    const pause = screen.getByRole('button', { name: 'Пауза' });
    expect(pause).toHaveAttribute('type', 'button');
    fireEvent.click(pause);
    expect(box).toHaveAttribute('data-playing', 'false');
    // Paused, «Следующий шаг» shows the next step whole.
    const next = screen.getByRole('button', { name: 'Следующий шаг' });
    expect(next).toHaveAttribute('type', 'button');
    fireEvent.click(next);
    expect(caption()).toBe(STEP_CLIPS.studio.steps[1].caption);
    for (let i = 0; i < 4; i += 1) fireEvent.click(next);
    expect(caption()).toBe(STEP_CLIPS.studio.steps[0].caption);
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    expect(box).toHaveAttribute('data-playing', 'true');
  });

  it('does not move while the card is not shown', () => {
    render(<StepClip clip={STEP_CLIPS.quizLink} active={false} />);
    expect(document.querySelector('.sc')).toHaveAttribute('data-playing', 'false');
  });

  it('with reduced motion stands still: each step a still frame with its line, «Следующий шаг» through them, «Смотреть» plays', () => {
    stubReducedMotion(true);
    render(<StepClip clip={STEP_CLIPS.botExams} active />);
    const box = document.querySelector('.sc') as HTMLElement;
    const steps = STEP_CLIPS.botExams.steps;
    expect(box).toHaveAttribute('data-playing', 'false');
    expect(caption()).toBe(steps[0].caption);
    expect(screen.queryByRole('button', { name: 'Пауза' })).toBeNull();
    // The still of the first step: the settings, «Экзамены» not pressed yet.
    expect(seen(one('m1-settings'))).toBe(true);
    const next = screen.getByRole('button', { name: 'Следующий шаг' });
    fireEvent.click(next);
    expect(caption()).toBe(steps[1].caption);
    expect(seen(one('m1-exams'))).toBe(true);
    expect(seen(one('winter-on'))).toBe(true);
    expect(box).toHaveAttribute('data-playing', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Смотреть/ }));
    expect(box).toHaveAttribute('data-playing', 'true');
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('starts and ends every loop on empty paper, so the seam never shows', () => {
    for (const id of IDS) {
      const seek = renderExport(id);
      const { total, steps } = STEP_CLIPS[id];
      const cover = id === 'botExams' ? (document.querySelector('.bx-paper') as HTMLElement) : id === 'studioTour' ? one('tourfade') : one('loop');
      const hidden = () => (id === 'botExams' ? seen(cover) : gone(cover));
      seek(0);
      expect(hidden()).toBe(true);
      seek(total - 20);
      expect(hidden()).toBe(true);
      seek(steps[1].still);
      expect(hidden()).toBe(false);
      cleanup();
      delete window.__MELDY_STEP_EXPORT__;
    }
  });
});

describe('«Свой тест»: the studio in its own words', () => {
  it('goes «Новый тест» → the name → the studio: «Заголовок» dragged with the line, a question with its key, a colour, the preview', () => {
    const seek = renderExport('studio');
    const all = words();
    for (const line of [
      NEW_TEST.entry,
      NEW_TEST.entryNote,
      NEW_TEST.examNote,
      NEW_TEST.title,
      NEW_TEST.lede,
      NEW_TEST.name,
      NEW_TEST.create,
      STUDIO.palette,
      STUDIO.types.heading,
      STUDIO.qtypes.single,
      STUDIO.preview,
      STUDIO.send,
      STUDIO.saved,
      STUDIO.panels.block,
      STUDIO.panels.design,
      STUDIO.panels.result,
      STUDIO.accent,
      STUDIO.customColor,
      STUDIO.keyMark,
      STUDIO.previewTitle,
      STUDIO.previewNote,
      DOC.finish,
      STUDIO_EXAMPLE.heading,
      STUDIO_EXAMPLE.stem,
    ]) {
      expect(all).toContain(plain(line));
    }
    seek(ST.type + 3000);
    expect(one('name').textContent).toBe(STUDIO_EXAMPLE.title);
    seek(STEP_CLIPS.studio.steps[1].still);
    expect(seen(one('studio'))).toBe(true);
    expect(gone(one('exams'))).toBe(true);
    expect(seen(one('ghost'))).toBe(true);
    expect(Number(one('insert').style.opacity)).toBeGreaterThan(0.9);
    expect(gone(one('heading'))).toBe(true);
    seek(ST.drop + 900);
    expect(seen(one('heading'))).toBe(true);
    expect(gone(one('ghost'))).toBe(true);
    seek(STEP_CLIPS.studio.steps[2].still);
    expect(seen(one('question'))).toBe(true);
    expect(seen(one('keytag'))).toBe(true);
    seek(STEP_CLIPS.studio.steps[3].still);
    expect(one('send').style.background).toMatch(/#1f7a3d|rgb\(31, 122, 61\)/);
    expect(one('ring-green').style.opacity).toBe('1');
    seek(STEP_CLIPS.studio.steps[4].still);
    expect(seen(one('preview'))).toBe(true);
    expect(seen(one('phone'))).toBe(true);
  });
});

describe('«Тест по ссылке»: the link, the student without an account, the result, the author’s table', () => {
  it('says what the screens say', () => {
    renderExport('quizLink');
    const all = words();
    for (const line of [
      STUDIO.send,
      QA_STATS.link,
      QA_STATS.copy,
      QA_STATS.qr,
      QA_STATS.asTaker,
      QA_STATS.qrHint,
      QA_STATS.created,
      QUIZ_WORDS.takeMeta,
      QUIZ_WORDS.nameLabel,
      TAKE.nameHint,
      TAKE.start,
      RUN.finish,
      QUIZ_WORDS.place,
      RESULT.answersTitle,
      RESULT.tagMineWrong,
      RESULT.tagMissed,
      RESULT.explanation,
      QUIZ_EXAMPLE.explanation,
      QUIZ_WORDS.score,
      QUIZ_WORDS.pass,
      QUIZ_TABLE.after,
      QA_PEOPLE.guest,
      QUIZ_TABLE.added.result,
    ]) {
      expect(all).toContain(plain(line));
    }
    expect(RESULT.tagMissed).toBe('Верный, но вы его не отметили');
    expect(plain(QUIZ_WORDS.score)).toBe('7 из 12 · 58 %');
    expect(plain(QUIZ_WORDS.pass)).toBe('Не сдано. Проходной балл 60 %');
    // 7 of 12 is 58 %; the average of 10 of 12 and 7 of 12 is 71 %.
    expect(Math.round((QUIZ_EXAMPLE.correct / QUIZ_EXAMPLE.items) * 100)).toBe(QUIZ_EXAMPLE.percent);
    expect(Math.round(((10 + 7) / 24) * 100)).toBe(71);
  });

  it('goes link and QR → the phone → the answer → the result → the new row', () => {
    const seek = renderExport('quizLink');
    seek(STEP_CLIPS.quizLink.steps[0].still);
    expect(seen(one('qr'))).toBe(true);
    seek(STEP_CLIPS.quizLink.steps[1].still);
    expect(gone(one('qr'))).toBe(true);
    expect(one('name').textContent).toBe(QUIZ_EXAMPLE.student);
    seek(QZ.pick + 300);
    expect(one('pick').style.background).toMatch(/#e8effc|rgb\(232, 239, 252\)/);
    seek(STEP_CLIPS.quizLink.steps[3].still);
    expect(seen(one('result'))).toBe(true);
    seek(STEP_CLIPS.quizLink.steps[4].still);
    expect(seen(one('newrow'))).toBe(true);
    expect(seen(one('sum1'))).toBe(true);
    expect(gone(one('sum0'))).toBe(true);
  });
});

describe('«Перенести экзамен»: the exam day, the dialog, the plan made again', () => {
  /** The example as the plan engine gets it: 400 questions, every one seen, the exam moved to 25 October. */
  function movedInput(date: string): PlanInput {
    const s = 'subj-micro';
    return {
      v: 1,
      now: Date.parse(`${MOVE_EXAMPLE.today}T12:00:00+03:00`),
      tz: 'Europe/Minsk',
      containerId: 'c-example',
      budgetMin: 30,
      studyWeekdays: 127,
      firstPlanDay: '2026-10-01',
      subjects: [{ id: s, title: MOVE_EXAMPLE.subject, date }],
      items: Array.from({ length: MOVE_EXAMPLE.questions }, (_, i) => ({
        id: `q${i + 1}`,
        s,
        f: 't' as const,
        tp: 1,
        o: i + 1,
        u: { seen: 2, wrong: i % 7 === 0 ? 1 : 0, firstDay: '2026-10-05', lastDay: '2026-10-17', seriesAt: null, seriesDay: null, twoDaysAt: i % 3 === 0 ? 1 : null, namedAt: null, checks: 0, peekDay: null, wasTwoDays: i % 3 === 0, cleanOkAt: null },
      })),
      today: { firstAt: null, doneSec: 0, newDone: {} },
      pace: null,
      ai: null,
      examQuestions: MOVE_EXAMPLE.questions,
    };
  }

  it('shows the dialog’s own dates and the plan the engine makes for the new date', () => {
    expect(quickDate('week', MOVE_EXAMPLE.today)).toBe(MOVE_EXAMPLE.week);
    expect(quickDate('two_weeks', MOVE_EXAMPLE.today)).toBe(MOVE_EXAMPLE.twoWeeks);
    expect(quickDate('month', MOVE_EXAMPLE.today)).toBe(MOVE_EXAMPLE.month);
    const day = planDay(movedInput(MOVE_EXAMPLE.today));
    expect(day.state).toBe('exam_today');
    expect(day.lines.find((line) => line.key === 'exam_errors')?.n?.[0]).toBe(MOVE_EXAMPLE.errors);
    const input = movedInput(MOVE_EXAMPLE.week);
    const plan = planDay(input);
    expect(plan.state).toBe('study');
    expect(titleText(plan)).toBe(MOVE_PLAN.title.join(''));
    expect(plain(detailText(plan))).toBe(MOVE_PLAN.detail);
    const first = plan.sessions.find((session) => session.kind === 'answer')!;
    expect(startLabel(first.ids.length, shownMinutes(first.estSec), null)).toBe(MOVE_PLAN.start);
    expect(plan.lines.filter((line) => line.key === 'window_ahead').map((line) => lineText(line))).toEqual([MOVE_PLAN.note]);
    expect(daysAhead(input, plan).length).toBeGreaterThan(0);
    expect(plain(MOVE_WORDS.moved)).toBe('Экзамен перенесён на 25 октября.');
    expect(plain(MOVE_WORDS.metaBefore)).toBe('18 октября, сегодня · 400 вопросов');
    expect(plain(MOVE_WORDS.metaAfter)).toBe('25 октября, через 7 дней · 400 вопросов');
  });

  it('says what the screens say and goes from the exam day to the new plan', () => {
    const seek = renderExport('move');
    const all = words();
    for (const line of [copy.EXAM_TODAY.replace(/\.$/, ''), copy.MOVE_TITLE, copy.MOVE_WHEN, copy.MOVE_WEEK, copy.MOVE_TWO_WEEKS, copy.MOVE_MONTH, copy.MOVE_OWN, copy.MOVE_SAVE, copy.MOVE_SAVING, copy.walkErrors(20), copy.PLAN_BY_DAYS, MOVE_WORDS.moved, MOVE_PLAN.note, MOVE_PLAN.start, '25 октября', '1 ноября', '18 ноября']) {
      expect(all).toContain(plain(line));
    }
    seek(STEP_CLIPS.move.steps[0].still);
    expect(seen(one('day0'))).toBe(true);
    expect(gone(one('dialog'))).toBe(true);
    seek(STEP_CLIPS.move.steps[1].still);
    expect(seen(one('dialog'))).toBe(true);
    seek(MV.save + 200);
    expect(seen(one('saveb'))).toBe(true);
    seek(STEP_CLIPS.move.steps[2].still);
    expect(gone(one('dialog'))).toBe(true);
    expect(gone(one('day0'))).toBe(true);
    expect(seen(one('day1'))).toBe(true);
    expect(seen(one('note0'))).toBe(true);
    expect(seen(one('meta1'))).toBe(true);
  });
});

describe('«Экзамены в Telegram»: the bot’s own screens', () => {
  it('are the bot’s snapshots word for word: «Настройки», «Какие экзамены присылать», the day card, K3', () => {
    expect(flat([BOT_WORDS.settings.title, ...BOT_WORDS.settings.lines])).toEqual(snapLines(settingsSnap, 's1'));
    expect(flatKeys(BOT_WORDS.settings.keys)).toEqual(snapKeys(settingsSnap, 's1'));
    expect(flat([BOT_WORDS.exams.title, ...BOT_WORDS.exams.lines])).toEqual(snapLines(examsSnap, 'exams_from_settings'));
    expect(flatKeys(BOT_WORDS.exams.keysBefore)).toEqual(snapKeys(examsSnap, 'exams_from_settings'));
    // Pressed, «— Зимняя сессия» is in the plan: «✓ Зимняя сессия» (words.ts examChoice).
    expect(BOT_WORDS.exams.keysAfter[1][0]).toBe(BOT_WORDS.exams.keysBefore[1][0].replace('—', '✓'));
    expect(botWordsSource).toContain("`${on ? '✓' : '—'} ${title}");
    expect(flat([BOT_WORDS.card.title, ...BOT_WORDS.card.lines])).toEqual(snapLines(cardSnap, 'k1_two_exams'));
    expect(flatKeys(BOT_WORDS.card.keys)).toEqual(snapKeys(cardSnap, 'k1_two_exams'));
    expect(flat([BOT_WORDS.k3.title, ...BOT_WORDS.k3.lines])).toEqual(snapLines(cardSnap, 'k3_move'));
    expect(flatKeys(BOT_WORDS.k3.keys)).toEqual(snapKeys(cardSnap, 'k3_move'));
    // «Перенести на неделю» is 7 days from the link's day: K3 on 4 November moves the exam to 11 November.
    expect(botExamsSource).toContain("cb.act === 'w1' ? 7 : 14");
    expect(BOT_WORDS.moved.lines[0]).toBe('Экзамен «Осенняя сессия» перенесён на 11 ноября. План пересчитан.');
    // The snapshot's own move (a link's day of 3 November) in the same words.
    expect(plain(BOT_WORDS.moved.lines[0])).toBe(snapLines(examsSnap, 'moved')[0].replace('10 ноября', '11 ноября'));
    expect(flatKeys(BOT_WORDS.moved.keys)).toEqual(snapKeys(examsSnap, 'moved'));
  });

  it('goes /settings → «Экзамены» → both ticked → the day card → K3 → moved', () => {
    const seek = renderExport('botExams');
    seek(BX.exams - 200);
    expect(seen(one('m1-settings'))).toBe(true);
    seek(BX.winter - 100);
    expect(seen(one('m1-exams'))).toBe(true);
    expect(seen(one('winter-off'))).toBe(true);
    seek(BX.winterShown + 400);
    expect(seen(one('winter-on'))).toBe(true);
    seek(BX.card + 800);
    expect(seen(one('m2'))).toBe(true);
    seek(BX.k3 + 800);
    expect(seen(one('m3'))).toBe(true);
    expect(seen(one('m3-k3'))).toBe(true);
    seek(BX.moved + 600);
    expect(seen(one('m3-moved'))).toBe(true);
    expect(gone(one('m3-k3'))).toBe(true);
    expect(plain(stage().textContent)).toContain('План на сегодня');
  });
});
