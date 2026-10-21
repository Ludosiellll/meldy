/**
 * «Быстрая контрольная» (UX audit of 21.10, P4: the teacher's first card of the first run): «Тесты» on «Экзамены» and
 * the blue «Быстрая контрольная»; questions pasted as they are in Word, found as cards on the right; a tap on the right
 * variant of the question that had none; «Получить ссылку» and the link with its QR code at once. Every word is the
 * screens' own (components/quick/copyQuick.ts); the example is a chemistry test.
 */
import { useRef } from 'react';
import { opacity, put, useEls, useFrame } from '../../reel/engine';
import { ease, seg } from '../../reel/timeline';
import { Wordmark } from '../../film/kit';
import { QUICK, QUICK_LINK, QUIZ_MEANS, TESTS_VIEW } from '../../quick/copyQuick';
import type { ClipStep } from '../types';
import { Arrow, Loop, Plus, arrive, leave, press } from './kit';
import './quick.css';

export const QUICK_TOTAL = 12500;

/** Scene times (ms). */
export const QK = {
  door: 1000,
  page: 1500,
  paste: 2700,
  found: 3100,
  ask: 5100,
  pick: 6100,
  get: 8100,
  link: 8500,
} as const;

export const QUICK_STEPS: readonly ClipStep[] = [
  { at: 0, caption: `Откройте «${TESTS_VIEW.tests}» и нажмите «${TESTS_VIEW.quick}».`, still: 900 },
  { at: 2300, caption: 'Вставьте вопросы из Word или из чата.', still: 4600 },
  { at: 5000, caption: 'Нажмите на верный вариант, если он не отмечен.', still: 7000 },
  { at: 7600, caption: `Нажмите «${QUICK.submit}». Ссылка и QR-код готовы.`, still: 11000 },
];

export const QUICK_EXAMPLE = {
  title: 'Кислоты и основания, 9 Б',
  lines: [
    '1. Какой индикатор краснеет',
    'в кислой среде?',
    'а) фенолфталеин',
    'б) лакмус *',
    '',
    '2. Сколько атомов водорода',
    'в молекуле воды?',
    'Ответ: 2',
    '',
    '3. Какая кислота в желудке?',
    'а) соляная б) уксусная',
  ],
  questions: [
    { stem: 'Какой индикатор краснеет в кислой среде?', options: ['фенолфталеин', 'лакмус'], right: 1 },
    { stem: 'Сколько атомов водорода в молекуле воды?', answer: '2' },
    { stem: 'Какая кислота в желудке?', options: ['соляная', 'уксусная'], right: -1 },
  ],
  link: 'meldy.ru/k/p4x8m2k9t6qa',
} as const;

const LETTERS = ['А', 'Б'];

