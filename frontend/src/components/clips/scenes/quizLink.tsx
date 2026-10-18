/**
 * «Тест по ссылке» (release 47: a test sent by its link, a participant without an account): the author presses «Отправить
 * по ссылке» in the studio; the test's page has «Ссылка для участников» and «Показать QR»; a student opens the link on a
 * phone — the name, «Начать» — answers, «Завершить», and sees the result with «Верный — вы не отметили» and the
 * author's «Пояснение»; back on the author's page the student's row comes into the table. Every word is the screens' own
 * (copyStudio.ts, the quiz's copyAuthor.ts, copyTake.ts, copyQuiz.ts); the example is a chemistry test.
 */
import { useRef } from 'react';
import { blur, opacity, put, useEls, useFrame } from '../../reel/engine';
import { clamp, ease, mix, seg } from '../../reel/timeline';
import { slideIn, Wordmark } from '../../film/kit';
import { STUDIO } from '../../studio/copyStudio';
import { StudioStill } from './studio';
import { QA_PEOPLE, QA_STATS } from '../../quiz/copyAuthor';
import { QUIZ } from '../../quiz/copyQuiz';
import { RESULT, RUN, TAKE } from '../../quiz/copyTake';
import type { ClipStep } from '../types';
import { Arrow, BackArrow, Loop, focusRow, leave, press, typeInto } from './kit';

export const QUIZ_TOTAL = 14000;

export const QUIZ_EXAMPLE = {
  title: 'Кислоты и основания: проверочная',
  exam: 'Кислоты и основания',
  author: 'Анна Петровна Соколова',
  link: 'ludosiel-studyforge.hf.space/k/k7m2p9q4r8st',
  until: '25 окт., 23:59',
  items: 12,
  minutes: 20,
  student: 'Иванов Иван',
  stem: 'Какая из кислот относится к сильным?',
  options: ['Угольная', 'Серная', 'Сероводородная', 'Кремниевая'],
  /** The student's answer and the right one. */
  picked: 0,
  right: 1,
  explanation: 'Серная кислота в растворе диссоциирует почти полностью — поэтому её относят к сильным.',
  /** The student's result: 7 of 12, the pass mark 60 %. */
  correct: 7,
  percent: 58,
  pass: 60,
  when: '18 окт., 12:47',
} as const;

const LETTERS = ['А', 'Б', 'В', 'Г'];

/** The table before and after the student's attempt («по имени»). */
export const QUIZ_TABLE = {
  before: QA_STATS.summary(1, 1, 83, 1),
  after: QA_STATS.summary(1, 2, 71, 1),
  rows: [
    { name: 'Борисова Анна', status: QA_PEOPLE.done('12:38'), result: QA_PEOPLE.result(10, 12, 83), time: QA_PEOPLE.minutes(16) },
    { name: 'Петров Пётр', status: QA_PEOPLE.writing(8, 12, '06:10'), result: '', time: '' },
  ],
  added: {
    name: QUIZ_EXAMPLE.student,
    status: QA_PEOPLE.done('12:47'),
    result: QA_PEOPLE.result(QUIZ_EXAMPLE.correct, QUIZ_EXAMPLE.items, QUIZ_EXAMPLE.percent),
    time: QA_PEOPLE.minutes(9),
  },
};

export const QUIZ_WORDS = {
  meta: `${QUIZ.stateOpen(QUIZ_EXAMPLE.until)} · ${QUIZ.questions(QUIZ_EXAMPLE.items)} · ${QUIZ.minutes(QUIZ_EXAMPLE.minutes)} · ${QUIZ.attempts(1)}`,
  takeMeta: TAKE.meta({ items: QUIZ_EXAMPLE.items, minutes: QUIZ_EXAMPLE.minutes, window: TAKE.openUntil(QUIZ_EXAMPLE.until), attempts: 1 }),
  nameLabel: TAKE.nameLabel(QUIZ_EXAMPLE.author),
  place: `${RUN.place(1, QUIZ_EXAMPLE.items)}${RUN.sep}${RUN.clock('19:58')}`,
  score: `${RESULT.score(QUIZ_EXAMPLE.correct, QUIZ_EXAMPLE.items)} · ${RESULT.percent(QUIZ_EXAMPLE.percent)}`,
  pass: RESULT.pass(QUIZ_EXAMPLE.pass, false),
};

