/**
 * The phone during a game of «Встань на ответ» (docs/live/MODE_STAND.md §8, §9), from the lobby to the leaderboard:
 * the question and its options with the projector's letters and floor colours, the big timer, where the own
 * character stands («Вы на Б»), a small map of the arena, and the floating stick on the lower part of the screen.
 *
 * Smoothness (owner, 21.10: no lag on the phone): React renders only when the room's phase, the question or the
 * player's numbers change (about seven times a question). Everything that moves runs in one requestAnimationFrame loop
 * through refs: the map's dots (the own one predicted, the others 150 ms behind), the stick, the zone line, the option
 * under the character and the seconds. The loop writes a text node or a data attribute only when its value changes.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { zoneIndexAt } from '../../../../lib/live/move/sim';
import type { StandState, StandTopEntry } from '../../../../lib/live/move/protocol';
import { clothesHex, toPlayerLook } from '../../../../lib/live/three/look';
import type { Look } from '../../../../lib/live/types';
import { optionSize, questionSize } from '../../player/options';
import type { HapticKind } from '../../player/platform';
import { ArenaMap } from './map';
import type { StandSession, StandView } from './session';
import { FloatingStick } from './stick';
import { Thumb } from './Thumb';
import { LETTERS, lastFor, outcomeOf, placeLine, playersLine, points, secondsLeft, streakLine, zoneLine, ZONE_COLOURS, type Outcome } from './words';
import { pinText } from '../../player/copy';

export interface StandPlayProps {
  session: StandSession;
  view: StandView;
  /** The database's phase until the room has spoken (the lobby before the host's screen opens the room). */
  fallbackPhase: StandState['phase'];
  look: Look;
  name: string;
  pin: string;
  players: number;
  canEdit: boolean;
  onEdit: () => void;
  haptic: (kind: HapticKind) => void;
}

