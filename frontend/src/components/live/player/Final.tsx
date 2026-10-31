/**
 * The end of the game on the phone: who won, the class's top three on a podium (the own character on its step, or the
 * own place under it), the own place big, damage, right answers and the best streak, the parts this game opened,
 * «Разбор ошибок» and «Поделиться». The steps come up 3rd → 2nd → 1st, like a podium on the projector.
 *
 * Room for hats: a character's hat reaches up to ~20 % of its size above its box and the cheer lifts it ~22 % more, so
 * the podium keeps that much free space above its tallest character (it never covers the heading).
 */
import { useEffect, useRef, useState } from 'react';
import { sharedPlaces, shownPlace } from '../../../lib/live/rules';
import type { Boss, Final as FinalData, Look, TeamRow, TopRow, UnlockId } from '../../../lib/live/types';
import { teamResult } from './TeamLine';
import { LiveChar } from './art';
import type { PlayerController } from './controller';
import { NBSP, UNLOCK_NAMES, nb, questions } from './copy';
import type { HapticKind, PlayerPlatform, ShareResult } from './platform';

function withUnlock(look: Look, unlock: UnlockId): Look {
  if (unlock === 'graphite' || unlock === 'snow') return { ...look, colour: unlock };
  return { ...look, hat: unlock };
}

/** Columns left to right: 2nd, 1st, 3rd; the step's height and the character's size by place. */
const ORDER = [1, 0, 2] as const;
const STEP = [104, 84, 68];
const SIZE = [88, 72, 72];
/** When each place comes up (ms): 3rd, then 2nd, then 1st. */
const DELAY = [900, 450, 100];

