/**
 * /s/<code> — «Соревнование в своё время» by its link (docs/live/CHALLENGE.md): anyone may play, signed in or not; the
 * device's token is kept in localStorage by the code (lib/challenge/token), so the run, its result and the table are
 * there when the person comes back. `?practice=1`: back from the sign-in «Тренировать ошибки» asked for — it goes on by
 * itself. `?fake=1` plays against the in-page fake (lib/challenge/api) with its demo code `demxchamp123`.
 */
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { challengeApi } from '../../lib/challenge/api';
import { withReturn } from '../../lib/returnTo';
import { ChallengeApp } from '../../components/challenge/ChallengeApp';
import { ChallengeController } from '../../components/challenge/controller';
import { webPlatform } from '../../components/live/player/platform';

export default function ChallengePage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const [platform] = useState(webPlatform);
  const [ctl] = useState(() => new ChallengeController({ api: challengeApi(), haptic: (kind) => platform.haptic(kind) }));

  useEffect(() => {
    void ctl.start(code, { practice: params.get('practice') === '1' });
    return () => ctl.dispose();
    // The address is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, code]);

  return <ChallengeApp ctl={ctl} signInHref={withReturn('/login', `/s/${code}?practice=1`)} />;
}