/** A QR code drawn as a picture (a fixed pattern: the clip's code is not meant to be scanned). */
function Qr() {
  const n = 25;
  const cells: Array<[number, number]> = [];
  let seed = 11;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const finder = (x: number, y: number) => x < 7 && y < 7;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (finder(x, y) || finder(n - 1 - x, y) || finder(x, n - 1 - y)) continue;
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
    <svg className="qx-qr-code" viewBox={`-1 -1 ${n + 2} ${n + 2}`} aria-hidden="true" shapeRendering="crispEdges">
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

function Strip() {
  return (
    <div className="sx-strip">
      <Wordmark className="sx-strip-mark" />
      {['Сегодня', 'Экзамены', 'Лекции', 'Повторение', 'Прогресс'].map((item) => (
        <span key={item} className={item === 'Экзамены' ? 'is-on' : undefined}>
          {item}
        </span>
      ))}
    </div>
  );
}

export function QuickScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    // 1 · «Тесты»: the blue door.
    press(one('door'), l, QK.door, 0.06);
    leave(one('tests'), l, QK.page);
    arrive(one('quick'), l, QK.page);

    // 2 · the pasted lines all at once, the questions found coming in as cards.
    all('line').forEach((line, at) => opacity(line, seg(l, QK.paste + at * 18, 160)));
    opacity(one('placeholder'), 1 - seg(l, QK.paste - 60, 120));
    opacity(one('none'), 1 - seg(l, QK.found - 80, 160));
    opacity(one('found'), seg(l, QK.found, 220));
    all('q').forEach((card, at) => {
      const p = ease.out(seg(l, QK.found + at * 150, 520));
      opacity(card, p);
      put(card, 'transform', `translate3d(0,${(28 * (1 - p)).toFixed(1)}px,0)`);
    });

    // 3 · the question without its answer asks for a tap; the tap marks «соляная».
    const asked = seg(l, QK.ask, 300) * (1 - seg(l, QK.pick + 60, 200));
    put(one('q3'), 'box-shadow', `0 0 0 ${(2 + 2 * asked).toFixed(2)}px rgba(244, 196, 91, ${(0.55 + 0.45 * asked).toFixed(3)})`);
    const marked = l >= QK.pick + 60;
    put(one('q3'), 'background', marked ? '#fff' : '#fcefc9');
    opacity(one('ask'), marked ? 0 : 1);
    opacity(one('badge'), seg(l, QK.found, 220) * (1 - seg(l, QK.pick + 60, 200)));
    press(one('pick'), l, QK.pick, 0.04);
    put(one('pick'), 'background', marked ? '#e2f2e5' : '#fff');
    put(one('pick'), 'box-shadow', marked ? 'inset 0 0 0 3px #8acb97' : 'inset 0 0 0 2px #e4e4de');
    opacity(one('pickok'), marked ? 1 : 0);
    opacity(one('sum2'), marked ? 0 : 1);
    opacity(one('sum3'), marked ? 1 : 0);

    // 4 · «Получить ссылку»; the link with its QR code.
    press(one('get'), l, QK.get, 0.06);
    leave(one('quickout'), l, QK.link);
    arrive(one('link'), l, QK.link);
    const qr = ease.out(seg(l, QK.link + 500, 520));
    opacity(one('qr'), qr);
    put(one('qr'), 'transform', `scale(${(0.94 + 0.06 * qr).toFixed(4)})`);
  });

  const [q1, q2, q3] = QUICK_EXAMPLE.questions;
  return (
    <div ref={root} className="mr-scene">
      <Loop total={QUICK_TOTAL}>
        <Strip />

        {/* 1 · «Экзамены | Тесты» on «Тесты»: the two doors. */}
        <div data-a="tests" className="sx-screen">
          <div className="qx-switch">
            <span>
              {TESTS_VIEW.exams} <small>1</small>
            </span>
            <span className="is-on">
              {TESTS_VIEW.tests} <small>2</small>
            </span>
          </div>
          <p className="fm-h1 qx-h1">{TESTS_VIEW.title}</p>
          <p className="fm-muted qx-lede">{QUIZ_MEANS}</p>
          <span data-a="door" className="fm-btn fm-btn--blue sx-pill qx-door">
            <span className="sx-pill-t">{TESTS_VIEW.quick}</span>
            <i>
              <Arrow />
            </i>
          </span>
          <span className="qx-door2">
            {TESTS_VIEW.studio}
            <i>
              <Plus />
            </i>
          </span>
          <div className="fm-card qx-test qx-test--1">
            <p className="qx-test-t">Кислоты и основания</p>
            <p className="qx-tags">
              <span>12 вопросов</span>
              <span>2 контрольные</span>
            </p>
          </div>
          <div className="fm-card qx-test qx-test--2">
            <p className="qx-test-t">Входной тест по химии</p>
            <p className="qx-tags">
              <span>8 вопросов</span>
            </p>
          </div>
        </div>

        {/* 2–4 · «Быстрая контрольная»: the text, the questions found, the pills and «Получить ссылку». */}
        <div data-a="quick" className="sx-screen" style={{ opacity: 0 }}>
          <div data-a="quickout" className="sx-screen">
            <p className="fm-h1 qx-h1 qx-h1--quick">{QUICK.title}</p>
            <div className="fm-card qx-write">
              <p className="qx-label">{QUICK.name}</p>
              <p className="qx-field qx-field--name">{QUICK_EXAMPLE.title}</p>
              <p className="qx-label">{QUICK.text}</p>
              <div className="qx-field qx-field--text">
                <p data-a="placeholder" className="qx-placeholder">
                  1. …
                </p>
                {QUICK_EXAMPLE.lines.map((line, at) => (
                  <p key={at} data-a="line" className="qx-line" style={{ opacity: 0 }}>
                    {line || ' '}
                  </p>
                ))}
              </div>
            </div>
            <div className="fm-card qx-found">
              <div className="qx-found-head">
                <p className="qx-h2">
                  <span data-a="none">{QUICK.found(0)}</span>
                  <span data-a="found" style={{ opacity: 0 }}>
                    {QUICK.found(3)}
                  </span>
                </p>
                <span data-a="badge" className="qx-badge" style={{ opacity: 0 }}>
                  {QUICK.noKey(1)}
                </span>
              </div>
              <div className="qx-qs">
                <div data-a="q" className="qx-q" style={{ opacity: 0 }}>
                  <p className="qx-q-no">{QUICK.number(1)}</p>
                  <p className="qx-q-stem">{q1.stem}</p>
                  {q1.options.map((option, at) => (
                    <span key={option} className={`qx-opt${at === q1.right ? ' is-right' : ''}`}>
                      <b>{LETTERS[at]}</b>
                      {option}
                      {at === q1.right ? <em>{QUICK.right}</em> : null}
                    </span>
                  ))}
                </div>
                <div data-a="q" className="qx-q" style={{ opacity: 0 }}>
                  <p className="qx-q-no">{QUICK.number(2)}</p>
                  <p className="qx-q-stem">{q2.stem}</p>
                  <span className="qx-short">{QUICK.shortAnswer([q2.answer])}</span>
                </div>
                <div data-a="q" className="qx-q qx-q--wide" style={{ opacity: 0 }}>
                  <div data-a="q3" className="qx-q3">
                    <p className="qx-q-no">{QUICK.number(3)}</p>
                    <p data-a="ask" className="qx-ask">
                      {QUICK.tapRight}
                    </p>
                    <p className="qx-q-stem">{q3.stem}</p>
                    <div className="qx-row">
                      {q3.options.map((option, at) => (
                        <span key={option} data-a={at === 0 ? 'pick' : undefined} className="qx-opt">
                          <b>{LETTERS[at]}</b>
                          {option}
                          {at === 0 ? (
                            <em data-a="pickok" style={{ opacity: 0 }}>
                              {QUICK.right}
                            </em>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="qx-bar">
              <span className="qx-chip">{QUICK.who.guests}</span>
              <span className="qx-chip">{QUICK.time.none}</span>
              <span className="qx-chip">{QUICK.open.days(7)}</span>
              <span className="qx-sum">
                <span data-a="sum2">{QUICK.inQuiz(2)}</span>
                <span data-a="sum3" style={{ opacity: 0 }}>
                  {QUICK.inQuiz(3)}
                </span>
              </span>
              <span data-a="get" className="fm-btn fm-btn--blue sx-pill qx-get">
                <span className="sx-pill-t">{QUICK.submit}</span>
                <i>
                  <Arrow />
                </i>
              </span>
            </div>
          </div>
        </div>

        {/* 4 · the link and its QR code. */}
        <div data-a="link" className="sx-screen" style={{ opacity: 0 }}>
          <p className="qx-ready">{QUICK_LINK.ready}</p>
          <p className="fm-h1 qx-h1 qx-h1--link">{QUICK_EXAMPLE.title}</p>
          <p className="qx-tags qx-tags--link">
            <span>{QUICK_LINK.guests}</span>
            <span>{QUICK_LINK.questions(3)}</span>
            <span>{QUICK_LINK.noTime}</span>
          </p>
          <div className="fm-card qx-share">
            <div data-a="qr" className="qx-qr" style={{ opacity: 0 }}>
              <Qr />
            </div>
            <div className="qx-share-side">
              <p className="qx-field qx-field--link">{QUICK_EXAMPLE.link}</p>
              <span className="fm-btn fm-btn--blue sx-pill qx-copy">
                <span className="sx-pill-t">{QUICK_LINK.copy}</span>
                <i>
                  <Arrow />
                </i>
              </span>
              <p className="fm-muted qx-hint">{QUICK_LINK.hint}</p>
            </div>
          </div>
        </div>
      </Loop>
    </div>
  );
}
