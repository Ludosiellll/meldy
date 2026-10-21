/**
 * «Игра в классе»: the guide's clip of the live game, from the teacher's button to the floor that drops (the test page's
 * first-use tip plays it too, tips/scenes). One 4:3 stage (1440 × 1080), five moments: the test's page and «Провести
 * игру»; the setup, where «Встань на ответ» is picked and the room opened; the projector with the PIN and the QR code;
 * two phones joining, one on the site and one in Telegram; the question, the class running to the answer, and the rest
 * of the floor dropping. The projector is drawn in the game's own colours, simplified (flat, no 3D); the words are the
 * screens' own (the test's page, live/host/copy, the stand game's projector).
 *
 * A file of its own, without the other chapters' scenes: the tip's clip (tips/clipPart) loads only this one.
 */
import { useRef, type ReactNode } from 'react';
import { blur, opacity, put, text as setText, useEls, useFrame } from '../../reel/engine';
import { clamp, ease, mix, rng, seg } from '../../reel/timeline';
import { Arrow, Statement, Typed, Wordmark, pressDepth, slideIn, slideOut } from '../../film/kit';
import { TEST_HOME } from '../../test/copyTest';
import { ENTRY, MODE, SETUP, pinText } from '../../live/host/copy';
import { PLAY_SITE } from '../chapters';
import './game.css';

/** The clip's length: longer than a chapter's usual 6.4 s, it goes from a button to a whole round of the game. */
export const GAME_CLIP = 12000;
/** The still frame (reduced motion): the floor has dropped, «Устояли 18 из 24» is in. */
export const GAME_POSTER = 10900;
/** The guide's 4:3 stage (clips.ts GUIDE_W × GUIDE_H): the tip plays the clip on it too. */
export const GAME_STAGE = { width: 1440, height: 1080 } as const;

/** Scene times (ms). */
export const GM = {
  /** The test's page comes into focus here; the statement has left. */
  focus: 1900,
  /** «Провести игру» pressed. */
  press: 2650,
  /** The setup comes in. */
  setup: 3000,
  /** «Встань на ответ» picked. */
  pick: 3750,
  /** «Открыть комнату» pressed. */
  open: 4400,
  /** The projector comes in: the PIN and the QR code. */
  lobby: 4700,
  /** The phones come up. */
  phones: 5300,
  /** The PIN typed on the site, then «Дальше». */
  type: 5600,
  joinSite: 6200,
  /** «Играть» in the Telegram chat. */
  joinTg: 6450,
  /** The rest of the class comes in. */
  crowd: 6650,
  /** The question on the board; the phones go. */
  question: 7550,
  /** Everyone runs to an answer. */
  run: 7900,
  /** The wrong part of the floor drops. */
  drop: 9500,
  /** «Верный ответ» and «Устояли 18 из 24». */
  result: 10100,
} as const;

/** The example: the test, its game and the PIN. */
export const GAME_EXAMPLE = {
  test: 'Кислоты и основания',
  questions: 12,
  quiz: 'Кислоты и основания, 9 Б',
  pin: '482913',
  site: PLAY_SITE,
  chat: '9 Б, химия',
  question: 'Какая кислота есть в желудке?',
  answers: ['Соляная', 'Серная', 'Азотная', 'Угольная'],
  right: 0,
} as const;

/** «Встань на ответ» as its setup and projector say it (components/live/stand/copy.ts on the game's branch). */
const STAND = {
  name: 'Встань на ответ',
  about: 'Ученики бегут на верный ответ. Остальной пол проваливается.',
  hint: 'Встаньте на верный ответ. Остальной пол провалится.',
  right: 'Верный ответ',
  playing: 'Играют',
  go: 'Заходите на',
  camera: 'Или наведите камеру телефона на код.',
};
const LETTERS = ['А', 'Б', 'В', 'Г'] as const;
const NB = ' ';

// ---------------------------------------------------------------------------------------------
// The floor and the class

/** The floor (stage px inside the projector): four zones, a path between them. */
const FLOOR = { left: 110, top: 350, width: 1220, height: 640 } as const;
const ZONE_W = 560;
const ZONE_H = 280;
/** The zones' top-left corners in the floor. */
const ZONES = [
  { x: 0, y: 0 },
  { x: FLOOR.width - ZONE_W, y: 0 },
  { x: 0, y: FLOOR.height - ZONE_H },
  { x: FLOOR.width - ZONE_W, y: FLOOR.height - ZONE_H },
] as const;