const Check = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M4 10.5L7 13.5L12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The options as rows: the letter on the zone's colour, the text. The row under the character is marked by the loop. */
const Options = memo(function Options({
  options,
  keyIndex,
  choice,
  rows,
}: {
  options: readonly string[];
  keyIndex: number | null;
  choice: number | null;
  rows: React.MutableRefObject<Array<HTMLLIElement | null>>;
}) {
  return (
    <ol className="sp-opts" aria-label="Ответы">
      {options.map((text, i) => {
        const mark = keyIndex === null ? undefined : i === keyIndex ? 'key' : i === choice ? 'wrong' : 'dim';
        return (
          <li
            key={i}
            ref={(el) => {
              rows.current[i] = el;
            }}
            className="sp-opt"
            data-size={optionSize(text)}
            data-mark={mark}
            style={{ '--zone': ZONE_COLOURS[i] } as React.CSSProperties}
          >
            <span className="sp-opt__l" aria-hidden="true">
              {LETTERS[i]}
            </span>
            <span className="sp-opt__t">
              <span className="lp-sr">{`${LETTERS[i]}. `}</span>
              {text}
              {mark === 'key' && <span className="lp-sr">. Верный ответ</span>}
              {mark === 'wrong' && <span className="lp-sr">. Ваш ответ</span>}
            </span>
            {mark === 'key' && (
              <span className="sp-opt__ok" aria-hidden="true">
                <Check />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
});

function Board({ top, you }: { top: readonly StandTopEntry[]; you: number | null }) {
  return (
    <ol className="sp-board" aria-label="Первая пятёрка">
      {top.map((row, i) => {
        const l = toPlayerLook(row.look);
        return (
          <li key={i} className="sp-board__row" data-me={row.id !== null && row.id === you ? 'true' : undefined}>
            <span className="sp-board__n">{i + 1}</span>
            <Thumb body={l.body} colour={l.colour} hat={l.hat} size={34} />
            <span className="sp-board__name">{row.name}</span>
            <span className="sp-board__pts">{points(row.pts)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function OutcomeCard({ outcome, look, fell }: { outcome: Outcome; look: Look; fell: boolean }) {
  return (
    <section className="sp-card sp-out" data-tone={outcome.tone} role="status" aria-live="polite">
      <div className="sp-out__text">
        <h2 className="sp-out__title">{outcome.title}</h2>
        {outcome.big && <b className="sp-out__big">{outcome.big}</b>}
        {outcome.lines.map((line) => (
          <p key={line} className="sp-out__line">
            {line}
          </p>
        ))}
      </div>
      <Thumb body={look.body} colour={look.colour} hat={look.hat} size={92} className={fell || outcome.tone === 'ghost' ? 'sp-thumb--ghost' : 'sp-thumb--joy'} />
    </section>
  );
}

export function StandPlay({ session, view, fallbackPhase, look, name, pin, players, canEdit, onEdit, haptic }: StandPlayProps) {
  const st = view.state;
  const phase = st?.phase ?? fallbackPhase;
  const q = st && (phase === 'countdown' || phase === 'open' || phase === 'reveal') ? st.q : null;
  const options = q?.options ?? [];
  const res = phase === 'reveal' ? (st?.res ?? null) : null;
  const last = lastFor(st, view.me);
  const you = view.you;
  const ghost = view.me?.ghost ?? false;

  // Refs the loop writes to.
  const fieldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<HTMLLIElement | null>>([]);

  const [stick] = useState(() => new FloatingStick({ onMove: (x, y) => session.stick(x, y), onPress: () => hint.current?.setAttribute('data-gone', 'true') }));
  const hint = useRef<HTMLParagraphElement>(null);
  const [arena, setArena] = useState<ArenaMap | null>(null);

  // What the loop needs from the last render (read each frame, never a reason to restart it).
  const live = useRef({ phase, options: options.length, closes: st?.closes ?? null, timeS: view.hello?.time_s ?? 15, myColour: clothesHex(look.colour), haptic, revealKey: res?.key ?? null, ghost });
  live.current = { phase, options: options.length, closes: st?.closes ?? null, timeS: view.hello?.time_s ?? 15, myColour: clothesHex(look.colour), haptic, revealKey: res?.key ?? null, ghost };

  // The floor picture follows the question and the stomp.
  useEffect(() => {
    if (!arena) return;
    arena.setFloor({ options: options.length || 4, keep: res && st?.floor === 'down' ? res.key : null });
  }, [arena, options.length, res, st?.floor]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const field = fieldRef.current;
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!canvas || !field || !base || !knob) return undefined;
    const map = new ArenaMap(canvas);
    setArena(map);
    const detach = stick.attach(field, base, knob);
    // Sizes come from the observer (after layout), never read in the loop.
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          for (const e of entries) {
            if (e.target === canvas) map.resize(e.contentRect.width, e.contentRect.height, window.devicePixelRatio || 1);
            else if (e.target === field) stick.rest(e.contentRect.width / 2, Math.max(70, e.contentRect.height - 86));
          }
        })
      : null;
    ro?.observe(canvas);
    ro?.observe(field);
    // iOS Safari zooms on a pinch even with touch-action: none.
    const noGesture = (e: Event) => e.preventDefault();
    field.addEventListener('gesturestart', noGesture);
    return () => {
      ro?.disconnect();
      detach();
      field.removeEventListener('gesturestart', noGesture);
    };
  }, [stick]);

  // The loop: positions, the stick, the zone, the seconds. Nothing here makes React render.
  useEffect(() => {
    if (!arena) return undefined;
    const client = session.client;
    let frame = 0;
    let zoneShown = -2;
    let zoneOptions = -1;
    let secShown = -1;
    let alarmOn = false;
    let holdShown: boolean | null = null;
    let mapSet = false;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const L = live.current;
      if (!mapSet && client.map) {
        arena.setMap(client.map);
        mapSet = true;
      }
      const f = client.frame();
      const me = f.me;
      // Where the own character stands (its predicted position), told once per change.
      const zone = me && client.map ? zoneIndexAt(client.map, me.x, me.y) - 1 : -1;
      const hold = client.holding() || L.phase === 'reveal';
      if (zone !== zoneShown || L.options !== zoneOptions || hold !== holdShown) {
        const asking = L.phase === 'countdown' || L.phase === 'open';
        if (asking && zone >= 0 && zone < L.options && zone !== zoneShown && zoneShown !== -2 && !hold) L.haptic('select');
        zoneShown = zone;
        zoneOptions = L.options;
        holdShown = hold;
        const status = statusRef.current;
        if (status) {
          let text: string;
          if (!me) text = 'Подключаемся';
          else if (L.phase === 'open' && client.holding()) text = 'Время вышло';
          else if (asking) text = zoneLine(zone, L.options);
          else if (L.phase === 'reveal') text = L.ghost ? 'Вы призрак. Можно бегать' : 'Ждём следующий вопрос';
          else text = 'Можно бегать по залу';
          if (status.textContent !== text) status.textContent = text;
          status.dataset.zone = asking && zone >= 0 && zone < L.options ? String(zone) : '';
        }
        for (let i = 0; i < rows.current.length; i++) {
          const row = rows.current[i];
          if (!row) continue;
          const here = (L.phase === 'countdown' || L.phase === 'open') && i === zone ? 'true' : '';
          if ((row.dataset.here ?? '') !== here) row.dataset.here = here;
        }
        stick.setEnabled(!(L.phase === 'open' && client.holding()));
      }
      // The big timer from the room's clock: the full time until the question opens, then down to zero.
      if (L.phase === 'countdown' || L.phase === 'open') {
        const sec = secondsLeft(L.closes, client.serverNow(), L.timeS);
        if (sec !== secShown) {
          if (secShown !== -1 && L.phase === 'open' && sec >= 1 && sec <= 3) L.haptic('tick');
          secShown = sec;
          if (timerRef.current) timerRef.current.textContent = String(sec);
          const alarm = L.phase === 'open' && sec <= 3 && sec > 0;
          if (alarm !== alarmOn) {
            alarmOn = alarm;
            if (clockRef.current) clockRef.current.dataset.alarm = alarm ? 'true' : '';
          }
        }
      } else if (secShown !== -1) {
        secShown = -1;
        alarmOn = false;
      }
      stick.paint();
      arena.draw(f.others, me, client.roster, L.myColour);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [arena, session, stick]);

  // Haptics of the result, once per question.
  const felt = useRef(-1);
  useEffect(() => {
    if (!last || felt.current === last.qi) return;
    felt.current = last.qi;
    haptic(last.late ? 'select' : last.ok ? 'success' : 'error');
  }, [last, haptic]);

  const back = res && st?.floor === 'up' && you !== null && res.back.includes(you);
  const outcome = useMemo(() => (last ? outcomeOf(last, view.me?.streak ?? 0) : null), [last, view.me?.streak]);
  const me = view.me;
  const fell = !!(res && you !== null && res.fell.includes(you));

  let head: ReactNode;
  if (phase === 'lobby') {
    head = (
      <section className="sp-card sp-lobby">
        <Thumb body={look.body} colour={look.colour} hat={look.hat} size={104} className="sp-thumb--joy" title={`${name}, ваш герой`} />
        <div className="sp-lobby__text">
          <h1 className="sp-h1">Вы в игре</h1>
          <p className="sp-sub">Ждём начала.</p>
          <p className="sp-meta">
            <span>{playersLine(st?.players ?? players)}</span>
            {pin && <span>PIN {pinText(pin)}</span>}
          </p>
          {canEdit && (
            <button type="button" className="sp-link" onClick={onEdit}>
              Изменить героя
            </button>
          )}
        </div>
      </section>
    );
  } else if (phase === 'reveal' && back) {
    head = <OutcomeCard outcome={{ tone: 'ok', title: 'Вы снова в игре', big: null, lines: ['Бегите к следующему ответу.'] }} look={look} fell={false} />;
  } else if (phase === 'reveal' && outcome) {
    head = <OutcomeCard outcome={outcome} look={look} fell={fell || ghost} />;
  } else if (phase === 'leaderboard' && me) {
    head = (
      <section className="sp-card sp-place">
        <div>
          <p className="sp-place__big">{me.place !== null ? placeLine(me.place, me.of) : points(me.pts)}</p>
          <p className="sp-sub">{points(me.pts)}</p>
          {me.streak >= 2 && <p className="sp-sub">{streakLine(me.streak)}</p>}
        </div>
        <Thumb body={look.body} colour={look.colour} hat={look.hat} size={84} className={ghost ? 'sp-thumb--ghost' : undefined} />
      </section>
    );
  } else if (q && st) {
    head = (
      <section className="sp-card sp-q">
        <div className="sp-q__top">
          <span className="sp-q__n">
            Вопрос {st.qi + 1} из {st.q_count}
          </span>
          <div className="sp-clock" ref={clockRef} role="timer" aria-label="Секунд осталось">
            <span ref={timerRef}>{view.hello?.time_s ?? 15}</span>
          </div>
        </div>
        <p className="sp-q__text" data-size={questionSize(q.text)}>
          {q.text}
        </p>
      </section>
    );
  } else {
    head = (
      <section className="sp-card sp-wait">
        <p className="sp-sub">{phase === 'reveal' ? 'Считаем ответы.' : 'Ждём ведущего.'}</p>
      </section>
    );
  }

  return (
    <div className="sp sp-play" data-phase={phase} data-ghost={ghost ? 'true' : undefined}>
      {head}
      {q && options.length > 0 && <Options key={st?.qi} options={options} keyIndex={res ? res.key : null} choice={last?.choice ?? null} rows={rows} />}
      {phase === 'leaderboard' && st?.top && st.top.length > 0 && <Board top={st.top} you={you} />}
      {ghost && (phase === 'countdown' || phase === 'open') && <p className="sp-ghostline">Вы призрак. Верный ответ вернёт вас в игру.</p>}
      <div className="sp-field" ref={fieldRef} data-ready={view.ready ? 'true' : undefined}>
        <p className="sp-status" ref={statusRef} aria-live="polite">
          Подключаемся
        </p>
        <canvas className="sp-map" ref={canvasRef} aria-label="Карта зала: где вы стоите" role="img" />
        <p className="sp-hint" ref={hint}>
          Ведите пальцем, чтобы бежать
        </p>
        <div className="sp-stick" ref={baseRef} data-state="rest" aria-hidden="true" />
        <div className="sp-knob" ref={knobRef} data-state="rest" aria-hidden="true" />
      </div>
      <div className="sp-turn" aria-hidden="true">
        Поверните телефон вертикально
      </div>
    </div>
  );
}
