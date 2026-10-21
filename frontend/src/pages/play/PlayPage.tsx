/**
 * /play — the player of «Битва с монстром» on the site (docs/live/CONTRACT.md; meldy-notes
 * 10_Project/Telegram_Live_Game_Spec_2026-10-20.md): by the link `/play?pin=482913` or a PIN typed in. Anyone may play,
 * signed in or not; the token stays in this tab (sessionStorage), so a reload goes on with the same player.
 * `?fake=1` plays against the in-page fake server (lib/live/fake.ts) with 23 bots and demo PIN 482913.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { liveApi } from '../../lib/live/api';
import { PlayerApp } from '../../components/live/player/PlayerApp';
import { PlayerController } from '../../components/live/player/controller';
import { obeyOffline } from '../../components/live/player/offline';
import { webPlatform } from '../../components/live/player/platform';

export const SITE_URL = 'https://ludosiel-studyforge.hf.space';

export default function PlayPage() {
  const [params, setParams] = useSearchParams();
  const [platform] = useState(webPlatform);
  const [ctl] = useState(() => new PlayerController({ api: obeyOffline(liveApi()), platform, profile: 'web' }));

  useEffect(() => {
    void ctl.start({ pin: params.get('pin'), mode: params.get('mode') });
    return () => ctl.dispose();
    // The address is read once: later the game writes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl]);

  // The PIN in the address once it is known: a reload comes back to the same game.
  const search = useRef(params);
  search.current = params;
  useEffect(
    () =>
      ctl.subscribe(() => {
        const pin = ctl.getSnapshot().pin;
        if ((search.current.get('pin') ?? '') === pin) return;
        const next = new URLSearchParams(search.current);
        if (pin) next.set('pin', pin);
        else next.delete('pin');
        setParams(next, { replace: true });
      }),
    [ctl, setParams],
  );

  // Shared with the result: the game's own door on the site (a PIN from the teacher's screen), never a token.
  return <PlayerApp ctl={ctl} platform={platform} shareUrl={`${SITE_URL}/play`} />;
}
