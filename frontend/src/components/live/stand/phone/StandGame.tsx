/**
 * «Встань на ответ» on the phone after the join (docs/live/MODE_STAND.md): the room's socket for the whole game (one
 * StandSession, kept while the player changes the hero in the lobby), the play screen, and the podium.
 *
 * The database is read only around the socket: the join and the first state (the controller), nothing while the
 * room works (the controller's watch is paused once the room has spoken), one read at the podium for the opened
 * wardrobe parts (`final.unlocked_now`), and the database again when the room is gone for good (the game ended, kicked).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PlayerController, PlayerSnapshot } from '../../player/controller';
import { NBSP, plural } from '../../player/copy';
import type { HapticKind, PlayerPlatform } from '../../player/platform';
import { FpsReadout, fpsWanted } from '../FpsReadout';
import { usePhoneArena } from './arena';
import { StandSession } from './session';
import StandBuilder from './StandBuilder';
import { StandPlay } from './StandPlay';
import { Thumb } from './Thumb';
import { OPENED, placeLine, points } from './words';
import { shownPlace } from '../../../../lib/live/rules';
import './stand.css';

/** The room silent this long (a dead Space, a phone between networks): the database tells how the game goes on. */
const DB_AFTER_MS = 8000;

export interface StandGameProps {
  ctl: PlayerController;
  s: PlayerSnapshot;
  platform: PlayerPlatform;
  haptic: (kind: HapticKind) => void;
}

export default function StandGame({ ctl, s, platform, haptic }: StandGameProps) {
  const game = s.game!;
  const [session] = useState(() => new StandSession({ game: game.id, token: ctl.playerToken() ?? '' }));
  useEffect(() => {
    session.connect();
    return () => session.dispose();
  }, [session]);
  const v = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const st = s.state;

  // The 3D arena: loaded and warmed up while the player waits in the lobby, so the first question does not stall.
  // A phone without WebGL 2, or one too slow even at the cheapest level, plays on the 2D screen.
  const { canvasRef, spritesRef, scene, sprites, light } = usePhoneArena(session, v);

  // The database's watch: off while the room works, on again when the room is gone or silent for long.
  useEffect(() => {
    if (v.status === 'open' && v.ready && !v.lost) {
      ctl.pauseWatch();
      return undefined;
    }
    if (v.status === 'closed') {
      ctl.resumeWatch();
      ctl.kick();
      return undefined;
    }
    const t = setTimeout(() => ctl.resumeWatch(), DB_AFTER_MS);
    return () => clearTimeout(t);
  }, [v.status, v.ready, v.lost, ctl]);

  // The podium: one read for the final numbers and the parts this game opened.
  const phase = v.state?.phase ?? null;
  const askedFinal = useRef(false);
  useEffect(() => {
    if ((phase === 'podium' || phase === 'ended') && !askedFinal.current) {
      askedFinal.current = true;
      ctl.kick();
    }
  }, [phase, ctl]);

  // The game started while the hero was being changed: back to the game.
  useEffect(() => {
    if (s.step === 'builder' && phase && phase !== 'lobby') ctl.leaveEdit();
  }, [s.step, phase, ctl]);

  if (s.step === 'builder') {
    return (
      <StandBuilder
        ctl={ctl}
        name={s.name}
        fromTelegram={platform.kind === 'telegram'}
        look={s.look}
        unlocked={s.unlocked}
        lockedTap={s.lockedTap}
        from="lobby"
        busy={s.busy}
        error={s.error}
        guest={s.guest && platform.kind === 'web'}
        pin={s.pin}
      />
    );
  }

  const look = st?.me.look ?? s.look;
  const over = phase === 'podium' || phase === 'ended' || (!phase && (st?.state === 'podium' || st?.state === 'ended')) || session.ended() === 'ended';
  if (over) {
    const final = st?.final ?? null;
    const me = v.me;
    const serverPlace = me?.place ?? final?.place ?? null;
    // the own place as the lists show it: a tie in the five shares its place
    const top = v.state?.top ?? null;
    const place = serverPlace === null ? null : shownPlace(top ? top.map((r) => ({ id: r.id, points: r.pts })) : null, { id: v.you, points: me?.pts ?? final?.dmg ?? 0, place: serverPlace });
    const of = me?.of ?? st?.players ?? 0;
    const pts = me?.pts ?? final?.dmg ?? 0;
    const best = me?.best ?? final?.best ?? 0;
    const right = me?.right ?? final?.right ?? 0;
    const asked = v.state ? v.state.qi + 1 : st ? st.qi + 1 : 0;
    const opened = final?.unlocked_now ?? [];
    return (
      <>
        <div className="lp-page sp sp-final">
          <h1 className="lp-h1">Игра окончена</h1>
          <div className="sp-final__me">
            <Thumb body={look.body} colour={look.colour} hat={look.hat} size={168} className="sp-thumb--joy" title="Ваш герой" />
          </div>
          {place !== null && <p className="sp-final__place">{placeLine(place, of)}</p>}
          <p className="sp-final__pts">{points(pts)}</p>
          <dl className="sp-card sp-final__rows">
            <div>
              <dt>Верных ответов</dt>
              <dd>
                {right} из {asked}
              </dd>
            </div>
            <div>
              <dt>Лучшая серия</dt>
              <dd>{best > 0 ? `${best}${NBSP}${plural(best, 'верный', 'верных', 'верных')} подряд` : 'нет'}</dd>
            </div>
          </dl>
          {opened.map((id) => (
            <div key={id} className="sp-card sp-final__unlock" role="status">
              <Thumb body={look.body} colour={id === 'graphite' || id === 'snow' ? id : look.colour} hat={id === 'graphite' || id === 'snow' ? look.hat : id} size={64} />
              <div>
                <b>{OPENED[id].title}</b>
                <p>{OPENED[id].why}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="lp-bar">
          {st && (st.state === 'podium' || st.state === 'ended') && (
            <button type="button" className="lp-btn lp-btn--main" onClick={() => void ctl.openReview()}>
              Посмотреть ответы
            </button>
          )}
          <button type="button" className="lp-btn lp-btn--second" onClick={() => ctl.restart()}>
            Войти в другую игру
          </button>
        </div>
      </>
    );
  }

  const backdrop = light ? sprites : scene;
  // ?fps=1: a corner readout for checking a real phone (never by default)
  const showFps = fpsWanted();
  const question = phase === 'countdown' || phase === 'open' || phase === 'reveal';
  return (
    <>
      <canvas className="sp-3d" ref={canvasRef} data-on={!light && !!scene && question ? 'true' : undefined} aria-hidden="true" />
      <canvas className="sp-3d" ref={spritesRef} data-on={light && !!sprites && question ? 'true' : undefined} aria-hidden="true" />
      <StandPlay
        session={session}
        view={v}
        fallbackPhase={st?.state ?? 'lobby'}
        look={look}
        name={st?.me.name ?? s.name}
        pin={s.pin}
        players={st?.players ?? 0}
        canEdit={!s.busy && (phase ?? st?.state) === 'lobby'}
        onEdit={() => ctl.editLook()}
        haptic={haptic}
        scene={backdrop}
      />
      {v.lost && (
        <div className="sp-lost" role="alert">
          <i aria-hidden="true" />
          Связь пропала. Подключаемся
        </div>
      )}
      {showFps ? <FpsReadout quality={() => (!light && scene ? (scene.stats()?.quality ?? null) : null)} /> : null}
    </>
  );
}
