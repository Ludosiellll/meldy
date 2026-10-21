/**
 * The phone in a battle with movement rounds (docs/live/MODE_MIXED.md §8): the battle's own screens (the lobby, the
 * button questions, the five best, the podium) come in as `children`; during each movement round the screen of «Встань
 * на ответ» takes their place (the arena in 3D, flat only without WebGL, the stick, the small map, the question card, no
 * answer buttons) with the battle's words for the own result.
 *
 * - The room's socket is opened right after the join and kept for the whole game; the battle's polling of the
 *   database goes on as in any battle (CONTRACT §6). The 3D arena is loaded and warmed up in the lobby, once.
 * - The arena shows while `arenaOn` says so: the room's state when it knows the question, else `question.stand` from
 *   live_state. Until the room speaks for the question its card, its options and its time come from the database.
 * - The own result from the room's `me` (or live_state's result when the room never sent one): «Верно. −141»,
 *   «Лёд растаял», «Мимо. Вы заморожены», «Вы не встали ни на один ответ», «Вы зашли позже», «Мини-игра не засчитана».
 *   The own ice from `me.frozen` (live_state's between rounds), everyone else's from the snapshots (F_ICE).
 * - «Нет связи с ареной» while the socket is not open during a movement round.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { StandLast, StandState } from '../../../../lib/live/move/protocol';
import type { PlayerState } from '../../../../lib/live/types';
import type { PlayerController, PlayerSnapshot } from '../../player/controller';
import { nb } from '../../player/copy';
import type { HapticKind, PlayerPlatform } from '../../player/platform';
import { FpsReadout, fpsWanted } from '../FpsReadout';
import { arenaOn, lastOfResult, mixedOutcome } from '../mixed';
import { usePhoneArena } from './arena';
import { StandSession } from './session';
import { StandPlay } from './StandPlay';
import { streakLine } from './words';
import './stand.css';

export interface MixedPhoneProps {
  ctl: PlayerController;
  s: PlayerSnapshot;
  platform: PlayerPlatform;
  haptic: (kind: HapticKind) => void;
  /** The battle's screen for this moment (shown whenever the arena is not). */
  children: ReactNode;
}

/**
 * The movement round as the database has it, in the room's shape: before the room speaks for it (a moment after the
 * teacher's click), or without a socket at all. Times in the room's clock when it is known (`roomNow`), else in this
 * device's (Date.now()).
 */
export function standStateOf(st: PlayerState, roomNow: number | null, offsetMs: number, nowMs: number = Date.now()): StandState {
  const q = st.question;
  const toRoom = (iso: string | undefined) => {
    const at = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(at)) return null;
    return roomNow === null ? at - offsetMs : roomNow + (at - (nowMs + offsetMs));
  };
  const r = st.result && st.result.qi === st.qi ? st.result : null;
  return {
    t: 'stand',
    k: 'state',
    phase: st.state,
    qi: st.qi,
    q_count: st.q_count,
    players: st.players,
    q: q ? { text: q.text, options: q.options } : null,
    opens: toRoom(q?.opens_at),
    closes: toRoom(q?.closes_at),
    floor: 'up',
    res: r && st.state === 'reveal' ? { qi: r.qi, key: r.key, counts: r.counts, stood: r.right, of: st.players, fastest: null, fell: [], back: [], at: 0, back_at: 0, void: r.void } : null,
    top: null,
    acc: null,
    round: 'stand',
  };
}

export default function MixedPhone({ ctl, s, platform: _platform, haptic, children }: MixedPhoneProps) {
  const game = s.game!;
  const [session] = useState(() => new StandSession({ game: game.id, token: ctl.playerToken() ?? '' }));
  useEffect(() => {
    session.connect();
    return () => session.dispose();
  }, [session]);
  const v = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const st = s.state!;
  const on = arenaOn(st, v.state);
  // the 3D arena (or the flat view without WebGL): loaded in the lobby, the canvases kept for the whole game
  const { canvasRef, spritesRef, scene, sprites, flat, backdrop } = usePhoneArena(session, v);

  // the room's picture of this round when it has one, else the database's
  const room = v.state && v.state.round === 'stand' && v.state.qi >= st.qi ? v.state : null;
  // without the room's clock (no snapshot yet, no socket) the database's times run on this device's clock
  const roomNow = session.client.serverNow();
  const local = !room && roomNow === null;
  const shown = useMemo(() => room ?? standStateOf(st, local ? null : roomNow, s.offsetMs), [room, st, local, s.offsetMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const deviceClock = useMemo(() => (local ? () => Date.now() : undefined), [local]);
  const view = useMemo(() => ({ ...v, state: shown }), [v, shown]);

  // The own result: the room's `me` for this round, else live_state's result (no socket).
  const qi = shown.qi;
  const roomLast: StandLast | null = shown.phase === 'reveal' && v.me?.last && v.me.last.qi === qi ? v.me.last : null;
  const dbLast = shown.phase === 'reveal' && st.result && st.result.qi === qi && st.state === 'reveal' ? lastOfResult(st.result, st.me.choice, s.frozenBefore) : null;
  const last = roomLast ?? (v.status === 'open' && !st.result ? null : dbLast);
  // frozen in the battle: the room's word after its reveal, else the database's
  const frozen = roomLast ? !!v.me?.frozen : st.me.frozen;
  const streak = roomLast ? (v.me?.streak ?? 0) : st.me.streak;
  const outcome = useMemo(() => {
    if (!last) return null;
    const o = mixedOutcome(last, frozen, nb);
    return o.tone === 'ok' && streak >= 2 ? { ...o, lines: [...o.lines, streakLine(streak)] } : o;
  }, [last, frozen, streak]);
  const mixed = useMemo(() => ({ frozen, outcome }), [frozen, outcome]);

  const question = on && (shown.phase === 'countdown' || shown.phase === 'open' || shown.phase === 'reveal');
  const noLink = on && v.status !== 'open';
  const showFps = fpsWanted();
  return (
    <>
      <canvas className="sp-3d" ref={canvasRef} data-on={question && !flat && !!scene ? 'true' : undefined} aria-hidden="true" />
      <canvas className="sp-3d" ref={spritesRef} data-on={question && flat && !!sprites ? 'true' : undefined} aria-hidden="true" />
      {on ? (
        <StandPlay
          session={session}
          view={view}
          fallbackPhase={st.state}
          look={st.me.look}
          name={st.me.name}
          pin={s.pin}
          players={st.players}
          canEdit={false}
          onEdit={() => {}}
          haptic={haptic}
          scene={backdrop}
          mixed={mixed}
          clock={deviceClock}
        />
      ) : (
        children
      )}
      {on && (noLink || v.lost) && (
        <div className="sp-lost" role="alert">
          <i aria-hidden="true" />
          {noLink ? 'Нет связи с ареной' : 'Связь пропала. Подключаемся'}
        </div>
      )}
      {showFps && on ? <FpsReadout quality={() => (!flat && scene ? (scene.stats()?.quality ?? null) : null)} /> : null}
    </>
  );
}
