/**
 * The class, drawn once for the whole game: the same character elements stand in the lobby's grid, walk into the
 * arena when the first question starts and on to the podium at the end — moved and scaled by transform (a CSS
 * transition, staggered), never unmounted at a change of state. (Unmounting 30 characters cost ~100 ms of removeChild
 * at ×4 CPU, a visible stall at both changes.) Each character listens to its own piece of the stage store: a hit on
 * one renders that one. In the lobby a character is a button: the teacher can remove the player.
 */
import { memo, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { Look, RosterRow } from '../../../lib/live/types';
import { Character } from '../art/Character';
import { CHAR_BASE } from './layout';
import { useCharView, type StageStore } from './stageStore';

export type CrowdView = 'lobby' | 'battle' | 'podium';

export interface Place {
  x: number;
  y: number;
  /** Scale of the CHAR_BASE drawing. */
  k: number;
  hidden: boolean;
  /** The name under the character (not on the podium, whose columns carry it). */
  name: boolean;
}

export const sameLook = (a: Look, b: Look) => a === b || (a.body === b.body && a.colour === b.colour && a.eyes === b.eyes && a.hat === b.hat);

interface CrowdCharProps {
  id: string;
  look: Look;
  name: string;
  place: Place;
  store: StageStore;
  /** Idle sway offset, so the crowd does not move in step. */
  phaseMs: number;
  /** Order in the walk (transition delay). */
  order: number;
  onPick: ((id: string) => void) | null;
}

export const CrowdChar = memo(
  function CrowdChar({ id, look, name, place, store, phaseMs, order, onPick }: CrowdCharProps) {
    const view = useCharView(store, id);
    const hop = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const el = hop.current;
      if (!el) return undefined;
      store.hops.set(id, el);
      return () => {
        if (store.hops.get(id) === el) store.hops.delete(id);
      };
    }, [store, id]);
    const pick = onPick && !place.hidden ? () => onPick(id) : undefined;
    const key = pick
      ? (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            pick();
          }
        }
      : undefined;
    return (
      <div
        className="lvh-slot"
        data-player={id}
        data-hidden={place.hidden ? '' : undefined}
        data-noname={place.name ? undefined : ''}
        style={{ transform: `translate(${place.x}px, ${place.y}px) scale(${place.k})`, ['--i' as string]: order % 40 }}
        role={pick ? 'button' : undefined}
        tabIndex={pick ? 0 : undefined}
        aria-label={pick ? name : undefined}
        aria-hidden={place.hidden ? true : undefined}
        onClick={pick}
        onKeyDown={key}
      >
        <div className="lvh-hop" ref={hop}>
          <Character look={look} size={CHAR_BASE} name={name} face={view.face} frozen={view.frozen} phaseMs={phaseMs} />
        </div>
      </div>
    );
  },
  (a, b) =>
    a.id === b.id &&
    a.name === b.name &&
    a.store === b.store &&
    a.phaseMs === b.phaseMs &&
    a.order === b.order &&
    a.onPick === b.onPick &&
    a.place.x === b.place.x &&
    a.place.y === b.place.y &&
    a.place.k === b.place.k &&
    a.place.hidden === b.place.hidden &&
    a.place.name === b.place.name &&
    sameLook(a.look, b.look),
);

const crownCache = new WeakMap<Look, Look>();
/** The first on the podium wears the crown (the art's hat, so it jumps with the character). */
export function crowned(look: Look): Look {
  if (look.hat === 'crown') return look;
  let out = crownCache.get(look);
  if (!out) {
    out = { ...look, hat: 'crown' };
    crownCache.set(look, out);
  }
  return out;
}

export interface CrowdProps {
  view: CrowdView;
  rows: RosterRow[];
  places: ReadonlyMap<string, Place>;
  store: StageStore;
  onPick: ((id: string) => void) | null;
  /** The podium's first: crowned. */
  first: string | null;
}

export function Crowd({ view, rows, places, store, onPick, first }: CrowdProps) {
  return (
    <div className="lvh-crowd" data-view={view}>
      {rows.map((r, i) => {
        const place = places.get(r.player_id);
        if (!place) return null;
        return (
          <CrowdChar
            key={r.player_id}
            id={r.player_id}
            look={view === 'podium' && r.player_id === first ? crowned(r.look) : r.look}
            name={r.name}
            place={place}
            store={store}
            phaseMs={(i * 137) % 900}
            order={i}
            onPick={view === 'lobby' ? onPick : null}
          />
        );
      })}
    </div>
  );
}
