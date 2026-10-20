/**
 * The battle's stage around the class (Crowd.tsx): the HP bar, «Дедлайн», the count of players not drawn and the
 * hidden templates of the effects. Positions come from layout.ts; the effects layer is filled by the director.
 */
import { memo, useLayoutEffect, useRef, type RefObject } from 'react';
import type { RosterRow } from '../../../lib/live/types';
import { Boss } from '../art/Boss';
import { Burst, Debris, Shard, Star } from '../art/Fx';
import { BATTLE } from './copy';
import { FX_COLOURS } from './director';
import { bossBox, crowdPoint, hpBox } from './layout';
import { useBossView, useHpView, type StageStore } from './stageStore';

export function HpBar({ store, width, enter }: { store: StageStore; width: number; enter: boolean }) {
  const { hp, max } = useHpView(store);
  const k = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1;
  const box = hpBox(width);
  return (
    <div className={`lvh-hp${enter ? ' lvh-hp--enter' : ''}`} style={{ left: box.x, top: box.y, width: box.width }}>
      <div className="lvh-hp-row">
        <b>{BATTLE.boss}</b>
        <span className="lvh-hp-num">{BATTLE.hp(hp, max)}</span>
      </div>
      <div
        className="lvh-hp-bar"
        role="meter"
        aria-label={BATTLE.boss}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={hp}
        aria-valuetext={BATTLE.hp(hp, max)}
      >
        <i className="lvh-hp-lag" style={{ transform: `scaleX(${k})` }} />
        <i className="lvh-hp-cur" style={{ transform: `scaleX(${k})` }} />
      </div>
    </div>
  );
}

/** The rule the monster's phase adds, under the bar (CONTRACT §3). */
export function PhaseNote({ store, width }: { store: StageStore; width: number }) {
  const { phase, fallen } = useBossView(store);
  const box = hpBox(width);
  if (phase === 0 || fallen) return null;
  return (
    <div className="lvh-phase-note" style={{ left: box.x - 40, width: box.width + 80, top: box.y + 68 }}>
      {BATTLE.phaseNote[phase]}
    </div>
  );
}

export function BossView({ store, width, enter }: { store: StageStore; width: number; enter: boolean }) {
  const view = useBossView(store);
  const shake = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    store.bossShake = shake.current;
    store.bossFlash = flash.current;
    return () => {
      if (store.bossShake === shake.current) store.bossShake = null;
      if (store.bossFlash === flash.current) store.bossFlash = null;
    };
  }, [store]);
  const box = bossBox(width);
  return (
    <div
      className={`lvh-boss${view.fallen ? ' lvh-boss--gone' : ''}${enter ? ' lvh-boss--enter' : ''}`}
      style={{ left: box.x, top: box.y, width: box.size, height: box.size }}
    >
      <div className="lvh-boss-shake" ref={shake}>
        <Boss size={box.size} phase={view.phase} hurt={view.hurt} />
        <div className="lvh-boss-flash" ref={flash} />
      </div>
    </div>
  );
}

/** The players beyond the drawn crowd. */
export function CrowdCount({ hidden, width }: { hidden: number; width: number }) {
  if (hidden <= 0) return null;
  const p = crowdPoint(width);
  return (
    <div className="lvh-crowd-more" style={{ left: p.x - 60, top: p.y - 6 }}>
      {BATTLE.more(hidden)}
    </div>
  );
}

/** Hidden templates the director clones (drawn once by React from the shared art). */
export const FxDefs = memo(function FxDefs({ defsRef }: { defsRef: RefObject<HTMLDivElement> }) {
  return (
    <div ref={defsRef} className="lvh-defs" hidden aria-hidden="true">
      {FX_COLOURS.map((c) => (
        <span key={c} data-fx={`star-${c}`}>
          <Star colour={c} size={34} />
        </span>
      ))}
      <span data-fx="burst">
        <Burst size={70} />
      </span>
      <span data-fx="shard">
        <Shard size={30} />
      </span>
      {(['bell', 'gear', 'hand', 'spring'] as const).map((k) => (
        <span key={k} data-fx={`debris-${k}`}>
          <Debris kind={k} size={60} />
        </span>
      ))}
      <span data-fx="puff">
        <svg viewBox="0 0 28 28" width={28} height={28}>
          <circle cx={14} cy={14} r={11.5} fill="#fff" stroke="#1B2230" strokeWidth={3} />
        </svg>
      </span>
    </div>
  );
});

/** Roster rows in joining order (the arena's places follow it). */
export function byJoin(rows: readonly RosterRow[]): RosterRow[] {
  return rows.slice().sort((a, b) => (a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : a.player_id < b.player_id ? -1 : 1));
}
