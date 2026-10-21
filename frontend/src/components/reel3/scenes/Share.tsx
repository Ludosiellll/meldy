/**
 * The constructor's end: «Отправить по ссылке» with the link and its QR code (the real code of the public example
 * test), a participant answering on a phone without an account, and the author's results filling in («пишут · сдали ·
 * средний», components/quiz/copyAuthor.ts).
 */
import { useMemo, useRef } from 'react';
import { qrCode } from '../../../lib/quizzes/qr';
import { flag, put, useEls, useFrame } from '../../reel/engine';
import { EXAMPLE, SAY, SAMPLE_TEST_URL, SITE } from '../../home3/copy3';
import { PAPER_URL, GRAPH_URL } from '../../home3/art';
import { Arrow, Count, Say, appear, ease, move, seg } from '../kit3';
import { Cursor, pressAt, usePointer, type CursorKey } from '../pointer3';

export function Qr({ className }: { className?: string }) {
  const code = useMemo(() => qrCode(`${SITE}${SAMPLE_TEST_URL}`), []);
  return (
    <svg className={className} viewBox={`-2 -2 ${code.size + 4} ${code.size + 4}`} role="img" aria-label="QR-код ссылки на тест">
      <rect x="-2" y="-2" width={code.size + 4} height={code.size + 4} fill="#fff" />
      <path d={code.path} fill="#0b121c" />
    </svg>
  );
}

/** «Отправить по ссылке», then «Скопировать»; the pointer comes from under the bar and rests in the card's corner. */
export const SEND_KEYS: readonly CursorKey[] = [
  { t: 200, aim: 'studio', fx: 0.45, fy: 1, dy: 26 },
  { t: 650, aim: 'send', press: true, fx: 0.42 },
  { t: 1600, aim: 'copy', press: true },
  { t: 2300, aim: 'share', fx: 0.86, fy: 0.93 },
  { t: 3500, hide: true },
];
const SENT = pressAt(SEND_KEYS, 'send');
const COPIED = pressAt(SEND_KEYS, 'copy');

export function SendScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const pointer = usePointer(SEND_KEYS);
  useFrame((l) => {
    appear(one('studio'), l, 0, 1, 0, SENT + 250);
    appear(one('share'), l, SENT + 530, 420, 16);
    flag(one('copy'), 'is-done', l >= COPIED);
    const grow = ease.brand(seg(l, 2300, 700));
    move(one('qr'), -40 * grow, -26 * grow, 1 + 0.42 * grow);
  });
  return (
    <div ref={root} className="r3-scene is-flip">
      <Say text={SAY.send[0]} at={300} />
      <div className="r3-ui">
        <div data-a="studio" data-aim="studio" className="r3-card r3-sendbar">
          <span className="r3-st-name">
            <b>{EXAMPLE.testTitle}</b>
            <small>Сохранено</small>
          </span>
          <span data-a="send" data-aim="send" className="r3-btn r3-btn--s">
            Отправить по ссылке
            <i>
              <Arrow />
            </i>
          </span>
        </div>
        <div data-a="share" data-aim="share" className="r3-card r3-share" style={{ opacity: 0 }}>
          <p className="r3-h r3-h--s">Ссылка для участников</p>
          <div className="r3-linkrow">
            <span className="r3-field r3-field--long">{EXAMPLE.link}</span>
            <span data-a="copy" data-aim="copy" data-aim-on="is-done" className="r3-copy">
              <span>Скопировать</span>
              <span>Скопировано</span>
            </span>
          </div>
          <div className="r3-share-qr">
            <span data-a="qr" className="r3-qr">
              <Qr />
            </span>
            <span className="r3-share-acts">
              <span className="r3-mini">Показать QR</span>
              <span className="r3-mini">Поделиться</span>
              <span className="r3-mini">Открыть как ученик</span>
            </span>
          </div>
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}

/** How far the participant scrolls the page to reach «Дальше» under the options (UI px). */
const TAKE_SCROLL = 36;

/** «Вырастет», a scroll (the pointer still), then «Дальше»; the pointer waits beside the phone. */
export const TAKE_KEYS: readonly CursorKey[] = [
  { t: 700, aim: 'phone', fx: 1, fy: 0.74, dx: 30 },
  { t: 1150, aim: 'pick', press: true, fx: 0.35 },
  { t: 2000, aim: 'next', press: true, dy: -TAKE_SCROLL },
  { t: 2700, aim: 'phone', fx: 1, fy: 0.8, dx: 30 },
  { t: 3500, hide: true },
];
const PICKED = pressAt(TAKE_KEYS, 'pick');
const NEXT = pressAt(TAKE_KEYS, 'next');

