/**
 * Chapter «Игра в классе» (owner, 21.10, at the bot's 20:00 plan: «подставить игру например после этого момента … в
 * таком виде типа но чуть по-другому»; «недостает еще про игры в боте»). The live game «Встань на ответ» as a class
 * plays it. The projector is the real recorded game (home3/gameFrames): the class runs to the answers, the last
 * second, the boss stomps at zero and the rest of the floor drops, «Устояли 18 из 30». Beside it a student's phone in
 * Telegram: the bot's post in the class chat, «Играть», and the game opens in the chat; the student stands on «А»,
 * then «Верно +980».
 *
 * The frames are stills: one after another, each coming in over the one before, under a slow push of the camera and a
 * short shake at the stomp (transform and opacity only). The phone's view is the same frame, nearer.
 */
import { useRef } from 'react';
import { opacity, text, useEls, useFrame } from '../../reel/engine';
import { GAME, SAY } from '../../home3/copy3';
import { GAME_FRAMES, type GameFrame } from '../../home3/gameFrames';
import { Say, appear, ease, mix, move, seg } from '../kit3';
import { Cursor, pressAt, usePointer, type CursorKey } from '../pointer3';

/** «Играть» under the bot's post; the pointer waits below it, then goes. */
export const GAME_KEYS: readonly CursorKey[] = [
  { t: 950, aim: 'play', fx: 0.72, fy: 1, dy: 26 },
  { t: 1500, aim: 'play', press: true },
  { t: 2000, aim: 'play', fx: 0.72, fy: 1, dy: 70 },
  { t: 2300, hide: true },
];
/** The game opens in the chat as «Играть» is let go. */
const OPEN = pressAt(GAME_KEYS, 'play') + 250;
/** The student's own character reaches «А». */
const ON = OPEN + 650;
/**
 * The projector's moments (scene ms), as the recorded game has them when its 10.8 s cut is played from 3.8 s: the cut to
 * the last second, the stomp at zero («Верный ответ»), the ring with «Устояли 18 из 30», the floor dropping.
 */
const LAST = 2800;
const STOMP = 3600;
const RING = 4000;
const DROP = 4900;
/** The phone: «Верно +980» a beat after the stomp. */
const RIGHT = STOMP + 250;

/** The projector's frames: each comes in over the one before, in `fade` ms. */
const SHOTS: ReadonlyArray<{ frame: GameFrame; at: number; fade: number }> = [
  { frame: 'run', at: 0, fade: 0 },
  { frame: 'last', at: LAST, fade: 90 },
  { frame: 'stomp', at: RING, fade: 160 },
  { frame: 'drop', at: DROP, fade: 600 },
];
/** The phone's view: the same frames, nearer (the stomp's ring is the projector's). */
const VIEWS: ReadonlyArray<{ frame: GameFrame; at: number; fade: number }> = [
  { frame: 'run', at: 0, fade: 0 },
  { frame: 'last', at: LAST, fade: 90 },
  { frame: 'drop', at: DROP, fade: 600 },
];

const LETTERS = ['А', 'Б', 'В', 'Г'] as const;

