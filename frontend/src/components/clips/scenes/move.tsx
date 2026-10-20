/**
 * «Перенести экзамен» (release 47; MoveExamDialog.tsx): the exam's page on its day — «Сегодня экзамен», «Пройтись по
 * ошибкам», the quiet «Перенести экзамен» — the dialog with «Через неделю» and its date, «Перенести», and the page read
 * again: the new date in the meta line, «Экзамен перенесён на 25 октября.» and today's plan made up to the new date.
 * Every word is the screens' own (containers/copy.ts, the plan's words.ts); the plan after the move is the one the study
 * engine makes for the example (StepClips.test plans it and compares).
 */
import { useRef } from 'react';
import { opacity, put, useEls, useFrame } from '../../reel/engine';
import { ease, seg } from '../../reel/timeline';
import { slideIn, slideOut, Wordmark } from '../../film/kit';
import { dayText, lineText, startLabel } from '../../../lib/containers/words';
import * as copy from '../../containers/copy';
import { STUDIO } from '../../studio/copyStudio';
import { QUIZ } from '../../quiz/copyQuiz';
import type { ClipStep } from '../types';
import { BackArrow, Loop, Pill, between, focusRow, press } from './kit';

export const MOVE_TOTAL = 10000;

/** The example: «Микроэкономика», 400 questions, every one seen; the exam is today, 18 October, and moves a week. */
export const MOVE_EXAMPLE = {
  subject: 'Микроэкономика',
  questions: 400,
  today: '2026-10-18',
  /** The dialog's quick choices from today (MoveExamDialog quickDate): a week, two weeks, a month. */
  week: '2026-10-25',
  twoWeeks: '2026-11-01',
  month: '2026-11-18',
  /** Days from today to the new date. */
  ahead: 7,
  /** The plan's «Пройтись по ошибкам: N» on the exam day (the engine's exam_errors). */
  errors: 20,
} as const;

/** The plan the engine makes on 18 October for the exam moved to 25 October (StepClips.test compares). */
export const MOVE_PLAN = {
  /** titleText: «Сегодня 64 вопроса, около 30 минут». */
  title: ['Сегодня ', `64${' '}вопроса`, `, около 30${' '}минут`] as const,
  /** detailText. */
  detail: '64 знакомых',
  /** The plan card's note (window_ahead). */
  note: lineText({ key: 'window_ahead', day: '2026-10-21' }),
  start: startLabel(20, 9, null),
};

export const MOVE_WORDS = {
  metaBefore: copy.metaLine(copy.examDay(dayText(MOVE_EXAMPLE.today), 0), MOVE_EXAMPLE.questions, null),
  metaAfter: copy.metaLine(copy.examDay(dayText(MOVE_EXAMPLE.week), MOVE_EXAMPLE.ahead), MOVE_EXAMPLE.questions, null),
  moved: copy.moved(dayText(MOVE_EXAMPLE.week)),
  choices: [
    { label: copy.MOVE_WEEK, day: dayText(MOVE_EXAMPLE.week) },
    { label: copy.MOVE_TWO_WEEKS, day: dayText(MOVE_EXAMPLE.twoWeeks) },
    { label: copy.MOVE_MONTH, day: dayText(MOVE_EXAMPLE.month) },
    { label: copy.MOVE_OWN, day: null },
  ],
};

/** Scene times (ms). */
export const MV = {
  /** «Перенести экзамен» is pressed. */
  open: 1900,
  /** The dialog comes up. */
  dialog: 2250,
  /** «Через неделю» is pressed (it is the choice the dialog starts on). */
  week: 3700,
  /** «Перенести» is pressed: «Переносим…». */
  save: 4700,
  /** The dialog goes, the page is read again. */
  saved: 5250,
  /** The new plan is in place. */
  plan: 5600,
} as const;

export const MOVE_STEPS: readonly ClipStep[] = [
  { at: 0, caption: 'Экзамен перенесли? Нажмите «Перенести экзамен».', still: 1500 },
  { at: MV.dialog, caption: 'Выберите новую дату и нажмите «Перенести».', still: 4200 },
  { at: MV.saved, caption: 'Готово: дата новая, план пересчитан.', still: 8200 },
];

