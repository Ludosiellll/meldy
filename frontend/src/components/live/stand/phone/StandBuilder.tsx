/**
 * «Выберите героя» for «Встань на ответ»: the name, the hero (one of the five KayKit characters), the clothes colour
 * and the hat, from the kit's pictures (docs/live/KIT_3D.md §3, §6). The look is the wardrobe's own `{body, colour,
 * hat}` (its `eyes` stays as it was), so it goes to the server as in battle and carries over between games. Locked
 * parts stay in the grid with a lock and say how they open. The kit's own hats wait for the database (rules.ts
 * KIT_HATS_ON).
 */
import { memo, useCallback } from 'react';
import { KIT_HATS_ON, LOCKED } from '../../../../lib/live/rules';
import { BODY_OPTIONS, COLOUR_OPTIONS, HAT_OPTIONS, type KitHatId } from '../../../../lib/live/three/look';
import type { BodyId, ColourId, Look, UnlockId } from '../../../../lib/live/types';
import type { Part, PlayerController } from '../../player/controller';
import { pinText } from '../../player/copy';
import { Thumb } from './Thumb';
import { TITLE } from './words';
import './stand.css';

/** How a locked part opens, in one plain sentence. */
export const LOCK_LINES: Record<UnlockId, string> = {
  crown: 'Корона откроется, когда вы займёте место в тройке.',
  grad: 'Шапочка выпускника откроется после 10 игр.',
  horns: 'Рожки откроются, когда вы 3 раза за игру вернётесь из призраков.',
  graphite: 'Графит откроется после 5 верных ответов подряд.',
  snow: 'Белый откроется после 5 побед над Дедлайном.',
};

const HATS = HAT_OPTIONS.filter((h) => h.wardrobe || KIT_HATS_ON);

const LockIcon = () => (
  <svg className="sp-tile__lock" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7.5" rx="2" fill="currentColor" />
    <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

interface TileProps {
  part: Part;
  id: string;
  label: string;
  selected: boolean;
  locked: boolean;
  onPick: (part: Part, id: string) => void;
  children: React.ReactNode;
}

const Tile = memo(function Tile({ part, id, label, selected, locked, onPick, children }: TileProps) {
  return (
    <button
      type="button"
      className="sp-tile"
      data-part={part}
      aria-pressed={selected}
      data-locked={locked ? 'true' : undefined}
      aria-label={locked ? `${label}, закрыто` : label}
      onClick={() => onPick(part, id)}
    >
      {children}
      {locked && <LockIcon />}
    </button>
  );
});

export interface StandBuilderProps {
  ctl: PlayerController;
  name: string;
  fromTelegram: boolean;
  look: Look;
  unlocked: readonly UnlockId[];
  lockedTap: { part: Part; id: string } | null;
  from: 'join' | 'lobby';
  busy: boolean;
  error: string | null;
  guest: boolean;
  pin: string;
}

export default function StandBuilder({ ctl, name, fromTelegram, look, unlocked, lockedTap, from, busy, error, guest, pin }: StandBuilderProps) {
  const onPick = useCallback((p: Part, x: string) => ctl.choose(p, x), [ctl]);
  const open = (id: string) => !LOCKED.has(id) || unlocked.includes(id as UnlockId);
  const hat = look.hat as KitHatId;
  const body = BODY_OPTIONS.find((b) => b.id === look.body) ?? BODY_OPTIONS[0];
  const note = lockedTap && LOCKED.has(lockedTap.id) ? LOCK_LINES[lockedTap.id as UnlockId] : null;

  return (
    <>
      <div className="lp-page sp-build">
        <h1 className="lp-h1">Выберите героя</h1>
        <p className="lp-sub">
          {TITLE}.{pin ? ` PIN ${pinText(pin)}.` : ''}
        </p>
        <div className="sp-stage">
          {name.trim() && <span className="sp-stage__name">{name.trim()}</span>}
          <Thumb body={look.body} colour={look.colour} hat={hat} size={196} className="sp-thumb--pop" title={`Ваш герой: ${body.name}`} key={`${look.body}|${look.colour}|${look.hat}`} />
        </div>
        <div className="lp-name">
          <label htmlFor="sp-name">Имя в игре</label>
          <input
            id="sp-name"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            enterKeyHint="done"
            placeholder="Как вас назвать"
            aria-invalid={error ? true : undefined}
            onChange={(e) => ctl.setName(e.target.value)}
            disabled={from === 'lobby'}
          />
        </div>

        <h2 className="sp-h2">Герой</h2>
        <div className="sp-tiles sp-tiles--5">
          {BODY_OPTIONS.map((b) => (
            <Tile key={b.id} part="body" id={b.id} label={b.name} selected={look.body === b.id} locked={false} onPick={onPick}>
              <Thumb body={b.id as BodyId} colour={look.colour} hat={hat} size={60} />
              <span className="sp-tile__name">{b.name}</span>
            </Tile>
          ))}
        </div>

        <h2 className="sp-h2">Цвет</h2>
        <div className="sp-tiles sp-tiles--colours">
          {COLOUR_OPTIONS.map((c) => (
            <Tile key={c.id} part="colour" id={c.id} label={c.name} selected={look.colour === c.id} locked={!open(c.id)} onPick={onPick}>
              <span className="sp-swatch" style={{ background: c.hex }} />
            </Tile>
          ))}
        </div>

        <h2 className="sp-h2">Шапка</h2>
        <div className="sp-tiles sp-tiles--5">
          {HATS.map((h) => (
            <Tile key={h.id} part="hat" id={h.id} label={h.name} selected={hat === h.id} locked={!open(h.id)} onPick={onPick}>
              <Thumb body={look.body} colour={look.colour as ColourId} hat={h.id} size={56} />
            </Tile>
          ))}
        </div>

        <p className="lp-note" aria-live="polite">
          {note ??
            (fromTelegram
              ? 'Имя взято из Telegram, его можно поменять. Новые шапки и цвета открываются в играх.'
              : guest
                ? 'Новые шапки и цвета открываются в играх. Они сохранятся, если играть из Telegram или войти в Meldy.'
                : 'Новые шапки и цвета открываются в играх.')}
        </p>
        {error && (
          <p className="lp-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="lp-bar">
        <button type="button" className="lp-btn lp-btn--main" disabled={busy} onClick={() => void ctl.confirm()}>
          {busy ? 'Входим…' : from === 'lobby' ? 'Сохранить героя' : 'Войти в игру'}
        </button>
        {from === 'lobby' ? (
          <button type="button" className="lp-btn lp-btn--quiet" onClick={() => ctl.cancelEdit()}>
            Оставить как было
          </button>
        ) : !fromTelegram ? (
          <button type="button" className="lp-btn lp-btn--quiet" onClick={() => ctl.backToPin()}>
            Ввести другой PIN
          </button>
        ) : null}
      </div>
    </>
  );
}
