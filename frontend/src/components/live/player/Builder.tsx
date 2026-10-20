/**
 * «Ваш персонаж»: the name and the four parts (CONTRACT §10). Locked parts stand in the grid with a lock and say how
 * they open. The preview pops on a change (WAAPI on transform; nothing is measured).
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { BODIES, COLOURS, EYES, HATS, LOCKED } from '../../../lib/live/rules';
import type { Look, UnlockId } from '../../../lib/live/types';
import { BODY_PARTS, COLOUR_PARTS, EYE_PARTS, HAT_PARTS } from '../art/parts';
import { LiveChar, reducedMotion } from './art';
import type { Part, PlayerController } from './controller';

const TABS: { part: Part; title: string }[] = [
  { part: 'body', title: 'Тело' },
  { part: 'colour', title: 'Цвет' },
  { part: 'eyes', title: 'Глаза' },
  { part: 'hat', title: 'Шапка' },
];

const IDS: Record<Part, readonly string[]> = { body: BODIES, colour: COLOURS, eyes: EYES, hat: HATS };

function partName(part: Part, id: string): string {
  if (part === 'body') return BODY_PARTS[id as Look['body']].name;
  if (part === 'colour') return COLOUR_PARTS[id as Look['colour']].name;
  if (part === 'eyes') return EYE_PARTS[id as Look['eyes']].name;
  return HAT_PARTS[id as Look['hat']].name;
}

function lockOf(part: Part, id: string): string | null {
  if (part === 'colour') return COLOUR_PARTS[id as Look['colour']].lock;
  if (part === 'hat') return HAT_PARTS[id as Look['hat']].lock;
  return null;
}

const Lock = () => (
  <svg className="lp-lock" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7.5" rx="2" fill="currentColor" />
    <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

interface TileProps {
  part: Part;
  id: string;
  look: Look;
  selected: boolean;
  locked: boolean;
  onPick: (part: Part, id: string) => void;
}

const Tile = memo(function Tile({ part, id, look, selected, locked, onPick }: TileProps) {
  const name = partName(part, id);
  // Like the prototype: the other tabs show the part without a hat, the hat tab on the current character.
  const tileLook: Look = { ...look, [part]: id, ...(part === 'hat' ? {} : { hat: 'none' as const }) };
  return (
    <button
      type="button"
      className="lp-opt"
      aria-pressed={selected}
      data-locked={locked ? 'true' : 'false'}
      aria-label={locked ? `${name}, закрыто: ${lockOf(part, id) ?? ''}` : name}
      onClick={() => onPick(part, id)}
    >
      {part === 'colour' ? (
        <span className="lp-swatch" style={{ background: COLOUR_PARTS[id as Look['colour']].value }} />
      ) : (
        <LiveChar look={tileLook} size={part === 'hat' ? 50 : 54} move="none" />
      )}
      {locked && <Lock />}
    </button>
  );
});

export interface BuilderProps {
  ctl: PlayerController;
  name: string;
  fixedName: string | null;
  look: Look;
  unlocked: readonly UnlockId[];
  lockedTap: { part: Part; id: string } | null;
  from: 'join' | 'lobby';
  busy: boolean;
  error: string | null;
  guest: boolean;
}

export function Builder({ ctl, name, fixedName, look, unlocked, lockedTap, from, busy, error, guest }: BuilderProps) {
  const [tab, setTab] = useState<Part>('body');
  const pop = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const key = `${look.body}|${look.colour}|${look.eyes}|${look.hat}`;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reducedMotion()) return;
    pop.current?.animate?.([{ transform: 'scale(0.84)' }, { transform: 'scale(1.07)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, [key]);

  const onPick = useCallback((p: Part, x: string) => ctl.choose(p, x), [ctl]);
  const ids = IDS[tab];
  const current = look[tab];
  const note = lockedTap
    ? `${partName(lockedTap.part, lockedTap.id)} откроется: ${lockOf(lockedTap.part, lockedTap.id) ?? 'в играх'}.`
    : null;
  const openedHere = (id: string) => !LOCKED.has(id) || unlocked.includes(id as UnlockId);

  return (
    <>
      <div className="lp-page">
        <h1 className="lp-h1">Ваш персонаж</h1>
        <div className="lp-preview">
          <div className="lp-floor" />
          <div ref={pop} className="lp-pop">
            <LiveChar look={look} size={168} face="happy" title={`Ваш персонаж: ${partName('body', look.body)}, ${partName('colour', look.colour).toLowerCase()}`} />
          </div>
        </div>
        <div className="lp-name">
          {fixedName !== null ? (
            <>
              <label id="lp-name-l">Имя в игре</label>
              <output aria-labelledby="lp-name-l">{fixedName}</output>
            </>
          ) : (
            <>
              <label htmlFor="lp-name">Имя в игре</label>
              <input
                id="lp-name"
                value={name}
                maxLength={24}
                autoComplete="nickname"
                enterKeyHint="done"
                placeholder="Как вас назвать"
                aria-invalid={error ? true : undefined}
                onChange={(e) => ctl.setName(e.target.value)}
                disabled={from === 'lobby'}
              />
            </>
          )}
        </div>
        <div className="lp-tabs" role="tablist" aria-label="Части персонажа">
          {TABS.map((t) => (
            <button key={t.part} type="button" role="tab" id={`lp-tab-${t.part}`} aria-selected={tab === t.part} aria-controls="lp-opts" className="lp-tab" onClick={() => setTab(t.part)}>
              {t.title}
            </button>
          ))}
        </div>
        <div className="lp-opts" id="lp-opts" role="tabpanel" aria-labelledby={`lp-tab-${tab}`}>
          {ids.map((id) => (
            <Tile key={id} part={tab} id={id} look={look} selected={current === id} locked={!openedHere(id)} onPick={onPick} />
          ))}
        </div>
        <p className="lp-note" aria-live="polite">
          {note ?? (
            <>
              <b>{partName(tab, current)}</b>
              {'. '}
              {fixedName !== null
                ? 'Имя взято из Telegram. Новые шапки и цвета открываются в играх.'
                : guest
                  ? 'Новые шапки и цвета открываются в играх; сохраняются, если играть из Telegram или войти в Meldy.'
                  : 'Новые шапки и цвета открываются в играх.'}
            </>
          )}
        </p>
        {error && (
          <p className="lp-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="lp-bar">
        <button type="button" className="lp-btn lp-btn--main" disabled={busy} onClick={() => void ctl.confirm()}>
          {busy ? 'Входим…' : from === 'lobby' ? 'Сохранить' : 'Готово'}
        </button>
        {from === 'lobby' ? (
          <button type="button" className="lp-btn lp-btn--quiet" onClick={() => ctl.cancelEdit()}>
            Оставить как было
          </button>
        ) : fixedName === null ? (
          <button type="button" className="lp-btn lp-btn--quiet" onClick={() => ctl.backToPin()}>
            Другой PIN
          </button>
        ) : null}
      </div>
    </>
  );
}
