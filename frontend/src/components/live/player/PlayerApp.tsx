/**
 * The player's screens of «Битва с монстром», the same on the site (/play) and in Telegram (/tg/play): the controller's
 * snapshot picks the screen; the page gives the platform (platform.ts, telegram.ts).
 *
 * A movement game «Встань на ответ» (state `mode: 'stand'`, docs/live/MODE_STAND.md) gets its own screens after the
 * join (components/live/stand/phone, loaded only then), and its own hero picker before the join when the mode is known
 * already (`modeHint`: the link's `mode=stand`, or this PIN met before in the tab).
 *
 * A battle with movement rounds (`mixed` in the state, docs/live/MODE_MIXED.md) keeps the battle's screens and wraps
 * them in MixedPhone (its own chunk, loaded after the join): the room's socket for the whole game and, during each
 * movement round, the arena in their place.
 */
import { Suspense, lazy, useCallback, useEffect, useSyncExternalStore } from 'react';
import { Battle } from './Battle';
import { Builder } from './Builder';
import { Ended } from './Ended';
import { Final } from './Final';
import { Lobby } from './Lobby';
import { PinScreen } from './PinScreen';
import { ReviewScreen } from './ReviewScreen';
import { LiveBoss } from './art';
import type { PlayerController } from './controller';
import type { HapticKind, PlayerPlatform } from './platform';
import { mixedOf } from '../../../lib/live/types';
import './player.css';

const StandGame = lazy(() => import('../stand/phone/StandGame'));
const MixedPhone = lazy(() => import('../stand/phone/MixedPhone'));
const StandBuilder = lazy(() => import('../stand/phone/StandBuilder'));

export interface PlayerAppProps {
  ctl: PlayerController;
  platform: PlayerPlatform;
  /** Shared with the result: where someone who sees it can play too (the site's /play, the bot in Telegram). */
  shareUrl: string;
  /** Telegram's «Назад»: the page shows it with this handler, or hides it with null. */
  onBackChange?: (handler: (() => void) | null) => void;
}