const COLOURS = ['#f08a3c', '#4d8af0', '#f5c13d', '#3cc47c', '#ee7fb6', '#2fc0c4', '#9b7cf0', '#ef6a62'];
const NAMES = [
  'Аня', 'Дима', 'Соня', 'Миша', 'Лиза', 'Егор', 'Вера', 'Глеб', 'Катя', 'Илья', 'Таня', 'Паша',
  'Оля', 'Федя', 'Юля', 'Артём', 'Даша', 'Никита', 'Ева', 'Рома', 'Маша', 'Лёва', 'Вика', 'Саша',
];
/** Where each one runs: 18 to the right answer, the rest to the others. */
const PICKS = [0, 0, 1, 0, 0, 3, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 3, 0, 0, 1, 0, 0, 0, 0];
export const GAME_PLAYERS = NAMES.length;
export const GAME_STOOD = PICKS.filter((pick) => pick === GAME_EXAMPLE.right).length;

interface Kid {
  name: string;
  colour: string;
  /** In the lobby, then at the answer (floor px, the middle of the body). */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Comes in at this scene time; starts to run at `go`. */
  join: number;
  go: number;
  pick: number;
}

/** The class: places in the lobby and at the answers, the moments they come in and run (always the same). */
function makeKids(): Kid[] {
  const random = rng(4829);
  let onRight = 0;
  const into = (zone: number) => {
    const corner = ZONES[zone];
    if (zone === GAME_EXAMPLE.right) {
      // Six in a row, three rows, under the zone's letter: the names stay readable.
      const at = onRight;
      onRight += 1;
      const column = at % 6;
      const row = Math.floor(at / 6);
      return { x: corner.x + 62 + column * 86 + (row % 2) * 30 + (random() - 0.5) * 14, y: corner.y + 140 + row * 58 + (random() - 0.5) * 8 };
    }
    return { x: corner.x + 150 + random() * (ZONE_W - 220), y: corner.y + 130 + random() * (ZONE_H - 170) };
  };
  return NAMES.map((name, index) => {
    // The two who join from the phones stand at the left, where the phones do not cover them.
    const from =
      index === 0
        ? { x: 300, y: 330 }
        : index === 1
          ? { x: 470, y: 210 }
          : { x: 60 + random() * (FLOOR.width - 120), y: 80 + random() * (FLOOR.height - 130) };
    const crowd = GM.crowd + (index - 2) * 34;
    return {
      name,
      colour: COLOURS[index % COLOURS.length],
      from,
      to: into(PICKS[index]),
      join: index === 0 ? GM.joinSite + 150 : index === 1 ? GM.joinTg + 150 : crowd,
      go: GM.run + random() * 420,
      pick: PICKS[index],
    };
  });
}
const KIDS = makeKids();

/** How many are in the game at scene time `l`. */
export function playersAt(l: number): number {
  return KIDS.filter((kid) => l >= kid.join).length;
}

// ---------------------------------------------------------------------------------------------
// Motion

/** Shown from `from` to `to`, faded in and out over `fade` ms at its edges. */
const between = (l: number, from: number, to: number, fade = 160) => seg(l, from, fade) * (1 - seg(l, to, fade));

/** A screen that gives way to the next one: aside, out of focus, gone within a third of a second (as the exams' clip). */
function leave(el: HTMLElement | undefined, l: number, at: number) {
  const p = seg(l, at, 420);
  if (p <= 0) {
    put(el, 'transform', 'none');
    opacity(el, 1);
    blur(el, 0);
    return;
  }
  put(el, 'transform', `translate3d(${(-240 * ease.in(p)).toFixed(1)}px,0,0)`);
  opacity(el, 1 - ease.out(seg(l, at, 300)));
  blur(el, 18 * ease.out(p));
}

/** The next screen comes in from the right as the previous one leaves. */
const arrive = (el: HTMLElement | undefined, l: number, at: number) => slideIn(el, l, at + 160, { dx: 220, dur: 640, smear: 14 });