export function MoveScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    // 1 · the exam's day: «Перенести экзамен» is pressed.
    press(one('movelink'), l, MV.open, 0.08);
    // 2 · the dialog over the page.
    opacity(one('scrim'), 0.34 * ease.inOut(seg(l, MV.dialog, 320)) * (1 - ease.inOut(seg(l, MV.saved, 320))));
    if (l < MV.saved) slideIn(one('dialog'), l, MV.dialog, { dy: 120, dur: 620, smear: 10, scale: 0.98 });
    else slideOut(one('dialog'), l, MV.saved, { dy: 90, dur: 380, smear: 12, scale: 0.98 });
    all('choice').forEach((row, index) => focusRow(row, l, MV.dialog + 260 + index * 70));
    press(one('choice0'), l, MV.week, 0.03);
    press(one('save'), l, MV.save, 0.04);
    opacity(one('savea'), 1 - seg(l, MV.save + 40, 120));
    opacity(one('saveb'), seg(l, MV.save + 40, 120));
    // 3 · the page read again: the date, the plan, the line that says so.
    opacity(one('meta0'), 1 - seg(l, MV.saved + 120, 220));
    opacity(one('meta1'), seg(l, MV.saved + 200, 260));
    const after = seg(l, MV.saved + 160, 260);
    opacity(one('day0'), 1 - after);
    put(one('day0'), 'filter', after > 0 && after < 1 ? `blur(${(10 * after).toFixed(2)}px)` : 'none');
    focusRow(one('day1'), l, MV.saved + 260, 460);
    focusRow(one('note0'), l, MV.plan, 420);
    focusRow(one('note1'), l, MV.plan + 220, 420);
    opacity(one('pill0'), between(l, -1000, MV.saved + 160, 200));
    focusRow(one('pill1'), l, MV.saved + 420, 460);
  });

  return (
    <div ref={root} className="mr-scene">
      <Loop total={MOVE_TOTAL}>
        <div className="sx-strip">
          <Wordmark className="sx-strip-mark" />
          {['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс'].map((item) => (
            <span key={item} className={item === 'Экзамены' ? 'is-on' : undefined}>
              {item}
            </span>
          ))}
        </div>
        <span className="sx-back mv-back">
          <BackArrow />
          {copy.TO_EXAMS}
        </span>
        <p className="fm-h1 mv-h1">{MOVE_EXAMPLE.subject}</p>
        <p className="mv-meta fm-muted">
          <span data-a="meta0">{MOVE_WORDS.metaBefore}</span>
          <span data-a="meta1" style={{ opacity: 0 }}>
            {MOVE_WORDS.metaAfter}
          </span>
        </p>

        <div className="mv-acts">
          {[copy.MENU_INVITE, copy.MENU_KEYS, STUDIO.label, QUIZ.names, copy.MENU_MINUTES].map((label) => (
            <span key={label} className="mv-act">
              {label}
            </span>
          ))}
        </div>

        <div className="fm-card mv-card">
          {/* The exam's day. */}
          <div data-a="day0" className="mv-day">
            <p className="mv-title">{copy.EXAM_TODAY.replace(/\.$/, '')}</p>
            <p className="mv-links">
              <span className="sx-link">{copy.MOCK_LINK}</span>
              <span data-a="movelink" className="sx-link">
                {copy.MOVE_TITLE}
              </span>
            </p>
          </div>
          {/* The plan made up to the new date. */}
          <div data-a="day1" className="mv-day" style={{ opacity: 0 }}>
            <p className="mv-title">
              {MOVE_PLAN.title[0]}
              {MOVE_PLAN.title[1]}
              {MOVE_PLAN.title[2]}
            </p>
            <p className="mv-links">
              {copy.glue(MOVE_PLAN.detail)}.{' '}
              <span className="sx-link">{copy.PLAN_BY_DAYS}</span>
            </p>
            <p data-a="note0" className="mv-note mv-note--ink" style={{ opacity: 0 }}>
              {MOVE_WORDS.moved}
            </p>
            <p data-a="note1" className="mv-note fm-muted" style={{ opacity: 0 }}>
              {MOVE_PLAN.note}
            </p>
          </div>
          <div className="mv-pills">
            <Pill name="pill0" className="mv-pill">
              {copy.walkErrors(MOVE_EXAMPLE.errors)}
            </Pill>
            <span data-a="pill1" className="mv-pill-wrap" style={{ opacity: 0 }}>
              <Pill className="mv-pill">{MOVE_PLAN.start}</Pill>
            </span>
          </div>
        </div>

        <i data-a="scrim" className="sx-scrim" style={{ opacity: 0 }} />
        <div data-a="dialog" className="fm-card mv-dialog" style={{ opacity: 0 }}>
          <div className="mv-dialog-head">
            <p className="mv-dialog-t">{copy.MOVE_TITLE}</p>
            <span className="sx-link fm-muted">{copy.CLOSE}</span>
          </div>
          <p className="mv-legend fm-muted">{copy.MOVE_WHEN}</p>
          {MOVE_WORDS.choices.map((choice, index) => (
            <div key={choice.label} data-a="choice" className={`mv-choice${index === 0 ? ' is-on' : ''}`} style={{ opacity: 0 }}>
              <span data-a={index === 0 ? 'choice0' : undefined} className="mv-choice-in">
                <i className="mv-radio" />
                <span className="mv-choice-t">{choice.label}</span>
                {choice.day ? <span className="mv-choice-d">{choice.day}</span> : null}
              </span>
            </div>
          ))}
          <span data-a="save" className="fm-btn fm-btn--blue sx-pill mv-save">
            <span className="sx-pill-t sx-swap">
              <span data-a="savea">{copy.MOVE_SAVE}</span>
              <span data-a="saveb" style={{ opacity: 0 }}>
                {copy.MOVE_SAVING}
              </span>
            </span>
            <i>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </i>
          </span>
        </div>
      </Loop>
    </div>
  );
}
