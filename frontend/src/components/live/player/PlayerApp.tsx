/**
 * The player's screens of «Битва с монстром», the same on the site (/play) and in Telegram (/tg/play): the controller's
 * snapshot picks the screen; the page gives the platform (platform.ts, telegram.ts).
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Battle } from './Battle';
import { Builder } from './Builder';
import { Final } from './Final';
import { Lobby } from './Lobby';
import { PinScreen } from './PinScreen';
import { ReviewScreen } from './ReviewScreen';
import { LiveBoss } from './art';
import type { PlayerController } from './controller';
import type { HapticKind, PlayerPlatform } from './platform';
import './player.css';

export interface PlayerAppProps {
  ctl: PlayerController;
  platform: PlayerPlatform;
  /** Shared with the result («Играть с Meldy»). */
  shareUrl: string;
  /** Telegram's «Назад»: the page shows it with this handler, or hides it with null. */
  onBackChange?: (handler: (() => void) | null) => void;
}

export function PlayerApp({ ctl, platform, shareUrl, onBackChange }: PlayerAppProps) {
  const s = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  const haptic = useCallback((kind: HapticKind) => platform.haptic(kind), [platform]);

  useEffect(() => {
    document.title = 'Битва с монстром — Meldy';
  }, []);

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

  const st = s.state;
  let screen: JSX.Element;
  if (s.step === 'pin') screen = <PinScreen ctl={ctl} error={s.error} initial={s.pin} />;
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
  else if (s.step === 'review') screen = <ReviewScreen ctl={ctl} review={s.review} error={s.reviewError} standalone={s.reviewOnly} />;
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
    screen = <Lobby ctl={ctl} look={st.me.look} name={st.me.name} players={st.players} pin={s.pin} crowd={st.crowd ?? []} canEdit={!s.busy} />;
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
        gameId={s.game?.id ?? ''}
        token={() => ctl.playerToken()}
        shareUrl={shareUrl}
        haptic={haptic}
      />
    );
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

  return (
    <main className="lp" data-step={s.step} data-state={st?.state ?? 'none'} data-platform={platform.kind} aria-label="Битва с монстром">
      {screen}
      {s.link === 'lost' && s.step !== 'pin' && s.step !== 'builder' && (
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
    </main>
  );
}