function Podium({ rows, meId, mine, won }: { rows: readonly TopRow[]; meId: string; mine: Look; won: boolean }) {
  // equal damage, the same place («1, 1, 3»)
  const places = sharedPlaces(rows.map((r) => r.dmg));
  const label = rows.map((r, i) => `${places[i]}. ${r.player_id === meId ? `${r.name} (вы)` : r.name}`).join(', ');
  return (
    <div className="lp-podium" role="img" aria-label={`Тройка по урону: ${label}`}>
      {ORDER.map((i) => {
        const row = rows[i];
        if (!row) return null;
        const me = row.player_id === meId;
        return (
          <div key={row.player_id} className="lp-podium__col" data-place={i + 1} data-me={me ? 'true' : 'false'}>
            <div className="lp-podium__char" style={{ animationDelay: `${DELAY[i] + 220}ms` }}>
              <LiveChar look={me ? mine : row.look} size={SIZE[i]} face={me || won ? 'happy' : 'idle'} move={me ? 'cheer' : 'idle'} phaseMs={i * 230} />
            </div>
            <div className="lp-podium__step" style={{ height: STEP[i], animationDelay: `${DELAY[i]}ms` }}>
              <b>{places[i]}</b>
              <span>{me ? 'Вы' : row.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface FinalProps {
  ctl: PlayerController;
  platform: PlayerPlatform;
  final: FinalData;
  boss: Boss;
  look: Look;
  players: number;
  asked: number;
  guest: boolean;
  /** The class's top five at the podium (the server's `top`); null when it did not come. */
  top: readonly TopRow[] | null;
  /** A game with teams: the standings and the player's team. */
  teams?: readonly TeamRow[] | null;
  team?: number | null;
  meId: string;
  gameId: string;
  token: () => string | null;
  shareUrl: string;
  haptic: (kind: HapticKind) => void;
}

export function Final({ ctl, platform, final, boss, look, players, asked, guest, top, teams = null, team = null, meId, gameId, token, shareUrl, haptic }: FinalProps) {
  const [shared, setShared] = useState<ShareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fired = useRef(false);
  const won = final.won;
  const left = boss.hp_max > 0 ? Math.max(1, Math.round((100 * boss.hp) / boss.hp_max)) : 0;
  const crown = final.unlocked_now.includes('crown');
  const mine: Look = crown ? { ...look, hat: 'crown' } : look;
  const podium = (top ?? []).slice(0, 3);
  const onPodium = podium.some((r) => r.player_id === meId);
  // the own place as the lists show it: a tie in the five shares its place
  const place = shownPlace(top ? top.map((r) => ({ id: r.player_id, points: r.dmg })) : null, { id: meId, points: final.dmg, place: final.place });
  // A web guest in the top three: the crown stays only with an account or Telegram (CONTRACT §10; nothing is saved
  // for a web guest, and a sign-in later does not bring this game's crown back), so the nudge is for the next game.
  const crownNudge = guest && platform.kind === 'web' && final.place <= 3 && final.dmg > 0 && !crown;

  useEffect(() => {
    if (fired.current) return undefined;
    fired.current = true;
    const t = setTimeout(() => haptic(won ? 'success' : 'warning'), 250);
    const u = final.unlocked_now.length ? setTimeout(() => haptic('success'), 1250) : null;
    return () => {
      clearTimeout(t);
      if (u) clearTimeout(u);
    };
  }, [haptic, won, final.unlocked_now.length]);

  const share = async () => {
    const t = token();
    if (!t || busy) return;
    setBusy(true);
    const title = won ? 'Дедлайн повержен' : 'Битва с Дедлайном';
    const text = `${place}-е место из ${players}, урон ${nb(final.dmg)}, верных ответов ${final.right} из ${asked}.`;
    const result = await platform.share({ title, text, url: shareUrl, gameId, token: t });
    setShared(result);
    setBusy(false);
  };

  return (
    <>
      <div className="lp-page lp-final">
        <h1 className="lp-h1">{won ? 'Дедлайн повержен' : 'Дедлайн победил'}</h1>
        <p className="lp-sub">{won ? `Класс справился за${NBSP}${questions(asked)}` : `У Дедлайна осталось ${left}${NBSP}%`}</p>
        {teams && team ? <p className="lp-final__team">{teamResult(teams, team)}</p> : null}
        {podium.length > 0 ? (
          <Podium rows={podium} meId={meId} mine={mine} won={won} />
        ) : (
          <div className="lp-podium">
            <div className="lp-podium__col" data-me="true">
              <div className="lp-podium__char">
                <LiveChar look={mine} size={96} face={won ? 'happy' : 'idle'} move={won ? 'cheer' : 'idle'} />
              </div>
              <div className="lp-podium__step" style={{ height: 64 }}>
                <b>{place}</b>
                <span>Вы</span>
              </div>
            </div>
          </div>
        )}
        <div className="lp-card lp-result">
          {!onPodium && podium.length > 0 && (
            <div className="lp-result__me">
              <LiveChar look={mine} size={64} face="happy" title={`Ваш персонаж, ${place}-е место`} />
            </div>
          )}
          <div className="lp-result__place">
            <b>{place}-е место</b>
            <span>из {players} по урону</span>
          </div>
        </div>
        <dl className="lp-stats3">
          <div>
            <dt>урона</dt>
            <dd>{nb(final.dmg)}</dd>
          </div>
          <div>
            <dt>верных</dt>
            <dd>
              {final.right}
              {NBSP}из{NBSP}
              {asked}
            </dd>
          </div>
          <div>
            <dt>лучшая серия</dt>
            <dd>{final.best}</dd>
          </div>
        </dl>
        <p className="lp-sub lp-final__class">
          Верных ответов у класса{NBSP}— {final.accuracy_pct}
          {NBSP}%.
        </p>
        {final.unlocked_now.map((u) => (
          <div key={u} className="lp-card lp-unlock">
            <LiveChar look={withUnlock(look, u)} size={62} face="happy" move="none" />
            <div>
              <b>{UNLOCK_NAMES[u].title}</b>
              <br />
              <span>
                {UNLOCK_NAMES[u].why} {guest ? 'Чтобы открытое оставалось у вас, играйте из Telegram или войдите в Meldy.' : 'Уже в вашем шкафу.'}
              </span>
            </div>
          </div>
        ))}
        {crownNudge && (
          <div className="lp-card lp-nudge">
            <LiveChar look={{ ...look, hat: 'crown' }} size={48} face="happy" move="none" />
            <div>
              <b>За тройку даётся корона</b>
              <span>Она сохраняется со входом в Meldy или в Telegram.</span>
              <a className="lp-nudge__go" href="/login?next=%2Fplay">
                Войти до следующей игры
              </a>
            </div>
          </div>
        )}
        <button type="button" className="lp-btn lp-btn--quiet" style={{ marginTop: 8 }} onClick={() => ctl.restart()}>
          Ещё игра по PIN
        </button>
        {shared === 'copied' && (
          <p className="lp-sub" role="status">
            Ссылка скопирована.
          </p>
        )}
        {shared === 'failed' && (
          <p className="lp-error" role="status">
            Не получилось поделиться.
          </p>
        )}
        {/* Stays at the bottom edge while there is more below: the page's scroll shows (it covers only its own room
            at the end). */}
        <div className="lp-more" aria-hidden="true" />
      </div>
      <div className="lp-bar lp-bar--row">
        <button type="button" className="lp-btn lp-btn--second" onClick={() => void ctl.openReview()}>
          Разбор ошибок
        </button>
        <button type="button" className="lp-btn lp-btn--main" disabled={busy} onClick={() => void share()}>
          Поделиться
        </button>
      </div>
    </>
  );
}
