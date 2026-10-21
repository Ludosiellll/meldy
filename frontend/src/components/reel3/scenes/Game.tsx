/**
 * Chapter «Игра в классе» (owner, 21.10, at the bot's 20:00 plan: «подставить игру например после этого момента … в
 * таком виде типа но чуть по-другому»; «недостает еще про игры в боте»). The live game «Встань на ответ» as a class
 * plays it. The projector is the real recorded game (home3/gameFrames): the class runs to the answers, the last
 * second, the boss stomps at zero and the rest of the floor drops, «Устояли 18 из 30». Beside it a student's phone in
 * Telegram: the bot's post in the class chat, «Играть», and the game opens in the chat; the student stands on «А»,
 * then «Верно +980».
 *
 * The projector plays the recorded game itself (lib/footage STAND_RUN, the 10.8 s cut from 3.8 s at 1×) under the
 * reel's clock: it plays while the reel plays, stops when it stops, and in the frame exporter it is sought to every
 * frame's time. Under it lie stills of the same moments, each coming in over the one before: what shows until the video
 * has its first frame, or if this browser cannot play it. A slow push of the camera and a short shake at the stomp
 * (transform and opacity only).
 *
 * Once «Играть» is pressed the phone shows the same game on the student's phone (owner, 21.10: «в телефоне тупо
 * картинка, нет движения синхронного с экраном главным»): the real phone page drawn from the same recording
 * (STAND_RUN_PHONE, frame for frame the projector's moments), steered by the same clock to the same time as the
 * projector's (lib/footageSync), so the timer, the stomp and the falling floor are one moment on both screens however
 * the reel is played, paused, sought or exported. Under it, until both videos have a frame or where they cannot play,
 * the phone's drawn view (the projector's stills, nearer) with its cards.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { opacity, text, useClock, useEls, useFrame } from '../../reel/engine';
import { STAND_RUN, STAND_RUN_PHONE, canPlayFootage, loadFootage, type Footage } from '../../../lib/footage';
import { steer } from '../../../lib/footageSync';
import { GAME, SAY } from '../../home3/copy3';
import { GAME_FRAMES, type GameFrame } from '../../home3/gameFrames';
import { Say, appear, clamp, ease, mix, move, seg } from '../kit3';
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

/** The recorded cut is played from here (s) at the scene's first moment, at 1×, until the scene leaves. */
export const FOOTAGE_FROM = 3.8;
const FOOTAGE_UNTIL = 7000;

/** The cut's time at scene ms `l`: still before the scene and after it (no seeking while hidden). */
export function footageAt(l: number): number {
  return Math.min(FOOTAGE_FROM + clamp(l, 0, FOOTAGE_UNTIL) / 1000, STAND_RUN.duration - 0.04);
}

/** The game's own timer at the cut's time `s` (read off the recording). */
export function timerAt(s: number): number {
  if (s < 4.25) return 15;
  if (s < 5.25) return 14;
  if (s < 6.25) return 13;
  if (s < 6.6) return 12;
  if (s < 7.05) return 1;
  return 0;
}

/** The footage as an object URL once it has loaded (null before, and where this browser cannot play it). */
function useFootageUrl(footage: Footage): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!canPlayFootage(footage)) return undefined;
    let alive = true;
    loadFootage(footage).then(
      (url) => {
        if (alive) setSrc(url);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [footage]);
  return src;
}

/** The videos that have had a frame: one stays on show while it seeks (the frame exporter seeks it every frame). */
const framed = new WeakSet<HTMLVideoElement>();

/** Whether the video has a frame to show: its first one has come, and it has not lost its source since. */
function hasFrame(video: HTMLVideoElement | null): video is HTMLVideoElement {
  if (!video) return false;
  if (video.readyState >= 2) framed.add(video);
  return video.readyState >= 1 && framed.has(video);
}

/** A silent video's ref callback, and the video. */
function useMutedVideo() {
  const video = useRef<HTMLVideoElement | null>(null);
  const attach = useCallback((el: HTMLVideoElement | null) => {
    // As properties too: React does not always write `muted`, and only a muted video may start by itself.
    if (el) {
      el.muted = true;
      el.defaultMuted = true;
      el.addEventListener('loadeddata', () => framed.add(el), { once: true });
    }
    video.current = el;
  }, []);
  return [video, attach] as const;
}

export function GameScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  const pointer = usePointer(GAME_KEYS);
  const clock = useClock();
  const src = useFootageUrl(STAND_RUN);
  const phoneSrc = useFootageUrl(STAND_RUN_PHONE);
  const [video, attach] = useMutedVideo();
  const [phoneVideo, attachPhone] = useMutedVideo();
  // The reel stopped (its pause, the page scrolled away, the tab hidden): so do both footages.
  useEffect(
    () =>
      clock.watch(() => {
        if (clock.isPlaying) return;
        for (const v of [video.current, phoneVideo.current]) if (v && !v.paused) v.pause();
      }),
    [clock, video, phoneVideo],
  );
  useFrame((l) => {
    // Both footages follow the reel to one time: they play while the reel plays and the scene is on, else they wait on
    // that frame (the exporter's every frame). While they play the phone follows the projector's own time, so a gap
    // between the reel's clock and the projector's never shows as a gap between the two screens.
    const want = footageAt(l);
    const playing = clock.isPlaying && l >= 0 && l < FOOTAGE_UNTIL && window.__MELDY_REEL_EXPORT__ !== true;
    const v = video.current;
    const pv = phoneVideo.current;
    // A video that has had a frame stays on show while it seeks: the exporter's screenshot waits for the new one.
    const live = hasFrame(v);
    if (v) steer(v, want, playing);
    const leading = playing && live && !v.paused;
    if (pv) steer(pv, leading ? v.currentTime : want, playing, 0, leading ? v.playbackRate : 1);
    // The phone's footage shows only beside the projector's, so the two screens never show two different moments.
    const phoneLive = live && hasFrame(pv);
    opacity(v, live ? 1 : 0);
    opacity(pv, phoneLive ? 1 : 0);
    opacity(one('drawn'), phoneLive ? 0 : 1);

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
    // The phone's timer is the projector's: the footage's, or the still's on show.
    text(one('sec'), String(live ? timerAt(footageAt(l)) : l < LAST ? 14 : 1));
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
              {src ? <video ref={attach} src={src} width={800} height={450} muted playsInline preload="auto" disablePictureInPicture style={{ opacity: 0 }} /> : null}
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
              <div data-a="drawn" className="r3-gp-drawn">
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
              {phoneSrc ? (
                <video
                  ref={attachPhone}
                  className="r3-gp-video"
                  src={phoneSrc}
                  width={STAND_RUN_PHONE.width}
                  height={STAND_RUN_PHONE.height}
                  muted
                  playsInline
                  preload="auto"
                  disablePictureInPicture
                  style={{ opacity: 0 }}
                />
              ) : null}
            </div>
          </div>
        </div>
        <Cursor pointer={pointer} />
      </div>
    </div>
  );
}
