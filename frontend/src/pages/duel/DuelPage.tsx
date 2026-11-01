/**
 * /d/<code> — «Дуэль» by its invite link (docs/live/DUEL.md): anyone may sit down, signed in or not; the device's token
 * is kept in localStorage by the code (lib/duel/token), so a reload finds the seat. Signed in, a full link first asks
 * the server for this account's seat (the same account on another device takes it over). Both pressed «Ещё раз»: the
 * page moves to the next round's /d/<code>, the token with it. `?practice=1`: back from the sign-in «Тренировать
 * ошибки» asked for — it goes on by itself. The token never goes into the address.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { duelApi } from '../../lib/duel/api';
import { preferredRoute } from '../../lib/supabaseRoute';
import { withReturn } from '../../lib/returnTo';
import { DuelApp } from '../../components/duel/DuelApp';
import { DuelController } from '../../components/duel/controller';
import { webPlatform } from '../../components/live/player/platform';

/** The page starts at most this long after the sign-in state is asked for (a guest's is known at once). */
const AUTH_WAIT_MS = 1500;

export default function DuelPage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading, requestSession } = useAuth();
  const signedIn = useRef(false);
  signedIn.current = !!user;
  const [waited, setWaited] = useState(false);
  const [platform] = useState(webPlatform);
  const [ctl] = useState(
    () =>
      new DuelController({
        api: duelApi(),
        haptic: (kind) => platform.haptic(kind),
        route: () => preferredRoute(),
        signedIn: () => signedIn.current,
        moveTo: (next) => navigate(`/d/${next}`, { replace: true }),
      }),
  );

  useEffect(() => {
    requestSession?.();
    const t = setTimeout(() => setWaited(true), AUTH_WAIT_MS);
    return () => clearTimeout(t);
  }, [requestSession]);

  const known = !loading || waited;
  const practice = params.get('practice') === '1';
  useEffect(() => {
    if (!known) return undefined;
    void ctl.start(code, { practice });
    return () => ctl.dispose();
    // The address is read once per code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, code, known]);

  return <DuelApp ctl={ctl} signInHref={withReturn('/login', `/d/${code}?practice=1`)} exitHref={user ? '/games' : '/'} />;
}