export function PlayerApp({ ctl, platform, shareUrl, onBackChange }: PlayerAppProps) {
  const s = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  const haptic = useCallback((kind: HapticKind) => platform.haptic(kind), [platform]);

  const st = s.state;
  const stand = st ? st.mode === 'stand' : s.modeHint === 'stand';
  const title = stand ? 'Встань на ответ' : 'Битва с монстром';
  useEffect(() => {
    document.title = `${title} — Meldy`;
  }, [title]);

  // A passing line goes by itself.
  useEffect(() => {
    if (!s.notice) return undefined;
    const t = setTimeout(() => ctl.dismissNotice(), 3500);
    return () => clearTimeout(t);
  }, [s.notice, ctl]);

  // Telegram's «Назад»: a step back where there is one; hidden in the game (closing asks first).
  const back =
    s.step === 'builder' && s.builderFrom === 'lobby'
      ? 'edit'
      : s.step === 'builder' && platform.kind === 'telegram'
        ? 'pin'
        : s.step === 'review' && !s.reviewOnly
          ? 'review'
          : null;
  useEffect(() => {
    if (!onBackChange) return undefined;
    if (back === 'edit') onBackChange(() => ctl.cancelEdit());
    else if (back === 'pin') onBackChange(() => ctl.backToPin());
    else if (back === 'review') onBackChange(() => ctl.closeReview());
    else onBackChange(null);
    return undefined;
  }, [back, onBackChange, ctl]);
  useEffect(() => () => onBackChange?.(null), [onBackChange]);

  // «Встань на ответ» says its own «connection lost» from the room's socket.
  const lost = s.link === 'lost' && s.step !== 'pin' && s.step !== 'builder' && !(stand && s.step === 'game');
  const waiting = (
    <div className="lp-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <p className="lp-sub" role="status">
        Открываем игру…
      </p>
    </div>
  );
  let screen: JSX.Element;
  if (s.step === 'pin') screen = <PinScreen ctl={ctl} error={s.error} initial={s.pin} busy={s.busy} />;
  else if (stand && st && s.game && (s.step === 'game' || (s.step === 'builder' && s.builderFrom === 'lobby')))
    screen = (
      <Suspense fallback={waiting}>
        <StandGame ctl={ctl} s={s} platform={platform} haptic={haptic} />
      </Suspense>
    );
  else if (s.step === 'builder' && s.builderFrom === 'join' && s.modeHint === 'stand')
    screen = (
      <Suspense fallback={waiting}>
        <StandBuilder
          ctl={ctl}
          name={s.name}
          fromTelegram={platform.kind === 'telegram'}
          look={s.look}
          unlocked={s.unlocked}
          lockedTap={s.lockedTap}
          from="join"
          busy={s.busy}
          error={s.error}
          guest={s.guest && platform.kind === 'web'}
          pin={s.pin}
        />
      </Suspense>
    );
  else if (s.step === 'builder')
    screen = (
      <Builder
        ctl={ctl}
        name={s.name}
        fromTelegram={platform.kind === 'telegram'}
        look={s.look}
        unlocked={s.unlocked}
        lockedTap={s.lockedTap}
        from={s.builderFrom}
        busy={s.busy}
        error={s.error}
        guest={s.guest && platform.kind === 'web'}
      />
    );
  else if (s.step === 'review')
    screen = <ReviewScreen ctl={ctl} review={s.review} error={s.reviewError} standalone={s.reviewOnly} back={st?.final ? 'final' : 'ended'} />;
  else if (s.step === 'gone')
    screen = (
      <>
        <div className="lp-page">
          <h1 className="lp-h1">{s.gone?.title ?? 'Игра недоступна'}</h1>
          <p className="lp-sub" role="alert">
            {s.gone?.text}
          </p>
        </div>
        <div className="lp-bar">
          <button type="button" className="lp-btn lp-btn--main" onClick={() => ctl.restart()}>
            Войти по PIN
          </button>
        </div>
      </>
    );
  else if (s.step === 'joining' || !st)
    screen = (
      <div className="lp-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <LiveBoss size={120} phase={0} />
        <p className="lp-sub" role="status">
          Входим в игру…
        </p>
      </div>
    );
  else if (st.state === 'lobby')
    screen = <Lobby ctl={ctl} look={st.me.look} name={st.me.name} players={st.players} pin={s.pin} crowd={st.crowd ?? []} canEdit={!s.busy} rounds={mixedOf(st)?.rounds ?? null} />;
  else if ((st.state === 'podium' || st.state === 'ended') && st.final)
    screen = (
      <Final
        ctl={ctl}
        platform={platform}
        final={st.final}
        boss={st.boss}
        look={st.me.look}
        players={st.players}
        asked={st.qi + 1}
        guest={s.guest}
        top={st.top}
        meId={st.me.player_id}
        gameId={s.game?.id ?? ''}
        token={() => ctl.playerToken()}
        shareUrl={shareUrl}
        haptic={haptic}
      />
    );
  // Ended before the podium (the host's «Закончить», or the 3 hours ran out): no final, no question.
  else if (st.state === 'ended' || st.state === 'podium')
    screen = <Ended ctl={ctl} st={st} look={st.me.look} review={s.review} reviewFailed={!!s.reviewError} />;
  else if (st.question)
    screen = (
      <Battle
        key={st.question.qi}
        ctl={ctl}
        st={st}
        question={st.question}
        pick={s.pick}
        answered={s.answered}
        hpFrom={s.hpFrom}
        frozenBefore={s.frozenBefore}
        late={s.lateQi === st.question.qi}
        offsetMs={s.offsetMs}
        look={st.me.look}
        haptic={haptic}
      />
    );
  else
    screen = (
      <div className="lp-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <p className="lp-sub" role="status">
          Ждём ведущего…
        </p>
      </div>
    );

  // A battle with movement rounds: its screens as they are, the arena over them in its rounds (the socket from the join
  // to the end; the review is after it).
  const mixed = !stand && !!st && !!s.game && !!mixedOf(st) && (s.step === 'game' || s.step === 'builder');
  if (mixed)
    screen = (
      <Suspense fallback={screen}>
        <MixedPhone ctl={ctl} s={s} platform={platform} haptic={haptic}>
          {screen}
        </MixedPhone>
      </Suspense>
    );

  return (
    <main className="lp" data-step={s.step} data-state={st?.state ?? 'none'} data-mode={stand ? 'stand' : mixed ? 'mixed' : 'boss'} data-platform={platform.kind} aria-label={title}>
      {screen}
      {/* Over the boss's row in a question (never the counter, the timer, the question or the answers). */}
      {(lost || s.notice) && (
        <div className="lp-float">
          {lost && (
            <div className="lp-link" role="alert">
              <i aria-hidden="true" />
              Нет связи. Переподключаемся…
            </div>
          )}
          {s.notice && (
            <div className="lp-notice" role="status">
              {s.notice}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