/** Scene times (ms). */
export const QZ = {
  /** «Отправить по ссылке» in the studio. */
  send: 800,
  /** The test's page with its link. */
  page: 1150,
  /** «Показать QR». */
  qr: 2500,
  /** The student's phone comes up. */
  phone: 4300,
  type: 4900,
  start: 6050,
  /** The first question. */
  question: 6600,
  pick: 7350,
  finish: 8100,
  /** The result. */
  result: 8600,
  /** The result scrolls to the explanation. */
  explain: 9500,
  /** The phone goes; the author's table. */
  table: 11000,
  /** The student's row comes in. */
  row: 11800,
} as const;

export const QUIZ_STEPS: readonly ClipStep[] = [
  { at: 0, caption: `«${STUDIO.send}» даст ссылку и QR-код.`, still: 3700 },
  { at: QZ.phone, caption: 'Ученик открывает ссылку: без аккаунта, только имя.', still: 5900 },
  { at: QZ.question, caption: `Отвечает на вопросы и нажимает «${RUN.finish}».`, still: 7800 },
  { at: QZ.result, caption: 'Сразу видит ошибки и пояснение.', still: 10500 },
  { at: QZ.table, caption: 'А у вас в таблице — его строка.', still: 12800 },
];

/** A QR code drawn as the app draws one (a fixed pattern: the clip's code is not meant to be scanned). */
function QrPattern() {
  const n = 25;
  const cells: Array<[number, number]> = [];
  // Finder squares in three corners and a deterministic scatter between them.
  let seed = 7;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const finder = (x: number, y: number) => x < 7 && y < 7;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const inFinder = finder(x, y) || finder(n - 1 - x, y) || finder(x, n - 1 - y);
      if (inFinder) continue;
      if (next() < 0.47) cells.push([x, y]);
    }
  }
  const square = (x: number, y: number) => (
    <g key={`f${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} fill="#0b121c" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="#0b121c" />
    </g>
  );
  return (
    <svg className="qz-qr-code" viewBox={`-1 -1 ${n + 2} ${n + 2}`} aria-hidden="true" shapeRendering="crispEdges">
      <rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#fff" />
      {square(0, 0)}
      {square(n - 7, 0)}
      {square(0, n - 7)}
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#0b121c" />
      ))}
    </svg>
  );
}

function Row({ name, status, result, time, guest, data }: { name: string; status: string; result: string; time: string; guest?: boolean; data?: string }) {
  return (
    <div data-a={data} className="qz-row" style={data ? { opacity: 0 } : undefined}>
      <span className="qz-c1">
        {name}
        {guest ? <small>{QA_PEOPLE.guest}</small> : null}
      </span>
      <span className="qz-c2 fm-muted">{status}</span>
      <span className="qz-c3">{result}</span>
      <span className="qz-c4 fm-muted">{time}</span>
    </div>
  );
}

export function QuizLinkScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    // 1 · the studio's «Отправить по ссылке»; the test's page with the link; «Показать QR».
    press(one('send'), l, QZ.send, 0.05);
    leave(one('studio'), l, QZ.page);
    slideIn(one('stats'), l, QZ.page + 160, { dx: 220, dur: 640, smear: 14 });
    focusRow(one('created'), l, QZ.page + 500, 420);
    press(one('qrbtn'), l, QZ.qr, 0.06);
    const qr = seg(l, QZ.qr + 140, 320) * (1 - seg(l, QZ.phone - 260, 300));
    opacity(one('qr'), qr);
    put(one('qrin'), 'transform', `scale(${mix(0.96, 1, ease.out(seg(l, QZ.qr + 140, 500))).toFixed(4)})`);

    // 2–4 · the student's phone over the author's page, out of focus behind it.
    const phoneIn = ease.brand(seg(l, QZ.phone, 760));
    const phoneOut = ease.in(seg(l, QZ.table, 520));
    const phone = one('phone');
    put(phone, 'transform', `translate3d(0,${(900 * (1 - phoneIn) + 980 * phoneOut).toFixed(1)}px,0)`);
    opacity(phone, l < QZ.phone || l > QZ.table + 520 ? 0 : 1);
    blur(phone, 14 * (1 - phoneIn) * (l < QZ.phone + 760 ? 1 : 0) + 16 * phoneOut);
    const back = clamp(seg(l, QZ.phone, 500)) * (1 - seg(l, QZ.table + 80, 500));
    blur(one('stats'), 10 * back);
    opacity(one('veil'), 0.5 * back);

    // The start page: the name typed, «Начать».
    typeInto(one('name'), one('caret'), QUIZ_EXAMPLE.student, l, QZ.type, 16, QZ.start);
    press(one('start'), l, QZ.start, 0.05);
    put(one('startscroll'), 'transform', `translate3d(0,${(-210 * ease.inOut(seg(l, QZ.type - 300, 600))).toFixed(1)}px,0)`);
    leave(one('takestart'), l, QZ.question, -180);
    // The question: «Угольная» picked, «Завершить».
    slideIn(one('run'), l, QZ.question + 120, { dx: 160, dur: 560, smear: 10 });
    press(one('pick'), l, QZ.pick, 0.03);
    const picked = l >= QZ.pick + 40;
    put(one('pick'), 'background', picked ? '#e8effc' : '#fff');
    put(one('pick'), 'box-shadow', picked ? 'inset 0 0 0 3px #2869dd' : 'none');
    put(one('pickdot'), 'box-shadow', picked ? 'inset 0 0 0 3px #2869dd, inset 0 0 0 7px #fff' : 'inset 0 0 0 2.5px #9ba0a8');
    put(one('pickdot'), 'background', picked ? '#2869dd' : '#fff');
    press(one('finish'), l, QZ.finish, 0.08);
    leave(one('runout'), l, QZ.result, -180);
    // The result, scrolled down to the question and its explanation.
    slideIn(one('result'), l, QZ.result + 120, { dx: 160, dur: 560, smear: 10 });
    put(one('resultscroll'), 'transform', `translate3d(0,${(-430 * ease.inOut(seg(l, QZ.explain, 900))).toFixed(1)}px,0)`);

    // 5 · the author's table: the page scrolled to it, the student's row coming in between the others.
    put(one('statscroll'), 'transform', `translate3d(0,${(-350 * ease.inOut(seg(l, QZ.table + 100, 800))).toFixed(1)}px,0)`);
    const row = ease.inOut(seg(l, QZ.row, 520));
    put(one('after-row'), 'transform', `translate3d(0,${(84 * row).toFixed(1)}px,0)`);
    focusRow(one('newrow'), l, QZ.row + 220, 420);
    put(one('newrow'), 'background', l >= QZ.row + 220 ? `rgba(244, 196, 91, ${(0.26 * (1 - seg(l, QZ.row + 1400, 900))).toFixed(3)})` : 'transparent');
    opacity(one('sum0'), 1 - seg(l, QZ.row + 300, 200));
    opacity(one('sum1'), seg(l, QZ.row + 360, 240));
  });

  return (
    <div ref={root} className="mr-scene">
      <Loop total={QUIZ_TOTAL}>
        {/* 1 · the studio: «Отправить по ссылке». */}
        <div data-a="studio" className="sx-screen">
          <StudioStill title={QUIZ_EXAMPLE.exam} send="send" />
        </div>

        {/* The test's page: the link, «Показать QR», the people. */}
        <div data-a="stats" className="sx-screen" style={{ opacity: 0 }}>
          <div data-a="statscroll" className="sx-screen">
            <div className="sx-strip">
              <Wordmark className="sx-strip-mark" />
              {['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс'].map((item) => (
                <span key={item} className={item === 'Экзамены' ? 'is-on' : undefined}>
                  {item}
                </span>
              ))}
            </div>
            <div className="qz-crumbs">
              <span className="sx-back qz-crumb">
                <BackArrow />
                {QUIZ_EXAMPLE.exam}
              </span>
              <span className="sx-back qz-crumb">{QUIZ.names}</span>
            </div>
            <p className="fm-h1 qz-h1">{QUIZ_EXAMPLE.title}</p>
            <p className="fm-muted qz-meta">{QUIZ_WORDS.meta}</p>
            <p data-a="created" className="qz-created" style={{ opacity: 0 }}>
              {QA_STATS.created}
            </p>
            <p className="qz-label">{QA_STATS.link}</p>
            <div className="qz-linkrow">
              <span className="qz-field">https://{QUIZ_EXAMPLE.link}</span>
              <span className="qz-copy">{QA_STATS.copy}</span>
            </div>
            <div className="qz-share">
              <span data-a="qrbtn" className="qz-sbtn">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM12 12h1.5v1.5H12zM15 15h1.5v1.5H15zM12 15h1.5M15 12h1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                {QA_STATS.qr}
              </span>
              <span className="qz-sbtn">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M11 4h5v5M16 4l-7 7M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {QA_STATS.asTaker}
              </span>
            </div>
            <p className="qz-sum">
              <span data-a="sum0">{QUIZ_TABLE.before}</span>
              <span data-a="sum1" style={{ opacity: 0 }}>
                {QUIZ_TABLE.after}
              </span>
            </p>
            <div className="fm-card qz-table">
              <div className="qz-row qz-head fm-muted">
                <span className="qz-c1">{QA_PEOPLE.head.name}</span>
                <span className="qz-c2">{QA_PEOPLE.head.status}</span>
                <span className="qz-c3">{QA_PEOPLE.head.result}</span>
                <span className="qz-c4">{QA_PEOPLE.head.minutes}</span>
              </div>
              <Row {...QUIZ_TABLE.rows[0]} />
              <div className="qz-slot">
                <Row data="newrow" {...QUIZ_TABLE.added} guest />
                <div data-a="after-row" className="qz-after">
                  <Row {...QUIZ_TABLE.rows[1]} />
                </div>
              </div>
            </div>
          </div>
          <i data-a="veil" className="qz-veil" style={{ opacity: 0 }} />
        </div>

        {/* «Показать QR»: the code over the whole screen. */}
        <div data-a="qr" className="qz-qr" style={{ opacity: 0 }}>
          <div data-a="qrin" className="qz-qr-in">
            <p className="qz-qr-t fm-muted">{QUIZ_EXAMPLE.title}</p>
            <div className="qz-qr-card">
              <QrPattern />
            </div>
            <p className="qz-qr-link">{QUIZ_EXAMPLE.link}</p>
            <p className="qz-qr-hint fm-muted">{QA_STATS.qrHint}</p>
          </div>
        </div>

        {/* 2–4 · the student's phone. */}
        <div data-a="phone" className="qz-phone" style={{ opacity: 0 }}>
          <div className="qz-screen">
            {/* The start page. */}
            <div data-a="takestart" className="qz-pscreen">
              <div data-a="startscroll" className="qz-pscroll">
                <Wordmark className="qz-mark" />
                <div className="qz-pcard">
                  <div className="qz-cover">
                    <svg viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M0 78 L60 52 L110 70 L170 34 L230 66 L290 44 L350 62 L400 50 L400 120 L0 120Z" fill="#b9c6c0" />
                      <path d="M0 92 L80 74 L150 88 L220 70 L300 86 L400 76 L400 120 L0 120Z" fill="#98aba3" />
                    </svg>
                  </div>
                  <p className="qz-ptitle">{QUIZ_EXAMPLE.title}</p>
                  <p className="qz-pauthor fm-muted">
                    {TAKE.author(QUIZ_EXAMPLE.author)} · {TAKE.exam('Химия, 9 класс')}
                  </p>
                  <p className="qz-pmeta">{QUIZ_WORDS.takeMeta}</p>
                  <p className="qz-plabel">{QUIZ_WORDS.nameLabel}</p>
                  <p className="qz-pfield">
                    <span data-a="name" />
                    <i data-a="caret" className="fm-caret" style={{ opacity: 0 }} />
                  </p>
                  <p className="qz-phint fm-muted">{TAKE.nameHint}</p>
                  <span data-a="start" className="fm-btn fm-btn--blue sx-pill qz-pstart">
                    <span className="sx-pill-t">{TAKE.start}</span>
                    <i>
                      <Arrow />
                    </i>
                  </span>
                </div>
              </div>
            </div>

            {/* The first question. */}
            <div data-a="runout" className="qz-pscreen">
              <div data-a="run" className="qz-pscreen" style={{ opacity: 0 }}>
                <div className="qz-runbar">
                  <span>{QUIZ_WORDS.place}</span>
                  <span data-a="finish" className="sx-link qz-finish">
                    {RUN.finish}
                  </span>
                </div>
                <i className="qz-runtrack" />
                <p className="qz-ctx fm-muted">{QUIZ_EXAMPLE.title}</p>
                <p className="qz-stem">{QUIZ_EXAMPLE.stem}</p>
                <div className="qz-opts">
                  {QUIZ_EXAMPLE.options.map((option, index) => (
                    <span key={option} data-a={index === QUIZ_EXAMPLE.picked ? 'pick' : undefined} className="qz-opt">
                      <i data-a={index === QUIZ_EXAMPLE.picked ? 'pickdot' : undefined} className="qz-radio" />
                      <b>{LETTERS[index]}</b>
                      {option}
                    </span>
                  ))}
                </div>
                <p className="qz-saved fm-muted">
                  <span className="sx-link">{RUN.all}</span>
                  <span>{RUN.saved}</span>
                </p>
              </div>
            </div>

            {/* The result. */}
            <div data-a="result" className="qz-pscreen" style={{ opacity: 0 }}>
              <div className="qz-resbar">
                <b>{RESULT.barShort}</b>
                <span className="sx-link">{RESULT.close}</span>
              </div>
              <div className="qz-resclip">
                <div data-a="resultscroll" className="qz-pscroll">
                  <p className="qz-attempt fm-muted">{RESULT.attemptLine(1, QUIZ_EXAMPLE.when)}</p>
                  <p className="qz-rtitle">{QUIZ_EXAMPLE.title}</p>
                  <p className="qz-score">{QUIZ_WORDS.score}</p>
                  <span className="qz-scorebar">
                    <i style={{ width: `${QUIZ_EXAMPLE.percent}%` }} />
                    <b style={{ left: `${QUIZ_EXAMPLE.pass}%` }} />
                  </span>
                  <p className="qz-pass">{QUIZ_WORDS.pass}</p>
                  <p className="qz-rh">{RESULT.answersTitle}</p>
                  <div className="qz-rcard">
                    <p className="qz-rno fm-muted">{RESULT.itemNo(1)}</p>
                    <p className="qz-rstem">{QUIZ_EXAMPLE.stem}</p>
                    <div className="qz-ropts">
                      {QUIZ_EXAMPLE.options.map((option, index) => (
                        <span key={option} className={`qz-ropt${index === QUIZ_EXAMPLE.picked ? ' is-wrong' : ''}${index === QUIZ_EXAMPLE.right ? ' is-missed' : ''}`}>
                          <b>{LETTERS[index]}</b>
                          <span>
                            {option}
                            {index === QUIZ_EXAMPLE.picked ? <small className="qz-tag-wrong">{RESULT.tagMineWrong}</small> : null}
                            {index === QUIZ_EXAMPLE.right ? <small className="qz-tag-missed">{RESULT.tagMissed}</small> : null}
                          </span>
                        </span>
                      ))}
                    </div>
                    <div className="qz-explain">
                      <p className="qz-explain-h">{RESULT.explanation}</p>
                      <p className="qz-explain-t">{QUIZ_EXAMPLE.explanation}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Loop>
    </div>
  );
}