export function GameScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const pointer = usePointer(GAME_KEYS);
  useFrame((l) => {
    // The projector: in first, the camera pushing in all the way; a shake as the boss stomps.
    appear(one('proj'), l, 120, 480, 18);
    const shots = all('shot');
    SHOTS.forEach((shot, index) => opacity(shots[index], index === 0 ? 1 : ease.inOut(seg(l, shot.at, Math.max(shot.fade, 1)))));
    const k = seg(l, STOMP, 520);
    const amp = l >= STOMP && k < 1 ? 9 * (1 - k) * (1 - k) : 0;
    move(one('cam'), amp * Math.sin((l - STOMP) / 16), amp * 0.6 * Math.cos((l - STOMP) / 21), mix(1, 1.06, ease.inOut(seg(l, 0, 7000))));

    // The phone: the class chat with the bot's post, «Играть», the game in the chat.
    const rise = ease.brand(seg(l, 380, 640));
    appear(one('phone'), l, 380, 260, 0);
    move(one('phone'), 0, 70 * (1 - rise));
    appear(one('post'), l, 700, 380, 10);
    const app = ease.brand(seg(l, OPEN, 560));
    appear(one('app'), l, OPEN, 160, 0);
    move(one('app'), 0, 300 * (1 - app));
    const views = all('view');
    VIEWS.forEach((view, index) => opacity(views[index], index === 0 ? 1 : ease.inOut(seg(l, view.at, Math.max(view.fade, 1)))));
    // The view follows the character a little as it runs to «А».
    const run = ease.inOut(seg(l, OPEN + 100, ON - OPEN - 100));
    move(one('track'), mix(-8, 0, run), mix(10, 0, run));
    // The thumb on the stick: up and to the left while running, back when standing.
    const lean = Math.sin(Math.PI * seg(l, OPEN + 120, ON - OPEN - 80));
    move(one('knob'), -9 * lean, -10 * lean);
    text(one('sec'), l < LAST ? '14' : '1');
    appear(one('running'), l, OPEN, 10, 0, ON - 130);
    appear(one('stand'), l, ON, 260, 6);
    appear(one('qcard'), l, OPEN, 10, 0, RIGHT - 160);
    const pop = ease.brand(seg(l, RIGHT, 420));
    opacity(one('win'), seg(l, RIGHT, 160));
    move(one('win'), 0, 10 * (1 - pop), mix(0.92, 1, pop));
  });
  return (
    <div ref={root} className="r3-scene r3-scene--game">
      <Say text={SAY.game[0]} at={300} until={STOMP - 300} />
      <Say text={SAY.game[1]} at={STOMP - 50} />
      <div className="r3-ui">
        <div data-a="proj" className="r3-proj" style={{ opacity: 0 }}>
          <div className="r3-proj-in">
            <div data-a="cam" className="r3-proj-cam">
              {SHOTS.map((shot) => (
                <img key={shot.frame} data-a="shot" src={GAME_FRAMES[shot.frame]} width={800} height={450} alt="" decoding="async" draggable={false} />
              ))}
            </div>
          </div>
        </div>
        <div data-a="phone" className="r3-gp" style={{ opacity: 0 }}>
          <div className="r3-gp-in">
            <p className="r3-tg-top">
              <b>{GAME.chat}</b>
              <small>{GAME.chatMeta}</small>
            </p>
            <div data-a="post" className="r3-gp-post" style={{ opacity: 0 }}>
              <p className="r3-gp-b">
                <span className="r3-gp-from">{GAME.bot}</span>
                <b>{GAME.mode}</b>
                {GAME.post.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
              <span data-aim="play" className="r3-tg-btn r3-tg-btn--blue r3-gp-play">
                {GAME.play}
              </span>
            </div>
            <div data-a="app" className="r3-gp-app" style={{ opacity: 0 }}>
              <div className="r3-gp-view">
                <div data-a="track" className="r3-gp-track">
                  {VIEWS.map((view) => (
                    <img key={view.frame} data-a="view" src={GAME_FRAMES[view.frame]} width={800} height={450} alt="" decoding="async" draggable={false} />
                  ))}
                </div>
              </div>
              <p className="r3-gp-bar">
                <span className="r3-gp-close">{GAME.close}</span>
                <span className="r3-gp-more" aria-hidden="true" />
              </p>
              <div data-a="qcard" className="r3-gp-card">
                <p className="r3-gp-of">
                  <span>{GAME.of}</span>
                  <b data-a="sec">14</b>
                </p>
                <p className="r3-gp-q">{GAME.question}</p>
                <p className="r3-gp-opts">
                  {GAME.options.map((option, index) => (
                    <span key={option}>
                      <i data-zone={index}>{LETTERS[index]}</i>
                      {option}
                    </span>
                  ))}
                </p>
              </div>
              <div data-a="win" className="r3-gp-card r3-gp-win" style={{ opacity: 0 }}>
                <b>{GAME.right}</b>
                <strong>{GAME.points}</strong>
              </div>
              <span className="r3-gp-stick" aria-hidden="true">
                <i data-a="knob" />
              </span>
              <div className="r3-gp-zone">
                <span data-a="running" className="r3-gp-run" style={{ opacity: 0 }}>
                  {GAME.run}
                </span>
                <span data-a="stand" className="r3-gp-on" style={{ opacity: 0 }}>
                  <i data-zone={0}>{LETTERS[0]}</i>
                  <span>
                    <small>{GAME.onAnswer}</small>
                    {GAME.options[0]}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}