const press = (el: HTMLElement | undefined, l: number, at: number, depth = 0.06) =>
  put(el, 'transform', `scale(${(1 - depth * pressDepth(l, at)).toFixed(3)})`);

/** The common choreography of the guide's clips: the statement over the screen out of focus, then sharp, then gone. */
function Beat({ lines, children }: { lines: readonly string[]; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    const pull = ease.inOut(seg(l, GM.focus, 650));
    const out = ease.in(seg(l, GAME_CLIP - 760, 600));
    const ui = one('ui');
    put(ui, 'filter', `blur(${(mix(18, 0, pull) + 20 * out).toFixed(2)}px)`);
    put(ui, 'transform', `scale(${(mix(1.06, 1, pull) * mix(1, 0.97, out)).toFixed(4)})`);
    opacity(ui, clamp(seg(l, 100, 450) * 2) * mix(0.55, 1, pull) * (1 - out));
  });
  return (
    <div ref={root} className="mr-scene gp-scene">
      <div data-a="ui" className="gp-ui" style={{ opacity: 0 }}>
        {children}
      </div>
      <Statement lines={lines} at={300} out={GM.focus - 120} className="gp-say" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pieces

/** A deterministic pattern in the look of a QR code (not a code: a guide's frame must not open a real game). */
function QrLook() {
  const size = 25;
  const random = rng(913);
  const cells: string[] = [];
  const finder = (x: number, y: number) => x < 8 && y < 8;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (finder(x, y) || finder(size - 1 - x, y) || finder(x, size - 1 - y)) continue;
      if (random() < 0.47) cells.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  const eye = (x: number, y: number) => `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`;
  return (
    <svg className="gp-qr" viewBox={`-2 -2 ${size + 4} ${size + 4}`} shapeRendering="crispEdges" aria-hidden="true">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={`${cells.join('')}${eye(0, 0)}${eye(size - 7, 0)}${eye(0, size - 7)}`} fill="#0b121c" fillRule="evenodd" />
    </svg>
  );
}

/** A player as the projector shows one, simplified: a round body with eyes, a shadow and the name above. */
function KidMark({ kid }: { kid: Kid }) {
  return (
    <div data-a="kid" className="gp-kid" style={{ opacity: 0, transform: `translate3d(${kid.from.x}px,${kid.from.y}px,0)` }}>
      <i className="gp-kid-shadow" />
      <i className="gp-kid-body" style={{ background: kid.colour }}>
        <i className="gp-kid-eyes" />
      </i>
      <span className="gp-kid-name">
        <i style={{ background: kid.colour }} />
        {kid.name}
      </span>
    </div>
  );
}

function Monster() {
  return (
    <span className="gp-monster" aria-hidden="true">
      <i className="gp-monster-eye" />
      <i className="gp-monster-eye" />
      <i className="gp-monster-mouth" />
    </span>
  );
}

function MiniFloor() {
  return (
    <span className="gp-mini" aria-hidden="true">
      {LETTERS.map((letter, index) => (
        <i key={letter} className={`gp-mini-z gp-z${index}`} />
      ))}
      <i className="gp-mini-kid" style={{ left: 46, top: 30, background: COLOURS[0] }} />
      <i className="gp-mini-kid" style={{ left: 86, top: 52, background: COLOURS[1] }} />
      <i className="gp-mini-kid" style={{ left: 214, top: 104, background: COLOURS[3] }} />
    </span>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// The clip

export function Game() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((l) => {
    // 1 · The test's page: «Провести игру» pressed.
    press(one('host'), l, GM.press);
    const pressed = l >= GM.press;
    put(one('host'), 'background', pressed ? '#0b121c' : '#ffffff');
    put(one('host'), 'color', pressed ? '#ffffff' : '#0b121c');
    opacity(one('strip'), 1 - seg(l, GM.setup, 240));
    leave(one('page'), l, GM.setup);

    // 2 · The setup: «Встань на ответ» picked, «Открыть комнату».
    arrive(one('setup'), l, GM.setup);
    const picked = l >= GM.pick ? 1 : 0;
    all('mode').forEach((card, index) => {
      put(card, 'box-shadow', index === picked ? 'inset 0 0 0 4px #0b121c' : 'inset 0 0 0 2px #e4e4de');
      if (index === 1) press(card, l, GM.pick, 0.025);
    });
    all('tick').forEach((tick, index) => opacity(tick, index === picked ? 1 : 0));
    press(one('open'), l, GM.open);
    opacity(one('opena'), 1 - seg(l, GM.open + 40, 120));
    opacity(one('openb'), seg(l, GM.open + 40, 120));
    leave(one('setupout'), l, GM.lobby);

    // 3 · The projector: the PIN and the QR code; who has come in.
    arrive(one('proj'), l, GM.lobby);
    opacity(one('lobbyboard'), 1 - seg(l, GM.question, 220));
    setText(one('count'), String(playersAt(l)));
    opacity(one('playing'), 1 - seg(l, GM.question, 200));

    // 4 · The phones: the PIN on the site, «Играть» in Telegram.
    if (l < GM.question) {
      slideIn(one('site'), l, GM.phones, { dy: 720, dur: 700, smear: 14 });
      slideIn(one('tg'), l, GM.phones + 140, { dy: 720, dur: 700, smear: 14 });
    } else {
      slideOut(one('site'), l, GM.question, { dy: 760, dur: 520, smear: 14 });
      slideOut(one('tg'), l, GM.question + 60, { dy: 760, dur: 520, smear: 14 });
    }
    press(one('sitego'), l, GM.joinSite);
    press(one('tgplay'), l, GM.joinTg);
    put(one('tgplay'), 'background', l >= GM.joinTg && l < GM.joinTg + 400 ? '#dfe9f5' : '#f4f8fc');

    // 5 · The question, the run and the drop.
    opacity(one('qboard'), between(l, GM.question + 120, GM.result, 220));
    opacity(one('rboard'), seg(l, GM.result, 240));
    all('answer').forEach((label) => opacity(label, seg(l, GM.question + 200, 260)));
    const timer = one('timer');
    opacity(timer, between(l, GM.question + 120, GM.drop, 200));
    const left = Math.max(0, Math.ceil(5 * (1 - seg(l, GM.run, GM.drop - GM.run - 100))));
    setText(one('timern'), String(left));
    put(one('timerarc'), 'stroke-dasharray', `${(100 * (1 - seg(l, GM.run, GM.drop - GM.run - 100))).toFixed(2)} 100`);
    slideIn(one('stood'), l, GM.result + 260, { dy: 24, dur: 520, smear: 6 });

    const fall = ease.in(seg(l, GM.drop, 700));
    const shake = l >= GM.drop - 160 && l < GM.drop ? Math.sin((l - GM.drop) / 18) * 4 : 0;
    put(one('floor'), 'transform', `translate3d(${shake.toFixed(1)}px,0,0)`);
    all('zone').forEach((zone, index) => {
      if (index === GAME_EXAMPLE.right) return;
      put(zone, 'transform', `translate3d(0,${(70 * fall).toFixed(1)}px,0) scale(${mix(1, 0.9, fall).toFixed(4)})`);
      put(zone, 'filter', fall > 0 ? `brightness(${mix(1, 0.45, fall).toFixed(3)})` : 'none');
      opacity(zone, 1 - clamp((fall - 0.35) / 0.65));
    });
    // The right zone lights up once it is the only one left.
    put(one('zone'), 'box-shadow', l >= GM.drop + 400 ? '0 0 0 8px #ffffff' : 'none');

    all('kid').forEach((kid, index) => {
      const k = KIDS[index];
      const pop = ease.back(seg(l, k.join, 360));
      const run = ease.inOut(seg(l, k.go, 980));
      const bob = run > 0 && run < 1 ? -Math.abs(Math.sin(run * Math.PI * 5)) * 14 : 0;
      const x = mix(k.from.x, k.to.x, run);
      let y = mix(k.from.y, k.to.y, run) + bob;
      let scale = l < k.join ? 0 : pop;
      let seen = l >= k.join ? 1 : 0;
      if (k.pick !== GAME_EXAMPLE.right && fall > 0) {
        y += 90 * fall;
        scale *= mix(1, 0.55, fall);
        seen = 1 - clamp((fall - 0.2) / 0.6);
      }
      put(kid, 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${scale.toFixed(3)})`);
      opacity(kid, seen);
    });
  });

  const floor = (
    <div data-a="floor" className="gp-floor" style={{ left: FLOOR.left, top: FLOOR.top, width: FLOOR.width, height: FLOOR.height }}>
      <i className="gp-path" style={{ left: ZONE_W, top: 0, width: FLOOR.width - 2 * ZONE_W, height: FLOOR.height }} />
      <i className="gp-path" style={{ left: 0, top: ZONE_H, width: FLOOR.width, height: FLOOR.height - 2 * ZONE_H }} />
      {ZONES.map((corner, index) => (
        <div key={LETTERS[index]} data-a="zone" className={`gp-zone gp-z${index}`} style={{ left: corner.x, top: corner.y, width: ZONE_W, height: ZONE_H }}>
          <span className="gp-zone-label">
            <b className={`gp-zone-letter gp-zl${index}`}>{LETTERS[index]}</b>
            <span data-a="answer" className="gp-zone-t" style={{ opacity: 0 }}>
              {GAME_EXAMPLE.answers[index]}
            </span>
          </span>
        </div>
      ))}
      {KIDS.map((kid) => (
        <KidMark key={kid.name} kid={kid} />
      ))}
    </div>
  );

  return (
    <div ref={root} className="mr-scene">
      <Beat lines={['Игра', 'в классе.']}>
        {/* The signed-in top line: the test's page is in «Экзамены». */}
        <div data-a="strip" className="gp-strip">
          <Wordmark className="gp-strip-mark" />
          {['Сегодня', 'Экзамены', 'Лекции', 'Повторение'].map((item) => (
            <span key={item} className={item === 'Экзамены' ? 'is-on' : undefined}>
              {item}
            </span>
          ))}
        </div>

        {/* 1 · The test's page */}
        <div data-a="page" className="gp-screen">
          <p className="gp-crumb">‹ Экзамены</p>
          <p className="fm-h1 gp-h1">{GAME_EXAMPLE.test}</p>
          <p className="gp-meta fm-muted">{TEST_HOME.meta(GAME_EXAMPLE.questions, 1)}</p>
          <div className="gp-pills">
            <span className="fm-btn fm-btn--blue">{TEST_HOME.studio}</span>
            <span className="fm-btn fm-btn--line">{TEST_HOME.send}</span>
            <span data-a="host" className="fm-btn fm-btn--line gp-host">
              {ENTRY.host}
            </span>
          </div>
          <p className="gp-h2">{TEST_HOME.quizzes}</p>
          <div className="fm-card gp-quiz">
            <span className="gp-quiz-t">
              {GAME_EXAMPLE.quiz}
              <small>
                <i />
                Открыта{NB}· {TEST_HOME.finished(17)}
              </small>
            </span>
            <svg className="gp-chev" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8 5l5 5-5 5" />
            </svg>
          </div>
        </div>

        {/* 2 · The setup («Провести игру», a page of its own without the menu) */}
        <div data-a="setupout" className="gp-screen">
          <div data-a="setup" className="gp-screen" style={{ opacity: 0 }}>
            <div className="gp-top">
              <Wordmark className="gp-top-mark" />
              <span className="fm-muted">{SETUP.top}</span>
            </div>
            <p className="fm-h1 gp-setup-h">{SETUP.title(GAME_EXAMPLE.test)}</p>
            <p className="gp-setup-lead fm-muted">{SETUP.lead(GAME_EXAMPLE.questions)}</p>
            <p className="gp-setup-l fm-muted">Какая игра</p>
            <div className="gp-modes">
              {[
                { name: MODE.name, about: MODE.about, picture: <Monster /> },
                { name: STAND.name, about: STAND.about, picture: <MiniFloor /> },
              ].map((mode) => (
                <div key={mode.name} data-a="mode" className="gp-mode">
                  <span className="gp-mode-pic">{mode.picture}</span>
                  <span className="gp-mode-name">{mode.name}</span>
                  <span className="gp-mode-about fm-muted">{mode.about}</span>
                  <i data-a="tick" className="gp-mode-tick" style={{ opacity: 0 }}>
                    <Tick />
                  </i>
                </div>
              ))}
            </div>
            <span data-a="open" className="fm-btn fm-btn--blue gp-open">
              <span className="gp-swap">
                <span data-a="opena">{SETUP.open}</span>
                <span data-a="openb" style={{ opacity: 0 }}>
                  {SETUP.opening}
                </span>
              </span>
              <i>
                <Arrow />
              </i>
            </span>
          </div>
        </div>

        {/* 3–5 · The projector */}
        <div data-a="proj" className="gp-proj" style={{ opacity: 0 }}>
          <div className="gp-proj-id">
            <Wordmark className="gp-proj-mark" />
            <b>{STAND.name}</b>
            <span>{GAME_EXAMPLE.test}</span>
          </div>
          <div className="gp-board">
            <div data-a="lobbyboard" className="gp-board-in gp-board-lobby">
              <QrLook />
              <div className="gp-board-side">
                <span className="gp-board-small">{STAND.go}</span>
                <span className="gp-board-site">{GAME_EXAMPLE.site}</span>
                <span className="gp-board-pin">PIN {pinText(GAME_EXAMPLE.pin)}</span>
                <span className="gp-board-small">{STAND.camera}</span>
              </div>
            </div>
            <div data-a="qboard" className="gp-board-in gp-board-center" style={{ opacity: 0 }}>
              <span className="gp-board-small">{STAND.hint}</span>
              <span className="gp-board-q">{GAME_EXAMPLE.question}</span>
            </div>
            <div data-a="rboard" className="gp-board-in gp-board-center" style={{ opacity: 0 }}>
              <span className="gp-board-small">{STAND.right}</span>
              <span className="gp-board-q">
                <b className="gp-zone-letter gp-zl0">{LETTERS[GAME_EXAMPLE.right]}</b>
                {GAME_EXAMPLE.answers[GAME_EXAMPLE.right]}
              </span>
              <span data-a="stood" className="gp-board-stood" style={{ opacity: 0 }}>
                Устояли <b>{GAME_STOOD}</b> из {GAME_PLAYERS}
              </span>
            </div>
          </div>
          <p data-a="playing" className="gp-chip">
            <i />
            {STAND.playing}
            <b data-a="count">0</b>
          </p>
          <div data-a="timer" className="gp-timer" style={{ opacity: 0 }}>
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <circle className="gp-timer-track" cx="20" cy="20" r="17" />
              <circle data-a="timerarc" className="gp-timer-arc" cx="20" cy="20" r="17" pathLength={100} strokeDasharray="100 100" transform="rotate(-90 20 20)" />
            </svg>
            <b data-a="timern">5</b>
          </div>
          {floor}

          {/* The students' phones: the site's /play and the group's chat in Telegram. */}
          <div data-a="site" className="gp-phone gp-phone--site" style={{ opacity: 0 }}>
            <div className="gp-phone-screen">
              <p className="gp-url">{GAME_EXAMPLE.site}</p>
              <div className="gp-play">
                <Wordmark className="gp-play-mark" />
                <p className="gp-play-sub">Введите PIN с экрана ведущего.</p>
                <p className="gp-play-l">PIN игры</p>
                <p className="gp-play-pin">
                  <Typed text={pinText(GAME_EXAMPLE.pin)} at={GM.type} cps={14} />
                </p>
              </div>
              <span data-a="sitego" className="gp-play-go">
                Дальше
              </span>
            </div>
          </div>
          <div data-a="tg" className="gp-phone gp-phone--tg" style={{ opacity: 0 }}>
            <div className="gp-phone-screen">
              <div className="gp-tg-head">
                <span className="gp-tg-ava">9Б</span>
                <span>
                  <b>{GAME_EXAMPLE.chat}</b>
                  <small>24 участника</small>
                </span>
              </div>
              <div className="gp-tg-chat">
                <div className="gp-tg-msg">
                  <b>Meldy</b>
                  <span>Игра «{GAME_EXAMPLE.test}».</span>
                  <span>PIN {pinText(GAME_EXAMPLE.pin)}</span>
                </div>
                <span data-a="tgplay" className="gp-tg-btn">
                  Играть
                </span>
              </div>
            </div>
          </div>
        </div>
      </Beat>
    </div>
  );
}
