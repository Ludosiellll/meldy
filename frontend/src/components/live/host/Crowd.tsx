/**
 * The class, drawn once for the whole game: the same character elements stand in the lobby's grid, walk into the
 * arena when the first question starts and on to the podium at the end — moved by transform (a CSS transition,
 * staggered), never unmounted at a change of state. (Unmounting 30 characters cost ~100 ms of removeChild at ×4 CPU, a
 * visible stall at both changes.) Each character listens to its own piece of the stage store: a hit on one renders that
 * one.
 *
 * The name is not inside the scaled drawing: it is its own label at a fixed 24 units (readable from the back of the
 * room whatever the character's size), as wide as the character's place allows, cut with «…» (the full name is the
 * label's title and the character's accessible name). While the class walks between places the names fade out, so two
 * passing characters never show two names on top of each other.
 *
 * In the lobby a character is a button: a click (or Enter) asks whether to remove the player. Nothing changes on hover —
 * a mouse resting on the projector shows nothing to the class.
 */
import { memo, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { Look, RosterRow } from '../../../lib/live/types';
import { Character } from '../art/Character';
import { CHAR_BASE } from './layout';
import { useCharView, type StageStore } from './stageStore';

export type CrowdView = 'lobby' | 'battle' | 'podium';

export interface Place {
  /** Top-left corner of the character's box. */
  x: number;
  y: number;
  /** The character's size in units (its drawing is CHAR_BASE, scaled). */
  size: number;
  hidden: boolean;
  /** The name under the character (not on the podium, whose columns carry it). */
  name: boolean;
  /** The widest the name may be, in units. */
  nameW: number;
  /** Order in the walk (transition delay). */
  i: number;
}

export const NAME_GAP = 6;

export const sameLook = (a: Look, b: Look) => a === b || (a.body === b.body && a.colour === b.colour && a.eyes === b.eyes && a.hat === b.hat);

const samePlace = (a: Place, b: Place) =>
  a === b || (a.x === b.x && a.y === b.y && a.size === b.size && a.hidden === b.hidden && a.name === b.name && a.nameW === b.nameW && a.i === b.i);

/** A stable idle-sway offset per player, so the crowd does not move in step and a kick changes no one else's. */
export function swayOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 900;
}

interface CrowdCharProps {
  id: string;
  look: Look;
  name: string;
  place: Place;
  store: StageStore;
  onPick: ((id: string) => void) | null;
}

export const CrowdChar = memo(
  function CrowdChar({ id, look, name, place, store, onPick }: CrowdCharProps) {
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
    const k = place.size / CHAR_BASE;
    const w = place.nameW;
    return (
      <div
        className="lvh-slot"
        data-player={id}
        data-hidden={place.hidden ? '' : undefined}
        data-noname={place.name ? undefined : ''}
        style={{ transform: `translate(${place.x}px, ${place.y}px)`, ['--i' as string]: place.i % 40 }}
        role={pick ? 'button' : 'img'}
        tabIndex={pick ? 0 : undefined}
        aria-label={name}
        aria-hidden={place.hidden ? true : undefined}
        onClick={pick}
        onKeyDown={key}
      >
        <div className="lvh-body" style={{ transform: `scale(${k})` }}>
          <div className="lvh-hop" ref={hop}>
            <Character look={look} size={CHAR_BASE} face={view.face} frozen={view.frozen} phaseMs={swayOf(id)} />
          </div>
        </div>
        <div className="lvh-name" title={name} aria-hidden="true" style={{ width: w, transform: `translate(${place.size / 2 - w / 2}px, ${place.size + NAME_GAP}px)` }}>
          {name}
        </div>
      </div>
    );
  },
  (a, b) => a.id === b.id && a.name === b.name && a.store === b.store && a.onPick === b.onPick && samePlace(a.place, b.place) && sameLook(a.look, b.look),
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

/** How long the names stay out while the class walks to its new places (the walk: 0.85 s + the stagger). */
export const WALK_MS = 1300;

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
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef(view);
  // A change of view walks the class: the names step out until everyone stands (an attribute, no render).
  useLayoutEffect(() => {
    if (seen.current === view) return undefined;
    seen.current = view;
    const el = box.current;
    if (!el) return undefined;
    el.setAttribute('data-walk', '');
    const t = setTimeout(() => el.removeAttribute('data-walk'), WALK_MS);
    return () => clearTimeout(t);
  }, [view]);
  return (
    <div className="lvh-crowd" data-view={view} ref={box}>
      {rows.map((r) => {
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
            onPick={view === 'lobby' ? onPick : null}
          />
        );
      })}
    </div>
  );
}