export function TakeScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const pointer = usePointer(TAKE_KEYS);
  useFrame((l) => {
    const rise = ease.brand(seg(l, 100, 600));
    appear(one('phone'), l, 100, 300, 0);
    move(one('phone'), 0, 60 * (1 - rise));
    flag(one('pick'), 'is-picked', l >= PICKED);
    move(one('scroll'), 0, -TAKE_SCROLL * ease.inOut(seg(l, PICKED + 200, 400)));
    // The question is gone before the result comes up: nothing of it shows under the result card.
    appear(one('q'), l, 0, 1, 0, NEXT + 150);
    appear(one('result'), l, NEXT + 420, 420, 14);
  });
  return (
    <div ref={root} className="r3-scene">
      <Say text={SAY.take[0]} at={300} />
      <div className="r3-ui">
        <div data-a="phone" data-aim="phone" className="r3-phone" style={{ opacity: 0 }}>
          <div className="r3-phone-in r3-take">
            <span className="r3-take-bg">
              <img src={PAPER_URL} alt="" />
            </span>
            <p className="r3-url">{EXAMPLE.link}</p>
            <div data-a="q" className="r3-take-page">
              <div data-a="scroll" className="r3-take-scroll">
              <div className="r3-take-cover">
                <img src={GRAPH_URL} alt="" />
                <p>{EXAMPLE.testTitle}</p>
                <small>{EXAMPLE.author} · 5 вопросов</small>
              </div>
              <div className="r3-take-card">
                <p className="r3-meta">Вопрос 1 из 5</p>
                <p className="r3-stem r3-stem--s">{EXAMPLE.testStem}</p>
                {EXAMPLE.testOptions.map((option, index) => (
                  <span
                    key={option}
                    data-a={index === EXAMPLE.testRight ? 'pick' : undefined}
                    data-aim={index === EXAMPLE.testRight ? 'pick' : undefined}
                    data-aim-on={index === EXAMPLE.testRight ? 'is-picked' : undefined}
                    className="r3-take-opt"
                  >
                    <i />
                    {option}
                  </span>
                ))}
                <span data-a="next" data-aim="next" className="r3-take-next">
                  Дальше
                </span>
              </div>
              </div>
            </div>
            <div data-a="result" className="r3-take-result" style={{ opacity: 0 }}>
              <p className="r3-meta">{EXAMPLE.testTitle}</p>
              <p className="r3-take-score">4 из 5</p>
              <p className="r3-meta">80 %</p>
              <p className="r3-take-band">Отлично</p>
              <p className="r3-take-band-t">Ниже ответы и пояснения к каждому вопросу.</p>
            </div>
          </div>
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}

const PEOPLE = [
  { name: 'Анна К.', status: 'пишет — 3 из 5', time: '', live: true },
  { name: 'Дмитрий С.', guest: true, status: '5 из 5 · 100 %', time: '6 мин' },
  { name: 'Мария Л.', status: '4 из 5 · 80 %', time: '8 мин' },
  { name: 'Илья П.', guest: true, status: '3 из 5 · 60 %', time: '9 мин' },
];

export function StatsScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    appear(one('card'), l, 100, 450, 18);
    all('person').forEach((row, index) => appear(row, l, 700 + index * 380, 360, 8));
    appear(one('qs'), l, 2500, 400, 10);
    const fill = ease.brand(seg(l, 2800, 900));
    all('qbar').forEach((bar, index) => {
      put(bar, 'transform', `scaleX(${(fill * (index === 0 ? 0.38 : 0.91)).toFixed(3)})`);
    });
  });
  return (
    <div ref={root} className="r3-scene is-flip">
      <Say text={SAY.stats[0]} at={300} />
      <div className="r3-ui">
        <div data-a="card" className="r3-card r3-stats" style={{ opacity: 0 }}>
          <p className="r3-meta">{EXAMPLE.testTitle} · Результаты</p>
          <p className="r3-stats-counts">
            пишут <Count from={2} to={3} at={1800} dur={200} /> · сдали <Count from={18} to={23} at={600} dur={2200} /> · средний 71 %
          </p>
          <p className="r3-side-tabs r3-side-tabs--ink">
            <span className="is-on">Участники</span>
            <span>Вопросы</span>
          </p>
          {PEOPLE.map((person) => (
            <p key={person.name} data-a="person" className={`r3-person${person.live ? ' is-live' : ''}`} style={{ opacity: 0 }}>
              <b>
                {person.name}
                {person.guest ? <small>без входа</small> : null}
              </b>
              <span>{person.status}</span>
              <span>{person.time}</span>
            </p>
          ))}
          <div data-a="qs" className="r3-qs" style={{ opacity: 0 }}>
            <p>
              <span>2. Неэластичный спрос и выручка</span>
              <i>
                <b data-a="qbar" />
              </i>
              <em>38 %</em>
            </p>
            <p>
              <span>1. Что показывает эластичность</span>
              <i>
                <b data-a="qbar" />
              </i>
              <em>91 %</em>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
