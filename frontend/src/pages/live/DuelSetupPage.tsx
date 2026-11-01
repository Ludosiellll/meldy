/**
 * /live/duel — «Дуэль» (docs/live/DUEL.md): its setup from one of three sources. `?c=<test>`: the signed-in author's own
 * test or exam (the questions the duel takes are counted beforehand, as the challenge's setup does); `?ch=<code>`: the
 * questions a person was shown in a finished challenge (the run's token from this browser, lib/challenge/token);
 * `?g=<game>`: the closed questions of a live game played in this tab (the player's token, sessionStorage). The server
 * builds the list; no item id leaves the page, no token goes into an address. The time a question, «Без спешки», how
 * many; then the name and the character (the live player's builder); «Создать дуэль» creates it (`duel_create`, the
 * token made here) and opens /d/<code>, where the invite link and the QR wait.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { duelApi } from '../../lib/duel/api';
import { keepDuelToken, newDuelToken } from '../../lib/duel/token';
import { TIMES, type DuelTime } from '../../lib/duel/rules';
import { challengeToken } from '../../lib/challenge/token';
import { LOCKED, checkName, defaultLook } from '../../lib/live/rules';
import { LiveError, type BodyId, type ColourId, type EyesId, type HatId, type Look } from '../../lib/live/types';
import { loginFor } from '../../lib/returnTo';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Character } from '../../components/live/art/Character';
import { Builder } from '../../components/live/player/Builder';
import { readStore, tokenKey, TOKEN_RE } from '../../components/live/player/platform';
import type { Part } from '../../components/live/player/controller';
import { nb } from '../../components/live/host/copy';
import { MAX_GAME_QUESTIONS, MIN_GAME_QUESTIONS, amountChoices, loadSource, type SourcePreview, type SourceQuestion } from '../../components/live/host/source';
import { DSETUP, DU, errorWords } from '../../components/duel/copy';
import type { DuelSettings, DuelSource } from '../../lib/duel/types';
import '../../components/live/host/host.css';
import '../../components/live/player/player.css';
import '../../components/duel/duel.css';
import { Row, Seg } from './setupParts';

const LOOK_KEY = 'meldy.live.look.web';
const NAME_KEY = 'meldy.live.name.web';

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function DuelPicture() {
  return (
    <div className="lvs-mode-pic" aria-hidden="true">
      <div className="lvs-mode-art du-setup-art">
        <Character look={{ body: 'bean', colour: 'teal', eyes: 'glasses', hat: 'none' }} size={58} style={{ left: 26, top: 58 }} />
        <span style={{ position: 'absolute', left: 166, top: 58, transform: 'scaleX(-1)', display: 'block' }}>
          <Character look={{ body: 'round', colour: 'orange', eyes: 'round', hat: 'cap' }} size={58} />
        </span>
      </div>
    </div>
  );
}

type Kind = 'container' | 'challenge' | 'game';

export default function DuelSetupPage() {
  const [params] = useSearchParams();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const containerId = params.get('c');
  const challengeCode = params.get('ch');
  const gameId = params.get('g');
  const kind: Kind | null = containerId ? 'container' : challengeCode ? 'challenge' : gameId ? 'game' : null;
  const { user, loading, requestSession } = useAuth();
  const api = useMemo(() => duelApi(), []);
  useEffect(() => {
    requestSession?.();
  }, [requestSession]);

  // the source's token on this device (a guest's run or player); null: not on this device
  const sourceToken = useMemo(() => {
    if (kind === 'challenge' && challengeCode) return challengeToken(challengeCode);
    if (kind === 'game' && gameId) {
      const t = readStore('session', tokenKey(gameId));
      return t && TOKEN_RE.test(t) ? t : null;
    }
    return null;
  }, [kind, challengeCode, gameId]);

  const [source, setSource] = useState<SourcePreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState<DuelTime | 'same'>(kind === 'container' ? 20 : 'same');
  const [calm, setCalm] = useState<boolean | 'same'>(kind === 'container' ? false : 'same');
  const [amount, setAmount] = useState<number | null>(null);
  const [step, setStep] = useState<'settings' | 'builder'>('settings');
  const [name, setName] = useState(() => readLocal(NAME_KEY) ?? '');
  const [lookTouched, setLookTouched] = useState(false);
  const [look, setLook] = useState<Look>(() => {
    try {
      const cached = JSON.parse(readLocal(LOOK_KEY) ?? 'null') as Look | null;
      if (cached && typeof cached === 'object' && !LOCKED.has(cached.colour) && !LOCKED.has(cached.hat)) return cached;
    } catch {
      // none
    }
    return defaultLook(readLocal(NAME_KEY) || 'Игрок');
  });
  const [lockedTap, setLockedTap] = useState<{ part: Part; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsSignIn = kind === 'container' && !loading && !user;
  const load = useCallback(() => {
    setFailed(false);
    setSource(null);
    if (kind !== 'container' || !containerId) return;
    loadSource(containerId).then(setSource, () => setFailed(true));
  }, [kind, containerId]);
  useEffect(() => {
    if (kind === 'container' && user) load();
  }, [kind, user, load]);

  useDocumentTitle(source ? DSETUP.title(source.title) : kind === 'container' ? DSETUP.top : DSETUP.titleSame);

  const skipOf = (q: SourceQuestion) => (q.challengeSkip !== undefined ? q.challengeSkip : (q.playSkip ?? q.wideSkip));
  const playable = source ? source.questions.filter((q) => !skipOf(q)).length : 0;
  const skipped = source ? source.questions.length - playable : 0;
  const choices = amountChoices(playable);
  const cap = Math.min(playable, MAX_GAME_QUESTIONS);
  const chosen = amount !== null && choices.includes(amount) ? amount : cap > 10 ? 10 : cap;
  const tooFew = kind === 'container' && !!source && cap < MIN_GAME_QUESTIONS;

  const duelSource = useMemo((): DuelSource | null => {
    if (kind === 'container' && source) return { container_id: source.containerId, subject_ids: source.subjectIds, count: chosen };
    if (kind === 'challenge' && challengeCode && sourceToken) return { challenge: challengeCode, token: sourceToken };
    if (kind === 'game' && gameId && sourceToken) return { game: gameId, token: sourceToken };
    return null;
  }, [kind, source, chosen, challengeCode, gameId, sourceToken]);

  const create = useCallback(async () => {
    if (!duelSource || busy) return;
    const check = checkName(name);
    if (!check.ok) {
      setError(check.reason === 'rude' ? DU.builder.rude : DU.builder.length);
      return;
    }
    setBusy(true);
    setError(null);
    const settings: DuelSettings = {
      ...(time !== 'same' ? { time_s: time } : {}),
      ...(calm !== 'same' ? { calm, speed: !calm } : {}),
    };
    const token = newDuelToken();
    try {
      const st = await api.create(duelSource, settings, check.name, token, look);
      keepDuelToken(st.duel.code, token);
      try {
        window.localStorage.setItem(NAME_KEY, check.name);
        window.localStorage.setItem(LOOK_KEY, JSON.stringify(look));
      } catch {
        // a private window
      }
      navigate(`/d/${st.duel.code}`);
    } catch (e) {
      setError(errorWords(e instanceof LiveError ? e : new LiveError('unknown')));
      setBusy(false);
    }
  }, [duelSource, busy, name, time, calm, api, look, navigate]);

  // the live player's builder, driven by this page's own state
  const builderCtl = useMemo(
    () => ({
      setName: (raw: string) => {
        const next = raw.slice(0, 40);
        setName(next);
        setError(null);
        if (!lookTouched) setLook(defaultLook(next.trim() || 'Игрок'));
      },
      choose: (part: Part, id: string) => {
        if (LOCKED.has(id)) {
          setLockedTap({ part, id });
          return;
        }
        setLookTouched(true);
        setLockedTap(null);
        setLook((l) => ({
          ...l,
          ...(part === 'body' ? { body: id as BodyId } : part === 'colour' ? { colour: id as ColourId } : part === 'eyes' ? { eyes: id as EyesId } : { hat: id as HatId }),
        }));
      },
      confirm: () => create(),
      cancelEdit: () => setStep('settings'),
      backToPin: () => setStep('settings'),
    }),
    [create, lookTouched],
  );

  if (needsSignIn) return <Navigate to={loginFor(pathname, search)} replace />;

  if (step === 'builder') {
    return (
      <main className="lp du" data-step="builder" aria-label={DU.name}>
        <div className="du-col">
          <Builder ctl={builderCtl} name={name} fromTelegram={false} look={look} unlocked={[]} lockedTap={lockedTap} from="join" busy={busy} error={error} guest={!user} backText={DSETUP.back} />
        </div>
      </main>
    );
  }

  const back = containerId ? `/exams/c/${containerId}` : challengeCode ? `/s/${challengeCode}` : '/games';
  let body;
  if (!kind) {
    body = (
      <p className="lvs-state" role="alert">
        {DSETUP.noSource}
      </p>
    );
  } else if (kind !== 'container' && !sourceToken) {
    body = (
      <p className="lvs-state" role="alert">
        {kind === 'challenge' ? DSETUP.noTokenChallenge : DSETUP.noTokenGame}
      </p>
    );
  } else if (kind === 'container' && failed) {
    body = (
      <p className="lvs-state" role="alert">
        {DSETUP.failed}{' '}
        <button type="button" onClick={load}>
          {DSETUP.retry}
        </button>
      </p>
    );
  } else if (kind === 'container' && !source) {
    body = (
      <p className="lvs-state" role="status">
        {DSETUP.loading}
      </p>
    );
  } else {
    body = (
      <>
        <section className="lvs-game" aria-label={DSETUP.top}>
          <DuelPicture />
          <div className="lvs-game-text">
            <h2>{DSETUP.top}</h2>
            <p>{kind === 'container' ? DSETUP.lead(Math.min(chosen, cap)) : kind === 'challenge' ? DSETUP.leadChallenge : DSETUP.leadGame}</p>
          </div>
        </section>
        <div className="lvs-rows">
          <Row label={DSETUP.time}>
            <Seg
              label={DSETUP.time}
              value={time}
              options={[...(kind === 'container' ? [] : [{ value: 'same' as const, text: DSETUP.same }]), ...TIMES.map((t) => ({ value: t, text: DSETUP.timeOption(t) }))]}
              onChange={setTime}
            />
          </Row>
          <Row label={DSETUP.calm} hint={DSETUP.calmHint}>
            <Seg
              label={DSETUP.calm}
              value={calm}
              options={[
                ...(kind === 'container' ? [] : [{ value: 'same' as const, text: DSETUP.same }]),
                { value: false, text: DSETUP.off },
                { value: true, text: DSETUP.on },
              ]}
              onChange={setCalm}
            />
          </Row>
          {kind === 'container' && choices.length > 1 ? (
            <Row label={DSETUP.amount}>
              <Seg label={DSETUP.amount} value={chosen} options={choices.map((n) => ({ value: n, text: n === cap && n === playable ? DSETUP.amountAll(n) : nb(n) }))} onChange={setAmount} />
            </Row>
          ) : null}
        </div>
        {skipped > 0 ? <p className="lvs-state">{DSETUP.skipped(skipped)}</p> : null}
        {tooFew ? (
          <p className="lvs-error" role="alert">
            {DSETUP.tooFew}
          </p>
        ) : null}
        {error ? (
          <p className="lvs-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="lvs-foot">
          <div className="lvs-foot-in">
            <p>{DSETUP.foot}</p>
            <button type="button" className="lvh-btn" onClick={() => setStep('builder')} disabled={!duelSource || tooFew}>
              {DSETUP.next}
            </button>
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="lvs lcs">
      <header className="lvs-top">
        <Link to={back} className="lvh-logo" aria-label="Meldy">
          Meldy<i />
        </Link>
        <span>{DSETUP.top}</span>
      </header>
      <main className="lvs-main">
        <h1>{source ? DSETUP.title(source.title) : kind === 'container' ? DSETUP.top : DSETUP.titleSame}</h1>
        {body}
      </main>
    </div>
  );
}
