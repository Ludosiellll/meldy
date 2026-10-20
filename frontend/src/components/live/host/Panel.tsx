/**
 * The white panel under the arena: the question with its countdown ring and the four answer tiles (colour, letter and
 * shape, as on the phones), the reveal with the key and the counts, and «Больше всех урона». The ring turns by
 * transform: two half rings rotate on the compositor; only the number changes, once a second.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import type { HostResult, Question, TopRow } from '../../../lib/live/types';
import { Character } from '../art/Character';
import { BATTLE, BOARD, LETTERS, nb } from './copy';
import { optionFont, questionFont } from './layout';

/** Shapes beside the letters, for those who do not tell the colours apart: ▲ ◆ ● ■. */
export function TileShape({ k }: { k: number }) {
  const common = { fill: 'currentColor' };
  return (
    <svg className="lvh-shape" viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
      {k === 0 && <path d="M12 3L22 20H2Z" {...common} />}
      {k === 1 && <path d="M12 2L22 12L12 22L2 12Z" {...common} />}
      {k === 2 && <circle cx={12} cy={12} r={10} {...common} />}
      {k === 3 && <rect x={3} y={3} width={18} height={18} rx={2} {...common} />}
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 34 34" width={34} height={34} aria-hidden="true">
      <path d="M7 18L14 25L28 10" fill="none" stroke="#0B121C" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface TileProps {
  k: number;
  text: string;
  revealed: boolean;
  isKey: boolean;
  count: number;
  share: number;
}

const Tile = memo(function Tile({ k, text, revealed, isKey, count, share }: TileProps) {
  return (
    <div
      className={`lvh-tile lvh-tile--a${k}`}
      data-revealed={revealed ? '' : undefined}
      data-key={revealed && isKey ? '' : undefined}
      data-dim={revealed && !isKey ? '' : undefined}
      style={{ ['--i' as string]: k }}
    >
      <span className="lvh-tile-badge" aria-hidden={revealed && isKey ? undefined : true}>
        {revealed && isKey ? (
          <>
            <Check />
            <span className="lvh-sr">верный ответ, </span>
          </>
        ) : (
          <>
            <TileShape k={k} />
            <b>{LETTERS[k]}</b>
          </>
        )}
      </span>
      <span className="lvh-tile-text" style={{ fontSize: optionFont(text) }}>
        {text}
      </span>
      {revealed ? <span className="lvh-tile-count">{nb(count)}</span> : null}
      <i className="lvh-tile-bar" style={{ transform: `scaleX(${revealed ? share : 0})` }} />
    </div>
  );
});

type RingMode = 'ready' | 'run' | 'done' | 'stop';

/**
 * The sweep: its timing is fixed when it mounts (at the open, or part-way after a reload), so the second's re-render
 * never moves it.
 */
const RingSweep = memo(function RingSweep({ opensAt, halfMs, paused }: { opensAt: number; halfMs: number; paused: boolean }) {
  const [delayMs] = useState(() => Math.min(0, opensAt - Date.now()));
  const play = paused ? 'paused' : 'running';
  return (
    <>
      <div className="lvh-ring-half lvh-ring-half--r">
        <div className="lvh-ring-seg" style={{ animationDuration: `${halfMs}ms`, animationDelay: `${delayMs}ms`, animationPlayState: play }} />
      </div>
      <div className="lvh-ring-half lvh-ring-half--l">
        <div className="lvh-ring-seg" style={{ animationDuration: `${halfMs}ms`, animationDelay: `${delayMs + halfMs}ms`, animationPlayState: play }} />
      </div>
    </>
  );
});

/**
 * Seconds left: 3-2-1 before the answers open (yellow), then the answer time. `opensAt`/`closesAt` are this device's
 * milliseconds (the server's minus the clock offset).
 */
export function Ring({ opensAt, closesAt, stopped }: { opensAt: number; closesAt: number; stopped: boolean }) {
  const modeAt = (now: number): RingMode => (stopped ? 'stop' : now < opensAt ? 'ready' : now < closesAt ? 'run' : 'done');
  const leftAt = (now: number) => Math.max(0, Math.ceil(((now < opensAt ? opensAt : closesAt) - now) / 1000));
  const [tick, setTick] = useState(() => {
    const now = Date.now();
    return { mode: modeAt(now), left: leftAt(now) };
  });
  useEffect(() => {
    if (stopped) {
      setTick((t) => ({ ...t, mode: 'stop' }));
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const now = Date.now();
      const mode = modeAt(now);
      const left = leftAt(now);
      setTick((t) => (t.mode === mode && t.left === left ? t : { mode, left }));
      if (mode === 'done') return;
      const target = now < opensAt ? opensAt : closesAt;
      const toNext = ((target - now) % 1000) || 1000;
      timer = setTimeout(step, toNext + 8);
    };
    step();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opensAt, closesAt, stopped]);
  const total = Math.max(1000, closesAt - opensAt);
  const ready = tick.mode === 'ready';
  return (
    <div className="lvh-ring" data-mode={tick.mode} role="timer" aria-live="off" aria-label={`${tick.left} с`}>
      <div className="lvh-ring-track" />
      {ready ? <div className="lvh-ring-ready" /> : <RingSweep opensAt={opensAt} halfMs={total / 2} paused={tick.mode === 'stop' || tick.mode === 'done'} />}
      <div className="lvh-ring-num">{tick.left}</div>
    </div>
  );
}

interface QuestionPanelProps {
  question: Question;
  /** countdown / open / reveal (the reveal brings `result`). */
  result: HostResult | null;
  players: number;
  answered: number;
  /** This device's ms of the question's open and close. */
  opensAt: number;
  closesAt: number;
}

export function QuestionPanel({ question, result, players, answered, opensAt, closesAt }: QuestionPanelProps) {
  const revealed = !!result && result.qi === question.qi;
  const total = useMemo(() => (result ? Math.max(1, players, result.counts.reduce((a, b) => a + b, 0)) : 1), [result, players]);
  return (
    <section className="lvh-panel lvh-question" aria-label="Вопрос">
      <div className="lvh-q-head">
        <Ring opensAt={opensAt} closesAt={closesAt} stopped={revealed} />
        <h2 className="lvh-q-text" style={{ fontSize: questionFont(question.text) }}>
          {question.text}
        </h2>
        {question.picture ? <img className="lvh-q-pic" src={question.picture} alt="" decoding="async" /> : null}
        <div className="lvh-q-side" aria-live="polite">
          <b>{nb(revealed && result ? result.right : answered)}</b>
          <span>
            {BATTLE.of(players)} {revealed ? BATTLE.right : BATTLE.answered}
          </span>
        </div>
      </div>
      <div className="lvh-tiles" data-n={question.options.length}>
        {question.options.map((text, k) => (
          <Tile
            key={k}
            k={k}
            text={text}
            revealed={revealed}
            isKey={revealed && result!.key === k}
            count={revealed ? (result!.counts[k] ?? 0) : 0}
            share={revealed ? (result!.counts[k] ?? 0) / total : 0}
          />
        ))}
      </div>
    </section>
  );
}

const BoardChar = memo(
  function BoardChar({ row, first }: { row: TopRow; first: boolean }) {
    return <Character look={row.look} size={84} face={first ? 'happy' : 'idle'} move={first ? 'idle' : 'none'} />;
  },
  (a, b) => a.first === b.first && a.row.player_id === b.row.player_id && JSON.stringify(a.row.look) === JSON.stringify(b.row.look),
);

/** «Больше всех урона»: five cards; a card that changed place slides from its old place (`move`, CONTRACT §3). */
export function TopFive({ rows, width }: { rows: TopRow[]; width: number }) {
  const inner = width - 72 - 60;
  const gap = 16;
  const card = (inner - gap * 4) / 5;
  return (
    <section className="lvh-panel lvh-board" aria-label={BOARD.title}>
      <div className="lvh-board-head">
        <h2>{BOARD.title}</h2>
        <span>{BOARD.side}</span>
      </div>
      <ol className="lvh-board-row">
        {rows.slice(0, 5).map((r, i) => {
          const from = i + r.move;
          const slide = r.move !== 0 && from >= 0 && from < 5 ? (from - i) * (card + gap) : null;
          return (
            <li
              key={r.player_id}
              className={`lvh-card${i === 0 ? ' lvh-card--first' : ''}`}
              data-anim={slide !== null ? 'slide' : r.move > 0 ? 'rise' : 'in'}
              style={{ width: card, left: i * (card + gap), ['--from' as string]: `${slide ?? 0}px`, ['--i' as string]: i }}
            >
              <div className="lvh-card-char">
                <BoardChar row={r} first={i === 0} />
              </div>
              <div className="lvh-card-place">{i + 1}</div>
              <div className="lvh-card-name">{r.name}</div>
              <div className="lvh-card-foot">
                <span>{nb(r.dmg)}</span>
                {r.move > 0 ? <span className="lvh-up">{BOARD.up(r.move)}</span> : r.move < 0 ? <span className="lvh-down">{BOARD.down(-r.move)}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
