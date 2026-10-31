/**
 * /live/challenge?c=<test> — «Соревнование по ссылке» (docs/live/CHALLENGE.md): the deadline (an hour, today, 3 days,
 * a week, two weeks or a date), the time a question, «Без спешки» or points for speed, and how many questions; the
 * questions a challenge does not take are counted, their list folded (as «Провести игру» does, LiveSetupPage). «Создать
 * ссылку» stays in view at the bottom: it creates the challenge (`challenge_create`) and opens its page
 * /live/challenge/<id> with the link, the QR and the results.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { challengeApi } from '../../lib/challenge/api';
import { DEADLINE_PRESETS, TIMES, deadlineOf, deadlineOk, type ChallengeTime, type DeadlinePreset } from '../../lib/challenge/rules';
import { LiveError } from '../../lib/live/types';
import { liveFakeWanted } from '../../lib/live/api';
import { loginFor } from '../../lib/returnTo';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Boss } from '../../components/live/art/Boss';
import { Character } from '../../components/live/art/Character';
import { SETUP, nb } from '../../components/live/host/copy';
import { MAX_GAME_QUESTIONS, MIN_GAME_QUESTIONS, amountChoices, fakeSource, loadSource, type SourcePreview, type SourceQuestion } from '../../components/live/host/source';
import { CSETUP } from '../../components/challenge/copyAuthor';
import { dateText } from '../../components/challenge/copy';
import '../../components/live/host/host.css';
import '../../components/challenge/challengeAuthor.css';
import { Row, Seg } from './setupParts';

/** «2026-11-03T18:40» for an <input type="datetime-local"> in the device's time zone. */
function localValue(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`;
}

function ChallengePicture() {
  return (
    <div className="lvs-mode-pic lcs-pic" aria-hidden="true">
      <div className="lvs-mode-art">
        <Boss size={112} phase={0} />
        <Character look={{ body: 'bean', colour: 'teal', eyes: 'glasses', hat: 'none' }} size={46} style={{ left: 12, top: 74 }} />
      </div>
      <span className="lcs-clock">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>
    </div>
  );
}

export default function ChallengeSetupPage() {
  const [params] = useSearchParams();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const containerId = params.get('c');
  const fake = liveFakeWanted();
  const { user, loading, requestSession } = useAuth();
  const api = useMemo(() => challengeApi(), []);
  useEffect(() => {
    if (!fake) requestSession?.();
  }, [fake, requestSession]);

  const [source, setSource] = useState<SourcePreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [preset, setPreset] = useState<DeadlinePreset | 'custom'>('days3');
  const [custom, setCustom] = useState(() => localValue(deadlineOf('week', new Date())));
  const [time, setTime] = useState<ChallengeTime>(20);
  const [calm, setCalm] = useState(false);
  const [speed, setSpeed] = useState(true);
  const [reveal, setReveal] = useState<'each' | 'end'>('each');
  const [amount, setAmount] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const needsSignIn = !fake && !loading && !user;
  const load = useCallback(() => {
    setFailed(false);
    setSource(null);
    if (fake) {
      setSource(fakeSource());
      return;
    }
    if (!containerId) {
      setFailed(true);
      return;
    }
    loadSource(containerId).then(setSource, () => setFailed(true));
  }, [fake, containerId]);
  useEffect(() => {
    if (fake || user) load();
  }, [fake, user, load]);

  useDocumentTitle(source ? CSETUP.title(source.title) : CSETUP.top);

  const skipOf = (q: SourceQuestion) => (q.challengeSkip !== undefined ? q.challengeSkip : (q.playSkip ?? q.wideSkip));
  const playable = source ? source.questions.filter((q) => !skipOf(q)).length : 0;
  const skipped = source ? source.questions.filter((q) => skipOf(q)) : [];
  const choices = amountChoices(playable);
  const cap = Math.min(playable, MAX_GAME_QUESTIONS);
  const chosen = amount !== null && choices.includes(amount) ? amount : cap > 10 ? 10 : cap;
  const tooFew = !!source && cap < MIN_GAME_QUESTIONS;
  const deadline = preset === 'custom' ? new Date(custom) : deadlineOf(preset, now);
  const deadlineGood = deadlineOk(deadline, now);

  const create = useCallback(async () => {
    if (!source || opening || tooFew || !deadlineGood) return;
    setOpening(true);
    setError(null);
    try {
      const created = await api.create(
        { container_id: source.containerId, subject_ids: source.subjectIds, count: chosen },
        { time_s: time, speed: speed && !calm, ...(calm ? { calm: true } : {}), ...(reveal === 'end' ? { reveal: 'end' as const } : {}), deadline: deadline.toISOString() },
      );
      navigate(`/live/challenge/${created.challenge_id}${fake ? '?fake=1' : ''}`);
    } catch (e) {
      const code = e instanceof LiveError ? e.code : 'other';
      setError(CSETUP.error[code] ?? CSETUP.error.other);
      setOpening(false);
    }
  }, [api, source, opening, tooFew, deadlineGood, chosen, time, speed, calm, reveal, deadline, navigate, fake]);

  if (needsSignIn) return <Navigate to={loginFor(pathname, search)} replace />;

  const back = containerId ? `/exams/c/${containerId}` : '/games';
  return (
    <div className="lvs lcs">
      <header className="lvs-top">
        <Link to={back} className="lvh-logo" aria-label="Meldy">
          Meldy<i />
        </Link>
        <span>{CSETUP.top}</span>
      </header>
      <main className="lvs-main">
        <h1>{source ? CSETUP.title(source.title) : CSETUP.titleNone}</h1>
        {failed ? (
          <p className="lvs-state" role="alert">
            {CSETUP.failed}{' '}
            <button type="button" onClick={load}>
              {CSETUP.retry}
            </button>
          </p>
        ) : !source ? (
          <p className="lvs-state" role="status">
            {CSETUP.loading}
          </p>
        ) : (
          <>
            <section className="lvs-game lcs-game" aria-label={CSETUP.top}>
              <ChallengePicture />
              <div className="lvs-game-text">
                <h2>{CSETUP.top}</h2>
                <p>{CSETUP.lead(Math.min(chosen, cap))}</p>
              </div>
            </section>
            <div className="lvs-rows">
              <Row label={CSETUP.deadline} hint={deadlineGood ? CSETUP.deadlineHint(dateText(deadline.toISOString(), now)) : CSETUP.deadlineBad}>
                <div className="lcs-deadline">
                  <Seg
                    label={CSETUP.deadline}
                    value={preset}
                    options={[...DEADLINE_PRESETS, 'custom' as const].map((p) => ({ value: p, text: CSETUP.deadlineOption[p] }))}
                    onChange={setPreset}
                  />
                  {preset === 'custom' ? (
                    <input
                      className="lcs-date"
                      type="datetime-local"
                      aria-label={CSETUP.deadlineCustom}
                      value={custom}
                      min={localValue(new Date(now.getTime() + 10 * 60_000))}
                      max={localValue(new Date(now.getTime() + 29 * 24 * 3600_000))}
                      onChange={(e) => setCustom(e.target.value)}
                    />
                  ) : null}
                </div>
              </Row>
              <Row label={CSETUP.time}>
                <Seg label={CSETUP.time} value={time} options={TIMES.map((t) => ({ value: t, text: CSETUP.timeOption(t) }))} onChange={setTime} />
              </Row>
              <Row label={CSETUP.calm} hint={CSETUP.calmHint}>
                <Seg
                  label={CSETUP.calm}
                  value={calm}
                  options={[
                    { value: false, text: CSETUP.calmOff },
                    { value: true, text: CSETUP.calmOn },
                  ]}
                  onChange={setCalm}
                />
              </Row>
              {calm ? null : (
                <Row label={CSETUP.speed}>
                  <Seg
                    label={CSETUP.speed}
                    value={speed}
                    options={[
                      { value: true, text: CSETUP.speedOn },
                      { value: false, text: CSETUP.speedOff },
                    ]}
                    onChange={setSpeed}
                  />
                </Row>
              )}
              <Row label={CSETUP.reveal} hint={CSETUP.revealHint}>
                <Seg
                  label={CSETUP.reveal}
                  value={reveal}
                  options={[
                    { value: 'each' as const, text: CSETUP.revealEach },
                    { value: 'end' as const, text: CSETUP.revealEnd },
                  ]}
                  onChange={setReveal}
                />
              </Row>
              {choices.length > 1 ? (
                <Row label={CSETUP.amount} hint={CSETUP.amountHint}>
                  <Seg
                    label={CSETUP.amount}
                    value={chosen}
                    options={choices.map((n) => ({ value: n, text: n === cap && n === playable ? CSETUP.amountAll(n) : nb(n) }))}
                    onChange={setAmount}
                  />
                </Row>
              ) : null}
            </div>
            {skipped.length > 0 ? (
              <details className="lvs-skipped">
                <summary>
                  <b>{CSETUP.skippedHead(skipped.length)}</b>
                  <span>{CSETUP.skippedWhy}</span>
                  <ChevronDown className="lvs-chev" size={20} strokeWidth={2.4} aria-hidden="true" />
                </summary>
                <ul>
                  {skipped.slice(0, 30).map((q) => {
                    const why = skipOf(q)!;
                    return (
                      <li key={q.id}>
                        {q.text} <span>{why === 'options' ? CSETUP.reason.options : why === 'picture' ? CSETUP.reason.picture : SETUP.reason[why]}</span>
                      </li>
                    );
                  })}
                  {skipped.length > 30 ? <li>…</li> : null}
                </ul>
              </details>
            ) : null}
            {tooFew ? (
              <p className="lvs-error" role="alert">
                {CSETUP.tooFew}
              </p>
            ) : null}
            {error ? (
              <p className="lvs-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="lvs-foot">
              <div className="lvs-foot-in">
                <p>{CSETUP.foot}</p>
                <button type="button" className="lvh-btn" onClick={() => void create()} disabled={opening || tooFew || !deadlineGood}>
                  {opening ? CSETUP.creating : CSETUP.create}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
